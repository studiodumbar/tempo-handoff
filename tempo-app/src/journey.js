// hatch·journey — the commerce-state player.
//
// A single product asset holds the centre of the stage. A row of buttons is
// the buying funnel — displaying · searching · comparing · processing · buying
// · confirmed — and each button is a STATE the particle pool settles into.
// Clicking one morphs the pool from the current state to that one through the
// engine's ordinary rank-matched flight (same machinery the editor's timeline
// uses, exposed here as a stateful player instead of a scrubbed clip row).
//
// Everything is driven by two global blocks the user owns: the SCENE (the
// asset, the terminal look) and the TRANSITION (one standard flight shared by
// every state-to-state move — the whole point is that transitions are uniform).

import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { ParticleEngine, STAGGER_AXES, PATH_MODES } from "./particles.js";
import { TerminalPass } from "./terminal.js";
import { OcclusionPass } from "./occlusion.js";
import { MODES, MODE_BY_KEY, paramValues } from "./modes.js";
import { ASSET_DEFS, loadAssetMode } from "./assets.js";
import { setAssetResolver, clipRuntime, baseModeFor } from "./sequence.js";
import { defaultProject, defaultTransition } from "./store.js";
import { EASE_NAMES } from "./easing.js";
import { h, icon, toast } from "./ui/dom.js";
import { appNav } from "./ui/appnav.js";
import { slug, saveBlob, pickH264Codec, progressCard, nextTick } from "./export.js";
import { Muxer, ArrayBufferTarget } from "../vendor/mp4-muxer.mjs";
import {
  NumberField, SelectField, SwitchField, ColorField, TextField,
  section, grid2, row, button,
} from "./ui/fields.js";

THREE.ColorManagement.enabled = false;

// ---- config — the two global blocks the user edits --------------------------

const STORAGE_KEY = "hatchfusion.journey.v1";
const FPS_OPTIONS = [12, 24, 25, 30, 50, 60];

// target encoding is a flat string so it stores and selects trivially:
//   "product"      → whatever asset is the featured product
//   "asset:<key>"  → a specific GLB
//   "mode:<key>"   → a procedural animation
const DEFAULT_STATES = [
  { id: "displaying", label: "Displaying", target: "asset:hoodie" },
  { id: "searching", label: "Searching", target: "mode:orb" },     // SCANNING
  { id: "comparing", label: "Comparing", target: "mode:gyro" },    // SELECTING
  { id: "processing", label: "Processing", target: "mode:pulse" }, // PROCESSING
  { id: "buying", label: "Buying", target: "mode:spark" },         // SPARKING
  { id: "confirmed", label: "Confirmed", target: "asset:hoodie" },
];

function defaultConfig() {
  return {
    version: 1,
    product: "hoodie",
    comp: { width: 1080, height: 1080, fps: 60 },
    states: DEFAULT_STATES.map((s) => ({ ...s })),
    // the house scene defaults (store.js), plus this mode's own bg/ink keys
    scene: { ...defaultProject().scene, bg: "#000000", ink: "#ffffff" },
    transition: defaultTransition(),
  };
}

let config = loadConfig();

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.version === 1 && Array.isArray(p.states)) {
        const d = defaultConfig();
        const cfg = {
          version: 1,
          product: p.product || d.product,
          comp: { ...d.comp, ...p.comp },
          states: p.states.length ? p.states : d.states,
          scene: { ...d.scene, ...p.scene },
          transition: { ...d.transition, ...p.transition },
        };
        // sanitize configs saved by the early slider UI: spread >= 1 collapses
        // the stagger window to zero — dots teleport instead of flying
        cfg.transition.spread = Math.min(0.95, Math.max(0, cfg.transition.spread));
        // pre-mosaic house thresholds -> tuned quadrant-era values
        if (cfg.scene.blockLo === 2.0 && cfg.scene.blockHi === 4.0) {
          cfg.scene.blockLo = d.scene.blockLo;
          cfg.scene.blockHi = d.scene.blockHi;
        }
        // the Product indirection is gone — migrate legacy "product" targets
        // to the concrete asset they resolved to
        const GONE = new Set(["mode:moire", "asset:newtons-cradle",
          "asset:shape-cylinder", "asset:shape-cone", "asset:shape-sphere",
          "asset:shape-prism", "asset:shape-pyramid",
          "mode:find-sway", "mode:arrange-bloom"]);
        for (const s of cfg.states) {
          if (s.target === "product") s.target = `asset:${cfg.product || "hoodie"}`;
          if (GONE.has(s.target)) s.target = "mode:sphere";
        }
        return cfg;
      }
    }
  } catch {}
  return defaultConfig();
}

let saveTimer = 0;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
  }, 300);
}

// ---- gl boot ----------------------------------------------------------------

const canvas = document.getElementById("view");
if (!document.createElement("canvas").getContext("webgl2")) {
  document.getElementById("fatal").hidden = false;
  throw new Error("WebGL2 unavailable");
}

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: "high-performance",
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

// ---- asset library ----------------------------------------------------------
// key → loaded mode | null (null while sampling). The sequence resolver reads
// from here; a clip whose asset is still null renders the previous frame.

const assetLib = new Map();
setAssetResolver((key) => assetLib.get(key) || null);

async function ensureAsset(key) {
  if (assetLib.has(key)) return;
  const def = ASSET_DEFS.find((d) => d.key === key);
  if (!def) return;
  assetLib.set(key, null);      // mark loading so we only sample once
  try {
    assetLib.set(key, await loadAssetMode(def, engine.N));
    loadedPairKey = "";         // the pair on screen may be waiting on this
  } catch (err) {
    console.error(err);
    assetLib.delete(key);
    toast(`Could not load ${def.label} — ${err.message || err}`, { kind: "error" });
  }
}

// ---- the state player -------------------------------------------------------

let currentIndex = 0;      // resting state
let anim = null;           // { from, to, start } while a flight is in progress
let pending = null;        // a state clicked mid-flight, played once we land
let autoRun = false;       // "run" walks the whole funnel end to end

function state(i) { return config.states[i]; }
function indexOf(id) { return config.states.findIndex((s) => s.id === id); }

/** target string → { kind, key } against the current product. */
function resolveTarget(t) {
  if (t === "product") return { kind: "asset", key: config.product };
  const c = String(t).indexOf(":");
  if (c > 0) {
    const kind = t.slice(0, c), key = t.slice(c + 1);
    if (kind === "mode") return { kind: "mode", key };
    if (kind === "asset") return { kind: "asset", key };
  }
  return { kind: "asset", key: config.product };
}

/** A state's clip: a stable id per state (so clipRuntime caches its layout),
    the live transition block, and the state's OWN param overrides — passed by
    reference so edits propagate through the engine's sig-based caching (regen
    params re-bake the layout, others refresh live). */
function clipForState(s) {
  const r = resolveTarget(s.target);
  if (!s.params) s.params = {};
  return { id: `st-${s.id}`, kind: r.kind, key: r.key, label: s.label,
    hold: 999, trans: config.transition, params: s.params };
}

/** the human status a state announces — the target's own status name if it
    has one, else the state label. */
function statusFor(s) {
  const r = resolveTarget(s.target);
  if (r.kind === "mode") return (MODE_BY_KEY[r.key]?.statusName) || s.label.toUpperCase();
  const def = ASSET_DEFS.find((d) => d.key === r.key);
  return (def?.status) || s.label.toUpperCase();
}

function goTo(i) {
  if (i < 0 || i >= config.states.length) return;
  if (anim) { pending = i; return; }              // land first, then chase
  if (i === currentIndex) return;
  ensureTargetAsset(state(i));
  anim = { from: currentIndex, to: i, start: clock };
  renderSteps();
}

function ensureTargetAsset(s) {
  const r = resolveTarget(s.target);
  if (r.kind === "asset") ensureAsset(r.key);
}

function completeAnim() {
  currentIndex = anim.to;
  anim = null;
  renderSteps();
  if (pending != null && pending !== currentIndex) {
    const nx = pending; pending = null; goTo(nx);
  } else if (autoRun && currentIndex < config.states.length - 1) {
    goTo(currentIndex + 1);
  } else {
    autoRun = false;
    pending = null;
    renderSteps();
  }
}

// ---- the A → B driver -------------------------------------------------------
// A trimmed copy of sequence.drive: it loads a from → to pair (cached on the
// pair signature) and renders it at an exact linear progress. Progress and
// scene-time are independent here — at rest the resident mode keeps breathing
// (progress pinned to 1) while scene-time runs on.

let loadedPairKey = "";

function drivePair(fromClip, toClip, phase, sceneT) {
  const from = clipRuntime(fromClip, engine.N);
  const to = clipRuntime(toClip, engine.N);
  if (!from || !to) return false;          // an asset is still sampling
  const trans = toClip.trans;
  const pairKey = `${from.sig}@${fromClip.id}>${to.sig}@${toClip.id}|${trans.staggerAxis}`;
  if (pairKey !== loadedPairKey) {
    engine.staggerAxis = trans.staggerAxis;
    engine.setPairDirect(from.inst, from.layout, to.inst, to.layout);
    loadedPairKey = pairKey;
  }
  engine.spread = trans.spread;
  engine.easeIndex = trans.ease;
  engine.pathMode = trans.path;
  engine.pathAmp = trans.pathAmp;
  engine.scatter = trans.scatter;
  engine.swirl = trans.swirl * 2 * Math.PI;
  engine.renderState(sceneT, phase);
  return true;
}

// ---- scene uniforms + the frame ---------------------------------------------

function applyScene() {
  const scn = config.scene;
  if (camera.fov !== scn.fov) { camera.fov = scn.fov; camera.updateProjectionMatrix(); }
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
  g.uInk.value.set(scn.ink);
  g.uBg.value.set(scn.bg);
  const u = engine.material.uniforms;
  u.uGain.value = scn.gain;
  u.uBaseSize.value = scn.baseSize;
  u.uOccBias.value = scn.occBias;
}

/** terminal-feel time: with a step rate the scene only "prints" at that rate. */
function sceneTime(t) {
  const fps = config.scene.stepFps || 0;
  return fps > 0 ? Math.floor(t * fps + 1e-6) / fps : t;
}

let lastStepKey = null;

function renderFrame(sceneT, phase, dt) {
  const fromClip = anim ? clipForState(state(anim.from)) : clipForState(state(currentIndex));
  const toClip = anim ? clipForState(state(anim.to)) : fromClip;
  drivePair(fromClip, toClip, phase, sceneT);
  renderScene(sceneT, dt);
}

/** Everything a frame does AFTER the pair is driven. Split out so the
    transition-film exporter can drive any two clips it likes and still land on
    exactly the same pixels the live journey draws. */
function renderScene(sceneT, dt) {
  const scn = config.scene;
  applyScene();
  occlusion.update(renderer, camera, scn.solidity);

  const u = engine.material.uniforms;
  const scaleY = bufH / config.comp.height;
  if (scn.gridLock) u.uSnapGrid.value.set(terminal.cols * 2, terminal.rows * 4);
  else u.uSnapGrid.value.set(0, 0);

  const tickRate = scn.stepFps || 24;
  const stepKey = Math.floor(sceneT * tickRate + 1e-6);
  const g = terminal.glyph.mat.uniforms;
  g.uLevels.value = scn.inkLevels || 0;
  g.uFlicker.value = scn.flicker || 0;
  g.uSeed.value = stepKey % 4096;

  if (scn.terminal) {
    u.uProjScale.value = terminal.rtHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    u.uMaxPt.value = 7;
    u.uSplit.value = 1;
    u.uMinPt.value = 1;
    let phosDt = dt;
    if (scn.stepFps) phosDt = stepKey !== lastStepKey ? 1 / scn.stepFps : 0;
    lastStepKey = stepKey;
    terminal.render(renderer, scene3, camera, phosDt);
  } else {
    u.uProjScale.value = bufH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    u.uMaxPt.value = 26 * scaleY;
    u.uSplit.value = 0;
    u.uMinPt.value = Math.max(0.6, 1.2 * scaleY);
    renderer.setRenderTarget(null);
    renderer.setClearColor(new THREE.Color(scn.bg), 1);
    renderer.render(scene3, camera);
  }
}

// ---- layout -----------------------------------------------------------------
// The editor's viewport idiom: the comp fits centred in the viewport region,
// the stage carries the label (mode · dims · fps) at its top-left.

const viewportEl = document.getElementById("viewport");
const stage = document.getElementById("stage");
const stageLabel = document.querySelector(".stage-label");
let bufW = 2, bufH = 2;

function layout() {
  const comp = config.comp;
  const r = viewportEl.getBoundingClientRect();
  const availW = Math.max(80, r.width - 48);
  const availH = Math.max(80, r.height - 56);
  const fit = Math.min(availW / comp.width, availH / comp.height);
  const cssW = Math.max(24, Math.round(comp.width * fit));
  const cssH = Math.max(24, Math.round(comp.height * fit));
  stage.style.width = `${cssW}px`;
  stage.style.height = `${cssH}px`;

  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(dpr);
  renderer.setSize(cssW, cssH, false);
  bufW = Math.round(cssW * dpr);
  bufH = Math.round(cssH * dpr);
  camera.aspect = comp.width / comp.height;
  camera.updateProjectionMatrix();

  terminal.cellW = config.scene.cellW;
  terminal.cellH = config.scene.cellH;
  terminal.setSize(comp.width, comp.height, bufW, bufH);
  occlusion.setSize(bufW / 2, bufH / 2);

  stageLabel.textContent = "";
  stageLabel.append(
    h("b", {}, "Sequence"),
    h("span", {}, `${comp.width} × ${comp.height} · ${comp.fps} fps`),
  );
}

window.addEventListener("resize", layout);

// ---- the loop ---------------------------------------------------------------

let clock = 0;
let last = performance.now() / 1000;

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  clock += dt;

  let phase = 1;
  if (anim) {
    const dur = Math.max(1e-3, config.transition.duration);
    const elapsed = sceneTime(clock - anim.start);
    phase = Math.min(1, elapsed / dur);
    if (clock - anim.start >= dur) { phase = 1; completeAnim(); }
  }

  controls.update();
  renderFrame(sceneTime(clock), phase, dt);
}

// ================= UI =========================================================

// ---- the stepper (the funnel) ----------------------------------------------

const stepsEl = document.getElementById("jsteps");
const statusEl = document.getElementById("jstatus");

function renderSteps() {
  stepsEl.textContent = "";
  config.states.forEach((s, i) => {
    if (i > 0) stepsEl.append(h("div", { class: "jstep-link" }));
    const done = !anim && i < currentIndex;
    const active = i === currentIndex;
    const arriving = anim && i === anim.to;
    const cls = ["jstep",
      active ? "is-active" : "",
      done ? "is-done" : "",
      arriving ? "is-arriving" : ""].filter(Boolean).join(" ");
    stepsEl.append(h("button", { class: cls, onclick: () => goTo(i) },
      h("span", { class: "jstep-dot" }, String(i + 1)),
      h("span", { class: "jstep-label" }, s.label),
    ));
  });
  const cur = state(anim ? anim.to : currentIndex);
  statusEl.textContent = "";
  statusEl.append(
    h("span", { class: "jstatus-dot", "data-on": anim ? "1" : "0" }),
    h("b", {}, statusFor(cur)));
  if (anim) statusEl.append(h("span", { class: "jstatus-sub" }, "transitioning…"));

  runBtn.textContent = "";
  runBtn.append(icon(autoRun ? "pause" : "play"), h("span", {}, autoRun ? "Stop" : "Run"));
}

// ---- settings drawer — the editor's own Scene/Transition fields -------------
// Built from the same ui/fields.js components the inspector uses, so the panel
// reads exactly like the editor's Scene tab. Handlers write straight into
// config (no undo stack), persist, and relayout / reload the pair when needed.

// The settings panel is a permanent fixture, tabbed like the inspector:
//   STATES   the funnel — product, steps, per-step target parameters
//   SCENE    composition, camera, terminal feel, glyphs, render
//   FLOW     the one standard transition every move shares
const panel = document.getElementById("jpanel");
panel.append(appNav("sequence"));                       // mode switch, in the chrome
const panelMain = h("div", { class: "seq-panel-main" }); // buildPanel owns this part
panel.append(panelMain);
let panelTab = "states";

/** persist, and optionally re-fit the viewport (comp / cell-size changes). */
function commit(relayout) { saveConfig(); if (relayout) layout(); }

// field factories bound to config
const sceneNum = (key, o, relayout = false) => NumberField({
  get: () => config.scene[key],
  set: (v) => { config.scene[key] = v; commit(relayout); }, ...o });
const sceneSwitch = (key) => SwitchField({
  get: () => !!config.scene[key],
  set: (v) => { config.scene[key] = key === "blocks" ? (v ? 1 : 0) : v; commit(false); } });
const sceneSelect = (key, options) => SelectField({
  get: () => config.scene[key] || 0,
  set: (v) => { config.scene[key] = v; commit(false); }, options });
const sceneColor = (key) => ColorField({
  get: () => config.scene[key],
  set: (v) => { config.scene[key] = v; commit(false); } });
const compNum = (key, o) => NumberField({
  get: () => config.comp[key],
  set: (v) => { config.comp[key] = Math.round(v); commit(true); }, ...o });
const transNum = (key, o) => NumberField({
  get: () => config.transition[key],
  set: (v) => { config.transition[key] = v; commit(false); }, ...o });
// the batch-export settings are render-only — they never touch the live scene,
// so they are not part of `config` and do not autosave with it
const exNum = (key, o) => NumberField({
  get: () => STATE_EXPORT[key],
  set: (v) => { STATE_EXPORT[key] = v; }, ...o });
const exColor = (key) => ColorField({
  get: () => STATE_EXPORT[key],
  set: (v) => { STATE_EXPORT[key] = v; } });
const transSelect = (key, names, o) => SelectField({
  get: () => config.transition[key],
  set: (v) => { config.transition[key] = v; if (key === "staggerAxis") loadedPairKey = ""; commit(false); },
  options: names.map((n, i) => ({ value: i, label: n })), ...o });

// target options: every animation, shape and GLB, addressed directly
function targetOptions() {
  return [
    ...MODES.map((m) => ({ value: `mode:${m.key}`, label: `animation · ${m.label}` })),
    ...ASSET_DEFS.map((d) => ({ value: `asset:${d.key}`, label: `asset · ${d.label}` })),
  ];
}

function resetView() {
  camera.position.set(0, 0, 3.55);
  controls.target.set(0, 0, 0);
  controls.update();
}

function buildPanel() {
  panelMain.textContent = "";

  // the inspector's tab strip, verbatim
  const tabNames = [["states", "States"], ["scene", "Scene"], ["flow", "Flow"]];
  const pill = h("span", { class: "tab-pill" });
  const tabBtns = tabNames.map(([id, label]) => {
    const btn = h("button", { class: "tab-btn", dataset: { tab: id } }, label);
    btn.addEventListener("click", () => { panelTab = id; buildPanel(); });
    return btn;
  });
  panelMain.append(h("div", { class: "tabs" }, pill, ...tabBtns));

  const b = h("div", { class: "panel-body inspector-body" });
  panelMain.append(b);

  if (panelTab === "states") b.append(...statesTab());
  else if (panelTab === "scene") b.append(...sceneTab());
  else b.append(...flowTab());

  requestAnimationFrame(() => {
    const active = tabBtns.find((x) => x.dataset.tab === panelTab);
    if (!active) return;
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    tabBtns.forEach((x) => x.classList.toggle("on", x.dataset.tab === panelTab));
  });
}

function statesTab() {
  return [statesSection()];
}

function sceneTab() {
  const out = [];
  out.push(section("Composition", [
    grid2(
      compNum("width", { min: 128, max: 4096, step: 2, prefix: { text: "W", tip: "Width" } }),
      compNum("height", { min: 128, max: 4096, step: 2, prefix: { text: "H", tip: "Height" } }),
    ),
    grid2(
      SelectField({ get: () => config.comp.fps, set: (v) => { config.comp.fps = v; commit(false); },
        options: FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` })),
        prefix: { icon: "film" }, tipText: "Frame rate" }),
      null,
    ),
    grid2(sceneColor("bg"), sceneColor("ink")),
    h("div", { class: "note" }, "Background · ink."),
  ], { id: "j-comp" }));

  out.push(section("Camera", [
    grid2(
      sceneNum("fov", { min: 15, max: 100, step: 1, unit: "°", prefix: { icon: "camera", tip: "Field of view" } }),
      null,
    ),
    h("div", { class: "btn-row" },
      button("Reset view", { iconName: "camera", variant: "subtle", wide: true,
        title: "Recenter the product, front-on", onClick: resetView })),
  ], { id: "j-camera" }));

  out.push(section("Terminal feel", [
    row("Step rate", sceneSelect("stepFps",
      [{ value: 0, label: "continuous" }, ...[8, 10, 12, 15, 20, 24].map((f) => ({ value: f, label: `${f} fps` }))]),
      { tipText: "The scene only reprints at this rate — like a script looping over sleep()" }),
    row("Grid lock", sceneSwitch("gridLock"),
      { tipText: "Dots snap to character cells, so travel staggers instead of gliding" }),
    row("Ink levels", sceneSelect("inkLevels",
      [{ value: 0, label: "smooth" }, ...[2, 3, 4, 6].map((n) => ({ value: n, label: `${n} steps` }))]),
      { tipText: "Quantize brightness like ANSI dim / normal / bright" }),
    grid2(sceneNum("flicker", { min: 0, max: 1, step: 0.01, prefix: { text: "flicker", tip: "Cells occasionally print dim or drop a frame" } }), null),
  ], { id: "j-term", collapsed: true }));

  out.push(section("Glyphs", [
    row("Glyph pass", sceneSwitch("terminal"), { tipText: "Braille / block terminal rasteriser" }),
    grid2(
      sceneNum("cellW", { min: 6, max: 40, step: 1, prefix: { text: "W", tip: "Cell width, px" } }, true),
      sceneNum("cellH", { min: 8, max: 64, step: 1, prefix: { text: "H", tip: "Cell height, px" } }, true),
    ),
    grid2(
      sceneNum("gapX", { min: 0, max: 0.25, step: 0.005, prefix: { text: "gap x", tip: "Glyph seam between columns — blocks & dots inset like real terminal characters" } }),
      sceneNum("gapY", { min: 0, max: 0.25, step: 0.005, prefix: { text: "gap y", tip: "Glyph seam between rows" } }),
    ),
    grid2(
      sceneNum("dotR", { min: 0.4, max: 1.6, step: 0.02, prefix: { text: "dot", tip: "Braille dot size" } }),
      sceneNum("dotThresh", { min: 0.01, max: 0.35, step: 0.005, prefix: { text: "thresh", tip: "Luminance a sub-pixel needs to print" } }),
    ),
    grid2(
      sceneNum("dither", { min: 0, max: 1.5, step: 0.01, prefix: { text: "dither", tip: "Tone carried as dot density" } }),
      sceneNum("shade", { min: 0, max: 1, step: 0.01, prefix: { text: "shade", tip: "How much luma tints the ink" } }),
    ),
    row("Blocks", sceneSwitch("blocks"), { tipText: "Bright cells solidify to block glyphs" }),
    grid2(
      sceneNum("blockLo", { min: 0.15, max: 6, step: 0.05, prefix: { text: "lo", tip: "Mark energy where block chunks begin" } }),
      sceneNum("blockHi", { min: 0.4, max: 6.5, step: 0.05, prefix: { text: "hi", tip: "Cell energy that prints fully solid" } }),
    ),
    row("Phosphor", sceneSwitch("phosphor"), { tipText: "Motion leaves fading CRT trails" }),
    grid2(sceneNum("persist", { min: 0.05, max: 1.5, step: 0.05, unit: "s", prefix: { text: "persist", tip: "Trail time constant" } }), null),
  ], { id: "j-glyphs", collapsed: true }));

  out.push(section("Render", [
    grid2(
      sceneNum("gain", { min: 0.3, max: 3, step: 0.05, prefix: { text: "exp", tip: "Exposure" } }),
      sceneNum("baseSize", { min: 0.006, max: 0.06, step: 0.001, prefix: { text: "mark", tip: "Mark size" } }),
    ),
    grid2(
      sceneNum("solidity", { min: 0, max: 1, step: 0.01, prefix: { text: "solid", tip: "Assets occlude their own far side" } }),
      sceneNum("occBias", { min: 0.01, max: 0.3, step: 0.005, prefix: { text: "bias", tip: "Occlusion slack" } }),
    ),
  ], { id: "j-render", collapsed: true }));

  out.push(section("Export states", [
    h("div", { class: "note" },
      "One MP4 per state — dissolves in from blank, animates, dissolves out."),
    grid2(
      exNum("width", { min: 16, max: 4096, step: 2, prefix: { text: "W", tip: "Frame width" } }),
      exNum("height", { min: 16, max: 4096, step: 2, prefix: { text: "H", tip: "Frame height" } }),
    ),
    grid2(
      exNum("fadeIn", { min: 0, max: 5, step: 0.05, unit: "s", prefix: { text: "in", tip: "Dissolve in from a blank screen" } }),
      exNum("hold", { min: 0, max: 20, step: 0.05, unit: "s", prefix: { text: "hold", tip: "Plain animation between the dissolves" } }),
    ),
    grid2(
      exNum("fadeOut", { min: 0, max: 5, step: 0.05, unit: "s", prefix: { text: "out", tip: "Dissolve back out to a blank screen" } }),
      exNum("fps", { min: 12, max: 60, step: 1, prefix: { text: "fps", tip: "Frame rate" } }),
    ),
    grid2(exColor("bg"), null),
    button("Export every state…", {
      iconName: "download", variant: "primary", wide: true,
      onClick: () => exportStates(STATE_EXPORT),
    }),
  ], { id: "j-export", collapsed: true }));

  return out;
}

function flowTab() {
  const out = [];
  out.push(section("Transition", [
    h("div", { class: "note" }, "One flight, shared by every state-to-state move."),
    grid2(
      transSelect("ease", EASE_NAMES, { prefix: { icon: "curve" }, tipText: "Easing of the flight" }),
      transSelect("staggerAxis", STAGGER_AXES, { prefix: { icon: "orderRows" }, tipText: "Which particles leave first" }),
    ),
    grid2(
      transSelect("path", PATH_MODES, { prefix: { icon: "squiggle" }, tipText: "The route dots take" }),
      transNum("pathAmp", { min: 0, max: 1, step: 0.01, prefix: { icon: "amp", tip: "Path amount — how far it bends" } }),
    ),
    grid2(
      transNum("spread", { min: 0, max: 0.95, step: 0.01, prefix: { icon: "steps", tip: "Spread — how staggered the flight is: 0 all together, 0.95 one-by-one" } }),
      transNum("swirl", { min: -2, max: 2, step: 0.05, prefix: { icon: "swirl", tip: "Swirl — whole-flight turns" } }),
    ),
    grid2(
      transNum("scatter", { min: 0, max: 0.6, step: 0.01, prefix: { icon: "scatterDots", tip: "Scatter — mid-flight puff" } }),
      transNum("duration", { min: 0.2, max: 3, step: 0.05, unit: "s", prefix: { icon: "clock", tip: "Duration of every flight" } }),
    ),
  ], { id: "j-trans" }));

  out.push(h("div", { class: "jpanel-foot" },
    button("Reset to defaults", { variant: "danger", wide: true, onClick: () => {
      config = defaultConfig();
      currentIndex = 0; anim = null; pending = null; autoRun = false;
      loadedPairKey = "";
      preload(); layout(); buildPanel(); renderSteps(); saveConfig();
      toast("Reset to defaults");
    } })));
  return out;
}

let stateSeq = 0;
const expandedStates = new Set();   // which step rows show their parameters

function statesSection() {
  const list = h("div", { class: "jstates" });
  const rebuild = () => {
    list.textContent = "";
    config.states.forEach((s, i) => list.append(stateRow(s, i, rebuild)));
  };
  rebuild();
  const addBtn = h("button", { class: "section-link" }, "Add");
  addBtn.addEventListener("click", () => {
    config.states.push({ id: `custom-${stateSeq++}`, label: "New step", target: "asset:hoodie", params: {} });
    loadedPairKey = ""; rebuild(); renderSteps(); saveConfig();
  });
  return section("States",
    [list, h("div", { class: "note" }, "Each step morphs to its target. Expand a step to tune that target's own parameters.")],
    { id: "j-states", actions: [addBtn] });
}

function stateRow(s, i, rebuild) {
  const open = expandedStates.has(s.id);
  const labelF = TextField({ get: () => s.label,
    set: (v) => { s.label = v; renderSteps(); saveConfig(); } });
  const targetF = SelectField({ get: () => s.target,
    set: (v) => { s.target = v; loadedPairKey = ""; ensureTargetAsset(s); renderSteps(); rebuild(); saveConfig(); },
    options: targetOptions() });
  const disclose = h("button", { class: `jicon-btn${open ? " on" : ""}`, title: "Parameters",
    onclick: () => { open ? expandedStates.delete(s.id) : expandedStates.add(s.id); rebuild(); } },
    icon(open ? "chevronDown" : "chevronRight"));
  const del = h("button", { class: "jicon-btn", title: "Remove", onclick: () => {
    if (config.states.length <= 2) { toast("Keep at least two states"); return; }
    config.states.splice(i, 1);
    currentIndex = Math.min(currentIndex, config.states.length - 1);
    anim = null; pending = null; loadedPairKey = "";
    rebuild(); renderSteps(); saveConfig();
  } }, icon("trash"));
  const rowEl = h("div", { class: "jstate-wrap" },
    h("div", { class: "jstate-row" },
      h("span", { class: "jstate-idx" }, String(i + 1)),
      h("div", { class: "jstate-fields" }, labelF.el, targetF.el),
      disclose, del));
  if (open) rowEl.append(paramBlock(s, rebuild));
  return rowEl;
}

/** The step's target parameters — the same NumberField grid the editor's Clip
    tab shows, wired to the state's own override object. Overrides mark the
    prefix; right-click a field (or Reset all) clears them. */
function paramBlock(s, rebuild) {
  const box = h("div", { class: "jparams" });
  const base = baseModeFor(clipForState(s));
  if (!base) {
    box.append(h("div", { class: "note busy" }, icon("spinner", "spin"), "Sampling asset…"));
    return box;
  }
  const entries = Object.entries(base.params);
  if (!entries.length) {
    box.append(h("div", { class: "note" }, "This target has no parameters."));
    return box;
  }
  if (!s.params) s.params = {};
  const cells = entries.map(([key, spec]) => {
    const f = NumberField({
      get: () => (s.params[key] !== undefined ? s.params[key] : spec.value),
      set: (v) => { s.params[key] = v; prefixEl?.classList.add("overridden"); saveConfig(); },
      min: spec.min, max: spec.max, step: spec.step, prefix: { text: key, tip: key },
    });
    const prefixEl = f.el.querySelector(".field-prefix");
    if (s.params[key] !== undefined) prefixEl?.classList.add("overridden");
    f.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (s.params[key] === undefined) return;
      delete s.params[key];
      saveConfig();
      f.refresh();
      prefixEl?.classList.remove("overridden");
    });
    return f;
  });
  for (let k = 0; k < cells.length; k += 2) box.append(grid2(cells[k], cells[k + 1] ?? null));
  const resetBtn = h("button", { class: "section-link" }, "Reset all");
  resetBtn.addEventListener("click", () => { s.params = {}; saveConfig(); rebuild(); });
  box.append(h("div", { class: "jparams-foot" }, resetBtn));
  return box;
}

// ---- run-through button -----------------------------------------------------

const runBtn = document.getElementById("jrun-btn");
runBtn.addEventListener("click", () => {
  if (autoRun) { autoRun = false; renderSteps(); return; }
  autoRun = true;
  if (currentIndex >= config.states.length - 1) { currentIndex = 0; loadedPairKey = ""; }
  goTo(Math.min(currentIndex + 1, config.states.length - 1));
});

// Space runs / stops the funnel, like Space plays the editor
window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.code === "Space") { e.preventDefault(); runBtn.click(); }
});

// ---- per-state batch export -------------------------------------------------
// One short film PER STATE rather than one film of the whole journey: each
// clip dissolves in from a blank screen, animates, and dissolves back out.
// "Blank" is the engine's own `fade` — dots wink out one at a time in seed
// order — so the ends are the same picture emptying, not a cut to black.
// Every state renders on its own parameters, exactly as the journey plays it.

export const STATE_EXPORT = {
  width: 1304,
  height: 1080,
  bg: "#1B1B1B",
  fadeIn: 0.5,        // seconds dissolving in from blank
  hold: 1.0,          // seconds of plain animation
  fadeOut: 0.5,       // seconds dissolving back out
  fps: 60,
  quality: 1,
};

/** Size the renderer for offscreen capture at full comp resolution. */
function exportBegin(W, H) {
  controls.enabled = false;
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  bufW = W; bufH = H;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  terminal.cellW = config.scene.cellW;
  terminal.cellH = config.scene.cellH;
  terminal.setSize(W, H, W, H);
  occlusion.setSize(W / 2, H / 2);
}

function exportEnd() {
  controls.enabled = true;
  layout();
}

/** The dissolve envelope: 1 (blank) -> 0 (full) -> 1 (blank). */
function fadeAt(t, ex) {
  const outStart = ex.fadeIn + ex.hold;
  if (t < ex.fadeIn) return 1 - smoothstep01(t / Math.max(ex.fadeIn, 1e-4));
  if (t < outStart) return 0;
  return smoothstep01((t - outStart) / Math.max(ex.fadeOut, 1e-4));
}
const smoothstep01 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Render ONE state's film and return it as an MP4 blob. Shared by the batch
    export and by the headless probe on window.__journey, so what a test
    measures is exactly what a real export writes. Assumes the renderer is
    already sized (exportBegin) and the scene already swapped to export
    background — the caller owns that, because a batch does it once. */
async function renderStateClip(si, ex, codec, onFrame) {
  const fps = ex.fps || config.comp.fps;
  const dur = ex.fadeIn + ex.hold + ex.fadeOut;
  const frames = Math.max(1, Math.round(dur * fps));
  const W = evenDim(ex.width), H = evenDim(ex.height);
  const bitrate = bitrateFor(W, H, fps, ex.quality);
  const s = config.states[si];
  ensureTargetAsset(s);
  const clip = clipForState(s);
  // an asset target samples asynchronously — wait for its layout to exist
  for (let tries = 0; tries < 600 && !clipRuntime(clip, engine.N); tries++) await nextTick();
  currentIndex = si;
  loadedPairKey = "";

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({ codec, width: W, height: H, framerate: fps, bitrate, latencyMode: "quality" });

  try {
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      engine.fade = fadeAt(t, ex);
      // currentIndex is pinned and anim is null, so this settles on THIS state
      // and animates it — the dissolve rides on top. Same path as the live
      // preview, so the export cannot drift from what you watched.
      renderFrame(sceneTime(t), 1, 1 / fps);

      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await nextTick();
      if (onFrame && onFrame(i, frames) === false) return null;   // cancelled
      await nextTick();
    }
    await encoder.flush();
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    try { if (encoder.state !== "closed") encoder.close(); } catch {}
  }
}

const evenDim = (v) => Math.max(2, Math.floor(v / 2) * 2);   // H.264 wants even
const bitrateFor = (W, H, fps, q) =>
  Math.round(Math.min(8e7, Math.max(1e6, W * H * fps * 0.14 * (q || 1))));

export async function exportStates(ex = STATE_EXPORT) {
  if (!config.states.length) { toast("No states to export."); return; }
  const fps = ex.fps || config.comp.fps;
  const dur = ex.fadeIn + ex.hold + ex.fadeOut;
  const frames = Math.max(1, Math.round(dur * fps));
  const W = evenDim(ex.width), H = evenDim(ex.height);
  const codec = await pickH264Codec(W, H, fps, bitrateFor(W, H, fps, ex.quality));
  if (!codec) {
    toast("MP4 export needs WebCodecs H.264 (Chrome / Edge).", { kind: "error", duration: 4200 });
    return;
  }

  // a batch wants ONE destination prompt, not one per file — ask for a folder
  // up front while we still have the click's gesture, and fall back to
  // per-file saves only if the browser has no directory picker
  let dir = null;
  if (window.showDirectoryPicker) {
    try { dir = await window.showDirectoryPicker({ mode: "readwrite" }); }
    catch (err) { if (err?.name === "AbortError") return; }
  }

  // hold the live look aside — the export runs at its own size and background
  const prev = {
    comp: { ...config.comp }, bg: config.scene.bg,
    fade: engine.fade, index: currentIndex, anim,
  };
  config.comp = { ...config.comp, width: W, height: H, fps };
  config.scene.bg = ex.bg;
  anim = null;

  const card = progressCard("Exporting states");
  let cancelled = false;
  card.onCancel(() => { cancelled = true; });
  const t0 = performance.now();
  let done = 0;
  const totalFrames = frames * config.states.length;

  try {
    exportBegin(W, H);
    for (let si = 0; si < config.states.length && !cancelled; si++) {
      const s = config.states[si];
      const blob = await renderStateClip(si, ex, codec, (i) => {
        if (cancelled) return false;
        done++;
        const el = (performance.now() - t0) / 1000;
        const eta = done > 6 ? (el / done) * (totalFrames - done) : null;
        card.set(done / totalFrames,
          `${si + 1}/${config.states.length} ${s.label} · frame ${i + 1}/${frames}` +
          (eta != null ? ` · ~${Math.ceil(eta)}s left` : ""));
        return true;
      });
      if (!blob) break;                                   // cancelled mid-clip
      const name = `${String(si + 1).padStart(2, "0")}_${slug(s.label || "state")}_${W}x${H}.mp4`;
      if (dir) {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
      } else if (!(await saveBlob(blob, name, "MP4 video", "video/mp4"))) {
        cancelled = true;
      }
    }
    toast(cancelled ? "Export cancelled"
                    : `Exported ${config.states.length} films · ${dur}s each · ${W}x${H}`,
          { duration: 4200 });
  } catch (err) {
    console.error(err);
    toast(`Export failed — ${err.message || err}`, { kind: "error", duration: 4200 });
  } finally {
    config.comp = prev.comp;
    config.scene.bg = prev.bg;
    engine.fade = prev.fade;
    currentIndex = prev.index;
    anim = prev.anim;
    loadedPairKey = "";
    exportEnd();
    card.close();
  }
}

/** Headless probe: render one state exactly as the export would, WITHOUT
    writing a file. Returns the encoded size plus a pixel read of the blank
    ends and the animating middle, so a test can prove the envelope really
    empties the frame and the background really is the export colour. */
async function probeStateClip(si, ex = STATE_EXPORT) {
  const W = evenDim(ex.width), H = evenDim(ex.height);
  const fps = ex.fps || config.comp.fps;
  const codec = await pickH264Codec(W, H, fps, bitrateFor(W, H, fps, ex.quality));
  if (!codec) return { error: "no H.264" };
  const prev = {
    comp: { ...config.comp }, bg: config.scene.bg,
    fade: engine.fade, index: currentIndex, anim,
  };
  config.comp = { ...config.comp, width: W, height: H, fps };
  config.scene.bg = ex.bg;
  anim = null;
  const shots = [];
  try {
    exportBegin(W, H);
    const blob = await renderStateClip(si, ex, codec, (i, frames) => {
      // sample the first frame, the middle of the hold, and the last frame
      if (i === 0 || i === Math.floor(frames / 2) || i === frames - 1) {
        const g = renderer.getContext();
        const px = new Uint8Array(4 * W * H);
        g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
        let lit = 0;
        const bg = new THREE.Color(ex.bg);
        const br = Math.round(bg.r * 255), bgc = Math.round(bg.g * 255), bb = Math.round(bg.b * 255);
        for (let p = 0; p < px.length; p += 4) {
          if (Math.abs(px[p] - br) > 12 || Math.abs(px[p + 1] - bgc) > 12 || Math.abs(px[p + 2] - bb) > 12) lit++;
        }
        shots.push({ frame: i, litPct: +((100 * lit) / (W * H)).toFixed(3),
                     corner: [px[0], px[1], px[2]] });
      }
      return true;
    });
    return { width: W, height: H, bytes: blob ? blob.size : 0, type: blob?.type, shots };
  } finally {
    config.comp = prev.comp;
    config.scene.bg = prev.bg;
    engine.fade = prev.fade;
    currentIndex = prev.index;
    anim = prev.anim;
    loadedPairKey = "";
    exportEnd();
  }
}

// ---- boot -------------------------------------------------------------------

function preload() {
  for (const s of config.states) ensureTargetAsset(s);
  ensureAsset(config.product);
  if (params.get("preload") !== "0") for (const d of ASSET_DEFS) ensureAsset(d.key);
}

// expose for headless verification, mirroring the editor's window.__app

// ---- transition films ---------------------------------------------------------
// A film that ANIMATES IN, plays, morphs into the next state, plays, and
// animates out — every part of it movement. The batch export above dissolves
// via `fade`, which is opacity; nothing here touches it. Instead each end of
// the film is an ordinary rank-matched morph against a COLLAPSED or EXPLODED
// version of the same mode, so the dots physically fly in from the crossing and
// out past the frame. The engine already knows how to do that; it just needed
// something to morph from.
//
// The character of each transition is the engine's own flight controls —
// spread (together vs strictly sequential), path (linear / arc / vortex /
// turbulent), pathAmp, scatter, swirl and the stagger axis. Easing is the house
// expo in-out, applied per particle in the shader, so progress is passed LINEAR
// here and the curve happens per dot.

export const FILM_PRESETS = [
  { name: "glide",     spread: 0.35, path: 0, pathAmp: 0,    scatter: 0,    swirl: 0,     staggerAxis: 2 },
  { name: "bloom",     spread: 0.55, path: 1, pathAmp: 0.85, scatter: 0,    swirl: 0,     staggerAxis: 2 },
  { name: "vortex",    spread: 0.45, path: 2, pathAmp: 1.0,  scatter: 0,    swirl: 0.32,  staggerAxis: 3 },
  { name: "turbulent", spread: 0.6,  path: 3, pathAmp: 0.9,  scatter: 0.18, swirl: 0,     staggerAxis: 3 },
  { name: "cascade",   spread: 0.88, path: 1, pathAmp: 0.5,  scatter: 0,    swirl: 0,     staggerAxis: 1 },
  { name: "whip",      spread: 0.5,  path: 2, pathAmp: 1.6,  scatter: 0.1,  swirl: 0.75,  staggerAxis: 0 },
];

export const FILM_EXPORT = {
  width: 1304, height: 1080, fps: 60, quality: 1,
  animIn: 1.3, holdA: 1.7, morph: 1.7, holdB: 1.9, animOut: 1.4,
};

/** A clip built from a state with extra param overrides on top — the seed
    layouts the film flies in from and out to. */
function seedClip(s, over, tag) {
  return { id: `seed-${tag}-${s.id}`, kind: resolveTarget(s.target).kind,
           key: resolveTarget(s.target).key, label: `${s.label} ${tag}`,
           hold: 999, trans: config.transition,
           params: { ...(s.params || {}), ...over } };
}

async function waitForClip(clip) {
  for (let i = 0; i < 600 && !clipRuntime(clip, engine.N); i++) await nextTick();
  return !!clipRuntime(clip, engine.N);
}

/** Place the camera on an orbit around the origin. Angles in degrees. */
function setOrbit(az, el, dist) {
  const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180;
  camera.position.set(dist * Math.cos(e) * Math.sin(a),
                      dist * Math.sin(e),
                      dist * Math.cos(e) * Math.cos(a));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
}

/** Render one film and hand back the MP4 blob. A preset may add:
      ease        0 expoInOut, 1 expoOut, 2 backOut, 3 elasticOut
      waypoint    param overrides for an intermediate layout, so the morph runs
                  A -> W -> B and the shape passes THROUGH something
      waypointOf  which state the waypoint is built from, "a" or "b"
      stepFps     hold the clock on a coarse grid — stop-motion
      camAt(u, phase, phaseU) -> [az, el, dist], moved every frame */
async function renderFilm(plan, ex, codec, pre, onFrame) {
  const fps = ex.fps;
  const total = ex.animIn + ex.holdA + ex.morph + ex.holdB + ex.animOut;
  const frames = Math.max(1, Math.round(total * fps));
  const W = evenDim(ex.width), H = evenDim(ex.height);
  const muxer = new Muxer({ target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
  const encoder = new VideoEncoder({
    output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { throw e; } });
  encoder.configure({ codec, width: W, height: H, framerate: fps,
    bitrate: bitrateFor(W, H, fps, ex.quality), latencyMode: "quality" });

  // [fromClip, toClip, duration, name]; a hold is a clip against itself at
  // progress 1, which leaves the mode animating on its own
  const P = [[plan.seedA, plan.a, ex.animIn, "in"], [plan.a, plan.a, ex.holdA, "holdA"]];
  if (plan.way) {
    P.push([plan.a, plan.way, ex.morph * 0.5, "morph"],
           [plan.way, plan.b, ex.morph * 0.5, "morph"]);
  } else {
    P.push([plan.a, plan.b, ex.morph, "morph"]);
  }
  P.push([plan.b, plan.b, ex.holdB, "holdB"], [plan.b, plan.seedB, ex.animOut, "out"]);

  const step = pre.stepFps || 0;
  try {
    for (let i = 0; i < frames; i++) {
      const t = i / fps;
      let acc = 0, phase = 1, seg = P[P.length - 1], u = 1;
      for (const g of P) {
        if (t < acc + g[2] || g === P[P.length - 1]) {
          seg = g;
          u = Math.min(1, Math.max(0, (t - acc) / Math.max(g[2], 1e-6)));
          phase = g[0] === g[1] ? 1 : u;
          break;
        }
        acc += g[2];
      }
      if (pre.camAt) setOrbit(...pre.camAt(t / total, seg[3], u));
      // stop-motion quantises the CLOCK, so the morph itself steps rather than
      // the picture stuttering — progress and scene time move together
      const ct = step ? Math.floor(t * step) / step : t;
      const cp = step ? Math.floor(phase * step * seg[2]) / Math.max(step * seg[2], 1) : phase;
      engine.fade = 0;                     // no opacity anywhere in this export
      drivePair(seg[0], seg[1], Math.min(1, cp), ct);
      renderScene(ct, 1 / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await nextTick();
      if (onFrame && onFrame(i, frames) === false) return null;
      await nextTick();
    }
    await encoder.flush();
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    try { if (encoder.state !== "closed") encoder.close(); } catch {}
  }
}

/** Render one film per preset for states [ia -> ib] and POST each to the dev
    server, which writes it into out/. Returns what it wrote. */
export async function exportTransitionFilms(o = {}) {
  const ex = { ...FILM_EXPORT, ...(o.export || {}) };
  const presets = o.presets || FILM_PRESETS;
  const ia = o.from ?? 0, ib = o.to ?? 1;
  const sa = config.states[ia], sb = config.states[ib];
  const W = evenDim(ex.width), H = evenDim(ex.height);
  const codec = await pickH264Codec(W, H, ex.fps, bitrateFor(W, H, ex.fps, ex.quality));
  if (!codec) throw new Error("no H.264 encoder");

  const plan = {
    a: clipForState(sa),
    b: clipForState(sb),
    // fly IN out of the crossing: the same star with almost no length, so every
    // dot starts stacked at the centre and travels to its place
    seedA: seedClip(sa, o.seedA || { len: 0.05 }, "in"),
    // fly OUT through the frame: the same helix blown open, so the dots leave
    // rather than fading. An empty last frame, not a lingering dot.
    seedB: seedClip(sb, o.seedB || { radius: 7, height: 16 }, "out"),
  };
  for (const c of [plan.seedA, plan.a, plan.b, plan.seedB]) {
    if (!(await waitForClip(c))) throw new Error(`clip never resolved: ${c.label}`);
  }

  const savedTrans = { ...config.transition };
  const savedIdx = currentIndex, savedAnim = anim;
  const savedCam = camera.position.clone(), savedQ = camera.quaternion.clone();
  const savedStep = config.scene.stepFps;
  anim = null;
  exportBegin(W, H);
  // the framing the whole batch sits at unless a preset moves the camera
  const base = o.camera || [40, 35, 3.55];
  const written = [];
  try {
    for (const pre of presets) {
      Object.assign(config.transition, pre);
      setOrbit(...base);
      plan.way = pre.waypoint
        ? seedClip(pre.waypointOf === "b" ? sb : sa, pre.waypoint, `way-${pre.name}`)
        : null;
      if (plan.way && !(await waitForClip(plan.way)))
        throw new Error(`waypoint never resolved: ${pre.name}`);
      loadedPairKey = "";
      const blob = await renderFilm(plan, ex, codec, pre, o.onFrame);
      if (!blob) break;
      const name = `${slug(sa.label)}-to-${slug(sb.label)}-${pre.name}.mp4`;
      const res = await fetch(`/save/${name}`, { method: "POST", body: blob });
      written.push({ name, bytes: blob.size, ok: res.ok });
    }
  } finally {
    Object.assign(config.transition, savedTrans);
    config.scene.stepFps = savedStep;
    camera.position.copy(savedCam); camera.quaternion.copy(savedQ);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    currentIndex = savedIdx; anim = savedAnim; loadedPairKey = "";
    exportEnd();
  }
  return written;
}


/** Draw ONE frame of a state right now, without waiting on the animation loop.
    Chrome suspends requestAnimationFrame on a backgrounded tab, so anything
    driving the page from outside (a probe, a sweep, an export) cannot rely on
    the loop running at all — this renders synchronously through the very same
    path a live frame takes. */
export function renderStill(si, t = 0) {
  const clip = clipForState(config.states[si]);
  if (!clipRuntime(clip, engine.N)) return false;
  engine.fade = 0;
  drivePair(clip, clip, 1, t);
  renderScene(t, 1 / 60);
  return true;
}


// ---- solo films ---------------------------------------------------------------
// One shape, no morph. The point of these is DEPTH, so the two things carrying
// it are the block size ramp and camera movement — a shape that resizes
// correctly as the eye moves around it reads as solid in a way no still frame
// or spinning-in-place render does.

/** Render one shape for `dur` seconds and POST the MP4. A shot is
      { name, target, params, dur, camAt(u) -> [az,el,dist], stepFps } */
export async function exportSoloFilms(o = {}) {
  const ex = { width: 1304, height: 1080, fps: 60, quality: 1, dur: 6, ...(o.export || {}) };
  const shots = o.shots || [];
  const W = evenDim(ex.width), H = evenDim(ex.height);
  const codec = await pickH264Codec(W, H, ex.fps, bitrateFor(W, H, ex.fps, ex.quality));
  if (!codec) throw new Error("no H.264 encoder");

  const savedIdx = currentIndex, savedAnim = anim;
  const savedCam = camera.position.clone(), savedQ = camera.quaternion.clone();
  const savedStep = config.scene.stepFps;
  anim = null;
  exportBegin(W, H);
  const written = [];
  try {
    for (const shot of shots) {
      const st = { id: `solo-${shot.name}`, label: shot.name,
                   target: shot.target, params: shot.params || {} };
      const clip = clipForState(st);
      if (!(await waitForClip(clip))) throw new Error(`clip never resolved: ${shot.name}`);
      loadedPairKey = "";
      const dur = shot.dur || ex.dur;
      const frames = Math.max(1, Math.round(dur * ex.fps));
      const muxer = new Muxer({ target: new ArrayBufferTarget(),
        video: { codec: "avc", width: W, height: H }, fastStart: "in-memory" });
      const encoder = new VideoEncoder({
        output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { throw e; } });
      encoder.configure({ codec, width: W, height: H, framerate: ex.fps,
        bitrate: bitrateFor(W, H, ex.fps, ex.quality), latencyMode: "quality" });
      const step = shot.stepFps || 0;
      try {
        for (let i = 0; i < frames; i++) {
          const t = i / ex.fps, u = i / Math.max(frames - 1, 1);
          if (shot.camAt) setOrbit(...shot.camAt(u, t));
          const ct = step ? Math.floor(t * step) / step : t;
          engine.fade = 0;
          drivePair(clip, clip, 1, ct);
          renderScene(ct, 1 / ex.fps);
          const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6) });
          encoder.encode(frame, { keyFrame: i % (ex.fps * 2) === 0 });
          frame.close();
          while (encoder.encodeQueueSize > 4) await nextTick();
          await nextTick();
        }
        await encoder.flush();
        muxer.finalize();
      } finally {
        try { if (encoder.state !== "closed") encoder.close(); } catch {}
      }
      const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
      const name = `spark-${slug(shot.name)}.mp4`;
      const res = await fetch(`/save/${name}`, { method: "POST", body: blob });
      written.push({ name, bytes: blob.size, ok: res.ok });
    }
  } finally {
    config.scene.stepFps = savedStep;
    camera.position.copy(savedCam); camera.quaternion.copy(savedQ);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    currentIndex = savedIdx; anim = savedAnim; loadedPairKey = "";
    exportEnd();
  }
  return written;
}

window.__journey = {
  config, engine,
  goTo, state: () => currentIndex, states: () => config.states,
  setProduct: (k) => { config.product = k; ensureAsset(k); loadedPairKey = ""; renderSteps(); },
  exportStates, probeStateClip, STATE_EXPORT,
  exportTransitionFilms, FILM_PRESETS, FILM_EXPORT, renderStill, exportSoloFilms,
};

preload();
buildPanel();
layout();
renderSteps();
frame();
