// shapes.mjs — Tempo 3D shape projections, extracted as a standalone module.
//
// The whole "3D" is procedural: a 2D point from the flat text layout (wx along the
// ruler, wy up the glyph) is wrapped onto a parametric surface, tilted (pitch), and
// projected orthographically to screen. Five shapes: cylinder, cone, sphere, square
// (rounded-square prism), pyramid. No dependencies. Ported line-for-line from the
// projectN closures + squareAt() in index.html.
//
// Coordinate conventions (match the original):
//   wx  : horizontal position along the text ruler, font units, range 0..Wmax
//   wy  : vertical position on the glyph, font units, already centered (y - capHeight/2)
//   R   : on-screen radius (original uses 1000; pick any consistent value)
//   scale = 2*PI*R / Wmax  (font units -> screen units; same for the square via P/Wmax)
//
// project*() return [Xscreen, Yscreen, Zdepth]. Z>0 (after the facing test) = front-facing.

const TWO_PI = Math.PI * 2;
const HPI = Math.PI / 2;

// -------------------------------------------------------------------------
// Per-line factors for stacked lines / tapers.
//   n     : line index, 0..NI-1
//   NI    : number of lines
//   opts  : { taper, lineSpacing, halfExtent, R }
// Returns { kn, stackOff } — the size multiplier and the vertical screen offset.
// ---------------------------------------------------------------------------
export function lineFactors(shape, n, NI, opts = {}) {
  const { taper = 0.7, lineSpacing = 1, halfExtent = 0, R = 1000 } = opts;
  if (NI <= 1) return { kn: 1, stackOff: 0 };
  const u = n / (NI - 1);          // 0..1, bottom -> top
  const t = 2 * u - 1;             // -1..1
  const phiMax = Math.acos(1 - taper);
  let kn = 1, stackOff = halfExtent * t;
  switch (shape) {
    case 'cone':
    case 'pyramid':
      kn = 1 - taper * (1 - u);
      break;
    case 'sphere':
      kn = Math.cos(t * phiMax);
      stackOff = R * Math.sin(t * phiMax) * lineSpacing;  // true latitudes
      break;
    default: break;              // cylinder, square: kn=1, box spacing
  }
  return { kn, stackOff };
}

// ---------------------------------------------------------------------------
// Cross-section of the rounded square, centered at the origin, perimeter P.
//   corner c = r/S in [0, 0.5]; c=0 sharp square, c=0.5 == circle of radius R.
// sqAt(t) walks the perimeter fraction t (0..1) -> [px, py, nx, ny]
//   (point + INWARD unit normal). This is the closed form from the GLSL port.
// ---------------------------------------------------------------------------
export function makeRoundedSquare(corner, P) {
  const c = Math.max(0, Math.min(0.5, corner));
  const S = P / (4 - c * (8 - 2 * Math.PI));  // side length so perimeter == P
  const r = c * S;                            // corner radius
  const hs = S / 2;
  const sd = S - 2 * r;                       // straight run per edge
  const ar = HPI * r;                         // arc length per corner
  const total = 4 * sd + 4 * ar;
  function sqAt(t) {
    let d = (((t % 1) + 1) % 1) * total;      // distance along perimeter
    const b1 = sd, b2 = b1 + ar, b3 = b2 + sd, b4 = b3 + ar,
          b5 = b4 + sd, b6 = b5 + ar, b7 = b6 + sd;
    if (d < b1) return [-hs + r + d, -hs, 0, 1];                    // top edge
    if (d < b2) { const a = -HPI + (d - b1) / ar * HPI;            // TR corner
      return [hs - r + r * Math.cos(a), -hs + r + r * Math.sin(a), -Math.cos(a), -Math.sin(a)]; }
    if (d < b3) return [hs, -hs + r + (d - b2), -1, 0];            // right edge
    if (d < b4) { const a = (d - b3) / ar * HPI;                   // BR corner
      return [hs - r + r * Math.cos(a), hs - r + r * Math.sin(a), -Math.cos(a), -Math.sin(a)]; }
    if (d < b5) return [hs - r - (d - b4), hs, 0, -1];             // bottom edge
    if (d < b6) { const a = HPI + (d - b5) / ar * HPI;            // BL corner
      return [-hs + r + r * Math.cos(a), hs - r + r * Math.sin(a), -Math.cos(a), -Math.sin(a)]; }
    if (d < b7) return [-hs, hs - r - (d - b6), 1, 0];            // left edge
    const a = Math.PI + (d - b7) / ar * HPI;                       // TL corner
    return [-hs + r + r * Math.cos(a), -hs + r + r * Math.sin(a), -Math.cos(a), -Math.sin(a)];
  }
  return { S, r, total, sqAt };
}

// ---------------------------------------------------------------------------
// CYLINDER / CONE / SPHERE — all three are the cylinder equation with a
// per-line size factor kn (and, for the sphere, a geometric stackOff).
//   wx, wy : layout point (font units)
//   p      : { R, Wmax, scale, theta0, kn, dyF, sp, cpa }
//     theta0 = fold-in of shift/spin/yaw (radians)
//     dyF    = stackOff / scale   (vertical offset in font units)
//     sp = -sin(pitch), cpa = cos(pitch)
// ---------------------------------------------------------------------------
export function projectCylinder(wx, wy, p) {
  const { R, Wmax, scale, theta0 = 0, kn = 1, dyF = 0, sp = 0, cpa = 1 } = p;
  const th = (wx / Wmax) * TWO_PI + theta0;
  const X = R * kn * Math.sin(th);
  const Z = R * kn * Math.cos(th);
  const Y = (wy * kn + dyF) * scale;
  const Yp = Y * cpa - Z * sp;         // pitch about X
  const Zp = Y * sp + Z * cpa;         // depth
  return [X, -Yp, Zp];
}
export const projectCone = projectCylinder;    // differs only via kn
export const projectSphere = projectCylinder;  // differs only via kn + stackOff

// ---------------------------------------------------------------------------
// SQUARE (rounded-square prism) / PYRAMID — same construction, cross-section
// swapped for sqAt(). Pyramid differs only via kn.
//   p adds: sqAt (from makeRoundedSquare), uOff (perimeter offset), cyN/syN (yaw)
// ---------------------------------------------------------------------------
export function projectSquare(wx, wy, p) {
  const { sqAt, Wmax, scale, uOff = 0, kn = 1, dyF = 0,
          cyN = 1, syN = 0, sp = 0, cpa = 1 } = p;
  const s = sqAt(wx / Wmax + uOff);
  const X = (s[0] * cyN - s[1] * syN) * kn;   // rotate cross-section about vertical axis
  const Z = (-s[1] * cyN - s[0] * syN) * kn;  // (X,Z) = (px,-py) yaw-rotate
  const Y = (wy * kn + dyF) * scale;
  const Yp = Y * cpa - Z * sp;
  const Zp = Y * sp + Z * cpa;
  return [X, -Yp, Zp];
}
export const projectPyramid = projectSquare;   // differs only via kn

// Facing test for the prism/pyramid (outward normal points toward viewer).
export function squareFacing(wx, p) {
  const s = p.sqAt(wx / p.Wmax + (p.uOff || 0));
  return (s[3] * p.cyN + s[2] * p.syN) * p.cpa > 0;
}

// ---------------------------------------------------------------------------
// Shared screen transform applied after any project*(): zoom, screen-plane roll
// (rotZ), pan. Orthographic — no perspective divide.
//   [X, Yscreen] -> final 2D. rotZ in radians.
// ---------------------------------------------------------------------------
export function toScreen([X, Y], { zoom = 1, rotZ = 0, panX = 0, panY = 0 } = {}) {
  let qx = X * zoom, qy = Y * zoom;
  const cr = Math.cos(rotZ), sr = Math.sin(rotZ);
  return [qx * cr - qy * sr + panX, qx * sr + qy * cr + panY];
}

// -------------------------------------------------------------------------
// Convenience: one dispatcher. Build `p` once per line, then call for each point.
// ---------------------------------------------------------------------------
export function project(shape, wx, wy, p) {
  switch (shape) {
    case 'cylinder':
    case 'cone':
    case 'sphere':  return projectCylinder(wx, wy, p);
    case 'square':
    case 'pyramid': return projectSquare(wx, wy, p);
    default: throw new Error('unknown shape: ' + shape);
  }
}
