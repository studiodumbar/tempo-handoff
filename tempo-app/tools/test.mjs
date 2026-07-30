#!/usr/bin/env node
/* The test suite. Runs against the real app in a real browser — there is no
   build step and no module mocking, so the only honest unit of test is the
   running surface.

   Groups:
     system   the token layer holds and nothing bypasses it
     a11y     names, focus order, reduced motion, contrast
     visual   the Visual surface and its three exports
     motion   the Motion surface, timeline edits, undo, project round-trip

     node tools/test.mjs [--only=group]                                    */
import { chromium } from "playwright";

const BASE = process.env.TEMPO_BASE || "http://localhost:8484";
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

let pass = 0;
const failures = [];
let group = "";

const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    process.stdout.write(".");
  } catch (err) {
    failures.push({ group, name, err: err.message });
    process.stdout.write("F");
  }
};
const eq = (a, b, m = "") => {
  if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const ok = (v, m) => { if (!v) throw new Error(m || "expected truthy"); };

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader"],
});

async function open(url, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  page.__errors = errors;
  return { ctx, page };
}

const run = (name) => !only || only === name;

// ============================================================ system
if (run("system")) {
  group = "system";
  const { ctx, page } = await open("/index.html");

  await t("token layer defines every scale", async () => {
    const missing = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const need = [
        "--sp-1", "--sp-4", "--sp-10", "--gutter",
        "--fs-micro", "--fs-body", "--fs-head", "--lh-body",
        "--r-1", "--r-4", "--r-round",
        "--ctl-s", "--ctl-m", "--ctl-l", "--icon-s", "--icon-m",
        "--elev-1", "--elev-4",
        "--dur-1", "--dur-4", "--dur-exit", "--ease-out", "--ease-in-out",
        "--focus", "--text", "--text-dim", "--text-faint",
      ];
      return need.filter((n) => !cs.getPropertyValue(n).trim());
    });
    eq(missing.join(","), "", "undefined tokens:");
  });

  await t("no component animates a layout property", async () => {
    // transform/opacity only — anything else forces layout or paint per frame
    const bad = await page.evaluate(() => {
      const LAYOUT = /\b(width|height|top|left|right|bottom|margin|padding|grid-template-rows|font-size)\b/;
      const out = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const walk = (list) => {
          for (const r of list) {
            if (r.cssRules) { walk(r.cssRules); continue; }
            const p = r.style?.getPropertyValue("transition-property");
            if (p && LAYOUT.test(p)) out.push(`${r.selectorText}: ${p}`);
          }
        };
        walk(rules);
      }
      return out;
    });
    eq(bad.join(" | "), "", "layout properties in transitions:");
  });

  await t("boots with no console errors", async () => {
    eq(page.__errors.join(" | "), "");
  });

  await ctx.close();
}

// ============================================================ a11y
if (run("a11y")) {
  group = "a11y";
  for (const [surface, url] of [["visual", "/index.html"], ["motion", "/editor.html"]]) {
    const { ctx, page } = await open(url);

    await t(`${surface}: every interactive element has an accessible name`, async () => {
      const unnamed = await page.evaluate(() => {
        const name = (el) =>
          el.getAttribute("aria-label")
          || (el.getAttribute("aria-labelledby")
              && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent)
          || el.textContent.trim()
          || el.getAttribute("title")
          || el.getAttribute("placeholder");
        const out = [];
        for (const el of document.querySelectorAll("button, a[href], input, [role=switch], [role=radio], [role=tab]")) {
          if (el.getAttribute("aria-hidden") === "true") continue;
          if (el.tabIndex < 0) continue;
          // display:none is not focusable and not announced — a hidden file
          // input is a mechanism, not a control
          if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
          if (!name(el)) out.push(`${el.tagName.toLowerCase()}.${(el.className || "").split(" ")[0]}`);
        }
        return [...new Set(out)];
      });
      eq(unnamed.join(", "), "", "unnamed controls:");
    });

    await t(`${surface}: focus-visible paints a designed ring`, async () => {
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const style = await page.evaluate(() => {
        const a = document.activeElement;
        const cs = getComputedStyle(a);
        return { w: cs.outlineWidth, s: cs.outlineStyle, tag: a.tagName };
      });
      ok(style.s === "solid", `outline-style was ${style.s} on ${style.tag}`);
      ok(parseFloat(style.w) >= 2, `outline-width was ${style.w}`);
    });

    await t(`${surface}: no invisible element sits in the tab order`, async () => {
      const ghosts = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll("input, button, a[href]")) {
          if (el.tabIndex < 0) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none") continue;   // not focusable, so not a stop
          const r = el.getBoundingClientRect();
          if (cs.opacity === "0" || cs.visibility === "hidden" || r.width === 0 || r.height === 0) {
            out.push(`${el.tagName.toLowerCase()}.${(el.className || "").split(" ")[0]}`);
          }
        }
        return [...new Set(out)];
      });
      eq(ghosts.join(", "), "", "invisible tab stops:");
    });

    await t(`${surface}: section headers are keyboard operable`, async () => {
      // Motion opens on an empty Clip tab — Scene always has sections
      await page.evaluate(() => {
        document.querySelector('[role=tab][data-tab="scene"]')?.click();
      });
      await page.waitForTimeout(300);
      const n = await page.evaluate(() =>
        document.querySelectorAll("button.section-toggle[aria-expanded]").length);
      ok(n > 0, "no section toggles found");
      const toggled = await page.evaluate(() => {
        const b = document.querySelector("button.section-toggle");
        const before = b.getAttribute("aria-expanded");
        b.focus();
        b.click();
        const after = b.getAttribute("aria-expanded");
        b.click();
        return before !== after;
      });
      ok(toggled, "aria-expanded did not change");
    });

    await t(`${surface}: body text clears 4.5:1 on its own background`, async () => {
      const bad = await page.evaluate(() => {
        const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        const lum = (rgb) => {
          const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((n) => lin(n / 255));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const bgOf = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (c && !c.startsWith("rgba(0, 0, 0, 0)")) return c;
          }
          return "rgb(15,15,15)";
        };
        const out = [];
        for (const el of document.querySelectorAll(".note, .row-label, .field-prefix, .lib-sub, .seq-dur, .menu-hint, .state p")) {
          if (!el.textContent.trim()) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const a = lum(getComputedStyle(el).color) + 0.05;
          const b = lum(bgOf(el)) + 0.05;
          const ratio = Math.max(a, b) / Math.min(a, b);
          if (ratio < 4.5) out.push(`${el.className}: ${ratio.toFixed(2)}`);
        }
        return [...new Set(out)];
      });
      eq(bad.join(", "), "", "below 4.5:1 —");
    });

    await ctx.close();

    // reduced motion is a separate context: the preference is set at creation
    const rm = await open(url, { reducedMotion: "reduce" });
    await t(`${surface}: reduced motion stops movement`, async () => {
      const moving = await rm.page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll("*")) {
          const cs = getComputedStyle(el);
          const props = cs.transitionProperty.split(",").map((s) => s.trim());
          const durs = cs.transitionDuration.split(",").map((s) => parseFloat(s));
          props.forEach((p, i) => {
            const d = durs[i] ?? durs[0] ?? 0;
            if (d > 0.05 && /transform|all/.test(p)) {
              out.push(`${el.className || el.tagName}: ${p} ${d}s`);
            }
          });
          if (cs.animationName !== "none" && parseFloat(cs.animationDuration) < 1
              && cs.animationName !== "spin") {
            out.push(`${el.className || el.tagName}: @${cs.animationName}`);
          }
        }
        return [...new Set(out)].slice(0, 8);
      });
      eq(moving.join(" | "), "", "still moving under reduced motion:");
    });
    await rm.ctx.close();
  }
}

// ============================================================ visual
if (run("visual")) {
  group = "visual";
  const { ctx, page } = await open("/index.html");

  await t("engine boots with the pool allocated", async () => {
    const n = await page.evaluate(() => window.__visual?.engine?.N ?? 0);
    ok(n >= 1024, `pool was ${n}`);
  });

  await t("switching target re-renders", async () => {
    const before = await page.evaluate(() => window.__visual.config.target);
    await page.evaluate(() => window.__visual.setTarget("mode:sphere"));
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__visual.config.target);
    ok(after !== before, "target did not change");
    eq(after, "mode:sphere");
  });

  await t("config survives a reload", async () => {
    await page.evaluate(() => { window.__visual.config.comp.width = 720; });
    await page.evaluate(() => window.__visual.save());
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    const w = await page.evaluate(() => window.__visual.config.comp.width);
    eq(w, 720);
    await page.evaluate(() => { window.__visual.config.comp.width = 1080; window.__visual.save(); });
  });

  await ctx.close();
}

// ============================================================ motion
if (run("motion")) {
  group = "motion";
  const { ctx, page } = await open("/editor.html");

  const clips = () => page.evaluate(() => window.__app.store.project.clips.length);

  await t("starter project loads clips", async () => {
    ok((await clips()) > 0, "no clips");
  });

  await t("adding a clip appends and selects it", async () => {
    const before = await clips();
    await page.evaluate(() => window.__app.actions.addClip("mode", "sphere"));
    eq(await clips(), before + 1);
    const sel = await page.evaluate(() => window.__app.store.session.selection?.type);
    eq(sel, "clip");
  });

  await t("duplicate then delete restores the count", async () => {
    const before = await clips();
    const id = await page.evaluate(() => window.__app.store.session.selection.id);
    await page.evaluate((i) => window.__app.actions.duplicateClip(i), id);
    eq(await clips(), before + 1);
    const dup = await page.evaluate(() => window.__app.store.session.selection.id);
    await page.evaluate((i) => window.__app.actions.removeClip(i), dup);
    eq(await clips(), before);
  });

  await t("undo restores the previous project", async () => {
    const before = await clips();
    await page.evaluate(() => window.__app.actions.addClip("mode", "cube"));
    eq(await clips(), before + 1);
    await page.evaluate(() => window.__app.store.undo());
    eq(await clips(), before);
  });

  await t("seek clamps to the project duration", async () => {
    await page.evaluate(() => window.__app.actions.seek(1e6));
    const { time, total } = await page.evaluate(() => ({
      time: window.__app.store.session.time,
      total: window.__app.projectDuration(),
    }));
    ok(Math.abs(time - total) < 1e-6, `time ${time} vs total ${total}`);
    await page.evaluate(() => window.__app.actions.seek(0));
  });

  await t("camera keyframe lands at the playhead", async () => {
    await page.evaluate(() => window.__app.actions.seek(1));
    const before = await page.evaluate(() => window.__app.store.project.camera.kfs.length);
    await page.evaluate(() => window.__app.actions.addCameraKf());
    const kfs = await page.evaluate(() => window.__app.store.project.camera.kfs);
    eq(kfs.length, before + 1);
    ok(Math.abs(kfs.at(-1).t - 1) < 0.02, `keyframe at ${kfs.at(-1).t}`);
  });

  await t("project round-trips through JSON", async () => {
    const same = await page.evaluate(() => {
      const { store, normalizeProject } = window.__app;
      const json = JSON.stringify(store.project);
      const back = normalizeProject(JSON.parse(json));
      return JSON.stringify(back) === json;
    });
    ok(same, "normalize(parse(stringify(p))) !== p");
  });

  await t("boots with no console errors", async () => {
    eq(page.__errors.join(" | "), "");
  });

  await ctx.close();
}

await browser.close();

console.log(`\n\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`\n  ✗ ${f.group} — ${f.name}\n    ${f.err}`);
process.exit(failures.length ? 1 : 0);
