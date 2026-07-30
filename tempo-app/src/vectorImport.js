// Vector & image import — an SVG / PNG / JPG becomes a RE-SAMPLABLE image
// mode with its own dedicated parameter set. The raster is kept in memory;
// every parameter scrub re-runs the sampler through the ordinary regen
// pipeline, so the braille translation is tuned live:
//
//   threshold  which pixels count as ink at all
//   tone       0 = binary stipple · 1 = dot DENSITY carries the image's tone
//   gamma      tone curve on the ink weight (dark-detail lift / crush)
//   contrast   S-curve around mid before gamma
//   ink        0 = dark pixels are ink · 1 = light pixels are ink (auto-set)
//   bright     dot energy — pushes cells over the block threshold
//   size/spin/tilt  placement transform (live, rigid)
//
// Sampling is stratified over the ink-weight CDF — deterministic, evenly
// covering, denser where the image is darker (or lighter, inverted).

const RASTER_MAX = 2048;      // longest raster side, px — big enough that a
                              // shipped plate (1852²) keeps every pixel; the
                              // photo overlay draws THIS raster, so it is the
                              // photograph's true resolution ceiling

function hash01(i) {
  let h = (i * 2654435761) >>> 0;
  h ^= h >> 13; h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

// Smooth value noise in [0,1] — a hashed integer grid, bilinearly interpolated
// with a smootherstep fade. Sampled over the image's normalised coordinates so
// the "erode" control eats braille in coherent PATCHES (organic, like ink that
// didn't take) rather than as uniform per-dot salt.
function vhash2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = vhash2(ix, iy),     b = vhash2(ix + 1, iy);
  const c = vhash2(ix, iy + 1), d = vhash2(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
// Two octaves → a fuller field. `cells` sets how many patches span the image
// (the erosion's grain): a few big cells eat coarse chunks, many small cells
// crumble the image as fine speckle. The +offsets keep the octaves from
// sharing zero-crossings.
function erodeNoise(u, v, cells) {
  return 0.7 * valueNoise(u * cells, v * cells)
       + 0.3 * valueNoise(u * cells * 2.3 + 11.5, v * cells * 2.3 + 7.3);
}
// grain knob (0..1) → cells across the image. Low grain = coarse chunks,
// high grain = fine speckle. Squared so the fine end gets more travel.
const erodeCells = (grain) => 3 + grain * grain * 60;

// column-major mat3 helpers (mirrors modes.js)
const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
function mul(a, b) {
  const o = new Array(9);
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++)
      o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("could not decode image"));
    img.src = url;
  });
}

/** File (.svg / .png / .jpg) → image mode with dedicated braille params. */
export async function imageModeFromFile(file, count) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error("image has no size");
    const s = Math.min(1, RASTER_MAX / Math.max(iw, ih));
    const w = Math.max(2, Math.round(iw * s)), hgt = Math.max(2, Math.round(ih * s));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = hgt;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, hgt);
    const d = ctx.getImageData(0, 0, w, hgt).data;

    // per-pixel alpha + luma, kept for re-sampling on every param change
    const A = new Float32Array(w * hgt), L = new Float32Array(w * hgt);
    let hasAlpha = false;
    for (let p = 0; p < w * hgt; p++) {
      A[p] = d[4 * p + 3] / 255;
      L[p] = (0.2126 * d[4 * p] + 0.7152 * d[4 * p + 1] + 0.0722 * d[4 * p + 2]) / 255;
      if (A[p] < 0.98) hasAlpha = true;
    }

    // auto polarity: transparent art → the glyph's own tone decides;
    // opaque art → the border guesses the background
    let autoInk = 0;
    if (hasAlpha) {
      let sum = 0, n = 0;
      for (let p = 0; p < w * hgt; p++) if (A[p] > 0.5) { sum += L[p]; n++; }
      autoInk = n && sum / n > 0.5 ? 1 : 0;
    } else {
      let sum = 0, n = 0;
      for (let x = 0; x < w; x++) { sum += L[x] + L[(hgt - 1) * w + x]; n += 2; }
      for (let y = 0; y < hgt; y++) { sum += L[y * w] + L[y * w + w - 1]; n += 2; }
      autoInk = sum / n > 0.5 ? 0 : 1;   // light border → dark ink, and vice versa
    }

    const label = file.name.replace(/\.(svg|png|jpe?g)$/i, "").slice(0, 24) || "art";

    // the overlay's handle on the ACTUAL pixels: the raster plus, refreshed
    // by every regen, the ink-extent frame the dots are normalised into.
    // Shared per import (a second clip of the same image with different
    // trace params re-aims it on its own regen — last regen wins).
    const photo = { raster: cv, map: null };

    return {
      key: `asset:import-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label,
      statusName: label.toUpperCase(),
      id: 18,                        // image field: rigid + block license
      image: true,
      photo,
      regen: ["threshold", "tone", "gamma", "contrast", "ink", "erode", "grain",
              "shift x", "shift y"],
      params: {
        threshold: { value: 0.5, min: 0.02, max: 0.98, step: 0.01 },
        tone:      { value: 0.7, min: 0, max: 1, step: 0.01 },
        gamma:     { value: 1.0, min: 0.25, max: 3, step: 0.05 },
        contrast:  { value: 1.0, min: 0.5, max: 2.5, step: 0.05 },
        ink:       { value: autoInk, min: 0, max: 1, step: 1 },
        // noise-driven dropout — 0 keeps the full image, up toward 1 removes
        // ever more braille. Independent of threshold/tone. `grain` sets the
        // patch size: low = coarse chunks, high = fine speckle.
        erode:     { value: 0, min: 0, max: 1, step: 0.01 },
        grain:     { value: 0.5, min: 0, max: 1, step: 0.01 },
        bright:    { value: 2.0, min: 0.2, max: 5, step: 0.05 },
        blocks:    { value: 0.6, min: 0, max: 1, step: 0.01 },
        // the ACTUAL image: 0 pure braille trace, 1 pure photograph —
        // the dots dissolve away (seed order) as the picture fades in
        photo:     { value: 0, min: 0, max: 1, step: 0.01 },
        size:      { value: 1.15, min: 0.4, max: 2.4, step: 0.01 },
        // reposition the whole figure — baked into the SAME frame the photo
        // overlay draws through, so dots and photograph move as one
        "shift x": { value: 0, min: -0.9, max: 0.9, step: 0.005 },
        "shift y": { value: 0, min: -0.9, max: 0.9, step: 0.005 },
        spin:      { value: 0, min: -1.5, max: 1.5, step: 0.01 },
        tilt:      { value: 0, min: -0.8, max: 0.8, step: 0.01 },
      },

      gen(N, P) {
        // ink weight per pixel: polarity → contrast S → gamma
        const inkLight = P.ink >= 0.5;
        const W = new Float32Array(w * hgt);
        const cdf = new Float64Array(w * hgt);
        let total = 0;
        const tonePow = P.tone * 2;
        for (let p = 0; p < w * hgt; p++) {
          let base = inkLight ? L[p] : 1 - L[p];
          if (hasAlpha) base *= A[p];
          base = Math.min(1, Math.max(0, (base - 0.5) * P.contrast + 0.5));
          const wgt = Math.pow(base, P.gamma);
          if (wgt >= P.threshold) {
            // tone: uniform stipple at 0, darkness-proportional density at 1
            total += tonePow > 0 ? Math.pow(wgt, tonePow) : 1;
            W[p] = wgt;
          }
          cdf[p] = total;
        }

        const pos = new Float32Array(3 * N);
        const aux = new Float32Array(N);
        const bri = new Float32Array(N);
        if (total <= 0) return { pos, aux, bri };   // nothing qualifies

        // stratified draw over the CDF — even, deterministic coverage
        const cells = erodeCells(P.grain);   // erosion grain → patches per image
        let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        for (let i = 0; i < N; i++) {
          const target = ((i + 0.5) / N) * total;
          let lo = 0, hi = w * hgt - 1;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < target) lo = mid + 1; else hi = mid; }
          const x = (lo % w) + hash01(i * 3 + 1) - 0.5;
          const y = -(Math.floor(lo / w) + hash01(i * 7 + 3) - 0.5);
          pos[3 * i] = x; pos[3 * i + 1] = y;
          bri[i] = (0.8 + 0.24 * hash01(i * 11 + 5)) * (0.55 + 0.45 * W[lo]);
          // erode: drop this dot where the noise field falls below the knob.
          // A little per-dot salt crumbles the patch borders instead of slicing
          // them. Dropped dots keep their slot (invisible), so nothing reflows
          // and the framing/extent is untouched as the image thins out.
          if (P.erode > 0) {
            const un = (lo % w) / w, vn = Math.floor(lo / w) / hgt;
            const n = erodeNoise(un, vn, cells) + (hash01(i * 17 + 9) - 0.5) * 0.12;
            if (n < P.erode) bri[i] = 0;
          }
          if (x < mnx) mnx = x; if (x > mxx) mxx = x;
          if (y < mny) mny = y; if (y > mxy) mxy = y;
        }
        const radius = Math.max(1e-4, 0.5 * Math.hypot(mxx - mnx, mxy - mny));
        // shift rides the normalisation centre, so the dots AND the photo
        // map (which the overlay derives its quad from) move identically
        const cx = (mnx + mxx) / 2 - (P["shift x"] || 0) * radius;
        const cy = (mny + mxy) / 2 - (P["shift y"] || 0) * radius;
        for (let i = 0; i < N; i++) {
          pos[3 * i] = (pos[3 * i] - cx) / radius;
          pos[3 * i + 1] = (pos[3 * i + 1] - cy) / radius;
        }
        photo.map = { w, h: hgt, cx, cy, radius };
        return { pos, aux, bri };
      },

      update(S, P, t) {
        const m = mul(rotX(P.tilt), rotY(t * P.spin));
        // _sizeCal: a shipped image locked to its GLB counterpart carries a
        // calibration factor so equal size params render equal extents
        const sz = P.size * (this._sizeCal || 1), gbr = P.bright;
        S.grp.set(m.map((v) => v * sz), 0);
        for (let k = 1; k < 4; k++) S.grp.set([sz, 0, 0, 0, sz, 0, 0, 0, sz], k * 9);
        S.gbri.set([gbr, gbr, gbr, gbr]);
        S.prm.set([P.blocks, 0, 0, 0]);   // the shader's block license
        S.prm2.set([0, 0, 0, 0]);
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
