#!/usr/bin/env node
/* Perf baseline for a no-build ESM app. There is no bundler, so "bundle size
   per chunk" is the transferred bytes per module, taken from the network log
   of a real load — that is the number a browser actually pays.

   Reports, per surface:
     bytes      total + per-module transfer, app code vs vendor
     boot       navigationStart -> first rendered frame
     fps        sustained frame rate over a 4s sample, and worst frame
     longtasks  main-thread blocks > 50ms during boot

     node tools/perf.mjs [--json=path] */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const BASE = process.env.TEMPO_BASE || "http://localhost:8484";
const argOf = (k) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : null;
};

const SURFACES = [
  { name: "visual", url: "/index.html" },
  { name: "motion", url: "/editor.html" },
];

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader"],
});

const out = [];

for (const s of SURFACES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();

  const bytes = new Map();
  tab.on("response", async (res) => {
    const url = new URL(res.url());
    if (url.origin !== new URL(BASE).origin) return;
    try {
      const buf = await res.body();
      bytes.set(url.pathname, buf.length);
    } catch {}
  });

  await tab.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration));
      }).observe({ entryTypes: ["longtask"] });
    } catch {}
    window.__firstFrame = null;
    const mark = () => { window.__firstFrame = performance.now(); };
    requestAnimationFrame(() => requestAnimationFrame(mark));
  });

  await tab.goto(BASE + s.url, { waitUntil: "load" });
  await tab.waitForTimeout(3000);

  // sustained frame rate — 4s of rAF deltas, after the scene has settled
  const fps = await tab.evaluate(() => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const until = last + 4000;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now < until) requestAnimationFrame(tick);
      else {
        const sorted = [...deltas].sort((a, b) => a - b);
        const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        resolve({
          frames: deltas.length,
          fps: +(1000 / mean).toFixed(1),
          p95ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
          worstMs: +sorted.at(-1).toFixed(1),
        });
      }
    };
    requestAnimationFrame(tick);
  }));

  const nav = await tab.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] || {};
    const paint = performance.getEntriesByType("paint");
    return {
      domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
      load: Math.round(n.loadEventEnd || 0),
      fcp: Math.round(paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0),
      firstFrame: Math.round(window.__firstFrame || 0),
      longTasks: window.__longTasks.slice(),
      heapMB: performance.memory
        ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    };
  });

  const list = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
  const total = list.reduce((a, [, n]) => a + n, 0);
  const vendor = list.filter(([p]) => p.startsWith("/vendor/")).reduce((a, [, n]) => a + n, 0);
  const app = list.filter(([p]) => p.startsWith("/src/")).reduce((a, [, n]) => a + n, 0);

  out.push({ surface: s.name, totalBytes: total, vendorBytes: vendor, appBytes: app,
    modules: list.slice(0, 14).map(([p, n]) => ({ path: p, bytes: n })), ...nav, ...fps });

  await ctx.close();
}

await browser.close();

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
for (const r of out) {
  console.log(`\n## ${r.surface}`);
  console.log(`  transfer   ${kb(r.totalBytes)} total — app ${kb(r.appBytes)}, vendor ${kb(r.vendorBytes)}`);
  console.log(`  fcp        ${r.fcp} ms      dcl ${r.domContentLoaded} ms   load ${r.load} ms`);
  console.log(`  firstFrame ${r.firstFrame} ms`);
  console.log(`  fps        ${r.fps} (p95 frame ${r.p95ms} ms, worst ${r.worstMs} ms)`);
  console.log(`  longtasks  ${r.longTasks.length ? r.longTasks.join(", ") + " ms" : "none"}`);
  console.log(`  heap       ${r.heapMB ?? "n/a"} MB`);
  console.log(`  top modules:`);
  for (const m of r.modules) console.log(`    ${kb(m.bytes).padStart(10)}  ${m.path}`);
}

const json = argOf("json");
if (json) await writeFile(json, JSON.stringify(out, null, 2));
