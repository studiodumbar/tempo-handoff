#!/usr/bin/env python3
"""
listen_cycle — sphere_states scene 2 (listening), given a real entrance and exit.

The original listening sphere simply exists: pings forever, no beginning, no
end. Here the whole thing is a cycle — the globe ASSEMBLES, listens (two full
sonar sweeps, pole to pole, exactly as in sphere_states), then DISASSEMBLES,
and the frame goes truly empty before the next cycle. Every entrance and exit
is sequential: elements arrive one after another in a spatial order (north to
south, or around the equator), each on its own ease-in-out-expo window, the
windows overlapping so the wave has a front. Nothing pops.

The camera spin is driven from cycle-local time, not wall time, so every cycle
is byte-identical — the loop closes exactly at the empty frame.

Four iterations, differing ONLY in how the sphere enters and leaves:

    1  listen · sweep    the intro is itself a sonar ping: a bulging, glowing
                         ring sweeps pole to pole and the globe exists only
                         where it has passed. The outro is one more sweep that
                         takes the surface away behind it.
    2  listen · unfurl   latitude rings arc-draw in, north to south, staggered;
                         meridians stitch in behind the arc front. Outro
                         unwinds each ring back to its seam in the same order.
    3  listen · stitch   two movements: meridians grow pole-to-pole first,
                         staggered around the globe (a spinning birdcage), then
                         the rings arc across them. Outro reverses: rings out
                         first, then the meridians retract. Last in, first out.
    4  listen · bloom    each latitude ring inflates from the core, north to
                         south — the sphere grows downward out of a point.
                         Outro: it deflates back into the core the same way.

Timing, in cycle units: intro over [0, T_IN], pings over [T_IN, T_OUT]
(N_PINGS full sweeps, so the last ring exits the south pole exactly as the
outro begins), outro over [T_OUT, 1]. All easing is ease-in-out-expo.

Sphere geometry, projection and the ping's band math come from sphere_states.
Run: `python listen_cycle.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from sphere_states import SphereScene, _mkview, _rot, _proj, TAU


def _expo(p):
    """Ease-in-out-expo, the house curve."""
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    if p < 0.5:
        return 0.5 * math.pow(2.0, 20.0 * p - 10.0)
    return 1.0 - 0.5 * math.pow(2.0, 10.0 - 20.0 * p)


def _stag(p, k, n, w):
    """Element k of n, entering across master progress p in [0,1]: each element
    gets an expo window of width w, start times spread over the remaining 1-w.
    This is the same solved stagger as everywhere else in the project — the
    last element always finishes exactly at p=1, whatever n and w are."""
    if n <= 1:
        return _expo(_clamp(p, 0.0, 1.0))
    s = (k / (n - 1.0)) * (1.0 - w)
    return _expo(_clamp((p - s) / w, 0.0, 1.0))


# ===========================================================================
# Base: the listening sphere with an intro/outro lifecycle
# ===========================================================================
class ListenScene(SphereScene):
    """sphere_states' listening state, wrapped in a cycle. Subclasses say only
    which segments exist at a given phase (lat_on / lon_on), and may scale
    rings (ring_scale) or add their own bulge/glow (xdisp / xshade). The ping,
    the timing and the camera are identical across all four."""

    CYCLE = 9.00
    T_IN = 0.20        # intro ends
    T_OUT = 0.78       # outro begins; pings own the middle
    N_PINGS = 2        # full pole-to-pole sweeps per cycle — integer, so the
                       # last ring leaves the south pole right at T_OUT
    SPAN = math.pi + 0.7   # sweep overshoots the pole, as in sphere_states
    SPIN = 0.12        # scene 2's slow yaw
    W = 0.55           # stagger window width (overlap between elements)

    # -- lifecycle ----------------------------------------------------------
    def _phases(self, u):
        a = _clamp(u / self.T_IN, 0.0, 1.0)
        b = _clamp((u - self.T_OUT) / (1.0 - self.T_OUT), 0.0, 1.0)
        return a, b

    def _ping(self, u):
        """Theta of the sonar front, or None outside the listening hold."""
        if u <= self.T_IN or u >= self.T_OUT:
            return None
        ph = (u - self.T_IN) / (self.T_OUT - self.T_IN) * self.N_PINGS * self.SPAN
        return ph % self.SPAN

    # -- hooks a variant overrides -------------------------------------------
    def lat_on(self, i, j, a, b):
        return a >= 1.0 and b <= 0.0

    def lon_on(self, i, j, a, b):
        return a >= 1.0 and b <= 0.0

    def ring_scale(self, i, a, b):
        return 1.0

    def xdisp(self, d, th, a, b):
        return 0.0

    def xshade(self, d, th, a, b):
        return 0.0

    # -- rendering (adapted from SphereScene.draw; visibility-gated) ---------
    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        u = (self.t % self.CYCLE) / self.CYCLE
        # yaw/pitch from cycle-local time: the frame is empty at the wrap, so
        # the yaw jump there is invisible and the loop is byte-identical
        tl = u * self.CYCLE
        V = _mkview(wu / 2.0, hu / 2.0, mind * self.SCALE,
                    yaw=tl * self.SPIN,
                    pitch=self.PITCH + self.ROCK * math.sin(tl * 0.35),
                    cam=self.CAM)
        a, b = self._phases(u)
        ping = self._ping(u)
        R = self.R

        grid = []
        for i, row in enumerate(self._dirs()):
            m = self.ring_scale(i, a, b)
            out = []
            for d in row:
                th = math.acos(_clamp(d[1], -1.0, 1.0))
                disp = self.xdisp(d, th, a, b)
                if ping is not None:
                    band = th - ping
                    disp += 0.07 * math.exp(-(band * band) / 0.05)
                r = R * m * (1.0 + disp)
                x1, y2, z2 = _rot(d[0] * r, d[1] * r, d[2] * r, V)
                out.append((_proj(x1, y2, z2, V), z2, d, th))
            grid.append(out)

        def seg(pa_, pb_):
            pa, za = pa_[0], pa_[1]
            pb, zb = pb_[0], pb_[1]
            if pa and pb and max(za, zb) > 0.0:
                canvas.line(pa[0], pa[1], pb[0], pb[1])

        for i in range(1, self.LAT):                        # latitude rings
            for j in range(self.LON):
                if self.lat_on(i, j, a, b):
                    seg(grid[i][j], grid[i][(j + 1) % self.LON])
        for j in range(self.LON):                           # longitude lines
            for i in range(self.LAT):
                if self.lon_on(i, j, a, b):
                    seg(grid[i][j], grid[i + 1][j])

        # blooms: the ping ring's glow (hold only — the globe is whole then),
        # plus whatever the variant's own front is doing
        for row in grid:
            for (p, z2, d, th) in row:
                if not p or z2 <= 0.0:
                    continue
                light = self.xshade(d, th, a, b)
                if ping is not None:
                    band = th - ping
                    light += math.exp(-(band * band) / 0.03)
                if light > 0.6:
                    canvas.square_fill(p[0], p[1],
                                       max(p[2] * 0.02 * mind, mind * 0.014))
                elif light > 0.32:
                    canvas.square_outline(p[0], p[1],
                                          max(p[2] * 0.016 * mind, mind * 0.01))

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "ENTER"
        return "LISTEN" if u < self.T_OUT else "EXIT"


# ===========================================================================
# 1 — SWEEP: the intro IS a ping
# ===========================================================================
class ListenSweepScene(ListenScene):
    """A sonar ring sweeps pole to pole and deposits the globe behind it; a
    final ring sweeps again and takes it away. The bulge and glow on the
    travelling front are the ping's own band math, so the entrance, the
    listening and the exit are all one gesture."""
    name = "listen · sweep"

    EDGE = math.pi + 0.55   # the front travels past the south pole so the
                            # wipe completes off the surface

    def _fronts(self, a, b):
        return _expo(a) * self.EDGE, _expo(b) * self.EDGE

    def _vis(self, th, a, b):
        fi, fo = self._fronts(a, b)
        return th <= fi and (b <= 0.0 or th >= fo)

    def lat_on(self, i, j, a, b):
        return self._vis(math.pi * i / self.LAT, a, b)

    def lon_on(self, i, j, a, b):
        return self._vis(math.pi * (i + 0.5) / self.LAT, a, b)

    def xdisp(self, d, th, a, b):
        e = 0.0
        if 0.0 < a < 1.0:
            fi = _expo(a) * self.EDGE
            e += 0.07 * math.exp(-((th - fi) ** 2) / 0.05)
        if 0.0 < b < 1.0:
            fo = _expo(b) * self.EDGE
            e += 0.07 * math.exp(-((th - fo) ** 2) / 0.05)
        return e

    def xshade(self, d, th, a, b):
        e = 0.0
        if 0.0 < a < 1.0:
            fi = _expo(a) * self.EDGE
            e += math.exp(-((th - fi) ** 2) / 0.03)
        if 0.0 < b < 1.0:
            fo = _expo(b) * self.EDGE
            e += math.exp(-((th - fo) ** 2) / 0.03)
        return e


# ===========================================================================
# 2 — UNFURL: rings arc-draw in, north to south
# ===========================================================================
class ListenUnfurlScene(ListenScene):
    """Each latitude ring draws itself around from its seam, staggered north
    to south; a meridian segment appears once both of its rings have reached
    that longitude, so the mesh knits in behind the arc front. The outro
    unwinds every ring back to the seam in the same order."""
    name = "listen · unfurl"

    def _f(self, i, a, b):
        n = self.LAT + 1
        return _stag(a, i, n, self.W) * (1.0 - _stag(b, i, n, self.W))

    def lat_on(self, i, j, a, b):
        return (j + 0.5) / self.LON <= self._f(i, a, b)

    def lon_on(self, i, j, a, b):
        f = min(self._f(i, a, b), self._f(i + 1, a, b))
        return (j + 0.5) / self.LON <= f


# ===========================================================================
# 3 — STITCH: meridians first, then the rings
# ===========================================================================
class ListenStitchScene(ListenScene):
    """Two movements. First the meridians grow pole to pole, staggered around
    the globe — for a moment it is a spinning birdcage. Then the rings arc
    across them north to south. The outro plays it back in reverse order:
    rings leave first, then the cage retracts. Last in, first out."""
    name = "listen · stitch"

    A1 = 0.62   # fraction of the intro the meridians own; rings get the rest

    def _g(self, j, a, b):
        """Meridian j: pole-to-pole growth 0..1."""
        a1 = _clamp(a / self.A1, 0.0, 1.0)
        b2 = _clamp((b - (1.0 - self.A1)) / self.A1, 0.0, 1.0)
        return (_stag(a1, j, self.LON, self.W)
                * (1.0 - _stag(b2, j, self.LON, self.W)))

    def _h(self, i, a, b):
        """Ring i: arc fraction 0..1."""
        a2 = _clamp((a - self.A1) / (1.0 - self.A1), 0.0, 1.0)
        b1 = _clamp(b / (1.0 - self.A1), 0.0, 1.0)
        n = self.LAT + 1
        return _stag(a2, i, n, self.W) * (1.0 - _stag(b1, i, n, self.W))

    def lon_on(self, i, j, a, b):
        return (i + 0.5) / self.LAT <= self._g(j, a, b)

    def lat_on(self, i, j, a, b):
        return (j + 0.5) / self.LON <= self._h(i, a, b)


# ===========================================================================
# 4 — BLOOM: rings inflate from the core
# ===========================================================================
class ListenBloomScene(ListenScene):
    """Each latitude ring scales up from the centre, staggered north to south
    — the sphere grows downward out of a point, and at the end it folds back
    into one. Segments exist as soon as their rings have any size, so the
    surface stretches while it is being born."""
    name = "listen · bloom"

    EPS = 0.03   # below this a ring is still inside the core: don't draw it

    def ring_scale(self, i, a, b):
        n = self.LAT + 1
        return _stag(a, i, n, self.W) * (1.0 - _stag(b, i, n, self.W))

    def lat_on(self, i, j, a, b):
        return self.ring_scale(i, a, b) > self.EPS

    def lon_on(self, i, j, a, b):
        return min(self.ring_scale(i, a, b),
                   self.ring_scale(i + 1, a, b)) > self.EPS


# ===========================================================================
# The pings have to fit the hold exactly, or a ring is orphaned mid-sweep
# ===========================================================================
def _selfcheck():
    b = ListenScene
    assert 0.0 < b.T_IN < b.T_OUT < 1.0, "listen_cycle: phases out of order"
    assert b.N_PINGS == int(b.N_PINGS) and b.N_PINGS >= 1, (
        "listen_cycle: N_PINGS must be a positive integer so the last sweep "
        "finishes exactly at T_OUT")
    assert 0.0 < b.W <= 1.0, "listen_cycle: stagger window out of range"


_selfcheck()


def make_scenes():
    return [
        ListenSweepScene(),      # 1  the ping deposits the globe
        ListenUnfurlScene(),     # 2  rings arc in, north to south
        ListenStitchScene(),     # 3  meridians, then rings
        ListenBloomScene(),      # 4  rings inflate from the core
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
