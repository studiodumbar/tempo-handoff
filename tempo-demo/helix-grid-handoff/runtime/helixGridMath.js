export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
export const smoother = (v) => { const t = clamp01(v); return t * t * t * (t * (t * 6 - 15) + 10); };

export const REVEAL_EASINGS = ["flow", "balanced", "ease-out", "linear"];

/** One monotonic clock for particle arrivals and photo tiles, preserving their lead. */
export function createRevealTiming(curve = "flow", amount = .85) {
  const strength = clamp01(amount);
  if (curve === "linear" || strength === 0) return { timeAt: clamp01, progressAt: clamp01 };
  const [x1, y1, x2, y2] = {
    flow: [.4, 0, .2, 1], balanced: [.42, 0, .58, 1], "ease-out": [.16, 1, .3, 1],
  }[curve] || [.4, 0, .2, 1];
  const times = new Float64Array(513), progress = new Float64Array(513);
  const cubic = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  for (let i = 0; i < times.length; i++) {
    const t = i / (times.length - 1), x = cubic(t, x1, x2);
    times[i] = x; progress[i] = x + (cubic(t, y1, y2) - x) * strength;
  }
  // Invert a shared lookup once per sample, without iterative Bézier solves in the render loop.
  const lookup = (input, output, value) => {
    const v = clamp01(value);
    let lo = 0, hi = input.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (input[mid] < v) lo = mid; else hi = mid; }
    const fraction = (v - input[lo]) / (input[hi] - input[lo]);
    return output[lo] + (output[hi] - output[lo]) * fraction;
  };
  return { timeAt: (value) => lookup(progress, times, value), progressAt: (value) => lookup(times, progress, value) };
}

export function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Object-fit placement inside an existing image element, in CSS pixels. */
export function imageFit(iw, ih, width, height, fit = "contain", position = "50% 50%") {
  let w = width, h = height;
  if (fit !== "fill") {
    let scale = fit === "cover" ? Math.max(width / iw, height / ih) : Math.min(width / iw, height / ih);
    if (fit === "none") scale = 1;
    if (fit === "scale-down") scale = Math.min(1, scale);
    w = iw * scale; h = ih * scale;
  }
  const parts = position.trim().split(/\s+/);
  const offset = (value, space) => {
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return space;
    if (value === "center" || !value) return space / 2;
    return value.endsWith("%") ? parseFloat(value) / 100 * space : parseFloat(value) || 0;
  };
  return { x: offset(parts[0], width - w), y: offset(parts[1] || "50%", height - h), width: w, height: h };
}
