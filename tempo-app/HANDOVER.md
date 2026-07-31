# HANDOVER

Branch `tempo-polish`, 21 commits off `main`. `main` is untouched at `e4a480d`
— the tree exactly as I found it, committed as a restore point. Nothing was
pushed.

```
npm run gate     # check + test + drive — the whole verification pass
npm start        # http://localhost:8484
```

84 tests green, 44 drive checks green, `npm run check` clean.

---

## What changed

### Sequence is gone

`journey.html`, `journey.css`, `src/journey.js` and the nav entry. Nothing else
referenced it. Three dead modules went with it — `vendor/tweakpane.min.js`
(152 kB), `src/shapeModes.js`, `src/shapes.mjs` — none with an importer
anywhere, all recoverable from `main`.

### The design system

`styles.css` is rebuilt on one token block: a 4 px spacing scale, six
role-named type sizes, five radii, four control heights, four elevations, five
motion durations, three easing curves. No component keeps a raw value.
`npm run check` fails the build on a literal duration or easing curve outside
the token block, on any CSS class the JS names that no rule defines, **and on
any rule nothing can reach**. That second direction is the one that
accumulates silently through a refactor; it found eight dead rules left by this
session's own rewrites, and one that mattered — `.skip-link`, styled and never
built.

`tools/gen-icons.mjs` pulls only the icons the app names out of
`@hugeicons/core-free-icons` (83 MB, 5 448 modules) and writes `src/ui/icons.js`
as inline SVG — 42 glyphs, 28 kB, no runtime dependency. 27 come from
hugeicons; 15 stay bespoke, each with its reason in the generator.

`brand/TEMPO.svg` is inlined as `src/ui/wordmark.js` so it inherits colour, and
sized by height against the UI type beside it. It sits in the chrome row of
both surfaces. That is the only brand change.

### Accessibility

- One designed `:focus-visible` ring app-wide. Before: the browser default on
  buttons, `outline: none` on every text input.
- Section headers were `<div>`s with click handlers — the collapse control of
  every section on every surface was unreachable by keyboard. They are
  `<button aria-expanded>`.
- Accessible names on every control. Number fields report `role="spinbutton"`
  with a live value and range; icon-only buttons derive their name from their
  tooltip so the two cannot drift.
- Menus have `menuitem`/`menuitemradio` roles, focus enters on open and returns
  to the trigger on close. Tabs and segmented controls are radiogroups with
  roving tabindex.
- The invisible native colour input left every colour field with a second,
  unreachable tab stop. Removed from the sequence.
- `--text-faint` was 2.6:1 on the panel, below AA. Raised to 4.7:1 minimum; a
  test measures every secondary text style against its own background.
- `prefers-reduced-motion` covered 7 selectors and missed the largest motion in
  the app. It is universal now, keeping opacity and colour and dropping
  movement.

### Visual, rebuilt around its job

Ordered by the job — Source, Look, Adjust, Canvas, Camera, Export — not by the
engine underneath.

- **The third export exists.** `src/exportMesh.js` extrudes a relief from the
  same cell list the SVG writes, so PNG, SVG and 3D are three renderings of one
  picture. Binary STL or OBJ, with a backing plate so the file is one solid.
  Measured on the globe: 100 × 100 × 3.2 mm, 25 076 triangles.
- **The source picker** was a flat dropdown of ~100 entries with images — what
  the mode is for — as two of them. It groups by kind, images lead, and typing
  filters; Enter takes the first match.
- **Progressive disclosure.** Depth controls exist only for a model; block
  thresholds only in Blocks style; the source's own parameters start closed.
- **One primary action**, pinned to the panel foot with its format, its options,
  its shortcut and a line saying exactly what the file will be. It used to be
  the last thing in a seven-section scroll past 44 controls.
- Every explanatory paragraph is gone.

### Motion

Same treatment, one loop later: Timing packs its fields two per row with word
prefixes, the intro and exit selects moved into it as *Opens* and *Ends*, five
sections became two, the export action is pinned in the same footer pattern
with the same ⌘E, and Reset appears only when there is an override.

Destructive actions ask first and name what they will destroy — and say `⌘Z`
brings it back, so the dialog teaches the shortcut that makes it unnecessary.

The library is a flex column: Clips, Animations (filterable, 87 rows scrolling
inside their own box), Assets and Import always in view. They used to be one
scroll with Assets ~2 000 px below the fold.

### Layout

Panels were fixed at 244 + 276 px with the viewport inset by those constants,
and nothing was responsive. Three tiers now (≥1180, ≤1180, ≤900); below 900 the
library becomes a drawer handled from the edge it slides out of. Motion's stage
at 768 goes from 15% of the width to 47%.

The timeline's height was a hand-kept constant that no longer matched its
lanes. It is derived from them.

### The library

87 animation names in a 244 px column is a list you scroll, not one you choose
from. The names carry their own structure — 75 of 87 share a first word with at
least two others, and ten end in " blocks", a variant tag rather than part of
the name — so `modeFamilies()` derives nine families from the data and the list
shows `ZOOM` then `zoom / out / quarter / spin / lean / plane`. The Visual
picker groups the same way. Nothing here is invented metadata.

A failed asset used to look exactly like a working one, and clicking it did
nothing. Failed rows carry an alert icon, read "failed", and clicking retries.

### Shortcuts

They existed only in the README. Both surfaces carry a control in the chrome
that opens a sheet, `?` opens it too, and the sheet is the single place they are
written down. Motion gained ⌘E, which it did not have.

---

## Perf against baseline

Baseline re-measured at `e4a480d` through a worktree with the corrected tool, so
these are like-for-like.

| | Visual before | Visual after | Motion before | Motion after |
| --- | --- | --- | --- | --- |
| Transfer | 26 367 kB | **2 101 kB** | 26 360 kB | **3 270 kB** |
| — app code | 424 kB | 480 kB | 494 kB | 540 kB |
| FCP | 240 ms | **184 ms** | 224 ms | **208 ms** |
| First frame | 24 ms | 21 ms | 19 ms | 18 ms |
| Sustained fps | 120.1 | 120.1 | 120.1 | 120.2 |
| p95 frame | 9.9 ms | 9.8 ms | 9.6 ms | 9.2 ms |
| Long tasks | 5, max 188 ms | **1, ~71 ms** | 5, max 218 ms | **2, max ~168 ms** |
| Retained heap | 141.1 MB | **17.4 MB** | 132.6 MB | **57.5 MB** |

Both surfaces fetched and sampled the entire GLB catalogue at boot whether or
not anything used it. They now fetch what the first frame needs. App code grew
56 kB for the icon module, the mesh exporter and the rebuilt panels.

Not in the table, because it has no baseline: the clip list rebuilt its whole
DOM on every store event, so scrubbing any inspector value re-created every row
of the left panel continuously. Measured over a 120-tick scrub: 120 rebuilds
before, 0 after. Resize was unthrottled on both surfaces and each call
reallocated the renderer and both render targets; it is one per painted frame.

---

## Screenshots

| Path | What |
| --- | --- |
| `shots/baseline/` | As found, both surfaces at 1440 / 1024 / 768 |
| `shots/final/` | Now — the same six, plus six interaction states |
| `shots/final/motion-clip-1440.png` | The inspector with a clip selected |
| `shots/final/motion-scene-1440.png` | The Scene tab |
| `shots/final/motion-export-1440.png` | The Export tab with its pinned action |
| `shots/final/visual-picker-1440.png` | The grouped, filterable source picker |
| `shots/final/visual-confirm-1440.png` | A destructive action asking |
| `shots/final/motion-exporting-1440.png` | The export progress card, mid-render |
| `shots/final/shortcuts-1440.png` | The shortcut sheet |
| `shots/relief.png` | An exported STL rendered back, to prove the geometry |
| `shots/iconsheet.png` | Every icon at 32 / 16 / 13 px against type |

`shots/` is gitignored — regenerate with `npm run shoot`. The baseline set was
taken at `e4a480d`; `git checkout main && npm run shoot -- shots/baseline`
rebuilds it.

---

## Decisions you might overrule

Full reasoning in `DESIGN_DECISIONS.md` (D1–D18). The ones most worth a second
opinion:

1. **The 3D export is STL and OBJ, not GLB.** Both are dependency-free; a GLB
   writer means vendoring a glTF exporter for geometry with no materials,
   animation or scene graph. `buildRelief()` returns plain triangles, so a GLB
   serialiser is a small addition if you want it. (D11)
2. **The relief gets a backing plate by default.** Without it the file is a few
   thousand disconnected boxes. Switchable. (D12)
3. **Canvas presets are ratios** — `1:1 / 9:16 / 16:9`. The words never fit the
   field column at any panel width. They survive in the tooltips. (D14)
4. **15 of 42 icons stay bespoke.** Transport must be solid, keyframes need a
   filled/outline pair, three hugeicons collapse at 13 px, and the parameter
   glyphs depict what they control. (D8)
5. **Reduced motion keeps opacity and colour transitions.** Blanket-disabling
   everything makes hover states pop instead of settle, which reads as broken.
   The spinner keeps turning, slowed. (D9)
6. **Section collapse animates opacity, not the row track.** The height snaps.
   (D7)
7. **The library filter is a plain substring match**, not fuzzy. `zoom` finds
   the 25 zooms; `zm` finds nothing.
8. **Animation families are derived from the first word of the label.** It is a
   heuristic over your naming, not declared metadata. It happens to be right
   for 75 of 87 today; renaming a mode moves it between families silently. A
   `family` field in `modes.js` would make it explicit.
9. **The clip list stayed** even though it mirrors the timeline. It earns its
   place with durations and drag-to-reorder, but it is duplicated information
   in a dense panel and you may disagree.
10. **`--text-faint` moved from `#5c5c5c` to `#8a8a8a`** to clear AA. It is a
   visibly lighter grey; the old value was below contrast minimums.
11. **The starter project is "Untitled"**, not "Hatch motion".

---

## Left alone, deliberately

- **`src/particles.js`, `src/modes.js`, `src/terminal.js`, `src/sequence.js`,
  `src/occlusion.js`** — the engine. 420 kB of working, commented rendering
  code. This was a UI, UX and perf brief; the only engine-adjacent change is
  exporting `rasterToGlyphs` so the mesh exporter reads the same cells the SVG
  does.
- **`models/`, `plates/`, `presets/`** — user assets and fixtures I did not
  create. `longsleeve.png` is 2.7 MB and would benefit from re-encoding, but
  that is a change to someone's asset, so it is loaded lazily instead.
- **Visual has no undo.** It never did. Its state is a small config object with
  a debounced autosave, and the destructive paths confirm instead. A real undo
  stack is a feature, not polish. (D16)
- **`serve.py`'s `POST /save/`** — a dev affordance for automated exports.
  Harmless, still used by nothing in the app, and removing it would break
  whatever workflow added it.
- **No build step introduced.** Adding a bundler would be a much larger and
  riskier change than the brief asks for, and the app is fast without one.
- **`.vercelignore` untouched** — the brief forbids deploy-config changes. The
  consequence (models 404 in production) is now tested and handled honestly.

---

## The next three things

1. **Re-encode `plates/longsleeve.png`.** 2.7 MB for a plate. At the size it is
   traced to it could be a few hundred kB. Lazy loading hid the cost; it did not
   remove it. Needs your call because it is your asset.

2. **Give each animation a preview.** Grouping got the list from 87 flat names
   to nine families, but inside `zoom` there are still 25 rows you cannot tell
   apart without trying each one. The honest answer is a thumbnail: render one
   frame per mode offscreen at, say, 96 px, cache it, and show it on hover or
   in a grid. The evaluator is already deterministic (`renderAt`), so a still
   per mode is a loop over the same code the exporter uses.

3. **Undo in Visual.** The confirmations cover the destructive paths, but the
   asymmetry between the two surfaces is felt: Motion has ⌘Z and Visual does
   not. The config object is small and JSON-serialisable, so the same
   snapshot-based store `src/store.js` uses would drop straight in.

Runner-up: Motion's Scene tab has had the copy pass but not the hierarchy one —
Terminal feel, Glyphs and Render are still three collapsed sections of raw
parameters with no grouping inside them.
