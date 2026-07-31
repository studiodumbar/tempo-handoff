#!/usr/bin/env python3
"""
hatch_poles — the north and south pole meeting in the centre of the hatch sphere.

Same hatched globe as always (hatch_states `HatchScene`: a lat/long sphere, each
front sample a short horizontal `_dash` tick), but here the sphere NEVER deforms
— there is no radial displacement. The poles "meet in the centre" purely through
what the hatch shows (tick length / density) and through light overlays drawn on
the surface. The globe is viewed nearly equator-on, so the north pole sits at the
top, the south pole at the bottom, and the centre of the disc is the equator —
the place the two poles travel to and meet.

    1  poles · pinch    two bright caps grow from the poles; the dark equatorial
                        gap between them shrinks to a seam — the poles pinch shut
    2  poles · beads    a bright bead leaves each pole, slides down a meridian,
                        and the two collide at the centre in a burst
    3  poles · rings    a thin bright ring from each hemisphere slides inward and
                        the two merge into a single equatorial belt, then part
    4  poles · drift    the hatch itself migrates: brightness drains from the
                        poles and gathers into a dense band at the centre
    5  poles · spiral   twin bright spirals wind down from each pole and meet,
                        streaming, at the equator

None of these touch `disp`, so the sphere stays a rigid ball throughout.
Paced by hatch_grid's steady 60fps explorer. Run: `python hatch_poles.py`.
"""

import math

from mpp import _clamp, EASE
from hatch_states import HatchScene, TAU
from scenes import _dash

HALF_PI = math.pi / 2.0


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _gauss(x, w):
    return math.exp(-(x * x) / w)


def _pingpong(u):
    """0 -> 1 -> 0 across u in [0,1], eased (a smooth there-and-back)."""
    tri = 2.0 * u if u < 0.5 else 2.0 * (1.0 - u)
    return _smooth(tri)


# ===========================================================================
# Shared base — a rigid, near equator-on hatch sphere with a dim resting hatch.
# The sphere shape is fixed (disp is never overridden); every effect works by
# modulating bright() and/or drawing overlays in extra().
# ===========================================================================
class PoleScene(HatchScene):
    TILT = 0.0            # equator-on: N pole top, S pole bottom, centre = equator
    EPS = -0.03           # keep the pole points (z2 ~ 0) on the silhouette
    SPIN = 0.0            # no spin: the convergence is the only motion
    REST = 0.30           # dim resting hatch the effect rides over
    CYCLE = 2.2           # seconds per meet

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        return self.REST

    @staticmethod
    def _pole_dist(theta):
        """Angular distance to the nearest pole: 0 at a pole, pi/2 at equator."""
        return theta if theta <= HALF_PI else math.pi - theta


# ===========================================================================
# 1 — PINCH  (two bright caps close on the centre)
# ===========================================================================
class PolePinchScene(PoleScene):
    """Brightness fills inward from both poles: each polar cap lights up and
    grows toward the equator, so the dark band across the middle narrows until
    the two caps meet at the centre in a bright seam — then it opens back out."""

    name = "poles · pinch"
    FILL = 0.5            # cap fill boost (kept moderate so the meet isn't a whiteout)
    EDGE = 1.7            # bright rim at the advancing front (the star of the move)
    WIDTH = 0.018         # rim width
    FLASH = 1.6           # convergence flash at the equator

    def _front(self, t):
        return _pingpong((t / self.CYCLE) % 1.0) * HALF_PI    # 0 -> pi/2 -> 0

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        p = self._front(t)
        d = self._pole_dist(theta)
        val = self.REST
        if d <= p:
            val += self.FILL                              # inside the lit cap
        val += self.EDGE * _gauss(d - p, self.WIDTH)      # bright advancing rim
        # when the fronts reach the equator they overlap — flash the seam
        conv = _smooth((p / HALF_PI - 0.7) / 0.3)
        val += self.FLASH * conv * _gauss(theta - HALF_PI, self.WIDTH)
        return val

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 2 — BEADS  (a point from each pole collides at the centre)
# ===========================================================================
class PoleBeadsScene(PoleScene):
    """The most literal reading: a bright bead sits on the north pole and one on
    the south pole; they slide down the front meridian toward each other and
    collide at the centre of the disc, throwing off a small burst — then fade and
    re-emerge at the poles."""

    name = "poles · beads"
    SPIN = 0.0
    REST = 0.22           # extra-dim stipple so the solid beads own the frame
    TRAVEL = 0.72         # fraction of the cycle spent sliding to the centre
    N_TRAIL = 11          # dots trailing each bead
    TRAIL_A = 0.6         # meridian arc the trail spans (radians)
    BEAD = 3.4            # bead size (braille units at the near plane)
    BURST_R = 1.7         # burst ring max radius (unit radii)

    def _u(self, t):
        return (t / self.CYCLE) % 1.0

    def _a(self, t):
        """Bead angle from its pole: 0 (pole) -> pi/2 (equator centre)."""
        return EASE(_clamp(self._u(t) / self.TRAVEL, 0.0, 1.0)) * HALF_PI

    def _amp(self, t):
        u = self._u(t)
        return _smooth(u / 0.10) * (1.0 - _smooth((u - self.TRAVEL) / (1.0 - self.TRAVEL)))

    def extra(self, canvas, cx, cy, R, V, t):
        a = self._a(t)
        amp = self._amp(t)
        if amp <= 0.02:
            return
        # Two beads on the front meridian: north (0, cos a, sin a) meeting south
        # (0, -cos a, sin a) at (0, 0, 1) — the centre of the disc.
        for sign in (+1.0, -1.0):
            for k in range(self.N_TRAIL):
                frac = k / self.N_TRAIL
                aa = a - frac * self.TRAIL_A
                if aa < 0.0:
                    continue
                wx = 0.0
                wy = sign * math.cos(aa)
                wz = math.sin(aa)
                px, py, z2, f = self._project(wx, wy, wz, cx, cy, R, V)
                if z2 <= self.EPS:
                    continue
                if k == 0:
                    # a solid block reads as a distinct bead against the hatch
                    canvas.rect_fill(px, py, self.BEAD * f, self.BEAD * f)
                else:
                    canvas.set_dot(px, py)                # its short trail
        # Collision burst: an expanding ring of dots at the centre as they meet.
        u = self._u(t)
        if 0.66 <= u <= 0.92:
            e = (u - 0.66) / 0.26
            rr = self.BURST_R * EASE(e) * R
            n = max(10, int(rr * 0.5))
            fade = 1.0 - e
            step = 1 if fade > 0.5 else 2                 # thin the ring as it fades
            pcx, pcy, _z, _f = self._project(0.0, 0.0, 1.0, cx, cy, R, V)
            for j in range(0, n, step):
                ang = TAU * j / n
                canvas.set_dot(pcx + rr * math.cos(ang), pcy + rr * math.sin(ang))

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 3 — RINGS  (a thin ring from each hemisphere merges into a belt)
# ===========================================================================
class PoleRingsScene(PoleScene):
    """A single bright latitude ring in each hemisphere slides toward the equator;
    the two meet and merge into one bright belt at the centre, then separate and
    return toward the poles — a ring pinch that breathes."""

    name = "poles · rings"
    RING = 2.0            # ring brightness boost
    WIDTH = 0.012         # ring thickness (thin, crisp lines)
    FLASH = 1.4           # merge flash at the equator

    def _front(self, t):
        return _pingpong((t / self.CYCLE) % 1.0) * HALF_PI

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        p = self._front(t)
        d = self._pole_dist(theta)
        val = self.REST + self.RING * _gauss(d - p, self.WIDTH)
        conv = _smooth((p / HALF_PI - 0.75) / 0.25)
        val += self.FLASH * conv * _gauss(theta - HALF_PI, self.WIDTH)
        return val

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 4 — DRIFT  (the hatch migrates from the poles to a central band)
# ===========================================================================
class PoleDriftScene(PoleScene):
    """No travelling edge — instead the whole hatch redistributes: the polar caps
    thin toward dots while a dense bright band condenses at the equator, as if the
    sphere's ink drained from both poles and pooled in the centre, then spread
    back out."""

    name = "poles · drift"
    BASE = 0.7            # even hatch present when 'undrifted'
    BELT = 1.9            # equatorial band boost when fully drifted
    BELT_W = 0.05         # band width

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        e = _pingpong((t / self.CYCLE) % 1.0)             # 0 (even) -> 1 (pooled)
        pole_hatch = self.BASE * (1.0 - 0.85 * e)         # poles thin out
        belt = self.BELT * e * _gauss(theta - HALF_PI, self.BELT_W)
        return self.REST + pole_hatch + belt

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 5 — SPIRAL  (twin spirals wind down from each pole and meet)
# ===========================================================================
class PoleSpiralScene(PoleScene):
    """From each pole a bright spiral arm winds down the surface toward the
    equator, its dots streaming inward; the two arms arrive and meet at the
    centre band, chasing each other around it."""

    name = "poles · spiral"
    SPIN = 0.0
    REST = 0.14           # a faint sphere so the bright arms stand clear
    TURNS = 1.25          # revolutions each arm makes pole -> equator (loose = legible)
    RATE = 1.1            # how fast the dots stream inward
    N = 120               # dots per arm
    ARMS = 3              # start points per pole (evenly spread in longitude)

    def extra(self, canvas, cx, cy, R, V, t):
        flow = (t * self.RATE) % 1.0
        for pole in (+1.0, -1.0):
            for arm in range(self.ARMS):
                a0 = TAU * arm / self.ARMS
                for k in range(self.N):
                    # s: 0 at the pole -> 1 at the equator; stream it inward
                    s = (k / self.N + flow) % 1.0
                    theta_local = s * HALF_PI              # angle down from pole
                    phi = a0 + s * self.TURNS * TAU
                    st = math.sin(theta_local)
                    wy = pole * math.cos(theta_local)
                    wx = st * math.cos(phi)
                    wz = st * math.sin(phi)
                    px, py, z2, f = self._project(wx, wy, wz, cx, cy, R, V)
                    if z2 <= self.EPS:
                        continue
                    # the arm brightens as it nears the equator (the meeting band)
                    _dash(canvas, px, py, (0.7 + 1.1 * s) * f)

    def status(self):
        return "PROCESSING"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        PolePinchScene(),      # 1  pinch
        PoleBeadsScene(),      # 2  beads
        PoleRingsScene(),      # 3  rings
        PoleDriftScene(),      # 4  drift
        PoleSpiralScene(),     # 5  spiral
    ]


if __name__ == "__main__":
    import sys
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
