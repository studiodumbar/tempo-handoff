// The modes — each one is a sketch from the mpp-terminal codebase, expressed as
// a TARGET LAYOUT for the shared particle pool plus a tiny per-frame animator.
//
// A mode is:
//   gen(N, P)    -> { pos: Float32Array(3N), aux: Float32Array(N), bri: Float32Array(N) }
//                   the layout every particle flies to (world units, body ~ radius 1)
//   update(S, P, t) -> writes this frame's group matrices / brightness / params
//                   into slot S (S.grp: 4 column-major mat3s, S.gbri: vec4,
//                   S.prm: vec4). Rigid motion lives in the matrices; only
//                   non-rigid fields (scan bars, pulse bands, column tallies)
//                   are evaluated in the vertex shader, selected by mode id.
//   params       -> the tweakable metrics surfaced in the panel
//
// Because every mode is just "N particles + where they should be", transitions
// between ANY two modes are the same operation: rank-matched morphing. Nothing
// here knows how to transition — that is the particle engine's job.

import { expoInOut, smooth, bezierEase, snapEase } from "./easing.js";

const TAU = Math.PI * 2;


// Depth-blocks layout params. Declared up here for the same reason as the
// lists above: the MODES array literal below references it while it is
// still being built, and a const declared later is in its temporal dead
// zone at that point — an import-time crash, not a lazy lookup.
const DEPTH_BLOCKS_REGEN = ["slices", "around", "bore", "twist", "patch"];
const STAR_LIFE_REGEN = ["rays", "len", "fan", "cone", "vary", "seed",
                         "angle", "stations", "patch", "chip lines"];


// The portrait family's design rect: 9:16, sized so a portrait (1080 x 1920)
// window at the default camera (fov 42 at z 3.55 -> half-height 1.363,
// half-width 0.766) holds it with margin.
const PORT_W = 0.62, PORT_H = (PORT_W * 16) / 9;

// ---- tiny column-major mat3 helpers ---------------------------------------
export function matIdent(o, k) {
  o.set([1, 0, 0, 0, 1, 0, 0, 0, 1], k * 9);
}
export function matRotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}
export function matRotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}
export function matRotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}
export function matMul(a, b) {  // a * b, both column-major
  const o = new Array(9);
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++)
      o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}
function matScale(m, s) {
  return m.map((v) => v * s);
}
function matScaleY(m, sy) { // squash y AFTER the rotation (rows scale)
  const o = m.slice();
  o[1] *= sy; o[4] *= sy; o[7] *= sy;
  return o;
}
export function put(o, k, m) {
  o.set(m, k * 9);
}

// ---- generation helpers -----------------------------------------------------
function hash01(i) {
  let h = (i * 2654435761) >>> 0;
  h ^= h >> 13; h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/** Distribute N across weighted features, exactly. */
function distribute(N, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((N * w) / sum));
  let used = out.reduce((a, b) => a + b, 0);
  for (let i = 0; used < N; i = (i + 1) % out.length) { out[i]++; used++; }
  return out;
}

/** Layout builder: push slots, then stack the pool onto them round-robin. */
class Layout {
  constructor() { this.slots = []; }
  add(x, y, z, aux = 0, bri = 1) { this.slots.push(x, y, z, aux, bri); }
  /** Spread N particles over the slots; co-located extras split brightness so
      the additive render keeps roughly the intended luma per slot. */
  bake(N) {
    const ns = this.slots.length / 5;
    const pos = new Float32Array(3 * N);
    const aux = new Float32Array(N);
    const bri = new Float32Array(N);
    const per = Math.max(1, Math.floor(N / ns));
    for (let i = 0; i < N; i++) {
      const s = i % ns;
      pos[3 * i] = this.slots[5 * s];
      pos[3 * i + 1] = this.slots[5 * s + 1];
      pos[3 * i + 2] = this.slots[5 * s + 2];
      aux[i] = this.slots[5 * s + 3];
      bri[i] = this.slots[5 * s + 4] / Math.sqrt(per);
    }
    return { pos, aux, bri };
  }
}

/** Unit-sphere lat/long shading layout (the signature body). */
function sphereLayout(N, briVal = 1.0) {
  const L = new Layout();
  const NLAT = 44;
  // weights ~ sin(theta) so rings share the pool like the terminal sphere
  const w = [];
  for (let li = 1; li < NLAT; li++) w.push(Math.sin((Math.PI * li) / NLAT));
  const counts = distribute(Math.min(N, 16000), w);
  for (let li = 1; li < NLAT; li++) {
    const th = (Math.PI * li) / NLAT;
    const st = Math.sin(th), ct = Math.cos(th);
    const n = Math.max(4, counts[li - 1]);
    for (let j = 0; j < n; j++) {
      const ph = (TAU * j) / n;
      L.add(st * Math.cos(ph), ct, st * Math.sin(ph), 0, briVal);
    }
  }
  return L;
}

/** Walk a rounded-rectangle outline (half-extents hw/hh, corner radius rc)
    with `n` evenly spaced dots: cb(x, y, alongFraction). */
function roundedRectWalk(hw, hh, rc, n, cb) {
  const lw = 2 * (hw - rc), lh = 2 * (hh - rc), qc = (Math.PI / 2) * rc;
  const segs = [
    { len: lw, at: (s) => [-(hw - rc) + s, -hh] },                       // bottom
    { len: qc, at: (s) => arc(hw - rc, -(hh - rc), -Math.PI / 2 + s / rc) },
    { len: lh, at: (s) => [hw, -(hh - rc) + s] },                        // right
    { len: qc, at: (s) => arc(hw - rc, hh - rc, s / rc) },
    { len: lw, at: (s) => [hw - rc - s, hh] },                           // top
    { len: qc, at: (s) => arc(-(hw - rc), hh - rc, Math.PI / 2 + s / rc) },
    { len: lh, at: (s) => [-hw, hh - rc - s] },                          // left
    { len: qc, at: (s) => arc(-(hw - rc), -(hh - rc), Math.PI + s / rc) },
  ];
  function arc(cx, cy, a) { return [cx + rc * Math.cos(a), cy + rc * Math.sin(a)]; }
  const perim = segs.reduce((a, s) => a + s.len, 0);
  for (let i = 0; i < n; i++) {
    let s = (perim * i) / n;
    const frac = i / n;
    for (const seg of segs) {
      if (s <= seg.len) { const [x, y] = seg.at(s); cb(x, y, frac); break; }
      s -= seg.len;
    }
  }
}

/** The measured reference table: visit every dot slot as
    cb(x, y, ruleIndex, alongFraction). 12 rules: 8 rows then 4 columns. */
function eachTableDot(P, cb) {
  const H_YS = [0.1659, 0.1846, 0.3793, 0.3979, 0.5932, 0.6113, 0.8064, 0.8267];
  const V_XS = [0.0, 0.0076, 0.6864, 0.8463];
  const H_X0 = 0.016;
  const W = P.width, H = W / 2.9646;
  const gx = (u) => -W / 2 + u * W;
  const gy = (v) => H / 2 - v * H;
  let rule = 0;
  for (const v of H_YS) {
    const n = Math.max(2, Math.round(((1 - H_X0) * W) / P.gap));
    for (let i = 0; i <= n; i++)
      cb(gx(H_X0 + ((1 - H_X0) * i) / n), gy(v), rule, i / n);
    rule++;
  }
  for (const u of V_XS) {
    const n = Math.max(2, Math.round(H / P.gap));
    for (let i = 0; i <= n; i++) cb(gx(u), gy(i / n), rule, i / n);
    rule++;
  }
}

// ===========================================================================
// MODE DEFINITIONS
// ===========================================================================
export const MODES = [

  // -- 0 · SPHERE — the shaded idle sphere -----------------------------------
  {
    key: "sphere", label: "sphere", statusName: "IDLE", id: 0, regen: [],
    params: {
      spin:    { value: 0, min: -1.5, max: 1.5, step: 0.01 },
      tilt:    { value: 0.50, min: 0.0, max: 1.57, step: 0.01 },
      breathe: { value: 0.030, min: 0, max: 0.2, step: 0.005 },
      rate:    { value: 0.8, min: 0, max: 4, step: 0.05 },
    },
    gen(N) { return sphereLayout(N, 1.0).bake(N); },
    update(S, P, t) {
      const s = 1 + P.breathe * Math.sin(t * P.rate);
      put(S.grp, 0, matScale(matMul(matRotX(P.tilt), matRotY(t * P.spin)), s));
      S.gbri.set([1, 1, 1, 1]);
    },
  },

  // -- 1 · PULSE — pole pulse loading ----------------------------------------
  {
    key: "pulse", label: "pulse", statusName: "PROCESSING", id: 2, regen: [],
    params: {
      cycle:  { value: 1.9, min: 0.6, max: 5, step: 0.05 },
      bright: { value: 1.9, min: 0, max: 4, step: 0.05 },
      width:  { value: 0.16, min: 0.04, max: 0.6, step: 0.01 },
      spin:   { value: 0, min: -1, max: 1, step: 0.01 },
      disp:   { value: 0.05, min: 0, max: 0.25, step: 0.005 },
    },
    gen(N) { return sphereLayout(N, 0.62).bake(N); },
    update(S, P, t) {
      const TRAVEL = 0.82;
      const u = (t / P.cycle) % 1;
      const thetaP = smooth(Math.min(1, u / TRAVEL)) * (Math.PI / 2);
      const env = smooth(u / 0.12) * (1 - smooth((u - TRAVEL) / (1 - TRAVEL)));
      const conv = smooth((thetaP / (Math.PI / 2) - 0.72) / 0.28) * env;
      put(S.grp, 0, matRotY(t * P.spin));
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([thetaP, env * P.bright, 1 / (P.width * P.width),
                 conv * P.bright * 0.8]);
      S.prm2.set([P.disp, 0, 0, 0]);
    },
  },

  // -- 2 · GYRO — tumbling great rings (journey_board's select) -------------
  {
    key: "gyro", label: "gyro", statusName: "SELECTING", id: 0, regen: ["rings","radius"],
    params: {
      speed: { value: 0, min: 0, max: 2, step: 0.01 },
      radius:{ value: 0.95, min: 0.4, max: 1.3, step: 0.01 },
      rings: { value: 3, min: 2, max: 4, step: 1 },
    },
    gen(N, P) {
      const L = new Layout();
      const nr = Math.round(P.rings);
      const counts = distribute(N > 4000 ? 3600 : N, new Array(nr).fill(1));
      for (let r = 0; r < nr; r++) {
        const n = counts[r];
        for (let j = 0; j < n; j++) {
          const a = (TAU * j) / n;
          L.add(Math.cos(a) * P.radius, Math.sin(a) * P.radius, 0, r, 1.05);
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      for (let r = 0; r < 4; r++) {
        put(S.grp, r, matMul(matRotY(t * (0.4 + 0.22 * r) * P.speed * 2 + r * 1.1),
                             matRotX(t * 0.3 * P.speed * 2 + r * 2.0)));
      }
      S.gbri.set([1, 1, 1, 1]);
    },
  },


  // -- 4 · CUBE — the tumbling wireframe (journey_board's refine) -----------
  {
    key: "cube", label: "cube", statusName: "REFINING", id: 0, regen: ["size"],
    params: {
      tumble: { value: 0, min: 0, max: 2, step: 0.01 },
      size:   { value: 0.72, min: 0.3, max: 1.1, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      const s = P.size;
      const V = [];
      for (let i = 0; i < 8; i++)
        V.push([(i & 4 ? 1 : -1) * s, (i & 2 ? 1 : -1) * s, (i & 1 ? 1 : -1) * s]);
      const E = [];
      for (let i = 0; i < 8; i++)
        for (const b of [4, 2, 1]) if (!(i & b)) E.push([i, i | b]);
      const per = Math.floor(Math.min(N, 2600) / E.length);
      for (const [a, b] of E) {
        for (let k = 0; k < per; k++) {
          const e = k / (per - 1 || 1);
          L.add(V[a][0] + (V[b][0] - V[a][0]) * e,
                V[a][1] + (V[b][1] - V[a][1]) * e,
                V[a][2] + (V[b][2] - V[a][2]) * e, 0, 1.0);
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      put(S.grp, 0, matMul(matRotX(t * 0.64 * P.tumble), matRotY(t * P.tumble)));
      S.gbri.set([1, 1, 1, 1]);
    },
  },

  // -- 5 · TABLE — the measured dotted table, faithful to its grid -----------
  {
    key: "table", label: "table", statusName: "DEFINING", id: 1, regen: ["gap","width"],
    params: {
      gap:      { value: 0.021, min: 0.008, max: 0.06, step: 0.001 },
      width:    { value: 2.55, min: 1.4, max: 3.4, step: 0.05 },
      scanAmp:  { value: 1.3, min: 0, max: 3, step: 0.05 },
      scanSpeed:{ value: 0.22, min: 0, max: 1, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      eachTableDot(P, (x, y) => L.add(x, y, 0, 0, 1.25));
      return L.bake(N);
    },
    update(S, P, t) {
      for (let k = 0; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      const W = P.width;
      const u = (t * P.scanSpeed) % 1;
      const scanX = -W / 2 + smooth(u) * W;
      S.prm.set([scanX, 1 / (0.12 * 0.12), P.scanAmp, 0.8]);
    },
  },

  // -- 7 · ZOOM — the fractal anchor-grid dive (review_sketches' section) ----
  {
    key: "zoom", label: "zoom", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.0, min: 1.5, max: 10, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) {
      const L = new Layout();
      const E = 2.75;
      for (let lv = 0; lv < 4; lv++) {          // level lv -> group lv
        const p = P.pitch * 2 ** (lv - 1);
        const kmax = Math.floor(E / p);
        const gap = p / 6;
        for (let k = -kmax; k <= kmax; k++) {   // dotted lines both ways
          for (let d = -E; d <= E; d += gap) {
            L.add(k * p, d, 0, lv, 0.5);
            L.add(d, k * p, 0, lv, 0.5);
          }
        }
        for (let i = -kmax; i <= kmax; i++)     // block anchors
          for (let j = -kmax; j <= kmax; j++)
            L.add(i * p, j * p, 0, lv, P.anchors);
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const u = (t / P.cycle) % 1;
      const zoom = 2 ** expoInOut(u);
      const win = (x, a, b) => {
        const y = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return y * y * (3 - 2 * y);
      };
      for (let lv = 0; lv < 4; lv++) {
        put(S.grp, lv, matScale([1, 0, 0, 0, 1, 0, 0, 0, 1], zoom));
        const ap = P.pitch * 2 ** (lv - 1) * zoom;
        S.gbri[lv] = win(ap, 0.30, 0.48) * (1 - win(ap, 1.5, 2.4));
      }
    },
  },

  // ==== THE OCTAVE-DIVE FAMILY — subtle takes on the normal zoom =============
  // Same DNA as zoom: 4 octave grid levels, apparent-pitch brightness
  // windows, one expo octave per cycle. Each version changes ONE thing.

  // zoom · out: the dive reversed — the grid recedes away from you.
  {
    key: "zoom-out", label: "zoom out", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.0, min: 1.5, max: 10, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "grid"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      octaveDrive(S, P, 2 ** -expoInOut(u), null);
    },
  },

  // zoom · quarter: the dive with a quarter turn locked to it — the grid
  // maps onto itself under 90°, so the loop stays perfect.
  {
    key: "zoom-quarter", label: "zoom quarter", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.2, min: 1.5, max: 10, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "grid"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      const e = expoInOut(u);
      octaveDrive(S, P, 2 ** e, matRotZ(e * Math.PI / 2));
    },
  },

  // zoom · spin: the dive under a slow serene rotation. The default rate
  // completes a quarter turn per cycle, so it still loops clean.
  {
    key: "zoom-spin", label: "zoom spin", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.0, min: 1.5, max: 10, step: 0.1 },
      spin:    { value: 0.3927, min: -1.2, max: 1.2, step: 0.0001 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "grid"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      octaveDrive(S, P, 2 ** expoInOut(u), matRotZ(t * P.spin));
    },
  },

  // zoom · lean: the dive with a shear that leans the grid over mid-cycle
  // and sets it upright again for the wrap.
  {
    key: "zoom-lean", label: "zoom lean", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.4, min: 1.5, max: 10, step: 0.1 },
      lean:    { value: 0.34, min: -0.9, max: 0.9, step: 0.01 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "grid"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      const s = P.lean * Math.sin(Math.PI * u) ** 2;
      octaveDrive(S, P, 2 ** expoInOut(u), [1, 0, 0, s, 1, 0, 0, 0, 1]);
    },
  },

  // zoom · plane: the grid tipped into a receding 3D plane — the dive
  // rushes underfoot instead of at your face.
  {
    key: "zoom-plane", label: "zoom plane", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.0, min: 1.5, max: 10, step: 0.1 },
      tilt:    { value: 0.85, min: 0, max: 1.35, step: 0.01 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "grid"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      octaveDrive(S, P, 2 ** expoInOut(u), matRotX(P.tilt));
    },
  },

  // zoom · rails: one-directional lines only — vertical rails and their
  // anchors diving through the octaves.
  {
    key: "zoom-rails", label: "zoom rails", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.0, min: 1.5, max: 10, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "rails"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      octaveDrive(S, P, 2 ** expoInOut(u), null);
    },
  },

  // zoom · marks: no lines at all — just the anchor lattice, a field of
  // block marks breathing through the dive.
  {
    key: "zoom-marks", label: "zoom marks", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 4.0, min: 1.5, max: 10, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.9, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "marks"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      octaveDrive(S, P, 2 ** expoInOut(u), null);
    },
  },

  // zoom · surge: no net travel — the grid dives half an octave and eases
  // home again, expo both ways.
  {
    key: "zoom-surge", label: "zoom surge", statusName: "DIVING", id: 0,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 5.0, min: 1.5, max: 12, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, "grid"); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      const e = expoInOut(u < 0.5 ? u * 2 : 2 - u * 2);
      octaveDrive(S, P, 2 ** (e * 0.5), null);
    },
  },

  // ==== THE OCTAVE-DIVE FAMILY, BLOCK-KEYED (field 25) =======================
  // Twins of the set above with a SYMMETRIC, precisely-placed subset of
  // anchors licensed to print blocks. Same dives, same loops — the blocks
  // ride the level windows, so they fade through the octaves with the grid.
  // zoom · out blocks — its own definition: the reversed dive with the
  // diagonal block quad, a recursive SQUARE OUTLINE holding the centre of
  // the composition, and a fast sub-second loop that restarts instantly —
  // seamless in geometry, but each pass reseeds a whisper of rotation and
  // scale so the braille rasterises to slightly different positions.
  {
    key: "zoom-out-blocks", label: "zoom out blocks", statusName: "DIVING", id: 25,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: 0.85, min: 0.35, max: 4, step: 0.05 },
      halo:    { value: 6.0, min: 0, max: 14, step: 0.1 },
      reseed:  { value: 1.0, min: 0, max: 2, step: 0.05 },
      // this mode drives the terminal's phosphor itself (pages defer to
      // these two while it is the target — the scene toggle is bypassed)
      phosphor:{ value: 1, min: 0, max: 1, step: 0.01 },
      persist: { value: 0.2, min: 0.05, max: 1.5, step: 0.01 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) {
      return octaveGen(N, P, "grid",
        (i, j) => Math.abs(i) === 1 && Math.abs(j) === 1,
        (L, lv, p) => {                 // the centre square, one per octave —
          // half a cell wide so it floats BETWEEN grid lines, never on them
          const s = p * 0.5, g = p / 6;
          for (let d = -s; d <= s; d += g) {
            L.add(d, s, 0, lv, 0.9); L.add(d, -s, 0, lv, 0.9);
            L.add(s, d, 0, lv, 0.9); L.add(-s, d, 0, lv, 0.9);
          }
        });
    },
    update(S, P, t) {
      const cyc = Math.max(0.1, P.cycle);
      const u = ((t / cyc) % 1 + 1) % 1;
      // per-loop deterministic reseed — SCALE only. A rotation whisper used
      // to ride along too, but it tilted the whole composition (~1.7°) and
      // the grid read crooked; the scale jitter alone re-rasterises the
      // braille each pass while everything stays square.
      const n = Math.floor(t / cyc);
      const js = 1 + (hash01(n * 13 + 5) - 0.5) * 0.05 * P.reseed;
      octaveDrive(S, P, 2 ** -expoInOut(u) * js, null);
      S.prm.set([P.halo, 0, 0, 0]);
      S.prm2.set([0, 0, 0, 0]);
    },
  },

  ...[
    { key: "zoom-quarter-blocks", label: "zoom quarter blocks", base: "quarter",
      sel: (i, j) => (Math.abs(i) === 1 && j === 0) || (i === 0 && Math.abs(j) === 1) },
    { key: "zoom-spin-blocks", label: "zoom spin blocks", base: "spin",
      sel: (i, j) => Math.max(Math.abs(i), Math.abs(j)) === 1 },
    { key: "zoom-lean-blocks", label: "zoom lean blocks", base: "lean",
      sel: (i, j) => Math.abs(i) === 1 && Math.abs(j) <= 1 },
    { key: "zoom-plane-blocks", label: "zoom plane blocks", base: "plane",
      sel: (i, j) => j === 0 && Math.abs(i) <= 2 },
    { key: "zoom-rails-blocks", label: "zoom rails blocks", base: "rails", style: "rails",
      sel: (i, j) => Math.abs(i) === 1 && Math.abs(j) === 2 },
    { key: "zoom-marks-blocks", label: "zoom marks blocks", base: "marks", style: "marks",
      sel: (i, j) => Math.abs(i) === 1 && Math.abs(j) === 1 },
    { key: "zoom-surge-blocks", label: "zoom surge blocks", base: "surge",
      sel: (i, j) => (i === 0 && j === 0) || (Math.abs(i) === 1 && Math.abs(j) === 1) },
  ].map((V) => ({
    key: V.key, label: V.label, statusName: "DIVING", id: 25,
    regen: ["pitch", "anchors"],
    params: {
      cycle:   { value: V.base === "surge" ? 5.0 : V.base === "lean" ? 4.4
                      : V.base === "quarter" ? 4.2 : 4.0, min: 1.5, max: 12, step: 0.1 },
      ...(V.base === "spin" ? { spin: { value: 0.3927, min: -1.2, max: 1.2, step: 0.0001 } } : {}),
      ...(V.base === "lean" ? { lean: { value: 0.34, min: -0.9, max: 0.9, step: 0.01 } } : {}),
      ...(V.base === "plane" ? { tilt: { value: 0.85, min: 0, max: 1.35, step: 0.01 } } : {}),
      halo:    { value: 6.0, min: 0, max: 14, step: 0.1 },
      pitch:   { value: 0.60, min: 0.45, max: 1.0, step: 0.01 },
      anchors: { value: 2.6, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return octaveGen(N, P, V.style || "grid", V.sel); },
    update(S, P, t) {
      const u = ((t / P.cycle) % 1 + 1) % 1;
      const e = expoInOut(u);
      let zoom = 2 ** e, M = null;
      if (V.base === "out") zoom = 2 ** -e;
      else if (V.base === "quarter") M = matRotZ(e * Math.PI / 2);
      else if (V.base === "spin") M = matRotZ(t * P.spin);
      else if (V.base === "lean") {
        const s = P.lean * Math.sin(Math.PI * u) ** 2;
        M = [1, 0, 0, s, 1, 0, 0, 0, 1];
      } else if (V.base === "plane") M = matRotX(P.tilt);
      else if (V.base === "surge") {
        zoom = 2 ** (0.5 * expoInOut(u < 0.5 ? u * 2 : 2 - u * 2));
      }
      octaveDrive(S, P, zoom, M);
      S.prm.set([P.halo, 0, 0, 0]);
      S.prm2.set([0, 0, 0, 0]);
    },
  })),

  // ==== THE CUBE-ZOOM FAMILY (field 23, anchor-licensed) =====================
  // The zoom grid confined to a front-facing, NON-ROTATING perspective
  // cube: K slice grids stacked through the volume, blooming one after
  // another on expo pulses — the sequence travelling front-to-back,
  // back-to-front, left-to-right, top-to-bottom. Anchors print blocks;
  // lines stay dots; the cube frame holds steady throughout.
  ...[
    { key: "cube-dive", label: "cube dive", axis: "z", rev: false },
    { key: "cube-return", label: "cube return", axis: "z", rev: true },
    { key: "cube-sweep", label: "cube sweep", axis: "x", rev: true },
    { key: "cube-fall", label: "cube fall", axis: "y", rev: false },
  ].map((V) => ({
    key: V.key, label: V.label, statusName: "SCANNING", id: 23,
    regen: ["slices", "anchors"],
    params: {
      cycle:   { value: 6.0, min: 2.5, max: 16, step: 0.1 },
      slices:  { value: 6, min: 4, max: 9, step: 1 },
      flow:    { value: 1.25, min: 0.4, max: 2, step: 0.01 },
      halo:    { value: 6.0, min: 0, max: 14, step: 0.1 },
      boost:   { value: 1.6, min: 0, max: 3, step: 0.05 },
      rest:    { value: 0.5, min: 0, max: 1, step: 0.01 },
      anchors: { value: 2.2, min: 0, max: 4, step: 0.05 },
    },
    gen(N, P) { return cubeZoomGen(N, P, V.axis, V.rev); },
    update(S, P, t) { cubeClock(S, P, t); },
  })),

  // ==== THE SQUARE-TUNNEL FAMILY (field 24) ==================================
  // Recursive, self-similar squares travelling toward the viewer — the zoom
  // asset's octave-loop DNA generalised: a level's continuous coordinate
  // q = lv + prog drives scale (flat) or z (3d), plus twist per level.
  // prog's SHAPE is each mode's character — linear glide, or one whole
  // level leapt per cycle on a hard expoInOut. All loop seamlessly.

  // zoom · glide: the pure hypnotic tunnel — constant exponential outflow.
  {
    key: "zoom-glide", label: "zoom glide", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 1.9, min: 0.6, max: 8, step: 0.05 },
      ratio:  { value: 1.45, min: 1.25, max: 1.8, step: 0.01 },
      levels: { value: 12, min: 8, max: 20, step: 1 },
      spin:   { value: 0.02, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "outline"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, u, 0);
    },
  },

  // zoom · pulse: the signature dive — the whole recursion leaps exactly
  // one level per cycle on a hard expo in-out, then settles.
  {
    key: "zoom-pulse", label: "zoom pulse", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 2.2, min: 0.8, max: 8, step: 0.05 },
      ratio:  { value: 1.45, min: 1.25, max: 1.8, step: 0.01 },
      levels: { value: 12, min: 8, max: 20, step: 1 },
      spin:   { value: 0, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "outline"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, expoInOut(u), 0);
    },
  },

  // zoom · twist: the pulse dive with a fixed rotation per level — the
  // recursion corkscrews as it comes at you.
  {
    key: "zoom-twist", label: "zoom twist", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 2.4, min: 0.8, max: 8, step: 0.05 },
      ratio:  { value: 1.42, min: 1.25, max: 1.8, step: 0.01 },
      twist:  { value: 0.26, min: -0.8, max: 0.8, step: 0.01 },
      levels: { value: 13, min: 8, max: 20, step: 1 },
      spin:   { value: 0, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "outline"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, expoInOut(u), 0);
    },
  },

  // zoom · frames: only the corner brackets of each square — camera
  // framing marks flying past, stepped on the expo dive.
  {
    key: "zoom-frames", label: "zoom frames", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 2.6, min: 0.8, max: 8, step: 0.05 },
      ratio:  { value: 1.5, min: 1.25, max: 1.8, step: 0.01 },
      levels: { value: 11, min: 8, max: 20, step: 1 },
      spin:   { value: 0.015, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "frames"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, expoInOut(u), 0);
    },
  },

  // zoom · diamond: every other level inscribed at 45° — the classic
  // square-in-diamond recursion. The dive leaps TWO levels per cycle so
  // the alternation lands back on itself and the loop stays seamless.
  {
    key: "zoom-diamond", label: "zoom diamond", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 3.4, min: 1.2, max: 10, step: 0.05 },
      ratio:  { value: 1.35, min: 1.25, max: 1.7, step: 0.01 },
      levels: { value: 14, min: 8, max: 20, step: 1 },
      spin:   { value: 0, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "diamond"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, 2 * expoInOut(u), 0);
    },
  },

  // zoom · depth: true dimensionality — fixed-size squares strung along z,
  // gliding through the camera plane with a slow roll; tilt the whole
  // corridor (or orbit the camera) for parallax.
  {
    key: "zoom-depth", label: "zoom depth", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 2.0, min: 0.6, max: 8, step: 0.05 },
      levels: { value: 14, min: 8, max: 20, step: 1 },
      depth:  { value: 0.42, min: 0.15, max: 0.9, step: 0.01 },
      size:   { value: 0.60, min: 0.2, max: 1.2, step: 0.01 },
      twist:  { value: 0.09, min: -0.8, max: 0.8, step: 0.01 },
      tilt:   { value: 0.38, min: -1.2, max: 1.2, step: 0.01 },
      spin:   { value: 0.03, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "outline"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, u, 1);
    },
  },

  // zoom · corridor: the 3d tunnel on the stepped expo dive, dashed walls,
  // a stronger corkscrew — lurching forward frame by frame.
  {
    key: "zoom-corridor", label: "zoom corridor", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 2.8, min: 0.8, max: 8, step: 0.05 },
      levels: { value: 13, min: 8, max: 20, step: 1 },
      depth:  { value: 0.5, min: 0.15, max: 0.9, step: 0.01 },
      size:   { value: 0.62, min: 0.2, max: 1.2, step: 0.01 },
      twist:  { value: 0.32, min: -0.8, max: 0.8, step: 0.01 },
      tilt:   { value: 0.18, min: -1.2, max: 1.2, step: 0.01 },
      spin:   { value: 0, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "dashed"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      tunnelDrive(S, P, t, expoInOut(u), 1);
    },
  },

  // zoom · breathe: no net travel — the recursion surges one level toward
  // you and eases back, double-walled squares counter-twisting as they
  // swell. Expo both directions.
  {
    key: "zoom-breathe", label: "zoom breathe", statusName: "DIVING", id: 24,
    regen: ["levels"],
    params: {
      cycle:  { value: 4.4, min: 1.5, max: 12, step: 0.05 },
      ratio:  { value: 1.4, min: 1.25, max: 1.8, step: 0.01 },
      twist:  { value: 0.30, min: -0.8, max: 0.8, step: 0.01 },
      levels: { value: 12, min: 8, max: 20, step: 1 },
      spin:   { value: 0.02, min: -0.4, max: 0.4, step: 0.005 },
    },
    gen(N, P) { return tunnelGen(N, P, "double"); },
    update(S, P, t) {
      const u = ((t / Math.max(0.1, P.cycle)) % 1 + 1) % 1;
      const surge = expoInOut(u < 0.5 ? u * 2 : 2 - u * 2);
      tunnelDrive(S, P, t, surge, 0, 1);
    },
  },

  // -- 10 · SONAR — the listening ping on the WIREFRAME globe (sphere_states)
  // The sketch is a thin lat/long wireframe ball, front hemisphere only; the
  // ping ring bulges the wire as it sweeps pole to pole, and the grid VERTICES
  // bloom into solid blocks where it passes. Wires are group 0, vertices
  // group 1; the band is multiplicative so each blooms in proportion.
  {
    key: "sonar", label: "sonar", statusName: "LISTENING", id: 4,
    regen: ["lat", "lon"],
    params: {
      ping:   { value: 1.25, min: 0.2, max: 3, step: 0.01 },
      width:  { value: 0.20, min: 0.06, max: 0.5, step: 0.01 },
      bright: { value: 3.4, min: 0, max: 6, step: 0.05 },
      rest:   { value: 0.42, min: 0, max: 1.2, step: 0.01 },
      bulge:  { value: 0.08, min: 0, max: 0.25, step: 0.005 },
      spin:   { value: 0, min: -1, max: 1, step: 0.01 },
      lat:    { value: 10, min: 6, max: 16, step: 1 },
      lon:    { value: 18, min: 8, max: 28, step: 1 },
    },
    gen(N, P) {
      const L = new Layout();
      const LAT = Math.round(P.lat), LON = Math.round(P.lon);
      const GAP = 0.030;                     // dot spacing along the wires
      for (let i = 1; i < LAT; i++) {        // latitude rings (wire, group 0)
        const th = (Math.PI * i) / LAT;
        const st = Math.sin(th), ct = Math.cos(th);
        const n = Math.max(8, Math.round((TAU * st) / GAP));
        for (let j = 0; j < n; j++) {
          const ph = (TAU * j) / n;
          L.add(st * Math.cos(ph), ct, st * Math.sin(ph), 0, 0.55);
        }
      }
      for (let j = 0; j < LON; j++) {        // longitude meridians (wire)
        const ph = (TAU * j) / LON;
        const n = Math.round(Math.PI / GAP);
        for (let i = 1; i < n; i++) {
          const th = (Math.PI * i) / n;
          const st = Math.sin(th);
          L.add(st * Math.cos(ph), Math.cos(th), st * Math.sin(ph), 0, 0.55);
        }
      }
      for (let i = 1; i < LAT; i++) {        // grid vertices (group 1): these
        const th = (Math.PI * i) / LAT;      // bloom to blocks under the ping
        const st = Math.sin(th), ct = Math.cos(th);
        for (let j = 0; j < LON; j++) {
          const ph = (TAU * j) / LON;
          L.add(st * Math.cos(ph), ct, st * Math.sin(ph), 1, 1.35);
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const SPAN = Math.PI + 0.7;
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([(t * P.ping) % SPAN, P.bright,
                 1 / (P.width * P.width), P.rest]);
      S.prm2.set([P.bulge, 0, 0, 0]);
    },
  },

  // -- 11 · HELIX — the pseudo-3D spiral stretch wave (scenes.py scene 10) ---
  {
    key: "helix", label: "helix", statusName: "FLOWING", id: 6,
    regen: ["turns", "radius", "height"],
    params: {
      spin:   { value: 0, min: -2, max: 2, step: 0.01 },
      speed:  { value: 1.0, min: 0, max: 3, step: 0.01 },
      waves:  { value: 1.4, min: 0.5, max: 5, step: 0.05 },
      sharp:  { value: 3.0, min: 1, max: 8, step: 0.1 },
      rest:   { value: 0.30, min: 0, max: 1, step: 0.01 },
      amp:    { value: 2.4, min: 0, max: 4, step: 0.05 },
      turns:  { value: 2.6, min: 1, max: 5, step: 0.1 },
      radius: { value: 0.85, min: 0.3, max: 1.3, step: 0.01 },
      // vertical span of the spiral — radius makes it wider, height taller
      height: { value: 2.3, min: 0.5, max: 4.5, step: 0.05 },
      // block license — how much the crest may bloom to blocks; under 1 the
      // crest ribbon breaks into intermittent chunk islands (the rough look)
      blocks: { value: 0.55, min: 0, max: 1, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      const n = 340;
      const half = P.height / 2;
      for (let i = 0; i < n; i++) {
        const fr = (i / (n - 1)) * 0.999;
        const a = fr * P.turns * TAU;
        L.add(Math.cos(a) * P.radius, half - P.height * fr,
              Math.sin(a) * P.radius, fr, 0.8);
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([P.waves * TAU, t * P.speed * 2.5, P.sharp, P.rest]);
      S.prm2.set([P.amp, P.blocks ?? 0.55, 0, 0]);
    },
  },

  // -- 12 · SPARK — long rays crossing at a point (reference sketch 1) -------
  // A starburst of lines through the centre, a brightness wave (the helix
  // field) firing outward along every ray. Each ray's 3D direction is
  // adjustable with two angles, latitude / longitude style:
  //   "tilt k" (degrees) — the angle seen from the front (screen plane),
  //     added onto ray k's auto-fanned position
  //   "turn k" (degrees) — swings the ray out of the screen plane, toward /
  //     away from the camera, so the burst is volumetric from every side
  // Both default 0 (the classic flat fan); "depth" is the random wobble.
  {
    key: "spark", label: "spark", statusName: "SPARKING", id: 6,
    regen: ["rays", "len", "fan", "depth",
            "tilt 1", "tilt 2", "tilt 3", "tilt 4", "tilt 5", "tilt 6",
            "tilt 7", "tilt 8", "tilt 9", "tilt 10", "tilt 11", "tilt 12",
            "turn 1", "turn 2", "turn 3", "turn 4", "turn 5", "turn 6",
            "turn 7", "turn 8", "turn 9", "turn 10", "turn 11", "turn 12"],
    params: {
      rays:  { value: 6, min: 3, max: 12, step: 1 },
      len:   { value: 2.2, min: 0.6, max: 2.2, step: 0.05 },
      fan:   { value: 1.0, min: 0.05, max: 1.0, step: 0.01 },
      depth: { value: 1.0, min: 0, max: 1, step: 0.01 },
      spin:  { value: 0.4, min: -1, max: 1, step: 0.01 },
      waves: { value: 5.0, min: 0.5, max: 5, step: 0.05 },
      speed: { value: 1.06, min: 0, max: 3, step: 0.01 },
      sharp: { value: 2.7, min: 1, max: 8, step: 0.1 },
      rest:  { value: 0.85, min: 0, max: 1, step: 0.01 },
      amp:   { value: 0.45, min: 0, max: 4, step: 0.05 },
      // rays crowd wherever they cross — blocks are opt-in here, default off
      blocks: { value: 0, min: 0, max: 1, step: 0.01 },
      "tilt 1":  { value: 47, min: -90, max: 90, step: 1 },
      "tilt 2":  { value: 3, min: -90, max: 90, step: 1 },
      "tilt 3":  { value: -9, min: -90, max: 90, step: 1 },
      "tilt 4":  { value: -28, min: -90, max: 90, step: 1 },
      "tilt 5":  { value: -22, min: -90, max: 90, step: 1 },
      "tilt 6":  { value: -82, min: -90, max: 90, step: 1 },
      "tilt 7":  { value: 80, min: -90, max: 90, step: 1 },
      "tilt 8":  { value: 62, min: -90, max: 90, step: 1 },
      "tilt 9":  { value: 66, min: -90, max: 90, step: 1 },
      "tilt 10": { value: 48, min: -90, max: 90, step: 1 },
      "tilt 11": { value: 81, min: -90, max: 90, step: 1 },
      "tilt 12": { value: 90, min: -90, max: 90, step: 1 },
      "turn 1":  { value: 23, min: -90, max: 90, step: 1 },
      "turn 2":  { value: 49, min: -90, max: 90, step: 1 },
      "turn 3":  { value: 77, min: -90, max: 90, step: 1 },
      "turn 4":  { value: -90, min: -90, max: 90, step: 1 },
      "turn 5":  { value: 63, min: -90, max: 90, step: 1 },
      "turn 6":  { value: -90, min: -90, max: 90, step: 1 },
      "turn 7":  { value: 0, min: -90, max: 90, step: 1 },
      "turn 8":  { value: 0, min: -90, max: 90, step: 1 },
      "turn 9":  { value: 0, min: -90, max: 90, step: 1 },
      "turn 10": { value: 0, min: -90, max: 90, step: 1 },
      "turn 11": { value: 0, min: -90, max: 90, step: 1 },
      "turn 12": { value: 0, min: -90, max: 90, step: 1 },
    },
    gen(N, P) {
      const L = new Layout();
      const R = Math.round(P.rays), GAP = 0.009;
      for (let k = 0; k < R; k++) {
        // fan the rays evenly through ±fan with a whisper of jitter; tilt
        // swings ray k in the screen plane, turn swings it out of the plane
        const spread = R < 2 ? 0 : k / (R - 1) - 0.5;
        const el = spread * 2 * P.fan * (0.7 + 0.3 * hash01(k * 3 + 1))
                 + (P[`tilt ${k + 1}`] || 0) * (Math.PI / 180);
        const zt = (hash01(k * 7 + 3) - 0.5) * 2 * P.depth;  // depth tilt
        let dx = Math.cos(el), dy = Math.sin(el), dz = zt * 0.5;
        const az = (P[`turn ${k + 1}`] || 0) * (Math.PI / 180);
        if (az) {                       // rotate the ray about screen-vertical
          const ca = Math.cos(az), sa = Math.sin(az);
          const rx = dx * ca + dz * sa, rz = -dx * sa + dz * ca;
          dx = rx; dz = rz;
        }
        const dl = Math.hypot(dx, dy, dz);
        dx /= dl; dy /= dl; dz /= dl;
        const len = P.len * (0.6 + 0.4 * hash01(k * 11 + 5));
        const n = Math.max(8, Math.round((2 * len) / GAP));
        for (let i = 0; i <= n; i++) {
          const s = -len + (2 * len * i) / n;
          const fr = Math.min(Math.abs(s) / len, 0.999);
          // every ray crosses at the centre — dim the innermost stretch so
          // the crossing reads as dense ink, not a blown-out block
          const core = Math.min(1, fr / 0.14);
          L.add(dx * s, dy * s, dz * s, fr, 0.55 * (0.3 + 0.7 * core));
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([P.waves * TAU, t * P.speed * 2.5, P.sharp, P.rest]);
      S.prm2.set([P.amp, P.blocks ?? 0, 0, 0]);
    },
  },

  // -- STAR — the spark rebuilt as ONE predictable object --------------------
  // `rays` straight lines, each passing through the single centre point at its
  // own midpoint. Straight on it is the even asterisk; the depth is built from
  // exactly two rules instead of per-ray sliders:
  //   fan  (deg) — each LINE leans out of the screen plane about the centre.
  //     A line pivots as a whole, so its far half is always the near half
  //     reflected through the centre — the double-cone / pinecone silhouette.
  //   cone (deg) — every ARM additionally sweeps toward one pole of the view
  //     axis (the shuttlecock). This is the one control allowed to kink a line
  //     at the centre; at 0 every line is dead straight.
  // Neither touches the front-view azimuths, so the shape reads as the same
  // star from the front no matter how deep it gets.
  //   vary — 0 perfect .. 1 hand-drawn: seeded jitter on spacing, lean and arm
  //     length. Jitter moves whole LINES (both halves together), so the centre
  //     logic survives any amount of it. `seed` picks which imperfect star.
  {
    key: "star", label: "star", statusName: "SPARKING", id: 6,
    regen: ["rays", "len", "fan", "cone", "vary", "seed", "angle"],
    params: {
      rays:  { value: 5, min: 2, max: 12, step: 1 },
      len:   { value: 1.6, min: 0.4, max: 2.6, step: 0.05 },
      fan:   { value: 25, min: 0, max: 90, step: 1 },
      cone:  { value: 0, min: -90, max: 90, step: 1 },
      vary:  { value: 0.2, min: 0, max: 1, step: 0.01 },
      seed:  { value: 1, min: 0, max: 99, step: 1 },
      angle: { value: 0, min: -90, max: 90, step: 1 },
      spin:  { value: 0.4, min: -1, max: 1, step: 0.01 },
      waves: { value: 5.0, min: 0.5, max: 5, step: 0.05 },
      speed: { value: 1.06, min: 0, max: 3, step: 0.01 },
      sharp: { value: 2.7, min: 1, max: 8, step: 0.1 },
      rest:  { value: 0.85, min: 0, max: 1, step: 0.01 },
      amp:   { value: 0.45, min: 0, max: 4, step: 0.05 },
      // rays crowd wherever they cross — blocks are opt-in here, default off
      blocks: { value: 0, min: 0, max: 1, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      const R = Math.max(2, Math.round(P.rays)), GAP = 0.009;
      const coneR = P.cone * (Math.PI / 180);
      for (let k = 0; k < R; k++) {
        const ln = starLine(P, k);
        const n = Math.max(4, Math.round(ln.len / GAP));
        for (const side of [1, -1]) {
          const d = starArm(ln, coneR, side);
          // the minus arm skips i = 0 — the centre dot belongs to one arm only
          for (let i = side > 0 ? 0 : 1; i <= n; i++) {
            const s = (i / n) * ln.len;
            const fr = Math.min(i / n, 0.999);
            // dim the innermost stretch so the crossing reads as dense ink,
            // not a blown-out block (same trick as spark)
            const core = Math.min(1, fr / 0.14);
            L.add(d[0] * s, d[1] * s, d[2] * s, fr, 0.55 * (0.3 + 0.7 * core));
          }
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([P.waves * TAU, t * P.speed * 2.5, P.sharp, P.rest]);
      S.prm2.set([P.amp, P.blocks ?? 0, 0, 0]);
    },
  },

  // -- STAR BLOCKS — the star dressed with blocks sized by TRUE nearness -----
  // The same lines as star (identical geometry knobs), plus solid block
  // stations parked along the first `chip lines` lines: one at the crossing,
  // `stations` more out each arm. How big a block prints IS how near it
  // really is: every frame the field measures the LIVE eye-to-station
  // distance — spin and orbit included, nothing derived from a fixed
  // direction — against the eye-to-crossing distance. The crossing block is
  // therefore always exactly `size`, near stations grow past it, far ones
  // shrink toward a single cell, and `boost` is the ONE dial for how hard
  // that works: size doubles every len/boost of approach toward the eye
  // (0 = an honest rigid object, the lens alone). Octaves rather than the
  // raw lens ratio, so the dial bites the same from any camera distance.
  // The ramp's SHAPE is then art-directable without touching the physics:
  // `curve` bends where along the line the change concentrates, `grow` and
  // `floor` pin the near and far extremes. The crossing stays exactly
  // `size` through all of it. Patches ride the camera frame, so a block
  // stays a clean screen square from any viewpoint.
  {
    key: "star-blocks", label: "star blocks", statusName: "SPARKING", id: 36,
    regen: ["rays", "len", "fan", "cone", "vary", "seed", "angle",
            "stations", "patch", "chip lines"],
    params: {
      rays:  { value: 5, min: 2, max: 12, step: 1 },
      len:   { value: 1.6, min: 0.4, max: 2.6, step: 0.05 },
      fan:   { value: 25, min: 0, max: 90, step: 1 },
      cone:  { value: 0, min: -90, max: 90, step: 1 },
      vary:  { value: 0.2, min: 0, max: 1, step: 0.01 },
      seed:  { value: 1, min: 0, max: 99, step: 1 },
      angle: { value: 0, min: -90, max: 90, step: 1 },
      spin:  { value: 0.4, min: -1, max: 1, step: 0.01 },
      // THE depth dial — size doublings per arm-length of approach
      boost: { value: 2.5, min: 0, max: 4, step: 0.05 },
      // taper shaping, all live: curve bends WHERE along the line the change
      // happens (<1 fast off the crossing then level, >1 hold the middle
      // then dive/bloom at the tips); grow caps the near multiple; floor
      // props up the far one so distant blocks can stay readable
      curve: { value: 1, min: 0.3, max: 3, step: 0.05 },
      grow:  { value: 2.5, min: 1, max: 4, step: 0.05 },
      floor: { value: 0.05, min: 0.02, max: 1, step: 0.01 },
      size:  { value: 0.035, min: 0.01, max: 0.6, step: 0.005 },
      stations: { value: 4, min: 1, max: 8, step: 1 },
      "chip lines": { value: 1, min: 1, max: 12, step: 1 },
      // dots across a patch — enough that a fully boosted block's dot pitch
      // stays around one cell, or the biggest slabs shatter into scatter
      patch: { value: 13, min: 3, max: 15, step: 2 },
      halo:  { value: 10, min: 0, max: 20, step: 0.5 },
    },
    gen(N, P) {
      const R = Math.max(2, Math.round(P.rays)), GAP = 0.009;
      const coneR = P.cone * (Math.PI / 180);
      const ST = Math.max(1, Math.round(P.stations));
      const G = Math.max(3, Math.round(P.patch) | 1);
      const D = Math.min(R, Math.max(1, Math.round(P["chip lines"])));
      const slots = [];
      let si = 0;                    // station counter — decorrelates jitter
      const patch = (x, y, z, fr) => {
        // sub-pitch jitter on the patch grid: a rigid lattice aliases against
        // the terminal's cell grid and prints a big block as stripes
        const J = 0.45 * (2 / (G - 1));
        for (let a = 0; a < G; a++)
          for (let c = 0; c < G; c++)
            slots.push(x, y, z, 1,
                       (a / (G - 1)) * 2 - 1
                         + (hash01(si * 977 + a * 31 + c * 7 + 5) - 0.5) * J,
                       (c / (G - 1)) * 2 - 1
                         + (hash01(si * 977 + a * 31 + c * 7 + 11) - 0.5) * J,
                       0.9 * fr, 1.0);
        si++;
      };
      for (let k = 0; k < R; k++) {
        const ln = starLine(P, k);
        const n = Math.max(4, Math.round(ln.len / GAP));
        for (const side of [1, -1]) {
          const d = starArm(ln, coneR, side);
          for (let i = side > 0 ? 0 : 1; i <= n; i++) {
            const s = (i / n) * ln.len;
            const fr = Math.min(i / n, 0.999);
            const core = Math.min(1, fr / 0.14);
            slots.push(d[0] * s, d[1] * s, d[2] * s, 0, 0, 0,
                       0.9 * fr, 0.55 * (0.3 + 0.7 * core));
          }
          // the stations, measured OUT from the crossing along this arm
          if (k < D) for (let j = 1; j <= ST; j++) {
            const s = (j / ST) * ln.len;
            patch(d[0] * s, d[1] * s, d[2] * s, j / ST);
          }
        }
      }
      patch(0, 0, 0, 0);           // the crossing owns ONE shared station
      return bakeRibbon(slots, N);
    },
    update(S, P, t) {
      // identity groups: the field applies the spin itself, so block patches
      // can stay square to the SCREEN while the star turns under them
      for (let k = 0; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([t * P.spin, P.size, P.boost, P.halo]);
      // ?? fallbacks guard saved scenes from before the taper controls
      const fl = P.floor ?? 0.05;
      S.prm2.set([P.len, P.curve ?? 1, Math.max(P.grow ?? 2.5, fl), fl]);
    },
  },

  // -- STAR BLOOM — blocks slide out of the crossing, park, draw back --------
  // The dressed line's stations emerge FROM the centre point one after
  // another (both arms abreast, so the mirror symmetry never breaks), grow
  // as they travel out — the depth rule sizing them live — hold their posts
  // while the star turns, then slide home again. window wide = a breathing
  // wave, narrow = beads leaving one at a time.
  {
    key: "star-bloom", label: "star bloom", statusName: "SPARKING", id: 37,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ window: 0.55 }),
    gen(N, P) { return starLifeGen(N, P, starOrdOut); },
    update(S, P, t) { starLifeUpdate(S, P, t, 0); },
  },

  // -- STAR BURST — the whole star blooms blocks in rings --------------------
  // Every line dressed; stations at the same distance emerge TOGETHER, so
  // the blocks arrive as expanding rings around the crossing, park into the
  // full pinecone, then collapse home ring by ring.
  {
    key: "star-burst", label: "star burst", statusName: "SPARKING", id: 37,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 3, size: 0.025,
                             window: 0.4, boost: 2.0 }),
    gen(N, P) { return starLifeGen(N, P, starOrdOut); },
    update(S, P, t) { starLifeUpdate(S, P, t, 0); },
  },

  // -- STAR STEPS — stations pop in tip-to-tip, a pulse laps the chain -------
  // The line fills far tip -> crossing -> near tip, one clean expo pop per
  // station; while parked, a swell runs the chain `loops` times (wrapping
  // end around to start); then they pop away in the same order.
  {
    key: "star-steps", label: "star steps", statusName: "SPARKING", id: 37,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ window: 0.3, loops: 2, cycle: 8 }),
    gen(N, P) { return starLifeGen(N, P, starOrdRun); },
    update(S, P, t) { starLifeUpdate(S, P, t, 1); },
  },

  // -- STAR CASCADE — the sequence wraps around the whole star ---------------
  // All lines dressed, firing line-major: line 0 fills tip to tip, then
  // line 1, around the star — and the mid-cycle swell laps the entire
  // wreath once before it unwinds the same way.
  {
    key: "star-cascade", label: "star cascade", statusName: "SPARKING", id: 37,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 3, size: 0.025,
                             window: 0.2, cycle: 9, boost: 2.0 }),
    gen(N, P) {
      return starLifeGen(N, P, starOrdLines);
    },
    update(S, P, t) { starLifeUpdate(S, P, t, 1); },
  },

  // -- STAR RELAY — one block runs the line, tip to tip and back -------------
  // Nothing is parked: a single window of blockness bounces along the
  // dressed line `loops` times, swelling and shrinking with TRUE nearness
  // as it crosses the depth — the purest read of size-is-distance.
  {
    key: "star-relay", label: "star relay", statusName: "SPARKING", id: 37,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ window: 0.4, loops: 2 }),
    gen(N, P) { return starLifeGen(N, P, starOrdRun); },
    update(S, P, t) { starLifeUpdate(S, P, t, 2); },
  },

  // ==== the EXTREME set (field 38) — hard depth contrast, interlocking ======
  // Same life-cycle grammar as field 37, but the taper is pushed (near cap
  // 3.6x, far floor 0.04) and the phases interlock instead of queueing.

  // -- STAR WEAVE — blocks pop the moment the draw frontier passes them ------
  // The rays draw out SLOWLY, line after line, and each line's blocks are
  // born the instant its frontier sweeps past their station — drawing and
  // dressing are one gesture. Retract runs the same wave backwards, blocks
  // popping off just ahead of the shrinking line.
  {
    key: "star-weave", label: "star weave", statusName: "SPARKING", id: 38,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 5, size: 0.022,
                             boost: 3.2, patch: 13, halo: 12, cycle: 8,
                             spin: 0.16, window: 0.5 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starLifeUpdate(S, P, t, 0); },
  },

  // -- STAR RINGS — strict centre-outward, ring by ring ----------------------
  // Every line dressed; ring 1 slides out of the crossing alone, lands,
  // THEN ring 2, ring 3 — the strictest sequential read of centre-out.
  // The unwind pulls them home in the same order.
  {
    key: "star-rings", label: "star rings", statusName: "SPARKING", id: 38,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 4, size: 0.025,
                             boost: 3.4, patch: 13, halo: 12, cycle: 8,
                             spin: 0.15, window: 0.16, vary: 0.15 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxRing); },
    update(S, P, t) { starLifeUpdate(S, P, t, 1); },
  },

  // -- STAR RUNNERS — ONE block per line, tip to tip in unison ---------------
  // Every line carries a single runner; they all bounce tip-to-tip together,
  // meeting at the crossing in one convergence flash, swelling huge on the
  // near half and collapsing to a chip on the far one.
  {
    key: "star-runners", label: "star runners", statusName: "SPARKING", id: 38,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 5, size: 0.025,
                             boost: 3.4, patch: 13, halo: 12, cycle: 8,
                             spin: 0.16, window: 0.35, loops: 2 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxRun); },
    update(S, P, t) { starLifeUpdate(S, P, t, 2); },
  },

  // -- STAR ROUND — the runner as a baton passed around the star -------------
  // Same single-block-per-line idea, but SEQUENTIAL: one baton sweeps line
  // 0 tip to tip, hands off to line 1, around the whole star — a musical
  // round through the depth field.
  {
    key: "star-round", label: "star round", statusName: "SPARKING", id: 38,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 5, size: 0.025,
                             boost: 3.4, patch: 13, halo: 12, cycle: 9,
                             spin: 0.14, window: 0.3, loops: 1 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxChain); },
    update(S, P, t) { starLifeUpdate(S, P, t, 3); },
  },

  // -- STAR VORTEX — the star folds flat, unfolds DEEP, runners lap it -------
  // The whole object breathes through the depth axis: born nearly flat, it
  // unfolds past its baked lean mid-cycle while phase-offset runners lap
  // every line — a helical sweep of blocks pumping through the full near/far
  // range. The most dimensional thing in the family.
  {
    key: "star-vortex", label: "star vortex", statusName: "SPARKING", id: 38,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 6, size: 0.028,
                             fan: 32, boost: 3.6, patch: 13, halo: 13,
                             cycle: 9, spin: 0.18, window: 0.55, loops: 3,
                             vary: 0.25 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxRun); },
    update(S, P, t) { starLifeUpdate(S, P, t, 4); },
  },

  // ==== the FLOW set (field 39) — endless, constant-glide block motion ======
  // No draw-in or exit: these are the ambient holds. The rays stay put and
  // the blocks MOVE — every loop seamless at any spin rate because the
  // motion itself is periodic.

  // -- STAR TIDE — a fountain of chips flowing out of the crossing -----------
  // Trains of small blocks are born at the centre and glide out along every
  // line at constant rate, swelling and shrinking through the TRUE depth
  // field as they travel, dying softly at the tips. `trains` sets how many
  // ride each line, `loops` the laps per cycle (speed).
  {
    key: "star-tide", label: "star tide", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 8, size: 0.025,
                             boost: 3.0, patch: 11, halo: 11, cycle: 6,
                             spin: 0.14, window: 0.5, loops: 1,
                             trains: { value: 3, min: 1, max: 6, step: 1 } }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 0); },
  },

  // -- STAR ECHO — a signal arrives, the crossing broadcasts it --------------
  // One pulse rides IN along a single arm, accelerating into the centre;
  // the crossing flashes; the pulse radiates back OUT along every arm at
  // once and dies at the tips. The star as a node receiving and answering.
  {
    key: "star-echo", label: "star echo", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 7, size: 0.028,
                             boost: 3.0, patch: 11, halo: 12, cycle: 7,
                             spin: 0.12, window: 0.4 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxRun); },
    update(S, P, t) { starFlowUpdate(S, P, t, 1); },
  },

  // -- STAR PENDULUM — the star swings through flat and INVERTS --------------
  // Blocks parked at their stations, nothing enters or leaves — the whole
  // object's depth swings on a cosine, through dead flat, out the other
  // side. Which end is near swaps every half cycle, and the live depth
  // sizing pumps every block through the full large-small-large arc.
  // `window` is the swing amplitude here (0.95 = nearly full inversion).
  {
    key: "star-pendulum", label: "star pendulum", statusName: "SPARKING",
    id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 4, size: 0.028,
                             fan: 30, boost: 3.2, patch: 13, halo: 11,
                             cycle: 10, spin: 0.1, window: 0.9,
                             vary: 0.15 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 2); },
  },

  // -- STAR SPIRAL — the tide corkscrews around the star ---------------------
  // The outward flow, phase-offset line by line so the fronts spiral around
  // the axis, while the whole asterisk sways on a gentle in-plane sine.
  {
    key: "star-spiral", label: "star spiral", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 8, size: 0.025,
                             boost: 3.0, patch: 11, halo: 11, cycle: 7,
                             spin: 0.12, window: 0.45, loops: 1,
                             trains: { value: 3, min: 1, max: 6, step: 1 } }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 3); },
  },

  // -- STAR COMET — a head and its dying wake, tip to tip --------------------
  // One sharp block bounces the dressed line end to end through the
  // crossing; behind its travel a wake of blocks decays exponentially.
  // `window` is the wake length, `loops` the bounces per cycle.
  {
    key: "star-comet", label: "star comet", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ stations: 8, size: 0.03, boost: 3.2,
                             patch: 11, halo: 12, cycle: 7, spin: 0.16,
                             window: 0.5, loops: 2 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxRun); },
    update(S, P, t) { starFlowUpdate(S, P, t, 4); },
  },

  // -- STAR GATHER — everything flows home to the crossing -------------------
  // The tide reversed: chips are born at the tips, glide inward, and the
  // crossing SWALLOWS each arriving front with a pulse — the star as a
  // collector.
  {
    key: "star-gather", label: "star gather", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 8, size: 0.025,
                             boost: 3.0, patch: 11, halo: 11, cycle: 6,
                             spin: 0.14, window: 0.4, loops: 2,
                             trains: { value: 3, min: 1, max: 6, step: 1 } }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 5); },
  },

  // -- STAR CANON — every line lives its own life, in a round ----------------
  // Line k runs the FULL draw -> dress -> withdraw cycle offset by k/rays:
  // somewhere a line is always being born while another dies. Perpetual,
  // but every gesture is still an entrance or an exit.
  {
    key: "star-canon", label: "star canon", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 5, size: 0.025,
                             boost: 3.0, patch: 11, halo: 11, cycle: 9,
                             spin: 0.14, window: 0.5 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 6); },
  },

  // -- STAR MORSE — coded dashes and dots marching out the lines -------------
  // Blocks appear as a rhythm of long and short symbols flowing outward,
  // deterministic per line — the star transmitting. loops is both the
  // marching speed and the size of the repeating vocabulary.
  {
    key: "star-morse", label: "star morse", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 8, size: 0.022,
                             boost: 3.0, patch: 11, halo: 11, cycle: 8,
                             spin: 0.12, window: 0.4, loops: 5,
                             trains: { value: 4, min: 1, max: 6, step: 1 } }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 7); },
  },

  // -- STAR DRIZZLE — the constellation twinkles -----------------------------
  // Every station blinks on its own deterministic clock, a soft expo pulse
  // `loops` times a cycle — a shimmer of small blocks over the still star,
  // each sized by its live distance to the eye.
  {
    key: "star-drizzle", label: "star drizzle", statusName: "SPARKING",
    id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 6, size: 0.022,
                             boost: 3.0, patch: 11, halo: 11, cycle: 7,
                             spin: 0.1, window: 0.5, loops: 3,
                             vary: 0.3 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 8); },
  },

  // -- STAR WEAVE HOLD — the fully woven star, parked -------------------------
  // Star weave's dressed look with no entrance and no exit: every line
  // drawn, every station carrying its block, forever. The only motion is
  // the slow spin and the LIVE depth sizing — the ambient hold version.
  {
    key: "star-weave-hold", label: "star weave hold", statusName: "SPARKING",
    id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 5, size: 0.022,
                             boost: 3.2, patch: 13, halo: 12, cycle: 8,
                             spin: 0.16, window: 0.5 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) { starFlowUpdate(S, P, t, 9); },
  },

  // -- STAR COURIER — one eased crossing per line, then the next line --------
  // The comet crosses a line tip to tip in a single SUPER-EASED expo
  // gesture — dead stop at the tip — then switches to the NEXT line around
  // the star. It never retraces a line; its wake evaporates as it lands,
  // so every crossing reads as one clean stroke. loops = rounds of the
  // whole star per cycle, window = wake length.
  {
    key: "star-courier", label: "star courier", statusName: "SPARKING",
    id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 8, size: 0.045,
                             boost: 3.2, patch: 11, halo: 12, cycle: 9,
                             spin: 0.14, window: 0.5, loops: 1 }),
    gen(N, P) { return starLifeXGen(N, P, starAuxRun); },
    update(S, P, t) { starFlowUpdate(S, P, t, 10); },
  },

  // -- STAR EMIT — every arm fires one block, crossing to tip ---------------
  // The simplest emission: each arm spawns a single block at the crossing;
  // the blocks ride their lines outward on the house ease-in-out-expo and
  // die at the tips — then the next emission. `cycle` = seconds between
  // emissions (`loops` fires that many per cycle). `stagger` desyncs the
  // arms by a per-line hash — 0 fires in perfect unison, 1 spreads the
  // emissions across the whole cycle.
  {
    key: "star-emit", label: "star emit", statusName: "SPARKING", id: 39,
    regen: STAR_LIFE_REGEN,
    params: starLifeParams({ "chip lines": 12, stations: 10, size: 0.028,
                             boost: 3.0, patch: 11, halo: 12, cycle: 3,
                             spin: 0.12, window: 0.5, loops: 1,
                             stagger: { value: 0, min: 0, max: 1, step: 0.01 } }),
    gen(N, P) { return starLifeXGen(N, P, starAuxWeave); },
    update(S, P, t) {
      starFlowUpdate(S, P, t, 11, Math.round(Math.min(1, Math.max(0, P.stagger ?? 0)) * 99));
    },
  },

  // -- HELIX RUN — separated chips gliding up the strand (field 22) ----------
  // The helix drawn as plain dots, with a train of SEPARATED block seeds
  // riding it at a constant rate. `ramp` sizes them small -> big -> small
  // along the strand, so each chip swells mid-strand and shrinks toward
  // the ends as it travels. `size` is the biggest (mid-strand) chip.
  {
    key: "helix-run", label: "helix run", statusName: "RUNNING", id: 22,
    regen: ["turns", "radius", "height"],
    params: {
      speed:  { value: 0.35, min: -1.5, max: 1.5, step: 0.01 },
      chips:  { value: 8, min: 1, max: 16, step: 1 },
      size:   { value: 0.010, min: 0.002, max: 0.05, step: 0.001 },
      ramp:   { value: 0.70, min: 0, max: 0.95, step: 0.01 },
      halo:   { value: 6.0, min: 0, max: 14, step: 0.1 },
      boost:  { value: 1.5, min: 0, max: 3, step: 0.05 },
      rest:   { value: 0.55, min: 0, max: 1, step: 0.01 },
      spin:   { value: 0.2, min: -2, max: 2, step: 0.01 },
      turns:  { value: 2.6, min: 1, max: 5, step: 0.1 },
      radius: { value: 0.85, min: 0.3, max: 1.3, step: 0.01 },
      height: { value: 2.3, min: 0.5, max: 4.5, step: 0.05 },
    },
    gen(N, P) {
      const L = new Layout();
      const n = 340;
      const half = P.height / 2;
      for (let i = 0; i < n; i++) {
        const fr = (i / (n - 1)) * 0.999;
        const a = fr * P.turns * TAU;
        L.add(Math.cos(a) * P.radius, half - P.height * fr,
              Math.sin(a) * P.radius, 0.9 * fr, 0.8);
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([t * P.speed, P.size * 0.5, P.halo, P.rest]);
      S.prm2.set([Math.round(P.chips), 0, P.ramp, P.boost]);
    },
  },

  // -- HELIX GLIDE — ONE tapered streak running the whole strand (field 26) --
  // helix run, but solo: instead of a train of chips there is a SINGLE shape
  // riding the strand — a lens. It comes to a point at its tail, swells
  // through its middle and comes back to a point at its head, so it reads as
  // a line that tapers in and out. The swell is real geometry (a ribbon whose
  // cross-section is scaled by the taper), so the fat middle prints solid
  // blocks and the tips thin away to dots. One traverse of the whole path
  // takes `dur` seconds, shaped by a cubic-bezier you write out in full:
  // `ease x1 / y1 / x2 / y2` are the CSS timing-function control points, so
  // anything you can express as cubic-bezier() drops straight in. The default
  // (.87, 0, .13, 1) is expo in-out — holds, flies, holds. y may leave [0,1]
  // to overshoot: back-out is (.34, 1.56, .64, 1), and linear is (0, 0, 1, 1).
  // `snap` then stretches both ends further than any cubic-bezier can reach,
  // steepening the middle by the same factor — a long intro and outro with
  // the expo crack kept intact. 1 = the bezier exactly as written.
  {
    key: "helix-glide", label: "helix glide", statusName: "RUNNING", id: 26,
    regen: ["turns", "radius", "height", "cross", "twist"],
    params: {
      dur:    { value: 4.0, min: 0.4, max: 20, step: 0.1 },
      "ease x1": { value: 0.87, min: 0, max: 1, step: 0.01 },
      "ease y1": { value: 0.00, min: -3, max: 3, step: 0.01 },
      "ease x2": { value: 0.13, min: 0, max: 1, step: 0.01 },
      "ease y2": { value: 1.00, min: -3, max: 3, step: 0.01 },
      snap:   { value: 2.00, min: 1, max: 8, step: 0.05 },
      span:   { value: 0.12, min: 0.02, max: 1, step: 0.01 },
      thick:  { value: 0.11, min: 0, max: 0.5, step: 0.005 },
      bulge:  { value: 1.50, min: 0.2, max: 3, step: 0.05 },
      taper:  { value: 1.00, min: 0, max: 8, step: 0.05 },
      boost:  { value: 3.2, min: 0, max: 6, step: 0.05 },
      halo:   { value: 6.0, min: 0, max: 14, step: 0.1 },
      rest:   { value: 0.85, min: 0, max: 3, step: 0.01 },
      spin:   { value: 0.2, min: -2, max: 2, step: 0.01 },
      twist:  { value: 0, min: -1.57, max: 1.57, step: 0.01 },
      cross:  { value: 11, min: 3, max: 21, step: 2 },
      turns:  { value: 2.6, min: 1, max: 5, step: 0.1 },
      radius: { value: 0.85, min: 0.3, max: 1.3, step: 0.01 },
      height: { value: 2.3, min: 0.5, max: 4.5, step: 0.05 },
    },
    gen(N, P) { return helixRibbon(N, P); },
    update(S, P, t) {
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      const dur = Math.max(0.1, P.dur);
      const u = (((t % dur) + dur) % dur) / dur;
      // the head runs 0 -> 1 + span, so the lens enters from nothing at the
      // top of the cycle and has fully cleared the far end by the wrap
      const e = snapEase(
        bezierEase(u, P["ease x1"], P["ease y1"], P["ease x2"], P["ease y2"]),
        P.snap);
      S.prm.set([e * (1 + P.span), P.span, P.thick, P.rest]);
      S.prm2.set([P.boost, P.halo, P.bulge, P.taper]);
    },
  },

  // -- SCENE 10 — pseudo-3D spiral (stretch) (field 28) ----------------------
  // A 1:1 port of scenes.py's SpiralStretchScene. A helix drawn as a receding
  // ribbon, spinning, with a wave travelling ALONG it: every point stretches
  // into a solid segment at the crest and collapses to a dot at a trough, and
  // perspective scales the near points up. The projection is the source's own
  // hand-rolled divide rather than our camera, so the composition matches —
  // everything lands on z = 0 and the camera only scales it uniformly.
  // Scene 10's constants are baked into the field: FOCAL_FRAC 1.6, WT 75,
  // thickness 0.05..0.4, stretch 1.6..5, gain 4.5, cap 0.78, floor 0.0167,
  // and quadInOut as the wave shaper.
  // ONE departure, deliberate: where the source snaps each bar to the nearest
  // axis — a limit of its own block charset — this keeps the true oriented
  // segment and lets our glyph pass rasterise it.
  {
    key: "scene10-spiral", label: "scene 10 spiral", statusName: "SPIRALLING", id: 28,
    regen: ["points", "turns", "along", "cross", "ribbon", "frame", "radius", "vext"],
    params: {
      frame:  { value: 2.725, min: 0.5, max: 8, step: 0.005 },
      radius: { value: 0.42, min: 0.05, max: 1.2, step: 0.005 },
      vext:   { value: 0.95, min: 0.1, max: 2, step: 0.005 },
      turns:  { value: 2.6, min: 0.5, max: 8, step: 0.05 },
      spin:   { value: 0.5, min: -3, max: 3, step: 0.01 },
      cell:   { value: 0.091, min: 0.005, max: 0.4, step: 0.001 },
      spread: { value: 11.0, min: 1, max: 40, step: 0.1 },
      speed:  { value: 0.96, min: -4, max: 4, step: 0.01 },
      // halo is the block license. It is deliberately LOW: a placed block
      // saturates its cells, and too much of it floods the braille line the
      // blocks are supposed to sit on. 0 = line only, which is the quickest
      // way to check the spiral itself.
      halo:   { value: 0.6, min: 0, max: 14, step: 0.05 },
      bright: { value: 1.0, min: 0.1, max: 4, step: 0.05 },
      points: { value: 96, min: 8, max: 160, step: 1 },
      along:  { value: 7, min: 2, max: 15, step: 1 },   // block patch, across
      cross:  { value: 7, min: 1, max: 15, step: 2 },   // block patch, down
      ribbon: { value: 14, min: 2, max: 30, step: 1 },
    },
    gen(N, P) { return spiral10Layout(N, P); },
    update(S, P, t) {
      for (let k = 0; k < 4; k++) matIdent(S.grp, k);   // the field does it all
      const b = P.bright;
      S.gbri.set([b, b, b, b]);        // aux packs an index, so all four match
      const n = Math.max(4, Math.round(P.points));
      S.prm.set([t * P.spin, P.radius * P.frame, P.vext * P.frame, P.halo]);
      S.prm2.set([P.cell, P.spread, t * P.speed, n]);
    },
  },

  // -- HELIX BLOCKS — a dotted strand with blocks PLACED on it (field 29) ----
  // helix glide's path, but instead of a travelling lens the strand simply
  // carries blocks along its length, and each block is sized by how close it
  // is to the camera. This is a real 3D helix, so that read comes from the
  // lens itself: every block is a screen-facing square of fixed WORLD size,
  // and perspective does the rest — the near half of each turn prints big
  // marks, the far half small ones, and the whole thing breathes as it spins.
  // `depth` pushes that beyond what the lens alone gives when the helix is
  // shallow; `size` is the block at the pivot depth.
  {
    key: "helix-blocks", label: "helix blocks", statusName: "RUNNING", id: 29,
    regen: ["turns", "radius", "height", "line", "blocks", "patch"],
    params: {
      spin:   { value: 0.20, min: -2, max: 2, step: 0.01 },
      // size is the block at the NEAREST point of the turn; everything behind
      // it is smaller, and the far side is not a block at all
      size:   { value: 0.085, min: 0.005, max: 0.6, step: 0.001 },
      // the threshold: how far forward the strand has to come before ANY of it
      // is a block. 0 = blocks all the way round, 0.5 = only the near half of
      // each turn, 0.8 = only the closest stretch. Everything behind it is
      // simply more of the dotted line.
      onset:  { value: 0.45, min: 0, max: 0.95, step: 0.01 },
      // and how they arrive past that threshold: 1 is a straight ramp, higher
      // keeps them small for longer and then blooms toward the camera
      depth:  { value: 2.0, min: 0.1, max: 12, step: 0.05 },
      halo:   { value: 9.0, min: 0, max: 20, step: 0.05 },
      bright: { value: 1.0, min: 0.1, max: 4, step: 0.05 },
      turns:  { value: 2.6, min: 0.5, max: 6, step: 0.05 },
      radius: { value: 0.85, min: 0.1, max: 1.6, step: 0.01 },
      height: { value: 2.3, min: 0.3, max: 4.5, step: 0.05 },
      line:   { value: 460, min: 60, max: 900, step: 10 },
      blocks: { value: 44, min: 4, max: 200, step: 1 },
      patch:  { value: 5, min: 1, max: 11, step: 2 },
    },
    gen(N, P) { return helixBlocksLayout(N, P); },
    update(S, P, t) {
      for (let k = 0; k < 4; k++) matIdent(S.grp, k);   // the field does it all
      const b = P.bright;
      S.gbri.set([b, b, b, b]);
      S.prm.set([t * P.spin, P.radius, P.height, P.halo]);
      S.prm2.set([P.size, P.depth, P.onset, P.turns]);   // closeness off radius
    },
  },

  // -- HELIX TRAIN — the blocks travel the whole path (field 32) -------------
  // helix blocks ties blockness to depth, which pins the blocks to whichever
  // part of the frame happens to be near the camera — they never leave those
  // regions. Here the driver is a window travelling along the PATH: a train of
  // blocks runs the helix end to end, wrapping seamlessly, and depth only
  // shapes what is already inside it, so the carriages swell as they come
  // forward and thin as they go away. `variance` gives the carriages different
  // weights so it reads as a train rather than one smooth ramp.
  {
    key: "helix-train", label: "helix train", statusName: "RUNNING", id: 32,
    regen: ["turns", "radius", "height", "line", "blocks", "patch"],
    params: {
      speed:  { value: 0.16, min: -2, max: 2, step: 0.005 },
      train:  { value: 0.34, min: 0.02, max: 0.99, step: 0.01 },
      // how hard the carriages shrink behind the head. 1 is a plain falloff;
      // higher keeps the weight at the head and lets the tail run a long way
      // down through smaller and smaller blocks before it is just line again.
      taper:  { value: 1.8, min: 0.2, max: 8, step: 0.05 },
      // the lead-in, as a fraction of the train's own length. 0 leaves a hard
      // leading edge — carriages at full size the instant the head passes.
      // Above that the train noses in, so it has a point at BOTH ends.
      nose:   { value: 0.22, min: 0, max: 0.9, step: 0.02 },
      size:   { value: 0.085, min: 0.005, max: 0.6, step: 0.001 },
      variance: { value: 0.55, min: 0, max: 1.5, step: 0.01 },
      depth:  { value: 1.6, min: 0.1, max: 8, step: 0.05 },
      span:   { value: 0.9, min: 0.1, max: 4, step: 0.01 },
      // how many trains ride the helix at once, evenly spaced and all moving
      // together. They share every other setting, so raising this multiplies
      // the figure rather than giving each one its own character.
      trains: { value: 1, min: 1, max: 8, step: 1 },
      spin:   { value: 0.14, min: -2, max: 2, step: 0.01 },
      halo:   { value: 9.0, min: 0, max: 20, step: 0.05 },
      bright: { value: 1.0, min: 0.1, max: 4, step: 0.05 },
      turns:  { value: 2.6, min: 0.5, max: 6, step: 0.05 },
      radius: { value: 0.85, min: 0.1, max: 1.6, step: 0.01 },
      height: { value: 2.3, min: 0.3, max: 4.5, step: 0.05 },
      line:   { value: 460, min: 60, max: 900, step: 10 },
      blocks: { value: 64, min: 4, max: 200, step: 1 },
      patch:  { value: 5, min: 1, max: 11, step: 2 },
    },
    gen(N, P) { return helixTrainLayout(N, P); },
    update(S, P, t) {
      for (let k = 0; k < 4; k++) matIdent(S.grp, k);   // the field does it all
      const b = P.bright;
      S.gbri.set([b, b, b, b]);
      const head = (((t * P.speed) % 1) + 1) % 1;       // wraps, so no seam
      // trains rides in the span channel: an exact multiple of 8 with the
      // span (never more than 4) sitting under it
      const nTrains = Math.min(8, Math.max(1, Math.round(P.trains)));
      S.prm.set([t * P.spin, nTrains * 8 + Math.min(4, Math.max(0.1, P.span)),
                 head, P.halo]);
      // train length and taper share a channel: taper as an exact integer
      // (x20), train length as the fraction under it
      const packed = Math.round(Math.min(8, Math.max(0.2, P.taper)) * 20)
                   + Math.min(0.99, Math.max(0.02, P.train));
      // nose and variance share the last channel the same way
      const packed2 = Math.round(Math.min(0.9, Math.max(0, P.nose)) * 50)
                    + Math.min(0.99, Math.max(0, P.variance) / 2);
      S.prm2.set([P.size, P.depth, packed, packed2]);
    },
  },

  // -- HELIX RAMP — chips in formation, swelling mid-strand (field 22) -------
  // The same strand, but the chips hold a FORMATION: sizes ramp up toward
  // the middle of the line and back down at the ends. `drift` slides the
  // whole formation slowly; 0 parks it.
  {
    key: "helix-ramp", label: "helix ramp", statusName: "RAMPING", id: 22,
    regen: ["turns", "radius", "height"],
    params: {
      drift:  { value: 0.04, min: -0.4, max: 0.4, step: 0.005 },
      chips:  { value: 7, min: 2, max: 14, step: 1 },
      size:   { value: 0.036, min: 0.005, max: 0.12, step: 0.001 },
      ramp:   { value: 0.65, min: 0, max: 0.95, step: 0.01 },
      halo:   { value: 6.5, min: 0, max: 14, step: 0.1 },
      boost:  { value: 1.5, min: 0, max: 3, step: 0.05 },
      rest:   { value: 0.5, min: 0, max: 1, step: 0.01 },
      spin:   { value: 0.2, min: -2, max: 2, step: 0.01 },
      turns:  { value: 2.6, min: 1, max: 5, step: 0.1 },
      radius: { value: 0.85, min: 0.3, max: 1.3, step: 0.01 },
      height: { value: 2.3, min: 0.5, max: 4.5, step: 0.05 },
    },
    gen(N, P) {
      const L = new Layout();
      const n = 340;
      const half = P.height / 2;
      for (let i = 0; i < n; i++) {
        const fr = (i / (n - 1)) * 0.999;
        const a = fr * P.turns * TAU;
        L.add(Math.cos(a) * P.radius, half - P.height * fr,
              Math.sin(a) * P.radius, 0.9 * fr, 0.8);
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matRotY(t * P.spin);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([t * P.drift, P.size * 0.5, P.halo, P.rest]);
      S.prm2.set([Math.round(P.chips), 0, P.ramp, P.boost]);
    },
  },


  // -- SPARK BLOCKS — three takes on depth-driven blocks (field 30) ----------
  // The burst as bare dotted rays, with marks that BECOME blocks as they come
  // toward the camera. Each ray runs through depth, so the gradient plays out
  // along its own length: the tip pointing away stays line, the tip swinging
  // forward carries the weight, and the whole thing breathes as it spins.
  //   onset — how far forward a mark must be before it is a block at all
  //   depth — how it arrives past that: 1 straight ramp, higher holds and blooms
  //   span  — the depth range the ramp is measured over
  //   width / seq / stagger — an optional band racing outward along the rays


  // -- SPARK RIDERS — a bezier-eased block running the rays (field 33) -------
  // One block at a time, expo in-out, ray by ray — and then variations on
  // that: where the run starts and ends, how many blocks share it, whether
  // they convoy down one ray or fire across several at once. Every one is the
  // same solve with different defaults, so the easing controls behave
  // identically across the set.


  // -- DEPTH BLOCKS — size IS the distance cue (field 35) --------------------
  // Everywhere else in this file depth is a shading gradient laid over a
  // roughly flat arrangement. Here it is the subject: the run is metres deep,
  // it streams past the eye, and how big a block is IS how near it is. A block
  // of fixed world size already shrinks as 1/dist through the lens; `boost`
  // scales the world size by (near/dist)^boost on top of that, so on screen
  // the taper runs as 1/dist^(1+boost) — the nearest marks land as slabs and
  // the far ones as single dots, with everything in between reading as a
  // continuous ramp of distance.

  // 1. a tunnel of rings flying at you, twisting as it comes.
  {
    key: "depth-tunnel-block", label: "depth tunnel block", statusName: "DIVING", id: 35,
    regen: DEPTH_BLOCKS_REGEN,
    params: depthBlocksParams({
      dur: 6, size: 0.5, boost: 1.4, near: 0.8, range: 13, roll: 0.05,
      edge: 0.06, halo: 12, bright: 1.05,
      slices: 30, around: 9, bore: 0.85, twist: 0.1, patch: 5,
    }),
    gen(N, P) { return depthBlocksLayout(N, P, 0); },
    update(S, P, t) { depthBlocksUpdate(S, P, t); },
  },

  // 2. a floor running to the horizon — the plainest read of the lot, because
  // the rows are evenly spaced in depth and the size ramp is the only thing
  // that tells you so.
  {
    key: "depth-ground-block", label: "depth ground block", statusName: "TRACKING", id: 35,
    regen: DEPTH_BLOCKS_REGEN,
    params: depthBlocksParams({
      dur: 7, size: 0.46, boost: 1.5, near: 0.9, range: 14, roll: 0,
      edge: 0.05, halo: 12, bright: 1.05,
      slices: 26, around: 11, bore: 1.35, twist: 0, patch: 5,
    }),
    gen(N, P) { return depthBlocksLayout(N, P, 1); },
    update(S, P, t) { depthBlocksUpdate(S, P, t); },
  },

  // 3. a volume of blocks drifting past, scattered through the whole box, so
  // near slabs and far specks share the frame at every moment.
  {
    key: "depth-drift-block", label: "depth drift block", statusName: "DRIFTING", id: 35,
    regen: DEPTH_BLOCKS_REGEN,
    params: depthBlocksParams({
      dur: 9, size: 0.44, boost: 1.6, near: 0.7, range: 15, roll: -0.03,
      edge: 0.07, halo: 11, bright: 1.05,
      slices: 34, around: 7, bore: 1.15, twist: 0, patch: 5,
    }),
    gen(N, P) { return depthBlocksLayout(N, P, 2); },
    update(S, P, t) { depthBlocksUpdate(S, P, t); },
  },

  // -- SPARK BLOOM — out of the crossing on EVERY ray at once (field 34) -----
  // The riders family runs one ray at a time because each rider needs its own
  // channel and there are only four. A bloom needs none: every block leaves
  // the crossing together, so they share one distance-out and a single eased
  // scalar places all of them. That is what lets this one put a block on every
  // ray simultaneously, and as many rings down each ray as you ask for.
  // Stations sit on BOTH halves of every ray, so what grows is a radius.


  // -- 14 · ORB — the latitude-ring globe (reference sketch 2) ---------------
  // Drawn rings instead of stipple; the pole-pulse band sweeps them so each
  // ring blooms as the scan passes, inside a fixed silhouette circle.
  {
    key: "orb", label: "orb", statusName: "SCANNING", id: 2,
    regen: ["rings"],
    params: {
      rings: { value: 5, min: 3, max: 9, step: 1 },
      cycle: { value: 2.6, min: 0.6, max: 6, step: 0.05 },
      bright:{ value: 0.4, min: 0, max: 2, step: 0.05 },
      width: { value: 0.20, min: 0.04, max: 0.6, step: 0.01 },
      disp:  { value: 0.05, min: 0, max: 0.25, step: 0.005 },
      tilt:  { value: 0.14, min: 0, max: 0.8, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      const R = Math.round(P.rings), GAP = 0.012;
      for (let i = 1; i <= R; i++) {
        const th = (Math.PI * i) / (R + 1);
        const st = Math.sin(th), ct = Math.cos(th);
        const n = Math.max(12, Math.round((TAU * st) / GAP));
        for (let j = 0; j < n; j++) {
          const ph = (TAU * j) / n;
          L.add(st * Math.cos(ph), ct, st * Math.sin(ph), 0, 0.5);
        }
      }
      const n = Math.round(TAU / GAP);          // the silhouette circle
      for (let j = 0; j < n; j++) {
        const a = (TAU * j) / n;
        L.add(Math.cos(a), Math.sin(a), 0, 0, 0.6);
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const TRAVEL = 0.82;
      const u = (t / P.cycle) % 1;
      const thetaP = smooth(Math.min(1, u / TRAVEL)) * (Math.PI / 2);
      const env = smooth(u / 0.12) * (1 - smooth((u - TRAVEL) / (1 - TRAVEL)));
      const conv = smooth((thetaP / (Math.PI / 2) - 0.72) / 0.28) * env;
      const m = matMul(matRotX(P.tilt * Math.sin(t * 0.4)),
                       matRotZ(P.tilt * 0.6 * Math.sin(t * 0.31)));
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([thetaP, env * P.bright, 1 / (P.width * P.width),
                 conv * P.bright * 0.8]);
      S.prm2.set([P.disp, 0, 0, 0]);
    },
  },

  // -- GLOBE — dashed latitude rings revealing from the poles ----------------
  // Each ring is a run of dashes (length-jittered, phase-drifted, seq-twisted)
  // and every DOT carries a reveal key baked from a weighted mix of pole
  // order (stagger), per-dash chance (random) and along-dash growth (flow).
  // The update sweeps a reveal phase through the keys each cycle — the globe
  // draws itself out of the pole(s), holds, and redraws.
  {
    key: "globe", label: "globe", statusName: "MAPPING", id: 16,
    regen: ["rings", "radius", "dashes", "fill", "jitter", "drift", "twist",
      "origin", "stagger", "random", "flow"],
    params: {
      rings:   { value: 18, min: 6, max: 40, step: 1 },
      radius:  { value: 0.95, min: 0.4, max: 1.3, step: 0.01 },
      dashes:  { value: 14, min: 3, max: 40, step: 1 },
      fill:    { value: 0.55, min: 0.08, max: 0.95, step: 0.01 },
      jitter:  { value: 0.35, min: 0, max: 1, step: 0.01 },
      drift:   { value: 0.5, min: 0, max: 1, step: 0.01 },
      twist:   { value: 0.12, min: -1, max: 1, step: 0.01 },
      origin:  { value: 2, min: 0, max: 3, step: 1 },
      stagger: { value: 0.55, min: 0, max: 1, step: 0.01 },
      random:  { value: 0.25, min: 0, max: 1, step: 0.01 },
      flow:    { value: 0.6, min: 0, max: 1, step: 0.01 },
      cycle:   { value: 6, min: 1, max: 20, step: 0.1 },
      draw:    { value: 0.55, min: 0.1, max: 1, step: 0.01 },
      soft:    { value: 0.08, min: 0.01, max: 0.5, step: 0.005 },
      head:    { value: 1.2, min: 0, max: 3, step: 0.05 },
      tilt:    { value: 0.32, min: -1, max: 1, step: 0.01 },
      lean:    { value: -0.12, min: -1, max: 1, step: 0.01 },
      spin:    { value: 0, min: -1, max: 1, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      const R = Math.round(P.rings), D = Math.round(P.dashes);
      const h2 = (a, b2) => {
        const s = Math.sin(a * 127.1 + b2 * 311.7) * 43758.5453;
        return s - Math.floor(s);
      };
      const wSum = Math.max(1e-3, P.stagger + P.random + P.flow * 0.6);
      const org = Math.round(P.origin);

      // pass 1 — lay out every dash and measure the total arc length, so dot
      // spacing can fill the WHOLE pool with unique positions (exact-position
      // tiling stacks additive luma and solidifies the disc)
      const dashes = [];
      let total = 0;
      for (let r = 0; r < R; r++) {
        const latAng = (Math.PI * (r + 0.5)) / R;
        const y = Math.cos(latAng) * P.radius;
        const rad = Math.sin(latAng) * P.radius;
        const u = R > 1 ? r / (R - 1) : 0.5;
        // origin: 0 north · 1 south · 2 both poles · 3 equator-out
        let pu;
        if (org === 0) pu = u;
        else if (org === 1) pu = 1 - u;
        else if (org === 2) pu = Math.min(u, 1 - u) * 2;
        else pu = 1 - Math.min(u, 1 - u) * 2;
        const phase0 = P.twist * r * 0.7 + P.drift * h2(r, 1) * TAU;
        const slot = TAU / D;
        for (let d = 0; d < D; d++) {
          const len = slot * P.fill *
            Math.max(0.15, 1 + P.jitter * (h2(r, d + 13) - 0.5) * 1.6);
          const arc = len * Math.max(rad, 0.05);
          dashes.push({ a0: phase0 + d * slot, len, rad, y, pu, rnd: h2(r, d + 7) });
          total += arc;
        }
      }
      const gap = Math.max(0.0035, total / Math.max(1, N * 0.98));

      for (const ds of dashes) {
        const n = Math.max(2, Math.round((ds.len * Math.max(ds.rad, 0.05)) / gap));
        // rings crowd toward the poles — dim them in proportion so the
        // projected density stays even, like the reference globes
        const bri = 0.32 * (0.5 + 0.5 * (ds.rad / P.radius));
        for (let i = 0; i < n; i++) {
          const f = n > 1 ? i / (n - 1) : 0;
          const a = ds.a0 + f * ds.len;
          let key = (ds.pu * P.stagger + ds.rnd * P.random + f * P.flow * 0.6) / wSum;
          key = Math.min(0.985, Math.max(0, key * 0.97 + 0.005));
          L.add(ds.rad * Math.cos(a), ds.y, ds.rad * Math.sin(a), key, bri);
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matMul(matMul(matRotX(P.tilt), matRotZ(P.lean)), matRotY(t * P.spin));
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      const u2 = (t / P.cycle) % 1;
      const ph = Math.min(1, u2 / Math.max(0.05, P.draw));
      S.prm.set([ph, P.soft, 1 / Math.max(0.02, P.soft), P.head]);
      S.prm2.set([0, 0, 0, 0]);
    },
  },

  // -- 15 · COIL — parallel rings spooled along a tipped axis (sketch 2) -----
  {
    key: "coil", label: "coil", statusName: "SPOOLING", id: 6,
    regen: ["rings", "radius", "step"],
    params: {
      rings:  { value: 3, min: 2, max: 6, step: 1 },
      radius: { value: 0.62, min: 0.3, max: 1.0, step: 0.01 },
      step:   { value: 0.30, min: 0.1, max: 0.8, step: 0.01 },
      spin:   { value: 0, min: -1, max: 1, step: 0.01 },
      sway:   { value: 0.16, min: 0, max: 0.6, step: 0.01 },
      waves:  { value: 2.0, min: 0.5, max: 5, step: 0.05 },
      speed:  { value: 1.1, min: 0, max: 3, step: 0.01 },
      rest:   { value: 0.45, min: 0, max: 1, step: 0.01 },
      amp:    { value: 1.3, min: 0, max: 4, step: 0.05 },
      // block license — how much the ring crests may bloom to blocks
      blocks: { value: 1, min: 0, max: 1, step: 0.01 },
    },
    gen(N, P) {
      const L = new Layout();
      const R = Math.round(P.rings), GAP = 0.008;
      const ax = [0.82, 0.42, -0.39];             // the spool axis, tipped
      let ux = -ax[2], uy = 0, uz = ax[0];        // ⊥ basis for the ring plane
      const ul = Math.hypot(ux, uy, uz);
      ux /= ul; uz /= ul;
      const vx = ax[1] * uz - ax[2] * uy, vy = ax[2] * ux - ax[0] * uz,
            vz = ax[0] * uy - ax[1] * ux;
      for (let k = 0; k < R; k++) {
        const c = (k - (R - 1) / 2) * P.step;
        const n = Math.max(24, Math.round((TAU * P.radius) / GAP));
        for (let j = 0; j < n; j++) {
          const a = (TAU * j) / n;
          const co = Math.cos(a) * P.radius, si = Math.sin(a) * P.radius;
          L.add(ax[0] * c + ux * co + vx * si,
                ax[1] * c + uy * co + vy * si,
                ax[2] * c + uz * co + vz * si,
                k + (j / n) * 0.9, 0.55);
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const m = matMul(matRotX(P.sway * Math.sin(t * 0.5)), matRotY(t * P.spin));
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([P.waves * TAU, t * P.speed * 2.5, 3.0, P.rest]);
      S.prm2.set([P.amp, P.blocks ?? 1, 0, 0]);
    },
  },

  // ========================================================================
  // THE PORTRAIT FAMILY — six grid / math loops composed for a 9:16
  // (1080 x 1920) portrait frame. Layouts span x ±PORT_W, y ±PORT_H
  // (PORT_H / PORT_W = 16/9); every phase in update derives from
  // u = (t / cycle) % 1 with INTEGER wave counts, so each mode repeats
  // byte-identically every `cycle` seconds — record one cycle, loop forever.
  // ========================================================================

  // -- 19 · RIPPLE — two-source interference down the tall axis --------------
  {
    key: "ripple", label: "ripple", statusName: "RIPPLING", id: 12, regen: [],
    params: {
      cycle:   { value: 6.0, min: 2, max: 16, step: 0.5 },
      beats:   { value: 2, min: 1, max: 6, step: 1 },
      wavelen: { value: 0.40, min: 0.15, max: 0.9, step: 0.01 },
      spread:  { value: 1.0, min: 0.2, max: 1.2, step: 0.01 },
      rest:    { value: 0.28, min: 0, max: 1, step: 0.01 },
      gain:    { value: 2.6, min: 0, max: 6, step: 0.05 },
      pow:     { value: 1.8, min: 1, max: 5, step: 0.05 },
      bulge:   { value: 0.10, min: 0, max: 0.4, step: 0.005 },
    },
    gen(N) {
      const L = new Layout();
      const NXD = 33, NYD = Math.round((NXD * 16) / 9);
      for (let j = 0; j < NYD; j++)
        for (let i = 0; i < NXD; i++)
          L.add((((i + 0.5) / NXD) * 2 - 1) * PORT_W,
                (((j + 0.5) / NYD) * 2 - 1) * PORT_H, 0, 0, 0.7);
      return L.bake(N);
    },
    update(S, P, t) {
      for (let k = 0; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      const u = (t / P.cycle) % 1;
      S.prm.set([0, P.spread * PORT_H, TAU * Math.round(P.beats) * u,
                 TAU / P.wavelen]);
      S.prm2.set([P.rest, P.gain, P.pow, P.bulge]);
    },
  },

  // -- 21 · SEAM SOLO — seam_cycle.py scene 4, ported 1:1 --------------------
  // Four great circles through two shared poles, each drawn by ONE runner
  // with a long comet tail (0.42 of a lap) and a half-lap launch offset. The
  // runners never stop: phase advances at a constant RATE all cycle; the
  // lifecycle rides on top — seams enter staggered (the solved expo stagger),
  // trails fan out of the pole, and on the outro launch + trail collapse so
  // each comet shrinks out. Empty frame at the wrap; the loop closes exactly.
  //
  // Per-frame scalars ride the slot exactly: gbri = per-seam envelope,
  // prm = head angle phi, prm2 = trail start t0. The group matrix carries the
  // seam plane (rotation about the pole axis by psi = pi*k/M + SPIN*tl), so
  // the shader (id 17) only walks theta = mix(t0, phi, frac).
  {
    key: "seam-solo", label: "seam solo", statusName: "RUNNING", id: 17,
    regen: ["seams", "head"],
    params: {
      cycle:  { value: 11.0, min: 4, max: 22, step: 0.1 },
      rate:   { value: 0.55, min: 0, max: 1.5, step: 0.01 },
      spin:   { value: 0.10, min: -0.5, max: 0.5, step: 0.01 },
      seams:  { value: 4, min: 1, max: 4, step: 1 },
      trail:  { value: 0.42, min: 0.05, max: 0.9, step: 0.01 },
      launch: { value: 0.50, min: 0, max: 1, step: 0.01 },
      size:   { value: 1.0, min: 0.4, max: 1.4, step: 0.01 },
      head:   { value: 1.15, min: 0, max: 3, step: 0.05 },
    },
    gen(N, P) {
      // 96 slots per seam ~ the helix hairline density; the last slot is the
      // head chip. aux packs seam + 0.9 * trail fraction; the layout position
      // is only the mid-hold rest pose, a spatial anchor for rank-matching
      // (the shader replaces it from the uniforms every frame).
      const L = new Layout();
      const M = Math.max(1, Math.min(4, Math.round(P.seams)));
      const nT = 96;
      const tlMid = 0.5 * P.cycle;
      const phiMid = P.launch * TAU + P.rate * tlMid;
      const t0Mid = Math.max(0, phiMid - P.trail * TAU);
      for (let k = 0; k < M; k++) {
        const bx = seamBx(Math.PI * k / M + tlMid * P.spin);
        for (let j = 0; j < nT; j++) {
          const frac = j / (nT - 1);
          const th = t0Mid + (phiMid - t0Mid) * frac;
          const c = Math.cos(th), s = Math.sin(th);
          L.add((c * SEAM_AX[0] + s * bx[0]) * P.size,
                (c * SEAM_AX[1] + s * bx[1]) * P.size,
                (c * SEAM_AX[2] + s * bx[2]) * P.size,
                k + 0.9 * frac,
                j === nT - 1 ? 3.0 * P.head : 0.85);
        }
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const cyc = Math.max(0.1, P.cycle);
      const u = ((t % cyc) + cyc) % cyc / cyc;
      const tl = u * cyc;
      // seam_cycle's phases: intro [0, .22], run, outro [.80, 1]
      const a = Math.min(1, Math.max(0, u / 0.22));
      const b = Math.min(1, Math.max(0, (u - 0.80) / 0.20));
      const M = Math.max(1, Math.min(4, Math.round(P.seams)));
      for (let k = 0; k < 4; k++) {
        if (k >= M) {
          matIdent(S.grp, k);
          S.gbri[k] = 0; S.prm[k] = 0; S.prm2[k] = 0;
          continue;
        }
        const env = seamStag(a, k, M) * (1 - seamStag(b, k, M));
        const bx = seamBx(Math.PI * k / M + tl * P.spin);
        const nx = [SEAM_AX[1] * bx[2] - SEAM_AX[2] * bx[1],
                    SEAM_AX[2] * bx[0] - SEAM_AX[0] * bx[2],
                    SEAM_AX[0] * bx[1] - SEAM_AX[1] * bx[0]];
        const sz = P.size;
        put(S.grp, k, [SEAM_AX[0] * sz, SEAM_AX[1] * sz, SEAM_AX[2] * sz,
                       bx[0] * sz, bx[1] * sz, bx[2] * sz,
                       nx[0] * sz, nx[1] * sz, nx[2] * sz]);
        const phi = env * (P.launch * TAU) + P.rate * tl;
        S.gbri[k] = env <= 0.001 ? 0 : env;
        S.prm[k] = phi;
        S.prm2[k] = Math.max(0, phi - env * (P.trail * TAU));
      }
    },
  },


  // ===========================================================================
  // THE STATE TRIOS (2026-07-22) — three candidates for each Sequence state,
  // all built on the seam-solo DNA: violent ease-in-out-expo, a true
  // intro/outro lifecycle, and motion that reveals an INVISIBLE form without
  // ever drawing it. Blocks are authored: tip chips, sweep heads, movers.
  // ===========================================================================

  // -- FINDING — trails searching an unseen surface (field 17) ---------------

  // find · sweep: ONE comet on an invisible Archimedean spiral. It enters
  // at the centre, spirals outward at constant angular rate — revealing the
  // dish only where it passes — and runs off the outer edge. The trail draws
  // itself on and erases itself off: one sweep in, one sweep out, no stops.
  {
    key: "find-sweep", label: "find sweep", statusName: "FINDING", id: 21,
    regen: ["head"],
    params: {
      cycle: { value: 8.0, min: 4, max: 16, step: 0.1 },
      turns: { value: 3.2, min: 1.5, max: 5, step: 0.1 },
      trail: { value: 0.85, min: 0.3, max: 1.6, step: 0.01 },
      inner: { value: 0.1, min: 0, max: 0.4, step: 0.01 },
      dish:  { value: 1.0, min: 0.2, max: 1.5, step: 0.01 },
      drift: { value: 0.1, min: 0, max: 0.5, step: 0.01 },
      size:  { value: 1.05, min: 0.5, max: 1.6, step: 0.01 },
      head:  { value: 1.15, min: 0, max: 3, step: 0.05 },
    },
    gen(N, P) {
      // slots along the sliding trail window; rest pose = mid-path arc
      const L = new Layout();
      const nT = 150;
      const thEnd = P.turns * TAU, len = P.trail * TAU;
      const grow = (1.05 - P.inner) / thEnd;
      for (let j = 0; j < nT; j++) {
        const frac = j / (nT - 1);
        const th = thEnd * 0.55 + (frac - 1) * len;
        const r = P.inner + grow * th;
        L.add(Math.cos(th) * r, Math.sin(th) * r, 0,
              0.9 * frac,
              j === nT - 1 ? 2.6 * P.head : 0.85);
      }
      return L.bake(N);
    },
    update(S, P, t) {
      const cyc = Math.max(0.1, P.cycle);
      const u = (((t % cyc) + cyc) % cyc) / cyc;
      const tl = u * cyc;
      const thEnd = P.turns * TAU, len = P.trail * TAU;
      // constant angular speed over the whole journey, window sliding
      // straight through the path: empty -> draw on -> travel -> run off
      const phi = u * (thEnd + len);
      put(S.grp, 0, matScale(matMul(matRotY(tl * P.drift), matRotX(P.dish)), P.size));
      for (let k = 1; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([phi, phi - len, P.inner, (1.05 - P.inner) / thEnd]);
      S.prm2.set([thEnd, 0, 0, 0]);
    },
  },

  // find · orbits: four equal arcs on planes fanned about an invisible
  // sphere, adjacent orbits sweeping in OPPOSITE directions — the volume is
  // implied by trails that keep crossing where the surface would be.
  {
    key: "find-orbits", label: "find orbits", statusName: "FINDING", id: 17,
    regen: ["orbits", "head"],
    params: {
      cycle:  { value: 7.5, min: 4, max: 14, step: 0.1 },
      rate:   { value: 0.8, min: 0.2, max: 2.5, step: 0.01 },
      trail:  { value: 0.3, min: 0.06, max: 0.5, step: 0.01 },
      spread: { value: 1.05, min: 0.3, max: 1.4, step: 0.01 },
      drift:  { value: 0.07, min: 0, max: 0.4, step: 0.01 },
      orbits: { value: 4, min: 2, max: 4, step: 1 },
      size:   { value: 1.05, min: 0.5, max: 1.4, step: 0.01 },
      head:   { value: 1.1, min: 0, max: 3, step: 0.05 },
    },
    gen(N, P) { return trailGen(N, P, () => 1, "orbits"); },
    update(S, P, t) {
      trailLife(S, P, t, (g, tl) => {
        const G = Math.max(2, Math.round(P.orbits));
        const incline = 0.35 + P.spread * (g / (G - 1));
        const M = matMul(matRotY(g * 2.4 + tl * P.drift), matRotX(incline));
        return matScale(M, (0.86 + 0.06 * g) * P.size);
      }, (g, tl) => {
        const dir = g % 2 ? -1 : 1;
        return dir * P.rate * tl + g * 1.7;
      }, "orbits");
    },
  },

  // find · weave: three nested trails on concentric invisible rings, each
  // gliding at constant speed AGAINST its neighbours — scanning as opposing
  // flow. The comets never stop; only their tails sweep in and out once.
  {
    key: "find-weave", label: "find weave", statusName: "FINDING", id: 17,
    regen: ["rings", "head"],
    params: {
      cycle: { value: 7.0, min: 4, max: 14, step: 0.1 },
      rate:  { value: 1.0, min: 0.2, max: 2.5, step: 0.01 },
      trail: { value: 0.3, min: 0.06, max: 0.6, step: 0.01 },
      dish:  { value: 0.85, min: 0.2, max: 1.5, step: 0.01 },
      drift: { value: 0.08, min: 0, max: 0.5, step: 0.01 },
      rings: { value: 3, min: 2, max: 4, step: 1 },
      size:  { value: 1.1, min: 0.5, max: 1.4, step: 0.01 },
      head:  { value: 1.15, min: 0, max: 3, step: 0.05 },
    },
    gen(N, P) { return trailGen(N, P, weaveRadius); },
    update(S, P, t) {
      trailLife(S, P, t, (g, tl) => {
        const M = matMul(matRotY(tl * P.drift), matRotX(P.dish));
        return matScale(M, weaveRadius(g, P) * P.size);
      }, (g, tl) => {
        const dir = g % 2 ? -1 : 1;                 // neighbours oppose
        return dir * P.rate * tl * (1 + 0.18 * g) + g * 2.1;
      });
    },
  },

  // -- COMPARING — one block bursts into six armed chips (field 19) ----------

  // compare · axis: the block detonates into six arms along ±X ±Y ±Z — an
  // invisible octahedron sketched only by its spokes — tumbling gently the
  // whole cycle, block and burst alike.
  {
    key: "compare-axis", label: "compare axis", statusName: "COMPARING", id: 19,
    regen: ["len", "arms"],
    params: {
      cycle: { value: 6.5, min: 4, max: 12, step: 0.1 },
      len:   { value: 0.95, min: 0.5, max: 1.3, step: 0.01 },
      rest:  { value: 0.06, min: 0.02, max: 0.16, step: 0.005 },
      turn:  { value: 0.30, min: 0, max: 0.5, step: 0.01 },
      tip:   { value: 1.0, min: 0, max: 1.5, step: 0.05 },
      core:  { value: 0.95, min: 0, max: 1.5, step: 0.05 },
      arms:  { value: 6, min: 4, max: 8, step: 1 },
      stagger:{ value: 1.0, min: 0.2, max: 1, step: 0.01 },
    },
    gen(N, P) { return burstGen(N, P, burstDirsAxis(Math.round(P.arms))); },
    update(S, P, t) {
      const { master, u } = burstPhase(t, P);
      const a = u * P.turn * TAU;
      put(S.grp, 0, matMul(matRotX(0.42 + a * 0.62), matRotY(0.31 + a)));
      for (let k = 1; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([master, P.rest, P.tip, P.core]);
      S.prm2.set([Math.round(P.arms), P.stagger, 0, 0]);
    },
  },

  // compare · star: the same detonation held flat to the camera — a six-arm
  // asterisk that rolls in its own plane with a breath of 3D wobble, crisp
  // as a stamped emblem, then folds back to the block.
  {
    key: "compare-star", label: "compare star", statusName: "COMPARING", id: 19,
    regen: ["len", "arms"],
    params: {
      cycle: { value: 6.0, min: 4, max: 12, step: 0.1 },
      len:   { value: 1.0, min: 0.5, max: 1.3, step: 0.01 },
      rest:  { value: 0.06, min: 0.02, max: 0.16, step: 0.005 },
      turn:  { value: 0.22, min: 0, max: 0.5, step: 0.01 },
      wobble:{ value: 0.14, min: 0, max: 0.5, step: 0.01 },
      tip:   { value: 1.05, min: 0, max: 1.5, step: 0.05 },
      core:  { value: 0.95, min: 0, max: 1.5, step: 0.05 },
      arms:  { value: 6, min: 4, max: 8, step: 1 },
      stagger:{ value: 1.0, min: 0.2, max: 1, step: 0.01 },
    },
    gen(N, P) { return burstGen(N, P, burstDirsStar(Math.round(P.arms), 0)); },
    update(S, P, t) {
      const { master, u } = burstPhase(t, P);
      const roll = u * P.turn * TAU;
      // wobble rides sin(u·TAU) — periodic in u, so the loop stays seamless
      put(S.grp, 0, matMul(matRotX(P.wobble * Math.sin(u * TAU)), matRotZ(roll)));
      for (let k = 1; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([master, P.rest, P.tip, P.core]);
      S.prm2.set([Math.round(P.arms), P.stagger, 0, 0]);
    },
  },

  // compare · relay: the arms deploy ONE BY ONE around the clock — each
  // snaps out expo-hard, plants its chip, and the ring of evidence builds —
  // then they withdraw in reverse while the whole slowly rotates.
  {
    key: "compare-relay", label: "compare relay", statusName: "COMPARING", id: 19,
    regen: ["len", "arms"],
    params: {
      cycle: { value: 7.5, min: 4, max: 14, step: 0.1 },
      len:   { value: 1.0, min: 0.5, max: 1.3, step: 0.01 },
      rest:  { value: 0.06, min: 0.02, max: 0.16, step: 0.005 },
      turn:  { value: 0.30, min: 0, max: 0.5, step: 0.01 },
      cone:  { value: 0.26, min: 0, max: 0.6, step: 0.01 },
      tip:   { value: 1.05, min: 0, max: 1.5, step: 0.05 },
      core:  { value: 0.95, min: 0, max: 1.5, step: 0.05 },
      arms:  { value: 6, min: 4, max: 8, step: 1 },
      stagger:{ value: 0.42, min: 0.2, max: 1, step: 0.01 },
    },
    gen(N, P) { return burstGen(N, P, burstDirsStar(Math.round(P.arms), P.cone)); },
    update(S, P, t) {
      const { master, u } = burstPhase(t, P);
      // a full multi-axis tumble — X, Y and Z advance at different rates so
      // the cone arms' depth reads from every moment of the cycle; all three
      // are u-locked, so the wrap jump still hides in the tiny rest block
      const a = u * P.turn * TAU;
      put(S.grp, 0, matMul(matMul(matRotX(0.2 + a * 0.55), matRotY(a * 0.8)),
                           matRotZ(a)));
      for (let k = 1; k < 4; k++) matIdent(S.grp, k);
      S.gbri.set([1, 1, 1, 1]);
      S.prm.set([master, P.rest, P.tip, P.core]);
      S.prm2.set([Math.round(P.arms), P.stagger, 0, 0]);
    },
  },

  // -- ARRANGING — the pool migrates between two arrangements (field 20) -----

  // arrange · stack: a fanned hand of seven rods and an even stack, with a
  // bouncing front sweeping between them — every rod a hard expo flight that
  // glows while it moves; the front never rests.
  {
    key: "arrange-stack", label: "arrange stack", statusName: "ARRANGING", id: 20,
    regen: [],
    params: {
      cycle:  { value: 8.0, min: 4, max: 16, step: 0.1 },
      window: { value: 0.55, min: 0.15, max: 1, step: 0.01 },
      hot:    { value: 0.9, min: 0, max: 1.5, step: 0.05 },
      size:   { value: 1.0, min: 0.5, max: 1.4, step: 0.01 },
    },
    gen(N) { return stackGen(N); },
    update(S, P, t) { migrateLife(S, P, t, 7); },
  },

  // arrange · rings: one rim circle peels inward, ring by ring, into four
  // concentric circles on a tilted disc — then the front reflects and the
  // rings pour back out to the rim. Radial choreography, no noise.
  {
    key: "arrange-rings", label: "arrange rings", statusName: "ARRANGING", id: 20,
    regen: [],
    params: {
      cycle:  { value: 8.0, min: 4, max: 16, step: 0.1 },
      window: { value: 0.55, min: 0.15, max: 1, step: 0.01 },
      // ring dots ride single file (no stacking), so the authored block
      // intensity needs real amplitude to cross the quadrant threshold
      hot:    { value: 5.0, min: 0, max: 6, step: 0.05 },
      size:   { value: 1.0, min: 0.5, max: 1.4, step: 0.01 },
    },
    gen(N) { return ringsGen(N); },
    update(S, P, t) { migrateLife(S, P, t, 4); },
  },

  // arrange · crystal: the hex lattice, dilated and turned half a step,
  // focuses into place band by band from the heart outward — a crystal
  // condensing — then the front reflects and it dilates away again.
  {
    key: "arrange-crystal", label: "arrange crystal", statusName: "ARRANGING", id: 20,
    regen: [],
    params: {
      cycle:  { value: 7.5, min: 4, max: 16, step: 0.1 },
      window: { value: 0.42, min: 0.15, max: 1, step: 0.01 },
      hot:    { value: 0.8, min: 0, max: 1.5, step: 0.05 },
      size:   { value: 1.0, min: 0.5, max: 1.4, step: 0.01 },
    },
    gen(N) { return crystalGen(N); },
    update(S, P, t) { migrateLife(S, P, t, 8); },
  },

  // -- CRYSTAL CHIPS (field 23) — the still hex lattice with a FEW authored
  // block sites blooming in sequence, each an expo-in/expo-out pulse that
  // hands off to the next. Three placements, all snapped to exact lattice
  // sites so the blocks feel set, not scattered.

  // crystal · clock: a ring of sites at mid-radius, lit around the dial.
  {
    key: "crystal-clock", label: "crystal clock", statusName: "SEQUENCING", id: 23,
    regen: ["sites", "size"],
    params: {
      cycle: { value: 7.5, min: 3, max: 16, step: 0.1 },
      sites: { value: 6, min: 3, max: 8, step: 1 },
      size:  { value: 0.032, min: 0.012, max: 0.06, step: 0.001 },
      halo:  { value: 7.0, min: 0, max: 14, step: 0.1 },
      boost: { value: 1.7, min: 0, max: 3, step: 0.05 },
      rest:  { value: 0.55, min: 0, max: 1, step: 0.01 },
      flow:  { value: 1.1, min: 0.4, max: 2, step: 0.01 },
      spin:  { value: 0.06, min: -0.5, max: 0.5, step: 0.005 },
    },
    gen(N, P) {
      const S = Math.round(P.sites), sites = [];
      for (let k = 0; k < S; k++) {
        const a = Math.PI / 2 - (TAU * k) / S;      // clockwise from the top
        const p = hexSite(Math.cos(a) * 0.65, Math.sin(a) * 0.65);
        sites.push({ x: p.x, y: p.y, si: k });
      }
      return crystalChipGen(N, sites, P.size);
    },
    update(S, P, t) { chipClock(S, P, t, Math.round(P.sites)); },
  },

  // crystal · steps: five sites in a straight lattice row, lit left to
  // right like a scale being climbed, then round again.
  {
    key: "crystal-steps", label: "crystal steps", statusName: "SEQUENCING", id: 23,
    regen: ["size"],
    params: {
      cycle: { value: 6.5, min: 3, max: 16, step: 0.1 },
      size:  { value: 0.032, min: 0.012, max: 0.06, step: 0.001 },
      halo:  { value: 7.0, min: 0, max: 14, step: 0.1 },
      boost: { value: 1.7, min: 0, max: 3, step: 0.05 },
      rest:  { value: 0.55, min: 0, max: 1, step: 0.01 },
      flow:  { value: 1.1, min: 0.4, max: 2, step: 0.01 },
      spin:  { value: 0.04, min: -0.5, max: 0.5, step: 0.005 },
    },
    gen(N, P) {
      const sites = [-8, -4, 0, 4, 8].map((col, i) => {
        const p = hexSite(col * 0.088, 0);
        return { x: p.x, y: p.y, si: i };
      });
      return crystalChipGen(N, sites, P.size);
    },
    update(S, P, t) { chipClock(S, P, t, 5); },
  },

  // crystal · pulse: centre, then an inner trio, then an outer trio — the
  // sequence radiates outward in shells and wraps back to the heart.
  {
    key: "crystal-pulse", label: "crystal pulse", statusName: "SEQUENCING", id: 23,
    regen: ["size"],
    params: {
      cycle: { value: 6.0, min: 3, max: 16, step: 0.1 },
      size:  { value: 0.032, min: 0.012, max: 0.06, step: 0.001 },
      halo:  { value: 7.0, min: 0, max: 14, step: 0.1 },
      boost: { value: 1.7, min: 0, max: 3, step: 0.05 },
      rest:  { value: 0.55, min: 0, max: 1, step: 0.01 },
      flow:  { value: 1.1, min: 0.4, max: 2, step: 0.01 },
      spin:  { value: 0.05, min: -0.5, max: 0.5, step: 0.005 },
    },
    gen(N, P) {
      const sites = [{ x: 0, y: 0, si: 0 }];
      for (let k = 0; k < 3; k++) {               // inner trio, two sites out
        const a = (TAU * k) / 3;
        const p = hexSite(Math.cos(a) * 0.176, Math.sin(a) * 0.176);
        sites.push({ x: p.x, y: p.y, si: 1 });
      }
      for (let k = 0; k < 3; k++) {               // outer trio, offset 60°
        const a = (TAU * k) / 3 + Math.PI / 3;
        const p = hexSite(Math.cos(a) * 0.72, Math.sin(a) * 0.72);
        sites.push({ x: p.x, y: p.y, si: 2 });
      }
      return crystalChipGen(N, sites, P.size);
    },
    update(S, P, t) { chipClock(S, P, t, 3); },
  },

];

// seam-solo's fixed geometry + lifecycle machinery (wire_cycle.py, verbatim):
// the pole axis, its perpendicular frame, and the solved window stagger.
const SEAM_AX = (() => {
  const v = [-0.88, 0.30, -0.37];
  const d = Math.hypot(...v);
  return v.map((x) => x / d);
})();
const SEAM_P1 = (() => {
  const c = [-SEAM_AX[2], 0, SEAM_AX[0]];          // cross(ax, +Y)
  const d = Math.hypot(...c);
  return c.map((x) => x / d);
})();
const SEAM_P2 = [SEAM_AX[1] * SEAM_P1[2] - SEAM_AX[2] * SEAM_P1[1],
                 SEAM_AX[2] * SEAM_P1[0] - SEAM_AX[0] * SEAM_P1[2],
                 SEAM_AX[0] * SEAM_P1[1] - SEAM_AX[1] * SEAM_P1[0]];

function seamBx(psi) {
  const c = Math.cos(psi), s = Math.sin(psi);
  return [SEAM_P1[0] * c + SEAM_P2[0] * s,
          SEAM_P1[1] * c + SEAM_P2[1] * s,
          SEAM_P1[2] * c + SEAM_P2[2] * s];
}

/** wire_cycle's _stag: element k of n across progress p, expo windows of
    width W = 0.55 whose starts spread so the last lands exactly at p = 1. */
function seamStag(p, k, n) {
  const W = 0.55;
  if (n <= 1) return expoInOut(Math.min(1, Math.max(0, p)));
  const s = (k / (n - 1)) * (1 - W);
  return expoInOut(Math.min(1, Math.max(0, (p - s) / W)));
}

export const MODE_BY_KEY = Object.fromEntries(MODES.map((m) => [m.key, m]));

/* The 87 labels are not arbitrary — 75 of them share a first word with at
   least two others (zoom 25, star 24, helix 6, cube 5, and five families of
   three). Presented flat that reads as 87 near-identical names; grouped by
   the family already in the naming it reads as nine things with variants.
   Ten labels also end in " blocks", which is a variant tag, not part of the
   name. Both facts come out of the data — nothing is invented here. */
const FAMILY_MIN = 3;

export function modeFamilies() {
  const counts = new Map();
  for (const m of MODES) {
    const w = m.label.split(" ")[0];
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const groups = new Map();
  const rest = [];
  for (const m of MODES) {
    const w = m.label.split(" ")[0];
    const entry = { ...m, ...variantOf(m.label) };
    if ((counts.get(w) || 0) >= FAMILY_MIN) {
      if (!groups.has(w)) groups.set(w, []);
      groups.get(w).push(entry);
    } else {
      rest.push(entry);
    }
  }
  const out = [...groups.entries()].map(([name, modes]) => ({ name, modes }));
  out.sort((a, b) => b.modes.length - a.modes.length);
  if (rest.length) out.push({ name: "other", modes: rest });
  return out;
}

/** "zoom out blocks" -> { short: "zoom out", tag: "blocks" }. */
function variantOf(label) {
  const m = /^(.*) blocks$/.exec(label);
  return m ? { short: m[1], tag: "blocks" } : { short: label, tag: null };
}

/** Current tweak values for a mode (mutated live by the panel). */
export function paramValues(mode) {
  if (!mode._values) {
    mode._values = {};
    for (const [k, spec] of Object.entries(mode.params)) mode._values[k] = spec.value;
  }
  return mode._values;
}


// ===========================================================================
// State-trio machinery — the shared choreography under FINDING / COMPARING /
// ARRANGING. All easing is the house ease-in-out-expo; every lifecycle uses
// the solved window stagger (the last element lands exactly at phase end).
// ===========================================================================

/** The solved stagger with a free window (seamStag generalised). */
function stagW(p, k, n, w) {
  if (n <= 1) return expoInOut(Math.min(1, Math.max(0, p)));
  const s = (k / (n - 1)) * (1 - w);
  return expoInOut(Math.min(1, Math.max(0, (p - s) / w)));
}

// ---- FINDING (field 17: per-group trails with phi / t0 / env) --------------

const weaveRadius = (g, P) => 0.45 + 0.3 * g * (2 / Math.max(1, Math.round(P.rings) - 1));

/** Trail layout: G groups of slots along the trail fraction; the rest pose
    (mid-cycle) is only a rank-matching anchor — field 17 recomputes theta. */
/** Layout.bake with a per-slot NORMAL alongside the position — slots are flat
    with stride 8: x y z nx ny nz aux bri. (Layout itself carries no normal;
    only the ribbon modes need one, so they bake through here.) */
/** One line of the star — azimuth, out-of-plane lean and arm length with the
    seeded per-LINE jitter resolved. Shared by star and star-blocks so both
    modes dress the very same lines. Even azimuths: a line is pi apart from
    itself, so pi/R spacing makes all 2R arms even; angle jitter stays under
    a third of that spacing so neighbours never trade places; lean jitter
    keeps a small floor so vary still breathes depth into a dead-flat (fan 0)
    star; length jitter moves BOTH halves together so the midpoint of every
    line stays exactly on the crossing. */
function starLine(P, k) {
  const DEG = Math.PI / 180;
  const R = Math.max(2, Math.round(P.rays));
  const sd = Math.round(P.seed) * 977;
  const jit = (c) => hash01(sd + k * 131 + c) * 2 - 1;   // -1..1
  return {
    az: P.angle * DEG + (k / R) * Math.PI
      + jit(1) * P.vary * (Math.PI / R) * 0.33,
    lean: P.fan * DEG + jit(2) * P.vary * (0.3 * P.fan * DEG + 4 * DEG),
    len: P.len * (1 - 0.45 * P.vary * hash01(sd + k * 131 + 3)),
  };
}

/** The line's two unit arms: elevation side*lean - cone, azimuth az / az+pi.
    cone is the one control allowed to kink a line at the crossing. */
function starArm(ln, coneR, side) {
  const a = side > 0 ? ln.az : ln.az + Math.PI;
  const e = side * ln.lean - coneR;
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

// ---- the star-life family (field 37) ---------------------------------------
// The block star as a self-contained LOOP: rays draw out of the crossing,
// blocks choreograph in sequence (each mode a different order/behaviour),
// everything withdraws — one `cycle`, every gesture the house expo, and the
// frame is empty at the wrap so any spin rate loops clean. Depth sizing is
// field 36's live eye-distance rule throughout.

/** The controls the family shares; each mode overrides what gives it its
    character. `window` is the width of every staggered gesture (small =
    strict one-by-one, large = overlapped wave); `loops` counts the laps of
    the mid-cycle behaviour where the pattern has one. */
function starLifeParams(o = {}) {
  const base = {
    rays:  { value: 5, min: 2, max: 12, step: 1 },
    len:   { value: 1.6, min: 0.4, max: 2.6, step: 0.05 },
    fan:   { value: 25, min: 0, max: 90, step: 1 },
    cone:  { value: 0, min: -90, max: 90, step: 1 },
    vary:  { value: 0.2, min: 0, max: 1, step: 0.01 },
    seed:  { value: 1, min: 0, max: 99, step: 1 },
    angle: { value: 0, min: -90, max: 90, step: 1 },
    // slow enough that a whole cycle stays inside the ~30-55 degree sweep
    // where the depth ramp reads — at 0.4 the parked phase landed exactly
    // down the barrel of the dressed line
    spin:  { value: 0.18, min: -1, max: 1, step: 0.01 },
    cycle: { value: 7, min: 2, max: 20, step: 0.5 },
    boost: { value: 2.5, min: 0, max: 4, step: 0.05 },
    size:  { value: 0.03, min: 0.01, max: 0.6, step: 0.005 },
    stations: { value: 4, min: 1, max: 8, step: 1 },
    "chip lines": { value: 1, min: 1, max: 12, step: 1 },
    patch: { value: 13, min: 3, max: 15, step: 2 },
    halo:  { value: 10, min: 0, max: 20, step: 0.5 },
    window: { value: 0.5, min: 0.08, max: 0.95, step: 0.01 },
    loops: { value: 1, min: 1, max: 6, step: 1 },
  };
  // a plain value overrides a default; a full spec object adds a NEW param
  for (const [k, v] of Object.entries(o))
    base[k] = typeof v === "object" ? v : { ...base[k], value: v };
  return base;
}

/** Station firing orders. out: from the crossing outward, both arms abreast
    (mirror symmetry preserved). run: tip to tip through the crossing. lines:
    line-major tip-to-tip, so the sequence wraps around the whole star. */
const starOrdOut = (k, side, fr) => fr;
const starOrdRun = (k, side, fr) => 0.5 + side * fr * 0.5;
const starOrdLines = (k, side, fr, D) => (k + 0.5 + side * fr * 0.5) / D;

/** The family's layout: the star's rays with aux packing line + 0.9*fr (the
    field staggers the draw per line), plus station patches whose aux packs
    0.9*firing-order. Same jittered patches as star-blocks. */
function starLifeGen(N, P, orderOf) {
  const R = Math.max(2, Math.round(P.rays)), GAP = 0.009;
  const coneR = P.cone * (Math.PI / 180);
  const ST = Math.max(1, Math.round(P.stations));
  const G = Math.max(3, Math.round(P.patch) | 1);
  const D = Math.min(R, Math.max(1, Math.round(P["chip lines"])));
  const slots = [];
  let si = 0;
  const patch = (x, y, z, ord) => {
    const J = 0.45 * (2 / (G - 1));
    const a9 = 0.9 * Math.min(ord, 0.999);
    for (let a = 0; a < G; a++)
      for (let c = 0; c < G; c++)
        slots.push(x, y, z, 1,
                   (a / (G - 1)) * 2 - 1
                     + (hash01(si * 977 + a * 31 + c * 7 + 5) - 0.5) * J,
                   (c / (G - 1)) * 2 - 1
                     + (hash01(si * 977 + a * 31 + c * 7 + 11) - 0.5) * J,
                   a9, 1.0);
    si++;
  };
  for (let k = 0; k < R; k++) {
    const ln = starLine(P, k);
    const n = Math.max(4, Math.round(ln.len / GAP));
    for (const side of [1, -1]) {
      const d = starArm(ln, coneR, side);
      for (let i = side > 0 ? 0 : 1; i <= n; i++) {
        const s = (i / n) * ln.len;
        const fr = Math.min(i / n, 0.999);
        const core = Math.min(1, fr / 0.14);
        slots.push(d[0] * s, d[1] * s, d[2] * s, 0, 0, 0,
                   k + 0.9 * fr, 0.55 * (0.3 + 0.7 * core));
      }
      if (k < D) for (let j = 1; j <= ST; j++) {
        const s = (j / ST) * ln.len;
        patch(d[0] * s, d[1] * s, d[2] * s, orderOf(k, side, j / ST, D));
      }
    }
  }
  patch(0, 0, 0, orderOf(0, 0, 0, D));   // the crossing's shared station
  return bakeRibbon(slots, N);
}

/** Station aux packers for the EXTREME family (field 38) — these get the
    raw aux, so a pattern can address stations per line (int part) or as one
    global chain (fraction only). */
const starAuxWeave = (k, side, fr) => k + 0.9 * Math.min(fr, 0.999);
const starAuxRing = (k, side, fr) => 0.9 * Math.min(fr, 0.999);
const starAuxRun = (k, side, fr) =>
  k + 0.9 * Math.min(0.5 + side * fr * 0.5, 0.999);
const starAuxChain = (k, side, fr, D) =>
  0.9 * Math.min((k + 0.5 + side * fr * 0.5) / D, 0.999);

/** starLifeGen's sibling for field 38: identical layout, but the station
    aux comes back raw from auxOf (line-addressed or chain-addressed). */
function starLifeXGen(N, P, auxOf) {
  const R = Math.max(2, Math.round(P.rays)), GAP = 0.009;
  const coneR = P.cone * (Math.PI / 180);
  const ST = Math.max(1, Math.round(P.stations));
  const G = Math.max(3, Math.round(P.patch) | 1);
  const D = Math.min(R, Math.max(1, Math.round(P["chip lines"])));
  const slots = [];
  let si = 0;
  const patch = (x, y, z, auxV) => {
    const J = 0.45 * (2 / (G - 1));
    for (let a = 0; a < G; a++)
      for (let c = 0; c < G; c++)
        slots.push(x, y, z, 1,
                   (a / (G - 1)) * 2 - 1
                     + (hash01(si * 977 + a * 31 + c * 7 + 5) - 0.5) * J,
                   (c / (G - 1)) * 2 - 1
                     + (hash01(si * 977 + a * 31 + c * 7 + 11) - 0.5) * J,
                   auxV, 1.0);
    si++;
  };
  for (let k = 0; k < R; k++) {
    const ln = starLine(P, k);
    const n = Math.max(4, Math.round(ln.len / GAP));
    for (const side of [1, -1]) {
      const d = starArm(ln, coneR, side);
      for (let i = side > 0 ? 0 : 1; i <= n; i++) {
        const s = (i / n) * ln.len;
        const fr = Math.min(i / n, 0.999);
        const core = Math.min(1, fr / 0.14);
        slots.push(d[0] * s, d[1] * s, d[2] * s, 0, 0, 0,
                   k + 0.9 * fr, 0.55 * (0.3 + 0.7 * core));
      }
      if (k < D) for (let j = 1; j <= ST; j++) {
        const s = (j / ST) * ln.len;
        patch(d[0] * s, d[1] * s, d[2] * s, auxOf(k, side, j / ST, D));
      }
    }
  }
  patch(0, 0, 0, auxOf(0, 0, 0, D));   // the crossing's shared station
  return bakeRibbon(slots, N);
}

/** Field 39's packing — prm2.z gains a thousands digit for the tide's
    train count: [len, clock, trains*1000 + pattern*100 + rays,
    loops + window]. */
/** `hi` overrides the ×10000 digit (normally trains) — patterns that don't
    ride trains can carry their own 0..99 payload there (emit: stagger). */
function starFlowUpdate(S, P, t, pattern, hi) {
  for (let k = 0; k < 4; k++) matIdent(S.grp, k);
  S.gbri.set([1, 1, 1, 1]);
  S.prm.set([t * P.spin, P.size, P.boost, P.halo]);
  const cyc = Math.max(0.5, P.cycle ?? 7);
  const u = (((t / cyc) % 1) + 1) % 1;
  const H = hi !== undefined ? hi : Math.max(0, Math.round(P.trains ?? 0));
  S.prm2.set([P.len, u,
              H * 10000 + pattern * 100 + Math.max(2, Math.round(P.rays)),
              Math.max(1, Math.round(P.loops ?? 1))
                + Math.min(P.window ?? 0.5, 0.95)]);
}

/** prm2 packs the whole choreography: [len, clock, pattern*100 + rays,
    loops + window] — the same int + fraction idiom aux uses. */
function starLifeUpdate(S, P, t, pattern) {
  for (let k = 0; k < 4; k++) matIdent(S.grp, k);   // the field spins itself
  S.gbri.set([1, 1, 1, 1]);
  S.prm.set([t * P.spin, P.size, P.boost, P.halo]);
  const cyc = Math.max(0.5, P.cycle ?? 7);
  const u = (((t / cyc) % 1) + 1) % 1;
  S.prm2.set([P.len, u,
              pattern * 100 + Math.max(2, Math.round(P.rays)),
              Math.max(1, Math.round(P.loops ?? 1))
                + Math.min(P.window ?? 0.5, 0.95)]);
}

function bakeRibbon(slots, N) {
  const ns = slots.length / 8;
  const pos = new Float32Array(3 * N), nrm = new Float32Array(3 * N);
  const aux = new Float32Array(N), bri = new Float32Array(N);
  const per = Math.max(1, Math.floor(N / ns));
  for (let i = 0; i < N; i++) {
    const s = 8 * (i % ns);
    pos[3 * i] = slots[s]; pos[3 * i + 1] = slots[s + 1]; pos[3 * i + 2] = slots[s + 2];
    nrm[3 * i] = slots[s + 3]; nrm[3 * i + 1] = slots[s + 4]; nrm[3 * i + 2] = slots[s + 5];
    aux[i] = slots[s + 6];
    bri[i] = slots[s + 7] / Math.sqrt(per);
  }
  return { pos, aux, bri, nrm };
}

/** The helix laid down TWICE: a faint dotted strand (family 0) and, parked on
    the very same path, a ribbon of cross-samples (family 1). Every ribbon dot
    carries in its NORMAL the offset that would push it off the strand, so the
    shader can inflate one travelling slice into the lens and leave the rest of
    the path a plain dotted line. `twist` rolls the ribbon's cross-section
    between the helix's binormal and its principal normal. */
function helixRibbon(N, P) {
  const n = 260;
  const m = Math.max(3, Math.round(P.cross) | 1);   // odd — keep a centre row
  const k = P.turns * TAU, half = P.height / 2;
  const len = Math.hypot(P.radius * k, P.height) || 1;   // |dp/df|
  const ct = Math.cos(P.twist), st = Math.sin(P.twist);
  const slots = [];
  for (let i = 0; i < n; i++) {
    const fr = (i / (n - 1)) * 0.999;
    const a = fr * k;
    const ca = Math.cos(a), sa = Math.sin(a);
    const x = ca * P.radius, y = half - P.height * fr, z = sa * P.radius;
    // Frenet frame of a circular helix: the principal normal aims at the axis,
    // the binormal is its clean out-of-plane partner.
    const nnx = -ca, nnz = -sa;                                    // normal
    const bx = (P.height * sa) / len, by = (-P.radius * k) / len,
          bz = (-P.height * ca) / len;                             // binormal
    const px = ct * bx + st * nnx, py = ct * by, pz = ct * bz + st * nnz;
    slots.push(x, y, z, 0, 0, 0, 0.9 * fr, 0.8);                   // the strand
    for (let j = 0; j < m; j++) {
      const q = (j / (m - 1)) * 2 - 1;                             // -1 .. 1 across
      slots.push(x, y, z, px * q, py * q, pz * q, 1 + 0.9 * fr, 0.8);
    }
  }
  return bakeRibbon(slots, N);
}

/** The spark burst as ribbons: every ray is a FULL line through the centre,
    tip to tip, sampled across its width. Unlike the helix there is no separate
    strand family — while the lens is elsewhere the cross-samples sit collapsed
    on the line and draw it themselves (update() shares `rest` out between them
    so the pile-up lands at the intended brightness). Ray directions follow
    spark run exactly, so a burst art-directed there transfers over. */

/** Scene 10's layout: the receding ribbon plus one stretch cell per point.
    Positions are baked at the REST pose (rot = 0) only so the rank-order sort
    has something meaningful to work with — the field recomputes every position
    from scratch each frame. `angStep` rides in each particle's normal because
    `turns` and `points` are regen params, which keeps a uniform slot free. */
function spiral10Layout(N, P) {
  const n = Math.max(4, Math.round(P.points));
  const A = Math.max(2, Math.round(P.along));
  const C = Math.max(1, Math.round(P.cross) | 1);
  const K = Math.max(2, Math.round(P.ribbon));
  const angStep = (P.turns * TAU) / (n - 1);
  const radius = P.radius * P.frame, vext = P.vext * P.frame;
  const focal = radius * 1.6;                       // FOCAL_FRAC
  const at = (k) => {
    const ang = k * angStep;
    const f = focal / (focal + radius * Math.sin(ang));
    return [radius * Math.cos(ang) * f, -(k / (n - 1) - 0.5) * vext * f];
  };
  const pts = [];
  for (let k = 0; k < n; k++) pts.push(at(k));

  const slots = [];
  for (let i = 0; i < n - 1; i++) {                  // the ribbon
    for (let s = 0; s < K; s++) {
      const u = (s / (K - 1)) * 0.999;
      slots.push(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u,
                 pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u, 0,
                 0, 0, angStep, i + 0.9 * u, 0.55);
    }
  }
  for (let i = 0; i < n; i++) {                      // the stretch cells
    for (let a = 0; a < A; a++) {
      const u = (a / (A - 1)) * 0.999;
      for (let c = 0; c < C; c++) {
        slots.push(pts[i][0], pts[i][1], 0,
                   1, C === 1 ? 0 : (c / (C - 1)) * 2 - 1, angStep,
                   i + 0.9 * u, 0.8);
      }
    }
  }
  return bakeRibbon(slots, N);
}

/** helix train: the same strand and patches as helix blocks, but the stations
    are baked UN-SPUN — the field turns them, so a patch can be offset in the
    screen plane — and aux carries only the fraction along the path, which is
    what the travelling window is measured against. */
function helixTrainLayout(N, P) {
  const nLine = Math.max(8, Math.round(P.line));
  const nBlk = Math.max(2, Math.round(P.blocks));
  const G = Math.max(1, Math.round(P.patch) | 1);
  const k = P.turns * TAU, half = P.height / 2;
  const at = (fr) => {
    const a = fr * k;
    return [Math.cos(a) * P.radius, half - P.height * fr, Math.sin(a) * P.radius];
  };
  const slots = [];
  for (let i = 0; i < nLine; i++) {
    const fr = (i / (nLine - 1)) * 0.999;
    const q = at(fr);
    slots.push(q[0], q[1], q[2], 0, 0, 0, 0.9 * fr, 0.6);
  }
  for (let j = 0; j < nBlk; j++) {
    const fr = (j / (nBlk - 1)) * 0.999;
    const q = at(fr);
    for (let a = 0; a < G; a++) {
      for (let c = 0; c < G; c++) {
        slots.push(q[0], q[1], q[2], 1,
                   G === 1 ? 0 : (a / (G - 1)) * 2 - 1,
                   G === 1 ? 0 : (c / (G - 1)) * 2 - 1,
                   0.9 * fr, 0.95);
      }
    }
  }
  return bakeRibbon(slots, N);
}

/** helix blocks: a dense dotted strand, plus one square patch per block
    station. Both families carry only their FRACTION along the path in aux —
    the field rebuilds the helix each frame — while nrm holds the family and
    the patch's own (x, y) so a block can be offset in the screen plane. */
function helixBlocksLayout(N, P) {
  const nLine = Math.max(8, Math.round(P.line));
  const nBlk = Math.max(2, Math.round(P.blocks));
  const G = Math.max(1, Math.round(P.patch) | 1);      // odd: keep a centre
  const k = P.turns * TAU, half = P.height / 2;
  const at = (fr) => {
    const a = fr * k;
    return [Math.cos(a) * P.radius, half - P.height * fr, Math.sin(a) * P.radius];
  };
  const slots = [];
  for (let i = 0; i < nLine; i++) {                    // the strand
    const fr = (i / (nLine - 1)) * 0.999;
    const q = at(fr);
    slots.push(q[0], q[1], q[2], 0, 0, 0, 0.9 * fr, 0.6);
  }
  for (let j = 0; j < nBlk; j++) {                     // the placed blocks
    const fr = (j / (nBlk - 1)) * 0.999;
    const q = at(fr);
    for (let a = 0; a < G; a++) {
      for (let c = 0; c < G; c++) {
        slots.push(q[0], q[1], q[2], 1,
                   G === 1 ? 0 : (a / (G - 1)) * 2 - 1,
                   G === 1 ? 0 : (c / (G - 1)) * 2 - 1,
                   0.9 * fr, 0.9);
      }
    }
  }
  return bakeRibbon(slots, N);
}

/** One ray's direction and length. Shared by every spark-blocks layout AND by
    the relay's per-frame solve, so the block it flies really does sit on the
    line that was baked — no drift between the two. */


/** The controls every spark-riders variant shares. Each mode overrides only
    what gives it its character; the rest is the house burst. */


/** spark riders: the rays as dotted lines, plus one block patch per rider.
    Each patch is tagged with its rider index in aux, and the field looks that
    rider's answer up in the matching group matrix. Positions are baked un-spun
    — the field turns them — so a patch stays square in the screen plane. */

/** Solve every rider for this frame and hand the answers to the field.
    `path` 0 runs a ray tip to tip, 1 fires centre to tip, 2 falls tip to
    centre. `split` 0 keeps the riders on one ray as a convoy, 1 gives each its
    own ray so they fire across the burst together.

    RIDER 0 TRAVELS IN prm/prm2, exactly as the relay's single block does, and
    only riders 1..3 use group matrices 1..3 (column 0 the world position,
    column 1 (size, halo, fade)). Group matrix 0 is NOT a data channel and
    never can be: evalSlot ends with `p = grp[gi] * p` and this field forces
    gi 0, so grp[0] is the rigid transform EVERY mark in the mode passes
    through — rays included. Parking rider 0's position in it multiplied the
    whole burst by a shear and was what detached the marks from the rays. It
    stays identity. grp[1..3] are free precisely because gi is forced to 0, so
    nothing is ever multiplied by them. */

/** The burst's raw z half-extent before any stretch — max |dz| * len over the
    rays. Both the layout and the per-frame solve divide by it, so the two
    always agree on what `dive` means. */


/** The controls the depth-blocks family shares. `boost` is the one that does
    the work: see the field for what it means. */
function depthBlocksParams(o) {
  return {
    dur:    { value: o.dur, min: 0.5, max: 30, step: 0.1 },
    size:   { value: o.size, min: 0.01, max: 1.5, step: 0.005 },
    // how much HARDER than the lens the taper runs. 0 is an ordinary rigid
    // object; 2-3 is near blocks as slabs and far ones as single dots
    boost:  { value: o.boost, min: 0, max: 4, step: 0.05 },
    near:   { value: o.near, min: -2, max: 3, step: 0.05 },
    range:  { value: o.range, min: 1, max: 40, step: 0.5 },
    roll:   { value: o.roll, min: -1, max: 1, step: 0.01 },
    edge:   { value: o.edge, min: 0.01, max: 0.4, step: 0.005 },
    halo:   { value: o.halo, min: 0, max: 20, step: 0.05 },
    bright: { value: o.bright, min: 0.1, max: 4, step: 0.05 },
    slices: { value: o.slices, min: 2, max: 60, step: 1 },
    around: { value: o.around, min: 1, max: 40, step: 1 },
    bore:   { value: o.bore, min: 0.1, max: 3, step: 0.01 },
    twist:  { value: o.twist, min: -0.6, max: 0.6, step: 0.005 },
    patch:  { value: o.patch, min: 1, max: 11, step: 2 },
  };
}

/** The depth-blocks layouts. All three are the same thing to the field — a
    cross-section in p0.xy plus a slot through the run in aux — so one branch
    drives a tunnel, a floor and a drifting cloud. p0.z is unused: the field
    places depth itself, from the slot and the travel offset, which is what
    lets the run wrap seamlessly and go on forever.
    kind 0 tunnel, 1 ground, 2 drift. */
function depthBlocksLayout(N, P, kind) {
  const G = Math.max(1, Math.round(P.patch) | 1);
  const D = Math.max(2, Math.round(P.slices));
  const per = Math.max(1, Math.round(P.around));
  const slots = [];
  const push = (x, y, u) => {
    for (let a = 0; a < G; a++) {
      for (let c = 0; c < G; c++) {
        slots.push(x, y, 0, 1,
                   G === 1 ? 0 : (a / (G - 1)) * 2 - 1,
                   G === 1 ? 0 : (c / (G - 1)) * 2 - 1, 0.9 * u, 1.0);
      }
    }
  };
  for (let r = 0; r < D; r++) {
    for (let i = 0; i < per; i++) {
      if (kind === 0) {                          // a ring, twisting as it goes
        const a = (i / per) * TAU + r * P.twist;
        push(Math.cos(a) * P.bore, Math.sin(a) * P.bore, r / D);
      } else if (kind === 1) {                   // a row on the floor
        const x = per === 1 ? 0 : ((i / (per - 1)) * 2 - 1) * P.bore;
        push(x, -P.bore * 0.62, r / D);
      } else {                                   // a scatter through the volume
        const h1 = hash01(r * 71 + i * 13 + 1);
        const h2 = hash01(r * 37 + i * 91 + 7);
        const h3 = hash01(r * 53 + i * 29 + 3);
        push((h1 - 0.5) * 2 * P.bore, (h2 - 0.5) * 2 * P.bore, (r + h3) / D);
      }
    }
  }
  return bakeRibbon(slots, N);
}

function depthBlocksUpdate(S, P, t) {
  for (let k = 0; k < 4; k++) matIdent(S.grp, k);   // the field does it all
  const b = P.bright;
  S.gbri.set([b, b, b, b]);
  const travel = (((t / Math.max(0.05, P.dur)) % 1) + 1) % 1;
  S.prm.set([travel, P.near, Math.max(0.2, P.range), P.halo]);
  S.prm2.set([P.size, P.boost, t * P.roll, Math.max(0.01, P.edge)]);
}

/** The controls the bloom family shares — the house burst, plus the ring's own
    shape: how wide the lit band is, how many rings are in flight, and whether a
    ring flies out or the burst fills in behind it. */

/** spark bloom: the rays as dotted lines, plus block stations measured OUT
    from the crossing along BOTH halves of every ray — so what expands is a
    radius, not a slide along one arm. aux carries 0.9 * that distance (0 at
    the crossing, 1 at the tip), which is all the field needs to ask a station
    how far it is from the front. The innermost station sits at 1/blocks
    rather than 0, because the two halves would collide on top of each other
    at the exact centre. */

/** Solve the front once and hand the field a single scalar. Every block in a
    bloom leaves the crossing together, so they are all the same distance out
    and one eased number places the lot — which is exactly why this field can
    put a block on every ray at once while the riders field is capped at four.
    The bezier still runs on the CPU, where it can be written honestly. */

/** spark relay: the rays as dotted lines, plus ONE block patch that the field
    parks wherever the per-frame solve puts it. */

/** The spark burst as dotted rays plus depth-driven block stations. Ray
    directions follow spark run exactly, so a burst art-directed there
    transfers over. Positions are the UN-SPUN stations — the field turns them,
    so each block patch can stay square in the screen plane — and aux carries
    the sequence coordinate (along-ray fraction plus this ray's stagger). */

/** The block/ray params every spark-blocks variant shares — each mode then
    overrides only what gives it its character. */


function trailGen(N, P, radiusOf, countKey = "rings") {
  const L = new Layout();
  const G = Math.max(2, Math.min(4, Math.round(P[countKey])));
  const nT = 84;
  for (let g = 0; g < G; g++) {
    const r = radiusOf(g, P);
    for (let j = 0; j < nT; j++) {
      const frac = j / (nT - 1);
      const th = 1.2 + g * 1.5 + frac * (P.trail || 0.25) * TAU;
      L.add(Math.cos(th) * r, Math.sin(th) * r * 0.5, 0.2 * g - 0.3,
            g + 0.9 * frac,
            j === nT - 1 ? 2.8 * P.head : 0.8);
    }
  }
  return L.bake(N);
}

/** The finding lifecycle — CONTINUOUS, seam-solo style: the heads glide at
    constant rate from first frame to last; only the TAIL LENGTH sweeps, one
    expo gesture in at the top of the cycle, one gesture out at the end.
    Nothing pops, nothing holds, the wrap is empty. */
function trailLife(S, P, t, orient, phiOf, countKey = "rings") {
  const cyc = Math.max(0.1, P.cycle);
  const u = (((t % cyc) + cyc) % cyc) / cyc;
  const tl = u * cyc;
  const Lenv = expoInOut(Math.min(1, u / 0.16)) *
               (1 - expoInOut(Math.max(0, (u - 0.84) / 0.16)));
  const G = Math.max(2, Math.min(4, Math.round(P[countKey])));
  for (let g = 0; g < 4; g++) {
    if (g >= G) {
      matIdent(S.grp, g);
      S.gbri[g] = 0; S.prm[g] = 0; S.prm2[g] = 0;
      continue;
    }
    put(S.grp, g, orient(g, tl));
    const phi = phiOf(g, tl);
    // the tail must lag OPPOSITE the head's travel — orbits that sweep in the
    // reverse direction (dir < 0) would otherwise trail ahead of the head and
    // read as running backwards. Sense direction from the local slope of phi.
    const dir = phiOf(g, tl + 0.01) < phi ? -1 : 1;
    S.gbri[g] = Math.min(1, Lenv / 0.06);   // only so a naked head never pops
    S.prm[g] = phi;
    S.prm2[g] = phi - dir * Lenv * (P.trail * TAU);
  }
}

// ---- COMPARING (field 19: block -> armed burst -> block) -------------------

function burstDirsAxis(n) {
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  while (dirs.length < n) {
    const a = (dirs.length - 6) * 2.4;
    dirs.push([Math.cos(a) * 0.71, Math.sin(a) * 0.71, 0.71]);
  }
  return dirs.slice(0, Math.max(4, n));
}

function burstDirsStar(n, cone) {
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n;
    const zt = cone * (i % 2 ? 1 : -1);
    const d = [Math.cos(a), Math.sin(a), zt];
    const l = Math.hypot(...d);
    dirs.push(d.map((v) => v / l));
  }
  return dirs;
}

/** Burst layout: each arm is a line of slots from the centre out, its last
    slot a heavy tip chip. Field 19 scales everything from the rest block. */
function burstGen(N, P, dirs) {
  const L = new Layout();
  const nA = 46;
  dirs.forEach((d, k) => {
    for (let j = 0; j < nA; j++) {
      const f = j / (nA - 1);
      L.add(d[0] * f * P.len, d[1] * f * P.len, d[2] * f * P.len,
            k + 0.9 * f,
            j === nA - 1 ? 3.0 : 0.78);
    }
  });
  return L.bake(N);
}

/** The burst clock: rest [0,.07] -> deploy [.07,.30] -> drift [.30,.70] ->
    withdraw [.70,.93] -> rest. master feeds the shader (which staggers +
    expo-eases per arm); u drives a LINEAR whole-cycle spin — the burst is
    always turning, and the wrap's angle jump happens while everything is
    swallowed into the sub-cell rest block, so cycles still loop clean. */
function burstPhase(t, P) {
  const cyc = Math.max(0.1, P.cycle);
  const u = (((t % cyc) + cyc) % cyc) / cyc;
  let master = 0;
  if (u >= 0.07 && u < 0.30) master = (u - 0.07) / 0.23;
  else if (u >= 0.30 && u < 0.70) master = 1;
  else if (u >= 0.70 && u < 0.93) master = 1 - (u - 0.70) / 0.23;
  return { master, u };
}

// ---- ARRANGING (field 20: layout A <-> layout B, movers glowing) -----------

/** Bake a paired layout by hand: pos = arrangement A, nrm = arrangement B,
    aux packs the stagger unit. Round-robin over slots like Layout.bake. */
function bakePaired(slots, N) {
  const ns = slots.length;
  const pos = new Float32Array(3 * N);
  const nrm = new Float32Array(3 * N);
  const aux = new Float32Array(N);
  const bri = new Float32Array(N);
  const per = Math.max(1, Math.floor(N / ns));
  for (let i = 0; i < N; i++) {
    const s = slots[i % ns];
    pos[3 * i] = s.a[0]; pos[3 * i + 1] = s.a[1]; pos[3 * i + 2] = s.a[2];
    nrm[3 * i] = s.b[0]; nrm[3 * i + 1] = s.b[1]; nrm[3 * i + 2] = s.b[2];
    aux[i] = s.unit + 0.45;
    bri[i] = s.bri / Math.sqrt(per);
  }
  return { pos, nrm, aux, bri };
}

/** arrange · stack: a fanned hand of 7 rods -> an even horizontal stack.
    The fan is pure geometry (graded angles about a shared pivot arc). */
function stackGen(N) {
  const slots = [];
  const SEGS = 7, nS = 58;
  for (let i = 0; i < SEGS; i++) {
    const k = i - (SEGS - 1) / 2;             // -3 .. 3
    const ang = k * 0.30;                     // the fan: graded tilts
    const cx = k * 0.10, cy = k * 0.05;       // pivots slide along a gentle arc
    const yB = -0.72 + (1.44 * i) / (SEGS - 1);
    for (let j = 0; j < nS; j++) {
      const f = j / (nS - 1) - 0.5;
      slots.push({
        a: [cx + Math.cos(ang) * f * 1.5, cy + Math.sin(ang) * f * 1.5, 0],
        b: [f * 1.5, yB, 0],
        unit: i,
        bri: j < 2 || j > nS - 3 ? 1.9 : 0.8,
      });
    }
  }
  return bakePaired(slots, N);
}

/** arrange · rings: ONE rim circle peels inward into four concentric
    rings — every dot travels straight down its own radius. Pure geometry. */
function ringsGen(N) {
  const slots = [];
  const RADII = [0.32, 0.57, 0.82, 1.07];
  const dish = matRotX(0.95);
  const rot = (m, p) => [
    m[0] * p[0] + m[3] * p[1] + m[6] * p[2],
    m[1] * p[0] + m[4] * p[1] + m[7] * p[2],
    m[2] * p[0] + m[5] * p[1] + m[8] * p[2]];
  RADII.forEach((r, ring) => {
    const n = Math.round(90 * (0.5 + r));
    for (let j = 0; j < n; j++) {
      const th = (TAU * j) / n + ring * 0.12;   // slight phase per ring
      slots.push({
        a: rot(dish, [Math.cos(th) * 1.07, Math.sin(th) * 1.07, 0]),
        b: rot(dish, [Math.cos(th) * r, Math.sin(th) * r, 0]),
        unit: 3 - ring,                          // innermost departs first
        bri: 0.85,
      });
    }
  });
  return bakePaired(slots, N);
}

/** arrange · crystal: the SAME hex lattice, dilated and turned, focusing
    into place — a crystal condensing, band by band from the heart out. */
function crystalGen(N) {
  const slots = [];
  const R = 1.05, s = 0.088, dy = s * 0.8660254;
  const DIL = 2.0, ROT = 0.52;
  const cR = Math.cos(ROT), sR = Math.sin(ROT);
  for (let row = -Math.ceil(R / dy); row <= Math.ceil(R / dy); row++) {
    const y = row * dy;
    const off = row % 2 ? s / 2 : 0;
    for (let col = -Math.ceil(R / s) - 1; col <= Math.ceil(R / s) + 1; col++) {
      const x = col * s + off;
      const r = Math.hypot(x, y);
      if (r > R) continue;
      slots.push({
        a: [(x * cR - y * sR) * DIL, (x * sR + y * cR) * DIL, 0],
        b: [x, y, 0],
        unit: Math.min(7, Math.floor((8 * r) / R)),
        bri: 0.95,
      });
    }
  }
  return bakePaired(slots, N);
}

/** The octave-dive layout — the normal zoom's grid, by style: "grid" both
    line directions + anchors, "rails" vertical lines + anchors, "marks"
    anchors only. blockSel(i, j), if given, flags matching anchors as
    BLOCK anchors (aux frac 0.75 — field 25's license). */
function octaveGen(N, P, style, blockSel, extra) {
  const L = new Layout();
  const E = 2.75;
  const vLines = style !== "marks";
  const hLines = style === "grid";
  for (let lv = 0; lv < 4; lv++) {
    const p = P.pitch * 2 ** (lv - 1);
    const kmax = Math.floor(E / p);
    const gap = p / 6;
    for (let k = -kmax; k <= kmax; k++) {
      for (let d = -E; d <= E; d += gap) {
        if (vLines) L.add(k * p, d, 0, lv, 0.5);
        if (hLines) L.add(d, k * p, 0, lv, 0.5);
      }
    }
    for (let i = -kmax; i <= kmax; i++)
      for (let j = -kmax; j <= kmax; j++) {
        const isB = blockSel && blockSel(i, j);
        L.add(i * p, j * p, 0, lv + (isB ? 0.675 : 0), P.anchors);
      }
    if (extra) extra(L, lv, p);
  }
  return L.bake(N);
}

/** Drive the octave dive: per-level scale + apparent-pitch brightness
    windows (zoom's exact math), with an optional extra linear map M. */
function octaveDrive(S, P, zoom, M) {
  const win = (x, a, b) => {
    const y = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return y * y * (3 - 2 * y);
  };
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let lv = 0; lv < 4; lv++) {
    const base = matScale(I, zoom);
    put(S.grp, lv, M ? matMul(M, base) : base);
    const ap = P.pitch * 2 ** (lv - 1) * zoom;
    S.gbri[lv] = win(ap, 0.30, 0.48) * (1 - win(ap, 1.5, 2.4));
  }
}

/** The square-tunnel layout (field 24): K levels of one unit square each,
    baked at the NEWBORN size — the shader grows/places them by level.
    Styles: outline · frames (corner brackets) · dashed · diamond (odd
    levels pre-rotated 45°) · double (a second wall at 0.8). */
function tunnelGen(N, P, style) {
  const L = new Layout();
  const K = Math.round(P.levels);          // baked at UNIT half-size; the
  const rings = style === "double" ? [1.0, 0.8] : [1.0];   // shader scales
  const nPer = style === "double" ? 150 : 230;
  for (let lv = 0; lv < K; lv++) {
    const rot = style === "diamond" && lv % 2 ? Math.PI / 4 : 0;
    const cR = Math.cos(rot), sR = Math.sin(rot);
    for (const rr of rings) {
      for (let i = 0; i < nPer; i++) {
        const tp = i / nPer;
        const e = Math.floor(tp * 4), f = tp * 4 - e;
        if (style === "frames" && f > 0.26 && f < 0.74) continue;
        if (style === "dashed" && (tp * 20) % 1 > 0.62) continue;
        const c = f * 2 - 1;
        let x, y;
        if (e === 0) { x = c; y = 1; }
        else if (e === 1) { x = 1; y = -c; }
        else if (e === 2) { x = -c; y = -1; }
        else { x = -1; y = c; }
        x *= rr; y *= rr;
        L.add(x * cR - y * sR, x * sR + y * cR, 0, lv + 0.9 * tp, 0.85);
      }
    }
  }
  return L.bake(N);
}

/** Drive the tunnel: prog is the eased/linear level shift, mode3d picks
    z-corridor placement, alt flips the twist sign on odd levels. */
function tunnelDrive(S, P, t, prog, mode3d, alt = 0) {
  put(S.grp, 0, matMul(matRotX(P.tilt || 0), matRotZ(t * (P.spin || 0))));
  for (let k = 1; k < 4; k++) matIdent(S.grp, k);
  S.gbri.set([1, 1, 1, 1]);
  S.prm.set([prog, Math.log(P.ratio || 1.45), P.twist || 0, alt]);
  S.prm2.set([Math.round(P.levels), mode3d ? P.depth : 0, mode3d ? P.size : 0.018, 0]);
}

/** The cube-zoom layout: a static one-point-perspective cube (12 dotted
    edges, aux 99 = never lights) holding K parallel zoom-grid slices along
    `axis` ("z" front-back · "x" left-right · "y" top-bottom). Slice k gets
    sequence index k (or reversed), its grid LINES at aux frac 0.2 and its
    nine ANCHORS at frac 0.75 — field 23 with the anchor license prints
    blocks only at the intersections of the blooming slice. */
function cubeZoomGen(N, P, axis, reverse) {
  const L = new Layout();
  const C = 0.92, GAP = 0.024;
  const K = Math.round(P.slices);
  for (const a of [-C, C]) {
    for (const b of [-C, C]) {
      for (let d = -C; d <= C; d += GAP) {
        L.add(d, a, b, 99, 0.85);
        L.add(a, d, b, 99, 0.85);
        L.add(a, b, d, 99, 0.85);
      }
    }
  }
  const G = C * 0.94;
  const lines = [-0.5 * G, 0, 0.5 * G];
  const map = (u, v, w) =>
    axis === "x" ? [w, v, u] : axis === "y" ? [u, w, v] : [u, v, w];
  for (let k = 0; k < K; k++) {
    const si = reverse ? K - 1 - k : k;
    const w = G * (1 - (2 * k) / (K - 1));   // k 0 = front / left / top
    for (const lu of lines) {
      for (let d = -G; d <= G; d += GAP) {
        L.add(...map(lu, d, w), si + 0.9 * 0.2, 0.55);
        L.add(...map(d, lu, w), si + 0.9 * 0.2, 0.55);
      }
    }
    for (const lu of lines)
      for (const lv of lines)
        L.add(...map(lu, lv, w), si + 0.9 * 0.75, P.anchors);
  }
  return L.bake(N);
}

/** Drive the cube sequence: NO rotation ever (the cube is front-facing by
    contract); the slice windows walk the cycle like chipClock's. */
function cubeClock(S, P, t) {
  for (let k = 0; k < 4; k++) matIdent(S.grp, k);
  S.gbri.set([1, 1, 1, 1]);
  const cyc = Math.max(0.1, P.cycle);
  const u = (((t % cyc) + cyc) % cyc) / cyc;
  const K = Math.round(P.slices);
  S.prm.set([u, 0, P.halo, P.rest]);
  S.prm2.set([K, (P.flow * 0.5) / K, 1, P.boost]);
}

/** Nearest exact hex-lattice site to a target point (crystalGen's grid). */
function hexSite(tx, ty) {
  const s = 0.088, dy = s * 0.8660254;
  const row = Math.round(ty / dy);
  const off = row % 2 ? s / 2 : 0;
  const col = Math.round((tx - off) / s);
  return { x: col * s + off, y: row * dy };
}

/** The crystal-chip layout: the plain hex lattice (site 99 = never lights)
    plus a dense mini-flower of seed dots at each block site, so a lit site
    prints as ONE compact chunk. */
function crystalChipGen(N, sites, seedR) {
  const L = new Layout();
  const R = 1.05, s = 0.088, dy = s * 0.8660254;
  for (let row = -Math.ceil(R / dy); row <= Math.ceil(R / dy); row++) {
    const y = row * dy;
    const off = row % 2 ? s / 2 : 0;
    for (let col = -Math.ceil(R / s) - 1; col <= Math.ceil(R / s) + 1; col++) {
      const x = col * s + off;
      if (Math.hypot(x, y) > R) continue;
      L.add(x, y, 0, 99, 0.9);
    }
  }
  for (const site of sites) {
    const pts = [[0, 0]];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      pts.push([Math.cos(a) * seedR * 0.55, Math.sin(a) * seedR * 0.55]);
      pts.push([Math.cos(a + 0.26) * seedR, Math.sin(a + 0.26) * seedR]);
    }
    pts.forEach(([dx, dy2], j) => {
      L.add(site.x + dx, site.y + dy2, 0, site.si + 0.9 * (j / pts.length), 1.25);
    });
  }
  return L.bake(N);
}

/** The chip sequencer clock — site k owns the window centred at
    (k+0.5)/count of the cycle; `flow` widens the windows past touching. */
function chipClock(S, P, t, count) {
  put(S.grp, 0, matRotZ(t * P.spin));
  for (let k = 1; k < 4; k++) matIdent(S.grp, k);
  S.gbri.set([1, 1, 1, 1]);
  const cyc = Math.max(0.1, P.cycle);
  const u = (((t % cyc) + cyc) % cyc) / cyc;
  S.prm.set([u, 0, P.halo, P.rest]);
  S.prm2.set([count, (P.flow * 0.5) / count, 0, P.boost]);
}

/** The migration clock — a BOUNCING FRONT: master is a pure triangle wave,
    so the aligning front sweeps through the units, reflects off the last
    one, and sweeps straight back, dissolving them. Something is mid-flight
    at every instant; the wavefront carries the heat. No holds anywhere. */
function migrateLife(S, P, t, units) {
  const cyc = Math.max(0.1, P.cycle);
  const u = (((t % cyc) + cyc) % cyc) / cyc;
  const master = u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5;
  put(S.grp, 0, matScale(matRotY(0), P.size));
  for (let k = 1; k < 4; k++) matIdent(S.grp, k);
  S.gbri.set([1, 1, 1, 1]);
  S.prm.set([master, P.window, units, P.hot]);
  S.prm2.set([0, 0, 0, 0]);
}
