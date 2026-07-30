// hatch·visual — the default mode: a poster studio. Place ONE target —
// an animation, a shape primitive, a GLB product, or imported vector art —
// frame it, tune the scene variables, and export a still as PNG or SVG.
//
// Same engine, same panels, no timeline: the pool settles on a single
// target (switching targets is the house rank-matched morph), the orbit
// camera frames it, and the export path re-renders at exact comp pixels.

import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { ParticleEngine } from "./particles.js";
import { TerminalPass } from "./terminal.js";
import { OcclusionPass } from "./occlusion.js";
import { MODES, paramValues } from "./modes.js";
import { ASSET_DEFS, loadAssetMode, assetModeFromBuffer } from "./assets.js";
import { imageModeFromFile } from "./vectorImport.js";
import { PhotoOverlay } from "./photo.js";
import { exportSVG, download } from "./exportStill.js";
import { setAssetResolver, clipRuntime, baseModeFor } from "./sequence.js";
import { defaultProject, defaultTransition, cleanBrailleScene } from "./store.js";
import { h, icon, toast } from "./ui/dom.js";
import { appNav } from "./ui/appnav.js";
import {
  NumberField, SelectField, SwitchField, ColorField, SegmentedField,
  section, grid2, row, button,
} from "./ui/fields.js";

THREE.ColorManagement.enabled = false;

// ---- config ------------------------------------------------------------------

const STORAGE_KEY = "hatchfusion.visual.v1";

function defaultConfig() {
  return {
    version: 1,
    comp: { width: 1080, height: 1080 },
    target: "asset:plate",
    params: {},          // per-target param overrides: { [target]: {…} }
    scene: { ...defaultProject().scene, bg: "#000000", ink: "#ffffff" },
    export: { scale: 2, transparent: false },
  };
}

let config = loadConfig();

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.version === 1) {
        const d = defaultConfig();
        const GONE = new Set(["mode:moire", "asset:newtons-cradle",
          "asset:shape-cylinder", "asset:shape-cone", "asset:shape-sphere",
          "asset:shape-prism", "asset:shape-pyramid",
          "mode:find-sway", "mode:arrange-bloom"]);
        const scene = { ...d.scene, ...p.scene };
        // pre-mosaic house thresholds -> tuned quadrant-era values
        if (scene.blockLo === 2.0 && scene.blockHi === 4.0) {
          scene.blockLo = d.scene.blockLo;
          scene.blockHi = d.scene.blockHi;
        }
        return {
          version: 1,
          comp: { ...d.comp, ...p.comp },
          target: GONE.has(p.target) ? d.target : (p.target || d.target),
          params: p.params || {},
          scene,
          export: { ...d.export, ...p.export },
        };
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

// ---- gl boot -------------------------------------------------------------------

const canvas = document.getElementById("view");
if (!document.createElement("canvas").getContext("webgl2")) {
  document.getElementById("fatal").hidden = false;
  throw new Error("WebGL2 unavailable");
}

// alpha: true — transparent-background PNG export reads the canvas directly
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, powerPreference: "high-performance",
  preserveDrawingBuffer: true, alpha: true,
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

// ---- the library ----------------------------------------------------------------

const assetLib = new Map();
setAssetResolver((key) => assetLib.get(key) || null);
const imports = [];        // session imports: { key, label }

// This is an image editor first, so it opens on an image rather than a naked
// sphere: a plate that ships with the app and is traced exactly like anything
// you drop in yourself. It registers under a stable key so the choice sticks
// across reloads, where a session import would not.
const DEFAULT_PLATE = { key: "plate", url: "./plates/default.png", label: "plate" };

async function ensureDefaultPlate() {
  if (assetLib.has(DEFAULT_PLATE.key)) return;
  try {
    const res = await fetch(DEFAULT_PLATE.url);
    if (!res.ok) return;
    const file = new File([await res.blob()], "default.png", { type: "image/png" });
    const mode = await imageModeFromFile(file, engine.N);
    mode.key = `asset:${DEFAULT_PLATE.key}`;
    mode.label = DEFAULT_PLATE.label;
    assetLib.set(DEFAULT_PLATE.key, mode);
    imports.push({ key: DEFAULT_PLATE.key, label: mode.label });
    loadedPairKey = "";
    refreshLabel();          // the stage label reads "loading…" until this lands
    buildPanel();
  } catch (err) {
    console.error("default plate", err);
  }
}

async function ensureAsset(key) {
  if (assetLib.has(key)) return;
  const def = ASSET_DEFS.find((d) => d.key === key);
  if (!def) return;
  assetLib.set(key, null);
  try {
    assetLib.set(key, await loadAssetMode(def, engine.N));
    loadedPairKey = "";
  } catch (err) {
    console.error(err);
    assetLib.delete(key);
    // A saved target that can no longer load would otherwise leave the editor
    // staring at an empty canvas forever — most likely a model that is not
    // shipped in this deployment. Fall back to the plate so there is always
    // something on screen, and say why.
    if (config.target === `asset:${key}`) {
      await ensureDefaultPlate();
      if (assetLib.get(DEFAULT_PLATE.key)) {
        config.target = `asset:${DEFAULT_PLATE.key}`;
        loadedPairKey = "";
        saveConfig();
        refreshLabel();
        buildPanel();
      }
      toast(`${def.label} is not available here — opened the plate instead`,
            { kind: "error", duration: 4200 });
      return;
    }
    toast(`Could not load ${def.label} — ${err.message || err}`, { kind: "error" });
  }
}

// Shipped images beyond the default plate — registered under stable keys
// so they are part of the app on this page too.
const SHIPPED_IMAGES = [{ key: "longsleeve", url: "./plates/longsleeve.png" }];

async function ensureShippedImages() {
  for (const def of SHIPPED_IMAGES) {
    if (assetLib.has(def.key)) continue;
    try {
      const res = await fetch(def.url);
      if (!res.ok) continue;
      const file = new File([await res.blob()], def.url.split("/").pop(),
                            { type: "image/png" });
      const mode = await imageModeFromFile(file, engine.N);
      mode.key = `asset:${def.key}`;
      mode.label = def.key;
      assetLib.set(def.key, mode);
      imports.push({ key: def.key, label: def.key });
      loadedPairKey = "";
      buildPanel();
    } catch (err) {
      console.error("shipped image", def.key, err);
    }
  }
}

async function importFile(file) {
  const t = toast(`Importing ${file.name}…`, { kind: "busy", duration: 0 });
  try {
    let mode;
    if (/\.(glb|gltf)$/i.test(file.name)) {
      mode = await assetModeFromBuffer(await file.arrayBuffer(), file.name, engine.N);
    } else {
      mode = await imageModeFromFile(file, engine.N);
    }
    let key = (mode.key || "").replace(/^asset:/, "") || `import-${imports.length}`;
    while (assetLib.has(key)) key += "-2";
    mode.key = `asset:${key}`;
    assetLib.set(key, mode);
    imports.push({ key, label: mode.label });
    t.dismiss();
    setTarget(`asset:${key}`);
    buildPanel();
    toast(`${mode.label} placed — imports live for this session`);
  } catch (err) {
    console.error(err);
    t.dismiss();
    toast(`Could not import ${file.name} — ${err.message || err}`, { kind: "error" });
  }
}

// ---- the single-target player -----------------------------------------------

const VISUAL_TRANS = defaultTransition();   // the house flight for target swaps
let anim = null;                            // { from, start } while morphing
let loadedPairKey = "";

function parseTarget(t) {
  const c = String(t).indexOf(":");
  const kind = t.slice(0, c), key = t.slice(c + 1);
  return kind === "mode" ? { kind: "mode", key } : { kind: "asset", key };
}

function clipForTarget(t) {
  const r = parseTarget(t);
  if (!config.params[t]) config.params[t] = {};
  return { id: `v-${t}`, kind: r.kind, key: r.key, label: t,
    hold: 999, trans: VISUAL_TRANS, params: config.params[t] };
}

function setTarget(t) {
  if (t === config.target) return;
  const r = parseTarget(t);
  if (r.kind === "asset") ensureAsset(r.key);
  anim = { from: config.target, start: clock };
  config.target = t;
  saveConfig();
  refreshLabel();
  buildPanel();          // the Parameters section follows the target
}

function drivePair(fromClip, toClip, phase, sceneT) {
  const from = clipRuntime(fromClip, engine.N);
  const to = clipRuntime(toClip, engine.N);
  if (!from || !to) return false;
  const pairKey = `${from.sig}@${fromClip.id}>${to.sig}@${toClip.id}|${VISUAL_TRANS.staggerAxis}`;
  if (pairKey !== loadedPairKey) {
    engine.staggerAxis = VISUAL_TRANS.staggerAxis;
    engine.setPairDirect(from.inst, from.layout, to.inst, to.layout);
    loadedPairKey = pairKey;
  }
  engine.spread = VISUAL_TRANS.spread;
  engine.easeIndex = VISUAL_TRANS.ease;
  engine.pathMode = VISUAL_TRANS.path;
  engine.pathAmp = VISUAL_TRANS.pathAmp;
  engine.scatter = VISUAL_TRANS.scatter;
  engine.swirl = 0;
  engine.renderState(sceneT, phase);
  return true;
}

// ---- scene application + frame ------------------------------------------------

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

function sceneTime(t) {
  const fps = config.scene.stepFps || 0;
  return fps > 0 ? Math.floor(t * fps + 1e-6) / fps : t;
}

let lastStepKey = null;

const photoOverlay = new PhotoOverlay();

function renderFrame(sceneT, phase, dt) {
  const scn = config.scene;
  const cur = clipForTarget(config.target);
  const from = anim ? clipForTarget(anim.from) : cur;
  drivePair(from, cur, phase, sceneT);
  applyScene();
  // the ACTUAL image: transition-aware — mosaic staggers reveal the photo
  // tile by tile, everything else fades it at arrival; the dots dissolve
  // only once settled either way
  const photoState = photoOverlay.evaluate(engine);
  engine.material.uniforms.uPhotoB.value = photoState.alpha;
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
  if (photoState.alpha > 0.001)
    photoOverlay.draw(renderer, camera, engine, photoState);
}

// ---- layout -----------------------------------------------------------------

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
  refreshLabel();
}

function refreshLabel() {
  const comp = config.comp;
  const cur = baseModeFor(clipForTarget(config.target));
  stageLabel.textContent = "";
  stageLabel.append(
    h("b", {}, "Visual"),
    h("span", {}, `${comp.width} × ${comp.height}`),
    h("span", {}, cur ? cur.label : "loading…"),
  );
}

window.addEventListener("resize", layout);

// ---- exports ------------------------------------------------------------------

function stillName(ext) {
  const cur = baseModeFor(clipForTarget(config.target));
  return `hatch-${(cur?.label || "visual").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`;
}

function exportPNG() {
  const { width: W, height: H } = config.comp;
  const s = config.export.scale || 1;
  const scn = config.scene;
  controls.enabled = false;
  renderer.setPixelRatio(1);
  renderer.setSize(W * s, H * s, false);
  bufW = W * s; bufH = H * s;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  terminal.cellW = scn.cellW;
  terminal.cellH = scn.cellH;
  terminal.setSize(W, H, W * s, H * s);
  occlusion.setSize((W * s) / 2, (H * s) / 2);
  terminal.glyph.mat.uniforms.uBgAlpha.value = config.export.transparent ? 0 : 1;

  const phase = anim
    ? Math.min(1, (clock - anim.start) / Math.max(1e-3, VISUAL_TRANS.duration))
    : 1;
  renderFrame(sceneTime(clock), phase, 0);

  canvas.toBlob((blob) => {
    if (blob) { download(blob, stillName("png")); toast(`PNG exported — ${W * s} × ${H * s}`); }
    else toast("PNG export failed", { kind: "error" });
    terminal.glyph.mat.uniforms.uBgAlpha.value = 1;
    controls.enabled = true;
    layout();
  }, "image/png");
}

function doExportSVG() {
  // the live loop keeps the sub-pixel buffer current; replay it as vectors
  const scn = { ...config.scene };
  const svg = exportSVG({
    renderer, terminal, scene: scn, comp: config.comp,
    transparent: config.export.transparent,
  });
  download(new Blob([svg], { type: "image/svg+xml" }), stillName("svg"));
  toast("SVG exported — true vector dots & blocks");
}

// ---- the loop -----------------------------------------------------------------

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
    const dur = Math.max(1e-3, VISUAL_TRANS.duration);
    phase = Math.min(1, (clock - anim.start) / dur);
    if (phase >= 1) { anim = null; phase = 1; }
  }

  controls.update();
  renderFrame(sceneTime(clock), phase, dt);
}

// ================= panel =========================================================

const panel = document.getElementById("vpanel");
panel.append(appNav("visual"));
const panelMain = h("div", { class: "v-panel-main" });
panel.append(panelMain);

/** The house style, as a two-way segmented control. Either side restores the
    clean-braille look; the difference between them is whether hot cells are
    allowed to solidify into blocks. It RESETS the look — size, colours and
    camera are the piece's own and survive. */
function styleField() {
  return SegmentedField({
    label: "Style",
    get: () => (config.scene.blocks ? 1 : 0),
    set: (v) => {
      const { bg, ink, fov } = config.scene;
      config.scene = { ...cleanBrailleScene(), bg, ink, fov, blocks: v };
      // commit(true), not just applyScene: the cell size only reaches the glyph
      // pass through layout(), so without the relayout the grid — the most
      // visible half of the style — silently stays where it was
      commit(true);
      applyScene();
      buildPanel();
    },
    options: [
      { value: 0, label: "Braille", tip: "Dots only — nothing solidifies" },
      { value: 1, label: "Blocks", tip: "Hot cells print solid blocks" },
    ],
  });
}

function commit(relayout) { saveConfig(); if (relayout) layout(); }

const sceneNum = (key, o, relayout = false) => NumberField({
  get: () => config.scene[key],
  set: (v) => { config.scene[key] = v; commit(relayout); }, ...o });
const sceneSwitch = (key, label) => SwitchField({
  label,
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

// Images lead the list — they are what this editor is for. Models and the
// generative animations follow, so the long tail never buries the short one.
function targetOptions() {
  return [
    ...imports.map((i) => ({ value: `asset:${i.key}`, label: `image · ${i.label}` })),
    ...ASSET_DEFS.map((d) => ({ value: `asset:${d.key}`, label: `3D · ${d.label}` })),
    ...MODES.map((m) => ({ value: `mode:${m.key}`, label: `animation · ${m.label}` })),
  ];
}

function resetView() {
  camera.position.set(0, 0, 3.55);
  controls.target.set(0, 0, 0);
  controls.update();
}

// One panel, no tabs: place, scene and export are a single scrollable list
// of sections (the advanced ones start collapsed, like the inspector).
function buildPanel() {
  panelMain.textContent = "";
  const b = h("div", { class: "panel-body" });
  panelMain.append(b);
  b.append(row("Style", styleField()), ...placeTab(), ...sceneTab(), ...exportTab());
}

function placeTab() {
  const out = [];
  out.push(section("Source", [
    h("div", { class: "btn-row" },
      button("Open image\u2026", { iconName: "image", variant: "primary", wide: true,
        title: "PNG, JPG or SVG \u2014 traced into braille",
        onClick: () => fileInput.click() })),
    row("Showing", SelectField({
      get: () => config.target,
      set: (v) => { setTarget(v); buildPanel(); },
      options: targetOptions(),
    })),
    h("div", { class: "note" },
      "Images are the default here. The list also holds 3D models and the "
      + "generative animations \u2014 imports last for this session."),
  ], { id: "v-target" }));

  out.push(paramsSection());
  return out;
}

function paramsSection() {
  const base = baseModeFor(clipForTarget(config.target));
  const kids = [];
  if (!base) {
    kids.push(h("div", { class: "note busy" }, icon("spinner", "spin"), "Sampling asset…"));
  } else {
    const t = config.target;
    if (!config.params[t]) config.params[t] = {};
    const P = config.params[t];
    const entries = Object.entries(base.params);
    const cells = entries.map(([key, spec]) => {
      const f = NumberField({
        get: () => (P[key] !== undefined ? P[key] : spec.value),
        set: (v) => { P[key] = v; prefixEl?.classList.add("overridden"); saveConfig(); },
        min: spec.min, max: spec.max, step: spec.step, prefix: { text: key, tip: key },
      });
      const prefixEl = f.el.querySelector(".field-prefix");
      if (P[key] !== undefined) prefixEl?.classList.add("overridden");
      f.el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (P[key] === undefined) return;
        delete P[key];
        saveConfig(); f.refresh(); prefixEl?.classList.remove("overridden");
      });
      return f;
    });
    for (let k = 0; k < cells.length; k += 2) kids.push(grid2(cells[k], cells[k + 1] ?? null));
  }
  const resetBtn = h("button", { class: "section-link" }, "Reset");
  resetBtn.addEventListener("click", () => {
    config.params[config.target] = {};
    saveConfig(); buildPanel();
  });
  return section("Parameters", kids, { id: "v-params", actions: [resetBtn] });
}

function sceneTab() {
  const out = [];
  const is3D = parseTarget(config.target).kind === "asset"
            && !(baseModeFor(clipForTarget(config.target)) || {}).image;

  out.push(section("Canvas", [
    grid2(
      compNum("width", { min: 128, max: 4096, step: 2, prefix: { text: "W", tip: "Width, px" } }),
      compNum("height", { min: 128, max: 4096, step: 2, prefix: { text: "H", tip: "Height, px" } }),
    ),
    h("div", { class: "btn-row" },
      ...[["Square", 1080, 1080], ["Portrait", 1080, 1920], ["Landscape", 1920, 1080]]
        .map(([label, w, hgt]) => button(label, {
          variant: "subtle",
          title: `${w} x ${hgt}`,
          onClick: () => { config.comp.width = w; config.comp.height = hgt; commit(true); buildPanel(); },
        }))),
    grid2(sceneColor("bg"), sceneColor("ink")),
    h("div", { class: "note" }, "Background and ink."),
  ], { id: "v-comp" }));

  out.push(section("Grid", [
    h("div", { class: "note" },
      "The character cell everything is drawn into. Smaller cells = finer, "
      + "more detailed marks."),
    grid2(
      sceneNum("cellW", { min: 4, max: 40, step: 1, prefix: { text: "W", tip: "Cell width, px — smaller is finer" } }, true),
      sceneNum("cellH", { min: 8, max: 64, step: 1, prefix: { text: "H", tip: "Cell height, px — usually 2x the width" } }, true),
    ),
    h("div", { class: "btn-row" },
      ...[["Fine", 6, 12], ["Default", 8, 16], ["Coarse", 12, 24]].map(([label, w, hgt]) =>
        button(label, {
          variant: "subtle",
          title: `${w} x ${hgt} px cells`,
          onClick: () => { config.scene.cellW = w; config.scene.cellH = hgt; commit(true); buildPanel(); },
        }))),
    grid2(
      sceneNum("gapX", { min: 0, max: 0.25, step: 0.005, prefix: { text: "seam x", tip: "The gap a terminal leaves between columns" } }),
      sceneNum("gapY", { min: 0, max: 0.25, step: 0.005, prefix: { text: "seam y", tip: "The gap a terminal leaves between rows" } }),
    ),
  ], { id: "v-grid" }));

  out.push(section("Ink", [
    grid2(
      sceneNum("dotR", { min: 0.4, max: 1.6, step: 0.02, prefix: { text: "dot", tip: "Braille dot size" } }),
      sceneNum("dotThresh", { min: 0.01, max: 0.35, step: 0.005, prefix: { text: "thresh", tip: "How much light a dot needs before it prints — higher is sparser and crisper" } }),
    ),
    grid2(
      sceneNum("gain", { min: 0.3, max: 3, step: 0.05, prefix: { text: "exposure", tip: "Overall brightness" } }),
      sceneNum("baseSize", { min: 0.006, max: 0.06, step: 0.001, prefix: { text: "mark", tip: "Size of each underlying mark" } }),
    ),
    h("div", { class: "note" },
      "Blocks are switched at the top of the panel. These set where they start."),
    grid2(
      sceneNum("blockLo", { min: 0.15, max: 6, step: 0.05, prefix: { text: "lo", tip: "Energy where a cell starts to solidify" } }),
      sceneNum("blockHi", { min: 0.4, max: 6.5, step: 0.05, prefix: { text: "hi", tip: "Energy that prints a full solid block" } }),
    ),
  ], { id: "v-ink" }));

  out.push(section("View", [
    grid2(
      sceneNum("fov", { min: 15, max: 100, step: 1, unit: "\u00b0", prefix: { icon: "camera", tip: "Field of view" } }),
      null,
    ),
    h("div", { class: "btn-row" },
      button("Reset view", { iconName: "camera", variant: "subtle", wide: true,
        title: "Recentre, front-on", onClick: resetView })),
    ...(is3D ? [
      h("div", { class: "note" }, "Drag the canvas to orbit. 3D only:"),
      grid2(
        sceneNum("solidity", { min: 0, max: 1, step: 0.01, prefix: { text: "solid", tip: "How much a model hides its own far side" } }),
        sceneNum("occBias", { min: 0.01, max: 0.3, step: 0.005, prefix: { text: "bias", tip: "Slack before a mark counts as hidden" } }),
      ),
    ] : [
      h("div", { class: "note" }, "Drag the canvas to orbit."),
    ]),
  ], { id: "v-view", collapsed: !is3D }));

  return out;
}

function exportTab() {
  const out = [];
  out.push(section("Still", [
    row("Scale", SelectField({
      get: () => config.export.scale,
      set: (v) => { config.export.scale = v; commit(false); },
      options: [1, 2, 3].map((s) => ({ value: s, label: `${s}× — ${config.comp.width * s} px` })),
    })),
    row("Transparent", SwitchField({
      label: "Transparent background",
      get: () => !!config.export.transparent,
      set: (v) => { config.export.transparent = v; commit(false); },
    }), { tipText: "Drop the background — ink only, for placing on any surface" }),
  ], { id: "v-still" }));

  out.push(h("div", { class: "vfoot" },
    button("Export PNG", { iconName: "image", variant: "primary", wide: true, onClick: exportPNG }),
    button("Export SVG", { iconName: "download", variant: "subtle", wide: true, onClick: doExportSVG }),
    h("div", { class: "note v-note-pad" },
      "PNG renders the comp at exact pixels. SVG replays the glyph pass as real vectors — a <rect> per block, a <circle> per dot.")));
  return out;
}

// ---- file input / drop --------------------------------------------------------

const fileInput = document.getElementById("file");
fileInput.addEventListener("change", async () => {
  for (const f of fileInput.files) await importFile(f);
  fileInput.value = "";
});

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
    if (/\.(glb|gltf|svg|png|jpe?g)$/i.test(f.name)) await importFile(f);
  }
});

// ---- boot -----------------------------------------------------------------------

window.__visual = {
  config, engine, renderer, terminal,
  setTarget, exportPNG,
  save: () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {} },
  svg: () => exportSVG({ renderer, terminal, scene: { ...config.scene },
    comp: config.comp, transparent: config.export.transparent }),
  // deterministic frame — rAF-independent, for tests and scripted stills
  renderAt: (T) => { anim = null; clock = T; last = performance.now() / 1000;
    renderFrame(sceneTime(T), 1, 0); },
};

ensureDefaultPlate();          // the plate this editor opens on
ensureShippedImages();         // the other shipped plates
{
  const r = parseTarget(config.target);
  if (r.kind === "asset" && r.key !== DEFAULT_PLATE.key) ensureAsset(r.key);
}
if (params.get("preload") !== "0") {
  (async () => { for (const d of ASSET_DEFS) await ensureAsset(d.key); })();
}

buildPanel();
layout();
frame();
