// The left panel — project header, the SEQUENCE (ordered clip list, the
// timeline's vertical mirror) and the LIBRARY (procedural animations +
// GLB assets). Click a library row to append it to the sequence; drag it
// onto the timeline to place it; drag sequence rows to reorder.

import { h, icon, tip, showMenu, toast } from "./dom.js";
import { TextField, iconButton } from "./fields.js";
import { MODES } from "../modes.js";
import { segments, clipDuration, fmtSeconds } from "../sequence.js";

const kindIcon = (k) => (k === "mode" ? "wave" : "box");

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
  const seqList = h("div", { class: "seq-list" });
  const seqSection = h("div", { class: "lib-section" },
    h("div", { class: "lib-title" }, "Timeline",
      h("span", { class: "lib-count seq-total" })),
    seqList);

  function renderSequence() {
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
        h("span", { class: "seq-kind" }, icon(kindIcon(clip.kind))),
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
  function libRow({ kind, key, label, sub, state }) {
    const rowEl = h("div", { class: "lib-row", dataset: { kind, key } },
      h("span", { class: "lib-icon" }, icon(kindIcon(kind))),
      h("span", { class: "lib-name" }, label),
      sub ? h("span", { class: "lib-sub" }, sub) : null,
      state === "loading" ? icon("spinner", "spin lib-busy") : null,
      h("span", { class: "lib-add" }, icon("plus")),
    );
    tip(rowEl, "Click to add · drag onto the timeline");
    let dragged = false;
    rowEl.addEventListener("click", () => {
      if (dragged) { dragged = false; return; }   // the drag already placed it
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
            icon(kindIcon(kind)), h("span", {}, label));
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

  const animList = h("div", { class: "lib-list" },
    MODES.map((m) => libRow({ kind: "mode", key: m.key, label: m.label })));

  const assetList = h("div", { class: "lib-list" });
  function renderAssets() {
    assetList.textContent = "";
    for (const a of app.library.assets()) {
      assetList.append(libRow({
        kind: "asset", key: a.key, label: a.label, state: a.state,
        sub: a.custom === "image" ? "image" : a.custom ? "glb" : null,
      }));
    }
  }

  const importBtn = h("button", { class: "lib-import" },
    icon("upload"), h("span", {}, "Import GLB / image…"));
  importBtn.addEventListener("click", () => app.actions.importGlb());

  const body = h("div", { class: "panel-body" },
    seqSection,
    h("div", { class: "lib-section" },
      h("div", { class: "lib-title" }, "Animations",
        h("span", { class: "lib-count" }, String(MODES.length))),
      animList),
    h("div", { class: "lib-section" },
      h("div", { class: "lib-title" }, "Assets"),
      assetList,
      importBtn),
  );

  const panel = h("div", { class: "panel left-panel" }, header, body);

  renderSequence();
  renderAssets();
  store.on("project", renderSequence);
  store.on("selection", renderSequence);
  app.library.onChanged(renderAssets);
  store.on("project", () => nameField.refresh());

  return panel;
}
