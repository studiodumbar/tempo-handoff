// The bottom timeline — transport, ruler, the clip track and the camera
// keyframe track. Direct manipulation everywhere:
//
//   · scrub the ruler (drag anywhere on it)
//   · drag a clip to reorder, its right edge to set hold, the seam between
//     stripes and body to set the transition length
//   · drag camera diamonds in time; double-click to jump
//   · drop a library target at any position
//
// While a drag is live nothing animates (1:1 with the pointer); everything
// else moves in short ease-out steps.

import { h, icon, tip, showMenu, clamp } from "./dom.js";
import { iconButton } from "./fields.js";
import { segments, totalDuration, projectDuration, fmtTime } from "../sequence.js";

const PAD = 16;          // px before t=0 inside the scroll content
const RULER_H = 26;
const LANE_H = 46;       // one clip lane — clips alternate between two (A/B
const CLIPS_H = LANE_H * 2 + 6;   // roll: the overlap IS the transition)
const PHOTO_H = 34;      // the photo lane: pictures OVER the particle track
const CAM_H = 26;

export function buildTimeline(app) {
  const { store } = app;

  // ---- header: readout · transport · zoom ----
  const readout = h("span", { class: "tl-time" }, "0:00.00");
  const totalEl = h("span", { class: "tl-total" }, "/ 0:00.00");

  const playBtn = iconButton("play", { title: "Play / pause (space)", cls: "play-btn", onClick: () => app.actions.togglePlay() });
  const backBtn = iconButton("skipBack", { title: "To start (home)", onClick: () => app.actions.seek(0) });
  const loopBtn = iconButton("loop", { title: "Loop playback", onClick: () => {
    store.set({ loop: !store.session.loop }, "tl");
    syncTransport();
  } });

  const zoomOut = iconButton("minus", { title: "Zoom out", onClick: () => setZoom(store.session.pxPerSec / 1.4) });
  const zoomIn = iconButton("plus", { title: "Zoom in", onClick: () => setZoom(store.session.pxPerSec * 1.4) });
  const zoomFit = iconButton("fit", { title: "Fit sequence", onClick: () => { store.set({ tlFit: true }, "tlzoom"); layout(); } });

  const header = h("div", { class: "tl-header" },
    h("div", { class: "tl-h-left" }, readout, totalEl),
    h("div", { class: "tl-transport" }, backBtn, playBtn, loopBtn),
    h("div", { class: "tl-h-right" }, zoomOut, zoomIn, zoomFit),
  );

  // ---- body: gutter + scrollable tracks ----
  const addKfBtn = iconButton("diamondO", { title: "Add camera keyframe at playhead", cls: "small", onClick: () => app.actions.addCameraKf() });
  const followBtn = iconButton("camera", { title: "Follow camera keyframes", cls: "small", onClick: () => {
    store.mutate((p) => { p.camera.follow = !p.camera.follow; });
  } });

  const addPhotoBtn = iconButton("plus", { title: "Add a photo at the playhead", cls: "small", onClick: (e) => {
    const imgs = app.library.assets().filter((a) => a.custom === "image");
    if (!imgs.length) return;
    showMenu(imgs.map((a) => ({
      label: a.label, icon: "box",
      action: () => app.actions.addPhoto(a.key, a.label),
    })), { x: e.clientX, y: e.clientY });
  } });

  const gutter = h("div", { class: "tl-gutter" },
    h("div", { class: "tl-g-row", style: { height: `${RULER_H}px` } }),
    h("div", { class: "tl-g-row", style: { height: `${CLIPS_H}px` } }, h("span", {}, "Clips")),
    h("div", { class: "tl-g-row", style: { height: `${PHOTO_H}px` } }, h("span", {}, "Photo"), addPhotoBtn),
    h("div", { class: "tl-g-row", style: { height: `${CAM_H}px` } }, h("span", {}, "Camera"), followBtn, addKfBtn),
  );

  const ruler = h("div", { class: "tl-ruler", style: { height: `${RULER_H}px` } });
  const clipsTrack = h("div", { class: "tl-track tl-clips", style: { height: `${CLIPS_H}px` } });
  const photoTrack = h("div", { class: "tl-track tl-photo-track", style: { height: `${PHOTO_H}px` } });
  const camTrack = h("div", { class: "tl-track tl-cam", style: { height: `${CAM_H}px` } });
  const playhead = h("div", { class: "tl-playhead" }, h("div", { class: "ph-head" }));
  const dropLine = h("div", { class: "tl-droplane", hidden: true });

  const content = h("div", { class: "tl-content" }, ruler, clipsTrack, photoTrack, camTrack, playhead, dropLine);
  const scroll = h("div", { class: "tl-scroll" }, content);
  const body = h("div", { class: "tl-body" }, gutter, scroll);
  const panel = h("div", { class: "panel timeline-panel" }, header, body);

  // ---- coordinate helpers ----
  const pps = () => store.session.pxPerSec;
  const t2x = (t) => PAD + t * pps();
  const x2t = (x) => (x - PAD) / pps();
  const pointerT = (e) => {
    const r = content.getBoundingClientRect();
    return clamp(x2t(e.clientX - r.left), 0, projectDuration(store.project));
  };

  function setZoom(v, anchorClientX = null) {
    const total = projectDuration(store.project);
    const next = clamp(v, 12, 600);
    let anchorT = null, anchorPx = 0;
    if (anchorClientX != null) {
      const r = content.getBoundingClientRect();
      anchorT = x2t(anchorClientX - r.left);
      anchorPx = anchorClientX - scroll.getBoundingClientRect().left;
    }
    store.set({ pxPerSec: next, tlFit: false }, "tlzoom");
    layout();
    if (anchorT != null) {
      scroll.scrollLeft = PAD + anchorT * next - anchorPx;
    }
    void total;
  }

  scroll.addEventListener("wheel", (e) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setZoom(pps() * (e.deltaY > 0 ? 0.9 : 1.12), e.clientX);
    }
  }, { passive: false });

  // ---- ruler ----
  function drawRuler(total) {
    ruler.textContent = "";
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => s * pps() >= 56) || 60;
    const minor = step / 5;
    const end = Math.max(total, x2t(scroll.clientWidth) ?? 0) + step;
    for (let t = 0; t <= end + 1e-6; t += minor) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ruler.append(h("div", {
        class: `tick${major ? " major" : ""}`,
        style: { left: `${t2x(t)}px` },
      }));
      if (major) {
        ruler.append(h("div", { class: "tick-label", style: { left: `${t2x(t) + 4}px` } },
          t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}` : `${Math.round(t * 10) / 10}s`));
      }
    }
    ruler.append(h("div", { class: "ruler-endcap", style: { left: `${t2x(total)}px` } }));
  }

  // scrubbing (ruler + anywhere on empty track space)
  function bindScrub(el) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".tl-clip, .tl-kf")) return;
      app.actions.scrubStart();
      app.actions.seek(pointerT(e));
      const move = (ev) => app.actions.seek(pointerT(ev));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        app.actions.scrubEnd();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    });
  }
  bindScrub(ruler);
  bindScrub(clipsTrack);
  bindScrub(photoTrack);
  bindScrub(camTrack);

  // ---- clip blocks ----
  function drawClips() {
    clipsTrack.textContent = "";
    const { clips } = store.project;
    const sel = store.session.selection;
    if (!clips.length) {
      clipsTrack.append(h("div", { class: "tl-empty" },
        "Drop targets here — or click them in the Library"));
      return;
    }
    const segs = segments(clips);
    for (const seg of segs) {
      const { clip, index } = seg;
      const w = Math.max(2, (seg.end - seg.start) * pps());
      const transW = (seg.transEnd - seg.start) * pps();
      const selected = sel?.type === "clip" && sel.id === clip.id;
      // A/B roll: clips alternate lanes, and each block visually continues
      // through the NEXT clip's transition on its own lane — the overlap
      // between the rows IS the morph.
      const row = index % 2;
      const rowTop = 4 + row * (LANE_H + 2);
      const next = segs[index + 1];
      const outW = next ? (next.transEnd - next.start) * pps() : 0;
      if (outW > 1) {
        clipsTrack.append(h("div", {
          class: `tl-clip-out${selected ? " selected" : ""}`,
          style: { left: `${t2x(seg.end)}px`, width: `${outW}px`,
                   top: `${rowTop}px`, height: `${LANE_H - 8}px` },
        }));
      }
      const block = h("div", {
        class: `tl-clip${selected ? " selected" : ""}`,
        dataset: { id: clip.id },
        style: { left: `${t2x(seg.start)}px`, width: `${w}px`,
                 top: `${rowTop}px`, height: `${LANE_H - 8}px` },
      },
        transW > 0.5 ? h("div", { class: "clip-trans", style: { width: `${transW}px` } }) : null,
        // the exit flight: a trailing hatched zone on the last clip
        (seg.end - seg.outroStart) * pps() > 0.5 ? h("div", {
          class: "clip-trans",
          style: { width: `${(seg.end - seg.outroStart) * pps()}px`,
                   left: "auto", right: "0", borderRight: "none",
                   borderLeft: "1px solid rgba(255,255,255,0.14)" },
        }) : null,
        h("div", { class: "clip-body" },
          h("span", { class: "clip-icon" }, icon(clip.kind === "mode" ? "wave" : "box")),
          h("span", { class: "clip-name" }, clip.label),
        ),
        index > 0 || (clip.intro | 0) > 0 ? h("div", { class: "clip-seam", style: { left: `${transW}px` } }) : null,
        h("div", { class: "clip-tail" }),
      );
      block.addEventListener("pointerdown", (e) => onClipPointer(e, clip, seg));
      block.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        store.select({ type: "clip", id: clip.id });
        showMenu([
          { label: "Duplicate", icon: "copy", hint: "⌘D", action: () => app.actions.duplicateClip(clip.id) },
          "-",
          { label: "Delete", icon: "trash", hint: "⌫", danger: true, action: () => app.actions.removeClip(clip.id) },
        ], { x: e.clientX, y: e.clientY });
      });
      clipsTrack.append(block);
    }
  }

  // ---- the photo lane ----
  function drawPhotos() {
    photoTrack.textContent = "";
    const sel = store.session.selection;
    for (const ph of store.project.photos || []) {
      const w = Math.max(6, ph.dur * pps());
      const fiW = Math.min(w, (ph.fadeIn ?? 0) * pps());
      const foW = Math.min(w, (ph.fadeOut ?? 0) * pps());
      const selected = sel?.type === "photo" && sel.id === ph.id;
      const block = h("div", {
        class: `tl-photo${selected ? " selected" : ""}`,
        style: { left: `${t2x(ph.start)}px`, width: `${w}px` },
      },
        fiW > 1 ? h("div", { class: "photo-fade in", style: { width: `${fiW}px` } }) : null,
        foW > 1 ? h("div", { class: "photo-fade out", style: { width: `${foW}px` } }) : null,
        h("div", { class: "clip-body" },
          h("span", { class: "clip-icon" }, icon("image")),
          h("span", { class: "clip-name" }, ph.label)),
        h("div", { class: "clip-tail" }),
      );
      block.addEventListener("pointerdown", (e) => onPhotoPointer(e, ph));
      block.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        store.select({ type: "photo", id: ph.id });
        showMenu([
          { label: "Delete", icon: "trash", danger: true,
            action: () => app.actions.removePhoto(ph.id) },
        ], { x: e.clientX, y: e.clientY });
      });
      photoTrack.append(block);
    }
  }

  function onPhotoPointer(e, ph) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const block = e.currentTarget;
    const inTail = block.getBoundingClientRect().right - e.clientX < 8;
    store.select({ type: "photo", id: ph.id });
    const startX = e.clientX;
    const pid = ph.id;
    const start0 = ph.start, dur0 = ph.dur;
    let began = false;
    const move = (ev) => {
      const dt = (ev.clientX - startX) / pps();
      if (!began && Math.abs(ev.clientX - startX) < 3) return;
      began = true;
      document.body.classList.add("scrubbing");
      store.mutate((p) => {
        const x = p.photos.find((y) => y.id === pid);
        if (!x) return;
        if (inTail) x.dur = Math.round(clamp(dur0 + dt, 0.1, 120) * 100) / 100;
        else x.start = Math.round(clamp(start0 + dt, 0, 600) * 100) / 100;
      }, { coalesce: `phmove${pid}` });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("scrubbing");
      store.endCoalesce();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onClipPointer(e, clip, seg) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const block = e.currentTarget;
    const rect = block.getBoundingClientRect();
    const inTail = rect.right - e.clientX < 8;
    const seamX = (seg.transEnd - seg.start) * pps();
    const onSeam = (seg.index > 0 || (clip.intro | 0) > 0)
      && Math.abs(e.clientX - rect.left - seamX) < 6 && !inTail;
    store.select({ type: "clip", id: clip.id });

    const startX = e.clientX;
    const cid = clip.id;
    let began = false;

    if (inTail || onSeam) {
      const startHold = clip.hold;
      const startTrans = clip.trans.duration;
      const move = (ev) => {
        const dt = (ev.clientX - startX) / pps();
        if (!began && Math.abs(ev.clientX - startX) < 3) return;
        began = true;
        document.body.classList.add("scrubbing");
        store.mutate((p) => {
          const c = p.clips.find((x) => x.id === cid);
          if (!c) return;
          if (inTail) c.hold = Math.round(clamp(startHold + dt, 0, 120) * 100) / 100;
          else c.trans.duration = Math.round(clamp(startTrans + dt, 0, 10) * 100) / 100;
        }, { coalesce: `tlresize${cid}` });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        document.body.classList.remove("scrubbing");
        store.endCoalesce();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }

    // reorder drag
    let ghost = null;
    let toIndex = seg.index;
    const move = (ev) => {
      if (!began) {
        if (Math.abs(ev.clientX - startX) < 5) return;
        began = true;
        ghost = block.cloneNode(true);
        ghost.classList.add("ghost");
        content.append(ghost);
        block.classList.add("lifting");
        dropLine.hidden = false;
      }
      const cr = content.getBoundingClientRect();
      ghost.style.left = `${ev.clientX - cr.left - (startX - block.getBoundingClientRect().left)}px`;
      ghost.style.top = `${RULER_H + 6}px`;
      const segs = segments(store.project.clips);
      toIndex = segs.length;
      for (let i = 0; i < segs.length; i++) {
        const mid = t2x((segs[i].start + segs[i].end) / 2);
        if (ev.clientX - cr.left < mid) { toIndex = i; break; }
      }
      const lineT = toIndex >= segs.length ? segs[segs.length - 1].end : segs[toIndex].start;
      dropLine.style.left = `${t2x(lineT)}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      ghost?.remove();
      block.classList.remove("lifting");
      dropLine.hidden = true;
      if (began) {
        const from = seg.index;
        if (toIndex !== from && toIndex !== from + 1) {
          app.actions.moveClip(from, toIndex > from ? toIndex - 1 : toIndex);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  // ---- camera keyframes ----
  function drawKfs() {
    camTrack.textContent = "";
    const { kfs, follow } = store.project.camera;
    camTrack.classList.toggle("dim", !follow);
    const sel = store.session.selection;
    for (const kf of kfs) {
      const el = h("div", {
        class: `tl-kf${sel?.type === "kf" && sel.id === kf.id ? " selected" : ""}`,
        style: { left: `${t2x(kf.t)}px` },
      }, icon("diamond"));
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        store.select({ type: "kf", id: kf.id });
        const startX = e.clientX;
        const startT = kf.t;
        let began = false;
        const move = (ev) => {
          if (!began && Math.abs(ev.clientX - startX) < 3) return;
          began = true;
          const t = clamp(startT + (ev.clientX - startX) / pps(), 0, projectDuration(store.project));
          store.mutate((p) => {
            const k = p.camera.kfs.find((x) => x.id === kf.id);
            if (k) k.t = Math.round(t * 1000) / 1000;
          }, { coalesce: `kfmove${kf.id}` });
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          store.endCoalesce();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      });
      el.addEventListener("dblclick", () => app.actions.seek(kf.t));
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu([
          { label: "Go to keyframe", icon: "clock", action: () => app.actions.seek(kf.t) },
          { label: "Set to current view", icon: "camera", action: () => app.actions.updateKfFromView(kf.id) },
          "-",
          { label: "Delete", icon: "trash", danger: true, action: () => app.actions.removeKf(kf.id) },
        ], { x: e.clientX, y: e.clientY });
      });
      tip(el, `${fmtTime(kf.t, store.project.comp.fps)} · ${kf.ease}`);
      camTrack.append(el);
    }
  }

  // ---- library drops (pointer-drag from the library panel) ----
  function insertIndexFor(clientX) {
    const segs = segments(store.project.clips);
    const cr = content.getBoundingClientRect();
    let idx = segs.length;
    for (let i = 0; i < segs.length; i++) {
      const mid = t2x((segs[i].start + segs[i].end) / 2);
      if (clientX - cr.left < mid) { idx = i; break; }
    }
    return idx;
  }

  app.timeline = {
    /** Insert index if (x, y) is over the timeline body, else null. */
    dropIndexAt(x, y) {
      const r = scroll.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top - 8 || y > r.bottom) return null;
      return insertIndexFor(x);
    },
    /** Live insert line while a library chip hovers; null clears. */
    previewDropAt(x, y) {
      const idx = x == null ? null : this.dropIndexAt(x, y);
      if (idx == null) { dropLine.hidden = true; return; }
      const segs = segments(store.project.clips);
      dropLine.hidden = false;
      dropLine.style.left = `${t2x(idx >= segs.length ? (segs.at(-1)?.end ?? 0) : segs[idx].start)}px`;
    },
  };

  // ---- layout / sync ----
  function layout() {
    const total = projectDuration(store.project);
    if (store.session.tlFit) {
      const avail = Math.max(120, scroll.clientWidth - PAD * 2 - 8);
      store.session.pxPerSec = clamp(total > 0 ? avail / total : 90, 12, 600);
    }
    content.style.width = `${Math.max(scroll.clientWidth, t2x(total) + 60)}px`;
    drawRuler(total);
    drawClips();
    drawPhotos();
    drawKfs();
    syncPlayhead();
    syncTransport();
    totalEl.textContent = ` / ${fmtTime(total, store.project.comp.fps)}`;
  }

  function syncPlayhead() {
    const t = store.session.time;
    playhead.style.transform = `translateX(${t2x(t)}px)`;
    readout.textContent = fmtTime(t, store.project.comp.fps);
    if (store.session.playing) {
      const x = t2x(t) - scroll.scrollLeft;
      if (x > scroll.clientWidth - 60) scroll.scrollLeft = t2x(t) - scroll.clientWidth + 60;
      else if (x < 40) scroll.scrollLeft = Math.max(0, t2x(t) - 40);
    }
  }

  function syncTransport() {
    playBtn.replaceChildren(icon(store.session.playing ? "pause" : "play"));
    playBtn.classList.toggle("on", store.session.playing);
    loopBtn.classList.toggle("on", store.session.loop);
    followBtn.classList.toggle("on", store.project.camera.follow);
  }

  store.on("project", layout);
  store.on("selection", () => { drawClips(); drawPhotos(); drawKfs(); });
  store.on("tlzoom", layout);
  store.on("time", syncPlayhead);
  store.on("play", syncTransport);
  new ResizeObserver(() => layout()).observe(scroll);

  layout();
  return panel;
}
