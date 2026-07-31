#!/usr/bin/env python3
"""
flowlines — wires and beads: the scene-10 vocabulary, built out into agent states.

The client's favourite (scenes.py scene 10, the pseudo-3D spiral stretch) is,
at its heart, three moves:

    * a WIRE — a long swooping trajectory drawn as a fine dotted braille line
    * a CHAIN — solid block beads strung along the wire, stretched along its
      tangent, many at once, evenly spaced
    * DEPTH — perspective scaling: far down the wire a bead is a speck, near
      the viewer it is a fat slab

Everything here keeps exactly that grammar (dotted braille paths + block-char
chains + big negative space) and choreographs the CHAIN per state:

    1  flow · loading     the chain compresses along the wire and packs solid
                          at its head — the bar builds out of arrivals
    2  flow · thinking    meander wires; the chains breathe back and forth,
                          never settling
    3  flow · fetching    a chain streams in from a far vanishing point,
                          growing as it nears; tiny acks trickle back out
    4  flow · comparing   two mirrored arcs; the chains run in anti-phase and
                          PAUSE face-to-face mid-frame, trading size — a weigh
    5  flow · overview    a fan of wires from one origin; the chains glide out
                          and hold as a spread constellation, then draw back
    6  flow · section     the whole composition swooshes left — wires, chains
                          and all — and the next section sweeps in
    7  flow · cart        a queue rides the wire; one bead at a time lands in
                          a packed block row, the queue advancing behind it
    8  flow · edit        a slot lifts out of the packed row on a dotted arc,
                          resizes, re-seats — or is flung away, the row closing

All loops are seamless; the easing is the house ease-in-out-expo almost
everywhere. Run standalone: `python flowlines.py` (60fps explorer; any flag
falls through to mpp's runner).
"""

import math
import sys

from mpp import Scene, _clamp
from sketches import _hbar_block, _vbar_block

TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------
def _expo(x):
    """easeInOutExpo — the house move: hold, snap, hold."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


def _eout(x):
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 1.0 - 2.0 ** (-10.0 * x)


def _ein(x):
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 2.0 ** (10.0 * x - 10.0)


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


# ---------------------------------------------------------------------------
# The wire — a cubic bezier in NORMALISED space ((0,0) top-left .. (1,1)
# bottom-right), resampled by arc length so its dots space evenly and beads
# can be placed at a clean 0..1 "distance along the wire". Each wire carries a
# depth ramp; f is lerped along it and scales dots & beads (near = big).
# ---------------------------------------------------------------------------
class Wire:
    def __init__(self, p0, p1, p2, p3, f0=1.0, f1=1.0, samples=260):
        self.ctrl = (p0, p1, p2, p3)
        self.f0, self.f1 = f0, f1
        self.samples = samples
        self._key = None

    def _bez(self, u):
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = self.ctrl
        m = 1.0 - u
        a, b, c, d = m * m * m, 3 * m * m * u, 3 * m * u * u, u * u * u
        return (a * x0 + b * x1 + c * x2 + d * x3,
                a * y0 + b * y1 + c * y2 + d * y3)

    def bake(self, wu, hu):
        """Arc-length table in canvas units (cached per canvas size)."""
        if self._key == (wu, hu):
            return
        self._key = (wu, hu)
        pts = []
        total = 0.0
        px = py = None
        for i in range(self.samples + 1):
            u = i / self.samples
            nx, ny = self._bez(u)
            x, y = nx * wu, ny * hu
            if px is not None:
                total += math.hypot(x - px, y - py)
            pts.append((x, y, total))
            px, py = x, y
        self.pts = pts
        self.length = max(total, 1e-6)

    def at(self, s):
        """(x, y, angle, f) at arc-length fraction s in [0, 1]."""
        s = _clamp(s, 0.0, 1.0)
        target = s * self.length
        pts = self.pts
        lo, hi = 0, len(pts) - 1
        while lo < hi:                       # binary search the arc table
            mid = (lo + hi) // 2
            if pts[mid][2] < target:
                lo = mid + 1
            else:
                hi = mid
        i = max(1, lo)
        x0, y0, s0 = pts[i - 1]
        x1, y1, s1 = pts[i]
        w = (target - s0) / max(1e-6, s1 - s0)
        x = x0 + (x1 - x0) * w
        y = y0 + (y1 - y0) * w
        ang = math.atan2(y1 - y0, x1 - x0)
        f = self.f0 + (self.f1 - self.f0) * s
        return x, y, ang, f

    def dots(self, canvas, gap=2.5, s0=0.0, s1=1.0, weight=1.0, dx=0.0):
        """The dotted braille wire from s0..s1; `weight` thins (<1) the dots."""
        step = gap / self.length
        s = s0
        k = 0
        stride = max(1, round(1.0 / max(weight, 0.1)))
        while s <= s1:
            if weight >= 1.0 or (k % stride) == 0:
                x, y, _a, _f = self.at(s)
                canvas.set_dot(x + dx, y)
            s += step
            k += 1


def _bead(canvas, x, y, ang, size):
    """One solid block-char bead at (x, y), stretched along the wire's tangent
    (nearest axis, exactly like scene 10's block ramp), `size` braille units."""
    if size <= 0.9:
        canvas.set_dot(x, y)
        return
    a = ang % math.pi
    th = max(2.4, size * 0.9)
    if a < math.pi / 4 or a > 3 * math.pi / 4:
        _hbar_block(canvas, x - size / 2.0, x + size / 2.0, y, th)
    else:
        _vbar_block(canvas, x, y - size / 2.0, y + size / 2.0, th)


class FlowScene(Scene):
    CYCLE = 4.0

    def _u(self):
        return (self.t % self.CYCLE) / self.CYCLE

    def _bake_all(self, canvas, wires):
        for w in wires:
            w.bake(canvas.wu, canvas.hu)


# ===========================================================================
# 1 — LOADING  (the chain compresses along the wire and packs at its head)
# ===========================================================================
class LoadingFlowScene(FlowScene):
    name = "flow · loading"
    CYCLE = 5.6
    N = 20                # beads in the chain
    PACK_LEN = 0.30       # wire fraction the finished bar occupies
    BASE = 5.4

    def __init__(self):
        super().__init__()
        # one long lazy S from upper-left down across to the lower-right,
        # growing toward the viewer as it lands (the loading lane)
        self.wire = Wire((0.04, 0.14), (0.55, 0.06), (0.28, 0.82), (0.96, 0.74),
                         f0=0.45, f1=1.55)
        # a second trajectory far behind it, sweeping the other way — depth
        self.back = Wire((0.98, 0.34), (0.55, 0.30), (0.70, 0.06), (0.10, 0.04),
                         f0=0.55, f1=0.14)

    def draw(self, canvas):
        self._bake_all(canvas, [self.wire, self.back])
        u = self._u()
        self.wire.dots(canvas)
        self.back.dots(canvas, weight=0.55)
        # the background chain drifts steadily, tiny — life at another depth
        for k in range(7):
            s = ((self.t * 0.05) + k / 7.0) % 1.0
            x, y, ang, f = self.back.at(s)
            _bead(canvas, x, y, ang, 2.8 * f)

        fill = _expo(_clamp(u / 0.78, 0.0, 1.0))             # the compaction
        drain = _expo(_clamp((u - 0.88) / 0.12, 0.0, 1.0))   # then the release
        for k in range(self.N):
            kf = k / (self.N - 1)
            spread = 0.04 + 0.92 * kf                        # strung along the wire
            packed = (1.0 - self.PACK_LEN) + self.PACK_LEN * kf
            s = spread + (packed - spread) * fill
            if drain > 0.0:
                s = packed + (1.25 - packed) * drain         # slide off the head
                if s >= 1.0:
                    continue
            x, y, ang, f = self.wire.at(s)
            solid = fill > 0.97 and drain <= 0.0
            _bead(canvas, x, y, ang, self.BASE * f * (1.3 if solid else 1.0))

    def status(self):
        u = self._u()
        return "LOADED" if 0.78 < u <= 0.88 else "LOADING"


# ===========================================================================
# 2 — THINKING  (meander wires; the chains breathe, never settle)
# ===========================================================================
class ThinkingFlowScene(FlowScene):
    name = "flow · thinking"
    CYCLE = 9.0
    PER = 9               # beads per chain

    def __init__(self):
        super().__init__()
        self.wires = [
            Wire((0.06, 0.30), (0.55, -0.02), (0.20, 0.66), (0.94, 0.30),
                 f0=0.7, f1=1.25),
            Wire((0.10, 0.74), (0.72, 0.40), (0.30, 1.06), (0.92, 0.66),
                 f0=1.3, f1=0.55),
        ]

    def draw(self, canvas):
        self._bake_all(canvas, self.wires)
        t = self.t
        for wi, w in enumerate(self.wires):
            w.dots(canvas, weight=0.75)
            # the whole chain sways along the wire on two incommensurate sines,
            # with a little per-bead lag so it flexes like a held thought
            sway = (0.075 * math.sin(t * 0.55 + wi * 2.1)
                    + 0.045 * math.sin(t * 0.29 + wi))
            for k in range(self.PER):
                kf = k / (self.PER - 1)
                lag = 0.4 + 0.6 * kf
                s = _clamp(0.06 + 0.88 * kf + sway * lag, 0.01, 0.99)
                x, y, ang, f = w.at(s)
                size = (4.0 + 1.0 * math.sin(t * 0.8 + k * 1.7 + wi * 3.0)) * f
                _bead(canvas, x, y, ang, size)

    def status(self):
        return "THINKING"


# ===========================================================================
# 3 — FETCHING  (a chain streams in from a far point; acks trickle back)
# ===========================================================================
class FetchingFlowScene(FlowScene):
    name = "flow · fetching"
    CYCLE = 3.2
    N_TRAIN = 14          # beads streaming down the request wire
    BASE = 5.2

    def __init__(self):
        super().__init__()
        # the request wire: from a far vanishing point upper-right swooping
        # down into the near foreground — the reference's exponential curve
        self.wire = Wire((0.94, 0.04), (0.62, 0.08), (0.84, 0.46), (0.06, 0.84),
                         f0=0.12, f1=2.0)
        # the ack wire: a slimmer path arcing back out above it
        self.ack = Wire((0.12, 0.72), (0.58, 0.44), (0.60, 0.26), (0.92, 0.02),
                        f0=1.0, f1=0.16)

    def draw(self, canvas):
        self._bake_all(canvas, [self.wire, self.ack])
        u = self._u()
        self.wire.dots(canvas)
        self.ack.dots(canvas, weight=0.45)
        # a continuous train: the whole chain flows toward the viewer, spacing
        # opening up as perspective grows — pure scene-10 energy
        for k in range(self.N_TRAIN):
            s = (u + k / self.N_TRAIN) % 1.0
            e = 0.25 * s + 0.75 * _ein(s)                    # crawl far, rush near
            x, y, ang, f = self.wire.at(e)
            _bead(canvas, x, y, ang, self.BASE * f)
        for k in range(4):                                   # tiny acks going back
            s = ((u * 1.5) + k / 4.0) % 1.0
            x, y, ang, f = self.ack.at(_smooth(s))
            if 0.03 < s < 0.97:
                _bead(canvas, x, y, ang, 1.8 * f)

    def status(self):
        return "FETCHING"


# ===========================================================================
# 4 — COMPARING  (mirrored arcs; the chains pause face-to-face and weigh)
# ===========================================================================
class ComparingFlowScene(FlowScene):
    name = "flow · comparing"
    CYCLE = 6.4
    PER = 6               # beads per side

    def __init__(self):
        super().__init__()
        # two arcs bowing TOWARD each other — ")(" — so the chains meet
        # face-to-face across a slim central gap
        self.left = Wire((0.18, 0.02), (0.46, 0.26), (0.46, 0.70), (0.16, 0.96),
                         f0=0.8, f1=0.8)
        self.right = Wire((0.82, 0.02), (0.54, 0.26), (0.54, 0.70), (0.84, 0.96),
                          f0=0.8, f1=0.8)

    def _ride(self, u):
        """Chain offset schedule: slide in, HOLD at the meeting, slide off."""
        if u < 0.28:
            return 0.5 * _expo(u / 0.28)
        if u < 0.72:
            return 0.5
        return 0.5 + 0.5 * _expo((u - 0.72) / 0.28)

    def draw(self, canvas):
        self._bake_all(canvas, [self.left, self.right])
        u = self._u()
        self.left.dots(canvas)
        self.right.dots(canvas)
        ride = self._ride(u)
        hold = 0.28 <= u < 0.72
        trade = math.sin((u - 0.28) / 0.44 * TAU) if hold else 0.0
        for k in range(self.PER):
            kf = (k - (self.PER - 1) / 2.0) / self.PER       # centred spacing
            s = _clamp(ride + kf * 0.42, 0.02, 0.98)
            mid = 1.0 - abs(kf) * 2.0                        # middle beads biggest
            xl, yl, al, fl = self.left.at(s)
            xr, yr, ar, fr = self.right.at(s)
            _bead(canvas, xl, yl, al, (4.4 + 2.0 * mid + 1.8 * trade * mid) * fl)
            _bead(canvas, xr, yr, ar, (4.4 + 2.0 * mid - 1.8 * trade * mid) * fr)

    def status(self):
        return "WEIGHING" if 0.28 <= self._u() < 0.72 else "COMPARING"


# ===========================================================================
# 5 — OVERVIEW  (a fan of wires; the chains glide out into a constellation)
# ===========================================================================
class OverviewFlowScene(FlowScene):
    name = "flow · overview"
    CYCLE = 7.0
    PER = 4               # beads per wire

    def __init__(self):
        super().__init__()
        self.wires = []
        # a fan spreading from a shared origin low-left across the whole frame
        targets = [(0.96, 0.08), (1.00, 0.34), (0.94, 0.58),
                   (0.76, 0.82), (0.52, 0.94), (0.26, 0.98)]
        for i, (tx, ty) in enumerate(targets):
            mid1 = (0.28 + 0.05 * i, 0.64 - 0.08 * i)
            mid2 = (0.55 + 0.03 * i, 0.50 - 0.05 * i)
            self.wires.append(Wire((0.06, 0.88), mid1, mid2, (tx, ty),
                                   f0=1.45, f1=0.6))

    def draw(self, canvas):
        self._bake_all(canvas, self.wires)
        u = self._u()
        if u < 0.30:                                        # spread open
            e = _expo(u / 0.30)
        elif u < 0.74:                                      # hold the overview
            e = 1.0
        else:                                               # gather back
            e = 1.0 - _expo((u - 0.74) / 0.26)
        for i, w in enumerate(self.wires):
            w.dots(canvas, s0=0.05, s1=_clamp(0.10 + 0.90 * e, 0.10, 1.0), weight=0.8)
            for k in range(self.PER):
                rest = 0.18 + 0.78 * k / (self.PER - 1)
                drift = 0.02 * math.sin(self.t * 0.5 + i * 1.3 + k)
                s = _clamp(rest * e + drift * e, 0.0, 0.98)
                x, y, ang, f = w.at(s)
                _bead(canvas, x, y, ang, (3.2 + 0.9 * k) * f)

    def status(self):
        u = self._u()
        return "OVERVIEW" if 0.30 <= u < 0.74 else "MAPPING"


# ===========================================================================
# 6 — SECTION  (the whole composition swooshes to the next section)
# ===========================================================================
class SectionFlowScene(FlowScene):
    name = "flow · section"
    CYCLE = 4.2
    PER = 8               # beads per wire

    def __init__(self):
        super().__init__()
        # two lane-like swoops crossing the frame; the travel slides EVERYTHING
        # left by exactly one frame width per cycle, so the next section's copy
        # sweeps in seamlessly from the right
        self.wires = [
            Wire((-0.02, 0.32), (0.36, 0.14), (0.60, 0.46), (1.04, 0.24),
                 f0=0.75, f1=1.3),
            Wire((-0.04, 0.70), (0.30, 0.90), (0.68, 0.54), (1.06, 0.80),
                 f0=1.35, f1=0.65),
        ]

    def draw(self, canvas):
        self._bake_all(canvas, self.wires)
        u = self._u()
        wu = canvas.wu
        # dwell, then one hard expo swoosh left, landing before the loop seam
        sw = _expo(_clamp((u - 0.40) / 0.46, 0.0, 1.0))
        off = -sw * wu
        for copy in (0, 1):                                  # this section + next
            dx = off + copy * wu
            if dx > wu or dx + wu < 0:
                continue
            for wi, w in enumerate(self.wires):
                w.dots(canvas, dx=dx)
                for k in range(self.PER):
                    s = 0.06 + 0.88 * k / (self.PER - 1) \
                        + 0.02 * math.sin(self.t * 0.7 + k + wi * 2.0)
                    x, y, ang, f = w.at(_clamp(s, 0.02, 0.98))
                    _bead(canvas, x + dx, y, ang, 4.6 * f)

    def status(self):
        return "TRAVELLING" if self._u() > 0.40 else "SECTION"


# ===========================================================================
# 7 — CART  (a queue rides the wire; beads land one by one in a packed row)
# ===========================================================================
class CartFlowScene(FlowScene):
    name = "flow · cart"
    CYCLE = 8.0
    N_ITEMS = 6
    ROW_Y = 0.78          # the cart row's height in the frame
    ROW_X0, ROW_X1 = 0.58, 0.94

    def __init__(self):
        super().__init__()
        # the add wire swoops from off-frame upper-left down into the row zone
        self.wire = Wire((0.00, 0.10), (0.58, 0.02), (0.16, 0.62),
                         (self.ROW_X0, self.ROW_Y), f0=0.5, f1=1.3)

    def _slot(self, canvas, k):
        x = (self.ROW_X0 + (self.ROW_X1 - self.ROW_X0)
             * (k + 0.5) / self.N_ITEMS) * canvas.wu
        return x, self.ROW_Y * canvas.hu

    def draw(self, canvas):
        self._bake_all(canvas, [self.wire])
        u = self._u()
        wu = canvas.wu
        self.wire.dots(canvas)
        # the cart shelf: a dotted baseline under the row
        y = self.ROW_Y * canvas.hu + 5.0
        x = self.ROW_X0 * wu - 6
        while x <= self.ROW_X1 * wu + 6:
            canvas.set_dot(x, y)
            x += 2.4
        clear = _expo(_clamp((u - 0.90) / 0.10, 0.0, 1.0))   # checkout swoosh
        land_w = 0.82 / self.N_ITEMS                         # per-item landing slice
        for k in range(self.N_ITEMS):
            t0 = 0.04 + k * land_w
            e = _clamp((u - t0) / land_w, 0.0, 1.0)
            sx, sy = self._slot(canvas, k)
            if e <= 0.0:
                # still queued on the wire behind the landing bead, inching up
                qs = _clamp(0.72 - (k - u / land_w) * 0.13, 0.04, 0.85)
                x, yw, ang, f = self.wire.at(qs)
                _bead(canvas, x, yw, ang, 3.6 * f)
            elif e < 1.0:                                    # riding in to land
                s = 0.85 + 0.15 * _expo(e)
                x, yw, ang, f = self.wire.at(_clamp(s, 0.0, 1.0))
                lx = x + (sx - x) * _smooth(e)
                ly = yw + (sy - yw) * _smooth(e)
                _bead(canvas, lx, ly, 0.0, 4.2 + 2.4 * e)
            else:
                x = sx + clear * (wu * 1.15 - sx)            # swoosh right, out
                if x < wu:
                    _bead(canvas, x, sy, 0.0, 6.6)

    def status(self):
        return "CHECKOUT" if self._u() > 0.90 else "ADDING"


# ===========================================================================
# 8 — EDIT  (a slot lifts out on a dotted arc, resizes, re-seats — or is flung)
# ===========================================================================
class CartEditFlowScene(FlowScene):
    name = "flow · edit"
    CYCLE = 9.0
    N_ITEMS = 7
    ROW_Y = 0.60
    ROW_X0, ROW_X1 = 0.20, 0.80
    ACTS = ((2, "grow"), (4, "shrink"), (5, "remove"))

    def _slot_x(self, wu, k, removed_gone):
        n = self.N_ITEMS - (1 if removed_gone else 0)
        idx = k - (1 if removed_gone and k > self.ACTS[2][0] else 0)
        return (self.ROW_X0 + (self.ROW_X1 - self.ROW_X0)
                * (idx + 0.5) / n) * wu

    def draw(self, canvas):
        u = self._u()
        wu, hu = canvas.wu, canvas.hu
        row_y = self.ROW_Y * hu
        phase = min(2, int(u * 3))
        pu = (u * 3) % 1.0
        act_k, act = self.ACTS[phase]
        removed_gone = (phase == 2 and pu > 0.62)

        sizes = [6.0, 4.8, 5.4, 4.4, 5.8, 5.0, 4.6]
        if phase >= 1:
            sizes[2] = 8.2                                   # grown in phase 0
        if phase >= 2:
            sizes[4] = 3.0                                   # shrunk in phase 1

        # the row shelf
        yb = row_y + 5.5
        x = self.ROW_X0 * wu - 6
        while x <= self.ROW_X1 * wu + 6:
            canvas.set_dot(x, yb)
            x += 2.4
        # the dotted lift arc over the acting slot
        ax = self._slot_x(wu, act_k, removed_gone)
        arc_h = hu * 0.22
        for i in range(15):
            aa = math.pi * i / 14
            canvas.set_dot(ax + 18 * math.cos(aa), row_y - 7 - arc_h * math.sin(aa))

        for k in range(self.N_ITEMS):
            if k == self.ACTS[2][0] and removed_gone:
                continue                                     # deleted
            gap_close = _expo(_clamp((pu - 0.62) / 0.30, 0.0, 1.0)) \
                if phase == 2 else 0.0
            x0 = self._slot_x(wu, k, False)
            x1 = self._slot_x(wu, k, True)
            x = x0 + (x1 - x0) * gap_close
            y = row_y
            size = sizes[k]
            if phase == 0 and k == self.ACTS[2][0] and pu < 0.22:
                # the item removed last loop flies back IN (re-added) — this
                # closes the loop seam: remove ... re-add, a full edit story
                fl = 1.0 - _eout(pu / 0.22)
                x += fl * wu * 0.55
                y -= fl * (arc_h + hu * 0.30)
            if k == act_k:
                if act == "remove":
                    if pu > 0.38:                            # flung up & off right
                        fl = _ein(_clamp((pu - 0.38) / 0.32, 0.0, 1.0))
                        x += fl * wu * 0.55
                        y -= arc_h + fl * hu * 0.30
                        if x > wu or y < -8:
                            continue
                    else:
                        y -= arc_h * _expo(pu / 0.38) + 7
                else:
                    up = _expo(_clamp(pu / 0.32, 0.0, 1.0))
                    dn = _expo(_clamp((pu - 0.64) / 0.32, 0.0, 1.0))
                    y -= (arc_h + 7) * up * (1.0 - dn)
                    mid = _smooth(_clamp((pu - 0.34) / 0.28, 0.0, 1.0))
                    if act == "grow":
                        size = sizes[k] + (8.2 - sizes[k]) * mid
                    else:
                        size = sizes[k] - (sizes[k] - 3.0) * mid
            _bead(canvas, x, y, 0.0, size)

    def status(self):
        return ("RESIZE +", "RESIZE −", "REMOVE")[min(2, int(self._u() * 3))]


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        LoadingFlowScene(),        # 1  loading
        ThinkingFlowScene(),       # 2  thinking
        FetchingFlowScene(),       # 3  fetching
        ComparingFlowScene(),      # 4  comparing
        OverviewFlowScene(),       # 5  overview
        SectionFlowScene(),        # 6  going to another section
        CartFlowScene(),           # 7  adding to cart
        CartEditFlowScene(),       # 8  editing cart
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
