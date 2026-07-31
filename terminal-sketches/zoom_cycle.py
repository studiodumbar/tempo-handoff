#!/usr/bin/env python3
"""
zoom_cycle — flow_cycle's conveyor, restocked with the sketch-sheet shapes.

Same machine as flow_cycle: a treadmill of cross-sections riding from deep z
toward a BOLTED-DOWN camera, wrapping forever — the recursive zoom toward one
central focal point. Same guarantees: birth/death envelopes (ease-in-out-expo
here, the house curve), no thresholds, content keyed to conveyor position u
alone so one pass (1/SPEED seconds) is byte-identical.

What changed is the cargo. Every scene's cross-section is one of the sketch
shapes, recomposed to be SYMMETRIC about the axis so the vanishing point
stays the anchor of the frame:

    1  zoom · burst     the line fan as a star of spokes around the axis,
                        slowly pinwheeling with depth
    2  zoom · rosette   the four overlapping circles, orbiting the axis as
                        they come
    3  zoom · slinky    rings flat in the deep that inflate open (expo) as
                        they approach — the slinky squash as a tunnel
    4  zoom · tumble    each ring tilted a little further than the one behind
                        (a half-turn across the conveyor) — the great-circle
                        sphere swept into a corkscrew
    5  zoom · coil      the tilted-ellipse stack, dead ahead: identical
                        leaning rings streaming past
    6  zoom · cards     the rounded rectangles as a pinwheeling duct
    7  zoom · maze      the square spiral: C-shaped square outlines whose
                        gap corkscrews with depth, exactly the sketch's
                        recursion but in motion
    8  zoom · iris      arc petals around the axis — flying through a stack
                        of open shutters
    9  zoom · crown     the chevrons bent into a ring: zig-zag crowns
                        streaming past

Engine from flow_cycle; partial-path cutting from wire_cycle.
Run: `python zoom_cycle.py`.
"""

import math
import sys

from mpp import _clamp
from listen_cycle import _expo
from wire_cycle import _cut
from flow_cycle import FlowScene, _smooth, TAU


class ZoomScene(FlowScene):
    """flow_cycle's conveyor with the house easing: elements condense and
    dissolve on ease-in-out-expo instead of smoothstep, and every scene's
    cross-section is centred and symmetric about the axis."""

    def _win(self, u):
        a = _expo(_clamp(u / 0.14, 0.0, 1.0))
        b = 1.0 - _expo(_clamp((u - 0.90) / 0.10, 0.0, 1.0))
        return a * b

    def _pline(self, canvas, pts):
        """Project and stroke a 3D polyline through the fixed lens. Segments
        with both ends past the same screen edge are rejected — canvas.line
        is unclipped, so near-lens giants would otherwise cost their full
        off-screen length in dots."""
        wu, hu, m = canvas.wu, canvas.hu, 6.0
        prev = None
        for (x, y, z) in pts:
            cur = self._p(x, y, z)
            if cur and prev:
                if not ((cur[0] < -m and prev[0] < -m)
                        or (cur[0] > wu + m and prev[0] > wu + m)
                        or (cur[1] < -m and prev[1] < -m)
                        or (cur[1] > hu + m and prev[1] > hu + m)):
                    canvas.line(prev[0], prev[1], cur[0], cur[1])
            prev = cur

    def _wire(self, canvas, pts, v):
        """The centred fraction v of a 3D polyline — grows in, retracts out."""
        if v >= 0.999:
            self._pline(canvas, pts)      # fully grown: skip the cut
        elif v > 0.02:
            self._pline(canvas, _cut(pts, (1.0 - v) / 2.0, (1.0 + v) / 2.0))

    @staticmethod
    def _arcpts(z, r, a0, a1, n=40, ry=None, cx=0.0, cy=0.0):
        """Points along an arc at depth z (ry squashes it to an ellipse)."""
        ry = r if ry is None else ry
        steps = max(3, int(n * abs(a1 - a0) / TAU) + 1)
        return [(cx + r * math.cos(a0 + (a1 - a0) * k / steps),
                 cy + ry * math.sin(a0 + (a1 - a0) * k / steps), z)
                for k in range(steps + 1)]


# ===========================================================================
# 1 — BURST: the line fan as a pinwheeling star of spokes
# ===========================================================================
class BurstZoomScene(ZoomScene):
    name = "zoom · burst"
    NS = 10
    R0, R1 = 0.12, 1.05
    TWIST = 0.9

    def layer(self, canvas, u, z, w):
        rot = u * self.TWIST
        v = self._lv(w)
        for j in range(self.NS):
            a = TAU * j / self.NS + rot
            co, si = math.cos(a), math.sin(a)
            pa = self._p(self.R0 * co, self.R0 * si, z)
            pb = self._p(self.R1 * co, self.R1 * si, z)
            self._seg(canvas, pa, pb, v)
            self._node(canvas, pb, w, 0.010)

    def status(self):
        return "BURST"


# ===========================================================================
# 2 — ROSETTE: four overlapping circles orbiting the axis
# ===========================================================================
class RosetteZoomScene(ZoomScene):
    name = "zoom · rosette"
    K = 4
    N = 10          # fewer layers: this cross-section is ink-heavy
    RC = 0.55       # how far each circle's centre sits from the axis
    R = 0.50        # overlapping neighbours, like the sketch — but NOT
                    # crossing the axis, so the focal centre stays open
    TWIST = 0.8

    def layer(self, canvas, u, z, w):
        rot = u * self.TWIST
        v = self._lv(w)
        for k in range(self.K):
            a = TAU * k / self.K + rot
            cx, cy = self.RC * math.cos(a), self.RC * math.sin(a)
            # each circle pens open from its outward-facing point
            self._wire(canvas,
                       self._arcpts(z, self.R, a, a + TAU, n=30,
                                    cx=cx, cy=cy), v)

    def status(self):
        return "ROSETTE"


# ===========================================================================
# 3 — SLINKY: rings inflating open as they approach
# ===========================================================================
class SlinkyZoomScene(ZoomScene):
    name = "zoom · slinky"
    R = 1.00
    FLAT = 0.18     # aspect in the deep (nearly a line)

    def layer(self, canvas, u, z, w):
        ry = self.R * (self.FLAT + (1.0 - self.FLAT) * _expo(u))
        self._wire(canvas,
                   self._arcpts(z, self.R, -TAU / 4, TAU * 3 / 4, ry=ry),
                   self._lv(w))

    def status(self):
        return "SLINKY"


# ===========================================================================
# 4 — TUMBLE: each ring tilted a little further — a swept sphere
# ===========================================================================
class TumbleZoomScene(ZoomScene):
    name = "zoom · tumble"
    R = 0.92
    TURN = math.pi   # tilt gained across the conveyor: a clean half-turn

    def layer(self, canvas, u, z, w):
        t = u * self.TURN
        ct, st = math.cos(t), math.sin(t)
        pts = []
        for k in range(45):
            a = TAU * k / 44
            x, y = self.R * math.cos(a), self.R * math.sin(a)
            pts.append((x, y * ct, z + y * st * 0.32))
        self._wire(canvas, pts, self._lv(w))

    def status(self):
        return "TUMBLE"


# ===========================================================================
# 5 — COIL: the tilted-ellipse stack, dead ahead
# ===========================================================================
class CoilZoomScene(ZoomScene):
    name = "zoom · coil"
    R = 0.95
    LEAN = 0.62     # every ring leans by the same angle, like the sketch

    def layer(self, canvas, u, z, w):
        ct, st = math.cos(self.LEAN), math.sin(self.LEAN)
        pts = []
        for k in range(45):
            a = TAU * k / 44
            x, y = self.R * math.cos(a), self.R * math.sin(a)
            pts.append((x, y * ct, z + y * st * 0.30))
        # the lean axis is diagonal: rotate the ring 45 degrees in-plane
        c45 = math.cos(TAU / 8)
        pts = [(x * c45 - y * c45, x * c45 + y * c45, z2) for (x, y, z2) in pts]
        self._wire(canvas, pts, self._lv(w))

    def status(self):
        return "COIL"


# ===========================================================================
# 6 — CARDS: rounded rectangles as a pinwheeling duct
# ===========================================================================
class CardsZoomScene(ZoomScene):
    name = "zoom · cards"
    W, H, RAD = 1.45, 0.78, 0.20
    TWIST = 0.7

    def _rrect(self, z, rot):
        co, si = math.cos(rot), math.sin(rot)
        pts = []
        hw, hh = self.W / 2 - self.RAD, self.H / 2 - self.RAD
        corners = ((hw, hh, 0.25), (-hw, hh, 0.50),
                   (-hw, -hh, 0.75), (hw, -hh, 1.00))
        for (qx, qy, qe) in corners:
            q0 = qe - 0.25
            for k in range(13):
                th = TAU * (q0 + 0.25 * k / 12)
                lx = qx + self.RAD * math.cos(th)
                ly = qy + self.RAD * math.sin(th)
                pts.append((lx * co - ly * si, lx * si + ly * co, z))
        pts.append(pts[0])
        return pts

    def layer(self, canvas, u, z, w):
        self._wire(canvas, self._rrect(z, u * self.TWIST), self._lv(w))

    def status(self):
        return "CARDS"


# ===========================================================================
# 7 — MAZE: C-shaped squares, the gap corkscrewing with depth
# ===========================================================================
class MazeZoomScene(ZoomScene):
    name = "zoom · maze"
    S = 1.00        # square half-size
    FRAC = 0.82     # how much of the perimeter is drawn (the C)
    GAPTURN = 1.0   # how many times the gap walks the perimeter, deep->near

    def _perim(self, s, z):
        """Point at perimeter fraction s of the square (s wraps)."""
        s = s % 1.0
        side, f = int(s * 4), (s * 4) % 1.0
        S = self.S
        if side == 0:
            return (S, S - 2 * S * f, z)
        if side == 1:
            return (S - 2 * S * f, -S, z)
        if side == 2:
            return (-S, -S + 2 * S * f, z)
        return (-S + 2 * S * f, S, z)

    def layer(self, canvas, u, z, w):
        v = self._lv(w)
        span = self.FRAC * v
        if span <= 0.02:
            return
        s0 = u * self.GAPTURN + (self.FRAC - span) / 2.0
        n = max(4, int(56 * span))
        self._pline(canvas,
                    [self._perim(s0 + span * k / n, z) for k in range(n + 1)])

    def status(self):
        return "MAZE"


# ===========================================================================
# 8 — IRIS: arc petals around the axis, a tunnel of open shutters
# ===========================================================================
class IrisZoomScene(ZoomScene):
    name = "zoom · iris"
    M = 8
    R = 0.88
    OPEN = 0.62     # petal arc length as a fraction of its slot
    TWIST = 1.2

    def layer(self, canvas, u, z, w):
        v = self._lv(w)
        half = self.OPEN * (TAU / self.M) / 2.0 * v
        if half <= 0.01:
            return
        rot = u * self.TWIST
        for j in range(self.M):
            c = TAU * j / self.M + rot
            self._pline(canvas,
                        self._arcpts(z, self.R, c - half, c + half, n=48))

    def status(self):
        return "IRIS"


# ===========================================================================
# 9 — CROWN: the chevrons bent into a zig-zag ring
# ===========================================================================
class CrownZoomScene(ZoomScene):
    name = "zoom · crown"
    NZ = 8          # zig-zag teeth
    R_HI, R_LO = 1.05, 0.66
    TWIST = 0.6

    def layer(self, canvas, u, z, w):
        rot = u * self.TWIST
        pts = []
        for j in range(2 * self.NZ + 1):
            a = TAU * j / (2 * self.NZ) + rot
            r = self.R_HI if j % 2 == 0 else self.R_LO
            pts.append((r * math.cos(a), r * math.sin(a), z))
        self._wire(canvas, pts, self._lv(w))

    def status(self):
        return "CROWN"


def make_scenes():
    return [
        BurstZoomScene(),      # 1  star of spokes
        RosetteZoomScene(),    # 2  overlapping circles
        SlinkyZoomScene(),     # 3  rings inflating open
        TumbleZoomScene(),     # 4  swept-sphere corkscrew
        CoilZoomScene(),       # 5  leaning rings
        CardsZoomScene(),      # 6  rounded duct
        MazeZoomScene(),       # 7  C-squares, gap corkscrewing
        IrisZoomScene(),       # 8  shutter petals
        CrownZoomScene(),      # 9  zig-zag crowns
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
