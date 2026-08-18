// The ACTUAL image, composited over the glyph render — the dial that turns
// a braille trace back into the photograph it was sampled from.
//
// Every image mode carries its raster and, refreshed on each regen, the
// ink-extent frame its dots were normalised into (mode.photo.map). The
// overlay draws that raster as a quad through the SAME transform the dots
// ride — the engine's live slot-B group matrix — so photo and stipple
// register exactly, at any size / spin / tilt, mid-flight included.
//
// ARRIVAL is transition-aware. On a mosaic stagger (blocks / blocks out)
// the photo is masked per fragment by the SAME tile schedule the dots
// print with: each fragment projects through the house frame exactly as
// _blockKeys projects dots (D = 3.55, perspective divide), looks its tile
// key up, and pops when the tile does — so a print transition reveals the
// photograph piece by piece, in the schedule's order. Any other stagger
// keeps the smooth arrival gate. Either way the pages drive engine.fade
// from the settled gate, so the dots dissolve seed-order only once the
// morph has landed.

import * as THREE from "three";
import { paramValues } from "./modes.js";

const D = 3.55;   // the house camera distance, shared by every frame mapping

function hash01(i) {
  let h = (i * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform sampler2D uMap;
  uniform float uAlpha;
  uniform int uMaskOn;
  uniform sampler2D uKeys;    // per-tile reveal keys, row 0 = top row
  uniform vec2 uHalf;         // the comp frame's half extents at z = 0
  uniform vec2 uGrid;         // cols, rows
  uniform float uProg, uSpread;
  uniform float uFlip;        // 1: exit — tiles UN-print the photograph
  // the photo's OWN tone, independent of the trace's threshold/gamma — a
  // dark, low-key source photographed against the scene's near-black bg
  // needs its own lift, not just the dot-trace's
  uniform float uBrightness, uContrast, uGamma;
  // a cell-reveal retires the trace cell by cell as it goes, not in one
  // snap at the end — uForceOpaque pre-composites the photo over the
  // scene bg wherever a cell has popped, hiding the braille there, but
  // only where the photo's OWN alpha says there's actual garment: it
  // scales toward the normal (source-alpha) output as c.a drops, so a
  // fully transparent PNG pixel still lets the braille show through, and
  // feathered cutout edges blend rather than cut hard
  uniform vec3 uBg;
  uniform float uForceOpaque;
  // that alpha stops exactly on the cutout's outline, but a braille GLYPH is
  // a whole terminal cell — one holding a dot at the silhouette's edge sticks
  // out past the outline, and its overhang never gets cleared: leftover
  // glyphs clinging to the sides of the garment. uBleed dilates the mask
  // outward so those straggler cells are covered too. It arrives ALREADY in
  // raster px, derived per draw from the live glyph cell (_cellInRaster) —
  // separate x and y, because a cell is twice as tall as it is wide and one
  // isotropic radius can only ever compromise between the two axes
  uniform vec2 uTexel;   // 1 / raster size
  uniform vec2 uBleed;   // raster px the clear runs past the outline, x and y

  float bleedAlpha(vec2 uv, vec2 r) {
    float m = texture2D(uMap, uv).a;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7853982;
      vec2 d = vec2(cos(ang), sin(ang)) * r * uTexel;
      // two rings — a single one at full radius cuts corners on concavities
      m = max(m, max(texture2D(uMap, uv + d).a,
                     texture2D(uMap, uv + d * 0.5).a));
    }
    return m;
  }
  void main() {
    vec4 c = texture2D(uMap, vUv);
    c.rgb *= uBrightness;
    c.rgb = (c.rgb - 0.5) * uContrast + 0.5;
    c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / uGamma));
    c.rgb = clamp(c.rgb, 0.0, 1.0);
    float a = uAlpha;
    float on = 1.0;
    if (uMaskOn == 1) {
      // the dots' own canonical projection (_blockKeys): house distance,
      // perspective divide, clamp into the frame
      float w = ${D.toFixed(2)} / max(0.5, ${D.toFixed(2)} - vWorld.z);
      vec2 s = vWorld.xy * w;
      vec2 t = clamp(vec2((s.x + uHalf.x) / (2.0 * uHalf.x),
                          (uHalf.y - s.y) / (2.0 * uHalf.y)), 0.0, 1.0);
      float k = texture2D(uKeys, vec2(
        (floor(t.x * uGrid.x) + 0.5) / uGrid.x,
        (floor(t.y * uGrid.y) + 0.5) / uGrid.y)).r;
      float local = (uProg - k * uSpread) / max(1e-4, 1.0 - uSpread);
      on = step(1e-4, local);             // the print pop, tile by tile
      a *= uFlip > 0.5 ? 1.0 - on : on;   // exits un-print in the same order
    }
    if (uForceOpaque > 0.5 && on > 0.5 && uFlip < 0.5) {
      float ma = max(uBleed.x, uBleed.y) > 0.001 ? bleedAlpha(vUv, uBleed) : c.a;
      gl_FragColor = vec4(mix(uBg, c.rgb, c.a), mix(c.a * a, uAlpha, ma));
    } else {
      gl_FragColor = vec4(c.rgb, c.a * a);
    }
  }
`;

export class PhotoOverlay {
  constructor() {
    this.scene = new THREE.Scene();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uMap: { value: null },
        uAlpha: { value: 0 },
        uMaskOn: { value: 0 },
        uKeys: { value: null },
        uHalf: { value: new THREE.Vector2(1, 1) },
        uGrid: { value: new THREE.Vector2(2, 2) },
        uProg: { value: 1 },
        uSpread: { value: 0.53 },
        uFlip: { value: 0 },
        uBrightness: { value: 1 },
        uContrast: { value: 1 },
        uGamma: { value: 1 },
        uBg: { value: new THREE.Color(0x000000) },
        uForceOpaque: { value: 0 },
        uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
        uBleed: { value: new THREE.Vector2(0, 0) },
      },
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this._tex = new WeakMap(); // mode -> CanvasTexture
    this._ktex = new WeakMap(); // keys array -> DataTexture
    this._gridKey = null; // cache: one grid at a time
    this._grid = null;
  }

  /** The terminal's OWN glyph grid, reused as a reveal mask — ONE continuous
      top-to-bottom sweep whose front THICKENS as it advances: a row-band
      reveals cell by cell, the next in slightly bigger blocks, up to 5's —
      the image finishes faster than it starts. Within a band, block-rows
      alternate sweep direction — left-to-right, then right-to-left, then
      left-to-right — a bidirectional print head rather than a same-way
      raster scan every line. A glyph cell is a tall
      rectangle in actual pixels (8x16 house default), not a square, so a
      block that reads as square on screen needs MORE cells wide than tall;
      `cellAspect` (cellH / cellW) is how much more — width stays `stage+1`,
      height is that divided down by the aspect and rounded, never below 1.
      `weights` (5 numbers, one per block size) sets each band's share of
      BOTH the rows and the reveal TIME — equal weights split evenly; a
      bigger weight on 1x1 gives fine detail more screen and more time
      before the sweep thickens past it. `stagger` softens each block's
      place within its own band toward a hash — 0 keeps the strict sweep, 1
      scatters it band-locally (the top-to-bottom, thickening front still
      holds). The seam BETWEEN bands is a straight ruled line by
      construction (a row cutoff) — the base print effect, a plain step
      where one block size gives way to the next. `wobble` (0 by default,
      off) feathers it instead: each of the 4 internal boundaries wiggles
      independently per strip of columns (a low-frequency sine, no two
      boundaries in phase), scaled by the knob — 0 the ruler-straight seam
      above, 1 the full organic wobble. `overlap` softens the OTHER half of
      the step — the hand-off in TIME: 0 keeps each band's window sealed
      (the next size waits for every cell of the last to finish), 1
      stretches every window by its own full width each way, so a band
      starts well before its predecessor is done and finishes well after its
      successor has begun. Same house frame math as the dots' own mosaic
      (_blockKeys) — the grid maps 1:1 onto the comp. */
  _cellGrid(
    cols,
    rows,
    fov,
    aspect,
    stagger = 0,
    weights = null,
    overlap = 0,
    cellAspect = 2,
    wobble = 0,
  ) {
    const w = weights || [1, 1, 1, 1, 1];
    const ca = cellAspect > 0 ? cellAspect : 2;
    const key = `${cols}x${rows}@${fov}:${aspect}:${stagger}:${w.join(",")}:${overlap}:${ca}:${wobble}`;
    if (this._gridKey === key) return this._grid;
    const D = 3.55;
    const hh = Math.tan(((fov || 40) * Math.PI) / 360) * D;
    const hw = hh * (aspect > 0 ? aspect : 1);
    const keys = new Float32Array(cols * rows);
    const STAGES = 5;
    const BLOCK_W = [1, 2, 3, 4, 5];
    const BLOCK_H = BLOCK_W.map((wd) => Math.max(1, Math.round(wd / ca)));
    const total = w.reduce((s, x) => s + Math.max(0.001, x), 0);
    // the UN-jittered boundary rows/windows — boundary[b] is the line
    // between stage b-1 and stage b (boundary[0] = top edge, [STAGES] =
    // bottom edge, both left flat: only the 4 INTERNAL ones wiggle)
    const rowBoundary = [0],
      winBoundary = [0];
    for (let s = 0; s < STAGES; s++) {
      const share = Math.max(0.001, w[s]) / total;
      rowBoundary.push(rowBoundary[s] + rows * share);
      winBoundary.push(winBoundary[s] + share);
    }
    rowBoundary[STAGES] = rows; // exact edge, no rounding drift
    const STRIP_W = 4; // column granularity of the wobble
    const FEATHER = rows * 0.035 * wobble;
    const numStrips = Math.max(1, Math.ceil(cols / STRIP_W));
    // both sides of a shared boundary call this with the SAME (sx, b) — the
    // wobble lines up exactly, no gap or overlap between adjacent bands
    const wobbleAt = (sx, b) => Math.sin(sx * 0.9 + b * 2.1) * FEATHER;
    for (let stage = 0; stage < STAGES; stage++) {
      const Kw = BLOCK_W[stage],
        Kh = BLOCK_H[stage];
      const bandW = winBoundary[stage + 1] - winBoundary[stage];
      // clamped at 0/1: only the 4 internal boundaries stretch, the sweep
      // still starts at 0 and finishes at 1
      const winLo = Math.max(0, winBoundary[stage] - overlap * bandW);
      const winHi = Math.min(1, winBoundary[stage + 1] + overlap * bandW);
      // the GLOBAL block grid for this stage (nominal, un-wobbled rows) —
      // order rides THIS, one snake across the full width, rather than
      // numStrips separate ones each restarting their own local order
      const stageR0 = rowBoundary[stage];
      const blocksY = Math.max(
        1,
        Math.ceil((rowBoundary[stage + 1] - stageR0) / Kh),
      );
      const blocksX = Math.max(1, Math.ceil(cols / Kw));
      const last = Math.max(1, blocksY * blocksX - 1);
      for (let sx = 0; sx < numStrips; sx++) {
        const cx0 = sx * STRIP_W,
          cx1 = Math.min(cols, cx0 + STRIP_W);
        const jTop = stage === 0 ? 0 : wobbleAt(sx, stage);
        const jBot = stage === STAGES - 1 ? 0 : wobbleAt(sx, stage + 1);
        const r0 = Math.max(0, Math.round(rowBoundary[stage] + jTop));
        const r1 = Math.min(rows, Math.round(rowBoundary[stage + 1] + jBot));
        if (r0 >= r1) continue; // this strip's band rounded to nothing
        for (let cy = r0; cy < r1; cy++) {
          const by = Math.max(
            0,
            Math.min(blocksY - 1, Math.floor((cy - stageR0) / Kh)),
          );
          // bidirectional print head: even block-rows sweep left->right,
          // odd ones right->left — the "gauche droite en bas" typewriter
          // feel, deterministic (no curve, no randomness of its own)
          const flip = by % 2 === 1;
          for (let cx = cx0; cx < cx1; cx++) {
            const bx = Math.min(blocksX - 1, Math.floor(cx / Kw));
            const bxOrdered = flip ? blocksX - 1 - bx : bx;
            const order = (by * blocksX + bxOrdered) / last;
            const rnd = hash01(by * 977 + bx * 131 + stage * 104729);
            const local =
              stagger > 0 ? order * (1 - stagger) + rnd * stagger : order;
            keys[cy * cols + cx] = winLo + local * (winHi - winLo);
          }
        }
      }
    }
    this._gridKey = key;
    this._grid = { cols, rows, mxx: hw, mxy: hh, keys };
    return this._grid;
  }

  /** ONE glyph cell, measured in the raster's own pixels — the unit the bleed
      has to work in, since what it hides is a cell-sized overhang.

      A cell is a fixed size in COMP px (compW / termCols), so the raster
      equivalent has to be re-derived every draw: it moves with the garment's
      raster resolution, its ink extent, the size param, the comp aspect and
      the scene's own cellW / cellH. That is exactly why a hand-set radius in
      raster px could never survive a garment swap.

      compW cancels out of the derivation — a cell is 2*hw/cols WORLD units
      wide, and the figure carries `radius` raster px per `sz` world units. */
  _cellInRaster(frame, map, grp9) {
    const hh = Math.tan(((frame.fov || 40) * Math.PI) / 360) * D;
    const hw = hh * (frame.aspect > 0 ? frame.aspect : 1);
    // grp9's columns are a rotation uniformly scaled by the size param, so any
    // column norm recovers it — tilt, spin and the whip's rotExtra leave it be
    const sz = Math.hypot(grp9[0], grp9[1], grp9[2]) || 1;
    const perWorld = map.radius / sz;              // raster px per world unit
    const cols = Math.max(1, frame.cols || 2);
    const rows = Math.max(1, frame.rows || 2);
    return [((2 * hw) / cols) * perWorld, ((2 * hh) / rows) * perWorld];
  }

  /** Per-frame decision: how visible the photo is, how dissolved the dots
      are, and whether the mosaic tile mask applies. Call before the
      particle pass (fade is a particle uniform), draw after the terminal
      pass. */
  evaluate(engine) {
    let mode = engine.modeB,
      flip = false;
    if (
      (!mode || !mode.params || !mode.params.photo) &&
      engine.modeA &&
      engine.modeA.params &&
      engine.modeA.params.photo
    ) {
      mode = engine.modeA; // the photo clip is EXITING
      flip = true;
    }
    if (
      !mode ||
      !mode.params ||
      !mode.params.photo ||
      !mode.photo ||
      !mode.photo.map
    ) {
      return { alpha: 0, fade: 0, mask: false, flip: false };
    }
    const PV = paramValues(mode);
    const p = Math.min(1, Math.max(0, PV.photo ?? 0));

    // a dedicated cell-by-cell build, paced by clipT (seconds since this
    // clip's arrival started) rather than the transition's own progress —
    // the photo prints over the terminal's OWN grid, one cell at a time,
    // and can run alongside the flight instead of waiting for it to land.
    // No dotFade snap at the end: forceOpaque (below, in draw/_render) makes
    // each cell retire its trace itself, the moment IT pops — never a global
    // dissolve, and never a gap where a still-hidden cell shows nothing.
    if (PV.cellReveal > 0 && !flip) {
      const since = (engine.clipT || 0) - (PV.cellDelay || 0);
      const prog = Math.min(1, Math.max(0, since / PV.cellReveal));
      const weights = [
        PV.cell1x1,
        PV.cell2x2,
        PV.cell3x3,
        PV.cell4x4,
        PV.cell5x5,
      ].map((v) => v ?? 1);
      const grid = this._cellGrid(
        engine.termCols || 2,
        engine.termRows || 2,
        engine.frameFov,
        engine.frameAspect,
        PV.cellStagger || 0,
        weights,
        PV.cellOverlap || 0,
        engine.termCellAspect || 2,
        PV.cellWobble || 0,
      );
      return {
        alpha: p,
        dotFade: 0,
        mask: true,
        flip: false,
        grid,
        prog,
        spread: 0.98,
        forceOpaque: true,
      };
    }

    const mosaic = engine.staggerAxis >= 4 && engine.blockDebug;
    if (flip) {
      // leaving a photo clip: the photograph dissolves across the WHOLE
      // flight (an early pop reads as the asset just blinking off), while
      // undeparted dots release from hiding in step with it; a mosaic
      // un-prints it tile by tile instead
      const g = 1 - Math.min(1, Math.max(0, engine.prog));
      const out = p * g * g * (3 - 2 * g);
      return { alpha: mosaic ? p : out, fade: 0, mask: !!mosaic, flip };
    }
    const g = Math.min(1, Math.max(0, (engine.prog - 0.86) / 0.12));
    const settled = p * g * g * (3 - 2 * g);
    // mosaic: the tiles ARE the arrival — full param alpha, masked per
    // fragment. otherwise: the smooth settled gate. dots always dissolve
    // on the settled gate, so mid-flight formations keep flying.
    return { alpha: mosaic ? p : settled, fade: settled, mask: !!mosaic, flip };
  }

  /** A photo-lane clip: drawn at the image mode's OWN placement
      (size / spin / tilt params — the same matrix its dots would ride),
      independent of what the particle engine is showing. */
  drawFree(renderer, camera, mode, alpha, t, mask = null) {
    const P = paramValues(mode);
    const cx2 = Math.cos(P.tilt || 0),
      sx2 = Math.sin(P.tilt || 0);
    const cy2 = Math.cos(t * (P.spin || 0) || 0),
      sy2 = Math.sin(t * (P.spin || 0) || 0);
    // rotX(tilt) * rotY(spin t), column-major, scaled — vectorImport's update
    const rx = [1, 0, 0, 0, cx2, sx2, 0, -sx2, cx2];
    const ry = [cy2, 0, -sy2, 0, 1, 0, sy2, 0, cy2];
    const m = new Array(9);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++)
        m[c * 3 + r] =
          rx[r] * ry[c * 3] +
          rx[3 + r] * ry[c * 3 + 1] +
          rx[6 + r] * ry[c * 3 + 2];
    const sz = (P.size || 1) * (mode._sizeCal || 1);
    return this._render(
      renderer,
      camera,
      mode,
      m.map((v) => v * sz),
      alpha,
      mask,
      mask ? mask.prog : 1,
      mask ? mask.spread : 0.53,
    );
  }

  draw(renderer, camera, engine, state) {
    const mode = state.flip ? engine.modeA : engine.modeB;
    // the whip rotates the whole composition — the registered photo must
    // turn with its dots (an exiting photo rides the A slot's transform)
    let g = state.flip ? engine.slotA.grp : engine.slotB.grp;
    const ex = engine.rotExtra || 0;
    if (Math.abs(ex) > 1e-5) {
      const c = Math.cos(ex),
        s = Math.sin(ex);
      const r = new Float32Array(9);
      for (let k = 0; k < 3; k++) {
        const x = g[k * 3],
          y = g[k * 3 + 1],
          z = g[k * 3 + 2];
        r[k * 3] = c * x + s * z;
        r[k * 3 + 1] = y;
        r[k * 3 + 2] = -s * x + c * z;
      }
      g = r;
    }
    // a cell-reveal carries its OWN grid + pacing (the terminal's glyph grid,
    // paced by holdT) — everything else keeps riding the transition's mosaic
    const maskDebug = state.grid || (state.mask ? engine.blockDebug : null);
    const prog = state.grid ? state.prog : engine.prog;
    const spread = state.grid ? state.spread : engine.spread;
    return this._render(
      renderer,
      camera,
      mode,
      g,
      state.alpha,
      maskDebug,
      prog,
      spread,
      state.flip,
      !!state.forceOpaque,
      engine.compBg,
      { fov: engine.frameFov, aspect: engine.frameAspect,
        cols: engine.termCols, rows: engine.termRows },
    );
  }

  _render(
    renderer,
    camera,
    mode,
    grp9,
    alpha,
    maskDebug,
    prog,
    spread,
    flip = false,
    forceOpaque = false,
    bg = "#000000",
    frame = null,   // absent on the photo lane, which never clears opaquely
  ) {
    const ph = mode && mode.photo;
    if (!ph || !ph.map || !ph.raster || alpha <= 0.001) return false;
    let tex = this._tex.get(mode);
    if (!tex) {
      tex = new THREE.CanvasTexture(ph.raster);
      // NOT SRGBColorSpace: that tag uploads as SRGB8_ALPHA8 and the GPU
      // linearises every sample, but outputColorSpace is linear and this
      // shader writes gl_FragColor raw — nothing ever re-encodes, so the
      // decode lands as a second gamma, ~pow(2.2) too dark. ColorManagement
      // .enabled does not gate it: it guards Color, not the internal format
      tex.colorSpace = THREE.NoColorSpace;
      // no mipmaps: a generated chain averages these sRGB bytes as if they
      // were linear — every level down crushes shadows harder, and the raster
      // is drawn flat, never at a glancing angle, so there is nothing a mip
      // chain buys here anyway
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      this._tex.set(mode, tex);
    }
    const u = this.material.uniforms;
    u.uMap.value = tex;
    u.uAlpha.value = Math.min(1, alpha);
    u.uMaskOn.value = maskDebug ? 1 : 0;
    u.uFlip.value = flip ? 1 : 0;
    const PV = paramValues(mode);
    u.uBrightness.value = PV.photoBrightness ?? 1;
    u.uContrast.value = PV.photoContrast ?? 1;
    u.uGamma.value = PV.photoGamma ?? 1;
    u.uForceOpaque.value = forceOpaque ? 1 : 0;
    // cellBleed is a count of glyph cells; the cell's raster size is the frame
    // geometry's to say, and it changes every time anything upstream does
    const cells = frame ? Math.max(0, PV.cellBleed ?? 0) : 0;
    if (cells > 0) {
      const [bx, by] = this._cellInRaster(frame, ph.map, grp9);
      u.uBleed.value.set(cells * bx, cells * by);
    } else {
      u.uBleed.value.set(0, 0);
    }
    u.uTexel.value.set(1 / ph.raster.width, 1 / ph.raster.height);
    u.uBg.value.set(bg || "#000000");
    if (maskDebug) {
      const d = maskDebug;
      let kt = this._ktex.get(d.keys);
      if (!kt) {
        kt = new THREE.DataTexture(
          Float32Array.from(d.keys),
          d.cols,
          d.rows,
          THREE.RedFormat,
          THREE.FloatType,
        );
        kt.magFilter = THREE.NearestFilter;
        kt.minFilter = THREE.NearestFilter;
        kt.needsUpdate = true;
        this._ktex.set(d.keys, kt);
      }
      u.uKeys.value = kt;
      u.uHalf.value.set(d.mxx, d.mxy);
      u.uGrid.value.set(d.cols, d.rows);
      u.uProg.value = prog;
      u.uSpread.value = spread;
    }
    // pixel rect -> the dots' ink-extent frame, then the dots' own group
    // matrix (column-major 3x3 straight off the engine slot)
    const { w, h, cx, cy, radius } = ph.map;
    const g = grp9;
    const sx = w / radius,
      sy = h / radius;
    const ox = (w / 2 - cx) / radius,
      oy = (-h / 2 - cy) / radius;
    this.mesh.matrix.set(
      g[0] * sx,
      g[3] * sy,
      g[6],
      ox * g[0] + oy * g[3],
      g[1] * sx,
      g[4] * sy,
      g[7],
      ox * g[1] + oy * g[4],
      g[2] * sx,
      g[5] * sy,
      g[8],
      ox * g[2] + oy * g[5],
      0,
      0,
      0,
      1,
    );
    renderer.setRenderTarget(null);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = auto;
    return true;
  }
}
