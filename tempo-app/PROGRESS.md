# PROGRESS

Append-only log. One line per commit, newest at the bottom.

## Baseline — 2026-07-31, commit `e4a480d` (branch point)

Measured with `node tools/perf.mjs` against `python3 serve.py` (localhost:8484),
Chromium 151 headed-in-frame with ANGLE/Metal, 1440 × 900, DPR 2.

There is no build step in this project (plain ESM served statically), so "build
time" is not a meaningful number and "bundle size per chunk" is recorded as
**transferred bytes per module on a real cold load** — what a browser actually
pays. Lighthouse is not used: it scores a full-screen WebGL tool as an
accessibility-free blank page and its LCP/CLS metrics are meaningless against a
canvas. The equivalent run below measures the things that actually matter here —
transfer, boot-to-first-frame, sustained frame rate and main-thread blocking.

| Metric | Visual (`/index.html`) | Motion (`/editor.html`) |
| --- | --- | --- |
| Total transfer | **26 367 kB** | **26 360 kB** |
| — app code (`/src`) | 424 kB | 494 kB |
| — vendor | 1 423 kB | 1 490 kB |
| — models + plates | ~24 400 kB | ~24 300 kB |
| FCP | 220 ms | 220 ms |
| DOMContentLoaded | 176 ms | 154 ms |
| First rendered frame | 24 ms | 16 ms |
| Sustained fps (4 s) | 120.1 | 120.3 |
| p95 frame | 9.2 ms | 9.1 ms |
| Worst frame | 10.3 ms | 9.4 ms |
| Long tasks (>50 ms) | 82, 98, 65, 116, 189 ms | 73, 114, 64, 182, 218 ms |
| Retained JS heap | 141.1 MB | 132.6 MB |

Largest modules (both surfaces): `models/tshirt.glb` 10 679 kB,
`models/cap.glb` 7 085 kB, `plates/longsleeve.png` 2 698 kB (fetched twice),
`vendor/three.module.js` 1 243 kB, `models/mug.glb` 1 185 kB,
`src/modes.js` 155 kB, `src/particles.js` 121 kB.

No later phase may regress these numbers.

Baseline screenshots: `shots/baseline/{visual,motion}-{1440,1024,768}.png`.
Baseline perf JSON: `shots/baseline/perf.json`, `shots/baseline/perf-gc.json`.

**Correction, same day.** The first run read `usedJSHeapSize` without forcing a
collection, so the heap column measured GC timing as much as the app. `perf.mjs`
now launches with `--expose-gc` and collects twice before reading, and the
baseline was re-measured at commit `e4a480d` from a worktree served on :8485.
The heap row above is the corrected figure; every other row was unchanged by
the fix.

## Log

- `e4a480d` Checkpoint: TEMPO app as found (hatch-fusion studio) — pre-existing tree, committed as the branch point.
- `364eaa5` Audit: baseline, tooling, ranked findings. Gate tooling in place (check / shoot / perf).
- `8f34526` Remove Sequence mode and dead code — journey.{html,css,js}, shapeModes.js, shapes.mjs, tweakpane.min.js (152 kB, no importer). Two unused imports dropped.
- `fdcc424` Design system: token layer, hugeicons via a generator, app-wide focus ring, complete reduced-motion, TEMPO wordmark. 26 tests green. Perf level with baseline (+26 kB app code for the icon module).
- `538cb61` Load assets on demand — 26 367 kB → 2 063 kB (Visual) and 3 241 kB (Motion), long tasks 5 → 1/2, heap −88%/−57%. Perf tool corrected to force GC before reading the heap.
- `81ad76c` Rebuild Visual around export; add the missing 3D export (STL + OBJ relief). Grouped, filterable source picker. Progressive disclosure. Pinned primary action. Shortcuts sheet on both surfaces. Confirms on Motion's destructive actions.
- `9cf235b` DESIGN_DECISIONS: D6–D18.
- `79e8908` The style switch confirms before wiping tuning.
- `9c39285` Responsive layout at 1180 / 900, library drawer, derived timeline height, library search, empty-state copy.
- `f43d5cc` tools/drive.mjs — drives both surfaces through their real controls and validates four exported files plus the project file on disk. Found two real bugs (a TDZ error killing every searchable menu; a doubled STL header).

## Loop 1 — critique, 2026-07-31

Re-shot every surface at 1440 / 1024 / 768 (`shots/loop1/`). What a demanding
design director would still flag, ranked:

1. **Two different things are called "Timeline".** The left panel's clip list is
   headed *Timeline*; the bottom panel *is* the timeline, and its own lane is
   headed *Clips*. Both are on screen at once. The brief asks for one name per
   concept; this is the clearest remaining violation.
2. **Assets are buried under 87 animations.** The library stacks Animations
   then Assets in one scroll, so the products — and the Import control — sit
   roughly 2 000 px below the fold. The short, more important list is
   unreachable without scrolling past the long one.
3. **The zoom reading appears twice**, in the stage label and in the zoom chip
   eight pixels away.
4. **The inspector's empty state is top-aligned** in a panel with 600 px of
   space under it, so it reads as content that failed to load rather than as a
   designed state.
5. **Visual's panel has ~200 px of dead space** between the last section and
   the pinned footer. Honest (the panel is short) but unresolved-looking.
6. **The README still describes hatch·fusion**, three modes and a Sequence page
   that no longer exists.

### Loop 1 — fixed

1. The clip list is **Clips**, matching the timeline lane it mirrors. Nothing
   is called Timeline except the timeline.
2. The library is a flex column of three sections that each own their scroll —
   Clips (capped), Animations (absorbs the slack), Assets (always in view with
   its import control). All six assets and the import button now sit on screen
   with no scrolling; they were ~2 000 px down.
3. The stage label no longer repeats the zoom chip's percentage.
4. An empty panel centres its state in the space it owns.
5. Row icons say what a thing IS — wave for an animation, image for a traced
   image, cube for a sampled model — instead of one cube for everything but
   animations.
6. `Import GLB / image…` became `Import`, with the formats in its tooltip.
   The shipped plate is labelled "long sleeve", so it reads as the same object
   as its model rather than a second spelling.
7. README rewritten for TEMPO. It described three modes, a Sequence page that
   no longer exists, and a wordmark feature that `normalizeProject` has been
   deleting from projects — verified gone from `modes.js` before removing the
   section rather than carrying the claim forward.

## Loop 2 — critique, 2026-07-31

`tools/shoot.mjs` now captures interaction states, not just default views —
the inspector's three tabs, the source picker, a confirmation and the shortcut
sheet. Panels nobody screenshots are panels nobody critiques, and the Motion
inspector turned out never to have had the pass Visual got:

1. **Timing was misaligned.** `grid2(durF, holdF)` with a null `durF` left an
   empty cell, so the first clip's hold sat in the right column and its delay
   alone underneath — two values, three cells, no alignment. Both fields also
   carried the same hourglass icon and no words.
2. **Prose, still.** "The first clip opens already settled — add an intro
   below to animate it in." and "Background · ink." and "Placement rides the
   image asset's size / spin / tilt params."
3. **Five sections for one clip**, two of which were a single select each
   (*Intro / From*, *Exit / To*), and both showed even when set to none.
4. **A Reset that did nothing.** Parameters always offered it, override or not.
5. **The export action scrolled away** on this surface while Visual's was
   pinned, and its readout lived inside the Range section as a `.note`.
6. **No export shortcut** on Motion, while Visual had ⌘E.

### Loop 2 — fixed

Timing packs whatever fields the clip actually has, two per row, with word
prefixes (`hold`, `in`, `delay`). The intro and exit selects moved into it as
*Opens* and *Ends* — they are the control the deleted paragraph was pointing
at, so they moved to where the reader already is. The flight sections appear
only when there is a flight. Reset appears only when there is an override, and
it confirms. Colour fields have labels. The export action is pinned in the
same footer pattern as Visual, with the same ⌘E and the same meta line.

The last three `.note` paragraphs in the app are gone; a test now fails on any
panel text over six words.

## Loop 3 — critique and fixes, 2026-07-31

1. **The source picker spilled out of its own card.** The menu was capped at
   420 px but the list inside it was not, and menus did not clip — so from
   "zoom" down, every row painted on top of the panel behind. Caught by
   screenshotting the picker as a state. The menu is a clipping flex column
   now and the list shrinks inside it. The test asserts the card clips and the
   list actually scrolls, rather than measuring rects (rows scrolled out of
   view legitimately sit outside the box).
2. **Reset view was unreachable for an image.** Putting the whole 3D section
   behind "is this a model" took the camera controls with it, but any source
   can be orbited — the canvas drag is bound unconditionally. The section is
   **Camera** now and always present with field of view and Reset view; only
   the depth controls (solidity, bias) are model-only. Parity restored without
   losing the disclosure.
3. **Nothing said the canvas orbits, or offered a way back.** A Reset view chip
   sits on the stage and appears only once the view has actually moved — the
   affordance shows up exactly when it means something. It writes to the DOM
   only when the state flips, so it costs nothing per frame.
4. The shipped plate is labelled "long sleeve" in Visual's picker too; it read
   "longsleeve" beside a model called "long sleeve".
5. The menu's search row takes the focus ring as a row, not as a bare input
   floating inside it.
