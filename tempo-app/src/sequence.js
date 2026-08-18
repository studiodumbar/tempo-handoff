// The sequence — where the timeline model meets the particle engine.
//
// A project is a row of clips. Each clip is a STATE the pool settles into
// (a procedural mode or a sampled GLB), entered through a transition that
// belongs to the clip (its leading edge). Time inside clip i:
//
//        start ──┬───────────────┬──────────── end
//                │  transition   │    hold
//                │  (from i-1)   │  (settled)
//
// Everything renders from (T) alone: locate the segment, load the A → B pair
// into the engine (cached — reloads only when the pair or a layout changes),
// set the per-particle progress, render. Playback, scrubbing and export all
// walk through the same evaluate/drive path, so what you scrub is exactly
// what exports.

import { MODE_BY_KEY } from "./modes.js";
import { sortLayout } from "./particles.js";
import { expoInOut, expoOut, smooth } from "./easing.js";

// ---- targets ----------------------------------------------------------------
// A clip renders through its own INSTANCE of the library target: a prototype
// child with private param values, so two "sphere" clips can differ. Layout
// (gen) is re-run only when a regen-marked param changes.

let assetResolver = () => null;

/** main registers how asset keys resolve to loaded asset modes. */
export function setAssetResolver(fn) {
  assetResolver = fn;
}

export function baseModeFor(clip) {
  if (clip.kind === "mode") return MODE_BY_KEY[clip.key] || null;
  return assetResolver(clip.key);
}

/** Default + override param values for a clip against its base mode. */
export function mergedParams(clip, base) {
  const out = {};
  for (const [k, spec] of Object.entries(base.params)) {
    out[k] = clip.params[k] !== undefined ? clip.params[k] : spec.value;
  }
  return out;
}

const runtimeCache = new Map(); // clip.id -> {sig, inst, layout}

function regenSig(clip, base, N) {
  const parts = [clip.kind, clip.key, N, base._sig || ""];
  for (const k of base.regen) {
    parts.push(k, clip.params[k] !== undefined ? clip.params[k] : base.params[k].value);
  }
  return parts.join("|");
}

/** The clip's runtime: instance + sorted layout, cached until a regen param,
    the target, or the pool size changes. Returns null while an asset is
    still sampling. */
export function clipRuntime(clip, N) {
  const base = baseModeFor(clip);
  if (!base) return null;
  const sig = regenSig(clip, base, N);
  let rt = runtimeCache.get(clip.id);
  if (!rt || rt.sig !== sig) {
    const inst = Object.create(base);
    inst._values = mergedParams(clip, base);
    if (base.asset) inst._occHost = base;
    const layout = sortLayout(base.gen(N, inst._values), N);
    rt = { sig, inst, layout, clipId: clip.id };
    runtimeCache.set(clip.id, rt);
  }
  // non-regen params are live — refresh every access, it's a dozen assigns
  const merged = mergedParams(clip, base);
  for (const k in merged) rt.inst._values[k] = merged[k];
  // a hold's spin continues the flight's trajectory: whatever handedness the
  // arrival swirl had, the resident rotation keeps it
  if (rt.inst._values.spin && clip.trans && clip.trans.swirl) {
    rt.inst._values.spin =
      Math.sign(clip.trans.swirl) * Math.abs(rt.inst._values.spin);
  }
  return rt;
}

export function invalidateClip(clipId) {
  runtimeCache.delete(clipId);
  introCache.delete(clipId);
  outroCache.delete(clipId);
}

export function invalidateAllClips() {
  runtimeCache.clear();
  introCache.clear();
  outroCache.clear();
}

/** Drop cache entries for clips that no longer exist. */
export function pruneRuntimes(clips) {
  const alive = new Set(clips.map((c) => c.id));
  for (const id of runtimeCache.keys()) {
    if (!alive.has(id)) runtimeCache.delete(id);
  }
  for (const id of introCache.keys()) {
    if (!alive.has(id)) introCache.delete(id);
  }
  for (const id of outroCache.keys()) {
    if (!alive.has(id)) outroCache.delete(id);
  }
}

// ---- the intro ---------------------------------------------------------------
// The first clip has no previous state to fly in from, so an intro supplies a
// synthetic one: same pool, same rank order, brightness zero — the opening is
// the engine's ordinary A → B morph from a source nobody ever sees settled.

export const INTRO_STYLES = ["none", "print", "burst", "assemble", "rain", "rise", "converge"];

// Slot A during an intro: an inert mode. Its id matches no field branch in the
// shader, so evalSlot leaves position and brightness exactly as authored.
const INTRO_MODE = {
  key: "__intro", label: "intro", id: -1, regen: [], params: {},
  gen() { throw new Error("intro source layouts are derived, never generated"); },
  update(S) {
    S.grp.fill(0);
    for (let k = 0; k < 4; k++) { S.grp[k * 9] = 1; S.grp[k * 9 + 4] = 1; S.grp[k * 9 + 8] = 1; }
    S.gbri.set([1, 1, 1, 1]);
    S.prm.set([0, 0, 0, 0]);
    S.prm2.set([0, 0, 0, 0]);
  },
};

const hash1 = (i) => (i * 0.6180339887) % 1;
const hash2 = (i) => (i * 0.7548776662) % 1;
const hash3 = (i) => (i * 0.3287361832) % 1;

/** Source layout for an intro style, derived from the target's sorted layout
    so the rank match is 1:1. Brightness is zero everywhere — dots print in
    over their flight window. */
function introSource(style, layout, N) {
  const bri = new Float32Array(N);                  // invisible until it flies
  if (style === 1) {                                // print — in place
    return { pos: layout.pos, aux: layout.aux, bri, nrm: layout.nrm };
  }
  const pos = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    const x = layout.pos[3 * i], y = layout.pos[3 * i + 1], z = layout.pos[3 * i + 2];
    const a = hash1(i) * 2 - 1, b = hash2(i) * 2 - 1, c = hash3(i) * 2 - 1;
    let px = x, py = y, pz = z;
    if (style === 2) {                              // burst — from the centre
      px = a * 0.02; py = b * 0.02; pz = c * 0.02;
    } else if (style === 3) {                       // assemble — from a cloud
      px = a * 1.8; py = b * 1.8; pz = c * 1.8;
    } else if (style === 4) {                       // rain — from above
      py = y + 2.4 + hash1(i) * 1.2;
    } else if (style === 5) {                       // rise — from below
      py = y - 2.4 - hash1(i) * 1.2;
    } else if (style === 6) {                       // converge — from beyond the rim
      const k = 2.6 / Math.max(Math.hypot(x, y, z), 0.15);
      px = x * k; py = y * k; pz = z * k;
    }
    pos[3 * i] = px; pos[3 * i + 1] = py; pos[3 * i + 2] = pz;
  }
  return { pos, aux: layout.aux, bri, nrm: layout.nrm };
}

const introCache = new Map(); // clip.id -> {sig, inst, layout}
const outroCache = new Map(); // clip.id -> {sig, inst, layout}

function introRuntime(clip, curRt, N) {
  const style = clip.intro | 0;
  const sig = `intro${style}|${curRt.sig}`;
  let e = introCache.get(clip.id);
  if (!e || e.sig !== sig) {
    e = { sig, inst: INTRO_MODE, layout: introSource(style, curRt.layout, N) };
    introCache.set(clip.id, e);
  }
  return e;
}

/** The exit is the intro run backwards: the same synthetic bri-0 layouts,
    used as the pair's B side — dots fly TO them and fade out on the way. */
function outroRuntime(clip, curRt, N) {
  const style = clip.outro | 0;
  const sig = `exit${style}|${curRt.sig}`;
  let e = outroCache.get(clip.id);
  if (!e || e.sig !== sig) {
    e = { sig, inst: INTRO_MODE, layout: introSource(style, curRt.layout, N) };
    outroCache.set(clip.id, e);
  }
  return e;
}

// ---- time math ---------------------------------------------------------------

/** A clip owns its leading transition — for the first clip that's the intro
    flight, present only when an intro style is set. */
function transLen(clip, index) {
  if (index > 0 || (clip.intro | 0) > 0) return Math.max(0, clip.trans.duration);
  return 0;
}

/** A clip's exit flight — present on ANY clip with an outro style set. A
    mid-timeline exit empties the screen; the NEXT clip then enters from the
    exited state instead of morphing from the settled one. */
function outroLen(clip) {
  if ((clip.outro | 0) <= 0) return 0;
  return Math.max(0, clip.outroTrans?.duration ?? 0.9);
}

export function clipDuration(clip, index) {
  return transLen(clip, index) + Math.max(0, clip.hold) + outroLen(clip);
}

/** [{clip, index, start, transEnd, outroStart, end}] in timeline order.
    The first clip's `delay` is empty space before it (the lead-in — drive()
    renders it fully faded); a clip's outro is the exit flight after its
    hold (outroStart == end when there is none). */
export function segments(clips) {
  const out = [];
  let t = 0;
  clips.forEach((clip, index) => {
    if (index === 0) t += Math.max(0, clip.delay || 0);
    const trans = transLen(clip, index);
    const outro = outroLen(clip);
    const outroStart = t + trans + Math.max(0, clip.hold);
    out.push({ clip, index, start: t, transEnd: t + trans,
               outroStart, end: outroStart + outro });
    t = outroStart + outro;
  });
  return out;
}

export function totalDuration(clips) {
  const segs = segments(clips);
  return segs.length ? segs[segs.length - 1].end : 0;
}

/** The WHIP: extra Y rotation through a transition — the spin ramps up
    hard into the cut and back down after. The angle follows the house
    expoInOut across [transStart - ramp, transEnd + ramp]; its derivative
    IS the velocity bump. A finished window leaves a whole number of extra
    turns behind — a permanent, invisible phase offset, so motion stays
    continuous forever after. */
export function whipAngle(clips, T) {
  let th = 0;
  for (const seg of segments(clips)) {
    const turns = seg.clip.trans.whip ?? 0;
    if (!turns) continue;
    const r = Math.max(0, seg.clip.trans.whipRamp ?? 0.45);
    const w0 = seg.start - r, w1 = seg.transEnd + r;
    if (w1 - w0 < 1e-4) continue;
    const w = Math.min(1, Math.max(0, (T - w0) / (w1 - w0)));
    // WHOLE turns only — a whip that carries forward AND lands the scene
    // unrotated must complete full revolutions; that is geometry. HOW
    // extreme the turn feels is shaped instead: whipSoft blends the angle
    // curve from the house expo (velocity slams the cut, ~7x average) to a
    // plain smoothstep (~1.5x average) — same turn, spent evenly.
    const soft = Math.min(1, Math.max(0, seg.clip.trans.whipSoft ?? 0));
    th += Math.round(turns) * 2 * Math.PI *
      ((1 - soft) * expoInOut(w) + soft * smooth(w));
  }
  return th;
}

/** The whole project's duration: the clip sequence OR the photo lane,
    whichever runs longer. */
export function projectDuration(p) {
  let t = totalDuration(p.clips);
  for (const ph of p.photos || []) t = Math.max(t, (ph.start || 0) + (ph.dur || 0));
  return t;
}

/** Where time T lands: segment + phase (0..1 through the transition; 1 once
    settled). Clamps outside the timeline. */
export function locate(clips, T) {
  const segs = segments(clips);
  if (!segs.length) return null;
  const last = segs[segs.length - 1];
  const t = Math.min(Math.max(T, 0), last.end);
  let seg = last;
  for (const s of segs) {
    if (t < s.end || s === last) { seg = s; if (t < s.end) break; }
  }
  const tl = seg.transEnd - seg.start;   // 0 for a first clip with no intro
  const phase = tl <= 1e-6 ? 1 : Math.min(1, Math.max(0, (t - seg.start) / tl));
  const ol = seg.end - seg.outroStart;   // 0 unless the last clip has an outro
  const exitPhase = ol > 1e-6 && t > seg.outroStart
    ? Math.min(1, (t - seg.outroStart) / ol)
    : null;
  return { seg, segs, phase, t, lead: t < segs[0].start, exitPhase };
}

// ---- engine driver -----------------------------------------------------------

let loadedPairKey = "";

export function invalidatePair() {
  loadedPairKey = "";
}

/**
 * Point the engine at time T. Returns true when the frame is fully
 * deterministic and renderable; false while a target is still loading
 * (the previous pair stays on screen).
 */
export function drive(engine, clips, T) {
  const loc = locate(clips, T);
  if (!loc) return true;                       // empty timeline: leave engine be
  const { seg, segs, phase } = loc;
  engine.fade = loc.lead ? 1 : 0;              // the lead-in holds black
  // seconds into this clip, counting from the START of its arrival flight —
  // a cell-reveal photo paces off this, so its build can run alongside the
  // transition instead of waiting for the dots to land first
  engine.clipT = Math.max(0, loc.t - seg.start);
  const cur = clipRuntime(seg.clip, engine.N);
  const prevClip = seg.index > 0 ? segs[seg.index - 1].clip : seg.clip;
  let prev = seg.index > 0 ? clipRuntime(prevClip, engine.N) : cur;
  if (seg.index === 0 && cur && (seg.clip.intro | 0) > 0) {
    prev = introRuntime(seg.clip, cur, engine.N);
  } else if (seg.index > 0 && prev && (prevClip.outro | 0) > 0) {
    // the previous clip EXITED — this clip enters from the exited state
    // (the exit target's positions, brightness zero), not the settled one
    prev = outroRuntime(prevClip, prev, engine.N);
  }
  if (!cur || !prev) return false;

  // each runtime knows its clip's span — asset spin run-outs (`settle`)
  // anchor their landing to the end of the HOLD (outroStart), so a landed
  // pose is what flies out
  cur.inst._segStart = seg.start;
  cur.inst._segEnd = seg.outroStart;
  if (seg.index > 0) {
    const ps = segs[seg.index - 1];
    prev.inst._segStart = ps.start;
    prev.inst._segEnd = ps.outroStart;
  }

  // in the exit zone the pair flips: the settled clip is the A side and the
  // synthetic bri-0 exit layout is the target, flown on the outro's own
  // controls; keys come from the DEPARTING layout so leave-order reads on
  // the visible figure (an exit target may be a collapsed point)
  const exiting = loc.exitPhase !== null;
  let A = prev, B = cur, aId = prevClip.id, bId = seg.clip.id;
  let tr = seg.clip.trans, prog = phase;
  if (exiting) {
    A = cur;
    B = outroRuntime(seg.clip, cur, engine.N);
    aId = seg.clip.id;
    bId = seg.clip.id;
    tr = seg.clip.outroTrans || seg.clip.trans;
    prog = loc.exitPhase;
  }
  const mosaic = tr.staggerAxis >= 4
    ? `${tr.blockOrder ?? 0}:${tr.blocksX ?? 6}:${tr.blocksY ?? 0}:${tr.blockLag ?? 1.7}:${tr.blockSeed ?? 0}:${tr.printStyle ?? 0}:${engine.frameFov}:${engine.frameAspect}`
    : "";
  const pairKey = `${A.sig}@${aId}→${B.sig}@${bId}|${tr.staggerAxis}|${mosaic}${exiting ? "|X" : ""}`;
  if (pairKey !== loadedPairKey) {
    engine.staggerAxis = tr.staggerAxis;
    engine.blockOrder = tr.blockOrder ?? 0;
    engine.blocksX = tr.blocksX ?? 6;
    engine.blocksY = tr.blocksY ?? 0;
    engine.blockLag = tr.blockLag ?? 1.7;
    engine.blockSeed = tr.blockSeed ?? 0;
    engine.printStyle = tr.printStyle ?? 0;
    engine.keysFromA = exiting;
    engine.setPairDirect(A.inst, A.layout, B.inst, B.layout);
    loadedPairKey = pairKey;
  }
  engine.printTrail = tr.printTrail ?? 0.35;
  // the cursor orders read crisp: a single printing cell, not a ragged front
  const ord = tr.blockOrder ?? 0;
  engine.printLead = ord === 1 || ord === 2 || ord === 7 ? 0.012 : 0.07;
  engine.spread = tr.spread;
  engine.easeIndex = tr.ease;
  engine.pathMode = tr.path;
  engine.pathAmp = tr.pathAmp;
  engine.scatter = tr.scatter;
  engine.swirl = tr.swirl * 2 * Math.PI;
  engine.renderState(T, prog);
  return true;
}

// ---- the camera track ----------------------------------------------------------
// Keyframes are orbit states (azimuth / elevation / distance about a target
// point). Between keys the orbit interpolates — azimuth by shortest arc —
// through the segment's ease. Outside the keyed range the ends hold.

export const CAM_EASES = ["linear", "smooth", "expoInOut", "expoOut"];
const CAM_EASE_FNS = {
  linear: (x) => x,
  smooth,
  expoInOut,
  expoOut,
};

export function cameraStateFrom(camera, target) {
  const dx = camera.position.x - target.x;
  const dy = camera.position.y - target.y;
  const dz = camera.position.z - target.z;
  const dist = Math.max(1e-4, Math.hypot(dx, dy, dz));
  return {
    az: Math.atan2(dx, dz),
    el: Math.asin(Math.min(1, Math.max(-1, dy / dist))),
    dist,
    tx: target.x, ty: target.y, tz: target.z,
  };
}

export function applyCameraState(camera, controls, s) {
  const ce = Math.cos(s.el);
  camera.position.set(
    s.tx + s.dist * ce * Math.sin(s.az),
    s.ty + s.dist * Math.sin(s.el),
    s.tz + s.dist * ce * Math.cos(s.az),
  );
  controls.target.set(s.tx, s.ty, s.tz);
  camera.lookAt(s.tx, s.ty, s.tz);
}

export function evalCamera(kfs, T) {
  if (!kfs.length) return null;
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  if (T <= sorted[0].t) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (T >= last.t) return last;
  let a = sorted[0], b = sorted[1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t >= T) { a = sorted[i - 1]; b = sorted[i]; break; }
  }
  const span = Math.max(1e-6, b.t - a.t);
  const ease = CAM_EASE_FNS[b.ease] || smooth;
  const e = ease((T - a.t) / span);
  let dAz = b.az - a.az;
  dAz = ((dAz + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return {
    az: a.az + dAz * e,
    el: a.el + (b.el - a.el) * e,
    dist: a.dist + (b.dist - a.dist) * e,
    tx: a.tx + (b.tx - a.tx) * e,
    ty: a.ty + (b.ty - a.ty) * e,
    tz: a.tz + (b.tz - a.tz) * e,
  };
}

// ---- formatting ----------------------------------------------------------------

export function fmtTime(t, fps) {
  const s = Math.max(0, t);
  const whole = Math.floor(s);
  const frames = Math.round((s - whole) * fps);
  const m = Math.floor(whole / 60);
  const sec = whole % 60;
  return `${m}:${String(sec).padStart(2, "0")}.${String(Math.min(frames, fps - 1)).padStart(2, "0")}`;
}

export function fmtSeconds(t) {
  return `${(Math.round(t * 100) / 100).toFixed(2)}s`;
}
