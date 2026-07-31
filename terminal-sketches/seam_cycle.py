#!/usr/bin/env python3
"""
seam_cycle — wire_cycle's plume closed into a basketball, drawn by runners.

The plume's arcs now run pole to pole and keep going: M great circles through
two shared points, like the seams of a basketball. And nothing here is a
static line — every visible arc is THE TRAIL of a runner, a white block glyph
(the half-block layer's solid chip) crawling along its seam. The sphere is
drawn by motion and undrawn by motion.

The runners are in CONSTANT MOTION: their phase advances at one steady RATE
from the first frame to the last — no stops, no starts. The sequencing lives
in the lifecycle instead: seams enter one after another (staggered expo), and
within a seam the runners fan out of the pole to evenly spaced slots. On the
outro the slots collapse again, so the chips on a seam glide together into
one moving chip whose trail shrinks until it winks out.

Life cycle, in cycle units: over [0, T_IN] the runners fan out of the north
pole (staggered, expo) while already gliding; over [T_IN, T_OUT] they circle;
over [T_OUT, 1] the slots and trails collapse, seam by seam. Empty frame at
the wrap; the loop is byte-identical.

    1  seam · ball    trail = a full slot: the ball is complete whenever the
                      runners are around, three chips crawling every seam
    2  seam · dash    trail just over half a slot: chasing dashes sketch the
                      ball without ever closing it
    3  seam · weave   alternate seams run opposite ways — two counter-
                      rotating families of runners pass through each other
    4  seam · solo    one runner per seam with a long comet tail and a
                      half-lap launch offset

Geometry and the cycle machinery come from wire_cycle. Run: `python seam_cycle.py`.
"""

import math
import sys

from wire_cycle import WireScene, _norm, _cross, TAU, Z


class SeamScene(WireScene):
    """M seams through two poles; H runners per seam; every arc is a trail.
    The runners NEVER stop: their phase advances at a constant RATE for the
    whole cycle. The lifecycle rides on top — the intro fans the launch
    offsets out of the pole, the outro strips them away again, so the chips
    on a seam merge into one moving chip that shrinks out. Subclasses change
    trail length, runner count, launch and direction — never the glide."""

    CYCLE = 11.00
    T_IN = 0.22
    T_OUT = 0.80

    M = 4              # great circles (seams), all through both poles
    H = 3              # runners per seam
    R = 1.0
    AXIS = (-0.88, 0.30, -0.37)   # pole axis: poles left-front, right-back
    SPIN = 0.10        # slow drift of the whole ball about its axis, rad/s
    FOV = 1.35

    RATE = 0.55        # constant glide, rad/s — about one lap per cycle
    LAUNCH = TAU / 8   # extra launch travel so even runner 0 leaves the pole
    TRAIL = 1.0        # trail length as a fraction of a slot (TAU/H)
    KHEAD = 1.0        # head chip size factor

    def dirn(self, k):
        return 1.0

    def _trail_len(self, spacing):
        return self.TRAIL * spacing

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        ax = _norm(self.AXIS)
        p1 = _norm(_cross(ax, (0.0, 1.0, 0.0)))
        p2 = _cross(ax, p1)
        spin = tl * self.SPIN
        spacing = TAU / self.H
        heads = []
        for k in range(self.M):
            env = self._pres(k, self.M, a, b)
            if env <= 0.001:
                continue
            psi = math.pi * k / self.M + spin
            co, si = math.cos(psi), math.sin(psi)
            bx = (p1[0] * co + p2[0] * si,
                  p1[1] * co + p2[1] * si,
                  p1[2] * co + p2[2] * si)
            d = self.dirn(k)

            def pt(th):
                th = th * d
                c2, s2 = math.cos(th), math.sin(th)
                return (self.R * (c2 * ax[0] + s2 * bx[0]),
                        self.R * (c2 * ax[1] + s2 * bx[1]),
                        self.R * (c2 * ax[2] + s2 * bx[2]))

            for r in range(self.H):
                phi = env * (r * spacing + self.LAUNCH) + self.RATE * tl
                t0 = max(0.0, phi - env * self._trail_len(spacing))
                if phi - t0 > 1e-3:
                    steps = max(3, int(72 * (phi - t0) / TAU))
                    self._poly(canvas, cam,
                               [pt(t0 + (phi - t0) * j / steps)
                                for j in range(steps + 1)])
                heads.append((pt(phi), env))
        # the heads last, so the chips sit on top of every trail
        for (p3, env) in heads:
            p = cam.project(p3[0], p3[1], p3[2] + Z)
            if not p:
                continue
            size = env * p[2] * 0.055 * self.KHEAD
            if size >= 0.7:
                canvas.square_fill(p[0], p[1], size)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "LAUNCH"
        return "RUN" if u < self.T_OUT else "DRAIN"


class SeamBallScene(SeamScene):
    """Trails exactly one slot long, so the moment the runners are all out,
    the circles close: a complete basketball with chips crawling the seams."""
    name = "seam · ball"
    TRAIL = 1.0


class SeamDashScene(SeamScene):
    """Trails just over half a slot: the ball is only ever sketched, a swarm
    of dashes chasing each other around where the seams would be."""
    name = "seam · dash"
    TRAIL = 0.55


class SeamWeaveScene(SeamScene):
    """Alternate seams run opposite directions — two counter-rotating
    families of runners threading through each other at the poles."""
    name = "seam · weave"
    TRAIL = 0.85

    def dirn(self, k):
        return 1.0 if k % 2 == 0 else -1.0


class SeamSoloScene(SeamScene):
    """One runner per seam with a long comet tail. Its launch offset is half
    a lap, so the intro alone wraps the ball's whole southern hemisphere."""
    name = "seam · solo"
    H = 1
    LAUNCH = math.pi
    KHEAD = 1.15

    def _trail_len(self, spacing):
        return 0.42 * TAU


# ===========================================================================
# The phases have to nest, and the glide should cover at least a lap
# ===========================================================================
def _selfcheck():
    c = SeamScene
    assert 0.0 < c.T_IN < c.T_OUT < 1.0, "seam_cycle: phases out of order"
    assert c.RATE * c.CYCLE >= 0.9 * TAU, (
        "seam_cycle: the glide covers %.2f rad per cycle — under a lap, the "
        "ball's far side is never visited" % (c.RATE * c.CYCLE))


_selfcheck()


def make_scenes():
    return [
        SeamBallScene(),     # 1  complete ball, chips crawling
        SeamDashScene(),     # 2  chasing dashes
        SeamWeaveScene(),    # 3  counter-rotating seams
        SeamSoloScene(),     # 4  lone comets
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
