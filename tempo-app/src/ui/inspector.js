// The right panel — the inspector. Three tabs, Figma-style:
//   CLIP    what's selected: timing, transition, text and parameters
//   SCENE   the composition, camera, terminal feel, glyph pass, render
//   EXPORT  format, fps, range, and the render button
//
// The layout language is Figma's: compact icon-prefixed fields in a
// two-column grid (drag the prefix — or the field — to scrub), segmented
// icon controls for alignment-style choices, switches on quiet label rows,
// and collapsible sections with the advanced ones closed by default.
//
// Rebuilds only when the STRUCTURE of what it shows changes; plain value
// changes refresh fields in place so an active drag is never interrupted.

import { h, icon, showMenu, confirmAction } from "./dom.js";
import {
  NumberField, SelectField, SwitchField, ColorField, TextField, SegmentedField,
  row, section, grid2, button,
} from "./fields.js";
import { EASE_NAMES } from "../easing.js";
import { STAGGER_AXES, BLOCK_ORDERS, PATH_MODES } from "../particles.js";
import {
  baseModeFor, segments, totalDuration, invalidateClip, invalidatePair,
  CAM_EASES, INTRO_STYLES, fmtSeconds,
} from "../sequence.js";

const FPS_OPTIONS = [12, 24, 25, 30, 50, 60];

export function buildInspector(app) {
  const { store } = app;
  let tab = "clip";
  let fields = [];
  let structureKey = "";

  const mut = (fn, ckey, live, topic) => {
    store.mutate(fn, { coalesce: ckey, topic });
    if (!live) store.endCoalesce();
  };

  // ---- tab strip ----
  const tabNames = [["clip", "Clip"], ["scene", "Scene"], ["export", "Export"]];
  const pill = h("span", { class: "tab-pill", "aria-hidden": "true" });
  const tabBtns = tabNames.map(([id, label]) => {
    const b = h("button", {
      class: "tab-btn", role: "tab", dataset: { tab: id }, "aria-selected": "false",
    }, label);
    b.addEventListener("click", () => { tab = id; render(); });
    return b;
  });
  // arrow keys move between tabs; the strip is one tab stop (roving tabindex)
  const tabs = h("div", { class: "tabs", role: "tablist" }, pill, ...tabBtns);
  tabs.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = tabNames.findIndex(([id]) => id === tab);
    tab = tabNames[(i + d + tabNames.length) % tabNames.length][0];
    render();
    tabBtns.find((b) => b.dataset.tab === tab)?.focus();
  });

  const body = h("div", { class: "panel-body" });
  // Anything a tab hands back with a .panel-foot class is lifted out of the
  // scroll and pinned here, so Motion's export action is as reachable as
  // Visual's — one pattern for the primary action on both surfaces.
  const foot = h("div", { class: "insp-foot", hidden: true });
  const panel = h("div", { class: "panel right-panel" }, tabs, body, foot);

  // The pill is a 1px block stretched by transform, never by width: width is a
  // layout property and animating it relayouts the tab strip every frame.
  function positionPill() {
    const active = tabBtns.find((b) => b.dataset.tab === tab);
    if (!active) return;
    pill.style.transform =
      `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth})`;
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  }

  // ---- field builders (all register for refresh) ----
  function num(get, set, o = {}) {
    const f = NumberField({ get, set, ...o });
    fields.push(f);
    return f;
  }
  function sel(get, set, options, o = {}) {
    const f = SelectField({ get, set, options, ...o });
    fields.push(f);
    return f;
  }
  function sw(get, set) {
    const f = SwitchField({ get, set });
    fields.push(f);
    return f;
  }
  function col(get, set, label) {
    const f = ColorField({ get, set, label });
    fields.push(f);
    return f;
  }
  function seg(get, set, options) {
    const f = SegmentedField({ get, set, options });
    fields.push(f);
    return f;
  }
  /** A read-only value presented like a quiet field. */
  function readout(getText) {
    const span = h("span", { class: "readout-text" });
    const f = {
      el: h("div", { class: "field readout-field" }, span),
      refresh() { span.textContent = getText(); },
    };
    f.refresh();
    fields.push(f);
    return f;
  }

  const optIdx = (names) => names.map((n, i) => ({ value: i, label: n }));

  // ---- the photo lane's panel ----
  function photoTab(ph) {
    const pid = ph.id;
    const F = (key, label, min, max, step) => num(
      () => {
        const x = (store.project.photos || []).find((y) => y.id === pid);
        return x ? (x[key] ?? 0) : 0;
      },
      (v, live) => {
        store.mutate((p) => {
          const x = p.photos.find((y) => y.id === pid);
          if (x) x[key] = v;
        }, { coalesce: `ph.${key}.${pid}` });
        if (!live) store.endCoalesce();
      },
      { min, max, step, prefix: { text: label, tip: label } });
    return [
      h("div", { class: "insp-head" },
        h("div", { class: "insp-title" }, ph.label || ph.key),
        h("div", { class: "insp-sub" }, "photo lane — drawn over the dots")),
      section("Timing", [
        grid2(F("start", "start", 0, 600, 0.05), F("dur", "dur", 0.1, 120, 0.05)),
        grid2(F("fadeIn", "fade in", 0, 5, 0.05), F("fadeOut", "fade out", 0, 5, 0.05)),
      ]),
      section("Reveal", [
        grid2(
          sel(() => {
            const x = (store.project.photos || []).find((y) => y.id === pid);
            return x ? Math.round(x.reveal ?? 0) : 0;
          }, (v) => {
            store.mutate((p) => {
              const x = p.photos.find((y) => y.id === pid);
              if (x) x.reveal = v;
            });
          }, optIdx(["fade", "blocks"]), { prefix: { text: "in/out", tip: "How the photo arrives and leaves" } }),
          sel(() => {
            const x = (store.project.photos || []).find((y) => y.id === pid);
            return x ? Math.round(x.order ?? 0) : 0;
          }, (v) => {
            store.mutate((p) => {
              const x = p.photos.find((y) => y.id === pid);
              if (x) x.order = v;
            });
          }, optIdx(BLOCK_ORDERS), { prefix: { text: "order", tip: "Tile schedule" } }),
        ),
        grid2(F("cols", "cols", 2, 40, 1), F("vary", "vary", 0, 6, 0.1)),
        grid2(F("seed", "seed", 0, 99, 1), null),
      ]),
      section("Look", [
        grid2(
          num(
            () => {
              const x = (store.project.photos || []).find((y) => y.id === pid);
              return x ? (x.alpha ?? 1) : 1;
            },
            (v, live) => {
              store.mutate((p) => {
                const x = p.photos.find((y) => y.id === pid);
                if (x) x.alpha = v;
              }, { coalesce: `ph.alpha.${pid}` });
              if (!live) store.endCoalesce();
            },
            { min: 0, max: 1, step: 0.01,
              prefix: { text: "alpha", tip: "Opacity. Placement follows the image asset's own size, spin and tilt" } },
          ),
          null,
        ),
      ]),
    ];
  }

  // ================================================================ CLIP TAB
  function clipTab() {
    const kf = store.selectedKf();
    if (kf) return kfEditor(kf);
    const selPh = store.session.selection;
    if (selPh?.type === "photo") {
      const ph = (store.project.photos || []).find((x) => x.id === selPh.id);
      if (ph) return photoTab(ph);
    }
    const clip = store.selectedClip();
    if (!clip) {
      // one line and the action, not a sentence and a footnote
      return [h("div", { class: "state" },
        icon("layers"),
        h("p", {}, "No clip selected"),
        button("Add a clip", {
          variant: "subtle", iconName: "plus",
          onClick: () => app.actions.focusLibrary(),
        }))];
    }
    const cid = clip.id;
    const getClip = () => store.project.clips.find((c) => c.id === cid);
    const index = () => store.project.clips.findIndex((c) => c.id === cid);
    const base = baseModeFor(clip);
    const first = index() === 0;

    const out = [];

    // -- identity header --
    const nameF = TextField({
      get: () => getClip()?.label ?? "",
      set: (v) => mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.label = v; }),
    });
    fields.push(nameF);
    const metaRange = h("span", { class: "meta-times" });
    const metaChip = h("span", { class: "chip" });
    const refreshMeta = () => {
      const c = getClip();
      if (!c) return;
      const seg2 = segments(store.project.clips)[index()];
      metaChip.textContent = "";
      metaChip.append(
        icon(c.kind === "mode" ? "wave" : "box"),
        c.key.replace("asset:", ""));
      metaRange.textContent = `${fmtSeconds(seg2.start)} – ${fmtSeconds(seg2.end)}`;
    };
    refreshMeta();
    fields.push({ refresh: refreshMeta });
    out.push(h("div", { class: "clip-head" },
      nameF.el,
      h("div", { class: "clip-head-meta" }, metaChip, metaRange)));

    // -- timing --
    const holdF = num(
      () => getClip()?.hold ?? 0,
      (v, live) => mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.hold = v; }, `hold${cid}`, live),
      { min: 0, max: 60, step: 0.05, unit: "s", prefix: { text: "hold", tip: "How long the pool rests here" } },
    );
    const hasIntro = first && (clip.intro | 0) > 0;
    const durF = first && !hasIntro ? null : num(
      () => getClip()?.trans.duration ?? 0,
      (v, live) => mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.trans.duration = v; }, `dur${cid}`, live),
      { min: 0, max: 10, step: 0.05, unit: "s", prefix: { text: "in", tip: first ? "The opening flight" : "The flight in from the clip before" } },
    );
    const delayF = !first ? null : num(
      () => getClip()?.delay ?? 0,
      (v, live) => mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.delay = v; }, `dly${cid}`, live),
      { min: 0, max: 30, step: 0.05, unit: "s", prefix: { text: "delay", tip: "Black before the sequence begins" } },
    );
    /* Pack whatever fields this clip actually has two-per-row. Passing a null
       into grid2 left an empty cell, so the first clip's hold sat in the right
       column with its delay alone underneath — two values, three cells, no
       alignment. */
    const pack = (fields2) => {
      const live = fields2.filter(Boolean);
      const rows = [];
      for (let i = 0; i < live.length; i += 2) rows.push(grid2(live[i], live[i + 1] ?? null));
      return rows;
    };

    out.push(section("Timing", [
      ...pack([durF, holdF, delayF]),
      // The note here used to read "The first clip opens already settled — add
      // an intro below to animate it in." The control it pointed at is this
      // one, so it moved up to where the reader already is.
      first ? row("Opens", sel(
        () => getClip()?.intro ?? 0,
        (v) => mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.intro = v; }),
        optIdx(INTRO_STYLES),
      ), { tipText: "How the pool arrives — settled, printed in place, burst from the centre, assembled from a cloud, rained in, or converged from beyond the rim" }) : null,
      row("Ends", sel(
        () => getClip()?.outro ?? 0,
        (v) => mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.outro = v; }),
        optIdx(INTRO_STYLES),
      ), { tipText: "How the pool leaves. A following clip then enters from the state this left behind" }),
    ].filter(Boolean), { id: "clip-timing" }));

    // -- transition / intro / exit --
    // All the same flight; intros and exits just supply a synthetic far side.
    // Every helper binds to a transition object by root: "trans" (the entry)
    // or "outroTrans" (the exit's own controls).
    const T = (key, o, root = "trans") => num(
      () => getClip()?.[root]?.[key],
      (v, live) => mut((p) => {
        const c = p.clips.find((x) => x.id === cid);
        if (c) (c[root] = c[root] || {})[key] = v;
      }, `tr.${root}.${key}.${cid}`, live),
      o,
    );
    const TS = (key, names, o, root = "trans") => sel(
      () => getClip()?.[root]?.[key],
      (v) => mut((p) => {
        const c = p.clips.find((x) => x.id === cid);
        if (c) (c[root] = c[root] || {})[key] = v;
        if (key === "staggerAxis") invalidatePair();
      }),
      optIdx(names),
      o,
    );
    // mosaic fields predate some saved projects — read through a default
    const TB = (key, dflt, o, root = "trans") => num(
      () => getClip()?.[root]?.[key] ?? dflt,
      (v, live) => mut((p) => {
        const c = p.clips.find((x) => x.id === cid);
        if (c) (c[root] = c[root] || {})[key] = v;
      }, `tr.${root}.${key}.${cid}`, live),
      o,
    );
    const TSB = (key, dflt, names, o, root = "trans") => sel(
      () => getClip()?.[root]?.[key] ?? dflt,
      (v) => mut((p) => {
        const c = p.clips.find((x) => x.id === cid);
        if (c) (c[root] = c[root] || {})[key] = v;
      }),
      optIdx(names),
      o,
    );
    const isMosaic = (root = "trans") => (getClip()?.[root]?.staggerAxis ?? 0) >= 4;
    const mosaicRows = (root = "trans") => {
      const dbgF = SwitchField({
        get: () => !!store.session.debugTiles,
        set: (v) => store.set({ debugTiles: v }),
      });
      fields.push(dbgF);
      return [
        grid2(
          TSB("blockOrder", 0, BLOCK_ORDERS,
            { prefix: { icon: "orderRows" }, tipText: "The schedule — staircase: ragged rows · type/serpent/cascade: cell-by-cell cursors · spiral: centre-out · scatter: random · rows: a row at a time · interlace: CRT fields · unfold: rows from the centre · curtain: columns from the edges" }, root),
          null,
        ),
        grid2(
          TB("blocksX", 6, { min: 2, max: 48, step: 1, prefix: { text: "cols", tip: "Mosaic columns" } }, root),
          TB("blocksY", 0, { min: 0, max: 48, step: 1, prefix: { text: "rows", tip: "Mosaic rows — 0 keeps tiles screen-square" } }, root),
        ),
        grid2(
          TB("blockLag", 1.7, { min: 0, max: 4, step: 0.1, prefix: { text: "vary", tip: "Staircase randomness — how many rows a tile may trail (staircase order only; 0 = clean row sweep)" } }, root),
          TB("blockSeed", 0, { min: 0, max: 99, step: 1, prefix: { text: "seed", tip: "Re-roll the pattern (staircase and scatter orders)" } }, root),
        ),
        grid2(
          TSB("printStyle", 0, ["none", "fill", "stroke"],
            { prefix: { icon: "box" }, tipText: "Print the blocks themselves — solid fill or outline — each dissolving into a braille taper behind the front" }, root),
          TB("printTrail", 0.35, { min: 0.05, max: 1, step: 0.01, prefix: { text: "trail", tip: "How long a printed block lingers before it dissolves away" } }, root),
        ),
        row("Debug tiles", dbgF, { tipText: "Overlay the mosaic grid on the viewport — green tiles have printed, numbers are pop order" }),
      ];
    };
    const flightRows = (root = "trans") => [
      grid2(
        TS("ease", EASE_NAMES, { prefix: { icon: "curve" }, tipText: "Easing of the flight" }, root),
        TS("staggerAxis", STAGGER_AXES, { prefix: { icon: "orderRows" }, tipText: "Which particles leave first — blocks / blocks out are the mosaic reveal" }, root),
      ),
      ...(isMosaic(root) ? mosaicRows(root) : []),
      grid2(
        TS("path", PATH_MODES, { prefix: { icon: "squiggle" }, tipText: "The route dots take" }, root),
        T("pathAmp", { min: 0, max: 1, step: 0.01, prefix: { icon: "amp", tip: "Path amount — how far it bends" } }, root),
      ),
      grid2(
        T("spread", { min: 0, max: 0.95, step: 0.01, prefix: { icon: "steps", tip: "Spread — how staggered the flight is: 0 all together, 0.95 one-by-one" } }, root),
        T("swirl", { min: -2, max: 2, step: 0.05, prefix: { icon: "swirl", tip: "Swirl — whole-flight turns" } }, root),
      ),
      grid2(
        T("scatter", { min: 0, max: 0.6, step: 0.01, prefix: { icon: "scatterDots", tip: "Scatter — mid-flight puff" } }, root),
        null,
      ),
      grid2(
        TB("whip", 0, { min: -3, max: 3, step: 1, prefix: { icon: "swirl", tip: "Whip — WHOLE turns through this cut (whole, so the next clip lands unrotated). Tune the intensity with ramp and soft" } }, root),
        TB("whipRamp", 0.45, { min: 0, max: 3, step: 0.05, prefix: { icon: "curve", tip: "Whip ramp — seconds of spin-up before and spin-down after the morph. Wider = the same turn, gentler" } }, root),
      ),
      grid2(
        TB("whipSoft", 0, { min: 0, max: 1, step: 0.05, prefix: { icon: "amp", tip: "Whip soft — 0 slams the turn through the cut (expo), 1 glides it evenly across the window" } }, root),
        null,
      ),
    ];
    // The flight itself. For the first clip there is only one when an intro
    // is chosen; otherwise it is the transition in from the clip before.
    if (!first) {
      out.push(section("Transition", flightRows(), { id: "clip-transition" }));
    } else if (hasIntro) {
      out.push(section("Intro flight", flightRows(), { id: "clip-intro" }));
    }

    // -- exit: ANY clip can fly OUT (the intro run backwards). Mid-timeline,
    // the screen empties and the NEXT clip enters from the exited state. --
    const hasOutro = (clip.outro | 0) > 0;
    if (hasOutro) {
      out.push(section("Exit flight", [
        grid2(
          TB("duration", 0.9, { min: 0.05, max: 10, step: 0.05, unit: "s", prefix: { text: "out", tip: "The closing flight" } }, "outroTrans"),
          null,
        ),
        ...flightRows("outroTrans"),
      ], { id: "clip-exit" }));
    }

    // -- parameters --
    if (base) {
      let lastRegen = 0;
      const cells = Object.entries(base.params).map(([key, spec]) => {
        const isRegen = base.regen.includes(key);
        const f = num(
          () => {
            const c = getClip();
            return c && c.params[key] !== undefined ? c.params[key] : spec.value;
          },
          (v, live) => {
            mut((p) => {
              const c = p.clips.find((x) => x.id === cid);
              if (c) c.params[key] = v;
            }, `pm.${key}.${cid}`, live);
            if (isRegen) {
              const now = performance.now();
              if (!live || now - lastRegen > 90) {
                lastRegen = now;
                invalidateClip(cid);
                invalidatePair();
              }
            }
          },
          { min: spec.min, max: spec.max, step: spec.step,
            prefix: { text: key, tip: `${key} — double-click to reset` } },
        );
        const prefixEl = f.el.querySelector(".field-prefix");
        const syncOverride = () => {
          const c = getClip();
          prefixEl?.classList.toggle("overridden", !!c && c.params[key] !== undefined);
        };
        syncOverride();
        fields.push({ refresh: syncOverride });
        /* Clearing one override was a right-click menu — a gesture nothing
           announced. Double-click matches Visual, and the field's own tooltip
           names it. Right-click still works for anyone who learned it. */
        const clearOverride = () => {
          const c = getClip();
          if (!c || c.params[key] === undefined) return;
          mut((p) => { const cc = p.clips.find((x) => x.id === cid); if (cc) delete cc.params[key]; });
          if (isRegen) { invalidateClip(cid); invalidatePair(); }
        };
        f.el.addEventListener("dblclick", clearOverride);
        f.el.addEventListener("contextmenu", (e) => { e.preventDefault(); clearOverride(); });
        return f;
      });
      const rows = [];
      for (let i = 0; i < cells.length; i += 2) rows.push(grid2(cells[i], cells[i + 1] ?? null));
      // an action that does nothing is worse than no action: Reset appears
      // only when there is an override to reset
      const overrides = Object.keys(getClip()?.params ?? {}).length;
      const actions = [];
      if (overrides) {
        const resetBtn = h("button", { class: "section-link", type: "button" }, "Reset");
        resetBtn.addEventListener("click", async () => {
          const yes = await confirmAction({
            title: "Reset parameters?",
            body: `${overrides} changed value${overrides > 1 ? "s" : ""} go back to the source's defaults.`,
            confirmLabel: "Reset",
          });
          if (!yes) return;
          mut((p) => { const c = p.clips.find((x) => x.id === cid); if (c) c.params = {}; });
          invalidateClip(cid);
          invalidatePair();
        });
        actions.push(resetBtn);
      }
      out.push(section("Parameters", rows, { actions, id: "clip-params" }));
    } else {
      out.push(section("Parameters", [
        h("div", { class: "loading-row" }, icon("spinner", "spin"), "Sampling…"),
      ], { id: "clip-params" }));
    }

    return out;
  }

  // -- camera keyframe editor --
  function kfEditor(kf) {
    const kid = kf.id;
    const getKf = () => store.project.camera.kfs.find((k) => k.id === kid);
    return [section("Camera keyframe", [
      grid2(
        num(
          () => getKf()?.t ?? 0,
          (v, live) => mut((p) => { const k = p.camera.kfs.find((x) => x.id === kid); if (k) k.t = v; }, `kf.t${kid}`, live),
          { min: 0, max: Math.max(0.01, totalDuration(store.project.clips)), step: 0.01, unit: "s", prefix: { icon: "clock", tip: "Keyframe time" } },
        ),
        sel(
          () => getKf()?.ease ?? "smooth",
          (v) => mut((p) => { const k = p.camera.kfs.find((x) => x.id === kid); if (k) k.ease = v; }),
          CAM_EASES.map((e) => ({ value: e, label: e })),
          { prefix: { icon: "curve" }, tipText: "Ease of the move ARRIVING here" },
        ),
      ),
      h("div", { class: "btn-row" },
        button("Set to view", {
          iconName: "camera", variant: "subtle", wide: true,
          title: "Overwrite with the current viewport camera",
          onClick: () => app.actions.updateKfFromView(kid),
        }),
        button("Go to", {
          iconName: "clock", variant: "subtle",
          onClick: () => { const k = getKf(); if (k) app.actions.seek(k.t); },
        }),
      ),
      h("div", { class: "btn-row" },
        button("Delete keyframe", {
          iconName: "trash", variant: "danger", wide: true,
          onClick: () => app.actions.removeKf(kid),
        }),
      ),
    ], { id: "kf" })];
  }

  // ================================================================ SCENE TAB
  function sceneTab() {
    const comp = () => store.project.comp;
    const scn = () => store.project.scene;
    const cam = () => store.project.camera;
    const S = (key, o) => num(
      () => scn()[key],
      (v, live) => mut((p) => { p.scene[key] = v; }, `sc.${key}`, live),
      o,
    );
    const SW = (key) => sw(
      () => !!scn()[key],
      (v) => mut((p) => { p.scene[key] = v ? (key === "blocks" ? 1 : true) : (key === "blocks" ? 0 : false); }),
    );

    return [
      section("Composition", [
        grid2(
          num(() => comp().width, (v, live) => mut((p) => { p.comp.width = Math.round(v); }, "cw", live),
            { min: 128, max: 4096, step: 2, prefix: { text: "W", tip: "Width" } }),
          num(() => comp().height, (v, live) => mut((p) => { p.comp.height = Math.round(v); }, "ch", live),
            { min: 128, max: 4096, step: 2, prefix: { text: "H", tip: "Height" } }),
        ),
        grid2(
          sel(() => comp().fps, (v) => mut((p) => { p.comp.fps = v; }),
            FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` })),
            { prefix: { icon: "film" }, tipText: "Frame rate" }),
          readout(() => `${fmtSeconds(totalDuration(store.project.clips))} long`),
        ),
        grid2(
          col(() => comp().bg, (v, live) => mut((p) => { p.comp.bg = v; }, "bg", live), "Background"),
          col(() => comp().ink, (v, live) => mut((p) => { p.comp.ink = v; }, "ink", live), "Ink"),
        ),
      ], { id: "sc-comp" }),

      section("Camera", [
        grid2(
          num(() => scn().fov, (v, live) => mut((p) => { p.scene.fov = v; }, "fov", live),
            { min: 15, max: 100, step: 1, unit: "°", prefix: { icon: "camera", tip: "Field of view" } }),
          readout(() => {
            const n = cam().kfs.length;
            return n ? `${n} keyframe${n > 1 ? "s" : ""}` : "no keys";
          }),
        ),
        row("Follow keys", sw(
          () => cam().follow,
          (v) => mut((p) => { p.camera.follow = v; }),
        ), { tipText: "Play and export through the camera keyframes" }),
        h("div", { class: "btn-row" },
          button("Add keyframe", {
            title: "At the playhead — K",
            iconName: "diamondO", variant: "subtle", wide: true,
            onClick: () => app.actions.addCameraKf(),
          })),
      ], { id: "sc-camera" }),

      section("Terminal feel", [
        row("Step rate", sel(
          () => scn().stepFps || 0,
          (v) => mut((p) => { p.scene.stepFps = v; }),
          [{ value: 0, label: "continuous" },
            ...[8, 10, 12, 15, 20, 24].map((f) => ({ value: f, label: `${f} fps` }))],
        ), { tipText: "The scene only reprints at this rate — like a script looping over sleep()" }),
        row("Grid lock", SW("gridLock"), { tipText: "Dots snap to character cells, so travel staggers instead of gliding" }),
        row("Ink levels", sel(
          () => scn().inkLevels || 0,
          (v) => mut((p) => { p.scene.inkLevels = v; }),
          [{ value: 0, label: "smooth" },
            ...[2, 3, 4, 6].map((n) => ({ value: n, label: `${n} steps` }))],
        ), { tipText: "Quantize brightness like ANSI dim / normal / bright" }),
        grid2(
          S("flicker", { min: 0, max: 1, step: 0.01, prefix: { text: "flicker", tip: "Cells occasionally print dim or drop a frame" } }),
          null,
        ),
      ], { id: "sc-term", collapsed: true }),

      section("Glyphs", [
        row("Glyph pass", SW("terminal"), { tipText: "Braille / block terminal rasteriser" }),
        grid2(
          S("cellW", { min: 6, max: 40, step: 1, prefix: { text: "W", tip: "Cell width, px" } }),
          S("cellH", { min: 8, max: 64, step: 1, prefix: { text: "H", tip: "Cell height, px" } }),
        ),
        grid2(
          S("gapX", { min: 0, max: 0.25, step: 0.005, prefix: { text: "gap x", tip: "Glyph seam between columns — blocks & dots inset like real terminal characters" } }),
          S("gapY", { min: 0, max: 0.25, step: 0.005, prefix: { text: "gap y", tip: "Glyph seam between rows" } }),
        ),
        grid2(
          S("dotR", { min: 0.4, max: 1.6, step: 0.02, prefix: { text: "dot", tip: "Braille dot size" } }),
          S("dotThresh", { min: 0.01, max: 0.35, step: 0.005, prefix: { text: "thresh", tip: "Luminance a sub-pixel needs to print" } }),
        ),
        grid2(
          S("dither", { min: 0, max: 1.5, step: 0.01, prefix: { text: "dither", tip: "Tone carried as dot density" } }),
          S("shade", { min: 0, max: 1, step: 0.01, prefix: { text: "shade", tip: "How much luma tints the ink" } }),
        ),
        row("Blocks", SW("blocks"), { tipText: "Bright cells solidify to ▁▂▃ block glyphs" }),
        grid2(
          S("blockLo", { min: 0.15, max: 6, step: 0.05, prefix: { text: "lo", tip: "Mark energy where block chunks begin" } }),
          S("blockHi", { min: 0.4, max: 6.5, step: 0.05, prefix: { text: "hi", tip: "Cell energy that prints fully solid" } }),
        ),
        row("Phosphor", SW("phosphor"), { tipText: "Motion leaves fading CRT trails" }),
        grid2(
          S("persist", { min: 0.05, max: 1.5, step: 0.05, unit: "s", prefix: { text: "persist", tip: "Trail time constant" } }),
          null,
        ),
      ], { id: "sc-glyphs", collapsed: true }),

      section("Render", [
        grid2(
          S("gain", { min: 0.3, max: 3, step: 0.05, prefix: { text: "exp", tip: "Exposure" } }),
          S("baseSize", { min: 0.006, max: 0.06, step: 0.001, prefix: { text: "mark", tip: "Mark size" } }),
        ),
        grid2(
          S("solidity", { min: 0, max: 1, step: 0.01, prefix: { text: "solid", tip: "Assets occlude their own far side" } }),
          S("occBias", { min: 0.01, max: 0.3, step: 0.005, prefix: { text: "bias", tip: "Occlusion slack" } }),
        ),
      ], { id: "sc-render", collapsed: true }),
    ];
  }

  // =============================================================== EXPORT TAB
  function exportTab() {
    const ex = () => store.project.export;
    const comp = () => store.project.comp;

    const est = h("div", { class: "foot-meta" });
    const refreshInfo = () => {
      const total = totalDuration(store.project.clips);
      const start = Math.min(ex().start, total);
      const end = ex().end > start ? Math.min(ex().end, total) : total;
      const fps = ex().fps || comp().fps;
      const frames = Math.max(0, Math.ceil((end - start) * fps));
      const k = Math.max(1, Math.round(ex().scale || 1));
      est.textContent = "";
      est.append(
        h("span", {}, `${comp().width * k} × ${comp().height * k}`),
        h("span", {}, `${frames} frames · ${fmtSeconds(end - start)} @ ${fps} fps`));
    };
    refreshInfo();
    fields.push({ refresh: refreshInfo });

    const isMp4 = () => ex().format === "mp4";
    const qualityGrid = grid2(
      num(() => ex().quality, (v, live) => mut((p) => { p.export.quality = v; }, "q", live),
        { min: 0.2, max: 1, step: 0.05, prefix: { text: "quality", tip: "Bitrate scale for the H.264 encode" } }),
      null,
    );

    const exportBtn = button("", { variant: "primary", wide: true });
    exportBtn.classList.add("large");
    const btnLabel = h("span", {});
    exportBtn.textContent = "";
    exportBtn.append(icon("film"), btnLabel);
    const refreshBtn = () => {
      btnLabel.textContent = isMp4() ? "Export MP4" : "Export frames";
      exportBtn.querySelector(".icon").replaceWith(icon(isMp4() ? "film" : "image"));
      exportBtn.disabled = store.session.exporting || !store.project.clips.length;
      qualityGrid.style.display = isMp4() ? "" : "none";
    };
    refreshBtn();
    fields.push({ refresh: refreshBtn });
    exportBtn.addEventListener("click", () => app.actions.export());

    return [
      section("Output", [
        row("Format", sel(
          () => ex().format,
          (v) => mut((p) => { p.export.format = v; }),
          [{ value: "mp4", label: "MP4 video" }, { value: "png", label: "PNG sequence" }],
        )),
        row("Frame rate", sel(
          () => ex().fps,
          (v) => mut((p) => { p.export.fps = v; }),
          [{ value: 0, label: "Match comp" },
            ...FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps` }))],
        )),
        row("Scale", sel(
          () => ex().scale ?? 1,
          (v) => mut((p) => { p.export.scale = v; }),
          [1, 2, 3, 4].map((k) => ({ value: k, label: `× ${k}` })),
        ), { tipText: "Render at a multiple of the comp size — the braille grid is unchanged, the raster and photograph get the pixels" }),
        qualityGrid,
      ], { id: "ex-output" }),
      section("Range", [
        grid2(
          num(() => ex().start, (v, live) => mut((p) => { p.export.start = v; }, "exs", live),
            { min: 0, max: 600, step: 0.05, unit: "s", prefix: { text: "in", tip: "Range start" } }),
          num(() => ex().end, (v, live) => mut((p) => { p.export.end = v; }, "exe", live),
            { min: 0, max: 600, step: 0.05, unit: "s", prefix: { text: "out", tip: "Range end — 0 is the end of the sequence" } }),
        ),
      ], { id: "ex-range" }),
      h("div", { class: "panel-foot" },
        h("div", { class: "foot-cta" }, exportBtn, h("span", { class: "kbd" }, app.exportKey)),
        est),
    ];
  }

  // ---- render machinery ----
  function computeKey() {
    const s = store.session.selection;
    const clip = store.selectedClip();
    return [
      tab,
      s ? `${s.type}:${s.id}` : "none",
      store.project.clips.length,
      clip ? [
        clip.kind, clip.key, baseModeFor(clip) ? 1 : 0,
        store.project.clips.indexOf(clip),
        (clip.intro | 0) > 0 ? "I" : "",
        (clip.trans.staggerAxis ?? 0) >= 4 ? "M" : "",
        (clip.outro | 0) > 0 ? "O" : "",
        (clip.outroTrans?.staggerAxis ?? 0) >= 4 ? "MO" : "",
        store.project.clips.length,
      ].join("/") : "",
    ].join("|");
  }

  function render() {
    structureKey = computeKey();
    fields = [];
    body.textContent = "";
    foot.textContent = "";
    const parts = tab === "clip" ? clipTab() : tab === "scene" ? sceneTab() : exportTab();
    const pinned = parts.filter((el) => el?.classList?.contains("panel-foot"));
    body.append(...parts.filter((el) => !pinned.includes(el)));
    foot.append(...pinned);
    foot.hidden = !pinned.length;
    positionPill();
  }

  function onChange() {
    if (computeKey() !== structureKey) render();
    else for (const f of fields) f.refresh?.();
  }

  store.on("project", onChange);
  store.on("selection", () => {
    const s = store.session.selection;
    if (s && tab !== "clip") tab = "clip";
    onChange();
  });
  store.on("session", onChange);
  app.library.onChanged(onChange);

  render();
  requestAnimationFrame(positionPill);
  return panel;
}
