#!/usr/bin/env python3
"""
burst_out — burst.py's sheaf, stripped to one motion and one event.

burst.py gives the needle bundle nine things to do: it blooms, recoils, volleys,
pings, flies past. All of that is gone here. The sheaf JUST ROTATES — one axis,
one steady rate, forever — spinning in the view plane like a pinwheel, so it
holds one size and one frame. The camera is bolted down. Nothing else in the
frame moves of its own accord.

The only event is a point. It starts at the crossing knot, runs out to the tip,
holds, and comes home. It happens on one ray at a time, staggered, so the bundle
fires as a wave with a front rather than all at once. Both halves of a ray fire
together: a ray is a full line through the knot with a tip at each end, and
firing them together is what keeps the bowtie symmetric.

Two things carry the whole piece:

  * ANGULAR ORDER. The stagger runs in order of each ray's fan angle, NOT the
    order the rays happen to be stored in (which is hash-seeded, so it is
    genuinely random: 9, 2, 0, 7, 8, 6, ...). Sorted, the wave sweeps cleanly
    across the 68 degrees of the fan, edge to edge. This is the entire
    difference between a sequence and a twitch, and it costs one sort.
  * THE ROTATION IS LOCKED TO THE CYCLE. RATE is TURNS full turns per CYCLE,
    with TURNS an integer, so the sheaf is back where it started exactly when
    the points are. The whole scene closes — spin included — every CYCLE.
    (A half-turn will not do it, tempting as it looks: the sheaf holds every
    ray and its mirror, but rolling by pi maps d to (-dx, -dy, +dz) while d's
    mirror is (-dx, -dy, -dz). The rays are tilted out of the view plane, so
    those differ and the bundle does not come back. Verified, not assumed.)

Timing, per ray, in cycle units: out at rank*STAG for D, hold at the tip, back
at RET + rank*STAG for D, hold at the knot. Every phase is ease-in-out-expo.
_selfcheck asserts the last ray still gets home before the cycle ends.

    1  burst · out     the piece: faint sheaf, a bright point riding each ray
                       out and back, sweeping the fan
    2  burst · trail   the ray draws itself behind the point — the bundle
                       grows out of the knot ray by ray, then retracts
    3  burst · wake    the sheaf is fully drawn; the dashes light as the point
                       passes and fall dark behind it
    4  burst · solo    the sheaf is invisible. Only the points — a
                       constellation firing out and folding home

Geometry, rays and stroke ramp all come from burst.py. Run: `python burst_out.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from serp_flux import Cam, _bead, _expo
from burst import RAYS, N_RAYS, CENTER, _ray_draw, _ray_pt

TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------
# Fire order. The rays are hash-seeded, so their stored order is scattered;
# sorting by fan angle turns the stagger into a sweep across the bundle.
# ---------------------------------------------------------------------------
def _rank_by_angle():
    order = sorted(range(N_RAYS), key=lambda i: math.atan2(RAYS[i][4], RAYS[i][3]))
    rank = [0] * N_RAYS
    for r, i in enumerate(order):
        rank[i] = r
    return rank


RANK = _rank_by_angle()


def _roll_ray(ray, c, s):
    """The ray, rolled about the VIEW axis.

    burst.py's _ray_draw offers yaw (about y) and pitch (about x) but no roll,
    and neither of those is the rotation this piece wants: burst's rays all
    point roughly along +x, so yawing swings them at the camera and the whole
    fan foreshortens to a knot and back — the bowtie/starburst flip. Handsome,
    but it means the composition pulses from full-frame to nothing.

    Rolling about the view axis instead keeps every ray's distance from the
    camera, so the bundle spins like a pinwheel at a constant size and the frame
    stays put. Every ray passes through the origin, so only the direction needs
    turning."""
    _, _, _, dx, dy, dz, L2, dashes = ray
    return (0.0, 0.0, 0.0, dx * c - dy * s, dx * s + dy * c, dz, L2, dashes)


class OutScene(Scene):
    """Rotate, and fire the points. Subclasses change only how a ray is drawn
    behind its point — never the timing, the order, or the rotation."""

    CYCLE = 7.00        # one full out-and-back, and one full turn
    TURNS = 1           # integer, so the spin closes with the cycle
    FOV = 0.70          # stood off: ~20% air on every side, all cycle
    W_PATH = 0.48       # hairline. Under ~0.42 burst.py drops the ray to
                        # dotted endpoints and the sheaf stops reading
    K_PT = 2.40         # _bead clamps to 1.6 units at this depth, so the
    K_KNOT = 1.80       # point needs a k this big to clear one character
    STAG = 0.022        # per-RANK lag, in cycle units — THE stagger
    D = 0.14            # how long one ray takes to run out (or come home)
    RET = 0.56          # when the first ray starts back

    def _rate(self):
        return TAU * self.TURNS / self.CYCLE

    def _cam(self, canvas):
        return Cam(canvas, (0.0, 0.04, 0.0), yaw=0.0, pitch=-0.01, fov=self.FOV)

    def _q(self, i, u):
        """Where the point on ray i sits: 0 at the knot, 1 at the tip."""
        lag = RANK[i] * self.STAG
        out = _expo(_clamp((u - lag) / self.D, 0.0, 1.0))
        back = _expo(_clamp((u - self.RET - lag) / self.D, 0.0, 1.0))
        return out * (1.0 - back)

    def draw(self, canvas):
        u = (self.t % self.CYCLE) / self.CYCLE
        a = self.t * self._rate()
        c, s = math.cos(a), math.sin(a)
        rays = [_roll_ray(r, c, s) for r in RAYS]         # the only motion
        cam = self._cam(canvas)
        for i, ray in enumerate(rays):
            self._ray(canvas, cam, i, ray, self._q(i, u))
        _bead(canvas, cam.project(*CENTER), self.K_KNOT)  # the knot
        for i, ray in enumerate(rays):
            q = self._q(i, u)
            if q <= 0.004:
                continue
            for sign in (1.0, -1.0):                      # both tips, together
                _bead(canvas, cam.project(*_ray_pt(ray, q, sign)), self.K_PT)

    def _ray(self, canvas, cam, i, ray, q):
        """The path the point rides."""
        _ray_draw(canvas, cam, ray, self.W_PATH, ticks=False)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.RET - self.D * 0.5:
            return "OUT"
        return "BACK" if u < 0.98 else "HOME"


class BurstOutScene(OutScene):
    name = "burst · out"


class BurstTrailScene(OutScene):
    """The ray only exists behind its point: the bundle draws itself out of the
    knot, ray by ray, and pulls back in the same order."""
    name = "burst · trail"

    def _ray(self, canvas, cam, i, ray, q):
        if q > 0.004:
            _ray_draw(canvas, cam, ray, 0.55, grow=q)


class BurstWakeScene(OutScene):
    """The whole sheaf is there the whole time; the point lights the dashes it
    passes and they fall dark behind it. Reuses burst.py's own wavefront."""
    name = "burst · wake"

    def _ray(self, canvas, cam, i, ray, q):
        hot = (q * ray[6], 0.34, 1.20) if q > 0.004 else None
        _ray_draw(canvas, cam, ray, 0.30, hotR=hot, ticks=False)


class BurstSoloScene(OutScene):
    """No sheaf at all — just the points and the knot they came from."""
    name = "burst · solo"

    def _ray(self, canvas, cam, i, ray, q):
        pass


# ===========================================================================
# The timing has to fit in the cycle, or the last ray never gets home
# ===========================================================================
def _selfcheck():
    b = OutScene
    last = (N_RAYS - 1) * b.STAG
    out_done = last + b.D
    back_done = b.RET + last + b.D
    assert out_done < b.RET, (
        "burst_out: the last ray is still on its way out (%.3f) when the first "
        "starts back (%.3f). Lower STAG/D or raise RET." % (out_done, b.RET))
    assert back_done < 1.0, (
        "burst_out: the last ray gets home at %.3f, past the end of the cycle "
        "— it would snap. Lower STAG/D or RET." % back_done)
    return out_done, back_done


_OUT_DONE, _BACK_DONE = _selfcheck()


def make_scenes():
    return [
        BurstOutScene(),       # 1  the piece
        BurstTrailScene(),     # 2  the ray drawn behind the point
        BurstWakeScene(),      # 3  dashes lighting as it passes
        BurstSoloScene(),      # 4  points alone
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
