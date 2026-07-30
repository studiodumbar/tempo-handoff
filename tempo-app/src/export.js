// Export — walks the SAME evaluate/drive path the viewport renders with,
// stepped at exact frame times, so the file is the preview. Two backends:
//
//   MP4   WebCodecs VideoEncoder (H.264) muxed by the vendored mp4-muxer.
//   PNG   one file per frame — straight into a picked folder when the
//         File System Access API exists, else a store-only .zip download.
//
// The comp canvas itself is the render surface: main temporarily sizes the
// drawing buffer to the export dimensions, we read frames off it, and the
// user literally watches the render happen behind the progress card.

import { Muxer, ArrayBufferTarget } from "../vendor/mp4-muxer.mjs";
import { h, icon, toast } from "./ui/dom.js";
import { totalDuration, projectDuration, fmtTime } from "./sequence.js";

// ---- tiny STORE-method zip --------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >> 8) & 255];
  const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length),
      ...u16(name.length), ...u16(0),
    ]);
    chunks.push(head, name, f.data);
    central.push({ name, crc, size: f.data.length, offset });
    offset += head.length + name.length + f.data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const entry = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size),
      ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(c.offset),
    ]);
    chunks.push(entry, c.name);
    offset += entry.length + c.name.length;
  }
  chunks.push(new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(offset - cdStart), ...u32(cdStart), ...u16(0),
  ]));
  return new Blob(chunks, { type: "application/zip" });
}

// ---- helpers -----------------------------------------------------------------

export function slug(name) {
  return (name || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "untitled";
}

export async function saveBlob(blob, filename, description, mime) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description, accept: { [mime]: [`.${filename.split(".").pop()}`] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (err) {
      if (err?.name === "AbortError") return false;
    }
  }
  const a = document.createElement("a");
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  return true;
}

export async function pickH264Codec(width, height, fps, bitrate) {
  if (typeof VideoEncoder === "undefined") return null;
  const candidates = ["avc1.640034", "avc1.640033", "avc1.64002A", "avc1.640028", "avc1.4D0028", "avc1.42E01F"];
  for (const codec of candidates) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec, width, height, framerate: fps, bitrate, latencyMode: "quality",
      });
      if (supported) return codec;
    } catch {}
  }
  return null;
}

// ---- the progress card ----------------------------------------------------------

export function progressCard(title) {
  const bar = h("div", { class: "prog-bar" }, h("div", { class: "prog-fill" }));
  const stats = h("div", { class: "prog-stats" }, "Preparing…");
  const cancelBtn = h("button", { class: "btn subtle" }, "Cancel");
  const card = h("div", { class: "export-card" },
    h("div", { class: "export-title" }, icon("film"), h("span", {}, title)),
    bar, stats,
    h("div", { class: "export-actions" }, cancelBtn));
  const backdrop = h("div", { class: "export-overlay" }, card);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("on"));
  return {
    set(frac, text) {
      bar.firstChild.style.transform = `scaleX(${Math.min(1, Math.max(0, frac))})`;
      stats.textContent = text;
    },
    retitle(t) { card.querySelector(".export-title span").textContent = t; },
    onCancel(fn) { cancelBtn.addEventListener("click", fn); },
    close() {
      backdrop.classList.remove("on");
      setTimeout(() => backdrop.remove(), 200);
    },
  };
}

// Yield to the event loop WITHOUT rAF/setTimeout — both get throttled when
// the window is unfocused, and an export should chew through frames even in
// a background window. A MessageChannel round-trip never throttles.
const channel = new MessageChannel();
let yieldResolve = null;
channel.port1.onmessage = () => { yieldResolve?.(); yieldResolve = null; };
export const nextTick = () => new Promise((r) => { yieldResolve = r; channel.port2.postMessage(0); });

// ---- the export run ---------------------------------------------------------------

/**
 * hooks: {
 *   begin(w, h)      resize the pipeline to export dimensions
 *   renderAt(T)      deterministically render time T into the canvas
 *   end()            restore the interactive viewport
 *   canvas
 * }
 */
export async function runExport(store, hooks) {
  const p = store.project;
  const ex = p.export;
  const total = projectDuration(p);
  if (total <= 0) { toast("Nothing to export — the sequence is empty."); return; }

  const fps = ex.fps || p.comp.fps;
  const start = Math.min(Math.max(0, ex.start), total);
  const end = ex.end > start ? Math.min(ex.end, total) : total;
  const frames = Math.max(1, Math.round((end - start) * fps));
  // H.264 wants even dimensions; PNG doesn't care but consistency is fine
  // export scale: render the SAME composition (same braille grid — the
  // terminal pass separates logical comp from raster resolution) at a
  // sharper pixel size. The photograph and glyph pass both gain the pixels.
  const scale = Math.max(1, Math.round(ex.scale || 1));
  const W = Math.max(2, Math.floor((p.comp.width * scale) / 2) * 2);
  const H = Math.max(2, Math.floor((p.comp.height * scale) / 2) * 2);
  const base = slug(p.name);

  const mp4 = ex.format === "mp4";
  let codec = null;
  const bitrate = Math.round(Math.min(8e7, Math.max(1e6, W * H * fps * 0.14 * ex.quality)));
  if (mp4) {
    codec = await pickH264Codec(W, H, fps, bitrate);
    if (!codec) {
      toast("MP4 export needs WebCodecs H.264 (Chrome / Edge). Try a PNG sequence.", { kind: "error", duration: 4200 });
      return;
    }
  }

  // PNG destination up front (needs a user gesture window)
  let dirHandle = null;
  let zipFiles = null;
  if (!mp4) {
    if (window.showDirectoryPicker) {
      try {
        dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    if (!dirHandle) {
      zipFiles = [];
      if (frames > 600) toast("No folder access — zipping in memory; long ranges can get heavy.", { duration: 3600 });
    }
  }

  store.set({ exporting: true, playing: false }, "play");
  const card = progressCard(mp4 ? "Rendering MP4" : "Rendering PNG sequence");
  let cancelled = false;
  card.onCancel(() => { cancelled = true; });

  let encoder = null;
  let muxer = null;
  const t0 = performance.now();

  try {
    hooks.begin(W, H);

    // a debug overlay (the mosaic tile grid) composited into the frames —
    // decided once at export start from the session toggle
    let compose = null, cctx = null;
    if (hooks.overlay && hooks.overlayActive && hooks.overlayActive()) {
      compose = document.createElement("canvas");
      compose.width = W;
      compose.height = H;
      cctx = compose.getContext("2d");
    }

    if (mp4) {
      muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: W, height: H },
        fastStart: "in-memory",
      });
      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { throw e; },
      });
      encoder.configure({ codec, width: W, height: H, framerate: fps, bitrate, latencyMode: "quality" });
    }

    for (let i = 0; i < frames; i++) {
      if (cancelled) break;
      const T = start + i / fps;
      hooks.renderAt(T);
      let src = hooks.canvas;
      if (cctx) {
        cctx.clearRect(0, 0, W, H);
        cctx.drawImage(hooks.canvas, 0, 0, W, H);
        hooks.overlay(cctx, W, H, T);
        src = compose;
      }

      if (mp4) {
        const frame = new VideoFrame(src, { timestamp: Math.round((i / fps) * 1e6) });
        encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4) await nextTick();
      } else {
        const blob = await new Promise((r) => src.toBlob(r, "image/png"));
        const nameF = `${base}_${String(i + 1).padStart(4, "0")}.png`;
        if (dirHandle) {
          const fh = await dirHandle.getFileHandle(nameF, { create: true });
          const w = await fh.createWritable();
          await w.write(blob);
          await w.close();
        } else {
          zipFiles.push({ name: nameF, data: new Uint8Array(await blob.arrayBuffer()) });
        }
      }

      const el = (performance.now() - t0) / 1000;
      const eta = i > 4 ? (el / (i + 1)) * (frames - i - 1) : null;
      card.set((i + 1) / frames,
        `Frame ${i + 1} / ${frames} · ${fmtTime(T - start, fps)}${eta != null ? ` · ~${Math.ceil(eta)}s left` : ""}`);
      await nextTick();
    }

    if (!cancelled) {
      if (mp4) {
        card.retitle("Encoding…");
        await encoder.flush();
        muxer.finalize();
        const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
        const ok = await saveBlob(blob, `${base}_${W}x${H}_${fps}fps.mp4`, "MP4 video", "video/mp4");
        if (ok) toast(`Exported ${frames} frames · ${(blob.size / 1e6).toFixed(1)} MB`, { duration: 3600 });
      } else if (zipFiles) {
        card.retitle("Zipping…");
        await nextTick();
        const blob = zipStore(zipFiles);
        const ok = await saveBlob(blob, `${base}_png_${W}x${H}.zip`, "PNG sequence (zip)", "application/zip");
        if (ok) toast(`Exported ${frames} PNG frames · ${(blob.size / 1e6).toFixed(1)} MB`, { duration: 3600 });
      } else {
        toast(`Exported ${frames} PNG frames`, { duration: 3600 });
      }
    } else {
      toast("Export cancelled");
    }
  } catch (err) {
    console.error(err);
    toast(`Export failed — ${err.message || err}`, { kind: "error", duration: 4200 });
  } finally {
    try { if (encoder && encoder.state !== "closed") encoder.close(); } catch {}
    hooks.end();
    card.close();
    store.set({ exporting: false }, "play");
  }
}
