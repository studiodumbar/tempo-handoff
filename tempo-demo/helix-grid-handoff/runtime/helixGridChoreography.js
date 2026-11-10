import { clamp01, smooth, hash } from "./helixGridMath.js";

export const MOTION_PATHS = ["tangent", "arc", "vortex", "turbulent"];
export const ITEM_ORDERS = ["reading", "rows", "columns", "snake", "centre", "edges"];
export const REVEAL_DIRECTIONS = ["cells", "down", "centre"];
export const RELEASE_MODES = ["sweep-x", "sweep-y", "cross", "radial", "random", "blocks"];
export const SCATTER_MODES = ["directional", "radial", "random", "blocks"];
export const BUILD_DIRECTIONS = ["release", "down"];

export const MOTION_DEFAULTS = Object.freeze({
  motion: "tangent", order: "reading", releaseMode: "sweep-x", scatterMode: "directional",
  windup: .18, release: .36, morph: .48, whipTurns: 1, whipSoft: .3,
  whipDuration: .54, whipPeak: .5, whipSharpness: 10, buildDirection: "release",
  scatter: .22, turbulence: .16, inertia: .65, drag: 3,
  settle: .035, cluster: 4, seed: 17, pathAmount: .5, cellSpread: .15,
  hold: .035, itemStagger: .025, revealDirection: "cells",
});

const study = (id, name, description, options) => {
  const motion = { ...MOTION_DEFAULTS, ...options };
  return { id, name, description, options: { ...motion,
    whipDuration: options.whipDuration ?? motion.windup + motion.release,
    reveal: { cellReveal: .42, ...options.reveal } } };
};

export const HELIX_GRID_VARIATIONS = Object.freeze([
  study("whip-down", "Whip / down", "A measured wind-up, a broader whip peak, then cells build each flat image and reveal it downwards in staggered blocks.",
    { whipDuration: 1.15, whipPeak: .5, whipSharpness: 8, whipSoft: .25,
      windup: .32, release: 1.3, morph: .15, buildDirection: "down", revealDirection: "down",
      releaseMode: "sweep-y", scatter: .2, turbulence: .1, inertia: .8, drag: 3.2,
      settle: .015, order: "reading", itemStagger: .035, hold: .02, reveal: { cellReveal: 1.3 } }),
  study("whip-rake", "Whip / rake", "A fast helix whip releases a directional rake of cells. Images print where they land.",
    { whipTurns: 1, releaseMode: "sweep-x", scatter: .14, inertia: .85, morph: .42, release: .38 }),
  study("whip-shatter", "Whip / shatter", "The spiral breaks into small block clusters, then brakes sharply into the grid.",
    { whipTurns: -1, motion: "turbulent", releaseMode: "blocks", scatterMode: "blocks", scatter: .45, turbulence: .35, cluster: 3, morph: .52, release: .28, drag: 3.8, seed: 31 }),
  study("cross-current", "Cross current", "Two opposed streams cross the centre and print into fixed product positions.",
    { whipTurns: .75, motion: "arc", releaseMode: "cross", scatter: .2, pathAmount: -.8, inertia: .8, morph: .5, release: .46, itemStagger: 0, revealDirection: "down" }),
  study("radial-break", "Radial break", "A brief outward burst contracts into a precise, flat image reveal.",
    { whipTurns: .5, whipSoft: .15, releaseMode: "radial", scatterMode: "radial", scatter: .65, inertia: .4, motion: "turbulent", turbulence: .18, morph: .56, release: .27, order: "centre", revealDirection: "centre" }),
  study("vortex-cut", "Vortex cut", "A tight curl carries loose cells off the rotating helix, then cuts to settled braille.",
    { whipTurns: 1.25, motion: "vortex", releaseMode: "sweep-y", scatter: .2, pathAmount: .85, inertia: .8, turbulence: .1, morph: .5, release: .38, order: "snake" }),
  study("block-ripple", "Block ripple", "A staggered front peels blocks from the helix and assembles images in short bursts.",
    { whipTurns: -.5, motion: "arc", releaseMode: "blocks", scatterMode: "blocks", cluster: 7, scatter: .26, pathAmount: .45, release: .55, morph: .38, order: "rows", itemStagger: .08, reveal: { cellReveal: .32 } }),
  study("turbulent-sweep", "Turbulent sweep", "A broad sweep with controlled small-scale turbulence, followed by a firm landing.",
    { whipTurns: -1, motion: "turbulent", releaseMode: "sweep-y", scatterMode: "random", scatter: .3, turbulence: .55, inertia: .45, release: .42, morph: .58, drag: 3.5, revealDirection: "down" }),
  study("snap-print", "Snap / print", "A compressed whip and quick cell transfer. Minimal hanging time before the photographs appear.",
    { whipTurns: .5, windup: .12, release: .24, morph: .3, drag: 4, scatter: .09, inertia: .35, settle: .015, itemStagger: .02, hold: .02, reveal: { cellReveal: .28 } }),
]);

export const expoInOut = (value) => {
  const t = clamp01(value);
  return t === 0 || t === 1 ? t : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
};

/** Normalised exponential halves keep a steep, continuous velocity peak at any chosen time. */
export function sourceRotation(time, options) {
  const t = clamp01(time / (options.whipDuration ?? options.windup + options.release));
  const peak = options.whipPeak ?? .5, sharpness = options.whipSharpness ?? 10;
  const floor = Math.pow(2, -sharpness);
  const rise = (p) => (Math.pow(2, sharpness * (p - 1)) - floor) / (1 - floor);
  const impulse = t <= peak ? peak * rise(t / peak)
    : peak + (1 - peak) * (1 - rise((1 - t) / (1 - peak)));
  return options.whipTurns * Math.PI * 2 * (impulse * (1 - options.whipSoft) + smooth(t) * options.whipSoft);
}

export function downwardKey(row, rows, detail = 0) {
  // Detail can stagger a row, but cannot put any cell ahead of the row above it.
  return (row + clamp01(detail) * .8) / Math.max(1, rows);
}

export function releaseKey(x, y, width, height, options, seed = 0) {
  const nx = clamp01(x / width), ny = clamp01(y / height);
  const block = Math.floor(x / (options.cellWidth * options.cluster)) + Math.floor(y / (options.cellWidth * 2 * options.cluster)) * 997;
  let key;
  if (options.releaseMode === "sweep-x") key = nx;
  else if (options.releaseMode === "sweep-y") key = ny;
  else if (options.releaseMode === "cross") key = Math.abs(nx - .5) * 2;
  else if (options.releaseMode === "radial") key = Math.hypot(nx - .5, ny - .5) / Math.SQRT1_2;
  else if (options.releaseMode === "blocks") key = .35 * ny + .65 * hash(block + options.seed);
  else key = hash(seed + options.seed);
  return clamp01(key * (1 - options.cellSpread) + hash(seed + options.seed * 41) * options.cellSpread);
}

/** Translation-only particle trajectories. Product pixels never use these transforms. */
export function flightPoint(source, target, progress, options, seed, extent) {
  const p = clamp01(progress);
  if (p === 1) return { x: target.x, y: target.y };
  if (p === 0) return { x: source.x, y: source.y };
  const e = 1 - Math.pow(1 - p, options.drag), q = 1 - e;
  const dx = target.x - source.x, dy = target.y - source.y, distance = Math.hypot(dx, dy) || 1;
  const velocity = Math.hypot(source.vx || dx, source.vy || dy) || 1;
  const vx = (source.vx || dx) / velocity, vy = (source.vy || dy) / velocity;
  const reach = Math.min(distance, extent) * options.inertia * .8;
  const c1x = source.x + vx * reach, c1y = source.y + vy * reach;
  const c2x = target.x - dx * .08, c2y = target.y - dy * .08;
  let x = q*q*q*source.x + 3*q*q*e*c1x + 3*q*e*e*c2x + e*e*e*target.x;
  let y = q*q*q*source.y + 3*q*q*e*c1y + 3*q*e*e*c2y + e*e*e*target.y;
  const envelope = 6.75 * p * (1 - p) * (1 - p);
  let angle = hash(seed + options.seed * 13) * Math.PI * 2;
  if (options.scatterMode === "directional") angle = Math.atan2(vy, vx) + (hash(seed + 8) - .5) * .7;
  if (options.scatterMode === "radial") angle = Math.atan2(source.y - extent * .5, source.x - extent * .5);
  const force = options.scatter * extent * .36 * envelope * (.35 + hash(seed + 4) * .65);
  x += Math.cos(angle) * force; y += Math.sin(angle) * force;
  if (options.motion === "arc") {
    const bend = Math.sin(Math.PI * e) * options.pathAmount * .24;
    x -= dy * bend; y += dx * bend;
  } else if (options.motion === "vortex") {
    const spin = p * Math.PI * 3 + seed * .17, radius = options.pathAmount * Math.min(distance, extent) * .12 * envelope;
    x += Math.cos(spin) * radius; y += Math.sin(spin) * radius;
  }
  const turbulence = options.turbulence * extent * .065 * envelope
    * (options.motion === "turbulent" ? 1 + Math.abs(options.pathAmount) * 2 : .5);
  x += Math.sin(p * 9 + seed * .61) * turbulence;
  y += Math.cos(p * 11 + seed * .37) * turbulence;
  const settle = Math.sin(p * Math.PI * 3) * Math.pow(p, 4) * (1 - p) * options.settle * extent;
  x += dx / distance * settle; y += dy / distance * settle;
  return { x, y };
}

export function itemRanks(rectangles, order) {
  if (!rectangles.length) return [];
  const centres = rectangles.map((r, index) => ({ index, x: r.x + r.width / 2, y: r.y + r.height / 2 }));
  const rows = [...new Set(centres.map((p) => Math.round(p.y / 4)))].sort((a, b) => a - b);
  const columns = [...new Set(centres.map((p) => Math.round(p.x / 4)))].sort((a, b) => a - b);
  const cx = centres.reduce((s, p) => s + p.x, 0) / centres.length;
  const cy = centres.reduce((s, p) => s + p.y, 0) / centres.length;
  const row = (p) => rows.indexOf(Math.round(p.y / 4));
  if (order === "rows") return centres.map(row);
  if (order === "columns") return centres.map((p) => columns.indexOf(Math.round(p.x / 4)));
  const distance = (p) => Math.hypot(p.x - cx, p.y - cy);
  const sorted = [...centres].sort((a, b) => {
    if (order === "centre" || order === "edges") return (distance(a) - distance(b)) * (order === "edges" ? -1 : 1) || a.index - b.index;
    if (order === "snake") return row(a) - row(b) || (a.x - b.x) * (row(a) % 2 ? -1 : 1);
    return a.y - b.y || a.x - b.x;
  });
  const ranks = [];
  sorted.forEach((p, rank) => { ranks[p.index] = rank; });
  return ranks;
}
