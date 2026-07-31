#!/usr/bin/env python3
"""
spiral_cycle — scenes.py scene 10 (pseudo-3D spiral), given an entrance and exit.

The original helix simply exists: it spins, a pulse of fill travels down the
ribbon, forever. Here it is a cycle — the spiral ASSEMBLES point by point,
carries the wave for the hold, then DISASSEMBLES, and the frame is truly empty
before the next cycle. The assembly is always sequential: the 96 points enter
in spiral order (top to bottom), each on its own ease-in-out-expo window, the
windows overlapping so a front sweeps down the helix. The wave itself is
silent outside the hold and ramps in/out on its own expo envelope, so no crest
pops into existence.

The spin and the wave run on cycle-local time, so every cycle is byte-identical
— the loop closes exactly at the empty frame.

Four iterations, differing ONLY in the path a point takes to its slot:

    1  spiral · thread   points sprinkle in ahead of a ribbon that threads
                         down the helix behind them; the outro drains the same
                         way, top to bottom — the whole figure passes through.
    2  spiral · flare    every point starts ON the spin axis: the helix begins
                         as a vertical line of dots and flares outward into a
                         coil, top to bottom. The outro folds it back onto the
                         axis in the same order.
    3  spiral · swirl    points spiral out from the axis along their own
                         angular path — the coil unfurls like a galaxy arm,
                         and winds itself back in to leave.
    4  spiral · depth    points arrive from deep behind the vanishing point,
                         streaming forward into place; the outro sends them
                         back into the distance. Perspective does the scaling.

Timing, in cycle units: intro over [0, T_IN], the wave over [T_IN, T_OUT],
outro over [T_OUT, 1]. All easing is ease-in-out-expo; the stagger is the
project's solved window stagger (last point lands exactly at the phase end).

Helix geometry, blocks rendering and the stretch-cell math come from scenes.py
(SpiralStretchScene). Run: `python spiral_cycle.py`.
"""

import math
import sys

from mpp import _clamp
from scenes import SpiralStretchScene
from listen_cycle import _expo, _stag

TAU = 2.0 * math.pi


# ===========================================================================
# Base: the spiral with an intro/outro lifecycle
# ===========================================================================
class SpiralCycleScene(SpiralStretchScene):
    """Scene 10 wrapped in a cycle. A subclass says only where point i is at
    presence m in [0, 1] (place(): 0 = not arrived, 1 = seated on the helix)
    and how visible the ribbon is between partial points (RIB). The spin, the
    wave, the timing and the stagger are identical across all four."""

    CYCLE = 10.00
    T_IN = 0.24        # intro ends
    T_OUT = 0.76       # outro begins; the wave owns the middle
    W = 0.45           # stagger window width (heavy overlap: a sweeping front)
    WRAMP = 0.08       # wave amplitude ease-in/out, so no crest pops
    RIB = 0.02         # min presence on BOTH ends before a ribbon segment shows

    # -- lifecycle ----------------------------------------------------------
    def _phases(self, u):
        a = _clamp(u / self.T_IN, 0.0, 1.0)
        b = _clamp((u - self.T_OUT) / (1.0 - self.T_OUT), 0.0, 1.0)
        return a, b

    def _pres(self, i, a, b):
        n = self.NUM_POINTS
        return _stag(a, i, n, self.W) * (1.0 - _stag(b, i, n, self.W))

    def _amp(self, u):
        """The travelling wave's amplitude: silent outside the hold."""
        if u <= self.T_IN or u >= self.T_OUT:
            return 0.0
        return (_expo(_clamp((u - self.T_IN) / self.WRAMP, 0.0, 1.0))
                * (1.0 - _expo(_clamp((u - (self.T_OUT - self.WRAMP))
                                      / self.WRAMP, 0.0, 1.0))))

    # -- the hook a variant overrides ----------------------------------------
    def place(self, i, m, ang, rad, y3):
        """Point i at presence m: return (ang, rad, y3, zoff). m=1 must give
        the seated helix point back unchanged."""
        return ang, rad, y3, 0.0

    # -- rendering (adapted from SpiralStretchScene.draw) --------------------
    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        radius = min(wu, hu) * self.RADIUS_FRAC
        vext = hu * self.VEXT_FRAC
        focal = radius * self.FOCAL_FRAC
        n = self.NUM_POINTS
        u = (self.t % self.CYCLE) / self.CYCLE
        tl = u * self.CYCLE          # cycle-local: the empty wrap frame hides
        a, b = self._phases(u)       # the spin's jump, so the loop is exact
        amp = self._amp(u)

        pts = []
        for i in range(n):
            m = self._pres(i, a, b)
            if m <= 0.0:
                pts.append(None)
                continue
            frac = i / (n - 1)
            ang = frac * self.TURNS * TAU + tl * self.ROT_SPEED
            ang, rad, y3, zoff = self.place(i, m, ang, radius,
                                            (frac - 0.5) * vext)
            x3 = rad * math.cos(ang)
            z3 = rad * math.sin(ang)
            f = focal / (focal + z3 + zoff)
            pts.append((cx + x3 * f, cy + y3 * f, f, m))

        for i in range(n - 1):                    # the receding ribbon
            if (pts[i] and pts[i + 1]
                    and min(pts[i][3], pts[i + 1][3]) > self.RIB):
                canvas.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])

        speed = self.SP * self.TIME_K
        for i in range(n):
            if not pts[i]:
                continue
            px, py, f, m = pts[i]
            np = amp * self._wave_ease(
                (math.sin(i / self.WAVE_SPREAD - tl * speed) + 1.0) * 0.5)
            j = i + 1 if i + 1 < n and pts[i + 1] else i - 1
            if not pts[j]:
                continue
            ang_t = math.atan2(pts[j][1] - py, pts[j][0] - px)
            # arriving points grow from dots: cell size rides presence
            self._blit_along(canvas, px, py, np,
                             self.CELL * f * math.sqrt(m), ang_t)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "ENTER"
        return "WAVE" if u < self.T_OUT else "EXIT"


# ===========================================================================
# 1 — THREAD: the ribbon threads down the helix
# ===========================================================================
class SpiralThreadScene(SpiralCycleScene):
    """Points appear in place, in spiral order — dots sprinkling down the helix
    with the solid ribbon threading in behind them (the ribbon needs both ends
    half-present, so it always trails the dot front). The outro runs the same
    direction: the figure drains top to bottom, passing through the frame."""
    name = "spiral · thread"
    RIB = 0.55


# ===========================================================================
# 2 — FLARE: the helix flares out of its own axis
# ===========================================================================
class SpiralFlareScene(SpiralCycleScene):
    """Every point is born on the spin axis: the intro opens as a vertical
    line of dots that flares outward into the coil, top to bottom. The outro
    folds it back onto the axis in the same order. Pure radial motion —
    one axis per point, staggered."""
    name = "spiral · flare"

    def place(self, i, m, ang, rad, y3):
        return ang, rad * _expo(m), y3, 0.0


# ===========================================================================
# 3 — SWIRL: the coil unfurls like a galaxy arm
# ===========================================================================
class SpiralSwirlScene(SpiralCycleScene):
    """Points spiral out from the axis along their own angular path: radius
    and a winding angle release together, so each point traces an arc into
    its slot and the coil unfurls. The outro winds it back in."""
    name = "spiral · swirl"

    WIND = 2.60   # extra radians a point carries at m=0, unwinding as it seats

    def place(self, i, m, ang, rad, y3):
        e = _expo(m)
        return ang + (1.0 - e) * self.WIND, rad * e, y3, 0.0


# ===========================================================================
# 4 — DEPTH: streaming in from the vanishing point
# ===========================================================================
class SpiralDepthScene(SpiralCycleScene):
    """Points arrive from deep behind the helix — perspective makes them tiny
    dots near the vanishing point that stream forward and swell into place,
    top to bottom. The outro sends them back into the distance. No point
    ever crosses the camera plane (zoff >= 0 keeps f bounded)."""
    name = "spiral · depth"

    ZFAR = 4.0    # how far back a point starts, in helix-radius units

    def place(self, i, m, ang, rad, y3):
        return ang, rad, y3, (1.0 - _expo(m)) * self.ZFAR * rad


# ===========================================================================
# The phases have to nest, or a crest is orphaned outside the hold
# ===========================================================================
def _selfcheck():
    c = SpiralCycleScene
    assert 0.0 < c.T_IN < c.T_OUT < 1.0, "spiral_cycle: phases out of order"
    assert 0.0 < c.W <= 1.0, "spiral_cycle: stagger window out of range"
    assert 2.0 * c.WRAMP < (c.T_OUT - c.T_IN), (
        "spiral_cycle: wave ramps overlap — the wave never reaches full "
        "amplitude inside the hold")


_selfcheck()


def make_scenes():
    return [
        SpiralThreadScene(),     # 1  ribbon threads down the helix
        SpiralFlareScene(),      # 2  flares out of the spin axis
        SpiralSwirlScene(),      # 3  unfurls like a galaxy arm
        SpiralDepthScene(),      # 4  streams in from the vanishing point
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
