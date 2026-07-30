# TEMPO

Braille and block visuals, in two modes that share one engine.

**Visual** makes a single picture and exports it — PNG at exact canvas pixels,
SVG as one shape per mark, or a 3D relief where every mark that prints becomes
a raised solid. **Motion** puts those pictures on a timeline, morphs between
them through one shared pool of ~16k particles, and exports MP4 or a PNG
sequence. Because the pool is shared, "sphere becomes hoodie" is an ordinary
transition rather than a crossfade.

## Run

```
npm start          # python3 serve.py → http://localhost:8484
```

Chrome recommended: MP4 export uses WebCodecs, and PNG-to-folder uses the File
System Access API. WebGL2 is required.

## Visual — `index.html`

One source at a time, and one primary action.

- **Source** — an image, a 3D model or one of 87 procedural animations. The
  picker groups them by kind and filters as you type. Drop a `.png`, `.jpg`,
  `.svg`, `.glb` or `.gltf` anywhere to add it; imports live for the session.
- **Look** — the marks themselves: braille or blocks, the character grid,
  ink and background, dot size and threshold, exposure, seams.
- **Adjust** — the source's own parameters. Double-click a value to clear an
  override; white means overridden.
- **Canvas** — output size, as a ratio or exact pixels.
- **3D** — field of view, self-occlusion and reset view. Present only when the
  source is a model.
- **Export** — pinned to the foot of the panel with the format, its options
  and what the file will be.

### The exports

| Format | What it is |
| --- | --- |
| PNG | The comp re-rendered at exact pixels, ×1–4, optional transparency |
| SVG | True vectors — a `<rect>` per block quadrant, a `<circle>` per dot |
| STL | A relief solid: 100 mm tile, marks standing off a backing plate |
| OBJ | The same relief as text geometry |

All four read the same cell list, so they are four renderings of one picture
rather than four approximations of it.

## Motion — `editor.html`

- **Left** — the project, the **Clips** list (drag to reorder), and the
  library: 87 animations with a filter, plus assets and imports.
- **Centre** — the composition: fixed W × H × fps, previewed at any zoom.
  Drag to orbit.
- **Right** — the inspector. *Clip*: transition timing, easing, stagger,
  flight path, scatter, swirl, and per-clip parameter overrides. *Scene*:
  composition, camera, terminal feel, glyph pass, render. *Export*: format,
  fps, range.
- **Bottom** — the timeline. Scrub the ruler; drag a clip's tail for its hold
  and the seam for its transition length; the camera lane holds orbit
  keyframes.

Inputs are Figma-style: no sliders. Drag a value — or its label — to scrub,
click to type. Shift is coarse, Alt is fine.

## Keys

Press `?` on either surface, or use the keyboard button in the chrome.

## Architecture

```
src/store.js        project schema · events · undo · autosave
src/sequence.js     clip math · deterministic evaluator · camera track
src/particles.js    the shared particle pool (slot A/B morph engine)
src/modes.js        procedural targets        src/assets.js    GLB sampling
src/terminal.js     braille/block glyph post-process (comp-locked grid)
src/occlusion.js    asset self-occlusion depth pass
src/exportStill.js  PNG + SVG, and the cell list both read
src/exportMesh.js   the 3D relief — STL and OBJ
src/export.js       WebCodecs MP4 · PNG/zip · progress UI
src/ui/             dom kit · fields · icons · library · inspector · timeline
src/visual.js       the Visual surface       src/main.js  the Motion surface
```

Projects autosave to localStorage and round-trip as `.tempo.json`. Custom
imports live in memory only — re-import them after opening a project that
references one.

## Development

```
npm run check      typecheck, lint and build in one pass (tools/check.mjs)
npm test           browser-driven tests across system, a11y, layout,
                   Visual and Motion
npm run drive      walk both surfaces through their real controls and
                   validate every exported file on disk
npm run shoot      screenshot every surface at 1440 / 1024 / 768
npm run perf       transfer, boot, sustained fps, long tasks, retained heap
npm run icons      regenerate src/ui/icons.js from @hugeicons/core-free-icons
npm run gate       check + test + drive
```

There is no build step: the app is plain ES modules served statically. The
design system lives in the token block at the top of `styles.css`, and
`npm run check` fails on any component that reaches past it for a duration or
an easing curve, or names a CSS class that no rule defines.
