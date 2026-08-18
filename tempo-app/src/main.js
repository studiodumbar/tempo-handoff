// TEMPO · Motion — boot, the render loop, and every user action.
//
// The composition (comp) is the unit of truth: a fixed W × H × fps canvas the
// viewport previews at any zoom and the exporter renders 1:1. The timeline
// evaluates deterministically from the playhead (sequence.js), so playback,
// scrubbing and export are the same picture.

import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { ParticleEngine, mosaicTileKeys } from "./particles.js";
import { TerminalPass } from "./terminal.js";
import { OcclusionPass } from "./occlusion.js";
import { MODE_BY_KEY, featuredModes, paramValues } from "./modes.js";
import { ASSET_DEFS, loadAssetMode, assetModeFromBuffer } from "./assets.js";
import { imageModeFromFile } from "./vectorImport.js";
import { PhotoOverlay } from "./photo.js";
import { store, makeClip, defaultProject, normalizeProject, uid } from "./store.js";
import { expoInOut } from "./easing.js";
import {
  setAssetResolver, drive, segments, totalDuration, projectDuration, whipAngle, locate,
  baseModeFor,
  invalidatePair, pruneRuntimes,
  cameraStateFrom, applyCameraState, evalCamera,
} from "./sequence.js";
import {
  h, toast, showMenu, closeMenus, modKey, isMac, confirmAction, showShortcuts,
} from "./ui/dom.js";
import { iconButton } from "./ui/fields.js";
import { appNav, skipLink } from "./ui/appnav.js";
import { buildLibraryPanel } from "./ui/library.js";
import { buildInspector } from "./ui/inspector.js";
import { buildTimeline } from "./ui/timeline.js";
import { runExport } from "./export.js";

THREE.ColorManagement.enabled = false;

// ---- gl boot -------------------------------------------------------------------

const canvas = document.getElementById("view");
if (!document.createElement("canvas").getContext("webgl2")) {
  document.getElementById("fatal").hidden = false;
  throw new Error("WebGL2 unavailable");
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
});
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene3 = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
camera.position.set(0, 0, 3.55);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.55;
controls.enablePan = false;
controls.minDistance = 1.4;
controls.maxDistance = 10;

const params = new URLSearchParams(location.search);
const poolN = Math.min(65536, Math.max(1024, Number(params.get("n")) || 16384));
const engine = new ParticleEngine(poolN);
engine.camera = camera;
scene3.add(engine.points);

const terminal = new TerminalPass();
const occlusion = new OcclusionPass(engine);
const photoOverlay = new PhotoOverlay();

// ---- asset library ----------------------------------------------------------------

const assetLib = new Map();
for (const d of ASSET_DEFS) {
  assetLib.set(d.key, { key: d.key, label: d.label, def: d, custom: false, state: "idle", mode: null });
}
const libListeners = new Set();
const libChanged = () => { for (const fn of [...libListeners]) fn(); };

setAssetResolver((key) => assetLib.get(key)?.mode || null);

async function ensureAsset(key) {
  const entry = assetLib.get(key);
  if (!entry || entry.state === "ready" || entry.state === "loading") return;
  if (entry.shipped) return loadShippedImage(entry);
  if (entry.customLoad) return loadCustomAsset(entry);
  if (!entry.def) return;
  entry.state = "loading";
  libChanged();
  try {
    entry.mode = await loadAssetMode(entry.def, engine.N);
    entry.state = "ready";
  } catch (err) {
    console.error(err);
    entry.state = "error";
    toast(`Could not load ${entry.label} — ${err.message || err}`, { kind: "error" });
  }
  libChanged();
  store.emit("project");           // clips waiting on this asset re-evaluate
}

/** An asset with a bespoke loader (Merch: several rasters behind one
    dropdown, rather than one URL) — same idle/loading/ready/error dance as
    everything else in the library. */
async function loadCustomAsset(entry) {
  entry.state = "loading";
  libChanged();
  try {
    entry.mode = await entry.customLoad();
    entry.state = "ready";
  } catch (err) {
    console.error(err);
    entry.state = "error";
    toast(`Could not load ${entry.label} — ${err.message || err}`, { kind: "error" });
  }
  libChanged();
  store.emit("project");
}

/** A PNG / JPG / SVG becomes a re-samplable image asset, exactly as on the
    Visual page — same sampler, same live tuning params — and lands straight
    on the timeline like an imported GLB. Session-local: a saved project
    remembers the clip, not the pixels. */
async function registerImage(file) {
  const t = toast(`Tracing ${file.name}…`, { kind: "busy", duration: 0 });
  try {
    const mode = await imageModeFromFile(file, engine.N);
    let key = (mode.key || "").replace(/^asset:/, "")
      || `image-${mode.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    while (assetLib.has(key)) key += "-2";
    mode.key = `asset:${key}`;
    assetLib.set(key, { key, label: mode.label, custom: "image", state: "ready", mode });
    libChanged();
    t.dismiss();
    actions.addClip("asset", key);
    toast(`${mode.label} added to the library`);
  } catch (err) {
    console.error(err);
    t.dismiss();
    toast(`Could not trace ${file.name} — ${err.message || err}`, { kind: "error" });
  }
}

const SHIPPED_IMAGES = [];

// ---- Merch: one asset, several garments behind a dropdown -------------------
// Every garment is its own traced image mode (own raster, own dot layout) —
// `garment` picks which one gen()/update()/photo delegate to. Every OTHER
// param (threshold, cellReveal, …) is a single shared dial that applies
// whichever garment is showing, so retuning one doesn't mean retuning three.

const MERCH_GARMENTS = [
  { key: "hoodie", label: "Hoodie", url: "./plates/hoodie.png" },
  { key: "bag", label: "Bag", url: "./plates/bag.png" },
  { key: "longsleeve", label: "Longsleeve", url: "./plates/longsleeve.png" },
  { key: "cap", label: "Cap", url: "./plates/cap.png" },
  { key: "water", label: "Water", url: "./plates/water.png" },
];
const MERCH_DEFAULT_GARMENT = 2;   // longsleeve — the one already tuned

async function loadMerchMode() {
  const subModes = await Promise.all(MERCH_GARMENTS.map(async (g) => {
    const res = await fetch(g.url);
    if (!res.ok) throw new Error(`${g.label}: ${res.status}`);
    const file = new File([await res.blob()], g.url.split("/").pop(), { type: "image/png" });
    return imageModeFromFile(file, engine.N);
  }));
  const base = subModes[MERCH_DEFAULT_GARMENT];
  const garmentAt = (P) => subModes[Math.round(P?.garment ?? MERCH_DEFAULT_GARMENT)];
  return {
    key: "asset:merch",
    label: "Merch",
    id: 18,                        // image field: rigid + block license
    image: true,
    regen: [...base.regen, "garment"],
    params: {
      ...base.params,
      garment: { value: MERCH_DEFAULT_GARMENT, min: 0, max: subModes.length - 1, step: 1,
                 options: MERCH_GARMENTS.map((g) => g.label) },
      // no ink override on purpose: it rides base.params on "auto", and each
      // garment's own gen() resolves that against its own pixels. Pinning it
      // to a number here would hand the default garment's polarity to all six
      // — a dark bag under the longsleeve's light-is-ink traces to nothing.
      // photo: 1 — settled, the trace hands off to the photograph rather
      // than sitting in braille. cellReveal — that hand-off builds cell by
      // cell over the terminal's own grid instead of a plain cross-fade.
      photo: { value: 1, min: 0, max: 1, step: 0.01 },
      cellReveal: { value: 1.4, min: 0, max: 4, step: 0.05 },
      // seconds of clipT to wait through before the build starts at all
      cellDelay: { value: 0, min: 0, max: 4, step: 0.05 },
      // each band's share of both the rows and the reveal time — equal
      // weights split evenly; 1x1 starts ahead so it doesn't flash past
      cell1x1: { value: 2, min: 0.1, max: 6, step: 0.1 },
      cell2x2: { value: 1, min: 0.1, max: 6, step: 0.1 },
      cell3x3: { value: 1, min: 0.1, max: 6, step: 0.1 },
      cell4x4: { value: 1, min: 0.1, max: 6, step: 0.1 },
      cell5x5: { value: 1, min: 0.1, max: 6, step: 0.1 },
      // how far each band's window bleeds into its neighbours' — 0 seals
      // them (2x2 waits for every 1x1 first), higher blends the hand-off
      cellOverlap: { value: 0.4, min: 0, max: 1, step: 0.02 },
      // 0: the base print — a ruler-straight seam between band sizes.
      // Raise it to feather that seam into an organic wobble instead
      cellWobble: { value: 0, min: 0, max: 1, step: 0.02 },
      // scatters the sweep's order — 0 clean sweep, 1 fully random
      cellStagger: { value: 0.7, min: 0, max: 1, step: 0.01 },
      // how far past the PNG's cutout outline a popped cell keeps clearing,
      // in GLYPH CELLS — a glyph holding an edge dot overhangs the silhouette,
      // and without this its leftover sticks to the garment's sides. The
      // overhang IS a cell, so the radius is derived from the live cell rather
      // than set in raster px: one number now holds for every garment, size
      // and comp. 1 covers the cell the dot sits in, and the block pass's
      // hotSpread dilation reaches about half a cell past that
      cellBleed: { value: 1.5, min: 0, max: 4, step: 0.1 },
      // the crisp photo's OWN tone — a dark, low-key source photographed
      // against the scene's near-black background loses its shadow detail
      // entirely; these dial the PHOTO back, independent of the trace's
      // own threshold/gamma/contrast
      photoBrightness: { value: 1, min: 0.2, max: 3, step: 0.02, group: "Photo display" },
      photoContrast: { value: 1, min: 0.2, max: 3, step: 0.02, group: "Photo display" },
      photoGamma: { value: 1, min: 0.2, max: 3, step: 0.02, group: "Photo display" },
    },
    gen(N, P) { return garmentAt(P).gen(N, P); },
    update(S, P, t) { return garmentAt(P).update(S, P, t); },
    get photo() { return garmentAt(this._values).photo; },
  };
}

function registerMerch() {
  if (assetLib.has("merch")) return;
  assetLib.set("merch", { key: "merch", label: "Merch", custom: "image",
                          state: "idle", mode: null, customLoad: loadMerchMode });
  libChanged();
}

/** Await an asset entry until it is genuinely ready (ensureAsset returns
    early when another caller is already loading it). */
function waitAsset(key) {
  return new Promise((resolve) => {
    const check = () => {
      const e = assetLib.get(key);
      if (!e || e.state === "error") { libListeners.delete(check); resolve(null); }
      else if (e.state === "ready") { libListeners.delete(check); resolve(e.mode); }
    };
    libListeners.add(check);
    ensureAsset(key);
    check();
  });
}

/** Lock a shipped image to its GLB counterpart: measure both layouts once
    and calibrate the image so EQUAL size params render EQUAL visual extents
    — fitted so the image is never larger than the asset on either axis —
    with centres aligned. After this, matching numbers means matching size. */
async function matchImageToAsset(imgMode, assetKey) {
  const glb = await waitAsset(assetKey);
  if (!glb) return;
  const PV = paramValues(glb);
  // extents through the canonical front view (the house perspective divide),
  // so the GLB's depth is priced in — the image itself sits flat at z = 0
  const ext = (pos) => {
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (let i = 0; i < pos.length; i += 3) {
      const w = 3.55 / Math.max(0.5, 3.55 - pos[i + 2]);
      const x = pos[i] * w, y = pos[i + 1] * w;
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
    }
    return { mnx, mxx, mny, mxy };
  };
  const eg = ext(glb.gen(engine.N, PV).pos);                  // world (size baked)
  const ei = ext(imgMode.gen(engine.N, paramValues(imgMode)).pos);  // unit frame
  const exg = (eg.mxx - eg.mnx) / 2, eyg = (eg.mxy - eg.mny) / 2;
  const exi = Math.max(1e-4, (ei.mxx - ei.mnx) / 2);
  const eyi = Math.max(1e-4, (ei.mxy - ei.mny) / 2);
  const szGlb = PV.size || 1;
  const K = 0.98 * Math.min(exg / exi, eyg / eyi) / szGlb;    // 2% inside — never larger
  imgMode._sizeCal = K;
  // same numbers = same size: the image's defaults become the asset's, and
  // its centre lands on the asset's centre
  imgMode.params.size.value = szGlb;
  imgMode.params["shift x"].value = ((eg.mnx + eg.mxx) / 2) / (szGlb * K);
  imgMode.params["shift y"].value = ((eg.mny + eg.mxy) / 2) / (szGlb * K);
  imgMode._values = null;             // re-derive live values from the new defaults
  invalidatePair();
  store.emit("project");
}

/** Shipped images are named in the library from the first frame and traced on
    first use — nothing is fetched until one is actually chosen. */
function registerShippedImages() {
  for (const def of SHIPPED_IMAGES) {
    if (assetLib.has(def.key)) continue;
    const entry = { key: def.key, label: def.label ?? def.key, custom: "image",
                    state: "idle", mode: null, shipped: def };
    assetLib.set(def.key, entry);
    for (const a of def.aliases || []) {
      if (!assetLib.has(a)) assetLib.set(a, { ...entry, key: a, hidden: true });
    }
  }
  libChanged();
}

async function loadShippedImage(entry) {
  const def = entry.shipped;
  entry.state = "loading";
  libChanged();
  try {
    const res = await fetch(def.url);
    if (!res.ok) throw new Error(`${res.status}`);
    const file = new File([await res.blob()], def.url.split("/").pop(),
                          { type: "image/png" });
    const mode = await imageModeFromFile(file, engine.N);
    mode.key = `asset:${def.key}`;
    mode.label = def.label ?? def.key;
    entry.mode = mode;
    entry.state = "ready";
    // every alias points at the same traced mode
    for (const a of def.aliases || []) {
      const al = assetLib.get(a);
      if (al) { al.mode = mode; al.state = "ready"; }
    }
    if (def.match) matchImageToAsset(mode, def.match).catch(console.error);
  } catch (err) {
    console.error("shipped image", def.key, err);
    entry.state = "error";
    toast(`Could not open ${def.key} — ${err.message || err}`, { kind: "error" });
  }
  libChanged();
  store.emit("project");     // clips waiting on it re-evaluate
}

async function registerGlb(buffer, filename) {
  const t = toast(`Sampling ${filename}…`, { kind: "busy", duration: 0 });
  try {
    const mode = await assetModeFromBuffer(buffer, filename, engine.N);
    let key = `custom-${mode.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    while (assetLib.has(key)) key += "-2";
    mode.key = `asset:${key}`;
    assetLib.set(key, { key, label: mode.label, custom: true, state: "ready", mode });
    libChanged();
    t.dismiss();
    actions.addClip("asset", key);
    toast(`${mode.label} added to the library`);
  } catch (err) {
    console.error(err);
    t.dismiss();
    toast(`Could not read ${filename} — ${err.message || err}`, { kind: "error" });
  }
}

// ---- viewport layout ----------------------------------------------------------------

const viewport = document.getElementById("viewport");
const stage = document.getElementById("stage");
const stageLabel = document.querySelector(".stage-label");

let viewScale = 1;
let bufW = 2, bufH = 2;
let appliedSig = "";

function layoutViewport() {
  if (store.session.exporting) return;
  const comp = store.project.comp;
  const scn = store.project.scene;
  const vr = viewport.getBoundingClientRect();
  const availW = Math.max(80, vr.width - 48);
  const availH = Math.max(80, vr.height - 56);
  const fit = Math.min(availW / comp.width, availH / comp.height);
  viewScale = store.session.zoomFit ? Math.min(fit, 4) : store.session.zoom;
  const cssW = Math.max(24, comp.width * viewScale);
  const cssH = Math.max(24, comp.height * viewScale);
  stage.style.width = `${cssW}px`;
  stage.style.height = `${cssH}px`;

  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(dpr);
  renderer.setSize(cssW, cssH, false);
  bufW = Math.round(cssW * dpr);
  bufH = Math.round(cssH * dpr);
  camera.aspect = comp.width / comp.height;
  camera.updateProjectionMatrix();

  terminal.cellW = scn.cellW;
  terminal.cellH = scn.cellH;
  terminal.setSize(comp.width, comp.height, bufW, bufH);
  occlusion.setSize(bufW / 2, bufH / 2);

  stageLabel.textContent = "";
  // the zoom chip owns the zoom reading; repeating it eight pixels away is
  // two sources for one number
  stageLabel.append(
    h("b", {}, store.project.name),
    h("span", {}, `${comp.width} × ${comp.height} · ${comp.fps} fps`),
  );
  zoomPct.textContent = `${Math.round(viewScale * 100)}%`;
  appliedSig = layoutSig();
}

function layoutSig() {
  const c = store.project.comp, s = store.project.scene;
  return [c.width, c.height, c.fps, s.cellW, s.cellH, store.project.name].join("|");
}

// zoom chip
const zoomPct = h("button", { class: "pct", "aria-label": "Zoom level", "aria-haspopup": "menu" }, "100%");
const zoomChip = h("div", { class: "zoom-chip" },
  iconButton("minus", { title: "Zoom out", onClick: () => nudgeZoom(1 / 1.25) }),
  zoomPct,
  iconButton("plus", { title: "Zoom in", onClick: () => nudgeZoom(1.25) }),
);
zoomPct.addEventListener("click", () => {
  showMenu([
    { label: "Fit", hint: "⌘1", action: () => setZoomFit() },
    "-",
    ...[0.25, 0.5, 1, 2].map((z) => ({
      label: `${z * 100}%`,
      hint: z === 1 ? "⌘0" : undefined,
      checked: !store.session.zoomFit && Math.abs(store.session.zoom - z) < 1e-3,
      action: () => setZoomTo(z),
    })),
  ], zoomPct, { align: "right" });
});
document.body.append(zoomChip);

function placeZoomChip() {
  zoomChip.style.right = `calc(var(--right-w) + var(--gap) * 2 + 8px)`;
  zoomChip.style.bottom = `calc(var(--tl-h) + var(--gap) * 2 + 8px)`;
}
placeZoomChip();

function setZoomFit() {
  store.set({ zoomFit: true }, "viewzoom");
  layoutViewport();
}
function setZoomTo(z) {
  store.set({ zoomFit: false, zoom: Math.min(4, Math.max(0.05, z)) }, "viewzoom");
  layoutViewport();
}
function nudgeZoom(f) {
  setZoomTo((store.session.zoomFit ? viewScale : store.session.zoom) * f);
}

// ---- mosaic debug overlay ------------------------------------------------------
// A DOM canvas over the viewport (never part of an export) that draws the
// blocks-reveal tile grid at the playhead: green = printed, red = pending,
// numbers = pop order. Tiles live on the z = 0 plane of the canonical front
// view, so the grid is exact from the front camera and reads as a tilted
// plane when orbiting.

const tileDebug = h("canvas", { class: "tile-debug", hidden: true });
stage.append(tileDebug);

/** The tile grid itself, drawn into any 2D context at any size — the DOM
    overlay uses it at viewport scale, the exporter composites it into
    frames at comp resolution. Silent (returns false) when the playhead's
    clip isn't a mosaic. */
function drawTileGrid(ctx, w, hgt, T) {
  const loc = locate(store.project.clips, sceneTime(T));
  if (!loc) return false;
  const exiting = loc.exitPhase !== null;
  const trans = exiting
    ? (loc.seg.clip.outroTrans || loc.seg.clip.trans)
    : loc.seg.clip.trans;
  const axis = trans?.staggerAxis ?? 0;
  if (axis < 4) return false;
  const dbg = engine.blockDebug;
  if (!dbg) return false;

  const s = Math.max(1, w / 900);              // stays legible at export sizes
  const prog = exiting ? loc.exitPhase : loc.phase;
  const spread = trans.spread ?? 0.7;
  const { cols, rows, mnx, mxx, mny, mxy, keys, occupancy } = dbg;
  const v = new THREE.Vector3();
  const px = (x, y) => {
    v.set(x, y, 0).project(camera);
    return [(v.x * 0.5 + 0.5) * w, (0.5 - v.y * 0.5) * hgt];
  };
  const order = [...keys.keys()].sort((a, b) => keys[a] - keys[b]);
  const rank = new Array(keys.length);
  order.forEach((ti, r) => { rank[ti] = r; });

  const sx = (mxx - mnx) / cols, sy = (mxy - mny) / rows;
  const labels = w / cols > 26 * s && hgt / rows > 18 * s;   // tiny tiles: grid only
  let on = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const ti = cy * cols + cx;
      const lit = prog - keys[ti] * spread > 1e-6;
      const empty = occupancy && occupancy[ti] < 1;
      if (lit) on++;
      const x0 = mnx + cx * sx, x1 = x0 + sx;
      const yT = mxy - cy * sy, yB = yT - sy;
      const c00 = px(x0, yT), c10 = px(x1, yT), c11 = px(x1, yB), c01 = px(x0, yB);
      ctx.beginPath();
      ctx.moveTo(c00[0], c00[1]);
      ctx.lineTo(c10[0], c10[1]);
      ctx.lineTo(c11[0], c11[1]);
      ctx.lineTo(c01[0], c01[1]);
      ctx.closePath();
      const dim = empty ? 0.28 : 1;              // empty tiles print no blocks
      if (lit && !empty) { ctx.fillStyle = "rgba(80, 220, 130, 0.08)"; ctx.fill(); }
      ctx.strokeStyle = lit
        ? `rgba(80, 220, 130, ${0.8 * dim})`
        : `rgba(255, 95, 95, ${0.4 * dim})`;
      ctx.lineWidth = s;
      ctx.stroke();
      if (labels) {
        ctx.font = `${10 * s}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = lit
          ? `rgba(80, 220, 130, ${0.9 * dim})`
          : `rgba(255, 120, 120, ${0.65 * dim})`;
        ctx.fillText(String(rank[ti]), c00[0] + 4 * s, c00[1] + 12 * s);
      }
    }
  }
  ctx.font = `${11 * s}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(
    `mosaic ${cols}×${rows} ${axis === 5 ? "out" : "in"} · ${on}/${keys.length} printed · phase ${Math.round(prog * 100)}%`,
    10 * s, 18 * s);
  return true;
}

function drawTileDebug(T) {
  const show = store.session.debugTiles && !store.session.exporting;
  tileDebug.hidden = !show;
  if (!show) return;
  const w = stage.clientWidth, hgt = stage.clientHeight;
  if (tileDebug.width !== w || tileDebug.height !== hgt) {
    tileDebug.width = w;
    tileDebug.height = hgt;
  }
  const ctx = tileDebug.getContext("2d");
  ctx.clearRect(0, 0, w, hgt);
  drawTileGrid(ctx, w, hgt, T);
}

// ---- shortcuts -------------------------------------------------------------------------
// They existed only in the README. Now the chrome carries a control that opens
// this, "?" opens it too, and the sheet is the single place they are written
// down — so a new key here is a key the interface teaches.

const MOD = isMac ? "\u2318" : "Ctrl";
const EXPORT_KEY = isMac ? "\u2318E" : "Ctrl E";
const SHORTCUTS = [
  { title: "Playback", keys: [
    ["Space", "Play or pause"],
    ["\u2190 \u2192", "Step one frame"],
    ["\u21e7 \u2190 \u2192", "Step ten"],
    ["Home", "To start"],
    ["End", "To end"],
  ] },
  { title: "Edit", keys: [
    [`${MOD} Z`, "Undo"],
    [`\u21e7 ${MOD} Z`, "Redo"],
    [`${MOD} D`, "Duplicate clip"],
    ["\u232b", "Delete selected"],
    ["Esc", "Deselect"],
  ] },
  { title: "Camera", keys: [
    ["K", "Keyframe the view"],
  ] },
  { title: "Project", keys: [
    [`${MOD} S`, "Save file"],
    [`${MOD} O`, "Open file"],
    [EXPORT_KEY, "Export"],
  ] },
  { title: "View", keys: [
    [`${MOD} 1`, "Fit"],
    [`${MOD} 0`, "100%"],
    [`${MOD} + -`, "Zoom"],
    ["H", "Hide panels"],
  ] },
  { title: "Help", keys: [["?", "Shortcuts"]] },
];

// ---- actions ---------------------------------------------------------------------------

// Free-look: grabbing the viewport suspends camera-track following until the
// playhead moves again (scrub, play, jump) or the view is captured into a
// keyframe — so "orbit, then press K" keeps exactly what you framed.
let manualCam = false;
let scrubbing = false;

const actions = {
  addClip(kind, key, index) {
    let label;
    if (kind === "mode") {
      const m = MODE_BY_KEY[key];
      if (!m) return;
      label = m.label;
    } else {
      const entry = assetLib.get(key);
      if (!entry) return;
      label = entry.label;
      ensureAsset(key);
    }
    const clip = makeClip(kind, key, label);
    store.mutate((p) => {
      const at = index === undefined ? p.clips.length : Math.min(index, p.clips.length);
      p.clips.splice(at, 0, clip);
    });
    store.select({ type: "clip", id: clip.id });
    const seg = segments(store.project.clips).find((s) => s.clip.id === clip.id);
    if (seg && !store.session.playing) actions.seek(seg.transEnd);
  },

  /** Deleting a clip was instant and silent, with undo available but never
      mentioned. It asks now, by name, and says how to take it back. */
  async removeClip(id, { confirm = true } = {}) {
    const clip = store.project.clips.find((c) => c.id === id);
    if (!clip) return;
    if (confirm) {
      const yes = await confirmAction({
        title: `Delete ${clip.label}?`,
        body: `${MOD} Z brings it back.`,
        confirmLabel: "Delete",
      });
      if (!yes) return;
    }
    store.mutate((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i >= 0) p.clips.splice(i, 1);
    });
    if (store.session.selection?.id === id) store.select(null);
    actions.seek(Math.min(store.session.time, projectDuration(store.project)));
  },

  duplicateClip(id) {
    const src = store.project.clips.find((c) => c.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    store.mutate((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      p.clips.splice(i + 1, 0, copy);
    });
    store.select({ type: "clip", id: copy.id });
  },

  moveClip(from, to) {
    store.mutate((p) => {
      const [c] = p.clips.splice(from, 1);
      p.clips.splice(to, 0, c);
    });
  },

  jumpToClip(id) {
    const seg = segments(store.project.clips).find((s) => s.clip.id === id);
    if (seg) actions.seek(seg.transEnd);
  },

  seek(t) {
    const total = projectDuration(store.project);
    store.session.time = Math.min(Math.max(0, t), total);
    manualCam = false;
    store.emit("time");
  },

  pause() {
    if (!store.session.playing) return;
    store.session.playing = false;
    store.emit("play");
  },

  togglePlay() {
    const total = projectDuration(store.project);
    if (total <= 0) return;
    if (!store.session.playing && store.session.time >= total - 1e-4) store.session.time = 0;
    store.session.playing = !store.session.playing;
    if (store.session.playing) manualCam = false;
    store.emit("play");
    store.emit("time");
  },

  scrubStart() { scrubbing = true; actions.pause(); },
  scrubEnd() { scrubbing = false; },

  stepFrames(n) {
    actions.pause();
    const fps = store.project.comp.fps;
    const t = Math.round(store.session.time * fps + n) / fps;
    actions.seek(t);
  },

  addCameraKf() {
    const t = Math.round(store.session.time * 1000) / 1000;
    const state = cameraStateFrom(camera, controls.target);
    const fps = store.project.comp.fps;
    const near = store.project.camera.kfs.find((k) => Math.abs(k.t - t) < 0.5 / fps);
    let id;
    store.mutate((p) => {
      const hit = near && p.camera.kfs.find((k) => k.id === near.id);
      if (hit) {
        Object.assign(hit, state);
        id = hit.id;
      } else {
        id = uid();
        p.camera.kfs.push({ id, t, ease: "smooth", ...state });
        p.camera.kfs.sort((a, b) => a.t - b.t);
      }
      p.camera.follow = true;
    });
    manualCam = false;
    store.select({ type: "kf", id });
    toast(near ? "Keyframe updated" : "Camera keyframe added");
  },

  updateKfFromView(id) {
    const state = cameraStateFrom(camera, controls.target);
    store.mutate((p) => {
      const k = p.camera.kfs.find((x) => x.id === id);
      if (k) Object.assign(k, state);
    });
    toast("Keyframe set to current view");
  },

  removeKf(id) {
    store.mutate((p) => {
      const i = p.camera.kfs.findIndex((k) => k.id === id);
      if (i >= 0) p.camera.kfs.splice(i, 1);
    });
    if (store.session.selection?.id === id) store.select(null);
  },

  importGlb() { fileInput.click(); },

  /** Clear a failed asset's state so ensureAsset will have another go. */
  retryAsset(key) {
    const entry = assetLib.get(key);
    if (!entry || entry.state !== "error") return;
    entry.state = "idle";
    libChanged();
    ensureAsset(key);
  },

  /** Send the user to the library — opening the drawer first if the window is
      narrow enough that it is closed, so "Add a clip" always lands somewhere
      visible. */
  focusLibrary() {
    const panel = document.querySelector(".left-panel");
    if (!panel) return;
    if (getComputedStyle(document.querySelector(".lib-tab")).display !== "none") {
      setLibOpen(true);
    }
    panel.querySelector(".lib-search input")?.focus();
  },

  addPhoto(key, label) {
    const start = Math.max(0, store.session.time || 0);
    const id = uid();
    store.mutate((p) => {
      p.photos.push({ id, key, label: label || key, start,
                      dur: 2, fadeIn: 0.8, fadeOut: 0.6, alpha: 1,
                      reveal: 1, order: 0, cols: 16, vary: 1.7, seed: 0 });
    });
    store.select({ type: "photo", id });
  },

  removePhoto(id) {
    store.mutate((p) => {
      const i = p.photos.findIndex((x) => x.id === id);
      if (i >= 0) p.photos.splice(i, 1);
    });
    if (store.session.selection?.id === id) store.select(null);
  },

  /** Replacing the whole project used to happen first and explain afterwards,
      in a toast that was gone in three seconds. */
  async newProject() {
    if (store.project.clips.length) {
      const yes = await confirmAction({
        title: "Start a new project?",
        body: `${store.project.name} has ${store.project.clips.length} clip`
          + `${store.project.clips.length > 1 ? "s" : ""}. ${MOD} Z brings it back.`,
        confirmLabel: "New project",
      });
      if (!yes) return;
    }
    store.replaceProject(defaultProject());
    invalidatePair();
    toast("New project");
  },

  saveProject() {
    const blob = new Blob([JSON.stringify(store.project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.download = `${store.project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "project"}.tempo.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    toast("Project saved");
  },

  openProject() { projInput.click(); },

  export() {
    closeMenus();
    runExport(store, exportHooks);
  },
};

registerShippedImages();
registerMerch();

const app = {
  store,
  actions,
  engine,
  exportKey: EXPORT_KEY,
  normalizeProject,
  baseModeFor,
  projectDuration: () => projectDuration(store.project),
  renderAt: (T) => exportHooks.renderAt(T),   // headless-driving hook
  library: {
    assets: () => [...assetLib.values()].filter((e) => !e.hidden).map((e) => ({ key: e.key, label: e.label, state: e.state, custom: e.custom })),
    onChanged: (fn) => { libListeners.add(fn); return () => libListeners.delete(fn); },
  },
};
window.__app = app;

// ---- file inputs / drops ------------------------------------------------------------------

const fileInput = document.getElementById("file");
fileInput.addEventListener("change", async () => {
  for (const f of fileInput.files) {
    if (/\.(glb|gltf)$/i.test(f.name)) registerGlb(await f.arrayBuffer(), f.name);
    else registerImage(f);
  }
  fileInput.value = "";
});

const projInput = document.getElementById("projfile");
projInput.addEventListener("change", async () => {
  const f = projInput.files[0];
  projInput.value = "";
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (p.version !== 1 || !Array.isArray(p.clips)) throw new Error("not a TEMPO project");
    store.replaceProject(normalizeProject(p));
    invalidatePair();
    afterProjectLoad();
    toast(`Opened ${p.name}`);
  } catch (err) {
    toast(`Could not open project — ${err.message || err}`, { kind: "error" });
  }
});

function afterProjectLoad() {
  // shipped images may still be fetching at boot — anything they will
  // provide (stable keys or aliases) is not missing, just late
  const shipped = new Set(SHIPPED_IMAGES.flatMap((d) => [d.key, ...(d.aliases || [])]));
  const missing = new Set();
  for (const c of store.project.clips) {
    if (c.kind !== "asset") continue;
    if (assetLib.has(c.key)) ensureAsset(c.key);
    else if (!shipped.has(c.key)) missing.add(c.label);
  }
  if (missing.size) {
    toast(`Missing imports: ${[...missing].join(", ")} — re-import to restore`, { kind: "error", duration: 5200 });
  }
}

const drop = document.getElementById("drop");
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if ([...e.dataTransfer.types].includes("Files") && ++dragDepth === 1) drop.classList.add("on");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove("on"); }
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove("on");
  for (const f of e.dataTransfer.files) {
    if (/\.(glb|gltf)$/i.test(f.name)) registerGlb(await f.arrayBuffer(), f.name);
    else if (/\.(svg|png|jpe?g)$/i.test(f.name)) registerImage(f);
    else if (/\.json$/i.test(f.name)) {
      try {
        const p = JSON.parse(await f.text());
        if (p.version === 1 && Array.isArray(p.clips)) {
          store.replaceProject(normalizeProject(p));
          invalidatePair();
          afterProjectLoad();
          toast(`Opened ${p.name}`);
        }
      } catch {}
    }
  }
});

// ---- keyboard ---------------------------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  const mod = modKey(e);

  if (e.code === "Space") {
    e.preventDefault();
    actions.togglePlay();
  } else if (mod && e.code === "KeyZ") {
    e.preventDefault();
    const ok = e.shiftKey ? store.redo() : store.undo();
    if (ok) {
      invalidatePair();
      pruneRuntimes(store.project.clips);
      actions.seek(store.session.time);
    }
  } else if (mod && e.code === "KeyD") {
    e.preventDefault();
    const sel = store.session.selection;
    if (sel?.type === "clip") actions.duplicateClip(sel.id);
  } else if (mod && e.code === "KeyS") {
    e.preventDefault();
    actions.saveProject();
  } else if (mod && e.code === "KeyO") {
    e.preventDefault();
    actions.openProject();
  } else if (mod && e.code === "KeyE") {
    // the same key exports on both surfaces
    e.preventDefault();
    if (store.project.clips.length) actions.export();
  } else if (e.key === "Backspace" || e.key === "Delete") {
    const sel = store.session.selection;
    if (sel?.type === "clip") actions.removeClip(sel.id);
    else if (sel?.type === "kf") actions.removeKf(sel.id);
  } else if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    e.preventDefault();
    actions.stepFrames((e.code === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1));
  } else if (e.code === "Home") {
    actions.pause(); actions.seek(0);
  } else if (e.code === "End") {
    actions.pause(); actions.seek(projectDuration(store.project));
  } else if (e.code === "KeyK") {
    actions.addCameraKf();
  } else if (e.code === "KeyH") {
    document.body.classList.toggle("ui-hidden");
    layoutViewport();
  } else if (!mod && e.key === "?") {
    e.preventDefault();
    showShortcuts(SHORTCUTS);
  } else if (mod && (e.key === "=" || e.key === "+")) {
    e.preventDefault(); nudgeZoom(1.25);
  } else if (mod && e.key === "-") {
    e.preventDefault(); nudgeZoom(1 / 1.25);
  } else if (mod && e.key === "0") {
    e.preventDefault(); setZoomTo(1);
  } else if (mod && e.key === "1") {
    e.preventDefault(); setZoomFit();
  } else if (e.key === "Escape") {
    store.select(null);
  }
});

canvas.addEventListener("pointerdown", () => { manualCam = true; });
viewport.addEventListener("pointerdown", (e) => {
  if (e.target === viewport) store.select(null);
});

// ---- scene application -------------------------------------------------------------------------

function applySceneUniforms() {
  const scn = store.project.scene;
  const comp = store.project.comp;
  if (camera.fov !== scn.fov) {
    camera.fov = scn.fov;
    camera.updateProjectionMatrix();
  }
  terminal.phosphor = scn.phosphor;
  terminal.persist = scn.persist;
  terminal.phosAmt = 1;
  // a mode that declares its own `phosphor` param (zoom-out-blocks) drives
  // the trails itself while it is the engine's target — fractional 0..1
  if (engine.modeB && engine.modeB.params && engine.modeB.params.phosphor) {
    const pv = paramValues(engine.modeB);
    terminal.phosphor = pv.phosphor > 0.001;
    terminal.phosAmt = pv.phosphor;
    terminal.persist = pv.persist;
  }
  terminal.cellify.mat.uniforms.uDotThresh.value = scn.dotThresh;
  terminal.cellify.mat.uniforms.uDither.value = scn.dither;
  const g = terminal.glyph.mat.uniforms;
  g.uDotR.value = scn.dotR;
  g.uGap.value.set(scn.gapX || 0, scn.gapY || 0);
  g.uBlocks.value = scn.blocks ? 1 : 0;
  g.uBlockLo.value = scn.blockLo;
  g.uBlockHi.value = scn.blockHi;
  g.uShade.value = scn.shade;
  g.uInk.value.set(comp.ink);
  g.uBg.value.set(comp.bg);
  const u = engine.material.uniforms;
  u.uGain.value = scn.gain;
  u.uBaseSize.value = scn.baseSize;
  u.uOccBias.value = scn.occBias;
}

/** Terminal-feel time: with a step rate set, the scene only "prints" at that
    rate — anything between steps shows the previous frame, like a script
    looping over sleep(). */
function sceneTime(T) {
  const fps = store.project.scene.stepFps || 0;
  return fps > 0 ? Math.floor(T * fps + 1e-6) / fps : T;
}

let lastStepKey = null;

/** THE deterministic frame: same path for viewport, scrub and export. */
function renderFrame(T, dt) {
  const p = store.project;
  const scn = p.scene;
  const Ts = sceneTime(T);
  // the mosaic cuts its tile grid over the composition frame — give the
  // engine the project's view BEFORE drive so pair loads key correctly
  engine.frameFov = scn.fov;
  engine.frameAspect = p.comp.width / p.comp.height;
  engine.termCols = terminal.cols;
  engine.termRows = terminal.rows;
  // a glyph cell is a tall rectangle in actual pixels (8x16 house default),
  // not a square — a cell-reveal block needs MORE cells wide than tall to
  // read as square on screen
  engine.termCellAspect = terminal.cellH / Math.max(1e-4, terminal.cellW);
  engine.compBg = p.comp.bg;
  engine.rotExtra = whipAngle(p.clips, Ts);
  drive(engine, p.clips, Ts);
  applySceneUniforms();
  // the ACTUAL image: transition-aware — mosaic staggers reveal the photo
  // tile by tile, everything else fades it at arrival; the dots dissolve
  // only once settled either way
  const photoState = photoOverlay.evaluate(engine);
  engine.material.uniforms.uPhotoB.value = photoState.dotFade ?? photoState.alpha;
  engine.material.uniforms.uPhotoFlip.value = photoState.flip ? 1 : 0;
  occlusion.update(renderer, camera, scn.solidity);

  const u = engine.material.uniforms;
  const scaleY = bufH / p.comp.height;

  // grid lock — snap dots to the character sub-cell grid
  if (scn.gridLock) u.uSnapGrid.value.set(terminal.cols * 2, terminal.rows * 4);
  else u.uSnapGrid.value.set(0, 0);

  // per-step uniforms for the flicker hash — derived from scene time, never
  // the wall clock, so exports reproduce it exactly
  const tickRate = scn.stepFps || 24;
  const stepKey = Math.floor(Ts * tickRate + 1e-6);
  const g = terminal.glyph.mat.uniforms;
  g.uLevels.value = scn.inkLevels || 0;
  g.uFlicker.value = scn.flicker || 0;
  g.uSeed.value = stepKey % 4096;

  if (scn.terminal) {
    u.uProjScale.value = terminal.rtHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    u.uMaxPt.value = 7;
    u.uSplit.value = 1;
    u.uMinPt.value = 1;
    // with a step rate, phosphor trails decay per PRINT, not per vsync —
    // a frozen frame must not fade between steps
    let phosDt = dt;
    if (scn.stepFps) {
      phosDt = stepKey !== lastStepKey ? 1 / scn.stepFps : 0;
    }
    lastStepKey = stepKey;
    terminal.render(renderer, scene3, camera, phosDt);
  } else {
    u.uProjScale.value = bufH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    u.uMaxPt.value = 26 * scaleY;
    u.uSplit.value = 0;
    u.uMinPt.value = Math.max(0.6, 1.2 * scaleY);
    renderer.setRenderTarget(null);
    renderer.setClearColor(new THREE.Color(p.comp.bg), 1);
    renderer.render(scene3, camera);
  }
  if (photoState.alpha > 0.001)
    photoOverlay.draw(renderer, camera, engine, photoState);
  // the photo LANE: free-positioned photographs over whatever the particle
  // track is doing — braille and picture genuinely coexist. reveal 0 fades
  // on the expo, reveal 1 PRINTS in blocks on the clip's own tile schedule
  // (fadeIn/fadeOut are the print windows; the out un-prints in reverse).
  for (const phc of p.photos || []) {
    const lt = Ts - phc.start;
    if (lt < 0 || lt > phc.dur) continue;
    const entry = assetLib.get(phc.key);
    const mode = entry && entry.mode;
    if (!mode || !mode.photo) continue;
    if (!mode.photo.map) {
      try { mode.gen(engine.N, paramValues(mode)); } catch (err) { continue; }
    }
    const fi = phc.fadeIn ?? 0.4, fo = phc.fadeOut ?? 0.4;
    const pIn = fi > 0.01 ? Math.min(1, lt / fi) : 1;
    const pOut = fo > 0.01 ? Math.min(1, (phc.dur - lt) / fo) : 1;
    let mask = null;
    if ((phc.reveal ?? 0) === 1) {
      const aspect = p.comp.width / p.comp.height;
      const cols = Math.max(2, Math.round(phc.cols ?? 16));
      const rows = Math.max(2, Math.round(cols / aspect));
      const sig = `${phc.order ?? 0}:${cols}:${rows}:${phc.vary ?? 1.7}:${phc.seed ?? 0}`;
      let kc = photoKeysCache.get(phc.id);
      if (!kc || kc.sig !== sig) {
        kc = { sig, keys: mosaicTileKeys(Math.round(phc.order ?? 0), cols, rows,
                                         Math.max(0, phc.vary ?? 1.7),
                                         (phc.seed ?? 0) * 74.7) };
        photoKeysCache.set(phc.id, kc);
      }
      const hh = Math.tan((scn.fov * Math.PI) / 360) * 3.55;
      mask = { keys: kc.keys, cols, rows, mxx: hh * aspect, mxy: hh,
               prog: Math.min(pIn, pOut), spread: 0.9 };
    }
    const ein = fi > 0.01 ? expoInOut(pIn) : 1;
    const eout = fo > 0.01 ? expoInOut(pOut) : 1;
    const a = (phc.alpha ?? 1) * (mask ? 1 : Math.min(ein, eout));
    if (a > 0.001) photoOverlay.drawFree(renderer, camera, mode, a, Ts, mask);
  }
}

const photoKeysCache = new Map();   // photo-lane tile keys, per clip + sig

// ---- export hooks ---------------------------------------------------------------------------

const exportHooks = {
  canvas,
  begin(W, H) {
    controls.enabled = false;
    const comp = store.project.comp;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    bufW = W; bufH = H;
    camera.aspect = comp.width / comp.height;
    camera.updateProjectionMatrix();
    terminal.cellW = store.project.scene.cellW;
    terminal.cellH = store.project.scene.cellH;
    terminal.setSize(comp.width, comp.height, W, H);
    occlusion.setSize(W / 2, H / 2);
  },
  renderAt(T) {
    const cam = store.project.camera;
    if (cam.follow && cam.kfs.length) {
      applyCameraState(camera, controls, evalCamera(cam.kfs, sceneTime(T)));
    }
    const fps = store.project.export.fps || store.project.comp.fps;
    renderFrame(T, 1 / fps);
  },
  end() {
    controls.enabled = true;
    layoutViewport();
  },
  // "Debug tiles" rides into exports: the exporter composites the grid
  // into each frame while the toggle is on
  overlayActive: () => !!store.session.debugTiles,
  overlay: (ctx, W, H, T) => drawTileGrid(ctx, W, H, T),
};

// ---- boot ------------------------------------------------------------------------------------

function starterProject() {
  const p = defaultProject();
  p.name = "Untitled";
  /* The featured set, in its own order — derived from FEATURED rather than
     listed again here, so changing what is pinned changes what a new project
     opens on and the two cannot drift apart. The first clip has no flight in;
     there is nothing before it to fly from. */
  featuredModes().forEach((m, i) => {
    const c = makeClip("mode", m.key, m.label);
    c.hold = 2.4;
    c.trans.duration = i === 0 ? 0 : 0.9;
    p.clips.push(c);
  });
  return p;
}

store.project = starterProject();
afterProjectLoad();

const inspectorPanel = buildInspector(app);
inspectorPanel.id = "inspector";
inspectorPanel.tabIndex = -1;
inspectorPanel.prepend(appNav("motion"));
const timelinePanel = buildTimeline(app);
timelinePanel.id = "timeline";
timelinePanel.tabIndex = -1;
document.body.append(buildLibraryPanel(app), inspectorPanel, timelinePanel);
// prepend, not append: the zoom chip is already on the body, and tab order is
// DOM order — a skip link that is not first skips nothing
document.body.prepend(skipLink("inspector", "Skip to the inspector"));

// ---- the library drawer ------------------------------------------------------
// Below 900px the library docks out over the stage instead of squeezing it.
// Its handle sits on the edge it comes from, which is the only place a drawer
// control belongs; CSS decides whether the handle exists at all.

const libTab = iconButton("layers", {
  title: "Library",
  cls: "lib-tab",
  pressed: false,
  onClick: () => setLibOpen(!document.body.classList.contains("lib-open")),
});
document.body.append(libTab);

function setLibOpen(open) {
  document.body.classList.toggle("lib-open", open);
  libTab.setAttribute("aria-pressed", String(open));
}

// the stage is the way out: tapping what the drawer covers closes it
viewport.addEventListener("pointerdown", () => setLibOpen(false));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setLibOpen(false);
});

store.on("project", () => {
  pruneRuntimes(store.project.clips);
  if (layoutSig() !== appliedSig) layoutViewport();
  const total = projectDuration(store.project);
  if (store.session.time > total) actions.seek(total);
});
store.on("viewzoom", layoutViewport);
/* A window drag fires resize dozens of times a second, and each call resizes
   the renderer, both render targets and the occlusion pass — a full GPU
   reallocation per event. Coalescing to one per frame makes a drag cost one
   reallocation per painted frame instead of one per event. */
let resizePending = false;
window.addEventListener("resize", () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; layoutViewport(); });
});

// Only what the open project actually uses. The rest of the catalogue loads
// when a clip asks for it, which is what addClip already does.
(async () => {
  for (const c of store.project.clips) if (c.kind === "asset") await ensureAsset(c.key);
})();

layoutViewport();

// ---- the loop -----------------------------------------------------------------------------------

let last = performance.now() / 1000;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (store.session.exporting) return;

  const s = store.session;
  const total = projectDuration(store.project);
  if (s.playing) {
    let t = s.time + dt;
    if (t >= total) {
      if (s.loop && total > 0) t %= total;
      else {
        t = total;
        s.playing = false;
        store.emit("play");
      }
    }
    s.time = t;
    store.emit("time");
  }

  controls.update();
  const cam = store.project.camera;
  if (cam.follow && cam.kfs.length && !manualCam) {
    const st = evalCamera(cam.kfs, sceneTime(s.time));
    if (st) applyCameraState(camera, controls, st);
  }

  renderFrame(s.time, dt);
  drawTileDebug(s.time);
}
frame();
