#!/usr/bin/env python3
"""
flow_cycle — agent_states_3D's processing lattice, rebuilt smooth, times eight.

The source scene (processing · lattice) is a POV treadmill: layers of geometry
ride a conveyor from deep z toward the camera, wrap, and ride again — the
recursive looping motion this whole file is about. What was rough about it:
layers POPPED through a hard fog cutoff, the compute plane switched on and off
at a binary threshold, and content could snap at the wrap. Everything here is
continuous:

  * BIRTH AND DEATH ARE ENVELOPES. Every element's size rides w(u): a
    smoothstep up as it materialises in the deep, a quick smoothstep out as
    it slips past the camera. Nothing pops — things condense out of the dark,
    swell with approach, and dissolve at the last moment.
  * ACTIVATION IS GAUSSIAN. The sweep plane glows things up and lets them
    down on a smooth bell, never a threshold.
  * THE LOOP IS EXACT. Layer content is keyed to conveyor position u alone
    (never to layer index) and the sweep plane runs an integer number of
    sweeps per pass — so one full pass (1/SPEED seconds) is byte-identical.
  * THE CAMERA IS BOLTED DOWN. All the depth and parallax comes from the
    geometry streaming past a fixed lens — off-axis elements slide against
    the vanishing point on their own.

Depth still speaks the file's fog language: far = a faint braille dot,
mid = a hollow square, near = a solid invert that occludes.

    1  flow · lattice   the source scene, smooth: node grids riding the
                        conveyor, a gaussian compute wave breathing the mesh
                        in and out as it passes
    2  flow · frames    a square tunnel, each frame twisted a little further
                        — flying down a slowly corkscrewing duct
    3  flow · rings     rings of beads, counter-twisting with depth, pulsed
                        by the sweep wave
    4  flow · helix     a double helix fixed in space; the conveyor slides
                        its beads along the strands, rungs flowing past
    5  flow · pylons    gate after gate of vertical pillars flying past
                        either side of the lens
    6  flow · vortex    beads spiral INWARD as they approach — radius decays
                        with u, so everything is drawn toward the centre,
                        swelling as it comes
    7  flow · rails     four static rails to the vanishing point; framed
                        cross-sections flow along them toward you
    8  flow · weave     dot rows that snake side to side as they approach,
                        the whole conveyor swimming

Projection and fog vocabulary come from agent_states_3D.
Run: `python flow_cycle.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from agent_states_3d import _mkview, _P, _L, TAU


def _smooth(x):
    return x * x * (3.0 - 2.0 * x)


# ===========================================================================
# The conveyor
# ===========================================================================
class FlowScene(Scene):
    """A treadmill of N layers from Z_BACK to Z_FRONT, wrapping seamlessly.
    A scene implements layer(canvas, u, z, w): u is conveyor position (0 deep,
    1 at the camera), w the birth/death envelope. All variation must be a
    function of u — that is what makes the wrap invisible and the loop exact."""

    N = 14
    Z_BACK = -3.2
    Z_FRONT = 0.55
    SPEED = 0.11           # conveyor passes (and loops) per second
    SCALE = 0.62
    SWEEPS = 2             # integer sweep-plane passes per conveyor pass
    GLOW_W = 0.085         # gaussian width of the sweep plane, in u

    def _win(self, u):
        """Birth/death envelope: condense in the deep, dissolve at the lens."""
        a = _smooth(_clamp(u / 0.12, 0.0, 1.0))
        b = 1.0 - _smooth(_clamp((u - 0.90) / 0.10, 0.0, 1.0))
        return a * b

    def _act(self, u):
        """The sweep plane's gaussian glow at conveyor position u."""
        d = abs(u - self._plane)
        d = min(d, 1.0 - d)
        return math.exp(-(d / self.GLOW_W) ** 2)

    def _p(self, x, y, z):
        return _P(x, y, z, self._V)

    def _lv(self, w):
        """Line visibility: lines cannot fade in monochrome, so they GROW —
        this maps the envelope to a length fraction, and _seg draws that
        fraction about the midpoint. A dying near-lens frame retracts into
        its corners instead of vanishing whole (that was a 1200-char pop)."""
        return _smooth(_clamp((w - 0.08) / 0.30, 0.0, 1.0))

    def _seg(self, canvas, a, b, v):
        """The middle fraction v of the segment between projected a and b."""
        if not (a and b) or v <= 0.02:
            return
        if v >= 0.999:
            canvas.line(a[0], a[1], b[0], b[1])
            return
        mx, my = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
        hx, hy = (b[0] - a[0]) / 2.0 * v, (b[1] - a[1]) / 2.0 * v
        canvas.line(mx - hx, my - hy, mx + hx, my + hy)

    def _node(self, canvas, p, w, k=0.026):
        """Fog node with a continuous size ramp: dot -> hollow -> solid."""
        if not p or w <= 0.05:
            return
        size = p[2] * k * self._mind * w
        if size < self._mind * 0.011:
            canvas.set_dot(p[0], p[1])
        elif p[2] < 1.30:
            canvas.square_outline(p[0], p[1], size)
        else:
            canvas.square_fill(p[0], p[1], size)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        self._mind = min(wu, hu)
        # rounded to 1e-12: kills the float jitter in t*SPEED that would
        # otherwise flip the odd braille dot between one pass and the next
        # (the animation steps ~1e-2 per frame, so nothing visible is lost)
        ph = round((self.t * self.SPEED) % 1.0, 12)
        self._plane = (ph * self.SWEEPS) % 1.0
        self._V = _mkview(wu / 2.0, hu / 2.0, self._mind * self.SCALE)
        self.pre(canvas)
        lays = []
        for i in range(self.N):
            u = (i / self.N + ph) % 1.0
            z = self.Z_BACK + u * (self.Z_FRONT - self.Z_BACK)
            lays.append((z, u))
        lays.sort()                       # painter order: far -> near
        for z, u in lays:
            self.layer(canvas, u, z, self._win(u))

    def pre(self, canvas):
        """Static backdrop drawn before (behind) the conveyor."""
        pass

    def layer(self, canvas, u, z, w):
        raise NotImplementedError

    def status(self):
        return "FLOW"


# ===========================================================================
# 1 — LATTICE: the source scene, made continuous
# ===========================================================================
class LatticeFlowScene(FlowScene):
    name = "flow · lattice"
    NX, NY = 5, 3
    SPAN = 0.82

    def layer(self, canvas, u, z, w):
        W = self.SPAN
        H = self.SPAN * self.NY / self.NX
        act = self._act(u)
        grid = [[self._p((gx / (self.NX - 1) - 0.5) * 2 * W,
                         (gy / (self.NY - 1) - 0.5) * 2 * H, z)
                 for gx in range(self.NX)] for gy in range(self.NY)]
        if act > 0.10:
            # the mesh breathes in: every edge grows from its midpoint by act
            for gy in range(self.NY):
                for gx in range(self.NX):
                    for (dx, dy) in ((1, 0), (0, 1)):
                        gx2, gy2 = gx + dx, gy + dy
                        if gx2 >= self.NX or gy2 >= self.NY:
                            continue
                        self._seg(canvas, grid[gy][gx], grid[gy2][gx2],
                                  act * self._lv(w))
        for row in grid:
            for p in row:
                self._node(canvas, p, w, 0.020 * (1.0 + 1.5 * act))

    def status(self):
        return "LATTICE"


# ===========================================================================
# 2 — FRAMES: a corkscrewing square duct
# ===========================================================================
class FramesFlowScene(FlowScene):
    name = "flow · frames"
    S = 0.92        # frame half-size
    TWIST = 1.15    # radians of corkscrew across the whole conveyor

    def layer(self, canvas, u, z, w):
        rot = u * self.TWIST
        co, si = math.cos(rot), math.sin(rot)
        pts = []
        for (px, py) in ((self.S, self.S), (-self.S, self.S),
                         (-self.S, -self.S), (self.S, -self.S)):
            pts.append(self._p(px * co - py * si, px * si + py * co, z))
        v = self._lv(w)
        for i in range(4):
            self._seg(canvas, pts[i], pts[(i + 1) % 4], v)
        for p in pts:
            self._node(canvas, p, w, 0.018)

    def status(self):
        return "DUCT"


# ===========================================================================
# 3 — RINGS: bead circles, counter-twisting, pulsed by the sweep
# ===========================================================================
class RingsFlowScene(FlowScene):
    name = "flow · rings"
    NB = 12
    R = 0.80
    TWIST = 2.1

    def layer(self, canvas, u, z, w):
        act = self._act(u)
        rot = u * self.TWIST
        r = self.R * (1.0 + 0.10 * act)      # the wave puffs the ring
        for j in range(self.NB):
            a = TAU * j / self.NB + rot
            p = self._p(r * math.cos(a), r * math.sin(a), z)
            self._node(canvas, p, w, 0.016 * (1.0 + 1.3 * act))

    def status(self):
        return "RINGS"


# ===========================================================================
# 4 — HELIX: strands fixed in space, beads sliding along them
# ===========================================================================
class HelixFlowScene(FlowScene):
    name = "flow · helix"
    R = 0.62
    TURNS = 1.6     # strand turns across the conveyor

    def _pt(self, u, strand):
        a = TAU * (u * self.TURNS + strand * 0.5)
        z = self.Z_BACK + u * (self.Z_FRONT - self.Z_BACK)
        return self._p(self.R * math.cos(a), self.R * math.sin(a), z)

    def layer(self, canvas, u, z, w):
        u2 = u + 1.0 / self.N
        v = self._lv(w)
        for s in (0, 1):
            p = self._pt(u, s)
            if u2 <= 1.0:                    # strand segment to the next slot
                self._seg(canvas, p, self._pt(u2, s), v)
            self._node(canvas, p, w, 0.020)
        # the rung between the strands
        self._seg(canvas, self._pt(u, 0), self._pt(u, 1), v)

    def status(self):
        return "HELIX"


# ===========================================================================
# 5 — PYLONS: gates of pillars flying past (the parallax scene)
# ===========================================================================
class PylonsFlowScene(FlowScene):
    name = "flow · pylons"
    PX = 0.88       # pillar distance from the axis
    PH = 0.60       # pillar half-height

    def layer(self, canvas, u, z, w):
        for sx in (-1.0, 1.0):
            top = self._p(sx * self.PX, -self.PH, z)
            bot = self._p(sx * self.PX, self.PH, z)
            self._seg(canvas, top, bot, self._lv(w))
            self._node(canvas, top, w, 0.016)
            self._node(canvas, bot, w, 0.016)
        # a floor stud between the gates
        self._node(canvas, self._p(0.0, self.PH, z), w * 0.6, 0.010)

    def status(self):
        return "PYLONS"


# ===========================================================================
# 6 — VORTEX: drawn toward the centre as it comes
# ===========================================================================
class VortexFlowScene(FlowScene):
    name = "flow · vortex"
    NB = 12
    R0 = 1.15       # radius in the deep
    DECAY = 0.74    # how much of the radius is gone by the lens
    TWIST = 2.8

    def layer(self, canvas, u, z, w):
        r = self.R0 * (1.0 - self.DECAY * _smooth(u))
        rot = u * self.TWIST
        for j in range(self.NB):
            a = TAU * j / self.NB + rot
            p = self._p(r * math.cos(a), r * math.sin(a), z)
            self._node(canvas, p, w, 0.028)

    def status(self):
        return "VORTEX"


# ===========================================================================
# 7 — RAILS: static rails to the vanishing point, sections flowing along
# ===========================================================================
class RailsFlowScene(FlowScene):
    name = "flow · rails"
    RX, RY = 0.72, 0.46

    def _corners(self):
        return ((self.RX, self.RY), (-self.RX, self.RY),
                (-self.RX, -self.RY), (self.RX, -self.RY))

    def pre(self, canvas):
        # the rails themselves: straight lines project straight, so each is
        # just its two endpoints — but they never move, only their traffic does
        for (px, py) in self._corners():
            _L(canvas, self._p(px, py, self.Z_BACK + 0.35),
               self._p(px, py, self.Z_FRONT))

    def layer(self, canvas, u, z, w):
        pts = [self._p(px, py, z) for (px, py) in self._corners()]
        v = self._lv(w)
        for i in range(4):
            self._seg(canvas, pts[i], pts[(i + 1) % 4], v)
        for p in pts:
            self._node(canvas, p, w, 0.018)

    def status(self):
        return "RAILS"


# ===========================================================================
# 8 — WEAVE: rows that snake as they approach
# ===========================================================================
class WeaveFlowScene(FlowScene):
    name = "flow · weave"
    NXD = 6
    W = 0.85
    ROWY = 0.38
    SNAKE = 0.30    # lateral swing amplitude
    SNAKE_K = 2     # integer snake cycles across the conveyor (keeps the wrap)

    def layer(self, canvas, u, z, w):
        off = self.SNAKE * math.sin(TAU * u * self.SNAKE_K)
        for sy in (-1.0, 1.0):
            for gx in range(self.NXD):
                x = (gx / (self.NXD - 1) - 0.5) * 2 * self.W + off * sy
                p = self._p(x, sy * self.ROWY, z)
                self._node(canvas, p, w, 0.016)

    def status(self):
        return "WEAVE"


# ===========================================================================
# The loop is only exact if every rate is an integer per conveyor pass
# ===========================================================================
def _selfcheck():
    assert FlowScene.SWEEPS == int(FlowScene.SWEEPS), (
        "flow_cycle: the sweep plane must run whole sweeps per pass")
    assert WeaveFlowScene.SNAKE_K == int(WeaveFlowScene.SNAKE_K), (
        "flow_cycle: the snake must run whole cycles across the conveyor "
        "or the wrap jumps")


_selfcheck()


def make_scenes():
    return [
        LatticeFlowScene(),     # 1  the source, smooth
        FramesFlowScene(),      # 2  corkscrew duct
        RingsFlowScene(),       # 3  pulsing bead rings
        HelixFlowScene(),       # 4  strands and rungs
        PylonsFlowScene(),      # 5  parallax gates
        VortexFlowScene(),      # 6  drawn toward the centre
        RailsFlowScene(),       # 7  traffic on static rails
        WeaveFlowScene(),       # 8  snaking rows
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
