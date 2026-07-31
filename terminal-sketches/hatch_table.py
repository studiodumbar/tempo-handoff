#!/usr/bin/env python3
"""
hatch_table — hatch_grid's particle table, without the sphere.

hatch_grid's engine is the thing the motion lives in: every dot of the
faithful measured table is a PARTICLE with a stagger key, a flight path, an
easing curve and a mid-flight streak, and the landing is pixel-exact. But
all of its scenes fly the particles off the standard hatch globe. Here the
globe is gone — the particles are born as DUST: organic, hash-seeded clouds
that drift and breathe, then fly to their slots and crystallise into the
table. One particle per table dot; before lift-off every particle wobbles
on its own little hash orbit, and the wobble is blended out by the flight
itself, so nothing ever snaps.

Like hatch_grid these are ONE-SHOT: dust for a beat, one assembly, and the
finished table holds forever (static frames from then on — usable). The
table geometry, dot spacing and the easing library come from hatch_grid
verbatim; the resting grid is identical to its landing state.

    1  table · condense   a centre cloud (the reference screenshot): dust
                          breathing around the middle, condensing outward
                          onto the rules, inner dots first, a slight swirl
    2  table · burst      born as one tight knot at the centre, thrown
                          outward through a radial bulge onto the grid
    3  table · rain       dust scattered high above the frame falls in,
                          rows landing top to bottom with a soft dip
    4  table · drift      dust everywhere; the whole field glides gently
                          into place at once — the calm one
    5  table · vortex     born on a ring, swirling in with a winding that
                          unwinds to nothing at the moment of landing
    6  table · sweep      a dust bank off the left edge streams across,
                          a wavefront assembling the table left to right
    7  table · snap       each dot is born jittered around its own slot
                          and elastically snaps home, rule by rule
    8  table · implode    dust flung far outside the frame collapses
                          inward out of the void

Run standalone: `python hatch_table.py` (hatch_grid's 60fps explorer).
"""

import math
import sys

from mpp import Scene, _clamp
from scenes import _dash
from hatch_grid import _EASES, _grid_targets, _GRID_ASPECT

TAU = 2.0 * math.pi


def _h(i, salt=0.0):
    """Deterministic per-particle hash in [0,1)."""
    return (math.sin(i * 127.1 + salt * 311.7) * 43758.5453) % 1.0


class HatchTableScene(Scene):
    """Dust -> faithful dotted table, once, then hold. Subclasses supply the
    dust distribution (_origin) and retune stagger / path / ease knobs."""

    # -- the table (hatch_grid's numbers, verbatim) --------------------------
    FILL_W = 0.9
    FILL_H = 0.82
    DOT_GAP = 2.6
    DOT_HALF = 0.0

    # -- timing (one-shot; the table is the terminal state) ------------------
    HOLD0 = 0.9           # seconds of living dust before the assembly begins
    DUR = 3.6             # seconds the assembly takes

    # -- motion knobs ---------------------------------------------------------
    STAGGER = "dist"      # lift-off order: dist/x/y/line/angle/rand/none
    JITTER = 0.18         # hash noise mixed into the stagger key (organic)
    SPREAD = 0.55         # 0 = all together, ->1 = strictly one after another
    EASE = "expo_io"
    PATH = "lerp"         # lerp/explode/spiral/arc
    BULGE = 0.0           # radial bulge for 'explode', braille units
    TURNS = 0.0           # winding for 'spiral', revolutions
    SAG = 0.0             # gravity dip for 'arc', braille units
    STREAK = 0.55         # mid-flight tick lengthening
    WOB = 2.4             # dust wobble amplitude, braille units
    DUST_HALF = 0.35      # dust tick half-length spread (hash-scaled)

    # ---- lazy per-size build ------------------------------------------------
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
        self._gc = (x0 + gw / 2.0, y0 + gh / 2.0)
        self._wh = (wu, hu)
        self._targets = _grid_targets(x0, y0, gw, gh, self.DOT_GAP)
        self._orig = [self._origin(i, tx, ty)
                      for i, (tx, ty, _v, _lf) in enumerate(self._targets)]
        self._keys = [self._skey(i) for i in range(len(self._targets))]

    # ---- the dust distribution (the scene's identity) -----------------------
    def _origin(self, i, tx, ty):
        raise NotImplementedError

    def _gauss(self, i, salt):
        """A gaussian pair from two hashes (Box-Muller)."""
        u1 = max(_h(i, salt), 1e-6)
        u2 = _h(i, salt + 1.0)
        r = math.sqrt(-2.0 * math.log(u1))
        return r * math.cos(TAU * u2), r * math.sin(TAU * u2)

    # ---- stagger -------------------------------------------------------------
    def _skey(self, i):
        tx, ty, vert, line_f = self._targets[i]
        x0, y0, gw, gh = self._box
        gcx, gcy = self._gc
        s = self.STAGGER
        if s == "x":
            k = (tx - x0) / gw
        elif s == "y":
            k = (ty - y0) / gh
        elif s == "line":
            k = line_f
        elif s == "angle":
            k = (math.atan2(ty - gcy, tx - gcx) + math.pi) / TAU
        elif s == "dist":
            k = math.hypot((tx - gcx) / gw, (ty - gcy) / gh) * 2.0
        elif s == "rand":
            k = _h(i, 7.0)
        else:
            k = 0.0
        return _clamp((1.0 - self.JITTER) * k + self.JITTER * _h(i, 5.0),
                      0.0, 1.0)

    # ---- flight path (hatch_grid's shapes) -----------------------------------
    def _path(self, p0, p1, s):
        x = p0[0] + (p1[0] - p0[0]) * s
        y = p0[1] + (p1[1] - p0[1]) * s
        kind = self.PATH
        if kind == "lerp":
            return x, y
        gcx, gcy = self._gc
        if kind == "explode":
            dx, dy = x - gcx, y - gcy
            d = math.hypot(dx, dy) or 1.0
            b = self.BULGE * math.sin(math.pi * s)
            return x + dx / d * b, y + dy / d * b
        if kind == "arc":
            return x, y + self.SAG * math.sin(math.pi * s)
        if kind == "spiral":
            a0 = math.atan2(p0[1] - gcy, p0[0] - gcx)
            r0 = math.hypot(p0[0] - gcx, p0[1] - gcy)
            a1 = math.atan2(p1[1] - gcy, p1[0] - gcx)
            r1 = math.hypot(p1[0] - gcx, p1[1] - gcy)
            da = (a1 - a0 + math.pi) % TAU - math.pi
            ang = a0 + da * s + self.TURNS * TAU * math.sin(math.pi * s)
            r = r0 + (r1 - r0) * s
            return gcx + r * math.cos(ang), gcy + r * math.sin(ang)
        return x, y

    # ---- drawing --------------------------------------------------------------
    def draw(self, canvas):
        self._ensure(canvas)
        t = self.t
        m = _clamp((t - self.HOLD0) / self.DUR, 0.0, 1.0)
        if m >= 1.0:
            for tx, ty, _v, _lf in self._targets:   # the table, forever still
                _dash(canvas, tx, ty, self.DOT_HALF)
            return
        ease = _EASES[self.EASE]
        spread = self.SPREAD
        span = 1.0 - spread if spread < 1.0 else 1e-6
        for i, (tx, ty, _v, _lf) in enumerate(self._targets):
            ox, oy = self._orig[i]
            # the dust is alive: each particle rides its own little hash
            # orbit; the flight blends the wobble out, so lift-off is seamless
            w1 = 0.5 + 0.9 * _h(i, 2.0)
            w2 = 0.5 + 0.9 * _h(i, 3.0)
            wx = ox + self.WOB * math.sin(t * w1 + TAU * _h(i, 4.0))
            wy = oy + self.WOB * math.cos(t * w2 + TAU * _h(i, 6.0))
            local = _clamp((m - self._keys[i] * spread) / span, 0.0, 1.0)
            s = ease(local)
            x, y = self._path((wx, wy), (tx, ty), s)
            half = (1.0 - s) * self.DUST_HALF * _h(i, 8.0) \
                + s * self.DOT_HALF + self.STREAK * math.sin(math.pi * s)
            _dash(canvas, x, y, half)

    def status(self):
        m = _clamp((self.t - self.HOLD0) / self.DUR, 0.0, 1.0)
        if m <= 0.0:
            return "DUST"
        if m >= 1.0:
            return "GRID · HOLD"
        return "FORM"


# ===========================================================================
# 1 — CONDENSE: the reference — a centre cloud condensing onto the rules
# ===========================================================================
class TableCondenseScene(HatchTableScene):
    name = "table · condense"
    STAGGER = "dist"      # inner dots first: the grid grows out of the cloud
    SPREAD = 0.60
    PATH = "spiral"
    TURNS = 0.14          # the slightest swirl on the way out
    CLOUD = 0.34          # cloud sigma as a fraction of the short axis

    def _origin(self, i, tx, ty):
        gcx, gcy = self._gc
        r = self.CLOUD * min(*self._wh) * 0.5
        gx, gy = self._gauss(i, 11.0)
        return gcx + gx * r, gcy + gy * r * 0.72   # a slightly squashed cloud


# ===========================================================================
# 2 — BURST: one tight knot at the centre, thrown outward
# ===========================================================================
class TableBurstScene(HatchTableScene):
    name = "table · burst"
    STAGGER = "angle"
    SPREAD = 0.45
    PATH = "explode"
    BULGE = 16.0          # overshoots radially, settles back onto the rules
    HOLD0 = 0.7

    def _origin(self, i, tx, ty):
        gcx, gcy = self._gc
        gx, gy = self._gauss(i, 21.0)
        return gcx + gx * 3.0, gcy + gy * 3.0


# ===========================================================================
# 3 — RAIN: high dust falling in, rows landing top to bottom
# ===========================================================================
class TableRainScene(HatchTableScene):
    name = "table · rain"
    STAGGER = "y"
    SPREAD = 0.55
    PATH = "arc"
    SAG = 5.0             # a soft dip through the slot before settling
    JITTER = 0.30

    def _origin(self, i, tx, ty):
        wu, hu = self._wh
        return (tx + (self._gauss(i, 31.0)[0]) * 14.0,
                -hu * (0.15 + 0.55 * _h(i, 32.0)))


# ===========================================================================
# 4 — DRIFT: dust everywhere, gliding into place all at once
# ===========================================================================
class TableDriftScene(HatchTableScene):
    name = "table · drift"
    STAGGER = "rand"
    SPREAD = 0.25
    EASE = "smoother"
    DUR = 4.4
    STREAK = 0.3

    def _origin(self, i, tx, ty):
        wu, hu = self._wh
        return wu * _h(i, 41.0), hu * _h(i, 42.0)


# ===========================================================================
# 5 — VORTEX: born on a ring, swirling in
# ===========================================================================
class TableVortexScene(HatchTableScene):
    name = "table · vortex"
    STAGGER = "angle"
    SPREAD = 0.50
    PATH = "spiral"
    TURNS = 0.55
    JITTER = 0.22

    def _origin(self, i, tx, ty):
        gcx, gcy = self._gc
        wu, hu = self._wh
        r = 0.44 * min(wu, hu) * (0.85 + 0.3 * _h(i, 51.0))
        a = TAU * _h(i, 52.0)
        return gcx + r * math.cos(a), gcy + r * math.sin(a) * 0.8


# ===========================================================================
# 6 — SWEEP: a dust bank off the left edge streams across
# ===========================================================================
class TableSweepScene(HatchTableScene):
    name = "table · sweep"
    STAGGER = "x"
    SPREAD = 0.78
    EASE = "expo_o"
    JITTER = 0.10
    STREAK = 0.9

    def _origin(self, i, tx, ty):
        return (-30.0 - 40.0 * _h(i, 61.0),
                ty + self._gauss(i, 62.0)[0] * 9.0)


# ===========================================================================
# 7 — SNAP: born jittered around its own slot, elastically snapping home
# ===========================================================================
class TableSnapScene(HatchTableScene):
    name = "table · snap"
    STAGGER = "line"
    SPREAD = 0.70
    EASE = "elastic_o"
    STREAK = 0.25
    WOB = 1.6

    def _origin(self, i, tx, ty):
        gx, gy = self._gauss(i, 71.0)
        return tx + gx * 11.0, ty + gy * 8.0


# ===========================================================================
# 8 — IMPLODE: dust flung far outside the frame collapses inward
# ===========================================================================
class TableImplodeScene(HatchTableScene):
    name = "table · implode"
    STAGGER = "rand"
    SPREAD = 0.35
    EASE = "expo_o"
    HOLD0 = 0.6
    WOB = 3.5

    def _origin(self, i, tx, ty):
        gcx, gcy = self._gc
        wu, hu = self._wh
        dx, dy = tx - gcx, ty - gcy
        d = math.hypot(dx, dy) or 1.0
        push = (0.75 + 0.8 * _h(i, 81.0)) * min(wu, hu)
        return tx + dx / d * push, ty + dy / d * push


def make_scenes():
    return [
        TableCondenseScene(),    # 1  the reference centre cloud
        TableBurstScene(),       # 2  thrown out of a knot
        TableRainScene(),        # 3  falling in
        TableDriftScene(),       # 4  the calm field
        TableVortexScene(),      # 5  swirling in
        TableSweepScene(),       # 6  streaming across
        TableSnapScene(),        # 7  crystallising in place
        TableImplodeScene(),     # 8  collapsing from the void
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
