// The assets — every GLB in the brand library, translated into the SAME
// vocabulary as the procedural modes: a target layout for the shared particle
// pool. That single decision is what makes animation ⇄ asset transitions real
// morphs instead of cross-fades — a hoodie here is just 16k particles that
// happen to sit on a hoodie.
//
// An asset mode is built by sampling the GLB's surface, area-weighted, so dot
// density is even across the garment: pick a triangle by cumulative area,
// pick a uniform barycentric point on it, interpolate the normal. The cloud is
// recentred and scaled to unit radius exactly like glb-braille's buildModel,
// so framing carries over. Normals ride along in the pool and the particle
// shader lights them live (mode id 9) — the shading tracks the spin, the rim
// tracks the camera, and back-facing dots fade so the cloud reads as a solid.
//
// Sampling is deterministic (hashed, not Math.random) so a layout regenerates
// identically and rank-matching stays stable across re-gens.

import * as THREE from "three";
import { GLTFLoader } from "../vendor/GLTFLoader.js";
import { DRACOLoader } from "../vendor/DRACOLoader.js";
import { matRotX, matRotY, matRotZ, matMul, put } from "./modes.js";
import { ASSET_MODE_ID } from "./particles.js";

const TAU = Math.PI * 2;

/* No built-in 3D models. The five GLBs were 96 MB of a 101 MB project, they
   were .vercelignored so they 404'd in production anyway, and the curated
   Featured set replaced them in the library. The files are still in models/ —
   putting an entry back here is all it takes to restore one.

   Imported GLBs are unaffected: they never came through here, they register
   straight into the library from assetModeFromBuffer(). */
export const ASSET_DEFS = [];

const draco = new DRACOLoader()
  .setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
const loader = new GLTFLoader().setDRACOLoader(draco);

function hash01(i) {
  let h = (i * 2654435761) >>> 0;
  h ^= h >> 13; h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

/** Deterministic RNG — the same GLB always yields the same cloud. */
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

/**
 * Sample `count` points (positions + normals) off every mesh surface under
 * `root`, area-weighted, then recentre on the bbox centre and scale to unit
 * radius (0.5 · bbox diagonal — glb-braille's framing convention).
 */
export function sampleSurface(root, count) {
  root.updateWorldMatrix(true, true);

  // pass 1: count triangles
  const meshes = [];
  let triTotal = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const idx = o.geometry.index;
    const n = idx ? idx.count / 3 : o.geometry.attributes.position.count / 3;
    if (n < 1) return;
    meshes.push(o);
    triTotal += Math.floor(n);
  });
  if (!triTotal) throw new Error("no triangles in model");

  // pass 2: flatten world-space triangles + a cumulative-area table
  const verts = new Float32Array(triTotal * 9);
  const norms = new Float32Array(triTotal * 9);
  const cdf = new Float64Array(triTotal);
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3(), n3 = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cr = new THREE.Vector3();
  let ti = 0, areaSum = 0;

  for (const mesh of meshes) {
    const geo = mesh.geometry;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pAttr = geo.attributes.position, nAttr = geo.attributes.normal;
    const idx = geo.index;
    const triCount = Math.floor((idx ? idx.count : pAttr.count) / 3);
    nm.getNormalMatrix(mesh.matrixWorld);

    for (let t = 0; t < triCount; t++) {
      const o9 = ti * 9;
      for (let c = 0; c < 3; c++) {
        const vi = idx ? idx.getX(3 * t + c) : 3 * t + c;
        v.fromBufferAttribute(pAttr, vi).applyMatrix4(mesh.matrixWorld);
        n3.fromBufferAttribute(nAttr, vi).applyMatrix3(nm);
        verts[o9 + 3 * c] = v.x; verts[o9 + 3 * c + 1] = v.y; verts[o9 + 3 * c + 2] = v.z;
        norms[o9 + 3 * c] = n3.x; norms[o9 + 3 * c + 1] = n3.y; norms[o9 + 3 * c + 2] = n3.z;
      }
      e1.set(verts[o9 + 3] - verts[o9], verts[o9 + 4] - verts[o9 + 1], verts[o9 + 5] - verts[o9 + 2]);
      e2.set(verts[o9 + 6] - verts[o9], verts[o9 + 7] - verts[o9 + 1], verts[o9 + 8] - verts[o9 + 2]);
      areaSum += cr.crossVectors(e1, e2).length() * 0.5;
      cdf[ti] = areaSum;
      ti++;
    }
  }

  // pass 3: draw samples
  const pos = new Float32Array(3 * count);
  const nrm = new Float32Array(3 * count);
  const rnd = mulberry32(0x9e3779b9 ^ triTotal);
  for (let i = 0; i < count; i++) {
    const target = rnd() * areaSum;
    let lo = 0, hi = triTotal - 1;
    while (lo < hi) {                     // first tri whose cdf covers target
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1; else hi = mid;
    }
    const o9 = lo * 9;
    const su = Math.sqrt(rnd());          // uniform barycentric
    const b0 = 1 - su, b1 = rnd() * su, b2 = su - b1;
    for (let c = 0; c < 3; c++) {
      pos[3 * i + c] = b0 * verts[o9 + c] + b1 * verts[o9 + 3 + c] + b2 * verts[o9 + 6 + c];
      nrm[3 * i + c] = b0 * norms[o9 + c] + b1 * norms[o9 + 3 + c] + b2 * norms[o9 + 6 + c];
    }
    const l = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1;
    nrm[3 * i] /= l; nrm[3 * i + 1] /= l; nrm[3 * i + 2] /= l;
  }

  // recentre + unit radius, framed the way glb-braille frames a model
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < count; i++)
    for (let c = 0; c < 3; c++) {
      const x = pos[3 * i + c];
      if (x < mn[c]) mn[c] = x;
      if (x > mx[c]) mx[c] = x;
    }
  const ctr = [0, 1, 2].map((c) => (mn[c] + mx[c]) / 2);
  const radius = Math.max(1e-4,
    0.5 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]));
  for (let i = 0; i < count; i++)
    for (let c = 0; c < 3; c++)
      pos[3 * i + c] = (pos[3 * i + c] - ctr[c]) / radius;

  // the triangle soup survives, normalized the same way — it becomes the
  // depth-prepass occluder that makes the cloud read as a solid (occlusion.js)
  for (let i = 0; i < verts.length; i += 3) {
    verts[i] = (verts[i] - ctr[0]) / radius;
    verts[i + 1] = (verts[i + 1] - ctr[1]) / radius;
    verts[i + 2] = (verts[i + 2] - ctr[2]) / radius;
  }

  return { pos, nrm, tris: verts };
}

/** Remaining rotation-time until rest: constant glide until the run-out
    window opens, then a cosine-eased velocity fade — v(u) = (1+cos πu)/2 —
    so the slowdown starts and lands without a jerk. Zero at and after the
    clip's end. */
function spinRunout(t, end, D) {
  if (t >= end) return 0;
  const ramp = end - D;
  if (t <= ramp) return ramp - t + D / 2;
  const u = (t - ramp) / D;
  return D * ((1 - u) / 2 - Math.sin(Math.PI * u) / (2 * Math.PI));
}

/** Wrap a sampled cloud as a mode object the particle engine understands.
    `def.tweaks` overrides param defaults (e.g. a non-spinning asset). */
export function makeAssetMode(def, sampled) {
  const mode = {
    key: `asset:${def.key}`,
    label: def.label,
    statusName: def.status,
    id: ASSET_MODE_ID,
    asset: true,
    tris: sampled.tris,
    regen: ["size", "stretch x", "stretch y", "shift x", "shift y"],
    params: {
      size:    { value: 1.30, min: 0.5, max: 2.4, step: 0.01 },
      // stretch + shift bake into the layout — for matching the cloud to a
      // flat reference like the photo plate
      "stretch x": { value: 1, min: 0.5, max: 2, step: 0.005 },
      "stretch y": { value: 1, min: 0.5, max: 2, step: 0.005 },
      "shift x":   { value: 0, min: -0.9, max: 0.9, step: 0.005 },
      "shift y":   { value: 0, min: -0.9, max: 0.9, step: 0.005 },
      // auto-rotate rates, rad/s: spin = turntable (Y), spin x = tumble,
      // spin z = roll — compose freely for a slow product tumble
      spin:    { value: 0, min: -1.5, max: 1.5, step: 0.01 },
      "spin x": { value: 0, min: -1.5, max: 1.5, step: 0.01 },
      "spin z": { value: 0, min: -1.5, max: 1.5, step: 0.01 },
      // the run-out: over the clip's last `settle` seconds the spin eases to
      // a dead stop, landing at exactly `face` degrees (0 = camera-forward).
      // 0 = off, the legacy endless turntable
      settle:  { value: 0, min: 0, max: 8, step: 0.05 },
      face:    { value: 0, min: -180, max: 180, step: 1 },
      tilt:    { value: 0.06, min: -0.8, max: 0.8, step: 0.01 },
      lightAz: { value: 35, min: -180, max: 180, step: 1 },
      lightEl: { value: 40, min: -90, max: 90, step: 1 },
      ambient: { value: 0.30, min: 0, max: 1, step: 0.01 },
      key:     { value: 1.05, min: 0, max: 2.5, step: 0.05 },
      rim:     { value: 0.30, min: 0, max: 2, step: 0.05 },
      rimPow:  { value: 2.6, min: 0.4, max: 8, step: 0.1 },
      xray:    { value: 0.0, min: 0, max: 1, step: 0.01 },
    },
    gen(N, P) {
      const pos = new Float32Array(3 * N);
      const nrm = new Float32Array(3 * N);
      const aux = new Float32Array(N);
      const bri = new Float32Array(N);
      const src = sampled;
      const m = Math.min(N, src.pos.length / 3);
      const sx = P.size * P["stretch x"], sy = P.size * P["stretch y"];
      for (let i = 0; i < N; i++) {
        const s = i % m;
        pos[3 * i] = src.pos[3 * s] * sx + P["shift x"];
        pos[3 * i + 1] = src.pos[3 * s + 1] * sy + P["shift y"];
        pos[3 * i + 2] = src.pos[3 * s + 2] * P.size;
        nrm[3 * i] = src.nrm[3 * s];
        nrm[3 * i + 1] = src.nrm[3 * s + 1];
        nrm[3 * i + 2] = src.nrm[3 * s + 2];
        // brightness jitter = luma-space dither: the tonal ramp survives the
        // terminal pass's hard dot threshold as dot *density*
        bri[i] = 0.88 + 0.24 * hash01(i);
      }
      return { pos, nrm, aux, bri };
    },
    update(S, P, t) {
      // With `settle` on and the clip's span known (the timeline sets
      // _segStart/_segEnd on the runtime instance), rotation is authored
      // BACKWARDS from the landing: θ = rest − rate · R(t), where R is the
      // remaining rotation-time under a cosine-eased run-out. The stop angle
      // is exact by construction, and past the clip's end the pose freezes.
      const end = this._segEnd;
      let ay, ax2, az2;
      if (P.settle > 0.001 && end !== undefined) {
        const start = this._segStart ?? end - P.settle;
        const D = Math.min(Math.max(0.001, P.settle), Math.max(0.001, end - start));
        const R = spinRunout(t, end, D);
        ay = (P.face * Math.PI) / 180 - P.spin * R;
        ax2 = -(P["spin x"] || 0) * R;
        az2 = -(P["spin z"] || 0) * R;
      } else {
        ay = t * P.spin;
        ax2 = t * (P["spin x"] || 0);
        az2 = t * (P["spin z"] || 0);
      }
      let m = matMul(matRotX(P.tilt), matRotY(ay));
      // world-frame tumble / roll on top of the turntable spin
      if (ax2) m = matMul(matRotX(ax2), m);
      if (az2) m = matMul(matRotZ(az2), m);
      for (let k = 0; k < 4; k++) put(S.grp, k, m);
      S.gbri.set([1, 1, 1, 1]);
      const az = (P.lightAz * Math.PI) / 180, el = (P.lightEl * Math.PI) / 180;
      S.prm.set([Math.cos(el) * Math.sin(az), Math.sin(el),
                 Math.cos(el) * Math.cos(az), P.ambient]);
      S.prm2.set([P.key, P.rim, P.rimPow, P.xray]);
    },
  };
  if (def.tweaks) {
    for (const [k, v] of Object.entries(def.tweaks)) {
      if (mode.params[k]) mode.params[k].value = v;
    }
  }
  return mode;
}

/** Load + sample a bundled asset (or any URL). Resolves to a mode object. */
export async function loadAssetMode(def, count) {
  const res = await fetch(def.file);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const gltf = await loader.parseAsync(await res.arrayBuffer(), "");
  const sampled = sampleSurface(gltf.scene, count);
  disposeTree(gltf.scene);               // only the cloud survives
  return makeAssetMode(def, sampled);
}

/** Same, for a dropped/picked file. */
export async function assetModeFromBuffer(buf, name, count) {
  const gltf = await loader.parseAsync(buf, "");
  const sampled = sampleSurface(gltf.scene, count);
  disposeTree(gltf.scene);
  const label = name.replace(/\.(glb|gltf)$/i, "").slice(0, 18) || "custom";
  return makeAssetMode(
    { key: "custom", label, status: label.toUpperCase() }, sampled);
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose();
      }
    }
  });
}
