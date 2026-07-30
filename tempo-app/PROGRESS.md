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
| JS heap after boot | 141.1 MB | 149.7 MB |

Largest modules (both surfaces): `models/tshirt.glb` 10 679 kB,
`models/cap.glb` 7 085 kB, `plates/longsleeve.png` 2 698 kB (fetched twice),
`vendor/three.module.js` 1 243 kB, `models/mug.glb` 1 185 kB,
`src/modes.js` 155 kB, `src/particles.js` 121 kB.

No later phase may regress these numbers.

Baseline screenshots: `shots/baseline/{visual,motion}-{1440,1024,768}.png`.
Baseline perf JSON: `shots/baseline/perf.json`.

## Log

- `e4a480d` Checkpoint: TEMPO app as found (hatch-fusion studio) — pre-existing tree, committed as the branch point.
- `364eaa5` Audit: baseline, tooling, ranked findings. Gate tooling in place (check / shoot / perf).
- `8f34526` Remove Sequence mode and dead code — journey.{html,css,js}, shapeModes.js, shapes.mjs, tweakpane.min.js (152 kB, no importer). Two unused imports dropped.
- `fdcc424` Design system: token layer, hugeicons via a generator, app-wide focus ring, complete reduced-motion, TEMPO wordmark. 26 tests green. Perf level with baseline (+26 kB app code for the icon module).
