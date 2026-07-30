#!/usr/bin/env node
/* Screenshot every surface at the three review widths, and report anything the
   page logged to the console while it booted. Run against the dev server:

     node tools/shoot.mjs [outDir] [--page=name] [--width=1440]

   Chromium runs headed-in-a-frame (not headless-shell) because the stage is
   WebGL2 — the shell has no GPU path and every shot would come back black. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.TEMPO_BASE || "http://localhost:8484";
const OUT = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : "shots";
const argOf = (k) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : null;
};

export const PAGES = [
  { name: "visual", url: "/index.html" },
  { name: "motion", url: "/editor.html" },

  /* States are surfaces too. A panel nobody screenshots is a panel nobody
     critiques — the inspector's own tabs, the pickers and the dialogs were
     invisible to this tool until they were named here. */
  {
    name: "motion-clip", url: "/editor.html",
    setup: async (p) => {
      await p.click(".tl-clip");
      await p.waitForTimeout(500);
    },
  },
  {
    name: "motion-scene", url: "/editor.html",
    setup: async (p) => {
      await p.click('[role=tab][data-tab="scene"]');
      await p.waitForTimeout(400);
    },
  },
  {
    name: "motion-export", url: "/editor.html",
    setup: async (p) => {
      await p.click('[role=tab][data-tab="export"]');
      await p.waitForTimeout(400);
    },
  },
  {
    name: "visual-picker", url: "/index.html",
    setup: async (p) => {
      await p.click(".source-btn");
      await p.waitForTimeout(500);
    },
  },
  {
    name: "visual-confirm", url: "/index.html",
    setup: async (p) => {
      await p.evaluate(() => {
        window.__visual.config.scene.dotR = 1.2;
        window.__visual.buildPanel();
      });
      await p.waitForTimeout(250);
      await p.click('#v-look .seg-btn:has-text("Braille")');
      await p.waitForTimeout(500);
    },
  },
  {
    name: "shortcuts", url: "/editor.html",
    setup: async (p) => {
      await p.click(".appnav .icon-btn");
      await p.waitForTimeout(500);
    },
  },
];

const WIDTHS = [
  { w: 1440, h: 900 },
  { w: 1024, h: 768 },
  { w: 768, h: 900 },
];

const only = argOf("page");
const onlyW = argOf("width");

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=metal",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
  ],
});

await mkdir(OUT, { recursive: true });
const report = [];

for (const page of PAGES) {
  if (only && page.name !== only) continue;
  for (const { w, h } of WIDTHS) {
    if (onlyW && String(w) !== onlyW) continue;
    if (page.setup && !onlyW && w !== 1440) continue;   // states: one width
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
    });
    const tab = await ctx.newPage();
    const logs = [];
    tab.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
    });
    tab.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await tab.goto(BASE + page.url, { waitUntil: "load" });
    await tab.waitForTimeout(2500);
    if (page.setup) {
      try { await page.setup(tab); } catch (err) { logs.push(`setup: ${err.message}`); }
    }
    const file = path.join(OUT, `${page.name}-${w}.png`);
    await tab.screenshot({ path: file });
    report.push({ page: page.name, width: w, file, logs });
    await ctx.close();
  }
}

await browser.close();
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`${r.file}${r.logs.length ? `\n  ${r.logs.join("\n  ")}` : ""}`);
}
