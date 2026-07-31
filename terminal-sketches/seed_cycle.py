#!/usr/bin/env python3
"""
seed_cycle — a spreadsheet born from one small square, arriving through space.

Every scene: a single cell — the SEED — opens at the centre of the frame,
and the sheet grows out of it (wide first, then tall), the reveal window's
rim always drawn so the growing table has an edge. The layout is a real
spreadsheet: a narrow row-number column on the left, a header row across
the top (both marked with DOUBLE rules), then the uniform body cells.

THE HELD TABLE DOES NOT MOVE. All the 3D lives in the transitions: the
sheet arrives through space — tilted, swinging, rippling, gathering, or
extruded into a cube — and every spatial term is scaled by a "spatialness"
envelope that decays to ZERO as the intro settles. During the hold the
grid is flat, face-on, axis-aligned and completely static — usable for
actual input. On the outro the space wakes back up and takes it away,
and the seed closes to nothing. Empty frame at the wrap; the loop is
byte-identical (trivially so during the hold: the frames are equal).

    1  seed · bloom    grows in with a gentle tilt-and-yaw that damps flat
    2  seed · flip     swings in from a steep side angle, lands face-on
    3  seed · ripple   the surface arrives rippling, the rings flatten to
                       dead calm as it settles; ripples again to leave
    4  seed · gather   cells fly in from deep space ring by ring around
                       the seed, onto the flat sheet
    5  seed · lattice  arrives as a data-CUBE — floors stacked behind the
                       face — that flattens into the sheet for input, and
                       re-extrudes on the way out

Projection from agent_states_3d; the camera is bolted down.
Run: `python seed_cycle.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from listen_cycle import _expo, _stag
from agent_states_3d import _mkview, _P

TAU = 2.0 * math.pi
CAMD = 3.0                 # camera distance: mild, believable perspective


class SeedScene(Scene):
    """The seed-window + settle machinery. Scenes shape the arrival via
    yaw()/relief() or their own extra() — every spatial term MUST ride
    self._sp, which is exactly 0 for the whole hold."""

    CYCLE = 10.00
    T_IN = 0.36
    T_OUT = 0.70

    # spreadsheet layout, world units
    NC, NRW = 6, 5         # body columns / rows
    CW, RH = 0.30, 0.235   # body cell size
    HCW, HRH = 0.15, 0.20  # row-number column width / header row height
    DBL = 0.020            # gap of the double rules marking the headers

    PITCH = 0.42           # arrival tilt (damps to 0 by the hold)
    SCALE = 0.40

    # -- layout -----------------------------------------------------------
    def _lines(self):
        """Column/row rule positions, centred; index 1 is the header rule."""
        w = self.HCW + self.NC * self.CW
        h = self.HRH + self.NRW * self.RH
        xs = [-w / 2.0, -w / 2.0 + self.HCW]
        xs += [xs[1] + self.CW * (i + 1) for i in range(self.NC)]
        ys = [-h / 2.0, -h / 2.0 + self.HRH]
        ys += [ys[1] + self.RH * (j + 1) for j in range(self.NRW)]
        return xs, ys

    # -- lifecycle ----------------------------------------------------------
    def _phases(self, u):
        a = _clamp(u / self.T_IN, 0.0, 1.0)
        b = _clamp((u - self.T_OUT) / (1.0 - self.T_OUT), 0.0, 1.0)
        return a, b

    def _spatial(self, a, b):
        """Spatialness: 1 while arriving/leaving, EXACTLY 0 for the hold."""
        settle = (_expo(_clamp((a - 0.50) / 0.50, 0.0, 1.0))
                  * (1.0 - _expo(_clamp(b / 0.50, 0.0, 1.0))))
        return 1.0 - settle

    def _window(self, a, b):
        xs, ys = self._lines()
        hx, hy = xs[-1], ys[-1]
        sx, sy = self.CW * 0.55, self.RH * 0.65   # the seed square
        ax = _expo(_clamp(a / 0.70, 0.0, 1.0))
        ay = _expo(_clamp((a - 0.30) / 0.70, 0.0, 1.0))
        bx = _expo(_clamp((b - 0.30) / 0.70, 0.0, 1.0))
        by = _expo(_clamp(b / 0.70, 0.0, 1.0))
        ex = sx + (hx - sx) * ax * (1.0 - bx)
        ey = sy + (hy - sy) * ay * (1.0 - by)
        return ex, ey

    def _seedscale(self, a, b):
        return (_expo(_clamp(a * 3.5, 0.0, 1.0))
                * (1.0 - _expo(_clamp((b - 0.82) / 0.18, 0.0, 1.0))))

    # -- space --------------------------------------------------------------
    def yaw(self, u):
        return 0.0

    def rig(self, x, y, z, u):
        """Plane coords -> world. Tilt and yaw both ride the spatialness
        envelope, so the held sheet is face-on and axis-aligned."""
        sp = self._sp
        yw = self.yaw(u) * sp
        pt = self.PITCH * sp
        cy_, sy_ = math.cos(yw), math.sin(yw)
        cp, sp_ = math.cos(pt), math.sin(pt)
        Y = y * cp - z * sp_
        Z = y * sp_ + z * cp
        X = x * cy_ + Z * sy_
        Z = -x * sy_ + Z * cy_
        return X, Y, Z

    def relief(self, x, y, u):
        return 0.0

    # -- drawing --------------------------------------------------------
    def _pl(self, canvas, pts2, u, s0, n=8):
        (xa, ya), (xb, yb) = pts2
        prev = None
        for k in range(n + 1):
            f = k / n
            x, y = xa + (xb - xa) * f, ya + (yb - ya) * f
            z = self.relief(x, y, u)
            X, Y, Z = self.rig(x * s0, y * s0, z * s0, u)
            cur = _P(X, Y, Z, self._V)
            if cur and prev:
                canvas.line(prev[0], prev[1], cur[0], cur[1])
            prev = cur

    def _plane(self, canvas, u, ex, ey, s0):
        xs, ys = self._lines()
        for k, x in enumerate(xs):
            if abs(x) > ex + 1e-6:
                continue
            self._pl(canvas, ((x, -ey), (x, ey)), u, s0)
            if k == 1:                       # the row-number column: doubled
                self._pl(canvas, ((x + self.DBL, -ey),
                                  (x + self.DBL, ey)), u, s0)
        for k, y in enumerate(ys):
            if abs(y) > ey + 1e-6:
                continue
            self._pl(canvas, ((-ex, y), (ex, y)), u, s0)
            if k == 1:                       # the header row: doubled
                self._pl(canvas, ((-ex, y + self.DBL),
                                  (ex, y + self.DBL)), u, s0)
        for s in (-1, 1):                    # the rim leads the growth
            self._pl(canvas, ((s * ex, -ey), (s * ex, ey)), u, s0)
            self._pl(canvas, ((-ex, s * ey), (ex, s * ey)), u, s0)

    def draw(self, canvas):
        # rounded to 1e-12: kills the float jitter in t % CYCLE that would
        # otherwise flip the odd braille dot between one cycle and the next
        u = round((self.t % self.CYCLE) / self.CYCLE, 12)
        a, b = self._phases(u)
        s0 = self._seedscale(a, b)
        if s0 <= 0.01:
            return
        self._sp = self._spatial(a, b)
        wu, hu = canvas.wu, canvas.hu
        self._mind = min(wu, hu)
        self._V = _mkview(wu / 2.0, hu / 2.0, self._mind * self.SCALE,
                          cam=CAMD)
        ex, ey = self._window(a, b)
        self._plane(canvas, u, ex, ey, s0)
        self.extra(canvas, u, a, b, ex, ey, s0)

    def extra(self, canvas, u, a, b, ex, ey, s0):
        pass

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "ARRIVE"
        return "READY" if u < self.T_OUT else "DEPART"


# ===========================================================================
# 1 — BLOOM: a gentle tilt-and-yaw arrival that damps flat
# ===========================================================================
class SeedBloomScene(SeedScene):
    name = "seed · bloom"
    BREATH = 0.30

    def yaw(self, u):
        # one sin cycle per loop; _sp zeroes it for the whole hold
        return self.BREATH * math.sin(TAU * u)


# ===========================================================================
# 2 — FLIP: swings in from a steep side angle, lands face-on
# ===========================================================================
class SeedFlipScene(SeedScene):
    name = "seed · flip"
    SWING = 1.30
    PITCH = 0.22

    def yaw(self, u):
        return self.SWING          # _sp does all the damping


# ===========================================================================
# 3 — RIPPLE: arrives rippling, flattens to dead calm
# ===========================================================================
class SeedRippleScene(SeedScene):
    name = "seed · ripple"
    AMP = 0.15
    PITCH = 0.34

    def relief(self, x, y, u):
        xs, ys = self._lines()
        r = math.hypot(x / xs[-1], y / ys[-1])
        return self.AMP * self._sp * math.sin(6.5 * r - TAU * 2.0 * u)

    def _pl(self, canvas, pts2, u, s0, n=12):
        SeedScene._pl(self, canvas, pts2, u, s0, n)


# ===========================================================================
# 4 — GATHER: cells fly in from deep space onto the flat sheet
# ===========================================================================
class SeedGatherScene(SeedScene):
    name = "seed · gather"
    DEEP = 5.0      # +z is toward the lens: deep space is -z
    PITCH = 0.18
    W = 0.55

    def extra(self, canvas, u, a, b, ex, ey, s0):
        # cell outlines fly in ring by ring around the centre body cell;
        # a landed cell (e=1) coincides with the grid and adds nothing
        xs, ys = self._lines()
        # the ring origin: the body cell containing the sheet's centre
        ci = next(i for i in range(len(xs) - 1) if xs[i + 1] > 0.0)
        cj = next(j for j in range(len(ys) - 1) if ys[j + 1] > 0.0)
        rmax = max(self.NC, self.NRW)
        for j in range(1, len(ys) - 1):
            for i in range(1, len(xs) - 1):
                r = max(abs(i - ci), abs(j - cj))
                e = (_stag(a, r, rmax, self.W)
                     * (1.0 - _stag(b, rmax - 1 - r, rmax, self.W)))
                if e <= 0.004 or e >= 0.996:
                    continue
                zoff = (1.0 - e) * self.DEEP
                pts = ((xs[i], ys[j]), (xs[i + 1], ys[j]),
                       (xs[i + 1], ys[j + 1]), (xs[i], ys[j + 1]))
                prev = None
                for k in range(5):
                    x, y = pts[k % 4]
                    X, Y, Z = self.rig(x * s0, y * s0, 0.0, u)
                    cur = _P(X, Y, Z - zoff, self._V)
                    if cur and prev:
                        canvas.line(prev[0], prev[1], cur[0], cur[1])
                    prev = cur

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "GATHER"
        return "READY" if u < self.T_OUT else "SCATTER"


# ===========================================================================
# 5 — LATTICE: arrives as a data-cube, flattens for input
# ===========================================================================
class SeedLatticeScene(SeedScene):
    name = "seed · lattice"
    PITCH = 0.26
    YAW0 = 0.50     # arrival angle so the depth reads; _sp damps it flat
    NL = 4          # floors behind the face
    DZ = 0.34       # floor spacing (+z is toward the lens: floors at -z)
    SCALE = 0.37

    def yaw(self, u):
        return self.YAW0

    def _ext(self, a, b):
        """Each floor's extrusion 0..1: out during the arrival, merged flat
        for the hold (staggered), re-extruded on departure."""
        a2 = _clamp((a - 0.45) / 0.55, 0.0, 1.0)
        b2 = _clamp(b / 0.55, 0.0, 1.0)
        return [1.0 - (_stag(a2, k, self.NL, 0.55)
                       * (1.0 - _stag(b2, self.NL - 1 - k, self.NL, 0.55)))
                for k in range(self.NL)]

    def extra(self, canvas, u, a, b, ex, ey, s0):
        corners = ((-ex, -ey), (ex, -ey), (ex, ey), (-ex, ey))
        prevz = [0.0] * 4
        for k, e in enumerate(self._ext(a, b)):
            if e <= 0.01:
                continue
            zk = e * (k + 1) * self.DZ
            proj = []
            for (x, y) in corners:
                X, Y, Z = self.rig(x * s0, y * s0, 0.0, u)
                proj.append((_P(X, Y, Z - zk, self._V), X, Y, Z))
            for i in range(4):                 # the floor's rim
                pa, pb = proj[i][0], proj[(i + 1) % 4][0]
                if pa and pb:
                    canvas.line(pa[0], pa[1], pb[0], pb[1])
            for i in range(4):                 # rails to the floor in front
                _, X, Y, Z = proj[i]
                pa = _P(X, Y, Z - prevz[i], self._V)
                pb = proj[i][0]
                if pa and pb:
                    canvas.line(pa[0], pa[1], pb[0], pb[1])
                prevz[i] = zk

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "EXTRUDE"
        return "READY" if u < self.T_OUT else "UNFOLD"


def _selfcheck():
    c = SeedScene
    assert 0.0 < c.T_IN < c.T_OUT < 1.0, "seed_cycle: phases out of order"
    assert c.NC % 2 == 0 and c.NRW % 2 == 1, (
        "seed_cycle: NC even + NRW odd puts a true body cell at the centre "
        "once the header column/row shift the body off-axis")


_selfcheck()


def make_scenes():
    return [
        SeedBloomScene(),      # 1  tilt-and-yaw arrival
        SeedFlipScene(),       # 2  side swing
        SeedRippleScene(),     # 3  rippling surface
        SeedGatherScene(),     # 4  cells from deep space
        SeedLatticeScene(),    # 5  data-cube flattening
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
