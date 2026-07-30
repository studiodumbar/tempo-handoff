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

### D5 — `tweakpane.min.js` left in `vendor/` untouched

152 kB, no longer imported by anything. It is a pre-existing vendored asset I
did not create, so per the hard rules it is recorded rather than deleted. It
costs nothing at runtime because no module references it.
