// shapeModes.js — the Tempo primitives (shapes.mjs) as particle-pool assets.
//
// Each parametric surface is tessellated into a triangle soup, then sampled
// area-weighted into a lit point cloud + normals + occluder tris — exactly the
// shape of data sampleSurface() produces from a GLB. We hand that to the very
// same makeAssetMode() the GLBs use, so a cylinder is just another asset: it
// lights, spins, occludes and morphs with identical params. Geometry is baked;
// reshape at runtime through size / stretch (which transform, not re-tessellate,
// so the depth-prepass occluder stays valid).

import { makeRoundedSquare } from "./shapes.mjs";
import { makeAssetMode } from "./assets.js";

const TAU = Math.PI * 2;

export const SHAPE_DEFS = [
  { key: "shape-sphere", label: "sphere", status: "SPHERE", shape: "sphere" },
];

export const SHAPE_BY_KEY = Object.fromEntries(SHAPE_DEFS.map((d) => [d.key, d]));

// a slow reveal-spin + slight tilt so a fresh primitive reads as 3D, not a
// flat outline — the user can zero either per step
const SHAPE_TWEAKS = { spin: 0.22, tilt: 0.16, size: 1.15 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- tessellation → flat triangle list [ax,ay,az, bx,by,bz, cx,cy,cz, …] ----

function quad(T, a, b, c, d) {
  T.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2],
         a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
}
function tri(T, a, b, c) {
  T.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function buildTris(shape) {
  const T = [];
  const NU = 96, NV = 44;

  if (shape === "sphere") {
    const P = (th, ph) => [Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th)];
    for (let i = 0; i < NU; i++) {
      const t0 = (i / NU) * TAU, t1 = ((i + 1) / NU) * TAU;
      for (let j = 0; j < NV; j++) {
        const p0 = -Math.PI / 2 + Math.PI * (j / NV), p1 = -Math.PI / 2 + Math.PI * ((j + 1) / NV);
        quad(T, P(t0, p0), P(t1, p0), P(t1, p1), P(t0, p1));
      }
    }
    return T;
  }

  // cylinder / cone / prism / pyramid share the extrude-a-cross-section loop
  const roundSquare = (shape === "prism" || shape === "pyramid");
  const sq = roundSquare ? makeRoundedSquare(shape === "prism" ? 0.16 : 0.0, 4).sqAt : null;
  const NUP = roundSquare ? 160 : NU;
  const H = shape === "prism" ? 1.5 : 2.4;
  const half = H / 2;
  // top radius / scale: cone & pyramid taper to a point, cylinder & prism don't
  const topK = (shape === "cone" || shape === "pyramid") ? 0.0 : 1.0;

  // a cross-section point at perimeter fraction u, before the height scale
  const sect = (u) => {
    if (roundSquare) { const s = sq(u); return [s[0], s[1]]; }
    const th = u * TAU; return [Math.sin(th), Math.cos(th)];
  };

  for (let i = 0; i < NUP; i++) {
    const s0 = sect(i / NUP), s1 = sect((i + 1) / NUP);
    for (let j = 0; j < NV; j++) {
      const v0 = j / NV, v1 = (j + 1) / NV;
      const k0 = 1 - (1 - topK) * v0, k1 = 1 - (1 - topK) * v1;
      const y0 = -half + H * v0, y1 = -half + H * v1;
      quad(T,
        [s0[0] * k0, y0, s0[1] * k0],
        [s1[0] * k0, y0, s1[1] * k0],
        [s1[0] * k1, y1, s1[1] * k1],
        [s0[0] * k1, y1, s0[1] * k1]);
    }
    // bottom cap (always), top cap only when it isn't a point
    tri(T, [0, -half, 0], [s1[0], -half, s1[1]], [s0[0], -half, s0[1]]);
    if (topK > 1e-4) tri(T, [0, half, 0], [s0[0] * topK, half, s0[1] * topK], [s1[0] * topK, half, s1[1] * topK]);
  }
  return T;
}

// ---- area-weighted surface sampling (mirrors assets.sampleSurface pass 3) ----

function sampleMesh(T, count) {
  const triCount = T.length / 9;
  const fn = new Float32Array(triCount * 3);   // per-face normal
  const cdf = new Float64Array(triCount);
  let areaSum = 0;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
    const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    fn[3 * t] = nx / len; fn[3 * t + 1] = ny / len; fn[3 * t + 2] = nz / len;
    areaSum += len * 0.5;
    cdf[t] = areaSum;
  }

  const pos = new Float32Array(3 * count);
  const nrm = new Float32Array(3 * count);
  const rnd = mulberry32(0x9e3779b9 ^ triCount ^ (count << 1));
  for (let i = 0; i < count; i++) {
    const target = rnd() * areaSum;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < target) lo = mid + 1; else hi = mid; }
    const o = lo * 9;
    const su = Math.sqrt(rnd());
    const b0 = 1 - su, b1 = rnd() * su, b2 = su - b1;
    for (let c = 0; c < 3; c++) {
      pos[3 * i + c] = b0 * T[o + c] + b1 * T[o + 3 + c] + b2 * T[o + 6 + c];
      nrm[3 * i + c] = fn[3 * lo + c];
    }
  }

  // recentre + unit radius, framed like sampleSurface (0.5 · bbox diagonal)
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < count; i++)
    for (let c = 0; c < 3; c++) {
      const x = pos[3 * i + c];
      if (x < mn[c]) mn[c] = x;
      if (x > mx[c]) mx[c] = x;
    }
  const ctr = [0, 1, 2].map((c) => (mn[c] + mx[c]) / 2);
  const radius = Math.max(1e-4, 0.5 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]));
  for (let i = 0; i < count; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) { pos[3 * i + c] = (pos[3 * i + c] - ctr[c]) / radius; d += nrm[3 * i + c] * pos[3 * i + c]; }
    // these primitives are convex — face the normal away from the centre so
    // lighting and the back-face fade are always correct regardless of winding
    if (d < 0) { nrm[3 * i] *= -1; nrm[3 * i + 1] *= -1; nrm[3 * i + 2] *= -1; }
  }

  const tris = new Float32Array(T.length);
  for (let i = 0; i < T.length; i += 3) {
    tris[i] = (T[i] - ctr[0]) / radius;
    tris[i + 1] = (T[i + 1] - ctr[1]) / radius;
    tris[i + 2] = (T[i + 2] - ctr[2]) / radius;
  }

  return { pos, nrm, tris };
}

/** Build one shape as an asset mode (same vocabulary as a sampled GLB). */
export function buildShapeMode(def, count) {
  const sampled = sampleMesh(buildTris(def.shape), count);
  return makeAssetMode(
    { key: def.key, label: def.label, status: def.status, tweaks: { ...SHAPE_TWEAKS, ...(def.tweaks || {}) } },
    sampled,
  );
}
