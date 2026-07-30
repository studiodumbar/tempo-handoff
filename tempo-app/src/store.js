// The project store — one plain-object project, a tiny event bus, an undo
// stack of whole-project snapshots (projects are small; snapshotting whole is
// simpler and safer than op inversion), and a debounced localStorage autosave.
//
// Everything the timeline, inspector and exporter read lives in `project`.
// Mutations go through `mutate(fn, label)` so undo + autosave + change events
// stay automatic. Transient UI state (selection, playhead, zoom) lives in
// `session` and is NOT undoable or persisted.

import { MODE_BY_KEY } from "./modes.js";

const STORAGE_KEY = "hatchfusion.project.v1";

let _id = Math.floor(Date.now() % 1e7);
export const uid = () => `id${(_id++).toString(36)}`;

// ---- defaults ---------------------------------------------------------------

// dry, mechanical flights by default — dots travel straight and print in
// row order, the way a terminal redraws. Smoke and swirl are opt-in.
export function defaultTransition() {
  return {
    duration: 0.9,
    ease: 0,            // index into EASE_NAMES (expoInOut — hold·snap·hold)
    staggerAxis: 1,     // sweep y: rows print top to bottom
    spread: 0.7,
    path: 0,            // linear
    pathAmp: 0,
    scatter: 0,
    swirl: 0,
    // the mosaic (stagger "blocks" / "blocks out"): tile grid + pattern
    blockOrder: 0,      // schedule: 0 staircase · 1 type · 2 serpent · 3 spiral · 4 scatter
    blocksX: 6,         // columns
    blocksY: 0,         // rows — 0 follows the target's shape
    blockLag: 1.7,      // staircase randomness: rows a tile may trail
    blockSeed: 0,       // re-rolls the pattern
    printStyle: 0,      // draw the blocks themselves: 0 none · 1 fill · 2 stroke
    printTrail: 0.35,   // phase a printed block lingers before dissolving away
    // the WHIP: rotation ramps up hard into this cut and back down after —
    // WHOLE extra turns through the transition (whole, so the banked
    // rotation is invisible downstream), and the seconds of spin-up
    // before / spin-down after the morph window
    whip: 0,
    whipRamp: 0.45,
    whipSoft: 0,     // 0 = the expo snap, 1 = the same turn as a smooth glide
  };
}

export function makeClip(kind, key, label) {
  return {
    id: uid(),
    kind,               // 'mode' | 'asset'
    key,                // mode key or asset key
    label,
    hold: 1.6,
    delay: 0,           // first-clip only: empty space before the sequence begins
    intro: 0,           // first-clip only: index into INTRO_STYLES (0 = none)
    outro: 0,           // last-clip only: exit style, same vocabulary as intro
    trans: defaultTransition(),
    outroTrans: defaultTransition(),   // the exit flight's own controls
    params: {},         // overrides on the target's defaults
  };
}

/** THE HOUSE STYLE — fine, organised, clean braille.
 *
 * Everything that adds noise is off: no dither, no flicker, no phosphor
 * trails, no ink quantisation, continuous time. Everything that adds order is
 * on: dots snap to the character grid, and the glyph ink-box keeps the seam a
 * real terminal shows between characters. The grid is a fine 8 × 16 rather
 * than the old 12 × 24, so a figure is drawn in many small marks instead of a
 * few chunky ones, and the marks themselves are small with a hard threshold —
 * a dot either prints or it does not, which is what keeps it crisp rather than
 * smudged. Blocks stay available but sit behind a high threshold, so only
 * cells a mode is genuinely spotlighting solidify and the base reads as
 * braille.
 *
 * This is both the default for new work and the thing to fall back to: the
 * Visual app's Scene tab has a "Clean braille" button that restores it.
 */
export function cleanBrailleScene() {
  return {
    terminal: true,
    phosphor: false,
    persist: 0.05,
    cellW: 8,
    cellH: 16,
    // the glyph ink-box inset — the seam a real terminal shows between
    // characters; blocks and dots both live inside it
    gapX: 0.08,
    gapY: 0.16,
    dotR: 0.52,
    dotThresh: 0.32,   // hard threshold: a dot prints or it does not
    dither: 0,         // tone as coverage, never as noise
    blocks: 1,
    blockLo: 2.8,      // only genuinely hot cells solidify…
    blockHi: 3.1,      // …and they have to work for a full block
    shade: 0,
    gain: 0.45,
    baseSize: 0.010,   // small marks, so the grid does the drawing
    solidity: 0.30,
    occBias: 0.010,
    fov: 40,
    stepFps: 0,        // continuous; step rates are opt-in
    gridLock: true,    // dots live ON the character grid
    inkLevels: 0,      // smooth ink
    flicker: 0,
  };
}

export function defaultProject() {
  return {
    version: 1,
    name: "Untitled",
    comp: { width: 1080, height: 1080, fps: 60, bg: "#000000", ink: "#ffffff" },
    scene: cleanBrailleScene(),
    clips: [],
    // the photo lane: free-positioned photographs drawn OVER the particle
    // track — { id, key, label, start, dur, fadeIn, fadeOut, alpha }
    photos: [],
    camera: { follow: true, kfs: [] },
    export: { format: "mp4", fps: 0, start: 0, end: 0, quality: 0.7, scale: 1 },
    // fps 0 → follow comp; end 0 → full length; scale N → render at N× the
    // comp size (same braille grid, sharper raster + photograph)
  };
}

/** Fill any keys a project from an older schema is missing. */
export function normalizeProject(p) {
  const d = defaultProject();
  p.comp = { ...d.comp, ...p.comp };
  p.scene = { ...d.scene, ...p.scene };
  // scenes saved under the pre-mosaic house thresholds (lo 2 / hi 4) get the
  // tuned quadrant-era values — untouched pairs only, custom tuning is kept
  if (p.scene.blockLo === 2.0 && p.scene.blockHi === 4.0) {
    p.scene.blockLo = d.scene.blockLo;
    p.scene.blockHi = d.scene.blockHi;
  }
  p.camera = { ...d.camera, ...p.camera };
  p.export = { ...d.export, ...p.export };
  if (!Array.isArray(p.clips)) p.clips = [];
  if (!Array.isArray(p.photos)) p.photos = [];
  for (const ph of p.photos) {
    ph.fadeIn = ph.fadeIn ?? 0.4;
    ph.fadeOut = ph.fadeOut ?? 0.4;
    ph.alpha = ph.alpha ?? 1;
    ph.reveal = ph.reveal ?? 0;
    ph.order = ph.order ?? 0;
    ph.cols = ph.cols ?? 16;
    ph.vary = ph.vary ?? 1.7;
    ph.seed = ph.seed ?? 0;
  }

  // the wordmark/type workspace is gone — drop legacy type clips so old
  // projects load cleanly with the clips that still exist
  p.clips = p.clips.filter((c) => c.kind !== "type")
    .filter((c) => c.kind !== "mode" || MODE_BY_KEY[c.key]);
  for (const c of p.clips) {
    if (c.intro === undefined) c.intro = 0;
    if (c.delay === undefined) c.delay = 0;
    if (c.outro === undefined) c.outro = 0;
    c.outroTrans = { ...defaultTransition(), ...(c.outroTrans || {}) };
  }
  for (const c of p.clips) c.trans = { ...defaultTransition(), ...c.trans };
  delete p.type;
  return p;
}

// ---- the store --------------------------------------------------------------

class Store {
  constructor() {
    this.project = defaultProject();
    this.session = {
      time: 0,              // playhead, seconds
      playing: false,
      loop: true,
      selection: null,      // {type:'clip'|'kf', id} | null
      zoomFit: true,        // comp zoom fits the viewport
      zoom: 1,
      pxPerSec: 90,         // timeline scale
      tlFit: true,          // timeline auto-fits its width
      uiHidden: false,
      exporting: false,
      debugTiles: false,    // viewport overlay of the mosaic reveal grid
    };
    this._subs = new Map();     // topic -> Set<fn>
    this._undo = [];
    this._redo = [];
    this._saveTimer = 0;
  }

  on(topic, fn) {
    if (!this._subs.has(topic)) this._subs.set(topic, new Set());
    this._subs.get(topic).add(fn);
    return () => this._subs.get(topic).delete(fn);
  }

  emit(topic, payload) {
    for (const t of [topic, "*"]) {
      const set = this._subs.get(t);
      if (set) for (const fn of [...set]) fn(payload, topic);
    }
  }

  /** Project mutation with undo + autosave. `fn` edits this.project in place.
      Pass coalesce=<key> to fold rapid edits (e.g. a value drag) into ONE
      undo entry — the snapshot is taken only when the key changes. */
  mutate(fn, { topic = "project", coalesce = null } = {}) {
    if (coalesce == null || coalesce !== this._coalesceKey) {
      this._undo.push(JSON.stringify(this.project));
      if (this._undo.length > 60) this._undo.shift();
      this._redo.length = 0;
    }
    this._coalesceKey = coalesce;
    fn(this.project);
    this.emit(topic);
    this._scheduleSave();
  }

  /** End a coalescing run (pointer released) so the next edit snapshots. */
  endCoalesce() {
    this._coalesceKey = null;
  }

  undo() {
    if (!this._undo.length) return false;
    this._redo.push(JSON.stringify(this.project));
    this.project = JSON.parse(this._undo.pop());
    this._coalesceKey = null;
    this.emit("project");
    this.emit("history");
    this._scheduleSave();
    return true;
  }

  redo() {
    if (!this._redo.length) return false;
    this._undo.push(JSON.stringify(this.project));
    this.project = JSON.parse(this._redo.pop());
    this._coalesceKey = null;
    this.emit("project");
    this.emit("history");
    this._scheduleSave();
    return true;
  }

  replaceProject(p) {
    this._undo.push(JSON.stringify(this.project));
    this._redo.length = 0;
    this.project = p;
    this.session.selection = null;
    this.session.time = 0;
    this.emit("project");
    this._scheduleSave();
  }

  // ---- session (transient) ----
  set(patch, topic = "session") {
    Object.assign(this.session, patch);
    this.emit(topic);
  }

  select(sel) {
    const cur = this.session.selection;
    if (cur === sel || (cur && sel && cur.type === sel.type && cur.id === sel.id)) return;
    this.session.selection = sel;
    this.emit("selection");
  }

  selectedClip() {
    const s = this.session.selection;
    if (!s || s.type !== "clip") return null;
    return this.project.clips.find((c) => c.id === s.id) || null;
  }

  selectedKf() {
    const s = this.session.selection;
    if (!s || s.type !== "kf") return null;
    return this.project.camera.kfs.find((k) => k.id === s.id) || null;
  }

  // ---- persistence ----
  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
      } catch {}
    }, 400);
  }

  loadAutosave() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const p = JSON.parse(raw);
      if (p && p.version === 1 && Array.isArray(p.clips)) {
        this.project = normalizeProject(p);
        return true;
      }
    } catch {}
    return false;
  }

  clearAutosave() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export const store = new Store();
