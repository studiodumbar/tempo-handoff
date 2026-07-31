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

const TIMEOUT = 20_000;

const t = async (name, fn) => {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`timed out after ${TIMEOUT / 1000}s`)), TIMEOUT)),
    ]);
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

  await t("PNG export produces a valid PNG at comp size", async () => {
    const res = await page.evaluate(async () => {
      const blob = await window.__visual.pngBlob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      const bmp = await createImageBitmap(blob);
      return { sig: [...buf.slice(0, 8)], w: bmp.width, h: bmp.height, bytes: buf.length };
    });
    eq(res.sig.join(","), "137,80,78,71,13,10,26,10", "PNG signature");
    const comp = await page.evaluate(() => window.__visual.config.comp);
    const scale = await page.evaluate(() => window.__visual.config.export.scale);
    eq(res.w, comp.width * scale, "PNG width");
    eq(res.h, comp.height * scale, "PNG height");
    ok(res.bytes > 1000, `PNG was only ${res.bytes} bytes`);
  });

  await t("SVG export is well-formed and carries real marks", async () => {
    const svg = await page.evaluate(() => window.__visual.svg());
    ok(svg.startsWith("<svg"), "does not start with <svg");
    ok(svg.trim().endsWith("</svg>"), "does not end with </svg>");
    const marks = (svg.match(/<(rect|circle)/g) || []).length;
    ok(marks > 20, `only ${marks} marks in the SVG`);
    const parsed = await page.evaluate((s) => {
      const d = new DOMParser().parseFromString(s, "image/svg+xml");
      return d.querySelector("parsererror") ? "parse error" : d.documentElement.tagName;
    }, svg);
    eq(parsed, "svg");
  });

  await t("3D export is a valid binary STL", async () => {
    const res = await page.evaluate(async () => {
      const blob = await window.__visual.meshBlob("stl");
      const buf = new Uint8Array(await blob.arrayBuffer());
      const dv = new DataView(buf.buffer);
      return {
        bytes: buf.length,
        tris: dv.getUint32(80, true),
        header: new TextDecoder().decode(buf.slice(0, 5)),
      };
    });
    ok(res.tris > 100, `only ${res.tris} triangles`);
    // binary STL is exactly 84 bytes of header plus 50 per triangle
    eq(res.bytes, 84 + res.tris * 50, "STL byte length");
    eq(res.header, "TEMPO", "STL header");
  });

  await t("3D export also writes OBJ, and the two agree", async () => {
    const res = await page.evaluate(async () => {
      // Both files must come out of ONE picture. meshBlob is synchronous, so
      // taking both before awaiting keeps the render loop from advancing the
      // source between them.
      window.__visual.renderAt(2);
      const objBlob = window.__visual.meshBlob("obj");
      const stlBlob = window.__visual.meshBlob("stl");
      const text = await objBlob.text();
      const stl = new DataView(await stlBlob.arrayBuffer());
      return {
        verts: (text.match(/^v /gm) || []).length,
        faces: (text.match(/^f /gm) || []).length,
        stlTris: stl.getUint32(80, true),
        hasObject: /^o /m.test(text),
      };
    });
    ok(res.faces > 100, `only ${res.faces} faces`);
    eq(res.verts, res.faces * 3, "OBJ vertices per face");
    eq(res.faces, res.stlTris, "OBJ faces vs STL triangles");
    ok(res.hasObject, "OBJ has no object name");
  });

  await t("the relief stands on a backing plate when asked", async () => {
    const [withBase, without] = await page.evaluate(async () => {
      window.__visual.renderAt(2);          // one picture, two settings
      window.__visual.config.export.base = true;
      const a = window.__visual.meshBlob("stl");
      window.__visual.config.export.base = false;
      const c = window.__visual.meshBlob("stl");
      const n = async (b) => new DataView(await b.arrayBuffer()).getUint32(80, true);
      return [await n(a), await n(c)];
    });
    // a box is 12 triangles — exactly the difference the plate makes
    eq(withBase - without, 12, "backing plate triangle count");
    await page.evaluate(() => { window.__visual.config.export.base = true; });
  });

  await t("the source picker groups by kind and filters", async () => {
    await page.click(".source-btn");
    await page.waitForTimeout(250);
    const headings = await page.evaluate(() =>
      [...document.querySelectorAll(".menu-heading")].map((e) => e.textContent));
    eq(headings.join(", "), "Images, 3D models, Animations");
    const all = await page.evaluate(() =>
      [...document.querySelectorAll(".menu-item")].filter((e) => !e.hidden).length);
    ok(all > 50, `picker showed only ${all} sources`);
    await page.fill(".menu-search-input", "globe");
    await page.waitForTimeout(200);
    const few = await page.evaluate(() =>
      [...document.querySelectorAll(".menu-item")].filter((e) => !e.hidden).length);
    ok(few > 0 && few < all, `filter left ${few} of ${all}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  await t("depth controls appear only for a 3D source", async () => {
    const hasSolid = () => page.evaluate(() =>
      [...document.querySelectorAll("#v-camera .field-prefix")]
        .some((e) => e.textContent === "solid"));
    await page.evaluate(() => window.__visual.setTarget("asset:plate"));
    await page.waitForTimeout(400);
    eq(await hasSolid(), false, "occlusion controls shown for an image:");
    // the camera itself stays, because any source can be orbited
    eq(await page.evaluate(() => !!document.querySelector("#v-camera")), true,
      "camera section missing for an image:");
    await page.evaluate(() => window.__visual.setTarget("asset:mug"));
    await page.waitForTimeout(900);
    eq(await hasSolid(), true, "occlusion controls missing for a model:");
    await page.evaluate(() => window.__visual.setTarget("asset:plate"));
    await page.waitForTimeout(400);
  });

  await t("the reset-view chip appears only once the view has moved", async () => {
    const shown = () => page.evaluate(() => {
      const c = document.querySelector(".stage-chip");
      return c ? !c.hidden : false;
    });
    eq(await shown(), false, "chip visible on an untouched view:");
    await page.evaluate(() => {
      window.__visual.orbitTo(1.2, 0.4);
    });
    await page.waitForTimeout(300);
    eq(await shown(), true, "chip missing after the view moved:");
    await page.click(".stage-chip");
    await page.waitForTimeout(300);
    eq(await shown(), false, "chip stayed after reset:");
  });

  await t("the source picker keeps its rows inside its own card", async () => {
    await page.click(".source-btn");
    await page.waitForTimeout(400);
    // Rows scrolled out of view legitimately sit outside the card's box; what
    // matters is that the card CLIPS them. The bug was an uncapped list inside
    // a capped menu with no overflow, so the rows painted over the panel.
    const box = await page.evaluate(() => {
      const menu = document.querySelector(".menu");
      const scroller = menu.querySelector(".menu-scroll");
      return {
        overflow: getComputedStyle(menu).overflow,
        menuH: Math.round(menu.clientHeight),
        scrollerH: Math.round(scroller.clientHeight),
        content: Math.round(scroller.scrollHeight),
        fitsViewport: menu.getBoundingClientRect().bottom <= window.innerHeight + 1,
      };
    });
    eq(box.overflow, "hidden", "the menu does not clip:");
    ok(box.scrollerH <= box.menuH, `list is ${box.scrollerH}px inside a ${box.menuH}px card`);
    ok(box.content > box.scrollerH, "the list is not actually scrolling");
    ok(box.fitsViewport, "the menu hangs off the bottom of the window");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  });

  await t("the style switch asks before wiping tuning", async () => {
    // drift the look, then try to flip style
    await page.evaluate(() => {
      window.__visual.config.scene.dotR = 1.1;
      window.__visual.buildPanel();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const segs = [...document.querySelectorAll("#v-look .seg-btn")];
      segs.find((b) => b.textContent === "Braille").click();
    });
    await page.waitForTimeout(250);
    ok(await page.evaluate(() => !!document.querySelector(".confirm-card")),
      "flipping style wiped the look with no question");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => window.__visual.config.scene.dotR), 1.1,
      "Escape did not keep the tuning");
    await page.evaluate(() => {
      window.__visual.config.scene.dotR = 0.52;
      window.__visual.buildPanel();
    });
  });

  await t("no explanatory prose survives in the panel", async () => {
    const prose = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".panel .note, .panel p")) {
        const t2 = el.textContent.trim();
        if (t2.split(/\s+/).length > 6) out.push(t2.slice(0, 60));
      }
      return out;
    });
    eq(prose.join(" | "), "", "prose found:");
  });

  await t("the export action is pinned, not scrolled past", async () => {
    const inView = await page.evaluate(() => {
      const btn = document.querySelector(".panel-foot .btn.primary");
      if (!btn) return "missing";
      const body = document.querySelector(".v-panel-main .panel-body");
      body.scrollTop = body.scrollHeight;         // scroll the panel to its end
      const r = btn.getBoundingClientRect();
      return r.bottom <= window.innerHeight && r.top >= 0 ? "visible" : "off-screen";
    });
    eq(inView, "visible");
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
    await page.evaluate((i) => window.__app.actions.removeClip(i, { confirm: false }), dup);
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

  await t("deleting a clip asks first, and Escape cancels", async () => {
    const before = await clips();
    const id = await page.evaluate(() => window.__app.store.project.clips[0].id);
    await page.evaluate((i) => { window.__app.actions.removeClip(i); }, id);
    await page.waitForTimeout(250);
    const asking = await page.evaluate(() => !!document.querySelector(".confirm-card"));
    ok(asking, "no confirmation surfaced");
    eq(await clips(), before, "the clip went before the question was answered");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    eq(await clips(), before, "Escape did not cancel");
  });

  await t("confirming the delete removes the clip", async () => {
    const before = await clips();
    const id = await page.evaluate(() => window.__app.store.project.clips[0].id);
    await page.evaluate((i) => { window.__app.actions.removeClip(i); }, id);
    await page.waitForTimeout(250);
    await page.click(".confirm-card .btn.danger");
    await page.waitForTimeout(250);
    eq(await clips(), before - 1);
    await page.evaluate(() => window.__app.store.undo());
    eq(await clips(), before, "undo did not restore it");
  });

  await t("the library filters, and Enter takes the first match", async () => {
    const all = await page.evaluate(() =>
      document.querySelectorAll(".lib-section .lib-list .lib-row").length);
    ok(all > 50, `library showed only ${all} rows`);
    await page.fill(".lib-search input", "globe");
    await page.waitForTimeout(200);
    const few = await page.evaluate(() =>
      document.querySelectorAll(".lib-section .lib-list .lib-row").length);
    ok(few > 0 && few < all, `filter left ${few} of ${all}`);
    const before = await clips();
    await page.press(".lib-search input", "Enter");
    await page.waitForTimeout(300);
    eq(await clips(), before + 1, "Enter did not add the first match");
    await page.press(".lib-search input", "Escape");
    await page.waitForTimeout(200);
    eq(await page.evaluate(() =>
      document.querySelectorAll(".lib-section .lib-list .lib-row").length), all,
    "Escape did not clear the filter");
    await page.evaluate(() => window.__app.store.undo());
  });

  await t("scrubbing a value does not rebuild the clip list", async () => {
    const rebuilds = await page.evaluate(async () => {
      const list = document.querySelector(".seq-list");
      let n = 0;
      const mo = new MutationObserver((ms) => {
        for (const m of ms) if (m.type === "childList" && m.removedNodes.length) n++;
      });
      mo.observe(list, { childList: true });
      // 120 coalesced mutations, as a value drag produces
      for (let i = 0; i < 120; i++) {
        window.__app.store.mutate((proj) => {
          proj.clips[0].trans.spread = 0.3 + i / 400;
        }, { coalesce: "t.spread" });
        await new Promise((r) => setTimeout(r, 1));
      }
      mo.disconnect();
      return n;
    });
    eq(rebuilds, 0, "clip-list rebuilds during a scrub:");
  });

  await t("renaming a clip does rebuild the list", async () => {
    const rebuilds = await page.evaluate(async () => {
      const list = document.querySelector(".seq-list");
      let n = 0;
      const mo = new MutationObserver((ms) => {
        for (const m of ms) if (m.type === "childList" && m.removedNodes.length) n++;
      });
      mo.observe(list, { childList: true });
      window.__app.store.mutate((proj) => { proj.clips[0].label = "renamed"; });
      await new Promise((r) => setTimeout(r, 60));
      mo.disconnect();
      return n;
    });
    ok(rebuilds > 0, "the list ignored a change it displays");
    await page.evaluate(() => window.__app.store.undo());
  });

  await t("no explanatory prose survives in either panel", async () => {
    // the rule: if a control needs a paragraph, the control is wrong
    const prose = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".panel .note, .panel p")) {
        const t2 = el.textContent.trim();
        if (t2.split(/\s+/).length > 6) out.push(t2.slice(0, 60));
      }
      return out;
    });
    eq(prose.join(" | "), "", "prose found:");
  });

  await t("the export action is pinned on this surface too", async () => {
    await page.evaluate(() => {
      document.querySelector('[role=tab][data-tab="export"]').click();
    });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => {
      const btn = document.querySelector(".insp-foot .btn.primary");
      if (!btn) return "missing";
      const body = document.querySelector(".right-panel .panel-body");
      body.scrollTop = body.scrollHeight;
      const r = btn.getBoundingClientRect();
      return r.bottom <= window.innerHeight && r.top >= 0 ? "visible" : "off-screen";
    });
    eq(state, "visible");
    await page.evaluate(() => {
      document.querySelector('[role=tab][data-tab="clip"]').click();
    });
    await page.waitForTimeout(300);
  });

  await t("the shortcut sheet opens from the chrome and from ?", async () => {
    await page.click(".appnav .icon-btn");
    await page.waitForTimeout(250);
    const rows = await page.evaluate(() => document.querySelectorAll(".sheet-row").length);
    ok(rows > 10, `sheet listed only ${rows} shortcuts`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => !!document.querySelector(".sheet-card")), false);
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press("?");
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => !!document.querySelector(".sheet-card")), true);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  });

  await t("boots with no console errors", async () => {
    eq(page.__errors.join(" | "), "");
  });

  await ctx.close();
}

// ============================================================ deployed
// models/ is .vercelignored, so on the deployed site every GLB 404s. That is
// the state most people meet the app in, and nothing tested it.
if (run("deployed")) {
  group = "deployed";
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/models/**", (r) => r.fulfill({ status: 404, body: "" }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/index.html`, { waitUntil: "load" });
  await page.waitForTimeout(2000);

  await t("Visual still opens on its plate when no model can load", async () => {
    eq(await page.evaluate(() => window.__visual.config.target), "asset:plate");
    const marks = await page.evaluate(() => (window.__visual.svg().match(/<rect|<circle/g) || []).length);
    ok(marks > 50, `the stage drew only ${marks} marks`);
  });

  await t("picking an unavailable model says so and falls back", async () => {
    await page.evaluate(() => window.__visual.setTarget("asset:mug"));
    await page.waitForTimeout(2500);
    const toastText = await page.evaluate(() =>
      [...document.querySelectorAll(".toast")].map((t2) => t2.textContent).join(" | "));
    ok(/not available|Could not/i.test(toastText), `no explanation shown — toasts: "${toastText}"`);
    eq(await page.evaluate(() => window.__visual.config.target), "asset:plate",
      "left staring at an empty canvas:");
  });

  await t("no unhandled error escapes the failed load", async () => {
    eq(errors.join(" | "), "");
  });

  await t("Motion survives a project whose assets 404", async () => {
    const m = await ctx.newPage();
    const merr = [];
    m.on("pageerror", (e) => merr.push(String(e)));
    await m.route("**/models/**", (r) => r.fulfill({ status: 404, body: "" }));
    await m.goto(`${BASE}/editor.html`, { waitUntil: "load" });
    await m.waitForTimeout(2500);
    eq(merr.join(" | "), "", "page errors:");
    const state = await m.evaluate(() =>
      window.__app.library.assets().filter((a) => a.state === "error").length);
    ok(state > 0, "the library did not mark any asset as failed");
    // and the surface is still usable
    const before = await m.evaluate(() => window.__app.store.project.clips.length);
    await m.evaluate(() => window.__app.actions.addClip("mode", "sphere"));
    eq(await m.evaluate(() => window.__app.store.project.clips.length), before + 1,
      "could not add a clip after a failed asset load");
    await m.close();
  });

  await ctx.close();
}

// ============================================================ layout
if (run("layout")) {
  group = "layout";
  for (const [surface, url] of [["visual", "/index.html"], ["motion", "/editor.html"]]) {
    for (const w of [1440, 1024, 768]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(BASE + url, { waitUntil: "load" });
      await page.waitForTimeout(1600);

      await t(`${surface} at ${w}: nothing overlaps the stage`, async () => {
        const hits = await page.evaluate(() => {
          const stage = document.getElementById("stage").getBoundingClientRect();
          const out = [];
          for (const p of document.querySelectorAll(".panel")) {
            const cs = getComputedStyle(p);
            if (cs.display === "none") continue;
            // a drawer parked off-canvas is not overlapping anything
            if (cs.transform !== "none" && cs.transform.includes("-")) continue;
            const r = p.getBoundingClientRect();
            const over = !(r.right <= stage.left || r.left >= stage.right
              || r.bottom <= stage.top || r.top >= stage.bottom);
            if (over) out.push(p.className);
          }
          return out;
        });
        eq(hits.join(", "), "", "panels over the stage:");
      });

      await t(`${surface} at ${w}: the stage is a usable size`, async () => {
        const frac = await page.evaluate(() => {
          const s = document.getElementById("stage").getBoundingClientRect();
          return +(s.width / window.innerWidth).toFixed(3);
        });
        ok(frac > 0.35, `stage took only ${Math.round(frac * 100)}% of the width`);
      });

      await t(`${surface} at ${w}: no content is cut off inside a panel`, async () => {
        const clipped = await page.evaluate(() => {
          const out = [];
          for (const p of document.querySelectorAll(".panel")) {
            if (getComputedStyle(p).display === "none") continue;
            for (const kid of p.children) {
              const cs = getComputedStyle(kid);
              if (cs.overflowY === "auto" || cs.overflowY === "scroll") continue;
              if (kid.scrollHeight > kid.clientHeight + 2) {
                out.push(`${p.className.split(" ")[1]} > ${kid.className}`);
              }
            }
          }
          return out;
        });
        eq(clipped.join(", "), "", "clipped:");
      });

      await t(`${surface} at ${w}: the drawer handle appears only when needed`, async () => {
        const shown = await page.evaluate(() => {
          const tab = document.querySelector(".lib-tab");
          return tab ? getComputedStyle(tab).display !== "none" : false;
        });
        const wantsDrawer = w <= 900 && surface === "motion";
        eq(shown, wantsDrawer, `drawer handle at ${w}px:`);
      });

      await t(`${surface} at ${w}: the page never scrolls sideways`, async () => {
        const over = await page.evaluate(() =>
          document.documentElement.scrollWidth - window.innerWidth);
        ok(over <= 0, `${over}px of horizontal overflow`);
      });

      await ctx.close();
    }
  }
}

await browser.close();

console.log(`\n\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`\n  ✗ ${f.group} — ${f.name}\n    ${f.err}`);
process.exit(failures.length ? 1 : 0);
