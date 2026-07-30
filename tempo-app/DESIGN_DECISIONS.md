# DESIGN DECISIONS

Every opinionated call made during the polish pass, with the reason. Newest at
the bottom of each section.

---

## Setup

### D1 — `git init` on a tree that was not a repository

The brief assumes a git repo; there wasn't one. Initialised in `tempo-app/`
(not the parent `mpp-terminal/`, which also holds unrelated `terminal sketches/`
Python work), committed the tree as found on `main`, then branched
`tempo-polish`. `main` now exists purely as the restore point.

### D2 — No build step, so the verification gate is re-specified

The app is plain ESM served by `serve.py`. There is no TypeScript, no bundler,
no linter and no test runner, and adding a toolchain would be a much larger and
riskier change than the brief asks for. The gate is therefore met as:

| Brief | How it is met here |
| --- | --- |
| Typecheck clean | `node --check` over every module + a JSDoc-free static import graph check (`tools/check.mjs`) |
| Lint clean | `tools/check.mjs` — unused imports, undefined globals, duplicate CSS custom properties, magic-number sweep of token-owned values |
| Build succeeds | Every module parses and the full import graph resolves over HTTP from the dev server |
| Tests pass | `tools/test.mjs` — a browser-driven suite over the real app |
| Driven with Playwright | `tools/drive.mjs` exercises every surface and every primary flow, and validates each exported file |
| Screenshots at 3 widths | `tools/shoot.mjs` |
| Perf ≥ baseline | `tools/perf.mjs` |

### D3 — hugeicons is vendored as generated inline SVG, not imported from node_modules

`@hugeicons/core-free-icons` is 83 MB unpacked across 5 448 modules. The app
has no bundler, so importing it directly would mean either shipping
`node_modules/` or 5 448 separate HTTP requests. Instead `tools/gen-icons.mjs`
reads only the icons the app actually names and generates `src/ui/icons.js` as
inline SVG. The package stays a devDependency; runtime cost is a few kB.

### D4 — New dependencies

- `@hugeicons/core-free-icons` (dev) — the icon set the brief asks for; source
  data for the generator in D3. Not shipped.
- `playwright` (dev) — required by the gate ("driven with Playwright"). Not
  shipped.

Nothing was added to the runtime. `three`, `GLTFLoader`, `OrbitControls`,
`BufferGeometryUtils` and `mp4-muxer` were already vendored.

### D5 — Deleted three dead modules I did not write

Recorded here because the hard rules require it. None had an importer anywhere
in the tree, verified by `tools/check.mjs`, and all three are recoverable from
`main`:

| File | Size | Why it was dead |
| --- | --- | --- |
| `vendor/tweakpane.min.js` | 152 kB | Vendored library, no `import` anywhere |
| `src/shapeModes.js` | 6.6 kB | No importer |
| `src/shapes.mjs` | 7.7 kB | Only `shapeModes.js` imported it |

`presets/*.hatchfusion.json`, `plates/`, `models/` and `brand/` are untouched.

---

## The design system

### D6 — `--text-faint` raised from `#5c5c5c` to `#8a8a8a`

The old value sat at 2.6:1 on the panel, below AA, and it carried every
secondary label in the app — parameter prefixes, hints, tick labels, the units
line. The new value is 5.3:1 on `--panel` and 4.7:1 on `--field`. A test
measures every secondary text style against its own computed background, so
this cannot silently regress.

### D7 — Section collapse animates opacity, not the row track

The collapse was `transition: grid-template-rows 220ms`, a layout property
animating at 60 Hz over a whole panel. The wrapper now snaps and the inner
block fades. The height change is instant; the content is what the eye follows,
and it still reads as a collapse.

### D8 — 15 of 42 icons stay bespoke

hugeicons is the set, but four cases are not served by it and each is marked in
`tools/gen-icons.mjs`:

1. **Transport** (play, pause, skip-back) — hollow outlines at 13px inside a
   32px button read as an outline of nothing. Every transport control anyone
   has used is solid.
2. **Keyframe markers** — the timeline signals selection by filling the
   diamond, so it needs a filled/outline pair. hugeicons is stroke-only.
3. **Shapes that collapse** — `CubeIcon` is a stacked-boxes construction that
   becomes an L at the 12px the timeline draws clip icons at; `Maximize01` is
   four arrows that turn to mush; `Loading03` is a radial burst that reads as a
   twinkle under rotation rather than as work in progress.
4. **Parameter glyphs** (easing curve, flight path, amplitude, scatter, print
   order, swirl) — each depicts the thing it controls. A generic icon here
   would be a guess about meaning, which the brief forbids.

Both grids run at the same stroke-per-grid-unit (0.075), so they read as one
hand at any size.

### D9 — Reduced motion keeps opacity and colour

`prefers-reduced-motion` zeroes everything that moves, then restores
`background`, `color`, `opacity` and `box-shadow` transitions at `--dur-2`.
Blanket-disabling every transition makes hover states pop instead of settle,
which reads as broken rather than as calm. The spinner keeps turning, slowed to
2s — a still spinner reads as a hang.

### D10 — The focus ring is white, not a new colour

The palette is monochrome by design and the brief forbids accent-colour
changes, so the ring is `rgba(255,255,255,0.92)` at 2px with a 1px offset.
Against every surface in the app that clears 3:1 comfortably.

---

## Visual

### D11 — The 3D export is STL and OBJ, not GLB

Both are dependency-free to write and every tool opens them. A GLB writer would
mean vendoring a glTF exporter — hundreds of kB and a build step's worth of
complexity — to express geometry that has no materials, no animation and no
scene graph. STL is what a relief gets printed from; OBJ is what it gets
imported into. If GLB is wanted later, `buildRelief()` already returns plain
triangles and only needs a different serialiser.

### D12 — The relief is one solid on a backing plate by default

Without a plate the file is a few thousand disconnected boxes floating in
space: valid geometry, useless object. The plate is 1.2 mm, the marks stand
2 mm off it, and the tile is 100 mm on its long edge — millimetres if you print
it, arbitrary units if you don't. Switchable, because placing marks in a 3D
scene is a real second use.

### D13 — Dots extrude as eight-sided prisms

A cylinder is hundreds of triangles per dot across a few thousand dots. A box
loses the braille character entirely. An octagon reads as round from every
angle a relief is looked at and costs 28 triangles.

### D14 — Canvas presets are ratios

"Square / Portrait / Landscape" does not fit the field column at any panel
width. `1:1 / 9:16 / 16:9` fits, and it is the more precise label — it says
what you get. The words survive in the tooltips.

### D15 — Right-click to reset a parameter became double-click

Right-click still works, but nothing announced it and nothing could.
Double-click is the discoverable gesture and the field's tooltip names it.

### D16 — Visual has no undo

It never did. Its state is a small config object with a debounced autosave,
and the destructive paths (Reset parameters, the style switch) now confirm
instead. A full undo stack here would be a new feature, not polish, so it is
listed in the handover instead of half-built.

---

## Motion

### D17 — Destructive actions confirm; the shortcut is in the dialog

Deleting a clip was instant and silent. Undo existed but was never mentioned
anywhere in the interface. The confirmation names the clip and says `⌘Z brings
it back` — so the dialog teaches the shortcut that makes the dialog
unnecessary next time.

### D18 — `newProject` confirms only when there is something to lose

An empty project needs no ceremony. With clips on the timeline it says how many
and what the project is called.
