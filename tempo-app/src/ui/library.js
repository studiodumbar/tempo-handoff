// The left panel — project header, the SEQUENCE (ordered clip list, the
// timeline's vertical mirror) and the LIBRARY (procedural animations +
// GLB assets). Click a library row to append it to the sequence; drag it
// onto the timeline to place it; drag sequence rows to reorder.

import { h, icon, tip, showMenu, toast } from "./dom.js";
import { TextField, iconButton } from "./fields.js";
import { MODES, modeFamilies } from "../modes.js";
import { segments, clipDuration, fmtSeconds } from "../sequence.js";

/** What the row IS, at a glance: a procedural animation, a traced image, or a
    sampled model. The sub-label repeats it in words for the ambiguous cases. */
const kindIcon = (kind, custom) => {
  if (kind === "mode") return "wave";
  return custom === "image" ? "image" : "box";
};

export function buildLibraryPanel(app) {
  const { store } = app;

  // ---- header: project name + file actions ----
  const nameField = TextField({
    label: "Project name",
    get: () => store.project.name,
    set: (v) => store.mutate((p) => { p.name = v; }),
  });
  nameField.el.classList.add("project-name");

  const header = h("div", { class: "panel-head" },
    nameField.el,
    h("div", { class: "head-actions" },
      iconButton("file", { title: "New project", onClick: () => app.actions.newProject() }),
      iconButton("folder", { title: "Open project…", onClick: () => app.actions.openProject() }),
      iconButton("download", { title: "Save project file", onClick: () => app.actions.saveProject() }),
    ),
  );

  // ---- sequence ----
  const seqList = h("div", { class: "seq-list lib-scroll" });
  const seqSection = h("div", { class: "lib-section" },
    h("div", { class: "lib-title" }, "Clips",
      h("span", { class: "lib-count seq-total" })),
    seqList);

  /* store.emit("project") fires on every coalesced scrub tick, and this used to
     rebuild the whole clip list from scratch each time — so dragging any value
     in the inspector re-created every row of this panel, continuously. The
     signature covers everything a row DISPLAYS; anything else is a no-op, and
     selection alone just moves a class. */
  let seqSig = null;

  function sequenceSignature() {
    const { clips } = store.project;
    return clips.map((c, i) =>
      `${c.id}:${c.kind}:${c.label}:${clipDuration(c, i).toFixed(3)}`).join("|");
  }

  function renderSequence(force = false) {
    const sig = sequenceSignature();
    if (!force && sig === seqSig) { syncSelection(); return; }
    seqSig = sig;

    const { clips } = store.project;
    const sel = store.session.selection;
    seqList.textContent = "";
    seqSection.querySelector(".seq-total").textContent =
      clips.length ? fmtSeconds(segments(clips).at(-1).end) : "";
    if (!clips.length) {
      seqList.append(h("div", { class: "state compact" },
        icon("layers"),
        h("p", {}, "No clips yet"),
        h("span", { class: "lib-sub" }, "Pick one below")));
      return;
    }
    clips.forEach((clip, i) => {
      const rowEl = h("div", {
        class: `seq-row${sel?.type === "clip" && sel.id === clip.id ? " selected" : ""}`,
        dataset: { id: clip.id },
      },
        h("span", { class: "seq-grip" }, icon("grip")),
        h("span", { class: "seq-index" }, String(i + 1)),
        h("span", { class: "seq-kind" }, icon(kindIcon(clip.kind, clipCustom(clip)))),
        h("span", { class: "seq-name" }, clip.label),
        h("span", { class: "seq-dur" }, fmtSeconds(clipDuration(clip, i))),
      );
      rowEl.addEventListener("pointerdown", (e) => beginRowDrag(e, rowEl, clip, i));
      rowEl.addEventListener("click", (e) => {
        if (rowEl.dataset.dragged) { delete rowEl.dataset.dragged; return; }
        store.select({ type: "clip", id: clip.id });
        app.actions.jumpToClip(clip.id, { play: false });
      });
      rowEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        store.select({ type: "clip", id: clip.id });
        showMenu([
          { label: "Duplicate", icon: "copy", hint: "⌘D", action: () => app.actions.duplicateClip(clip.id) },
          "-",
          { label: "Delete", icon: "trash", hint: "⌫", danger: true, action: () => app.actions.removeClip(clip.id) },
        ], { x: e.clientX, y: e.clientY });
      });
      seqList.append(rowEl);
    });
  }

  /** Selection is a class, not a reason to rebuild the list. */
  function syncSelection() {
    const sel = store.session.selection;
    for (const rowEl of seqList.querySelectorAll(".seq-row")) {
      rowEl.classList.toggle(
        "selected", sel?.type === "clip" && sel.id === rowEl.dataset.id);
    }
  }

  // pointer-based row reorder with an insert line
  let insertLine = null;
  function beginRowDrag(e, rowEl, clip, fromIndex) {
    if (e.button !== 0) return;
    const startY = e.clientY;
    let dragging = false;
    let toIndex = fromIndex;
    const rows = () => [...seqList.querySelectorAll(".seq-row")];
    const move = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        rowEl.classList.add("dragging");
        rowEl.dataset.dragged = "1";
        insertLine = h("div", { class: "insert-line" });
        seqList.append(insertLine);
      }
      const rs = rows();
      toIndex = rs.length;
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { toIndex = i; break; }
      }
      const listRect = seqList.getBoundingClientRect();
      const y = toIndex >= rs.length
        ? rs[rs.length - 1].getBoundingClientRect().bottom
        : rs[toIndex].getBoundingClientRect().top;
      insertLine.style.top = `${y - listRect.top + seqList.scrollTop - 1}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      rowEl.classList.remove("dragging");
      insertLine?.remove();
      insertLine = null;
      if (dragging && toIndex !== fromIndex && toIndex !== fromIndex + 1) {
        app.actions.moveClip(fromIndex, toIndex > fromIndex ? toIndex - 1 : toIndex);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ---- library ----
  // Rows are click-to-append AND pointer-drag-to-place. Deliberately NOT
  // HTML5 draggable — that swallows clicks that wobble a pixel or two.
  /** What a clip's asset turns out to be, for its row icon. */
  function clipCustom(clip) {
    if (clip.kind !== "asset") return null;
    return app.library.assets().find((a) => a.key === clip.key)?.custom ?? null;
  }

  function libRow({ kind, key, label, sub, state, custom }) {
    // A failed asset used to look exactly like a working one — same row, same
    // icon, and clicking it silently did nothing. It says so now, and the
    // click retries rather than pretending.
    const failed = state === "error";
    const rowEl = h("div", {
      class: failed ? "lib-row failed" : "lib-row",
      dataset: { kind, key },
    },
      h("span", { class: "lib-icon" }, icon(failed ? "alert" : kindIcon(kind, custom))),
      h("span", { class: "lib-name" }, label),
      failed ? h("span", { class: "lib-sub" }, "failed") : (sub ? h("span", { class: "lib-sub" }, sub) : null),
      state === "loading" ? icon("spinner", "spin lib-busy") : null,
      h("span", { class: "lib-add" }, icon(failed ? "loop" : "plus")),
    );
    tip(rowEl, failed ? "Could not load — click to try again"
      : "Click to add · drag onto the timeline");
    let dragged = false;
    rowEl.addEventListener("click", () => {
      if (dragged) { dragged = false; return; }   // the drag already placed it
      if (failed) { app.actions.retryAsset(key); return; }
      app.actions.addClip(kind, key);
    });
    rowEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY;
      let ghost = null;
      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
          ghost = h("div", { class: "drag-chip" },
            icon(kindIcon(kind, custom)), h("span", {}, label));
          document.body.append(ghost);
        }
        ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY + 8}px)`;
        app.timeline?.previewDropAt(ev.clientX, ev.clientY);
      };
      const up = (ev) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (!ghost) return;                        // plain click — handled above
        dragged = true;
        ghost.remove();
        const idx = app.timeline?.dropIndexAt(ev.clientX, ev.clientY);
        app.timeline?.previewDropAt(null);
        if (idx != null) app.actions.addClip(kind, key, idx);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
    return rowEl;
  }

  // ---- search ----
  // 89 animations in a 244px column is a 2 300px scroll of names like "zoom",
  // "zoom out", "zoom quarter", "zoom spin", "zoom lean". A filter is the
  // difference between choosing from a list and scrolling one.
  let query = "";
  const searchInput = h("input", {
    type: "text", spellcheck: false, autocomplete: "off",
    placeholder: "Filter", "aria-label": "Filter the library",
  });
  const clearBtn = h("button", {
    class: "search-clear", type: "button", "aria-label": "Clear filter", hidden: true,
  }, icon("x"));
  const searchField = h("div", { class: "search-field lib-search" },
    icon("search"), searchInput, clearBtn);

  const applyFilter = () => {
    query = searchInput.value.trim().toLowerCase();
    clearBtn.hidden = !query;
    renderAnims();
    renderAssets(true);      // the filter changed, so the list must
  };
  searchInput.addEventListener("input", applyFilter);
  searchInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      if (query) { searchInput.value = ""; applyFilter(); }
      else searchInput.blur();
    } else if (e.key === "Enter") {
      // type three letters, press Enter — the common case
      const first = animList.querySelector(".lib-row") || assetList.querySelector(".lib-row");
      first?.click();
    }
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    applyFilter();
    searchInput.focus();
  });

  const hit = (label) => !query || label.toLowerCase().includes(query);

  const animList = h("div", { class: "lib-list lib-scroll" });
  const animCount = h("span", { class: "lib-count" });
  const FAMILIES = modeFamilies();

  function renderAnims() {
    animList.textContent = "";
    let shown = 0;
    for (const fam of FAMILIES) {
      const modes = fam.modes.filter((m) => hit(m.label));
      if (!modes.length) continue;
      shown += modes.length;
      // a family heading is only worth its row when it names more than one
      // visible thing — filtering down to one leaves the name on the row
      if (modes.length > 1 || !query) {
        animList.append(h("div", { class: "lib-group" }, fam.name));
      }
      for (const m of modes) {
        animList.append(libRow({
          kind: "mode", key: m.key,
          // inside "zoom", every row starts with "zoom" — the family already
          // said it, so the row says what is different
          label: query ? m.label : (m.short === fam.name ? m.label : trimFamily(m.short, fam.name)),
          sub: m.tag,
        }));
      }
    }
    animCount.textContent = query ? `${shown}/${MODES.length}` : String(MODES.length);
    if (!shown) animList.append(h("div", { class: "lib-none" }, "No match"));
  }

  /** "zoom out" inside the zoom family is just "out". */
  function trimFamily(label, family) {
    return label.startsWith(`${family} `) ? label.slice(family.length + 1) : label;
  }

  const assetList = h("div", { class: "lib-list lib-scroll" });
  const assetCount = h("span", { class: "lib-count" });
  let assetSig = null;
  function renderAssets(force = false) {
    const shown = app.library.assets().filter((a) => hit(a.label));
    const sig = shown.map((a) => `${a.key}:${a.state}:${a.custom}`).join("|");
    if (!force && sig === assetSig) return;
    assetSig = sig;
    const total = app.library.assets().length;
    assetCount.textContent = query && shown.length !== total
      ? `${shown.length}/${total}` : String(total);
    assetList.textContent = "";
    for (const a of shown) {
      assetList.append(libRow({
        kind: "asset", key: a.key, label: a.label, state: a.state, custom: a.custom,
        sub: a.custom === "image" ? "image" : a.custom ? "glb" : null,
      }));
    }
    if (!shown.length && query) {
      assetList.append(h("div", { class: "lib-none" }, "No match"));
    }
  }

  const importBtn = h("button", { class: "lib-import", type: "button" },
    icon("upload"), h("span", {}, "Import"));
  tip(importBtn, "GLB, glTF, PNG, JPG or SVG");
  importBtn.addEventListener("click", () => app.actions.importGlb());

  /* A flex column, not a single scroll: Clips takes what it needs (capped),
     Animations absorbs the slack and scrolls inside itself, and Assets — the
     short list, and the only way to import — is always in view. Stacked in one
     scroll, 87 animation rows put it 2 000px below the fold. */
  const body = h("div", { class: "panel-body lib-body" },
    seqSection,
    h("div", { class: "lib-section lib-grow" },
      h("div", { class: "lib-title" }, "Animations", animCount),
      searchField,
      animList),
    h("div", { class: "lib-section lib-assets" },
      h("div", { class: "lib-title" }, "Assets", assetCount),
      assetList,
      importBtn),
  );

  const panel = h("div", { class: "panel left-panel" }, header, body);

  renderSequence();
  renderAnims();
  renderAssets();
  store.on("project", () => renderSequence());
  store.on("selection", syncSelection);
  app.library.onChanged(renderAssets);
  store.on("project", () => nameField.refresh());

  return panel;
}
