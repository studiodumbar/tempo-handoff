#!/usr/bin/env python3
"""
burst_clean — burst_out, redrawn: six plain hairlines, big, small beads.

Three changes from burst_out, all to the drawing and none to the motion:

  * SIX LINES. The sheaf is 6 rays, not burst.py's 13 — picked from the
    original bundle evenly across the fan by angle, so the spread survives
    the thinning. The stagger lag per rank is scaled up to keep the same
    total sweep time across the fan.
  * CLEAN LINES. burst_out rendered rays through burst.py's _ray_draw, whose
    stroke ramp turns sub-hairline weights into dotted endpoints and carries a
    hash-seeded dash pattern — that is where the gaps and stipple came from.
    Every ray is a straight world line through the knot, and perspective maps
    straight lines to straight lines, so here each ray is ONE canvas.line
    between its two projected tips: a continuous braille hairline, one dot
    wide, nothing else.
  * FULL FRAME. The lens is opened until the longest ray's tip circle (roll
    keeps every tip on a fixed screen circle, so the cycle's bounding box is
    just the biggest circle plus the bead) nearly touches the frame. FOV is
    in min-dimension units, so the fit holds at any terminal size.

Everything else — the one-turn-per-cycle roll, the angular-order stagger, the
out/hold/back timing, the seamless 7s loop — is burst_out's, unchanged.

    1  line · out     the full sheaf as hairlines, a bright point riding each
                      ray out and back
    2  line · trail   a ray exists only between its two moving points — the
                      sheaf draws itself out of the knot and folds back in
    3  line · comet   no resting sheaf: each point drags a short streak, out
                      and home, like sparks on wires
    4  line · solo    points alone

Rays, timing and the roll come from burst.py / burst_out.py.
Run: `python burst_clean.py`.
"""

import math
import sys

from mpp import _clamp
from serp_flux import Cam, _bead, _expo
from burst import RAYS, CENTER, _ray_pt
from burst_out import OutScene, _roll_ray

N_LINES = 6


def _pick_sheaf():
    """6 of burst.py's 13 rays, chosen evenly across the fan: sort by angle,
    take every ~2.4th. Thinning at random would bunch the fan; this keeps the
    full 68-degree spread with roughly even gaps."""
    order = sorted(range(len(RAYS)),
                   key=lambda i: math.atan2(RAYS[i][4], RAYS[i][3]))
    picked = [order[round(k * (len(RAYS) - 1) / (N_LINES - 1))]
              for k in range(N_LINES)]
    return [RAYS[i] for i in picked]


SHEAF = _pick_sheaf()   # already in angular order, so rank == index


class CleanScene(OutScene):
    """burst_out's scene on a 6-ray sheaf, with _ray swapped for a plain
    tip-to-tip hairline and the lens opened up. Subclasses change only which
    piece of the line exists — never the timing, the order, or the rotation."""

    FOV = 1.00   # measured ceiling: the largest lens that still leaves >=1
                 # blank row/col at every terminal size, all cycle (the dot
                 # grid's center sits at 39.5 not 40, so the bottom edge is
                 # always the first to touch)
    K_PT = 1.15  # "make the blocks smaller": beads at roughly half burst_out's
    K_KNOT = 0.85  # size — a compact chip, not a slab
    STAG = 0.048 # per-rank lag rescaled for 6 ranks: (13-1)*0.022/(6-1), so
                 # the wave takes the same time to cross the fan as burst_out

    def _q(self, i, u):
        # rank == index: SHEAF is already sorted by fan angle
        lag = i * self.STAG
        out = _expo(_clamp((u - lag) / self.D, 0.0, 1.0))
        back = _expo(_clamp((u - self.RET - lag) / self.D, 0.0, 1.0))
        return out * (1.0 - back)

    def draw(self, canvas):
        u = (self.t % self.CYCLE) / self.CYCLE
        a = self.t * self._rate()
        c, s = math.cos(a), math.sin(a)
        rays = [_roll_ray(r, c, s) for r in SHEAF]        # the only motion
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

    def _cam(self, canvas):
        # dead-on camera: burst_out's slight y-offset/pitch made the fit
        # asymmetric, which costs a row once the sheaf runs this close to
        # the frame
        return Cam(canvas, (0.0, 0.0, 0.0), yaw=0.0, pitch=0.0, fov=self.FOV)

    def _line(self, canvas, cam, ray, qa, qb, sign):
        """The straight piece of `ray` from q=qa to q=qb on one half."""
        a = cam.project(*_ray_pt(ray, qa, sign))
        b = cam.project(*_ray_pt(ray, qb, sign))
        if a and b:
            canvas.line(a[0], a[1], b[0], b[1])

    def _ray(self, canvas, cam, i, ray, q):
        # one line, tip to tip, straight through the knot
        a = cam.project(*_ray_pt(ray, 1.0, 1.0))
        b = cam.project(*_ray_pt(ray, 1.0, -1.0))
        if a and b:
            canvas.line(a[0], a[1], b[0], b[1])


class LineOutScene(CleanScene):
    name = "line · out"


class LineTrailScene(CleanScene):
    """The ray exists only between its two points: one line from the -q tip
    through the knot to the +q tip, growing and retracting with them."""
    name = "line · trail"

    def _ray(self, canvas, cam, i, ray, q):
        if q <= 0.004:
            return
        a = cam.project(*_ray_pt(ray, q, 1.0))
        b = cam.project(*_ray_pt(ray, q, -1.0))
        if a and b:
            canvas.line(a[0], a[1], b[0], b[1])


class LineCometScene(CleanScene):
    """No resting sheaf. Each point drags a short streak behind it — toward
    the knot on the way out, toward the tip on the way home."""
    name = "line · comet"

    TAIL = 0.30   # streak length in q units

    def _ray(self, canvas, cam, i, ray, q):
        if q <= 0.004:
            return
        q0 = _clamp(q - self.TAIL, 0.0, 1.0)
        for sign in (1.0, -1.0):
            self._line(canvas, cam, ray, q0, q, sign)


class LineSoloScene(CleanScene):
    name = "line · solo"

    def _ray(self, canvas, cam, i, ray, q):
        pass


# ===========================================================================
# The rescaled stagger still has to fit burst_out's cycle
# ===========================================================================
def _selfcheck():
    b = CleanScene
    last = (N_LINES - 1) * b.STAG
    assert last + b.D < b.RET, (
        "burst_clean: the last ray is still going out (%.3f) when the first "
        "starts back (%.3f)" % (last + b.D, b.RET))
    assert b.RET + last + b.D < 1.0, (
        "burst_clean: the last ray gets home at %.3f, past the cycle end"
        % (b.RET + last + b.D))


_selfcheck()


def make_scenes():
    return [
        LineOutScene(),      # 1  hairline sheaf + points
        LineTrailScene(),    # 2  the line lives between the points
        LineCometScene(),    # 3  streaks only
        LineSoloScene(),     # 4  points alone
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
