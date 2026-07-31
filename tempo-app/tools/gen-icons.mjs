#!/usr/bin/env node
/* Generate src/ui/icons.js from @hugeicons/core-free-icons.
 *
 * The package is 83 MB across 5 448 modules and this app has no bundler, so
 * importing it at runtime is not an option. Instead we read only the icons the
 * app names below and emit them as inline SVG strings.
 *
 * Two grids coexist at one optical weight — see HUGEICONS_STROKE below. A
 * glyph stays bespoke only where hugeicons genuinely does not serve: transport
 * symbols that must be solid, a filled/outline pair, shapes that collapse at
 * 13px, and the parameter glyphs that depict what they control.
 *
 *   npm run icons
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKG = path.join(ROOT, "node_modules/@hugeicons/core-free-icons/dist/esm");

/* hugeicons draw on a 24 grid at stroke 1.5, which is 0.0625 per grid unit.
   Rendered at the 13px this UI uses most, that is a 0.8px line — it ghosts
   against 11px text. 1.8 (0.075/unit, ~1px at 13px) is the weight that holds
   up without turning the set chunky. The bespoke glyphs use 1.2 on their 16
   grid, which is the same ratio. */
const HUGEICONS_STROKE = "1.8";
const BESPOKE_STROKE = "1.2";

/** app name -> hugeicons module. One name per concept, used everywhere. */
const FROM_HUGEICONS = {
  loop: "RepeatIcon",
  plus: "PlusSignIcon",
  minus: "MinusSignIcon",
  camera: "Camera01Icon",
  keyframeAdd: "KeyframeAddIcon",
  trash: "Delete02Icon",
  copy: "Copy01Icon",
  upload: "Upload01Icon",
  download: "Download01Icon",
  folder: "Folder01Icon",
  file: "File01Icon",
  chevronDown: "ArrowDown01Icon",
  check: "Tick02Icon",
  grip: "DragDropVerticalIcon",
  film: "Film01Icon",
  image: "Image01Icon",
  clock: "Clock01Icon",
  hourglass: "Timer02Icon",
  search: "Search01Icon",
  x: "Cancel01Icon",
  alert: "AlertCircleIcon",
  undo: "UndoIcon",
  redo: "RedoIcon",
  wave: "WaveIcon",
  layers: "Layers01Icon",
  sliders: "SlidersHorizontalIcon",
};

/** Bespoke glyphs, on the 16 grid. Each block says why it is not hugeicons. */
const BESPOKE = {
  /* Transport. Solid, because that is what a transport control is everywhere
     a person has ever seen one, and because a hollow triangle at 13px in a
     30px button reads as an outline of nothing. */
  play: `<path d="M5 3.2c0-.8.9-1.3 1.6-.9l7 4.3c.7.4.7 1.4 0 1.8l-7 4.3c-.7.4-1.6-.1-1.6-.9V3.2Z" fill="currentColor"/>`,
  pause: `<rect x="3.6" y="2.6" width="2.9" height="10.8" rx="1" fill="currentColor"/><rect x="9.5" y="2.6" width="2.9" height="10.8" rx="1" fill="currentColor"/>`,
  skipBack: `<rect x="3" y="3" width="1.8" height="10" rx="0.9" fill="currentColor"/><path d="M13 3.9c0-.8-.9-1.3-1.6-.9L6.6 7.1c-.6.4-.6 1.3 0 1.7l4.8 4.2c.7.5 1.6 0 1.6-.9V3.9Z" fill="currentColor"/>`,

  /* Four corner brackets. hugeicons' Maximize is four arrows, which turns to
     mush at 13px; brackets stay legible because they are only ever lines. */
  fit: `<path d="M6 2.8H4.2A1.4 1.4 0 0 0 2.8 4.2V6M10 2.8h1.8a1.4 1.4 0 0 1 1.4 1.4V6M6 13.2H4.2a1.4 1.4 0 0 1-1.4-1.4V10M10 13.2h1.8a1.4 1.4 0 0 0 1.4-1.4V10" ${strokeAttrs()}/>`,

  /* A plain isometric cube. hugeicons' Cube is a stacked-boxes construction
     that collapses into an L at the 12-13px the timeline draws clips at. */
  box: `<path d="M8 2.6 13.2 5.4v5.2L8 13.4 2.8 10.6V5.4L8 2.6ZM2.8 5.4 8 8.2l5.2-2.8M8 8.2v5.2" ${strokeAttrs()}/>`,

  /* A three-quarter ring. Loading03 is a radial burst, which under rotation
     reads as a twinkle rather than as work in progress. */
  spinner: `<path d="M8 2.4A5.6 5.6 0 1 1 2.4 8" ${strokeAttrs()}/>`,

  /* The two keyframe markers stay a filled/outline PAIR because the timeline
     uses fill to signal selection, and hugeicons is a stroke-only set. */
  diamond: `<path d="M7.3 2.2a1 1 0 0 1 1.4 0l5.1 5.1a1 1 0 0 1 0 1.4l-5.1 5.1a1 1 0 0 1-1.4 0L2.2 8.7a1 1 0 0 1 0-1.4l5.1-5.1Z" fill="currentColor"/>`,
  diamondO: `<path d="M7.3 2.6a1 1 0 0 1 1.4 0l4.7 4.7a1 1 0 0 1 0 1.4l-4.7 4.7a1 1 0 0 1-1.4 0L2.6 8.7a1 1 0 0 1 0-1.4l4.7-4.7Z" ${strokeAttrs()}/>`,

  /* Parameter glyphs. Each DEPICTS its parameter — an easing curve, a flight
     path, an amplitude, a scatter, a print order. A generic icon in their
     place would be a guess about meaning, which the brief forbids. */
  curve: `<path d="M2.6 13C3.8 13 4.6 12 6 8.6 7.6 4.8 9.2 3 13.4 3" ${strokeAttrs()}/>`,
  orderRows: `<path d="M3 4.4h7M3 8h10M3 11.6h5" ${strokeAttrs()}/>`,
  steps: `<path d="M2.8 12.6h3.4V9.2h3.4V5.8H13V2.8" ${strokeAttrs()}/>`,
  squiggle: `<path d="M2.4 10.6c1.6-4.4 3-4.4 4.4-1s2.8 3.4 4.4-1 2.2-3.2 2.4-2.4" ${strokeAttrs()}/>`,
  amp: `<path d="M2.4 8h11.2M5.4 8c1.2-3.4 2.4-3.4 3.6 0s2.4 3.4 3.6 0" ${strokeAttrs()}/>`,
  scatterDots: `<g fill="currentColor"><circle cx="7.6" cy="8.2" r="1.2"/><circle cx="3.4" cy="4.6" r="1"/><circle cx="12.4" cy="4" r="1"/><circle cx="12.8" cy="11.8" r="1"/><circle cx="3.8" cy="12.2" r="1"/></g>`,
  swirl: `<path d="M8 8m3.8 0a3.8 3.8 0 1 1-7.6 0 5.4 5.4 0 0 1 5.4-5.4 7 7 0 0 1 4.4 1.6" ${strokeAttrs()}/>`,
};

function strokeAttrs() {
  return `fill="none" stroke="currentColor" stroke-width="${BESPOKE_STROKE}" `
    + `stroke-linecap="round" stroke-linejoin="round"`;
}

const DASH = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const esc = (s) => String(s).replace(/"/g, "&quot;");

/** [tag, attrs] pairs -> SVG child markup. */
function toMarkup(nodes) {
  return nodes.map(([tag, attrs]) => {
    const a = Object.entries(attrs)
      .filter(([k]) => k !== "key")
      .map(([k, v]) => `${DASH(k)}="${esc(k === "strokeWidth" ? HUGEICONS_STROKE : v)}"`)
      .join(" ");
    return `<${tag} ${a}/>`;
  }).join("");
}

const out = new Map();

for (const [name, mod] of Object.entries(FROM_HUGEICONS)) {
  const file = path.join(PKG, `${mod}.js`);
  const src = await readFile(file, "utf8");
  // the module is `const X = [...]; export default X;` — evaluate the literal
  const body = src.match(/=\s*(\[[\s\S]*\]);\s*\n\s*export default/);
  if (!body) throw new Error(`could not read ${mod}`);
  const nodes = new Function(`return ${body[1]}`)();
  out.set(name, {
    view: "0 0 24 24",
    inner: toMarkup(nodes),
    from: mod,
  });
}

for (const [name, inner] of Object.entries(BESPOKE)) {
  out.set(name, { view: "0 0 16 16", inner, from: null });
}

const sorted = [...out.entries()].sort(([a], [b]) => a.localeCompare(b));

const lines = [
  "// GENERATED by tools/gen-icons.mjs — do not edit by hand.",
  "//",
  `// One set at one optical weight: hugeicons on a 24 grid at stroke ${HUGEICONS_STROKE},`,
  `// the bespoke glyphs on a 16 grid at stroke ${BESPOKE_STROKE} — the same stroke-per-unit`,
  "// ratio, so the two read as one hand at any rendered size.",
  "//",
  "// Regenerate with `npm run icons` after editing the map in the generator.",
  "",
  "export const ICONS = {",
];
for (const [name, { view, inner, from }] of sorted) {
  const note = from ? `  // hugeicons ${from}` : "  // bespoke";
  lines.push(`${note}`);
  lines.push(`  ${name}: \`<svg viewBox="${view}" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>\`,`);
}
lines.push("};", "");

await writeFile(path.join(ROOT, "src/ui/icons.js"), lines.join("\n"));
console.log(`icons: wrote src/ui/icons.js — ${sorted.length} icons `
  + `(${Object.keys(FROM_HUGEICONS).length} hugeicons, ${Object.keys(BESPOKE).length} bespoke)`);
