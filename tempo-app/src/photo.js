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
  void main() {
    vec4 c = texture2D(uMap, vUv);
    float a = uAlpha;
    if (uMaskOn == 1) {
      // the dots' own canonical projection (_blockKeys): house distance,
      // perspective divide, clamp into the frame
      float w = 3.55 / max(0.5, 3.55 - vWorld.z);
      vec2 s = vWorld.xy * w;
      vec2 t = clamp(vec2((s.x + uHalf.x) / (2.0 * uHalf.x),
                          (uHalf.y - s.y) / (2.0 * uHalf.y)), 0.0, 1.0);
      float k = texture2D(uKeys, vec2(
        (floor(t.x * uGrid.x) + 0.5) / uGrid.x,
        (floor(t.y * uGrid.y) + 0.5) / uGrid.y)).r;
      float local = (uProg - k * uSpread) / max(1e-4, 1.0 - uSpread);
      float on = step(1e-4, local);      // the print pop, tile by tile
      a *= uFlip > 0.5 ? 1.0 - on : on;  // exits un-print in the same order
    }
    gl_FragColor = vec4(c.rgb, c.a * a);
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
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this._tex = new WeakMap();               // mode -> CanvasTexture
    this._ktex = new WeakMap();              // keys array -> DataTexture
  }

  /** Per-frame decision: how visible the photo is, how dissolved the dots
      are, and whether the mosaic tile mask applies. Call before the
      particle pass (fade is a particle uniform), draw after the terminal
      pass. */
  evaluate(engine) {
    let mode = engine.modeB, flip = false;
    if ((!mode || !mode.params || !mode.params.photo) &&
        engine.modeA && engine.modeA.params && engine.modeA.params.photo) {
      mode = engine.modeA;                     // the photo clip is EXITING
      flip = true;
    }
    if (!mode || !mode.params || !mode.params.photo || !mode.photo ||
        !mode.photo.map) {
      return { alpha: 0, fade: 0, mask: false, flip: false };
    }
    const p = Math.min(1, Math.max(0, paramValues(mode).photo ?? 0));
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
    const cx2 = Math.cos(P.tilt || 0), sx2 = Math.sin(P.tilt || 0);
    const cy2 = Math.cos((t * (P.spin || 0)) || 0), sy2 = Math.sin((t * (P.spin || 0)) || 0);
    // rotX(tilt) * rotY(spin t), column-major, scaled — vectorImport's update
    const rx = [1, 0, 0, 0, cx2, sx2, 0, -sx2, cx2];
    const ry = [cy2, 0, -sy2, 0, 1, 0, sy2, 0, cy2];
    const m = new Array(9);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++)
        m[c * 3 + r] = rx[r] * ry[c * 3] + rx[3 + r] * ry[c * 3 + 1] + rx[6 + r] * ry[c * 3 + 2];
    const sz = (P.size || 1) * (mode._sizeCal || 1);
    return this._render(renderer, camera, mode, m.map((v) => v * sz),
                        alpha, mask, mask ? mask.prog : 1,
                        mask ? mask.spread : 0.53);
  }

  draw(renderer, camera, engine, state) {
    const mode = state.flip ? engine.modeA : engine.modeB;
    // the whip rotates the whole composition — the registered photo must
    // turn with its dots (an exiting photo rides the A slot's transform)
    let g = state.flip ? engine.slotA.grp : engine.slotB.grp;
    const ex = engine.rotExtra || 0;
    if (Math.abs(ex) > 1e-5) {
      const c = Math.cos(ex), s = Math.sin(ex);
      const r = new Float32Array(9);
      for (let k = 0; k < 3; k++) {
        const x = g[k * 3], y = g[k * 3 + 1], z = g[k * 3 + 2];
        r[k * 3] = c * x + s * z;
        r[k * 3 + 1] = y;
        r[k * 3 + 2] = -s * x + c * z;
      }
      g = r;
    }
    return this._render(renderer, camera, mode, g, state.alpha,
                        state.mask ? engine.blockDebug : null,
                        engine.prog, engine.spread, state.flip);
  }

  _render(renderer, camera, mode, grp9, alpha, maskDebug, prog, spread, flip = false) {
    const ph = mode && mode.photo;
    if (!ph || !ph.map || !ph.raster || alpha <= 0.001) return false;
    let tex = this._tex.get(mode);
    if (!tex) {
      tex = new THREE.CanvasTexture(ph.raster);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this._tex.set(mode, tex);
    }
    const u = this.material.uniforms;
    u.uMap.value = tex;
    u.uAlpha.value = Math.min(1, alpha);
    u.uMaskOn.value = maskDebug ? 1 : 0;
    u.uFlip.value = flip ? 1 : 0;
    if (maskDebug) {
      const d = maskDebug;
      let kt = this._ktex.get(d.keys);
      if (!kt) {
        kt = new THREE.DataTexture(Float32Array.from(d.keys), d.cols, d.rows,
                                   THREE.RedFormat, THREE.FloatType);
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
    const sx = w / radius, sy = h / radius;
    const ox = (w / 2 - cx) / radius, oy = (-h / 2 - cy) / radius;
    this.mesh.matrix.set(
      g[0] * sx, g[3] * sy, g[6], ox * g[0] + oy * g[3],
      g[1] * sx, g[4] * sy, g[7], ox * g[1] + oy * g[4],
      g[2] * sx, g[5] * sy, g[8], ox * g[2] + oy * g[5],
      0, 0, 0, 1);
    renderer.setRenderTarget(null);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = auto;
    return true;
  }
}
