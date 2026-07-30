# AUDIT — TEMPO, as found

Written against commit `e4a480d` before any product code changed. Sources: the
full `src/` tree, `styles.css`, the three HTML entry points, baseline
screenshots at 1440 / 1024 / 768 (`shots/baseline/`), a Playwright interaction
probe, and `tools/perf.mjs`.

---

## 1. The surfaces

The app ships three pages that share one CSS skin, one particle engine and one
glyph rasteriser. There is no router; each is a separate document.

### Visual — `index.html` → `src/visual.js` (29 kB)

**Job:** place one target, tune it, export a still.
**Actual density:** one canvas, and a single right panel holding **7 sections,
44 controls, 5 prose paragraphs and 2 export buttons** in one unbroken scroll.
Nothing is grouped by task; "Source", "Parameters", "Canvas", "Grid", "Ink",
"View", "Still" and the export footer all sit at the same level of importance.

**The 3D-editor inheritance is everywhere:**
- The target picker is a single `<select>` mixing three unrelated kinds —
  `image · plate`, `3D · hoodie`, `animation · zoom-quarter-blocks` — in one
  list of **~100 entries**. Images are what the mode is for; they are 2 of 100.
- "View" is a whole section (FOV, reset view, solidity, occlusion bias) that
  exists because the engine is a 3D scene. For an image — the default and
  primary case — every control in it except FOV is inert.
- Orbit-drag is bound to the canvas unconditionally, so dragging an image
  target tilts it in perspective with no affordance saying so and no way back
  except a "Reset view" button three sections down.
- The camera is a `PerspectiveCamera` at fov 42 for what is, for images, a flat
  plate.

**Missing outright:** the brief's third export. Visual exports PNG and SVG. There
is **no 3D export path at all** (`exportStill.js` has `exportSVG` and nothing
else).

### Motion — `editor.html` → `src/main.js` (36 kB)

**Job:** sequence targets on a timeline, keyframe the camera, export MP4/PNG.
**Actual density:** four surfaces at once — left library panel (project header,
timeline mirror, 89 animations, assets), centre stage, right inspector
(3 tabs × up to 7 sections), bottom timeline (ruler, clips lane, photo lane,
camera lane). Roughly **120 interactive elements on screen at 1440**.

This is the most coherent of the three and mostly earns its density. Its
problems are hierarchy and scale, not concept — see §3.

### Sequence — `journey.html` → `src/journey.js` (56 kB)

**Job:** a commerce-state player. **To be removed entirely per the brief.**
Self-contained: nothing outside `journey.html`, `journey.css`, `src/journey.js`
and one `appnav.js` entry references it, so removal is clean.

---

## 2. Ranked findings

Ranked by user impact: how many users hit it, how often, and how much it costs
them when they do.

### P0 — 26 MB downloaded before the app is usable

`src/main.js:973` and `src/visual.js:763` both run, at boot:

```js
if (params.get("preload") !== "0") {
  (async () => { for (const d of ASSET_DEFS) await ensureAsset(d.key); })();
}
```

Every GLB is fetched and sampled at startup whether or not it is ever used.
Measured: **26 367 kB transferred** — `tshirt.glb` 10.7 MB, `cap.glb` 7.1 MB,
`mug.glb` 1.2 MB, plus `longsleeve.png` **fetched twice** (2.7 MB each) because
`ensureShippedImages()` and the default-plate path both request it. Five main-
thread long tasks up to 218 ms while sampling. Heap settles at ~150 MB.

On the deployed site `models/` is `.vercelignore`d, so every one of those
requests 404s — the boot cost is paid in failed round-trips instead.

Highest impact of anything in this audit: it is the entire first impression, it
affects 100% of sessions, and the work is almost entirely wasted.

### P1 — Visual's primary action is below the fold

Export PNG / Export SVG are the last things in a 7-section scroll. At 1440 the
panel shows through "Grid"; the user must scroll past 44 controls to reach the
one action the mode exists for. There is no keyboard shortcut for export on this
surface — Visual binds **no shortcuts at all**.

### P2 — Layout collapses below ~1100px

Panels are `position: fixed` with hard-coded widths (`--left-w: 244px`,
`--right-w: 268px`) and the viewport is inset by those constants. Nothing is
responsive.

- **Motion at 768** (`shots/baseline/motion-768.png`): the library panel and
  inspector overlap the stage; the stage label is occluded by the inspector and
  reads `1080 × 1080 · 60 fps  1…`; the stage renders at 15% in a corner.
- **Visual at 768**: the panel takes 55% of the width, the stage is pushed
  off-centre, and the stage label floats ~200 px above the canvas it labels.
- At 1024 both are cramped but functional.

### P3 — No designed focus states; several controls unreachable by keyboard

Probe results on Visual: 53 interactive elements, and tabbing lands on
**browser-default `outline: 1px auto`** for buttons and **`outline: none`** for
every text input (`styles.css:59-65` clears it globally). `--focus-ring` is
defined but only ever used by `.field:focus-within`.

- `.section-head` is a `<div>` with a click handler (`fields.js:315`) — the
  collapse control for every section on every surface is **not focusable and not
  operable by keyboard**.
- `.color-native` is `opacity: 0; pointer-events: none` but still tabbable — an
  invisible tab stop inside every colour field.
- `NumberField` inputs have no accessible name. The visible label is a
  `<span class="field-prefix">` with no `for`/`aria-labelledby`, so a screen
  reader reads 17 unnamed text boxes on Visual alone.
- `.swatch`, `SwitchField` (`role="switch"`, no name), `SelectField` (no
  `aria-haspopup`/`aria-expanded`) are all unnamed.
- `showMenu` builds `role="menu"` but the items are plain buttons with no
  `role="menuitem"`, and focus is not moved into the menu on open.
- Icon-only controls in Motion's panel header (new / open / save) carry a
  tooltip via `tip()` but **no `aria-label`** — the brief requires both.

### P4 — Explanatory prose in the interface

Ten `.note` paragraphs (6 in Visual, 4 in the inspector) plus one `.empty-hint`
explain controls instead of the controls explaining themselves:

| Where | Copy |
| --- | --- |
| `visual.js:570` | "Images are the default here. The list also holds 3D models and the generative animations — imports last for this session." |
| `visual.js:633` | "Background and ink." |
| `visual.js:637` | "The character cell everything is drawn into. Smaller cells = finer, more detailed marks." |
| `visual.js:666` | "Blocks are switched at the top of the panel. These set where they start." |
| `visual.js:683/689` | "Drag the canvas to orbit. 3D only:" / "Drag the canvas to orbit." |
| `visual.js:713` | "PNG renders the comp at exact pixels. SVG replays the glyph pass as real vectors — a `<rect>` per block, a `<circle>` per dot." |
| `inspector.js:225` | "The first clip opens already settled — add an intro below to animate it in." |
| `inspector.js:492` | "Background · ink." |
| `library.js:47` | "Click a target below to start the sequence." |

Also inconsistent terminology for one concept: **Timeline / Sequence / clips /
targets / Library** are used interchangeably; `library.js:35` labels the clip
list "Timeline" while the file comment and README call it "the SEQUENCE" and the
bottom panel is also called the timeline.

Two colour fields appear with **no labels at all** on both surfaces — the only
hint is a `.note` reading "Background and ink." underneath, which is the
paragraph-instead-of-label failure exactly.

### P5 — Destructive and hidden actions

- **Delete clip** (`⌫`, and the row context menu) removes a clip with **no
  confirmation and no undo affordance in the UI**. Undo exists (`⌘Z`) but is
  never surfaced; there is no menu, no toast, no hint.
- **New project** (`main.js:577`) replaces the whole project. Its only guard is
  a toast that fires *after* the fact: `"New project — ⌘Z restores the old one"`.
- **Reset** in Visual's Parameters section wipes every per-target override with
  no confirm and no undo (Visual has no undo stack at all).
- **Right-click a parameter to clear its override** (`visual.js:597`) is the
  only way to reset a single value and is completely undiscoverable.
- Motion's shortcuts (`space`, `K`, `⌘D`, `⌘S`, `⌘O`, `H`, `⌘0/1/±`) exist only
  in the README. Nothing in the UI reveals them except three `hint` strings in
  one context menu.

### P6 — Flat, unsearchable library of 89 animations

`library.js:174` renders all 89 `MODES` as a flat list with no search, no
grouping and no categories, in a 244 px panel — a scroll of ~2 300 px. Names
like `zoom`, `zoom out`, `zoom quarter`, `zoom spin`, `zoom lean`, `zoom plane`,
`zoom rails`, `zoom marks`, `zoom surge`, `zoom out blocks`, `zoom quarter
blocks` are indistinguishable without trying each one. Every row carries the
same tooltip, "Click to add · drag onto the timeline", so hovering the list
produces one repeated sentence.

### P7 — No design system; magic numbers throughout

`styles.css` defines colour tokens, two easing curves, one radius pair and four
layout widths. It does **not** define spacing, type, elevation or motion
duration. Consequences, counted in `styles.css`:

- **Type sizes**: 9, 10, 11, 12, 13, 16 px hard-coded at 15 sites — no scale.
- **Spacing**: 47 distinct hard-coded padding/gap/margin values.
- **Radius**: `--radius: 12px` and `--radius-s: 6px` exist, yet eleven literal
  radii are used besides them — 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14 px.
- **Durations**: 51 raw `…ms` literals across 100, 120, 130, 140, 150, 160,
  180, 200 and 220 ms; no token.
- **Elevation**: one `--panel-shadow` token against **20** `box-shadow`
  declarations.
- Control heights: 2, 4, 6, 12, 13, 16, 18, 20, 24, 26, 28, 40, 42 px — thirteen
  literal heights for what is really three control sizes plus a few rules.
- Gutters disagree: `.note`/`.prop-row`/`.prop-grid` pad `12px`, `.btn-row`
  pads `12px` but with `2px 12px 4px`, `.section-head` pads
  `11px 10px 9px 12px`, `.lib-title` `6px 12px 4px`. Nothing sits on a grid.

### P8 — `prefers-reduced-motion` is incomplete

`styles.css:1137` zeroes the duration for exactly 7 selectors: `.menu`,
`.toast`, `.export-card`, `.tab-pill`, `.switch .knob`, `.tl-kf`, `.lib-add`.
It misses `.section-body` (the `grid-template-rows` collapse — the largest
motion in the app), `.btn`, `.icon-btn`, `.field`, `.tooltip`, `#drop`,
`.tl-clip`, `.prog-fill`, `.spin` keyframe animation, and every hover
transition. The brief requires reduced motion everywhere with no exceptions.

### P9 — Motion / rendering quality issues

Against the emilkowalski standards:

| Site | Issue |
| --- | --- |
| `.tl-clip:hover { filter: brightness(1.12) }` | Animating `filter` on a hover that fires constantly while working the timeline; not compositor-cheap at timeline scale |
| `.section-body { transition: grid-template-rows 220ms }` | Animating a **layout** property; forbidden by the brief and by the skill |
| `.tab-pill { transition: transform …, width 200ms }` | `width` is a layout property; only `transform` should move the pill |
| `@keyframes spin` | Keyframe animation, un-interruptible; fine here (constant motion) but it ignores reduced motion |
| `.icon-btn`, `.btn` | `transition: background 120ms ease` — correct — but no `:focus-visible` state at all |
| `.toast` enter 220 ms / exit 150 ms | Correct asymmetry; keep |
| `.menu` `scale(0.96)` origin-aware | Correct; keep |
| Hover transitions | None are gated behind `@media (hover: hover)` — touch taps trigger them |
| `.switch:active .knob { transform: scale(0.9) }` | Fights the `translateX(12px)` in the checked state; handled by a second rule, but the pair is fragile |

### P10 — Re-render and listener costs

- `library.js:208-210` rebuilds **the whole clip list DOM** on every `project`
  event. `store.mutate` emits `project` on every coalesced scrub tick, so
  dragging any inspector value re-creates the sequence rows continuously.
- `renderAssets()` likewise rebuilds all asset rows on every library change.
- `window.addEventListener("resize", layout)` on both surfaces is
  **unthrottled**, and `layout()` resizes the renderer, both render targets and
  the occlusion pass — a full GPU reallocation per resize event.
- `visual.js:551 buildPanel()` tears down and rebuilds the entire right panel
  on every target change and every style-switch toggle, discarding all field
  state and scroll position.
- The mosaic tile-debug canvas (`main.js:326`) is created, sized and attached
  on every boot even though it is only drawn when `session.debugTiles` is on.

### P11 — Dead code and orphaned assets

| Item | Size | Status |
| --- | --- | --- |
| `src/shapeModes.js` | 6.6 kB | **No importer** — dead |
| `src/shapes.mjs` | 7.7 kB | Imported only by `shapeModes.js` — dead |
| `vendor/tweakpane.min.js` | 152 kB | **No importer** — dead vendored library |
| `styles.css:128-130` | — | `/* ===== wordmark text field ===== */` heading with no rules under it |
| `visual.js:54-57` | — | `GONE` set migrating six target keys removed in an earlier era |
| `src/journey.js` + `journey.html` + `journey.css` | 62 kB | Sequence — to be removed by the brief |

### P12 — Smaller UI quirks

- Visual's stage label is `position: absolute; top: -22px` relative to the
  stage, so at narrow widths it detaches visually from the canvas (visible at
  768).
- Motion's `.zoom-chip` is positioned with `style.right = "calc(var(--right-w)
  + …)"` set from JS (`main.js:302`) — layout constants leaking into script.
- The app-mode switch sits **inside the right panel** on every page, so the
  product's own navigation is nested inside a properties inspector.
- There is no TEMPO branding anywhere. Page titles are `hatch visual`,
  `hatch motion`, `hatch sequence`; `package.json` is `hatch-fusion`; the
  default project is named "Hatch motion".
- `styleNav`'s two buttons ("Braille" / "Braille + blocks") sit in the chrome
  above every property, implying app-level scope, but they **reset the whole
  scene** to `cleanBrailleScene()` — a destructive action styled as a view
  toggle.
- `.empty-state` exists and is well-formed for the inspector, but Visual has no
  empty state, no loading state beyond one `.note.busy` spinner, and no error
  state — errors surface only as toasts.
- Disabled styling is a blanket `opacity: 0.4` on `button:disabled`; no field or
  row has a designed disabled state.

---

## 3. What drives the session

In order. Each item is a commit with the full gate run against it.

1. **System first** — tokens for spacing, type, radius, elevation, motion;
   `:focus-visible` everywhere; complete `prefers-reduced-motion`; hugeicons
   with labels. (P3, P7, P8, P9)
2. **Remove Sequence** — routes, module, styles, nav entry, dead modules. (P11)
3. **Fix the boot** — lazy asset loading, deduplicate the plate fetch. (P0)
4. **Rebuild Visual around export** — primary action promoted, source picker
   split by kind, 3D-editor controls demoted behind progressive disclosure,
   prose cut. (P1, P4, P12)
5. **Add the 3D export** — the missing third format.
6. **Responsive layout** — panels that survive 768. (P2)
7. **Motion pass** — searchable library, discoverable shortcuts, confirms on
   destructive actions, targeted re-renders. (P5, P6, P10)
8. **Logo** — `TEMPO.svg` inlined into the chrome.
