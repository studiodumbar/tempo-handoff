// TEMPO · Visual — make a braille or block picture and export it.
//
// One source at a time: an image, a 3D model or a procedural animation, drawn
// by the shared particle pool through the glyph pass. Three files come out of
// the same picture — PNG at exact canvas pixels, SVG as one shape per mark,
// and a 3D relief where every mark that prints becomes a raised solid.
//
// Same engine as Motion, no timeline: the pool settles on a single source
// (switching is the house rank-matched morph) and the orbit camera frames it.

import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { ParticleEngine } from "./particles.js";
import { TerminalPass } from "./terminal.js";
import { OcclusionPass } from "./occlusion.js";
import { MODES, modeFamilies, paramValues } from "./modes.js";
import { ASSET_DEFS, loadAssetMode, assetModeFromBuffer } from "./assets.js";
import { imageModeFromFile } from "./vectorImport.js";
import { PhotoOverlay } from "./photo.js";
import { exportSVG, download } from "./exportStill.js";
import { exportMesh } from "./exportMesh.js";
import { setAssetResolver, clipRuntime, baseModeFor } from "./sequence.js";
import { defaultProject, defaultTransition, cleanBrailleScene } from "./store.js";
import {
  h, icon, toast, showMenu, confirmAction, showShortcuts, isMac, modKey,
} from "./ui/dom.js";
import { appNav, skipLink } from "./ui/appnav.js";
import {
  NumberField, SelectField, SwitchField, ColorField, SegmentedField,
  section, grid2, row, button,
} from "./ui/fields.js";

THREE.ColorManagement.enabled = false;

// ---- config ------------------------------------------------------------------

const STORAGE_KEY = "tempo.visual.v1";
const LEGACY_KEY = "hatchfusion.visual.v1";

function defaultConfig() {
  return {
    version: 1,
    comp: { width: 1080, height: 1080 },
    target: "asset:plate",
    params: {},          // per-target param overrides: { [target]: {…} }
    scene: { ...defaultProject().scene, bg: "#000000", ink: "#ffffff" },
    export: {
      format: "png",
      scale: 2,
      transparent: false,
      depth: 2,          // how far a mark stands off the tile, mm
      base: true,        // the backing plate that makes it one solid
      baseDepth: 1.2,
    },
  };
}

let config = loadConfig();

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
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

// Shipped images beyond the default plate. They are part of the APP, so they
// appear in the picker from the first frame — but the pixels only arrive when
// one is actually chosen. longsleeve.png alone is 2.7 MB; paying that at boot
// for an image most sessions never open is the wrong trade.
const SHIPPED_IMAGES = [
  { key: "longsleeve", label: "long sleeve", url: "./plates/longsleeve.png" },
];

function registerShippedImages() {
  for (const def of SHIPPED_IMAGES) {
    if (!imports.some((i) => i.key === def.key)) {
      imports.push({ key: def.key, label: def.label ?? def.key, url: def.url });
    }
  }
}

/** Fetch and trace a shipped image on demand. Resolves once it is in the
    library, so callers can await the first render being possible. */
async function ensureShippedImage(key) {
  if (assetLib.has(key)) return assetLib.get(key);
  const def = SHIPPED_IMAGES.find((d) => d.key === key);
  if (!def) return null;
  assetLib.set(key, null);                       // claim it: one fetch, not N
  try {
    const res = await fetch(def.url);
    if (!res.ok) throw new Error(`${res.status}`);
    const file = new File([await res.blob()], def.url.split("/").pop(),
                          { type: "image/png" });
    const mode = await imageModeFromFile(file, engine.N);
    mode.key = `asset:${key}`;
    mode.label = def.label ?? key;
    assetLib.set(key, mode);
    loadedPairKey = "";
    refreshLabel();
    buildPanel();
    return mode;
  } catch (err) {
    assetLib.delete(key);
    console.error("shipped image", key, err);
    toast(`Could not open ${key} — ${err.message || err}`, { kind: "error" });
    return null;
  }
}

/** The one door every target goes through: resolve whatever `asset:<key>`
    needs before it can draw, whether that is a GLB, a shipped plate or
    something already in memory. */
function ensureTarget(key) {
  if (key === DEFAULT_PLATE.key) return ensureDefaultPlate();
  if (SHIPPED_IMAGES.some((d) => d.key === key)) return ensureShippedImage(key);
  return ensureAsset(key);
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
  if (r.kind === "asset") ensureTarget(r.key);
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
    h("b", {}, cur ? cur.label : "Loading…"),
    h("span", {}, `${comp.width} × ${comp.height}`),
  );
}

/* A window drag fires resize dozens of times a second, and each call resizes
   the renderer, both render targets and the occlusion pass — a full GPU
   reallocation per event. Coalescing to one per frame makes a drag cost one
   reallocation per painted frame instead of one per event. */
let resizePending = false;
window.addEventListener("resize", () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; layout(); });
});

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
  syncResetChip();
  renderFrame(sceneTime(clock), phase, dt);
}

const EXPORT_KEY = isMac ? "⌘E" : "Ctrl E";
let exportBtnRef = null;

// ================= panel =========================================================
//
// Visual makes a braille or block picture and exports it. The panel is ordered
// by that job, not by the engine underneath it:
//
//   Source    what is being drawn, and how to change it
//   Look      the marks themselves — the controls you reach for constantly
//   Adjust    the source's own parameters, closed by default
//   Canvas    output size and colour
//   3D        only when the source is a model, and only then
//   Export    pinned at the bottom, always in reach
//
// 3D is a capability that serves the export. It is not the organising idea, so
// it does not get a permanent seat.

const SHORTCUTS = [
  { title: "Export", keys: [[EXPORT_KEY, "Export"], [`⇧ ${EXPORT_KEY}`, "Next format"]] },
  { title: "Source", keys: [["S", "Change source"], ["O", "Open image"]] },
  { title: "View", keys: [["R", "Reset view"], ["H", "Hide panels"]] },
  { title: "Help", keys: [["?", "Shortcuts"]] },
];

const panel = document.getElementById("vpanel");
panel.id = "vpanel";
panel.tabIndex = -1;
document.body.prepend(skipLink("vpanel", "Skip to controls"));
panel.append(appNav("visual", SHORTCUTS));
const panelMain = h("div", { class: "v-panel-main" });
const panelBody = h("div", { class: "panel-body" });
const panelFoot = h("div", { class: "panel-foot" });
panelMain.append(panelBody, panelFoot);
panel.append(panelMain);

function commit(relayout) { saveConfig(); if (relayout) layout(); }

const sceneNum = (key, o, relayout = false) => NumberField({
  get: () => config.scene[key],
  set: (v) => { config.scene[key] = v; commit(relayout); }, ...o });
const sceneColor = (key, label) => ColorField({
  label,
  get: () => config.scene[key],
  set: (v) => { config.scene[key] = v; commit(false); } });
const compNum = (key, o) => NumberField({
  get: () => config.comp[key],
  set: (v) => { config.comp[key] = Math.round(v); commit(true); }, ...o });

// ---- the source picker ----------------------------------------------------------
//
// Three kinds of source lived in one flat list of about a hundred entries, with
// images — what this mode is for — as two of them. They are grouped and
// filterable now, and images lead.

const KINDS = [
  { id: "image", heading: "Images", icon: "image" },
  { id: "model", heading: "3D models", icon: "box" },
  { id: "anim", heading: "Animations", icon: "wave" },
];

function sourceEntries() {
  return [
    ...imports.map((i) => ({ kind: "image", value: `asset:${i.key}`, label: i.label })),
    ...ASSET_DEFS.map((d) => ({ kind: "model", value: `asset:${d.key}`, label: d.label })),
    ...MODES.map((m) => ({ kind: "anim", value: `mode:${m.key}`, label: m.label })),
  ];
}

function currentSource() {
  return sourceEntries().find((e) => e.value === config.target) || null;
}

function sourceKind() {
  return currentSource()?.kind ?? "image";
}

function openSourceMenu(anchor) {
  const entries = sourceEntries();
  const items = [];
  for (const k of KINDS) {
    const group = entries.filter((e) => e.kind === k.id);
    if (!group.length) continue;
    if (k.id === "anim") {
      // the animations carry families in their own names — 25 zooms, 24 stars
      // — so the picker shows them as families rather than as 87 near-identical
      // rows
      for (const fam of modeFamilies()) {
        items.push({ heading: `Animations · ${fam.name}` });
        for (const m of fam.modes) items.push(sourceItem(`mode:${m.key}`, m.label, m.tag));
      }
      continue;
    }
    items.push({ heading: k.heading });
    for (const e of group) items.push(sourceItem(e.value, e.label));
  }
  showMenu(items, anchor, {
    search: true,
    placeholder: "Find a source",
    minWidth: Math.max(220, anchor.getBoundingClientRect().width),
  });
}

function sourceItem(value, label, sub) {
  return {
    label,
    sub,
    checked: value === config.target,
    action: () => { setTarget(value); buildPanel(); },
  };
}

/** The current source, as a button that opens the picker. */
function sourceButton() {
  const cur = currentSource();
  const kind = KINDS.find((k) => k.id === (cur?.kind ?? "image"));
  const btn = h("button", {
    class: "source-btn", type: "button",
    "aria-haspopup": "menu", "aria-expanded": "false",
    "aria-label": `Source: ${cur ? cur.label : "loading"}`,
  },
    icon(kind.icon, "source-kind"),
    h("span", { class: "source-name" }, cur ? cur.label : "Loading…"),
    icon("chevronDown", "source-chev"));
  btn.addEventListener("click", () => openSourceMenu(btn));
  return btn;
}

// ---- panel ------------------------------------------------------------------------

function buildPanel() {
  // Several controls rebuild the whole panel — the style switch, the canvas
  // ratio, changing source. Losing the scroll position on each one throws the
  // reader back to the top of a panel they were working halfway down.
  const scroll = panelBody.scrollTop;
  panelBody.textContent = "";
  panelFoot.textContent = "";
  panelBody.append(...sourceSection(), ...lookSection(), adjustSection(),
    ...canvasSection(), ...spatialSection());
  panelFoot.append(...exportFoot());
  panelBody.scrollTop = scroll;
}

function sourceSection() {
  return [section("Source", [
    h("div", { class: "source-row" }, sourceButton()),
    h("div", { class: "btn-row" },
      button("Open image", {
        iconName: "image", variant: "subtle", wide: true,
        title: "PNG, JPG or SVG",
        onClick: () => pickFile(".svg,.png,.jpg,.jpeg"),
      }),
      button("Import model", {
        iconName: "box", variant: "subtle", wide: true,
        title: "GLB or glTF, for this session",
        onClick: () => pickFile(".glb,.gltf"),
      })),
  ], { id: "v-source" })];
}

/** The controls that change what the marks look like — the ones reached for
    constantly. Everything here is one level deep, no nesting. */
function lookSection() {
  return [section("Look", [
    row("Style", styleField()),
    row("Grid", SegmentedField({
      label: "Grid",
      get: () => gridPreset(),
      set: (v) => {
        const [w, hgt] = GRID_PRESETS[v].cell;
        config.scene.cellW = w;
        config.scene.cellH = hgt;
        commit(true);
        buildPanel();
      },
      options: GRID_PRESETS.map((p, i) => ({
        value: i, label: p.label, tip: `${p.cell[0]} × ${p.cell[1]} px cells`,
      })),
    })),
    grid2(
      sceneNum("cellW", { min: 4, max: 40, step: 1, prefix: { text: "W", tip: "Cell width" } }, true),
      sceneNum("cellH", { min: 8, max: 64, step: 1, prefix: { text: "H", tip: "Cell height" } }, true),
    ),
    grid2(sceneColor("bg", "Background"), sceneColor("ink", "Ink")),
    grid2(
      sceneNum("dotR", { min: 0.4, max: 1.6, step: 0.02, prefix: { text: "dot", tip: "Dot size" } }),
      sceneNum("dotThresh", { min: 0.01, max: 0.35, step: 0.005, prefix: { text: "thresh", tip: "Light a dot needs before it prints" } }),
    ),
    grid2(
      sceneNum("gain", { min: 0.3, max: 3, step: 0.05, prefix: { text: "exposure", tip: "Overall brightness" } }),
      sceneNum("baseSize", { min: 0.006, max: 0.06, step: 0.001, prefix: { text: "mark", tip: "Size of each underlying mark" } }),
    ),
    ...(config.scene.blocks ? [grid2(
      sceneNum("blockLo", { min: 0.15, max: 6, step: 0.05, prefix: { text: "block lo", tip: "Energy where a cell starts to solidify" } }),
      sceneNum("blockHi", { min: 0.4, max: 6.5, step: 0.05, prefix: { text: "block hi", tip: "Energy that prints a full solid block" } }),
    )] : []),
    grid2(
      sceneNum("gapX", { min: 0, max: 0.25, step: 0.005, prefix: { text: "seam x", tip: "Gap between columns" } }),
      sceneNum("gapY", { min: 0, max: 0.25, step: 0.005, prefix: { text: "seam y", tip: "Gap between rows" } }),
    ),
  ], { id: "v-look" })];
}

const GRID_PRESETS = [
  { label: "Fine", cell: [6, 12] },
  { label: "Default", cell: [8, 16] },
  { label: "Coarse", cell: [12, 24] },
];

/** Which preset the current cell size matches, or -1 for a custom size — the
    segmented control then shows nothing selected, which is the truth. */
function gridPreset() {
  return GRID_PRESETS.findIndex(
    (p) => p.cell[0] === config.scene.cellW && p.cell[1] === config.scene.cellH);
}

/** The source's own parameters. Closed by default: they belong to whatever is
    loaded, they change wholesale when the source does, and most sessions never
    touch them. */
function adjustSection() {
  const base = baseModeFor(clipForTarget(config.target));
  const kids = [];
  let overrides = 0;

  if (!base) {
    kids.push(h("div", { class: "loading-row" }, icon("spinner", "spin"), "Sampling…"));
  } else {
    const t = config.target;
    if (!config.params[t]) config.params[t] = {};
    const P = config.params[t];
    const cells = Object.entries(base.params).map(([key, spec]) => {
      const f = NumberField({
        get: () => (P[key] !== undefined ? P[key] : spec.value),
        set: (v) => { P[key] = v; mark(); saveConfig(); },
        min: spec.min, max: spec.max, step: spec.step,
        prefix: { text: key, tip: `${key} — double-click to reset` },
      });
      const prefixEl = f.el.querySelector(".field-prefix");
      const mark = () => prefixEl?.classList.add("overridden");
      if (P[key] !== undefined) { mark(); overrides++; }
      // Resetting one value was right-click only, which nothing announced.
      // Double-click is the discoverable gesture and the tooltip says so.
      const reset = () => {
        if (P[key] === undefined) return;
        delete P[key];
        saveConfig();
        f.refresh();
        prefixEl?.classList.remove("overridden");
        buildPanel();
      };
      f.el.addEventListener("dblclick", reset);
      f.el.addEventListener("contextmenu", (e) => { e.preventDefault(); reset(); });
      return f;
    });
    for (let k = 0; k < cells.length; k += 2) kids.push(grid2(cells[k], cells[k + 1] ?? null));
    if (!cells.length) {
      kids.push(h("div", { class: "state compact" },
        icon("sliders"), h("p", {}, "Nothing to adjust")));
    }
  }

  const actions = [];
  if (overrides) {
    const resetBtn = h("button", { class: "section-link", type: "button" }, "Reset");
    resetBtn.addEventListener("click", async () => {
      const yes = await confirmAction({
        title: "Reset parameters?",
        body: `${overrides} changed value${overrides > 1 ? "s" : ""} will go back to the source's defaults.`,
        confirmLabel: "Reset",
      });
      if (!yes) return;
      config.params[config.target] = {};
      saveConfig();
      buildPanel();
    });
    actions.push(resetBtn);
  }
  return section("Adjust", kids, { id: "v-adjust", collapsed: true, actions });
}

// Ratios rather than words: "Square / Portrait / Landscape" does not fit the
// field column at any panel width, and a ratio is the more precise label
// anyway — it says what you get.
const CANVAS_PRESETS = [
  { label: "1:1", w: 1080, h: 1080, tip: "Square — 1080 × 1080" },
  { label: "9:16", w: 1080, h: 1920, tip: "Portrait — 1080 × 1920" },
  { label: "16:9", w: 1920, h: 1080, tip: "Landscape — 1920 × 1080" },
];

function canvasSection() {
  return [section("Canvas", [
    // a segmented control, not three buttons: it has to SAY which shape the
    // canvas currently is, and buttons cannot
    row("Shape", SegmentedField({
      label: "Canvas shape",
      get: () => CANVAS_PRESETS.findIndex(
        (p) => p.w === config.comp.width && p.h === config.comp.height),
      set: (v) => {
        config.comp.width = CANVAS_PRESETS[v].w;
        config.comp.height = CANVAS_PRESETS[v].h;
        commit(true);
        buildPanel();
      },
      options: CANVAS_PRESETS.map((p, i) => ({ value: i, label: p.label, tip: p.tip })),
    })),
    grid2(
      compNum("width", { min: 128, max: 4096, step: 2, prefix: { text: "W", tip: "Width in pixels" } }),
      compNum("height", { min: 128, max: 4096, step: 2, prefix: { text: "H", tip: "Height in pixels" } }),
    ),
  ], { id: "v-canvas" })];
}

/** Camera. Always present — any source can be orbited, so any source can need
    its view back — but the depth controls belong to models, where they do
    something. Collapsed: most sessions never open it. */
function spatialSection() {
  const model = sourceKind() === "model";
  return [section("Camera", [
    grid2(
      sceneNum("fov", { min: 15, max: 100, step: 1, unit: "\u00b0", prefix: { text: "lens", tip: "Field of view" } }),
      null,
    ),
    ...(model ? [grid2(
      sceneNum("solidity", { min: 0, max: 1, step: 0.01, prefix: { text: "solid", tip: "How much a model hides its own far side" } }),
      sceneNum("occBias", { min: 0.01, max: 0.3, step: 0.005, prefix: { text: "bias", tip: "Slack before a mark counts as hidden" } }),
    )] : []),
    h("div", { class: "btn-row" },
      button("Reset view", {
        iconName: "fit", variant: "subtle", wide: true,
        title: "Front-on, recentred \u2014 R", onClick: resetView,
      })),
  ], { id: "v-camera", collapsed: true })];
}

// ---- export ------------------------------------------------------------------------

const FORMATS = [
  { value: "png", label: "PNG", ext: "png", what: "Raster at exact canvas pixels" },
  { value: "svg", label: "SVG", ext: "svg", what: "One shape per dot and block" },
  { value: "stl", label: "STL", ext: "stl", what: "Relief solid, for print or CAD" },
  { value: "obj", label: "OBJ", ext: "obj", what: "Relief solid, as text geometry" },
];

const fmt = () => FORMATS.find((f) => f.value === config.export.format) || FORMATS[0];
const is3D = () => fmt().value === "stl" || fmt().value === "obj";

/** The one primary action on this surface, pinned so it is never scrolled
    past, with a quiet line saying exactly what the file will be. */
function exportFoot() {
  const meta = h("div", { class: "foot-meta" });
  const refreshMeta = () => {
    meta.textContent = "";
    const f = fmt();
    const { width: W, height: H } = config.comp;
    if (f.value === "png") {
      const s = config.export.scale || 1;
      meta.append(h("span", {}, `${W * s} × ${H * s} px`), h("span", {}, f.what));
    } else if (f.value === "svg") {
      meta.append(h("span", {}, `${W} × ${H}`), h("span", {}, f.what));
    } else {
      const mm = Math.round(100 * (H / W));
      meta.append(h("span", {}, `100 × ${mm} × ${(config.export.depth + config.export.baseDepth).toFixed(1)} mm`),
        h("span", {}, f.what));
    }
  };

  const opts = h("div", { class: "foot-opts" });
  const refreshOpts = () => {
    opts.textContent = "";
    const f = fmt();
    if (f.value === "png") {
      opts.append(
        row("Scale", SelectField({
          label: "Export scale",
          get: () => config.export.scale,
          set: (v) => { config.export.scale = v; commit(false); refreshMeta(); },
          options: [1, 2, 3, 4].map((s) => ({ value: s, label: `×${s}` })),
        })),
        row("Transparent", SwitchField({
          label: "Transparent background",
          get: () => !!config.export.transparent,
          set: (v) => { config.export.transparent = v; commit(false); },
        })));
    } else if (f.value === "svg") {
      opts.append(row("Transparent", SwitchField({
        label: "Transparent background",
        get: () => !!config.export.transparent,
        set: (v) => { config.export.transparent = v; commit(false); },
      })));
    } else {
      opts.append(
        row("Relief", NumberField({
          label: "Relief depth in millimetres",
          get: () => config.export.depth,
          set: (v) => { config.export.depth = v; commit(false); refreshMeta(); },
          min: 0.2, max: 20, step: 0.1, unit: " mm",
        })),
        row("Backing", SwitchField({
          label: "Backing plate",
          get: () => !!config.export.base,
          set: (v) => { config.export.base = v; commit(false); refreshMeta(); },
        }), { tipText: "A flat tile behind the marks, so the file is one solid" }));
    }
  };

  const exportBtn = button("Export", {
    variant: "primary", wide: true, iconName: "download",
    onClick: () => runExport(),
  });
  exportBtn.classList.add("large");

  const formatField = SelectField({
    label: "Export format",
    get: () => config.export.format,
    set: (v) => {
      config.export.format = v;
      commit(false);
      refreshOpts();
      refreshMeta();
      syncExportLabel();
    },
    options: FORMATS.map((f) => ({ value: f.value, label: f.label })),
  });

  const syncExportLabel = () => {
    exportBtn.querySelector(".btn-label").textContent = `Export ${fmt().label}`;
  };

  refreshOpts();
  refreshMeta();
  syncExportLabel();
  exportBtnRef = exportBtn;

  return [
    row("Format", formatField),
    opts,
    h("div", { class: "foot-cta" }, exportBtn, h("span", { class: "kbd" }, EXPORT_KEY)),
    meta,
  ];
}

function stillName(ext) {
  const cur = currentSource();
  const slug = (cur?.label || "visual").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `tempo-${slug}.${ext}`;
}

/** Every export runs through here so the busy state, the error state and the
    naming are identical whichever format is chosen. */
async function runExport() {
  if (exportBtnRef?.disabled) return;
  const f = fmt();
  const busy = toast(`Exporting ${f.label}…`, { kind: "busy", duration: 0 });
  if (exportBtnRef) exportBtnRef.disabled = true;
  try {
    if (f.value === "png") {
      const blob = await pngBlob();
      const s = config.export.scale || 1;
      download(blob, stillName("png"));
      busy.dismiss();
      toast(`PNG exported — ${config.comp.width * s} × ${config.comp.height * s}`);
    } else if (f.value === "svg") {
      download(new Blob([svgText()], { type: "image/svg+xml" }), stillName("svg"));
      busy.dismiss();
      toast("SVG exported — real vector dots and blocks");
    } else {
      const { blob, relief } = meshExport(f.value);
      download(blob, stillName(f.ext));
      busy.dismiss();
      toast(`${f.label} exported — ${relief.triangles.toLocaleString()} triangles`);
    }
  } catch (err) {
    console.error(err);
    busy.dismiss();
    toast(`${f.label} export failed — ${err.message || err}`, { kind: "error", duration: 5000 });
  } finally {
    if (exportBtnRef) exportBtnRef.disabled = false;
  }
}

/** Render the comp at exact export pixels and read the canvas back. Restores
    the viewport sizing whatever happens, so a failed export never leaves the
    stage at 4x with the controls disabled. */
function pngBlob() {
  const { width: W, height: H } = config.comp;
  const s = config.export.scale || 1;
  const scn = config.scene;
  controls.enabled = false;
  try {
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

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas gave no data"))),
        "image/png");
    });
  } finally {
    terminal.glyph.mat.uniforms.uBgAlpha.value = 1;
    controls.enabled = true;
    layout();
  }
}

/** Both vector exports read back the glyph pass's sub-pixel buffer, so that
    buffer has to hold the CURRENT picture. Drawing one frame first makes the
    export independent of where the animation loop happens to be — without it
    an export fired right after a resize reads a buffer that has been resized
    but not yet drawn into, and writes an almost empty file. */
function refreshBuffer() {
  const phase = anim
    ? Math.min(1, (clock - anim.start) / Math.max(1e-3, VISUAL_TRANS.duration))
    : 1;
  renderFrame(sceneTime(clock), phase, 0);
}

function svgText() {
  refreshBuffer();
  return exportSVG({
    renderer, terminal, scene: { ...config.scene }, comp: config.comp,
    transparent: config.export.transparent,
  });
}

function meshExport(format) {
  refreshBuffer();
  return exportMesh({
    renderer, terminal, scene: { ...config.scene }, comp: config.comp,
    depth: config.export.depth, base: !!config.export.base,
    baseDepth: config.export.baseDepth,
  }, format);
}

/** The house style, as a two-way segmented control. Either side restores the
    clean-braille look; the difference between them is whether hot cells are
    allowed to solidify into blocks. It resets the LOOK — canvas size, colours
    and camera are the piece's own and survive. */
function styleField() {
  return SegmentedField({
    label: "Style",
    get: () => (config.scene.blocks ? 1 : 0),
    set: async (v) => {
      // This RESETS the look, so it asks when there is tuning to lose. Without
      // the question it is a destructive action wearing a view toggle's
      // clothes — you press it to see the other side and your session is gone.
      if (tunedAwayFromHouse()) {
        const yes = await confirmAction({
          title: "Reset the look?",
          body: "Your tuning goes back to the house defaults. Canvas, colours "
            + "and camera are kept.",
          confirmLabel: "Reset",
        });
        if (!yes) { buildPanel(); return; }
      }
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
      { value: 0, label: "Braille", tip: "Dots only, nothing solidifies" },
      { value: 1, label: "Blocks", tip: "Hot cells print solid blocks" },
    ],
  });
}

/** True when the scene has drifted from the house defaults on anything the
    style switch would overwrite. Colours, canvas and camera are excluded —
    the switch keeps those. */
function tunedAwayFromHouse() {
  const house = cleanBrailleScene();
  return Object.keys(house).some((k) => {
    if (k === "blocks") return false;
    return config.scene[k] !== house[k];
  });
}

const HOME = new THREE.Vector3(0, 0, 3.55);

function resetView() {
  camera.position.copy(HOME);
  controls.target.set(0, 0, 0);
  controls.update();
}

/* Dragging the canvas orbits, and nothing said so or offered a way back
   except a button inside a collapsed section. This chip appears on the stage
   only once the view HAS moved — the affordance shows up exactly when it
   means something, and disappears when it does not. */
const resetChip = button("Reset view", {
  iconName: "fit", variant: "subtle",
  title: "Front-on, recentred \u2014 R",
  onClick: () => { resetView(); syncResetChip(); },
});
resetChip.classList.add("stage-chip");
resetChip.hidden = true;
stage.append(resetChip);

function syncResetChip() {
  const moved = camera.position.distanceTo(HOME) > 0.02
    || controls.target.lengthSq() > 4e-4;
  if (resetChip.hidden === !moved) return;      // no DOM write unless it flips
  resetChip.hidden = !moved;
}

// ---- keyboard ----------------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  const mod = modKey(e);

  if (mod && e.code === "KeyE") {
    e.preventDefault();
    if (e.shiftKey) cycleFormat();
    else runExport();
  } else if (!mod && e.key === "?") {
    e.preventDefault();
    showShortcuts(SHORTCUTS);
  } else if (!mod && e.code === "KeyR") {
    resetView();
  } else if (!mod && e.code === "KeyH") {
    document.body.classList.toggle("ui-hidden");
    layout();
  } else if (!mod && e.code === "KeyS") {
    e.preventDefault();
    panel.querySelector(".source-btn")?.click();
  } else if (!mod && e.code === "KeyO") {
    e.preventDefault();
    pickFile(".svg,.png,.jpg,.jpeg");
  }
});

function cycleFormat() {
  const i = FORMATS.findIndex((f) => f.value === config.export.format);
  config.export.format = FORMATS[(i + 1) % FORMATS.length].value;
  commit(false);
  buildPanel();
  toast(`Export format: ${fmt().label}`, { duration: 1400 });
}

// ---- file input / drop --------------------------------------------------------

const fileInput = document.getElementById("file");

/** One input, two doors. Narrowing `accept` is the whole difference between
    "Open image" and "Import model" — without it they were the same button
    twice. */
function pickFile(accept) {
  fileInput.accept = accept;
  fileInput.click();
}
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
  setTarget, buildPanel,
  // move the camera off home without synthesising a drag
  orbitTo: (x, y) => { camera.position.set(x, y, 3.2); controls.update(); },
  save: () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {} },
  // export hooks, so the suite validates the same bytes a user downloads
  pngBlob,
  svg: svgText,
  meshBlob: (format = "stl") => meshExport(format).blob,
  exportPNG: () => { config.export.format = "png"; return runExport(); },
  // deterministic frame — rAF-independent, for tests and scripted stills
  renderAt: (T) => { anim = null; clock = T; last = performance.now() / 1000;
    renderFrame(sceneTime(T), 1, 0); },
};

// Boot fetches exactly what the first frame needs. Everything else — every
// GLB in the catalogue, every shipped plate — arrives when it is chosen.
ensureDefaultPlate();          // the plate this mode opens on
registerShippedImages();       // named in the picker, fetched on demand
{
  const r = parseTarget(config.target);
  if (r.kind === "asset" && r.key !== DEFAULT_PLATE.key) ensureTarget(r.key);
}

buildPanel();
layout();
frame();
