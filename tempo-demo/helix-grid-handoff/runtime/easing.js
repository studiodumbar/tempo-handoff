// Strong easings — the same family the terminal sketches use. Every transition
// in the studio runs through one of these; the default is easeInOutExpo (holds,
// snaps, holds).

export function expoInOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5
    ? 0.5 * Math.pow(2, 20 * x - 10)
    : 1 - 0.5 * Math.pow(2, -20 * x + 10);
}

export function expoOut(x) {
  if (x <= 0) return 0;
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

export function backOut(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  const t = x - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

export function elasticOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const p = 0.34;
  return Math.pow(2, -10 * x) * Math.sin(((x - p / 4) * 2 * Math.PI) / p) + 1;
}

/** The print pop: nothing, then everything — a dot (or a whole reveal block)
    switches on the instant its window opens. No glide, no in-between. */
export function hardStep(x) {
  return x <= 0 ? 0 : 1;
}

/** The vanish cut: position switches mid-window, and the shader darkens the
    dot for the whole window — the old braille sequentially animates OUT, the
    new prints in behind it. Zero movement, ever. */
export function vanishStep(x) {
  return x < 0.5 ? 0 : 1;
}

export function smooth(x) {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
}

/** A CSS `cubic-bezier(x1, y1, x2, y2)` timing function, evaluated at x.
    The curve runs (0,0) -> (x1,y1) -> (x2,y2) -> (1,1); x is solved for the
    parameter t by Newton-Raphson (bisection when Newton wanders off a flat
    stretch), then y(t) is the eased value. y may leave [0,1] — that is how
    the overshooting easings (back, anticipate) are written as beziers. */
export function bezierEase(x, x1, y1, x2, y2) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const atX = (t) => ((ax * t + bx) * t + cx) * t;
  const atY = (t) => ((ay * t + by) * t + cy) * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const d = atX(t) - x;
    if (Math.abs(d) < 1e-6) return atY(t);
    const slope = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(slope) < 1e-6) break;
    t -= d / slope;
  }
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < 24; i++) {
    const v = atX(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return atY(t);
}

/** Draw an already-eased 0..1 further out at BOTH ends — a symmetric power
    in-out laid over the curve, so the run creeps for much longer before and
    after and crosses the middle harder. A cubic-bezier cannot do this on its
    own: even the most extreme one, cubic-bezier(1, 0, 0, 1), is still 11% of
    the way through at 40% of the time, so the hold has to come from here.
    `snap` 1 leaves the curve exactly as it was; the middle slope scales with
    it, which is what keeps the expo crack while the ends stretch out.
    Values outside [0, 1] pass through untouched, so overshooting beziers
    (back, anticipate) keep their overshoot instead of going NaN. */
export function snapEase(e, snap) {
  const p = Math.max(1, snap || 1);
  if (p === 1 || !(e > 0 && e < 1)) return e;
  return e < 0.5 ? 0.5 * Math.pow(2 * e, p)
                 : 1 - 0.5 * Math.pow(2 * (1 - e), p);
}

// index order must match the easing switch in the vertex shader
export const EASE_NAMES = ["expoInOut", "expoOut", "backOut", "elasticOut", "print", "vanish"];
export const EASE_FNS = [expoInOut, expoOut, backOut, elasticOut, hardStep, vanishStep];
