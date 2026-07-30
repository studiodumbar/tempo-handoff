# hatch·fusion studio

A timeline-based motion tool for the hatch brand system. One pool of ~16k
particles is shared by every procedural animation and every sampled GLB — so
"sphere becomes hoodie" is an ordinary transition, not a crossfade. Sequence
targets on a timeline, art-direct each transition, keyframe the camera, and
export exactly what you previewed.

## Run

```
npm start          # python3 serve.py → http://localhost:8484
```

Chrome recommended (MP4 export uses WebCodecs; PNG-to-folder uses the File
System Access API).

## The app

- **Left panel** — the project (new / open / save), the SEQUENCE (ordered
  clips; drag to reorder), and the LIBRARY: 13 procedural animations + GLB
  assets. Click a target to append it; drag it onto the timeline to place it.
  Import GLBs with the button or by dropping files anywhere.
- **Center** — the composition: fixed W × H × fps, previewed at any zoom
  (⌘1 fit · ⌘0 100%). Drag to orbit.
- **Right panel** — the inspector. *Clip*: transition-in (duration, easing,
  stagger order/amount, flight path, scatter, swirl) + per-clip parameter
  overrides. *Scene*: composition, camera, glyph pass, render. *Export*:
  format, fps, range.
- **Bottom** — the timeline. Scrub the ruler; drag a clip's tail to set its
  hold, the seam between stripes and body to set the transition length; the
  CAMERA track holds orbit keyframes (K captures the current view).

Inputs are Figma-style: no sliders — drag a value (or its label) to scrub,
click to type. Shift = coarse, Alt = fine.

## Wordmark targets

The brand's typographic treatment lives INSIDE the motion system: add a
"wordmark" from the Library and the dots become type — the original Shape
Type Studio's 5 × 7 cell glyphs (Latin + Arabic/Persian) and its travelling
stretch/thickness wave, rendered entirely in braille dots. Every wordmark
clip carries its own text, alignment, wave direction and numeric settings
(cell, weight, speed, spread, stretch, thickness…), so one sequence can morph
through different words. The camera eases to a canonical front-on framing
while a wordmark is on screen.

## Keys

space play · ←/→ frame step (⇧ ×10) · home/end · K camera keyframe ·
⌫ delete · ⌘D duplicate · ⌘Z/⇧⌘Z undo/redo · ⌘S save project ·
⌘O open · ⌘±/⌘0/⌘1 zoom · H hide UI

## Export

MP4 (H.264 via WebCodecs + mp4-muxer, quality dial) or PNG sequence (straight
into a picked folder, or a .zip). Frames are stepped deterministically through
the same evaluator that drives playback — the file is the preview. Range and
fps are set in the Export tab; dimensions come from the composition.

## Architecture

```
src/store.js       project schema · events · undo · autosave
src/sequence.js    clip math · deterministic evaluator · camera track
src/particles.js   the shared particle pool (slot A/B morph engine)
src/modes.js       procedural targets      src/assets.js  GLB sampling
src/terminal.js    braille/block glyph post-process (comp-locked grid)
src/occlusion.js   asset self-occlusion depth pass
src/export.js      WebCodecs MP4 · PNG/zip · progress UI
src/ui/            dom kit · fields · library · inspector · timeline
src/main.js        boot · render loop · actions · shortcuts
```

Projects autosave to localStorage and round-trip as `.hatchfusion.json`
files. Custom GLBs live in memory only — re-import them after opening a
project that references them.
