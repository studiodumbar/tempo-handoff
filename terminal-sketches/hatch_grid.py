#!/usr/bin/env python3
"""
hatch_grid — the standard hatched-state sphere morphing into a dotted TABLE grid.

The basis is the "standard hatch state" sphere (hatch_states scene 1): a
lat/long globe where every front-facing sample is drawn as one short horizontal
scanline tick (`_dash`, which collapses to a single dot when short), leaned
toward the camera so the latitude rings stack into a pole vortex. Here each of
those hatch marks is treated as a PARTICLE: it starts on the spinning globe and
flies to an exact position on a dotted table/grid — the surface disassembles and
reassembles into the layout.

Unlike the looping hatch scenes, these do NOT loop: the sphere holds for a beat,
morphs once, and LANDS on the final grid, which then stays put forever. The grid
geometry is measured pixel-for-pixel from the reference (see `_H_YS` / `_V_XS`),
so the resting table is faithful; only the way the particles travel there varies.

Every variation shares one engine (`HatchGridScene`) and differs only in its
motion — the stagger order the marks leave the globe in, the flight path they
take, and the easing curve (mostly ease-in-out-expo, plus back / elastic snaps):

    1  grid · dissolve    marks stream left->right into the grid (expo)
    2  grid · explode     the globe bursts outward, then implodes onto the grid
    3  grid · spiral      marks swirl in, the pole vortex unwinding into lines
    4  grid · rain        rows rain down top->bottom under gravity, a soft bounce
    5  grid · unravel     latitude rings peel off one by one into the rules
    6  grid · snap         everything overshoots its slot and elastically snaps
    7  grid · sweep        a crisp wavefront wipes the sphere into grid, L->R
    8  grid · implode      the grid condenses inward out of the surrounding void
    9  grid · frame        cells fill first, the borders/dividers draw in last
   10  grid · diagonal    a diagonal wipe assembles the table corner to corner
   11  grid · vortex      a dramatic swirl-out: rings unwind through a wide arc
   12  grid · fold         the globe squashes to a band that unfolds into rows

Same mpp vocabulary. Run standalone: `python hatch_grid.py` — the interactive
explorer here paces itself to a steady 60fps (mpp's shared runner caps at 30),
falling back to mpp's dispatch for every flag (`--export`, `--no-motion`, ...).
"""

import math
import sys
import time
import signal

from mpp import Scene, _clamp, EASE, EASE_BACK, GENTLE, _cubic_bezier
from scenes import _dash

TAU = 2.0 * math.pi


# ===========================================================================
# Easing curves — the transitions lean on ease-in-out-expo; a few use back /
# elastic / smoother for character. All map [0,1] -> [0,1] with f(0)=0, f(1)=1.
# ===========================================================================
def _expo_io(x):
    """easeInOutExpo — holds dead-flat at both ends, whips through the middle."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


def _expo_o(x):
    """easeOutExpo — fast off the line, decelerating hard into the end."""
    if x >= 1.0:
        return 1.0
    return 1.0 - 2.0 ** (-10.0 * x)


def _expo_i(x):
    """easeInExpo — creeps, then accelerates into the end (a 'fall')."""
    if x <= 0.0:
        return 0.0
    return 2.0 ** (10.0 * x - 10.0)


def _smoother(x):
    """smootherstep 6x^5-15x^4+10x^3 — gentle sigmoid, no overshoot."""
    x = _clamp(x, 0.0, 1.0)
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0)


def _back_io(x):
    """easeInOutBack — overshoots slightly past both ends before settling."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    c2 = 1.70158 * 1.525
    if x < 0.5:
        return ((2.0 * x) ** 2 * ((c2 + 1.0) * 2.0 * x - c2)) / 2.0
    return ((2.0 * x - 2.0) ** 2 * ((c2 + 1.0) * (2.0 * x - 2.0) + c2) + 2.0) / 2.0


def _elastic_o(x):
    """easeOutElastic — springs past the target and rings down onto it."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    p = 0.34
    return 2.0 ** (-10.0 * x) * math.sin((x - p / 4.0) * TAU / p) + 1.0


_EASES = {
    "expo_io": _expo_io, "expo_o": _expo_o, "expo_i": _expo_i,
    "smoother": _smoother, "back_io": _back_io, "elastic_o": _elastic_o,
    "ease": EASE, "gentle": GENTLE, "back_o": EASE_BACK,
}


# ===========================================================================
# Faithful table geometry — measured from the reference (image 2000x1253).
#
# Bounding box of the whole figure (leftmost rule -> right end of the rows,
# top of the columns -> their bottom):
#     x in [227.8, 1802.0]  -> width  1574.2 px
#     y in [323.0,  854.0]  -> height  531.0 px
# Every coordinate below is normalised into that box: gx, gy in [0, 1] with gy
# pointing DOWN. The box is very wide and short (aspect ~2.965).
#
#   * 8 horizontal rules (dotted), each drawn from gx=_H_X0 to gx=1.0, at the
#     eight measured y's — they sit as four close pairs (a doubled "rule").
#   * 4 vertical rules (dotted), each drawn full height gy=0..1: the left border
#     is a close pair (227.8 / 239.8 px); two column dividers sit on the right
#     (1308.3 / 1560.1 px). The rows start just inside the left border, so the
#     border stands a hair proud of them — exactly as in the reference.
# ===========================================================================
_GRID_ASPECT = 1574.2 / 531.0

_H_X0 = (253.0 - 227.8) / 1574.2                       # rows start here in gx
_H_YS = tuple((y - 323.0) / 531.0 for y in
              (411.1, 421.0, 524.4, 534.3, 638.0, 647.6, 751.2, 762.0))
_V_XS = tuple((x - 227.8) / 1574.2 for x in
              (227.8, 239.8, 1308.3, 1560.1))


def _grid_targets(x0, y0, gw, gh, gap):
    """The dotted grid's dot slots, in braille units — the faithful resting
    table. Each rule is walked at ~`gap` spacing so it reads as a dotted line.

    Returns a list of (x, y, is_vertical, line_frac): `is_vertical` flags the
    four column rules, `line_frac` orders all twelve rules 0..1 (rows top->bottom
    then columns left->right) so a scene can build the table rule-by-rule."""
    def sx(gx):
        return x0 + gx * gw

    def sy(gy):
        return y0 + gy * gh

    lines = []                                          # (a, b, c, d, vertical)
    for hy in _H_YS:                                    # rows: horizontal
        lines.append((sx(_H_X0), sy(hy), sx(1.0), sy(hy), 0))
    for vx in _V_XS:                                    # columns: vertical
        lines.append((sx(vx), sy(0.0), sx(vx), sy(1.0), 1))

    pts = []
    n_lines = len(lines)
    for li, (ax, ay, bx, by, vert) in enumerate(lines):
        length = math.hypot(bx - ax, by - ay)
        n = max(1, int(round(length / gap)))
        lf = li / (n_lines - 1)
        for i in range(n + 1):
            u = i / n
            pts.append((ax + (bx - ax) * u, ay + (by - ay) * u, vert, lf))
    return pts


# ===========================================================================
# The morph engine
# ===========================================================================
class HatchGridScene(Scene):
    """Standard hatched sphere -> faithful dotted table, once, then hold.

    Each hatch mark is a particle with a fixed grid destination. The base draws
    the idle globe, then flies every mark to its slot; subclasses only retune
    the motion (STAGGER order, PATH shape, EASE curve, timings)."""

    # -- the sphere (the standard hatch state) -----------------------------
    N_LAT = 38            # latitude scanline bands
    LON_MAX = 120         # longitude samples at the equator
    LON_MIN = 8           # longitude samples near the poles
    RADIUS_FRAC = 0.34    # sphere radius as a fraction of the short axis
    SPIN = 0.24           # idle yaw, radians / second
    TILT = 0.46           # pole leaned toward the camera (radians)
    TILT_WOBBLE = 0.12    # gentle nod amplitude
    TILT_RATE = 0.5
    FOCAL_FRAC = 3.0      # perspective focal distance, in radius units
    DASH = 1.7            # scanline half-length at the near plane
    BREATHE = 0.03        # idle radial breathing amplitude
    EPS = 0.05            # cull the grazing limb for a crisp silhouette

    # -- the table ---------------------------------------------------------
    FILL_W = 0.9          # grid width as a fraction of the canvas width
    FILL_H = 0.82         # ... and height (the wide/short box fits inside both)
    DOT_GAP = 2.6         # spacing between dots along a rule (braille units)
    DOT_HALF = 0.0        # resting-dot tick half-length (0 -> a single dot)

    # -- timing (one-shot; the grid is the terminal state) -----------------
    HOLD = 1.1            # seconds the pure sphere holds before morphing
    DUR = 3.6             # seconds the morph takes to complete

    # -- motion knobs ------------------------------------------------------
    STAGGER = "x"         # order marks leave the globe: x/y/lat/angle/diag/
    #                       line/kind/none  (see _stagger_key)
    SPREAD = 0.55         # how sequential the stagger is (0 = all together,
    #                       ->1 = strictly one after another)
    EASE = "expo_io"      # per-particle easing (key into _EASES)
    PATH = "lerp"         # flight path: lerp/explode/spiral/arc/void (see _path)
    BULGE = 0.0           # radial bulge amplitude for 'explode', braille units
    TURNS = 0.0           # extra winding (revolutions) for 'spiral'
    SAG = 0.0             # gravity dip for 'arc', braille units
    STREAK = 0.5          # mid-flight tick lengthening (a motion streak)
    SPIN_DOWN = True      # let the residual globe spin ease to a stop as it goes

    # ---- lazy per-size build (globe, targets, assignment, stagger keys) ---
    def _ensure(self, canvas):
        key = (canvas.cols, canvas.rows)
        if getattr(self, "_key", None) == key:
            return
        self._key = key
        wu, hu = canvas.wu, canvas.hu
        gw = min(self.FILL_W * wu, self.FILL_H * hu * _GRID_ASPECT)
        gh = gw / _GRID_ASPECT
        x0 = (wu - gw) / 2.0
        y0 = (hu - gh) / 2.0
        self._box = (x0, y0, gw, gh)
        self._gc = (x0 + gw / 2.0, y0 + gh / 2.0)       # grid centre
        self._targets = _grid_targets(x0, y0, gw, gh, self.DOT_GAP)
        self._globe = self._make_globe()
        self._assign = self._make_assignment()
        self._keys = self._make_keys()

    def _make_globe(self):
        """Unit surface directions of the standard hatch globe: the lat/long
        grid, returned as (ux, uy, uz, lat_frac, phi_frac) so the sphere still
        reads with its latitude rings and pole vortex."""
        pts = []
        for li in range(1, self.N_LAT):
            theta = math.pi * li / self.N_LAT
            sint, cost = math.sin(theta), math.cos(theta)
            nlon = max(self.LON_MIN, int(self.LON_MAX * sint))
            lf = li / self.N_LAT
            for j in range(nlon):
                phi = TAU * j / nlon
                ux = sint * math.cos(phi)
                uz = sint * math.sin(phi)
                uy = cost
                pts.append((ux, uy, uz, lf, j / nlon))
        return pts

    def _make_assignment(self):
        """Map each globe mark to a grid dot slot. Marks and slots are both
        sorted by screen x (then y) and paired in rank order, so the assembly is
        left->right coherent and every slot receives at least one mark. Several
        marks may share a slot (the globe is denser than the grid); they simply
        stack into one dot as they land."""
        tgts = self._targets
        order_t = sorted(range(len(tgts)), key=lambda k: (tgts[k][0], tgts[k][1]))
        order_p = sorted(range(len(self._globe)),
                         key=lambda i: (self._globe[i][0], self._globe[i][1]))
        nt, npt = len(tgts), len(self._globe)
        assign = [0] * npt
        for rank, i in enumerate(order_p):
            assign[i] = order_t[rank * nt // npt]
        return assign

    def _stagger_key(self, i):
        """A value in [0,1] deciding WHEN mark i lifts off (0 first, 1 last)."""
        x0, y0, gw, gh = self._box
        gcx, gcy = self._gc
        ux, uy, uz, lf, pf = self._globe[i]
        tx, ty, vert, line_f = self._targets[self._assign[i]]
        fx = (tx - x0) / gw if gw else 0.5
        fy = (ty - y0) / gh if gh else 0.5
        s = self.STAGGER
        if s == "x":
            return fx
        if s == "y":
            return fy
        if s == "lat":
            return lf
        if s == "angle":
            return (math.atan2(ty - gcy, tx - gcx) + math.pi) / TAU
        if s == "diag":
            return _clamp(0.5 * (fx + fy), 0.0, 1.0)
        if s == "line":
            return line_f
        if s == "kind":                                 # rows first, columns last
            return 0.5 * line_f if not vert else 0.6 + 0.4 * line_f
        return 0.0                                       # "none": all together

    def _make_keys(self):
        return [self._stagger_key(i) for i in range(len(self._globe))]

    # ---- the flight path from globe point p0 to grid slot p1 --------------
    def _path(self, p0, p1, s):
        """Position at eased progress s in [0,1]. Overridden implicitly by the
        PATH attribute; all shapes return exactly p0 at s=0 and p1 at s=1 so the
        landing is always pixel-exact."""
        x = p0[0] + (p1[0] - p0[0]) * s
        y = p0[1] + (p1[1] - p0[1]) * s
        kind = self.PATH
        if kind == "lerp":
            return x, y
        gcx, gcy = self._gc
        if kind == "explode":
            dx, dy = x - gcx, y - gcy
            d = math.hypot(dx, dy) or 1.0
            b = self.BULGE * math.sin(math.pi * s)       # out and back, 0 at ends
            return x + dx / d * b, y + dy / d * b
        if kind == "arc":
            return x, y + self.SAG * math.sin(math.pi * s)   # dip and settle
        if kind == "spiral":
            # Interpolate in polar about the grid centre and add a winding that
            # peaks mid-flight and unwinds to nothing — a swirl that lands clean.
            a0 = math.atan2(p0[1] - gcy, p0[0] - gcx)
            r0 = math.hypot(p0[0] - gcx, p0[1] - gcy)
            a1 = math.atan2(p1[1] - gcy, p1[0] - gcx)
            r1 = math.hypot(p1[0] - gcx, p1[1] - gcy)
            da = (a1 - a0 + math.pi) % TAU - math.pi
            ang = a0 + da * s + self.TURNS * TAU * math.sin(math.pi * s)
            r = r0 + (r1 - r0) * s
            return gcx + r * math.cos(ang), gcy + r * math.sin(ang)
        return x, y

    # ---- projection of a globe direction to the screen -------------------
    @staticmethod
    def _project(ux, uy, uz, cx, cy, R, cyaw, syaw, ct, st, focal):
        x1 = ux * cyaw + uz * syaw
        z1 = -ux * syaw + uz * cyaw
        y2 = uy * ct - z1 * st
        z2 = uy * st + z1 * ct
        f = focal / (focal - z2 * R)
        return cx + x1 * R * f, cy - y2 * R * f, z2, f

    def _pose(self, t, m):
        """Yaw/tilt/breathe for the globe at time t and morph fraction m."""
        spin = self.SPIN * (1.0 - m) if self.SPIN_DOWN else self.SPIN
        yaw = t * spin
        tilt = self.TILT + self.TILT_WOBBLE * math.sin(t * self.TILT_RATE)
        breathe = 1.0 + self.BREATHE * math.sin(t * 0.8) * (1.0 - m)
        return yaw, tilt, breathe

    # ---- the three states -------------------------------------------------
    def _draw_sphere(self, canvas, t, m):
        """The standard hatch state sphere (front hemisphere, hatch ticks)."""
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R0 = min(wu, hu) * self.RADIUS_FRAC
        yaw, tilt, breathe = self._pose(t, m)
        R = R0 * breathe
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        ct, st = math.cos(tilt), math.sin(tilt)
        focal = self.FOCAL_FRAC * R0
        for ux, uy, uz, lf, pf in self._globe:
            px, py, z2, f = self._project(ux, uy, uz, cx, cy, R,
                                          cyaw, syaw, ct, st, focal)
            if z2 <= self.EPS:
                continue
            _dash(canvas, px, py, self.DASH * f * (0.45 + 0.55 * z2))

    def _draw_grid(self, canvas):
        """The faithful resting table — drawn straight from the measured slots."""
        h = self.DOT_HALF
        for tx, ty, vert, lf in self._targets:
            _dash(canvas, tx, ty, h)

    def _draw_morph(self, canvas, t, m):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R0 = min(wu, hu) * self.RADIUS_FRAC
        yaw, tilt, breathe = self._pose(t, m)
        R = R0 * breathe
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        ct, st = math.cos(tilt), math.sin(tilt)
        focal = self.FOCAL_FRAC * R0
        ease = _EASES[self.EASE]
        spread = self.SPREAD
        span = 1.0 - spread if spread < 1.0 else 1e-6
        keys = self._keys
        tgts = self._targets
        assign = self._assign
        for idx, (ux, uy, uz, lf, pf) in enumerate(self._globe):
            px, py, z2, f = self._project(ux, uy, uz, cx, cy, R,
                                          cyaw, syaw, ct, st, focal)
            front = z2 > self.EPS
            local = _clamp((m - keys[idx] * spread) / span, 0.0, 1.0)
            if local <= 0.0:
                # Not yet lifted off: keep it as part of the globe (and hide the
                # back hemisphere so the sphere still reads as a solid surface).
                if front:
                    _dash(canvas, px, py, self.DASH * f * (0.45 + 0.55 * z2))
                continue
            s = ease(local)
            tx, ty, vert, line_f = tgts[assign[idx]]
            x, y = self._path((px, py), (tx, ty), s)
            # Length eases from a bright sphere tick down to the resting dot, with
            # a mid-flight lengthening so fast marks streak.
            sphere_half = self.DASH * f * (0.45 + 0.55 * max(z2, 0.0))
            half = (1.0 - s) * sphere_half + s * self.DOT_HALF
            half += self.STREAK * math.sin(math.pi * s)
            _dash(canvas, x, y, half)

    # ---- entry ------------------------------------------------------------
    def draw(self, canvas):
        self._ensure(canvas)
        m = _clamp((self.t - self.HOLD) / self.DUR, 0.0, 1.0)
        if m <= 0.0:
            self._draw_sphere(canvas, self.t, 0.0)
        elif m >= 1.0:
            self._draw_grid(canvas)
        else:
            self._draw_morph(canvas, self.t, m)

    def status(self):
        m = _clamp((self.t - self.HOLD) / self.DUR, 0.0, 1.0)
        if m <= 0.0:
            return "SPHERE"
        if m >= 1.0:
            return "GRID · HOLD"          # 'HOLD' -> static export lands here
        return "MORPH"


# ===========================================================================
# Variations — each only retunes the motion; all land on the same table.
# ===========================================================================
class HatchGridDissolveScene(HatchGridScene):
    """Marks stream off the globe left->right and slot into the grid on a clean
    ease-in-out-expo. The plainest, most legible assembly."""
    name = "grid · dissolve"
    STAGGER = "x"
    SPREAD = 0.6
    EASE = "expo_io"
    PATH = "lerp"
    STREAK = 0.4


class HatchGridExplodeScene(HatchGridScene):
    """The globe bursts outward all at once, then the debris implodes onto the
    grid — a hard expo in-out with a big radial bulge through the middle."""
    name = "grid · explode"
    STAGGER = "none"
    SPREAD = 0.0
    EASE = "expo_io"
    PATH = "explode"
    BULGE = 26.0
    HOLD = 0.9
    DUR = 3.2
    STREAK = 0.7


class HatchGridSpiralScene(HatchGridScene):
    """Marks swirl inward, the pole vortex unwinding into straight rules. Polar
    flight with a winding that resolves exactly on the slot."""
    name = "grid · spiral"
    STAGGER = "angle"
    SPREAD = 0.5
    EASE = "expo_io"
    PATH = "spiral"
    TURNS = 0.6
    STREAK = 0.5


class HatchGridRainScene(HatchGridScene):
    """The table rains into place top->bottom: rows fall under gravity
    (ease-in / accelerate) with a small sag that settles."""
    name = "grid · rain"
    STAGGER = "y"
    SPREAD = 0.7
    EASE = "expo_i"
    PATH = "arc"
    SAG = 7.0
    SPIN = 0.16
    STREAK = 0.6


class HatchGridUnravelScene(HatchGridScene):
    """Latitude rings peel off the globe one at a time (stagger by latitude) and
    stretch out into the rules — a sequential unspooling."""
    name = "grid · unravel"
    STAGGER = "lat"
    SPREAD = 0.75
    EASE = "expo_io"
    PATH = "lerp"
    SPIN = 0.5             # a livelier spin so the peeling rings read
    STREAK = 0.6


class HatchGridSnapScene(HatchGridScene):
    """Every mark flies out together and elastically snaps onto its slot,
    overshooting and ringing down — a springy, mechanical assembly."""
    name = "grid · snap"
    STAGGER = "diag"
    SPREAD = 0.35
    EASE = "elastic_o"
    PATH = "lerp"
    STREAK = 0.3
    DUR = 3.9


class HatchGridSweepScene(HatchGridScene):
    """A crisp wavefront sweeps left->right; ahead of it the sphere, behind it
    the finished grid. High spread + expo makes a tight, moving seam."""
    name = "grid · sweep"
    STAGGER = "x"
    SPREAD = 0.9
    EASE = "expo_io"
    PATH = "lerp"
    STREAK = 0.9
    DUR = 3.4


class HatchGridImplodeScene(HatchGridScene):
    """The grid condenses inward out of the surrounding void: marks are flung far
    past the frame first, then drawn in. A big outward bulge with an ease that
    lingers at the edge before rushing home."""
    name = "grid · implode"
    STAGGER = "angle"
    SPREAD = 0.4
    EASE = "expo_o"
    PATH = "explode"
    BULGE = 40.0
    HOLD = 0.9
    DUR = 3.4
    STREAK = 0.5


class HatchGridFrameScene(HatchGridScene):
    """The cell contents fill first and the borders / column dividers draw in
    last, so the table's frame closes around a settled interior."""
    name = "grid · frame"
    STAGGER = "kind"
    SPREAD = 0.7
    EASE = "expo_io"
    PATH = "lerp"
    STREAK = 0.5


class HatchGridDiagonalScene(HatchGridScene):
    """A diagonal wipe assembles the table from the top-left corner outward on a
    smooth ease-in-out-expo."""
    name = "grid · diagonal"
    STAGGER = "diag"
    SPREAD = 0.8
    EASE = "expo_io"
    PATH = "lerp"
    STREAK = 0.6


class HatchGridVortexScene(HatchGridScene):
    """A dramatic swirl-out: the rings unwind through a wide arc, staggered by
    latitude, before the lines straighten and lock."""
    name = "grid · vortex"
    STAGGER = "lat"
    SPREAD = 0.55
    EASE = "expo_io"
    PATH = "spiral"
    TURNS = 1.15
    SPIN = 0.7
    STREAK = 0.7
    DUR = 4.0


class HatchGridFoldScene(HatchGridScene):
    """The globe squashes toward the mid-line and the flattened band unfolds
    outward into the stacked rows (stagger by vertical distance from centre)."""
    name = "grid · fold"
    STAGGER = "y"
    SPREAD = 0.5
    EASE = "back_io"
    PATH = "arc"
    SAG = -5.0            # a slight rise as rows peel away from the mid-line
    STREAK = 0.5

    def _stagger_key(self, i):
        # Rows nearest the horizontal mid-line unfold first, then outward.
        x0, y0, gw, gh = self._box
        _, ty, _, _ = self._targets[self._assign[i]]
        fy = (ty - y0) / gh if gh else 0.5
        return _clamp(abs(fy - 0.5) * 2.0, 0.0, 1.0)


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        HatchGridDissolveScene(),   # 1  dissolve
        HatchGridExplodeScene(),    # 2  explode
        HatchGridSpiralScene(),     # 3  spiral
        HatchGridRainScene(),       # 4  rain
        HatchGridUnravelScene(),    # 5  unravel
        HatchGridSnapScene(),       # 6  snap
        HatchGridSweepScene(),      # 7  sweep
        HatchGridImplodeScene(),    # 8  implode
        HatchGridFrameScene(),      # 9  frame
        HatchGridDiagonalScene(),   # 10 diagonal
        HatchGridVortexScene(),     # 11 vortex
        HatchGridFoldScene(),       # 12 fold
    ]


# ===========================================================================
# A steady 60fps interactive explorer.
#
# mpp's shared runner paces frames with `inkey(timeout=FRAME_DT)` at a fixed
# 1/30s, so its period is (work + 33ms) — never above 30fps regardless of how
# cheap a frame is. These morphs cost ~1-14ms per frame, well inside a 16.7ms
# budget, so a runner that sleeps only the REMAINING time to the next 60Hz tick
# holds a real 60fps (and drops gracefully to work-limited only if a single
# frame ever overruns). It reuses mpp's Terminal / Canvas / _paint verbatim —
# nothing in mpp.py is touched — and keeps the same keys: digits pick a scene,
# left/right or [ ] step, space pauses, r restarts, q quits.
# ===========================================================================
TARGET_FPS = 60.0
TARGET_DT = 1.0 / TARGET_FPS


def run(scenes):
    import mpp

    term = mpp.Terminal()
    if not sys.stdout.isatty():            # piped / captured: one static frame
        mpp._run_static(scenes)
        return

    idx = 0
    paused = False
    scenes[idx].reset()
    log = mpp.EventLog(mpp.log_path())
    log.event("START", "%dx%d term 60fps scene=%s"
              % (term.width, term.height, scenes[idx].name))

    stop = {"flag": False}

    def _on_sigint(_s, _f):
        stop["flag"] = True

    prev_sigint = signal.signal(signal.SIGINT, _on_sigint)
    try:
        with term.fullscreen(), term.hidden_cursor(), term.cbreak():
            canvas = None
            prev_grid = None
            prev_dims = None
            force = True
            last = time.monotonic()
            acc = 0.0
            frames = 0
            status_last = last
            prev_status = scenes[idx].status()
            next_tick = last            # absolute 60Hz schedule (self-correcting)

            while not stop["flag"]:
                cols = term.width
                crows = max(term.height, 1)
                if (cols, term.height) != prev_dims:
                    prev_dims = (cols, term.height)
                    canvas = mpp.Canvas(cols, crows)
                    prev_grid = None
                    force = True
                    sys.stdout.write(term.home + term.clear)

                # Fixed-timestep simulation, decoupled from the 60fps draw.
                now = time.monotonic()
                dt = now - last
                last = now
                if dt > 0.25:
                    dt = 0.25
                acc += dt
                while acc >= mpp.SIM_DT:
                    if not paused:
                        scenes[idx].update(mpp.SIM_DT)
                    acc -= mpp.SIM_DT

                canvas.clear()
                scenes[idx].draw(canvas)
                grid = canvas.compose()
                out = []
                mpp._paint(term, out, grid, None if force else prev_grid)
                out.append(term.move_xy(1, crows - 1)
                           + "\033[2m" + str(idx + 1) + "\033[22m")
                sys.stdout.write("".join(out))
                sys.stdout.flush()
                prev_grid = grid
                force = False

                frames += 1
                st = scenes[idx].status()
                if st != prev_status:
                    if st:
                        log.event("PHASE", "%s: %s" % (scenes[idx].name, st))
                    prev_status = st
                if now - status_last >= 1.0:
                    fps = frames / (now - status_last)
                    log.event("STATUS", "scene=%s fps=%4.1f%s"
                              % (scenes[idx].name, fps,
                                 " PAUSED" if paused else ""))
                    frames = 0
                    status_last = now

                # Pace to an ABSOLUTE 60Hz schedule: advance the tick by a fixed
                # 1/60s and wait until it. Sleeping to an absolute target (rather
                # than a per-frame relative amount) self-corrects sleep overshoot
                # and drift, holding a true 60fps average. The wait doubles as a
                # responsive key read (returns early on a press); a big overrun
                # (resize / GC stall) resyncs the schedule instead of chasing it.
                next_tick += TARGET_DT
                remaining = next_tick - time.monotonic()
                if remaining < -0.1:
                    next_tick = time.monotonic()
                    remaining = 0.0
                key = term.inkey(timeout=remaining if remaining > 0.0 else 0.0)
                if stop["flag"]:
                    break
                if not key:
                    continue
                ch = str(key).lower()
                new_idx = None
                if ch == "q":
                    break
                elif ch.isdigit() and 1 <= int(ch) <= len(scenes):
                    new_idx = int(ch) - 1
                elif key.name == "KEY_RIGHT" or ch == "]":
                    new_idx = (idx + 1) % len(scenes)
                elif key.name == "KEY_LEFT" or ch == "[":
                    new_idx = (idx - 1) % len(scenes)
                elif key == " ":
                    paused = not paused
                elif ch == "r":
                    scenes[idx].reset()
                    force = True
                if new_idx is not None:
                    idx = new_idx
                    scenes[idx].reset()
                    prev_status = scenes[idx].status()
                    force = True
                    log.event("SCENE", "%d %s" % (idx + 1, scenes[idx].name))
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGINT, prev_sigint)
        log.event("STOP", "ctrl-c" if stop["flag"] else "quit")
        log.close()


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    # Bare interactive launch on a TTY -> the 60fps explorer. Any flag
    # (--export/--no-motion/--banner/--scene/...) or a non-TTY stdout hands off
    # to mpp's standard dispatch so all existing behaviour is preserved.
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        run(_scenes)
