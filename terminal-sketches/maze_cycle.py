#!/usr/bin/env python3
"""
maze_cycle — zoom_cycle's maze, six ways: the square as a PATH.

zoom_cycle's scene 7 treated the square outline as a shape with a gap. Here
the perimeter is a track. Everything that happens, happens ALONG it — chips
run it, pens draw it, brackets grow out of its corners, gates flash across
it — and the conveyor still carries every square from the deep toward the
fixed lens, so the whole thing recurses into the centre of the frame.

Blocks are used where a head or a flash wants weight: runner heads and pen
tips are solid half-block chips (square_fill), and the gates scene beefs a
whole square into solid bars (rect_fill) as the sweep wave passes.

Same engine guarantees as flow_cycle/zoom_cycle: fixed camera, expo
birth/death envelopes, all variation keyed to conveyor position u, every
time-driven motion running an INTEGER number of laps/sweeps per conveyor
pass — one pass (1/SPEED seconds) is byte-identical.

    1  maze · chase    two chips per square, opposite corners, running the
                       perimeter with trails — a double helix of traffic
                       corkscrewing down the tunnel
    2  maze · gap      scene 7 with a head: the C's leading end is a chip
                       that crawls the perimeter as the square approaches
    3  maze · scribe   every square draws itself on the way in — pen chip
                       leading — completes mid-tunnel, and un-draws before
                       the lens: a cascade of squares being written
    4  maze · corners  4-fold bracket arms breathing out of the corners on
                       the sweep wave, corner chips marking the frame
    5  maze · spiral   the sketch itself: ONE continuous square spiral, a
                       static rail with chip trains flowing along it into
                       the centre, dissolving there, condensing at the rim
    6  maze · gates    thin outlines until the sweep wave arrives — then a
                       square flashes into solid block bars and lets go

Run: `python maze_cycle.py`.
"""

import math
import sys

from mpp import _clamp
from listen_cycle import _expo
from agent_states_3d import _mkview
from zoom_cycle import ZoomScene, TAU


def _sq(s, S, z):
    """Point at perimeter fraction s (wraps) of a square of half-size S."""
    s = s % 1.0
    side, f = int(s * 4), (s * 4) % 1.0
    if side == 0:
        return (S, S - 2 * S * f, z)
    if side == 1:
        return (S - 2 * S * f, -S, z)
    if side == 2:
        return (-S, -S + 2 * S * f, z)
    return (-S + 2 * S * f, S, z)


class MazeScene(ZoomScene):
    """The square-as-a-path toolkit on zoom_cycle's conveyor."""

    S = 1.00

    def _track(self, canvas, z, s0, s1, S=None, n=None):
        """The perimeter piece from fraction s0 to s1 (may cross corners)."""
        if s1 - s0 <= 1e-3:
            return
        S = self.S if S is None else S
        n = n or max(3, int(56 * (s1 - s0)))
        self._pline(canvas,
                    [_sq(s0 + (s1 - s0) * k / n, S, z) for k in range(n + 1)])

    def _bar(self, canvas, a, b, th):
        """A solid block bar between projected points a and b. rect_fill
        scans the rotated rect's BOUNDING BOX, so one long thin bar costs
        O(length^2) — drawn as short chunks it costs O(length)."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L <= 0.5 or th <= 0.5:
            return
        if ((a[0] < 0 and b[0] < 0) or (a[1] < 0 and b[1] < 0)
                or (a[0] > canvas.wu and b[0] > canvas.wu)
                or (a[1] > canvas.hu and b[1] > canvas.hu)):
            return
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        step = max(8.0, th * 3.0)
        n = max(1, int(L / step))
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            cx = a[0] + (b[0] - a[0]) * (t0 + t1) / 2.0
            cy = a[1] + (b[1] - a[1]) * (t0 + t1) / 2.0
            canvas.rect_fill(cx, cy, L / n + 1.0, th, ang)

    def _chip(self, canvas, p3, w, k=0.020):
        """A solid block chip — the weight at a head or a corner."""
        p = self._p(*p3)
        if not p or w <= 0.05:
            return
        size = p[2] * k * self._mind * w
        if size >= 0.7:
            canvas.square_fill(p[0], p[1], size)


# ===========================================================================
# 1 — CHASE: chip traffic on every square
# ===========================================================================
class MazeChaseScene(MazeScene):
    name = "maze · chase"
    LAPS = 2        # integer runner laps per conveyor pass
    LEAD = 0.75     # how far the phase advances per unit depth (the helix)
    TRAIL = 0.26

    def layer(self, canvas, u, z, w):
        ph = round((self.t * self.SPEED) % 1.0, 12)
        head = ph * self.LAPS + u * self.LEAD
        v = self._lv(w)
        for half in (0.0, 0.5):                    # two runners, opposite
            h = head + half
            self._track(canvas, z, h - self.TRAIL * v, h)
            self._chip(canvas, _sq(h, self.S, z), w)

    def status(self):
        return "CHASE"


# ===========================================================================
# 2 — GAP: scene 7, but the C has a head that crawls
# ===========================================================================
class MazeGapScene(MazeScene):
    name = "maze · gap"
    FRAC = 0.84     # how much of the perimeter the C covers
    GAPTURN = 1.0   # corkscrew of the gap with depth
    LAPS = 1        # the head also crawls: one lap per pass

    def layer(self, canvas, u, z, w):
        ph = round((self.t * self.SPEED) % 1.0, 12)
        head = u * self.GAPTURN + ph * self.LAPS
        span = self.FRAC * self._lv(w)
        self._track(canvas, z, head - span, head)
        self._chip(canvas, _sq(head, self.S, z), w)

    def status(self):
        return "GAP"


# ===========================================================================
# 3 — SCRIBE: squares that write themselves on the way in
# ===========================================================================
class MazeScribeScene(MazeScene):
    name = "maze · scribe"
    START = 0.5     # pen start walks the perimeter with depth

    def layer(self, canvas, u, z, w):
        # the pen's progress is pure u: deep squares barely started, closed
        # by mid-tunnel, unwritten again just before the lens
        prog = _expo(_clamp(u / 0.48, 0.0, 1.0)) \
            * (1.0 - _expo(_clamp((u - 0.84) / 0.14, 0.0, 1.0)))
        if prog <= 1e-3:
            return
        s0 = u * self.START
        self._track(canvas, z, s0, s0 + prog)
        self._chip(canvas, _sq(s0 + prog, self.S, z), w)   # the pen tip
        if prog < 0.996:
            self._chip(canvas, _sq(s0, self.S, z), w, 0.012)  # the anchor

    def status(self):
        return "SCRIBE"


# ===========================================================================
# 4 — CORNERS: bracket arms breathing on the sweep wave
# ===========================================================================
class MazeCornersScene(MazeScene):
    name = "maze · corners"
    ARM_LO = 0.055  # bracket half-arm, quiet (fraction of the perimeter)
    ARM_HI = 0.115  # bracket half-arm at the crest of the wave

    def layer(self, canvas, u, z, w):
        act = self._act(u)
        arm = (self.ARM_LO + (self.ARM_HI - self.ARM_LO) * act) * self._lv(w)
        for c in (0.0, 0.25, 0.50, 0.75):          # the four corners
            self._track(canvas, z, c - arm, c + arm)
            self._chip(canvas, _sq(c, self.S, z), w,
                       0.014 * (1.0 + 1.2 * act))

    def status(self):
        return "CORNERS"


# ===========================================================================
# 5 — SPIRAL: the sketch itself, one continuous inward path
# ===========================================================================
class MazeSpiralScene(MazeScene):
    name = "maze · spiral"
    LAPS = 4.0      # perimeter laps rim -> centre
    S0 = 1.30       # half-size at the rim
    SHRINK = 0.85   # fraction of the size gone by the centre
    Z = -0.55       # the spiral sits flat at one depth, like the sketch
    NR = 6          # chip trains on the rail
    TRAIL = 0.055   # train length, in whole-spiral units
    RATE = 1        # integer spiral traversals per conveyor pass

    def _pt(self, s):
        S = self.S0 * (1.0 - self.SHRINK * s)
        return _sq(s * self.LAPS, S, self.Z)

    def _env(self, s):
        """Trains condense at the rim and dissolve into the centre."""
        return (_expo(_clamp(s / 0.10, 0.0, 1.0))
                * (1.0 - _expo(_clamp((s - 0.88) / 0.12, 0.0, 1.0))))

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        self._mind = min(wu, hu)
        self._V = _mkview(wu / 2.0, hu / 2.0, self._mind * self.SCALE)
        ph = round((self.t * self.SPEED) % 1.0, 12)
        # the rail: the whole spiral, faint and still
        self._pline(canvas, [self._pt(k / 340.0) for k in range(341)])
        # the trains: chips flowing along it into the centre
        for j in range(self.NR):
            head = (j / self.NR + ph * self.RATE) % 1.0
            e = self._env(head)
            t0 = max(0.0, head - self.TRAIL * (0.5 + 0.5 * e))
            n = max(3, int(180 * (head - t0)))
            # the trail re-strokes the rail, but the chip is the event
            self._pline(canvas,
                        [self._pt(t0 + (head - t0) * k / n)
                         for k in range(n + 1)])
            self._chip(canvas, self._pt(head), e, 0.024)

    def status(self):
        return "SPIRAL"


# ===========================================================================
# 6 — GATES: the sweep wave flashes whole squares into block bars
# ===========================================================================
class MazeGatesScene(MazeScene):
    name = "maze · gates"
    SWEEPS = 2

    def layer(self, canvas, u, z, w):
        act = self._act(u)
        v = self._lv(w)
        pts = [self._p(*_sq(c, self.S, z)) for c in (0.0, 0.25, 0.50, 0.75)]
        if act > 0.30 and all(pts):
            # the flash: every side becomes a solid bar, thickness on the bell
            th = act * v * self._mind * 0.020
            for i in range(4):
                self._bar(canvas, pts[i], pts[(i + 1) % 4], th)
        else:
            for c in (0.0, 0.25, 0.50, 0.75):
                arm = 0.125 * v
                self._track(canvas, z, c + (0.125 - arm), c + (0.125 + arm))
        for p3c in (0.0, 0.25, 0.50, 0.75):
            self._chip(canvas, _sq(p3c, self.S, z), w, 0.012)

    def status(self):
        return "GATES"


# ===========================================================================
# Integer laps or the loop tears
# ===========================================================================
def _selfcheck():
    for cls in (MazeChaseScene, MazeGapScene, MazeSpiralScene):
        laps = getattr(cls, "LAPS", 1)
        rate = getattr(cls, "RATE", 1)
        assert laps == int(laps) or cls is MazeSpiralScene, (
            "maze_cycle: %s runs a fractional lap per pass" % cls.__name__)
        assert rate == int(rate), (
            "maze_cycle: %s traverses a fractional spiral per pass"
            % cls.__name__)
    assert MazeGatesScene.SWEEPS == int(MazeGatesScene.SWEEPS)


_selfcheck()


def make_scenes():
    return [
        MazeChaseScene(),      # 1  chip traffic
        MazeGapScene(),        # 2  the C with a head
        MazeScribeScene(),     # 3  self-writing squares
        MazeCornersScene(),    # 4  breathing brackets
        MazeSpiralScene(),     # 5  the continuous spiral
        MazeGatesScene(),      # 6  flashing block gates
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
