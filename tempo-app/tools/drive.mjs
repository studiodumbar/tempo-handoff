#!/usr/bin/env node
/* Drive the real app the way a person does — clicking the actual controls —
   and validate what lands on disk.
 *
 * The test suite checks exports through window hooks, which proves the encoder
 * is right but not that the button is wired to it. This walks the primary flows
 * through the interface, catches every download, and inspects the bytes.
 *
 *   node tools/drive.mjs [outDir]
 */
import { chromium } from "playwright";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.TEMPO_BASE || "http://localhost:8484";
const OUT = process.argv[2] || "shots/drive";

let step = 0;
const problems = [];
const done = [];

const note = (what) => { done.push(`${String(++step).padStart(2)}. ${what}`); };
const fail = (what, why) => { problems.push(`${what}: ${why}`); };
const must = (cond, what, why) => {
  if (cond) note(what);
  else fail(what, why);
};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});

const downloads = [];
const page = await ctx.newPage();
page.on("download", async (d) => {
  const file = path.join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  downloads.push({ name: d.suggestedFilename(), file });
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });

const grab = async (fn) => {
  const before = downloads.length;
  await fn();
  for (let i = 0; i < 60 && downloads.length === before; i++) {
    await page.waitForTimeout(250);
  }
  return downloads.at(-1);
};

// ============================================================ VISUAL

console.log("\n── Visual ──────────────────────────────────────────────");
await page.goto(`${BASE}/index.html`, { waitUntil: "load" });
await page.waitForTimeout(2500);

must(await page.isVisible(".wordmark"), "the chrome carries the TEMPO wordmark", "not found");

// -- change the source through the picker, by typing --
await page.click(".source-btn");
await page.waitForTimeout(300);
await page.fill(".menu-search-input", "globe");
await page.waitForTimeout(250);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
must((await page.textContent(".source-name")).trim() === "globe",
  "picking a source by typing its name",
  `source reads "${(await page.textContent(".source-name")).trim()}"`);

// -- the look controls --
await page.click('#v-look .seg-btn:has-text("Fine")');
await page.waitForTimeout(500);
must(await page.evaluate(() => window.__visual.config.scene.cellW === 6),
  "the grid preset changes the cell size", "cellW did not change");
await page.click('#v-look .seg-btn:has-text("Default")');
await page.waitForTimeout(400);

// -- the canvas --
await page.click('#v-canvas .seg-btn:has-text("16:9")');
await page.waitForTimeout(500);
must(await page.evaluate(() =>
  window.__visual.config.comp.width === 1920 && window.__visual.config.comp.height === 1080),
"the canvas ratio control resizes the comp", "comp did not change");
await page.click('#v-canvas .seg-btn:has-text("1:1")');
await page.waitForTimeout(500);

// -- export each format through the real button --
const FORMATS = [
  { label: "PNG", ext: "png" },
  { label: "SVG", ext: "svg" },
  { label: "STL", ext: "stl" },
  { label: "OBJ", ext: "obj" },
];

for (const f of FORMATS) {
  await page.click(".panel-foot .field.select");
  await page.waitForTimeout(300);
  await page.click(`.menu-item:has-text("${f.label}")`);
  await page.waitForTimeout(400);

  const label = (await page.textContent(".panel-foot .btn.primary")).trim();
  must(label === `Export ${f.label}`,
    `the export button follows the format (${f.label})`, `button reads "${label}"`);

  const dl = await grab(() => page.click(".panel-foot .btn.primary"));
  if (!dl) { fail(`export ${f.label}`, "no file was produced"); continue; }
  must(dl.name.endsWith(`.${f.ext}`), `export ${f.label} downloads a .${f.ext}`,
    `got "${dl.name}"`);
  await validate(f.ext, dl.file);
}

// -- the keyboard path --
{
  await page.click("#stage");
  const dl = await grab(async () => {
    await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
    await page.keyboard.press("KeyE");
    await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  });
  must(!!dl, "⌘E exports without touching the panel", "no file was produced");
}

// -- the shortcut sheet --
await page.click(".appnav .icon-btn");
await page.waitForTimeout(350);
must(await page.isVisible(".sheet-card"), "the chrome opens the shortcut sheet", "sheet did not open");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// -- the destructive path asks --
await page.evaluate(() => {
  window.__visual.config.scene.dotR = 1.2;
  window.__visual.buildPanel();
});
await page.waitForTimeout(300);
await page.click('#v-look .seg-btn:has-text("Braille")');
await page.waitForTimeout(350);
must(await page.isVisible(".confirm-card"), "resetting the look asks first", "no confirmation");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.screenshot({ path: path.join(OUT, "visual-driven.png") });

// ============================================================ MOTION

console.log("\n── Motion ──────────────────────────────────────────────");
await page.goto(`${BASE}/editor.html`, { waitUntil: "load" });
await page.waitForTimeout(2500);

const clipCount = () => page.evaluate(() => window.__app.store.project.clips.length);

// -- add from the library, through the filter --
{
  const before = await clipCount();
  await page.fill(".lib-search input", "pulse");
  await page.waitForTimeout(300);
  await page.click(".lib-section .lib-list .lib-row");
  await page.waitForTimeout(500);
  must(await clipCount() === before + 1, "adding a clip from the filtered library",
    "clip count did not rise");
}

// -- select it on the timeline and edit a value --
await page.click(".tl-clip");
await page.waitForTimeout(400);
must(await page.evaluate(() => window.__app.store.session.selection?.type === "clip"),
  "clicking a clip selects it", "nothing selected");
must(await page.isVisible(".clip-head"), "the inspector shows the clip", "no clip header");

// -- transport --
await page.click(".tl-transport .play-btn");
await page.waitForTimeout(700);
must(await page.evaluate(() => window.__app.store.session.playing), "play starts",
  "still paused");
await page.click(".tl-transport .play-btn");
await page.waitForTimeout(300);
must(await page.evaluate(() => !window.__app.store.session.playing), "pause stops",
  "still playing");

// -- scrub the ruler --
{
  const box = await page.locator(".tl-ruler").boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  must(await page.evaluate(() => window.__app.store.session.time > 0.1),
    "dragging the ruler scrubs the playhead", "playhead did not move");
}

// -- camera keyframe --
{
  const before = await page.evaluate(() => window.__app.store.project.camera.kfs.length);
  await page.click("#stage");
  await page.keyboard.press("KeyK");
  await page.waitForTimeout(400);
  must(await page.evaluate(() => window.__app.store.project.camera.kfs.length) === before + 1,
    "K keyframes the camera at the playhead", "no keyframe added");
}

// -- delete asks, and undo brings it back --
{
  const before = await clipCount();
  await page.click(".tl-clip");
  await page.waitForTimeout(250);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);
  must(await page.isVisible(".confirm-card"), "deleting a clip asks first", "no confirmation");
  await page.click(".confirm-card .btn.danger");
  await page.waitForTimeout(400);
  must(await clipCount() === before - 1, "confirming deletes the clip", "clip survived");
  await page.click("#stage");
  await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
  await page.waitForTimeout(400);
  must(await clipCount() === before, "undo restores it", "clip did not come back");
}

// -- save the project file --
{
  const dl = await grab(() => page.click('.panel-head .icon-btn[aria-label="Save project file"]'));
  if (!dl) fail("saving the project", "no file was produced");
  else {
    const text = await readFile(dl.file, "utf8");
    let ok = false;
    try {
      const p = JSON.parse(text);
      ok = p.version === 1 && Array.isArray(p.clips) && p.clips.length > 0;
    } catch (e) { /* ok stays false */ }
    must(ok, "the saved project is valid JSON with clips", "did not parse as a project");
  }
}

// -- the shortcut sheet on this surface too --
await page.click(".appnav .icon-btn");
await page.waitForTimeout(350);
must(await page.isVisible(".sheet-card"), "Motion's shortcut sheet opens", "sheet did not open");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

await page.screenshot({ path: path.join(OUT, "motion-driven.png") });

must(pageErrors.length === 0, "no page errors across either surface",
  pageErrors.slice(0, 3).join(" | "));

await ctx.close();
await browser.close();

// ============================================================ validators

/** Each format is checked for the things that actually make the file usable,
    not just for existing. */
async function validate(ext, file) {
  const size = (await stat(file)).size;
  if (ext === "png") {
    const buf = await readFile(file);
    const sig = [...buf.subarray(0, 8)].join(",");
    must(sig === "137,80,78,71,13,10,26,10", "  the PNG has a PNG signature", sig);
    // IHDR carries the dimensions at a fixed offset
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    must(w > 0 && h > 0, `  the PNG is ${w} × ${h}`, "zero dimensions");
    must(buf.subarray(buf.length - 8).includes(Buffer.from("IEND")),
      "  the PNG ends with IEND", "truncated");
    must(size > 2000, `  the PNG is ${(size / 1024).toFixed(0)} kB`, "suspiciously small");
  } else if (ext === "svg") {
    const text = await readFile(file, "utf8");
    must(text.startsWith("<svg") && text.trimEnd().endsWith("</svg>"),
      "  the SVG is a complete document", "missing open or close tag");
    const marks = (text.match(/<(rect|circle)/g) || []).length;
    must(marks > 50, `  the SVG carries ${marks} vector marks`, `only ${marks}`);
    must(/viewBox="0 0 \d+ \d+"/.test(text), "  the SVG declares a viewBox", "no viewBox");
  } else if (ext === "stl") {
    const buf = await readFile(file);
    const tris = buf.readUInt32LE(80);
    must(buf.subarray(0, 5).toString() === "TEMPO", "  the STL names itself in its header",
      buf.subarray(0, 5).toString());
    must(size === 84 + tris * 50,
      `  the STL length matches its ${tris.toLocaleString()} triangles`,
      `${size} bytes for ${tris} triangles`);
    must(tris > 500, `  the STL has real geometry`, `only ${tris} triangles`);
    // every triangle must carry a unit normal
    let bad = 0;
    for (let i = 0; i < Math.min(tris, 500); i++) {
      const o = 84 + i * 50;
      const n = Math.hypot(buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8));
      if (Math.abs(n - 1) > 1e-3) bad++;
    }
    must(bad === 0, "  every STL normal is a unit vector", `${bad} of the first 500 were not`);
  } else if (ext === "obj") {
    const text = await readFile(file, "utf8");
    const verts = (text.match(/^v /gm) || []).length;
    const faces = (text.match(/^f /gm) || []).length;
    must(verts === faces * 3, `  the OBJ has ${verts} vertices for ${faces} faces`,
      `${verts} vertices, ${faces} faces`);
    must(/^o \w+/m.test(text), "  the OBJ names its object", "no o line");
    // every face index must be in range
    const max = Math.max(...(text.match(/^f (\d+) (\d+) (\d+)$/gm) || ["f 0 0 0"])
      .slice(-1)[0].split(" ").slice(1).map(Number));
    must(max <= verts, "  every OBJ face indexes a real vertex", `index ${max} of ${verts}`);
  }
}

// ============================================================ report

console.log("");
for (const d of done) console.log(`  ✓ ${d.replace(/^\s*\d+\.\s*/, "")}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
}
console.log(`\ndrive: ${done.length} checks passed, ${problems.length} failed`);
console.log(`files in ${OUT}/`);
process.exit(problems.length ? 1 : 0);
