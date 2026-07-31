// The terminal rasteriser — the braille & block vocabulary as a post-process.
// The glyph pass, used by both surfaces: dithered dot
// threshold and ink/background colour from glb-braille, the block ramp from
// coverage (ON by default — everything here is particles, where a solid
// cell reads as a bright cluster, not banding).
//
// The 3D scene renders into a tiny offscreen target whose pixels ARE braille
// sub-pixels (2 x 4 per character cell, exactly like the Python Canvas). A
// cellify pass folds each cell's 8 sub-pixels into a bit pattern + a luma; the
// glyph pass then draws every cell the way mpp.py composes it:
//
//     luma above the block threshold  ->  a block glyph  ▁▂▃▄▅▆▇█  (by luma)
//     any sub-pixel lit               ->  the braille dot pattern
//     else                            ->  the background

import * as THREE from "three";

const QUAD_VERT = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Phosphor persistence: the braille sub-pixel buffer is composed over a
// decayed copy of the last frame's, so anything that MOVES leaves a fading
// CRT trail. max() (not additive) keeps a static image bit-identical to
// persistence-off — only motion glows.
const COMPOSE_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tNew;
  uniform sampler2D tPrev;
  uniform float uDecay;

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 n = texelFetch(tNew, p, 0).rg;
    vec2 d = texelFetch(tPrev, p, 0).rg * uDecay;
    gl_FragColor = vec4(max(n.r, d.r), max(n.g, d.g), 0.0, 1.0);
  }
`;

// Fractional phosphor: the accumulation stays intact (full trail timing),
// but what the glyph pipeline SEES is a mix of the raw frame and the
// accumulated one — uAmt 0 = no ghosts, 1 = full phosphor. Blending at
// read keeps the amount frame-rate independent.
const PHOSMIX_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tRaw;
  uniform sampler2D tAcc;
  uniform float uAmt;

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 n = texelFetch(tRaw, p, 0).rg;
    vec2 a = texelFetch(tAcc, p, 0).rg;
    gl_FragColor = vec4(mix(n, a, uAmt), 0.0, 1.0);
  }
`;

const CELLIFY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tScene;
  uniform float uDotThresh;
  uniform float uDither;
  uniform float uBlockLo;   // quadrant energy where a block quadrant prints
  uniform float uBlockHi;   // cell energy that forces the full solid block

  // Ordered 4x4 Bayer, indexed by sub-pixel position on the grid.
  float bayer(ivec2 p) {
    const int M[16] = int[16](
       0,  8,  2, 10,
      12,  4, 14,  6,
       3, 11,  1,  9,
      15,  7, 13,  5);
    int i = (p.y & 3) * 4 + (p.x & 3);
    return float(M[i]) / 16.0;
  }

  float hotAt(ivec2 sp, ivec2 sz) {
    sp = clamp(sp, ivec2(0), sz - 1);
    return texelFetch(tScene, sp, 0).g;
  }

  // authored energy, spread by a peak-preserving falloff dilation reaching
  // one cell in every direction: a strong mark claims a chunky ISLAND — a
  // solid core cell with ragged partial caps — while weak marks stay dots.
  // max (not sum) keeps amplitude, so lo/hi read directly against particle
  // energy and interiors of big slabs are unchanged.
  float hotSpread(ivec2 sp, ivec2 sz) {
    float g = 0.0;
    for (int dy = -4; dy <= 4; dy++) {
      for (int dx = -2; dx <= 2; dx++) {
        float d = length(vec2(float(dx) * 0.5, float(dy) * 0.25));  // cell units
        float w = pow(max(0.0, 1.0 - d), 1.5);
        if (w > 0.0) g = max(g, w * hotAt(sp + ivec2(dx, dy), sz));
      }
    }
    return g;
  }

  void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    ivec2 sz = textureSize(tScene, 0);
    int bits = 0;
    float lum = 0.0;
    float hotSum = 0.0;
    float hotMx = 0.0;
    float q0 = 0.0, q1 = 0.0, q2 = 0.0, q3 = 0.0;   // 2x2 quadrant energy
    for (int dy = 0; dy < 4; dy++) {
      for (int dx = 0; dx < 2; dx++) {
        ivec2 sp = cell * ivec2(2, 4) + ivec2(dx, dy);
        vec2 v = texelFetch(tScene, sp, 0).rg;   // r energy · g authored energy
        lum += v.r;
        float g = hotSpread(sp, sz);             // dots stay crisp; hot spreads
        hotSum += g;
        hotMx = max(hotMx, g);
        if (dy < 2) { if (dx == 0) q0 += g; else q1 += g; }
        else        { if (dx == 0) q2 += g; else q3 += g; }
        // dither > 0 makes dot *density* carry tone — useful when the pool
        // sits densely on an asset surface; 0 is the classic line-shading threshold
        if (v.r > uDotThresh + uDither * bayer(sp)) bits |= (1 << (dy * 2 + dx));
      }
    }
    // blocks resolve PER QUADRANT: each half-width x half-height sub-block
    // prints only where the authored energy actually landed, so a hot blob
    // comes out as an imperfect mosaic (a terminal's ▖▌▀█), not a clean rect.
    // qSum*0.5 matches the old per-cell boundary exactly for uniform cells
    // and subsumes the old single-particle peak rule (max <= sum).
    float eff = max(hotSum * 0.125, hotMx * 0.5);
    int qbits = 0;
    if (q0 * 0.5 > uBlockLo) qbits |= 1;
    if (q1 * 0.5 > uBlockLo) qbits |= 2;
    if (q2 * 0.5 > uBlockLo) qbits |= 4;
    if (q3 * 0.5 > uBlockLo) qbits |= 8;
    // the solid force uses the AVERAGE only — one hot quadrant must never
    // solidify a whole cell, or every chip snaps back to a clean rectangle
    if (hotSum * 0.125 >= uBlockHi) qbits = 15;
    gl_FragColor = vec4(float(bits), lum * 0.125, eff, float(qbits));
  }
`;

const GLYPH_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tCell;
  uniform vec2 uCellPx;     // one character cell, in device pixels
  uniform vec2 uGrid;       // cols, rows
  uniform vec2 uOrigin;     // grid's bottom-left corner on the canvas
  uniform float uDotR;      // braille dot radius (fraction of a sub-cell)
  uniform vec2 uGap;        // glyph ink-box inset per side, fraction of cell —
                            // the seam a real terminal shows between glyphs
  uniform float uBlocks;    // 0 = braille only, 1 = let bright cells solidify
  uniform float uShade;     // how much cell luma modulates the ink
  uniform vec3 uInk;
  uniform vec3 uBg;
  // terminal feel
  uniform float uBgAlpha;   // 1 = opaque background; 0 = transparent export
  uniform float uLevels;    // 0 = smooth shade, else quantized ink steps
  uniform float uFlicker;   // per-cell instability, 0..1
  uniform float uSeed;      // frame-step seed for the flicker hash

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 p = gl_FragCoord.xy - uOrigin;
    vec2 cellF = p / uCellPx;
    if (cellF.x < 0.0 || cellF.y < 0.0 ||
        cellF.x >= uGrid.x || cellF.y >= uGrid.y) {
      gl_FragColor = vec4(uBg, uBgAlpha);
      return;
    }
    ivec2 cell = ivec2(cellF);
    vec2 ic = fract(cellF);                    // in-cell coords, y up
    vec4 cd = texelFetch(tCell, cell, 0);
    int bits = int(cd.r + 0.5);
    float lum = cd.g;
    // .a is the AUTHORED quadrant pattern — crowding alone never solidifies
    int qbits = int(cd.a + 0.5);

    float v = 0.0;
    vec2 span = 1.0 - 2.0 * uGap;              // the glyph ink box
    if (uBlocks > 0.5 && qbits != 0) {
      // quadrant mosaic: the ink box splits 2x2 and only the quadrants the
      // authored energy reached print — a blob spanning cells comes out as
      // solid middles with ragged half/quarter-block edges, the way a real
      // terminal composes ▖▌▀█, never one clean rectangle. The inset still
      // keeps the per-character seam.
      vec2 icg = (ic - uGap) / span;
      if (all(greaterThanEqual(icg, vec2(0.0))) && all(lessThan(icg, vec2(1.0)))) {
        ivec2 sub = ivec2(int(icg.x * 2.0), int(icg.y * 2.0));
        v = float((qbits >> (sub.y * 2 + sub.x)) & 1);
      }
    } else if (bits != 0) {
      // braille: 2 x 4 sub-cells inside the same ink box — dots cluster per
      // cell, so the character grid reads in the stipple too
      vec2 icg = (ic - uGap) / span;
      if (all(greaterThanEqual(icg, vec2(0.0))) && all(lessThan(icg, vec2(1.0)))) {
        ivec2 sub = ivec2(int(icg.x * 2.0), int(icg.y * 4.0));
        int bit = sub.y * 2 + sub.x;
        if (((bits >> bit) & 1) != 0) {
          vec2 c = uGap + span * (vec2(sub) + 0.5) / vec2(2.0, 4.0);
          vec2 dpx = (ic - c) * uCellPx;       // offset in device pixels
          float rpx = uDotR * 0.5 * min(uCellPx.x * span.x * 0.5,
                                        uCellPx.y * span.y * 0.25);
          v = 1.0 - smoothstep(rpx - 0.7, rpx + 0.7, length(dpx));
        }
      }
    }

    float tint = mix(1.0, 0.8 + 0.45 * clamp(lum, 0.0, 1.2), uShade);

    // ANSI-ish ink: a terminal has a few brightnesses, not a ramp
    if (uLevels > 0.5) {
      tint = clamp(tint, 0.0, 1.25);
      tint = (floor(tint * uLevels) + 0.5) / uLevels * 1.25;
    }

    // per-cell instability: an occasional cell prints dim or drops a frame
    if (uFlicker > 0.001) {
      vec2 fc = vec2(cell);
      float shimmer = 1.0 - uFlicker * 0.14 * hash21(fc + fract(uSeed * 0.317) * 61.7);
      float drop = step(1.0 - 0.16 * uFlicker, hash21(fc + fract(uSeed * 0.731) * 97.3));
      tint *= shimmer * (1.0 - 0.7 * drop);
    }

    gl_FragColor = vec4(mix(uBg, uInk * tint, v), max(uBgAlpha, v));
  }
`;

function fsQuad(fragmentShader, uniforms) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return { scene, cam, mat };
}

export class TerminalPass {
  constructor() {
    this.cellW = 18;     // CSS px per character cell
    this.cellH = 30;
    this.cols = 4;
    this.rows = 4;
    this.phosphor = false;   // CRT persistence — motion leaves fading trails
    this.persist = 0.4;      // trail time constant, in scene seconds

    const rtOpts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(8, 16, rtOpts);
    this.cellRT = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    this.accumRT = [
      new THREE.WebGLRenderTarget(8, 16, rtOpts),
      new THREE.WebGLRenderTarget(8, 16, rtOpts),
    ];
    this.mixRT = new THREE.WebGLRenderTarget(8, 16, rtOpts);
    this._accumIdx = 0;
    this._accumStale = true;   // cleared on the first phosphor frame
    this.phosAmt = 1;          // fractional phosphor 0..1 (1 = classic)

    this.compose = fsQuad(COMPOSE_FRAG, {
      tNew: { value: this.sceneRT.texture },
      tPrev: { value: null },
      uDecay: { value: 0 },
    });
    this.phosmix = fsQuad(PHOSMIX_FRAG, {
      tRaw: { value: this.sceneRT.texture },
      tAcc: { value: null },
      uAmt: { value: 1 },
    });

    this.cellify = fsQuad(CELLIFY_FRAG, {
      tScene: { value: this.sceneRT.texture },
      uDotThresh: { value: 0.055 },
      uDither: { value: 0 },
      uBlockLo: { value: 0.85 },
      uBlockHi: { value: 2.4 },
    });
    this.glyph = fsQuad(GLYPH_FRAG, {
      tCell: { value: this.cellRT.texture },
      uCellPx: { value: new THREE.Vector2(8, 16) },
      uGrid: { value: new THREE.Vector2(4, 4) },
      uOrigin: { value: new THREE.Vector2(0, 0) },
      uDotR: { value: 0.86 },
      uGap: { value: new THREE.Vector2(0, 0) },
      uBlocks: { value: 0 },
      uBlockLo: { value: 0.85 },
      uBlockHi: { value: 2.4 },
      uShade: { value: 1 },
      uInk: { value: new THREE.Color(0xf4f4f1) },
      uBg: { value: new THREE.Color(0x0b0b0c) },
      uBgAlpha: { value: 1 },
      uLevels: { value: 0 },
      uFlicker: { value: 0 },
      uSeed: { value: 0 },
    });
  }

  /** Size against the COMPOSITION, not the window: `compW/compH` fix the
      glyph grid (cols = compW / cellW), so any preview zoom or export pass
      over the same comp yields the identical grid; `pxW/pxH` is the actual
      drawing-buffer size the glyph pass fills (grid centred, scaled). */
  setSize(compW, compH, pxW, pxH) {
    this.cols = Math.max(8, Math.floor(compW / this.cellW));
    this.rows = Math.max(6, Math.floor(compH / this.cellH));
    this.sceneRT.setSize(this.cols * 2, this.rows * 4);
    this.cellRT.setSize(this.cols, this.rows);
    for (const rt of this.accumRT) rt.setSize(this.cols * 2, this.rows * 4);
    this.mixRT.setSize(this.cols * 2, this.rows * 4);
    this._accumStale = true;
    const scale = Math.min(pxW / compW, pxH / compH);
    const cw = this.cellW * scale, ch = this.cellH * scale;
    this.glyph.mat.uniforms.uCellPx.value.set(cw, ch);
    this.glyph.mat.uniforms.uGrid.value.set(this.cols, this.rows);
    this.glyph.mat.uniforms.uOrigin.value.set(
      Math.round((pxW - this.cols * cw) / 2),
      Math.round((pxH - this.rows * ch) / 2),
    );
  }

  /** Braille-subpixel RT height — the points pass sizes itself against this. */
  get rtHeight() {
    return this.rows * 4;
  }

  render(renderer, scene, camera, dt = 0) {
    renderer.setRenderTarget(this.sceneRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);

    let src = this.sceneRT.texture;
    if (this.phosphor) {
      if (this._accumStale) {
        for (const rt of this.accumRT) {
          renderer.setRenderTarget(rt);
          renderer.setClearColor(0x000000, 1);
          renderer.clear();
        }
        this._accumStale = false;
      }
      const prev = this.accumRT[this._accumIdx];
      const next = this.accumRT[1 - this._accumIdx];
      const cu = this.compose.mat.uniforms;
      cu.tPrev.value = prev.texture;
      cu.uDecay.value = Math.exp(-dt / Math.max(0.02, this.persist));
      renderer.setRenderTarget(next);
      renderer.render(this.compose.scene, this.compose.cam);
      this._accumIdx = 1 - this._accumIdx;
      src = next.texture;
      if (this.phosAmt < 0.999) {        // fractional: blend raw <- amt -> trails
        const mu = this.phosmix.mat.uniforms;
        mu.tAcc.value = next.texture;
        mu.uAmt.value = Math.max(0, this.phosAmt);
        renderer.setRenderTarget(this.mixRT);
        renderer.render(this.phosmix.scene, this.phosmix.cam);
        src = this.mixRT.texture;
      }
    } else {
      this._accumStale = true;   // stale trails never greet a re-enable
    }
    this.cellify.mat.uniforms.tScene.value = src;
    // block thresholds live on the glyph uniforms (that's where the pages
    // write them) but the quadrant decision happens in cellify — mirror them
    this.cellify.mat.uniforms.uBlockLo.value = this.glyph.mat.uniforms.uBlockLo.value;
    this.cellify.mat.uniforms.uBlockHi.value = this.glyph.mat.uniforms.uBlockHi.value;

    renderer.setRenderTarget(this.cellRT);
    renderer.render(this.cellify.scene, this.cellify.cam);

    renderer.setRenderTarget(null);
    renderer.render(this.glyph.scene, this.glyph.cam);
  }
}
