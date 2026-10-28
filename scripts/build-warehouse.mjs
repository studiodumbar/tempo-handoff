import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("dist/", root);

// Publish the app at the site root, without handoff files or local renders.
const entries = [
  "index.html",
  "editor.html",
  "styles.css",
  "visual.css",
  "src",
  "vendor",
  "brand",
  "plates",
  "presets",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of entries) {
  await cp(new URL(`tempo-app/${entry}`, root), new URL(entry, output), {
    recursive: true,
  });
}
console.log("Built Tempo Visual and Motion in dist/");
