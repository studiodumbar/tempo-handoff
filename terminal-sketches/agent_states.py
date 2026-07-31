#!/usr/bin/env python3
"""
agent_states — an expressive scene set for the lifecycle of an AI agent buying
something on someone's behalf.

Same monochrome vocabulary as the rest of mpp-terminal (the square: scale, line,
invert to solid white; Braille for lines/outlines, block ramps for bars). Nothing
here touches mpp.py or the four canonical sketches — it imports their core and the
shared block-ramp helpers, and registers its own scenes.

Eight states, three variations each (24 scenes), in agent order:

  DEFAULT (idle / standing by)
     1  default · breath      a lone agent square breathing inside a soft ring
     2  default · standby     a solid core with satellites idling in tilted orbits
     3  default · ambient     a sparse field twinkling under a roving cursor

  LOADING (spinning up, indeterminate)
     4  loading · bar         a block-ramp bar filling over a thin rail, forever
     5  loading · spinner     a bright arc-head chasing round a dotted track
     6  loading · pulse       a row of squares pulsing + inverting in a travelling wave

  PROCESSING (crunching)
     7  processing · gears    two counter-rotating tooth-rings meshing at the middle
     8  processing · pipeline packets flow a rail through a pulsing processor, exit solid
     9  processing · rain     columns of block-intensity trails falling like data

  THINKING (reasoning)
    10  thinking · neural     a layered net with signals firing along its edges
    11  thinking · branch     a reasoning tree growing out, holding, retracting
    12  thinking · cloud      a rotating 3D idea-cloud, edges pulsing, insights flaring

  SEARCHING (scanning options)
    13  searching · radar     a sweeping beam lighting blips as it passes
    14  searching · scan      a scan bar sweeping a catalog grid, flagging candidates
    15  searching · lens      a magnifier roving a field, enlarging what's under it

  BUYING (the transaction)
    16  buying · exchange     value and goods packets crossing between two nodes
    17  buying · coin         a payment token flipping in 3D and dropping into a slot
    18  buying · authorize    target brackets + rings gather and lock, then a shockwave

  CONFIRMATION (success)
    19  confirm · check       a checkmark drawing itself, then a success ripple
    20  confirm · burst       a radial firework settling to a solid confirmed core
    21  confirm · seal        a checkmark-in-a-square stamp slamming down with a shock

  ADDING TO CART (accumulation)
    22  cart · drop           an item arcs in and drops into the basket, bouncing
    23  cart · fill           a container filling with stacking blocks, then emptying
    24  cart · gather         items flying in from the edges, a badge counting up

Run standalone: `python agent_states.py` (reuses mpp's runner, so --no-motion,
--banner, --export, --scene all work).
"""

import math
import random

from mpp import (Scene, _clamp, EASE, EASE_BACK, GENTLE, _cubic_bezier,
                 _project3d)
from sketches import (_ramp_glyph, _down_char, _left_char, _BLOCK_DOWN,
                      _block_snapped)

TAU = 2.0 * math.pi

# A soft ease that lingers a touch at the ends without EASE's hard stop — used
# for gentle, continuous "alive" motion.
_SOFT = _cubic_bezier(0.45, 0.05, 0.55, 0.95)


# ===========================================================================
# Shared drawing helpers (all coordinates in Braille units unless noted)
# ===========================================================================
def _seg(canvas, p, q):
    """Braille line between two point tuples."""
    canvas.line(p[0], p[1], q[0], q[1])


def _arc(canvas, cx, cy, r, a0, a1, steps=None):
    """A continuous Braille arc from angle a0 to a1 on a circle of radius r."""
    if r <= 0.0:
        return
    if steps is None:
        steps = max(3, int(abs(a1 - a0) * r / 2.0) + 1)
    px = py = None
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * (i / steps)
        x = cx + r * math.cos(a)
        y = cy + r * math.sin(a)
        if px is not None:
            canvas.line(px, py, x, y)
        px, py = x, y


def _ring(canvas, cx, cy, r, n=40, phase=0.0, yscale=1.0):
    """A dotted ring (or tilted ellipse when yscale != 1) of n dots."""
    if r <= 0.0 or n < 1:
        return
    for i in range(n):
        a = phase + TAU * (i / n)
        canvas.set_dot(cx + r * math.cos(a), cy + (r * yscale) * math.sin(a))


def _breathe(t, period, lo=0.0, hi=1.0):
    """A slow cosine breathe in [lo, hi] with the given period (seconds)."""
    if period <= 0.0:
        return hi
    s = 0.5 - 0.5 * math.cos(TAU * (t / period))
    return lo + (hi - lo) * s


def _poly_partial(canvas, pts, prog):
    """Draw the polyline `pts` up to fraction `prog` (0..1) of its total length —
    for strokes that draw themselves in (checkmarks, growing branches)."""
    prog = _clamp(prog, 0.0, 1.0)
    if prog <= 0.0 or len(pts) < 2:
        return
    segs = []
    total = 0.0
    for i in range(len(pts) - 1):
        d = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        segs.append(d)
        total += d
    if total <= 0.0:
        return
    target = prog * total
    acc = 0.0
    for i, d in enumerate(segs):
        if d <= 0.0:
            continue
        if acc + d <= target:
            _seg(canvas, pts[i], pts[i + 1])
            acc += d
        else:
            f = (target - acc) / d
            x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f
            y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f
            _seg(canvas, pts[i], (x, y))
            break


def _brackets(canvas, cx, cy, off, ln):
    """Four L-shaped corner brackets at ±off from centre — a camera/scanner
    target frame. Arms point inward."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            x = cx + sx * off
            y = cy + sy * off
            canvas.line(x, y, x - sx * ln, y)
            canvas.line(x, y, x, y - sy * ln)


def _check(canvas, cx, cy, s, prog=1.0):
    """A checkmark centred on (cx, cy) at scale `s`, drawn to fraction `prog`."""
    pts = [(cx - 0.46 * s, cy + 0.02 * s),
           (cx - 0.12 * s, cy + 0.34 * s),
           (cx + 0.50 * s, cy - 0.40 * s)]
    _poly_partial(canvas, pts, prog)


def _node(canvas, x, y, size, solid=False, angle=0.0):
    """A node square — hollow outline or solid invert."""
    if size <= 0.0:
        return
    if solid:
        canvas.square_fill(x, y, size, angle)
    else:
        canvas.square_outline(x, y, size, angle)


# ===========================================================================
# DEFAULT — idle, ready, standing by
# ===========================================================================
class DefaultBreathScene(Scene):
    name = "default · breath"
    PERIOD = 3.6

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        s = _breathe(self.t, self.PERIOD, 0.85, 1.18)
        core = mind * 0.11 * s
        canvas.square_outline(cx, cy, core)
        canvas.square_fill(cx, cy, core * 0.30)
        # a soft ring breathing in counter-phase
        r = mind * (0.26 + 0.03 * math.cos(TAU * self.t / self.PERIOD + math.pi))
        _ring(canvas, cx, cy, r, n=44)
        # one dot orbiting the ring — the "alive" marker
        a = self.t * 0.7
        canvas.set_dot(cx + r * 1.16 * math.cos(a), cy + r * 1.16 * math.sin(a))

    def status(self):
        return "IDLE"


class DefaultStandbyScene(Scene):
    name = "default · standby"
    SATS = ((0.20, 0.62, 5, True), (0.31, -0.40, 4, False), (0.42, 0.26, 4, False))

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        p = _breathe(self.t, 2.4, 0.9, 1.1)
        canvas.square_fill(cx, cy, mind * 0.055 * p)
        canvas.square_outline(cx, cy, mind * 0.11)
        for r_f, spd, sz, solid in self.SATS:
            r = mind * r_f
            _ring(canvas, cx, cy, r, n=26, yscale=0.55)   # tilted orbit path
            a = self.t * spd
            x = cx + r * math.cos(a)
            y = cy + r * 0.55 * math.sin(a)
            _node(canvas, x, y, sz, solid=solid)

    def status(self):
        return "STANDBY"


class DefaultAmbientScene(Scene):
    name = "default · ambient"

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        wu, hu = canvas.wu, canvas.hu
        for r in range(2, rows - 1, 2):
            for c in range(2, cols - 1, 4):
                ph = math.sin(self.t * 1.1 + c * 0.5 + r * 0.9)
                if ph > 0.72:
                    canvas.set_dot(c * 2, r * 4)
        # a roving cursor square scanning the field
        cx = wu * (0.5 + 0.34 * math.sin(self.t * 0.5))
        cy = hu * (0.5 + 0.34 * math.sin(self.t * 0.37 * 1.3 + 1.0))
        s = min(wu, hu) * 0.055 * _breathe(self.t, 2.0, 0.85, 1.15)
        canvas.square_outline(cx, cy, s)
        canvas.set_dot(cx, cy)

    def status(self):
        return "AMBIENT"


# ===========================================================================
# LOADING — spinning up, indeterminate
# ===========================================================================
class LoadingBarScene(Scene):
    name = "loading · bar"
    PERIOD = 2.6

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        w = max(6, int(cols * 0.6))
        x0 = (cols - w) // 2
        row = rows // 2
        frac = EASE((self.t % self.PERIOD) / self.PERIOD)
        filled = frac * w
        full = int(filled)
        rem = filled - full
        for i in range(w):
            c = x0 + i
            if i < full:
                canvas.set_char(c, row, "█")            # solid
            elif i == full and rem > 0.06:
                canvas.set_char(c, row, _left_char(rem))     # partial frontier
            else:
                canvas.set_char(c, row, "▏")            # faint rail
        # end caps
        canvas.set_char(x0 - 1, row, "▕")
        canvas.set_char(x0 + w, row, "▏")
        # a small activity flicker above the frontier
        head = x0 + min(w - 1, full)
        if 0 <= head < cols and row - 1 >= 0:
            lvl = _down_char(_breathe(self.t * 6.0, 1.0, 0.2, 1.0))
            canvas.set_char(head, row - 1, lvl)

    def status(self):
        return "LOADING"


class LoadingSpinnerScene(Scene):
    name = "loading · spinner"
    SPEED = 2.3

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        r = mind * 0.24
        head = self.t * self.SPEED
        _ring(canvas, cx, cy, r, n=52)                     # faint full track
        _arc(canvas, cx, cy, r, head - 1.5, head)          # bright tail
        _arc(canvas, cx, cy, r - 1.4, head - 0.7, head)    # thicker near head
        hx, hy = cx + r * math.cos(head), cy + r * math.sin(head)
        canvas.square_fill(hx, hy, mind * 0.035)

    def status(self):
        return "SPIN"


class LoadingPulseScene(Scene):
    name = "loading · pulse"
    N = 4
    PERIOD = 1.5

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        gap = mind * 0.13
        base = mind * 0.045
        for i in range(self.N):
            ph = (self.t / self.PERIOD - i * 0.16) % 1.0
            a = max(0.0, math.sin(math.pi * ph)) ** 1.4
            x = cx + (i - (self.N - 1) / 2.0) * gap
            size = base * (1.0 + 1.4 * a)
            if a > 0.55:
                canvas.square_fill(x, cy, size)
            else:
                canvas.square_outline(x, cy, size)

    def status(self):
        return "PULSE"


# ===========================================================================
# PROCESSING — crunching
# ===========================================================================
class ProcessingGearsScene(Scene):
    name = "processing · gears"
    N_TEETH = 10

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cy = hu / 2.0
        mind = min(wu, hu)
        R = mind * 0.20
        tsz = mind * 0.05
        spin = self.t * 1.1
        gears = ((wu / 2.0 - R * 0.98, 1.0), (wu / 2.0 + R * 0.98, -1.0))
        for gx, direction in gears:
            canvas.square_outline(gx, cy, mind * 0.06)          # hub
            canvas.square_fill(gx, cy, mind * 0.02)
            _ring(canvas, gx, cy, R, n=48)                      # rim
            for i in range(self.N_TEETH):
                a = direction * spin + i * TAU / self.N_TEETH
                x = gx + R * math.cos(a)
                y = cy + R * math.sin(a)
                if i % 2 == 0:
                    canvas.square_fill(x, y, tsz)
                else:
                    canvas.square_outline(x, y, tsz)

    def status(self):
        return "GEARS"


class ProcessingPipelineScene(Scene):
    name = "processing · pipeline"
    N_PKT = 5
    SPEED = 0.19

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cy = hu / 2.0
        mind = min(wu, hu)
        x_lo, x_hi = wu * 0.08, wu * 0.92
        span = x_hi - x_lo
        proc_x = wu * 0.5
        psz = mind * 0.13
        canvas.line(x_lo, cy, x_hi, cy)                        # the rail
        near = 1e9
        for i in range(self.N_PKT):
            u = (self.t * self.SPEED + i / self.N_PKT) % 1.0
            x = x_lo + u * span
            near = min(near, abs(x - proc_x))
            sz = mind * 0.032
            if x > proc_x:
                canvas.square_fill(x, cy, sz)                  # transformed: solid
            else:
                canvas.square_outline(x, cy, sz)               # raw: hollow
        pulse = _clamp(1.0 - near / (mind * 0.16), 0.0, 1.0)
        canvas.square_outline(proc_x, cy, psz * (1.0 + 0.18 * pulse))
        if pulse > 0.45:
            canvas.square_fill(proc_x, cy, psz * 0.55 * pulse)

    def status(self):
        return "PIPELINE"


class ProcessingRainScene(Scene):
    name = "processing · rain"

    def reset(self):
        self.t = 0.0
        self._meta = None

    def _columns(self, cols):
        if self._meta and self._meta[0] == cols:
            return self._meta[1]
        m = []
        for c in range(cols):
            speed = 6.0 + (c * 29 % 7) * 1.6         # rows/sec
            length = 4 + (c * 13 % 6)
            offset = (c * 17 % 100) / 100.0
            m.append((speed, length, offset))
        self._meta = (cols, m)
        return m

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        meta = self._columns(cols)
        span = rows + 10
        for c in range(0, cols, 2):
            speed, length, offset = meta[c]
            head = (self.t * speed + offset * span) % span
            for k in range(length):
                r = int(head) - k
                if 0 <= r < rows:
                    inten = 1.0 - k / float(length)
                    lvl = int(_clamp(inten, 0.0, 1.0) * 8)
                    if lvl > 0:
                        canvas.set_char(c, r, _BLOCK_DOWN[min(8, lvl)])

    def status(self):
        return "RAIN"


# ===========================================================================
# THINKING — reasoning
# ===========================================================================
_NN_NODES = ((-0.85, -0.55), (-0.85, 0.0), (-0.85, 0.55),
             (0.0, -0.62), (0.0, 0.0), (0.0, 0.62),
             (0.85, -0.32), (0.85, 0.32))
_NN_EDGES = ((0, 3), (0, 4), (1, 4), (1, 5), (2, 4), (2, 5),
             (3, 6), (4, 6), (4, 7), (5, 7))


class ThinkingNeuralScene(Scene):
    name = "thinking · neural"
    RATE = 0.8

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        sx, sy = wu * 0.36, hu * 0.36
        pts = [(cx + nx * sx, cy + ny * sy) for nx, ny in _NN_NODES]
        for a, b in _NN_EDGES:                               # faint synapses
            _seg(canvas, pts[a], pts[b])
        flare = [0.0] * len(pts)
        for ei, (a, b) in enumerate(_NN_EDGES):
            u = (self.t * self.RATE + ei * 0.137) % 1.0
            x = pts[a][0] + (pts[b][0] - pts[a][0]) * u
            y = pts[a][1] + (pts[b][1] - pts[a][1]) * u
            canvas.square_fill(x, y, mind * 0.014)           # travelling signal
            if u > 0.85:
                flare[b] = max(flare[b], (u - 0.85) / 0.15)
            elif u < 0.15:
                flare[a] = max(flare[a], 1.0 - u / 0.15)
        for i, p in enumerate(pts):
            fl = flare[i]
            sz = mind * (0.032 + 0.03 * fl)
            _node(canvas, p[0], p[1], sz, solid=(fl > 0.5))

    def status(self):
        return "NEURAL"


def _build_tree(depth=3, root_len=0.62, spread=0.66, decay=0.72):
    """A binary reasoning tree: (nodes, edges) in a local unit space. Each edge
    is (parent_idx, child_idx, depth)."""
    nodes = []
    edges = []

    def rec(x, y, ang, length, d):
        idx = len(nodes)
        nodes.append((x, y))
        if d <= 0:
            return idx
        sp = spread * (decay ** (depth - d))
        for s in (-1, 1):
            na = ang + s * sp
            nx = x + length * math.cos(na)
            ny = y + length * math.sin(na)
            ci = rec(nx, ny, na, length * decay, d - 1)
            edges.append((idx, ci, depth - d))
        return idx

    rec(0.0, 0.0, 0.0, root_len, depth)
    return nodes, edges


class ThinkingBranchScene(Scene):
    name = "thinking · branch"
    CYCLE = 4.2
    GROW = 0.5
    HOLD = 0.72     # grow..HOLD is the hold window; after HOLD it retracts
    STAG = 0.11     # per-depth reveal stagger
    DUR = 0.16      # each edge's own draw duration

    def __init__(self):
        super().__init__()
        self.tree = _build_tree()
        self.maxd = max((e[2] for e in self.tree[1]), default=0)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        nodes, edges = self.tree
        xs = [p[0] for p in nodes]
        ys = [p[1] for p in nodes]
        minx, maxx = min(xs), max(xs)
        miny, maxy = min(ys), max(ys)
        spanx = (maxx - minx) or 1.0
        spany = (maxy - miny) or 1.0
        sc = min(wu * 0.80 / spanx, hu * 0.82 / spany)
        ox = wu * 0.5 - (minx + maxx) / 2.0 * sc
        oy = hu * 0.5 - (miny + maxy) / 2.0 * sc

        def P(p):
            return (ox + p[0] * sc, oy + p[1] * sc)

        u = (self.t % self.CYCLE) / self.CYCLE
        mind = min(wu, hu)
        canvas.square_fill(*P(nodes[0]), mind * 0.03)        # root always present

        for pa, ch, d in edges:
            if u < self.HOLD:                                # growing / held
                g = _clamp(u / self.GROW, 0.0, 1.0)
                local = _clamp((g - d * self.STAG) / self.DUR, 0.0, 1.0)
            else:                                            # retracting (deep first)
                rr = (u - self.HOLD) / (1.0 - self.HOLD)
                dd = self.maxd - d
                local = 1.0 - _clamp((rr - dd * 0.12) / 0.3, 0.0, 1.0)
            if local <= 0.0:
                continue
            pp, pc = P(nodes[pa]), P(nodes[ch])
            _poly_partial(canvas, [pp, pc], EASE(local))
            if local >= 0.999:
                pop = EASE_BACK(_clamp((local - 0.0), 0.0, 1.0))
                sz = mind * 0.022 * (0.6 + 0.4 * pop)
                _node(canvas, pc[0], pc[1], sz, solid=(d == self.maxd))

    def status(self):
        return "BRANCH"


class ThinkingCloudScene(Scene):
    name = "thinking · cloud"
    N = 16
    ROT = 0.35
    PERSP = 4.5

    def reset(self):
        self.t = 0.0
        self.nodes = []
        for _ in range(self.N):
            while True:
                x = random.uniform(-1, 1)
                y = random.uniform(-1, 1)
                z = random.uniform(-1, 1)
                if x * x + y * y + z * z <= 1.0:
                    break
            self.nodes.append((x, y, z, random.uniform(0, TAU)))
        # a few near-neighbour edges
        self.edges = []
        for i in range(self.N):
            best = sorted(range(self.N), key=lambda j: (
                (self.nodes[i][0] - self.nodes[j][0]) ** 2
                + (self.nodes[i][1] - self.nodes[j][1]) ** 2
                + (self.nodes[i][2] - self.nodes[j][2]) ** 2) if j != i else 9)
            for j in best[1:3]:
                if (j, i) not in self.edges:
                    self.edges.append((i, j))

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        yaw = self.t * self.ROT
        pitch = 0.4 * math.sin(self.t * 0.31)
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        cpit, spit = math.cos(pitch), math.sin(pitch)
        R = mind * 0.34
        cam = self.PERSP
        proj = []
        for (x, y, z, ph) in self.nodes:
            px, py, f, _z = _project3d(x, y, z, cyaw, syaw, cpit, spit, cam)
            proj.append((cx + px * R, cy + py * R, f, ph))
        for a, b in self.edges:                              # pulsing synapses
            if (math.sin(self.t * 1.3 + a * 0.7) + 1.0) > 0.7:
                _seg(canvas, proj[a][:2], proj[b][:2])
        for (x, y, f, ph) in proj:
            flare = max(0.0, math.sin(self.t * 1.1 + ph)) ** 6   # rare insight
            sz = mind * 0.02 * f * (1.0 + 2.0 * flare)
            _node(canvas, x, y, sz, solid=(flare > 0.3))

    def status(self):
        return "CLOUD"


# ===========================================================================
# SEARCHING — scanning options
# ===========================================================================
class SearchRadarScene(Scene):
    name = "searching · radar"
    SPEED = 1.3
    N_BLIP = 7

    def reset(self):
        self.t = 0.0
        self.blips = [(random.uniform(0.25, 0.98), random.uniform(0, TAU))
                      for _ in range(self.N_BLIP)]

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        R = mind * 0.44
        for rr in (0.34, 0.67, 1.0):                         # range rings
            _ring(canvas, cx, cy, R * rr, n=int(40 * rr) + 8)
        canvas.line(cx - R, cy, cx + R, cy)                  # cross-hairs
        canvas.line(cx, cy - R, cx, cy + R)
        sweep = (self.t * self.SPEED) % TAU
        for k in range(7):                                   # a trailing wedge
            a = sweep - k * 0.11
            canvas.line(cx, cy, cx + R * math.cos(a), cy + R * math.sin(a))
        for (br, ba) in self.blips:
            x = cx + R * br * math.cos(ba)
            y = cy + R * br * math.sin(ba)
            d = (sweep - ba) % TAU                            # angle since sweep passed
            glow = math.exp(-d * 2.2)
            if glow > 0.14:
                canvas.square_fill(x, y, mind * 0.018 * (0.6 + glow))
            else:
                canvas.set_dot(x, y)

    def status(self):
        return "RADAR"


class SearchScanScene(Scene):
    name = "searching · scan"
    COLS = 9
    ROWS = 5
    PERIOD = 3.0

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        gw = wu * 0.82
        gh = hu * 0.66
        x0 = (wu - gw) / 2.0
        y0 = (hu - gh) / 2.0
        dx = gw / (self.COLS - 1)
        dy = gh / (self.ROWS - 1)
        sz = mind * 0.045
        scan = ((self.t / self.PERIOD) % 1.0)
        scan_x = x0 + scan * gw
        band = dx * 0.75
        canvas.line(scan_x, y0 - dy * 0.5, scan_x, y0 + gh + dy * 0.5)
        for r in range(self.ROWS):
            for c in range(self.COLS):
                x = x0 + c * dx
                y = y0 + r * dy
                lit = abs(x - scan_x) < band
                if lit:
                    canvas.square_fill(x, y, sz * 1.3)
                    # a "candidate" flag tick above every third hit
                    if (c + r) % 3 == 0:
                        canvas.set_dot(x, y - dy * 0.55)
                        canvas.set_dot(x + 1, y - dy * 0.55)
                else:
                    # candidates already passed keep a small persistent mark
                    passed = x < scan_x and (c + r) % 3 == 0
                    if passed:
                        canvas.set_dot(x, y - dy * 0.55)
                    canvas.square_outline(x, y, sz)

    def status(self):
        return "SCAN"


class SearchLensScene(Scene):
    name = "searching · lens"
    COLS = 16
    ROWS = 9

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        gw, gh = wu * 0.86, hu * 0.78
        x0 = (wu - gw) / 2.0
        y0 = (hu - gh) / 2.0
        dx = gw / (self.COLS - 1)
        dy = gh / (self.ROWS - 1)
        lx = wu / 2.0 + gw * 0.36 * math.sin(self.t * 0.6)
        ly = hu / 2.0 + gh * 0.36 * math.sin(self.t * 0.43 + 1.0)
        lr = mind * 0.16
        for r in range(self.ROWS):
            for c in range(self.COLS):
                x = x0 + c * dx
                y = y0 + c * 0 + r * dy
                d = math.hypot(x - lx, y - ly)
                if d < lr:
                    k = 1.0 - d / lr
                    canvas.square_fill(x, y, mind * (0.012 + 0.05 * k))
                else:
                    canvas.set_dot(x, y)                      # tiny resting item
        _ring(canvas, lx, ly, lr, n=54)                       # lens rim
        _ring(canvas, lx, ly, lr * 0.82, n=40)
        # handle
        hx = lx + lr * 0.71
        hy = ly + lr * 0.71
        canvas.line(hx, hy, hx + mind * 0.10, hy + mind * 0.10)

    def status(self):
        return "LENS"


# ===========================================================================
# BUYING — the transaction
# ===========================================================================
class BuyingExchangeScene(Scene):
    name = "buying · exchange"
    CYCLE = 2.6

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cy = hu / 2.0
        mind = min(wu, hu)
        lx, rx = wu * 0.20, wu * 0.80
        canvas.line(lx, cy, rx, cy)
        canvas.square_outline(lx, cy, mind * 0.10)            # agent
        canvas.square_fill(lx, cy, mind * 0.03)
        canvas.square_outline(rx, cy, mind * 0.10)            # merchant
        canvas.square_fill(rx, cy, mind * 0.03)
        span = rx - lx
        for i in range(3):
            u = (self.t / self.CYCLE + i / 3.0) % 1.0
            e = _SOFT(u)
            # value travels agent -> merchant (solid coin)
            cxv = lx + span * e
            canvas.square_fill(cxv, cy - mind * 0.02, mind * 0.028)
            # goods travel merchant -> agent (hollow crate), lower lane
            cxg = rx - span * e
            canvas.square_outline(cxg, cy + mind * 0.04, mind * 0.032)
        # handshake flash when packets cross near the middle
        cross = abs((self.t / self.CYCLE) % 1.0 - 0.5)
        if cross < 0.12:
            fr = (0.12 - cross) / 0.12
            _ring(canvas, wu / 2.0, cy, mind * 0.05 + fr * mind * 0.12, n=40)

    def status(self):
        return "EXCHANGE"


class BuyingCoinScene(Scene):
    name = "buying · coin"
    SPIN = 3.2
    CYCLE = 2.8

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx = wu / 2.0
        mind = min(wu, hu)
        u = (self.t % self.CYCLE) / self.CYCLE
        # bob down toward a slot in the lower third, then reset
        drop = EASE(_clamp((u - 0.55) / 0.35, 0.0, 1.0))
        cy = hu * 0.42 + drop * hu * 0.22
        # slot the coin drops into
        slot_y = hu * 0.66
        canvas.line(cx - mind * 0.16, slot_y, cx - mind * 0.05, slot_y)
        canvas.line(cx + mind * 0.05, slot_y, cx + mind * 0.16, slot_y)
        R = mind * 0.13
        spin = self.t * self.SPIN
        w = 2.0 * R * abs(math.cos(spin))                     # 3D-flip foreshortening
        w = max(w, mind * 0.015)
        face_up = math.cos(spin) >= 0.0
        if face_up:
            canvas.rect_fill(cx, cy, w, 2.0 * R)              # one face: solid
        else:
            canvas.square_outline(cx, cy, 2.0 * R)            # other face: hollow ring look
            _ring(canvas, cx, cy, R * 0.62, n=24)
        # a faint value glyph pip at centre
        canvas.set_dot(cx, cy)

    def status(self):
        return "COIN"


class BuyingAuthScene(Scene):
    name = "buying · authorize"
    CYCLE = 3.0

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        u = (self.t % self.CYCLE) / self.CYCLE
        gather = EASE(_clamp(u / 0.5, 0.0, 1.0))
        for i in range(3):                                   # contracting frames
            base = mind * (0.42 - i * 0.06)
            sz = base * (1.0 - gather) + mind * 0.13
            canvas.square_outline(cx, cy, sz, angle=i * 0.2 * (1.0 - gather))
        off = mind * 0.40 * (1.0 - gather) + mind * 0.17     # closing brackets
        _brackets(canvas, cx, cy, off, mind * 0.055)
        if u > 0.5:                                          # lock engages
            e = EASE(_clamp((u - 0.5) / 0.14, 0.0, 1.0))
            canvas.square_fill(cx, cy, mind * 0.13 * e)
        if u > 0.62:                                         # authorized shockwave
            sr = EASE(_clamp((u - 0.62) / 0.32, 0.0, 1.0))
            _ring(canvas, cx, cy, mind * 0.13 + sr * mind * 0.36, n=52)

    def status(self):
        return "AUTH" if (self.t % self.CYCLE) / self.CYCLE < 0.5 else "LOCKED"


# ===========================================================================
# CONFIRMATION — success
# ===========================================================================
class ConfirmCheckScene(Scene):
    name = "confirm · check"
    CYCLE = 2.6

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        u = (self.t % self.CYCLE) / self.CYCLE
        prog = EASE(_clamp(u / 0.32, 0.0, 1.0))
        scale = 1.0
        if u > 0.85:
            scale = 1.0 - EASE((u - 0.85) / 0.15)            # shrink out to loop clean
        s = mind * 0.32 * max(scale, 0.0)
        # a bare success check (no frame) — set apart from the stamped seal
        _check(canvas, cx, cy, s, prog)
        canvas.set_dot(cx - 0.46 * s, cy + 0.02 * s)         # bold the start corner
        if 0.30 < u < 0.9:                                   # two expanding ripples
            for ri in (0.0, 0.22):
                rr = _clamp((u - 0.30) / 0.55 - ri, 0.0, 1.0)
                if rr > 0.0:
                    _ring(canvas, cx, cy, mind * 0.14 + rr * mind * 0.32, n=52)

    def status(self):
        return "CONFIRMED"


class ConfirmBurstScene(Scene):
    name = "confirm · burst"
    CYCLE = 2.4
    SPOKES = 12

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        u = (self.t % self.CYCLE) / self.CYCLE
        emit = EASE(_clamp((u - 0.08) / 0.5, 0.0, 1.0))
        fade = _clamp((u - 0.7) / 0.3, 0.0, 1.0)             # thin out at the end
        maxr = mind * 0.42
        step = 2 if fade > 0.5 else 1
        for k in range(0, self.SPOKES, step):
            a = TAU * k / self.SPOKES + 0.15 * math.sin(self.t)
            r = emit * maxr
            tx, ty = cx + r * math.cos(a), cy + r * math.sin(a)
            canvas.line(cx + mind * 0.1 * math.cos(a),
                        cy + mind * 0.1 * math.sin(a), tx, ty)
            canvas.square_fill(tx, ty, mind * 0.02 * (1.0 - fade))
        for ring_i in (0.0, 0.4):                            # two shock rings
            rr = _clamp(emit - ring_i, 0.0, 1.0)
            if rr > 0.0:
                _ring(canvas, cx, cy, rr * maxr * 0.9, n=48)
        core = _breathe(self.t, 0.6, 0.85, 1.15)
        canvas.square_fill(cx, cy, mind * 0.06 * core)       # confirmed core
        canvas.square_outline(cx, cy, mind * 0.11)

    def status(self):
        return "BURST"


class ConfirmSealScene(Scene):
    name = "confirm · seal"
    CYCLE = 2.8

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        mind = min(wu, hu)
        u = (self.t % self.CYCLE) / self.CYCLE
        land = EASE(_clamp(u / 0.3, 0.0, 1.0))
        scale = 3.0 - 2.0 * land                             # slams from 3x to 1x
        ang = 0.5 * (1.0 - land)
        out = mind * 0.16 * max(scale, 0.001)
        # double outline for a bold stamp frame
        canvas.square_outline(cx, cy, out * 2.0, ang)
        canvas.square_outline(cx, cy, out * 2.0 - mind * 0.02, ang)
        if u >= 0.28:                                        # the mark, once landed
            prog = EASE(_clamp((u - 0.28) / 0.22, 0.0, 1.0))
            _check(canvas, cx, cy, out * 1.5, prog)
        if 0.28 < u < 0.7:                                   # impact shockwave
            sr = EASE((u - 0.28) / 0.42)
            _ring(canvas, cx, cy, out + sr * mind * 0.34, n=48)

    def status(self):
        return "SEALED"


# ===========================================================================
# ADDING TO CART — accumulation
# ===========================================================================
def _basket(canvas, cx, cy, w, h):
    """A shopping-basket outline: a trapezoid body + two wheels + handle stubs."""
    tw = w * 0.5
    top_l, top_r = cx - w * 0.5, cx + w * 0.5
    bot_l, bot_r = cx - tw, cx + tw
    top_y, bot_y = cy - h * 0.5, cy + h * 0.5
    canvas.line(top_l, top_y, top_r, top_y)                  # rim
    canvas.line(top_l, top_y, bot_l, bot_y)                  # left wall
    canvas.line(top_r, top_y, bot_r, bot_y)                  # right wall
    canvas.line(bot_l, bot_y, bot_r, bot_y)                  # base
    # wheels
    canvas.square_outline(cx - tw * 0.55, bot_y + h * 0.22, w * 0.10)
    canvas.square_outline(cx + tw * 0.55, bot_y + h * 0.22, w * 0.10)
    # handle stub
    canvas.line(top_l, top_y, top_l - w * 0.14, top_y - h * 0.34)


class CartDropScene(Scene):
    name = "cart · drop"
    CYCLE = 1.9

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx = wu / 2.0
        bw, bh = mind * 0.34, mind * 0.26
        by = hu * 0.66
        u = (self.t % self.CYCLE) / self.CYCLE
        # a nudge on the basket when the item lands
        landed = u > 0.62
        nudge = 0.0
        if 0.62 < u < 0.8:
            nudge = math.sin((u - 0.62) / 0.18 * math.pi) * mind * 0.02
        _basket(canvas, cx, by + nudge, bw, bh)
        # item arcs from top-left into the basket
        if u < 0.66:
            p = EASE(u / 0.66)
            sx, sy = cx - bw * 0.9, hu * 0.12
            ex, ey = cx, by - bh * 0.1
            ix = sx + (ex - sx) * p
            iy = sy + (ey - sy) * p - math.sin(p * math.pi) * hu * 0.10  # arc lift
            _node(canvas, ix, iy, mind * 0.05, solid=True, angle=p * 1.2)
        else:                                                # settle inside w/ bounce
            b = EASE_BACK(_clamp((u - 0.66) / 0.2, 0.0, 1.0))
            iy = (by - bh * 0.1) + b * bh * 0.2
            _node(canvas, cx, iy, mind * 0.05, solid=True)

    def status(self):
        return "DROP"


class CartFillScene(Scene):
    name = "cart · fill"
    CYCLE = 4.5
    LEVELS = 5

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        w = max(6, int(cols * 0.26))
        h = self.LEVELS
        x0 = (cols - w) // 2
        y_base = rows // 2 + h // 2
        # container walls (characters, so it reads crisp)
        for k in range(h + 1):
            canvas.set_char(x0 - 1, y_base - k, "┃")
            canvas.set_char(x0 + w, y_base - k, "┃")
        for c in range(x0, x0 + w):
            canvas.set_char(c, y_base + 1, "━")
        u = (self.t % self.CYCLE) / self.CYCLE
        # fill rises over most of the cycle, then empties quickly
        if u < 0.8:
            fill = EASE(u / 0.8) * h
        else:
            fill = (1.0 - EASE((u - 0.8) / 0.2)) * h
        full = int(fill)
        rem = fill - full
        for k in range(full):
            for c in range(x0, x0 + w):
                canvas.set_char(c, y_base - k, "█")
        if rem > 0.1 and full < h:
            ch = _down_char(rem)
            for c in range(x0, x0 + w):
                canvas.set_char(c, y_base - full, ch)
        # a dropping item feeding the fill
        drop_u = (self.t * 1.7) % 1.0
        if u < 0.8:
            dy = int((y_base - h - 3) + drop_u * 3)
            if 0 <= dy < rows:
                canvas.set_char(x0 + w // 2, dy, "■")

    def status(self):
        return "FILL"


class CartGatherScene(Scene):
    name = "cart · gather"
    CYCLE = 2.4
    N = 6

    def reset(self):
        self.t = 0.0
        self.origins = []
        for i in range(self.N):
            a = TAU * i / self.N + random.uniform(-0.3, 0.3)
            self.origins.append((math.cos(a), math.sin(a),
                                 random.uniform(0.0, 0.5)))

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu * 0.52
        mind = min(wu, hu)
        _basket(canvas, cx, cy, mind * 0.30, mind * 0.24)
        arrived = 0
        for (ox, oy, delay) in self.origins:
            u = (self.t / self.CYCLE - delay) % 1.0
            e = EASE(_clamp(u / 0.7, 0.0, 1.0))
            sx = cx + ox * wu * 0.5
            sy = cy + oy * hu * 0.55
            ix = sx + (cx - sx) * e
            iy = sy + (cy - sy) * e
            if e >= 0.999:
                arrived += 1
            else:
                _node(canvas, ix, iy, mind * 0.04, solid=(e > 0.5), angle=e * 1.5)
        # count badge: a growing row of pips above the basket
        cnt = 1 + (int(self.t / self.CYCLE * self.N) % self.N)
        bx = cx - (cnt - 1) * mind * 0.03
        for i in range(cnt):
            canvas.square_fill(bx + i * mind * 0.06, cy - mind * 0.24, mind * 0.02)

    def status(self):
        return "GATHER"


# ===========================================================================
# Registry — in agent-lifecycle order (24 scenes)
# ===========================================================================
def make_scenes():
    return [
        DefaultBreathScene(),        # 1  default · breath
        DefaultStandbyScene(),       # 2  default · standby
        DefaultAmbientScene(),       # 3  default · ambient
        LoadingBarScene(),           # 4  loading · bar
        LoadingSpinnerScene(),       # 5  loading · spinner
        LoadingPulseScene(),         # 6  loading · pulse
        ProcessingGearsScene(),      # 7  processing · gears
        ProcessingPipelineScene(),   # 8  processing · pipeline
        ProcessingRainScene(),       # 9  processing · rain
        ThinkingNeuralScene(),       # 10 thinking · neural
        ThinkingBranchScene(),       # 11 thinking · branch
        ThinkingCloudScene(),        # 12 thinking · cloud
        SearchRadarScene(),          # 13 searching · radar
        SearchScanScene(),           # 14 searching · scan
        SearchLensScene(),           # 15 searching · lens
        BuyingExchangeScene(),       # 16 buying · exchange
        BuyingCoinScene(),           # 17 buying · coin
        BuyingAuthScene(),           # 18 buying · authorize
        ConfirmCheckScene(),         # 19 confirm · check
        ConfirmBurstScene(),         # 20 confirm · burst
        ConfirmSealScene(),          # 21 confirm · seal
        CartDropScene(),             # 22 cart · drop
        CartFillScene(),             # 23 cart · fill
        CartGatherScene(),           # 24 cart · gather
    ]


if __name__ == "__main__":
    import mpp

    mpp.main(make_scenes())
