#!/usr/bin/env python3
"""
review_sketches — new sketches from the client's five annotated screenshots,
two options per note.

    #7  "Going to new section … more dynamic like tempo shape?"
        1  section · chevrons   stacked zigzag ribbons (the tempo shape) cascade
                                up and off; the next section's stack sweeps in
        2  section · zoom       the anchor grid: dashed guides + block anchors;
                                travel = an endless fractal zoom into a cell

    #8  "Item to cart — outside to inside, can it have depth"
        3  cart · spiral        a rectangular spiral coils to the centre; items
                                ride it outside -> in, shrinking as they sink,
                                and lock at the core
        4  cart · tunnel        the same spiral as a TUNNEL: concentric rect
                                rings receding in z; the item corkscrews away
                                from the camera into the far core

    #9  "Transaction -> start new session — this is one animation"
        5  tx · knot            a tumbling knot of segmented rings tightens,
                                flattens into a line, types a receipt row,
                                blinks a cursor, clears — one continuous shot
        6  tx · unwind          the rings fling off one by one instead; what
                                remains is the receipt block + blinking cursor

    #10 "Compare items — this one in 3d, arms in all directions"
        7  compare · starburst  a centre block with segmented-rod arms radiating
                                in TRUE 3D; the whole burst tumbles; arms take
                                turns extending + solidifying as 'considered'
        8  compare · satellites fewer arms, each tipped with a block satellite;
                                candidates take turns swinging near + growing

    #11 "Build table — drawing table lines"
        9  table · scribes      dash-train scribes fly in on diagonals and DRAW
                                the measured table rule by rule, leaving dotted
                                ink behind; hold; erase the same way
       10  table · rain         the table's dots rain in on a diagonal as short
                                dashes and snap into the rules; hold; blow away

The vocabulary throughout is the house one: braille dots for wires/guides/ink,
block glyphs for solids, perspective size = depth, ease-in-out-expo motion.
Run standalone: `python review_sketches.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from sketches import _hbar_block, _vbar_block
from spatial_states import Cam, _mark, _expo, _eout, _ein, _smooth, _h
from hatch_grid import _H_YS, _V_XS, _H_X0, _GRID_ASPECT

TAU = 2.0 * math.pi


def _dash_at(canvas, x, y, ang, size):
    """A block dash stretched along `ang` (nearest axis), like the rod renders."""
    if size <= 0.9:
        canvas.set_dot(x, y)
        return
    a = ang % math.pi
    if a < math.pi / 4 or a > 3 * math.pi / 4:
        _hbar_block(canvas, x - size / 2.0, x + size / 2.0, y, max(2.2, size * 0.7))
    else:
        _vbar_block(canvas, x, y - size / 2.0, y + size / 2.0, max(2.2, size * 0.7))


def _dotline(canvas, x0, y0, x1, y1, gap=2.5):
    """A dotted braille line (the guide/ink stroke)."""
    d = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(d / gap))
    for i in range(n + 1):
        e = i / n
        canvas.set_dot(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e)


class Path:
    """A polyline with an arc-length table: at(s) -> (x, y, angle)."""

    def __init__(self, pts):
        self.p = pts
        acc = [0.0]
        for i in range(1, len(pts)):
            acc.append(acc[-1] + math.hypot(pts[i][0] - pts[i - 1][0],
                                            pts[i][1] - pts[i - 1][1]))
        self.acc = acc
        self.length = max(acc[-1], 1e-6)

    def at(self, s):
        target = _clamp(s, 0.0, 1.0) * self.length
        lo, hi = 0, len(self.acc) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if self.acc[mid] < target:
                lo = mid + 1
            else:
                hi = mid
        i = max(1, lo)
        (x0, y0), (x1, y1) = self.p[i - 1], self.p[i]
        seg = self.acc[i] - self.acc[i - 1]
        w = (target - self.acc[i - 1]) / max(seg, 1e-6)
        return (x0 + (x1 - x0) * w, y0 + (y1 - y0) * w,
                math.atan2(y1 - y0, x1 - x0))

    def dots(self, canvas, gap=2.5, s0=0.0, s1=1.0):
        step = gap / self.length
        s = s0
        while s <= s1:
            x, y, _a = self.at(s)
            canvas.set_dot(x, y)
            s += step


class RS(Scene):
    CYCLE = 5.0

    def _u(self):
        return (self.t % self.CYCLE) / self.CYCLE


# ===========================================================================
# #7 option 1 — SECTION · CHEVRONS  (the tempo shape, cascading off)
# ===========================================================================
class ChevronSectionScene(RS):
    name = "section · chevrons"
    CYCLE = 4.6
    N_RIB = 8             # ribbons in the stack
    PERIODS = 2.0         # zigzag periods across the width
    AMP_FRAC = 0.16       # zigzag amplitude as a fraction of hu

    def _ribbon(self, canvas, y0, depth, dy):
        """One zigzag ribbon at baseline y0; depth 0 far .. 1 near."""
        wu = canvas.wu
        amp = canvas.hu * self.AMP_FRAC
        x0, x1 = wu * 0.10, wu * 0.90
        n = 46
        pts = []
        for i in range(n + 1):
            e = i / n
            tri = abs(((e * self.PERIODS) % 1.0) - 0.5) * 2.0   # 0..1..0 zigzag
            pts.append((x0 + (x1 - x0) * e, y0 - amp * tri + dy))
        for i in range(n):
            canvas.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
        # segmented block highlights riding the bends, chunkier when near
        for k in range(int(self.PERIODS * 4)):
            e = (k + 0.5) / (self.PERIODS * 4)
            i = int(e * n)
            x, y = pts[i]
            ang = math.atan2(pts[min(n, i + 1)][1] - y, pts[min(n, i + 1)][0] - x)
            _dash_at(canvas, x, y, ang, (2.2 + 3.4 * depth))

    def draw(self, canvas):
        u = self._u()
        hu = canvas.hu
        top, bot = hu * 0.16, hu * 0.86
        sw = _expo(_clamp((u - 0.40) / 0.50, 0.0, 1.0))       # the travel
        for copy in (0, 1):                                    # this stack + next
            for i in range(self.N_RIB):
                ri = i / (self.N_RIB - 1)
                y0 = top + (bot - top) * ri
                # each ribbon departs slightly after the one above — a cascade
                lag = _clamp((sw * 1.35 - ri * 0.35), 0.0, 1.0)
                dy = -lag * (hu * 1.25) + copy * hu * 1.25
                if -hu * 0.4 < y0 + dy < hu * 1.2:
                    self._ribbon(canvas, y0, 1.0 - ri * 0.75, dy)

    def status(self):
        return "TRAVELLING" if self._u() > 0.40 else "SECTION"


# ===========================================================================
# #7 option 2 — SECTION · ZOOM  (the anchor grid; travel = a fractal dive)
# ===========================================================================
class ZoomSectionScene(RS):
    name = "section · zoom"
    CYCLE = 4.0
    PITCH = 0.62          # base grid pitch, as a fraction of hu

    def draw(self, canvas):
        u = self._u()
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        zoom = 2.0 ** _expo(u)                                # 1 -> 2, seamless
        for level in (-1, 0, 1, 2):                           # fractal grid levels
            pitch = hu * self.PITCH * (2.0 ** level) * zoom
            if pitch < hu * 0.28 or pitch > hu * 3.2:
                continue
            # fade levels in/out by their apparent pitch (dot spacing widens)
            vis = _smooth((pitch / hu - 0.28) / 0.25) \
                * (1.0 - _smooth((pitch / hu - 2.2) / 1.0))
            if vis <= 0.02:
                continue
            gap = 2.4 / max(vis, 0.25)
            nx0 = int(math.floor((0 - cx) / pitch)) - 1
            nx1 = int(math.ceil((wu - cx) / pitch)) + 1
            ny0 = int(math.floor((0 - cy) / pitch)) - 1
            ny1 = int(math.ceil((hu - cy) / pitch)) + 1
            for gx in range(nx0, nx1 + 1):
                x = cx + gx * pitch
                if -4 <= x <= wu + 4:
                    y = 0.0
                    while y <= hu:
                        canvas.set_dot(x, y)
                        y += gap
            for gy in range(ny0, ny1 + 1):
                y = cy + gy * pitch
                if -4 <= y <= hu + 4:
                    x = 0.0
                    while x <= wu:
                        canvas.set_dot(x, y)
                        x += gap
            # block anchors at the intersections, sized by the level's presence
            for gx in range(nx0, nx1 + 1):
                for gy in range(ny0, ny1 + 1):
                    x, y = cx + gx * pitch, cy + gy * pitch
                    if -8 <= x <= wu + 8 and -8 <= y <= hu + 8:
                        _dash_at(canvas, x, y, 0.0, 5.2 * vis)

    def status(self):
        return "DIVING"


# ===========================================================================
# #8 option 1 — CART · SPIRAL  (outside -> inside; items sink to the core)
# ===========================================================================
class SpiralCartScene(RS):
    name = "cart · spiral"
    CYCLE = 6.5
    TURNS = 4
    N_ITEMS = 3

    def __init__(self):
        super().__init__()
        self._key = None
        self.path = None

    def _build(self, canvas):
        if self._key == (canvas.wu, canvas.hu):
            return
        self._key = (canvas.wu, canvas.hu)
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        w = min(wu, hu * _GRID_ASPECT) * 0.44                 # outer half-width
        h = w * 0.62
        pts = []
        x, y = cx - w, cy - h
        dirs = ((1, 0), (0, 1), (-1, 0), (0, -1))             # cw rect spiral
        lx, ly = 2 * w, 2 * h
        di = 0
        shrink_x = 2 * w / (self.TURNS * 2 + 1)
        shrink_y = 2 * h / (self.TURNS * 2 + 1)
        pts.append((x, y))
        for k in range(self.TURNS * 4):
            dx, dy = dirs[di % 4]
            step_x = lx if dx else 0
            step_y = ly if dy else 0
            x += dx * step_x
            y += dy * step_y
            pts.append((x, y))
            if di % 2 == 1:
                lx -= shrink_x
            else:
                ly -= shrink_y
            di += 1
        self.path = Path(pts)
        self.core = (cx + shrink_x * 0.2, cy + shrink_y * 0.2)

    def draw(self, canvas):
        self._build(canvas)
        u = self._u()
        self.path.dots(canvas, gap=2.6)
        cxx, cyy = self.core
        pulse = 0.0
        for k in range(self.N_ITEMS):
            e = _clamp((u * 1.15 - k * 0.30), 0.0, 1.0)
            s = _expo(e)
            if s >= 0.995:
                dt_ = (u * 1.15 - k * 0.30 - 1.0)
                if 0.0 < dt_ < 0.2:                            # just locked: pulse
                    pulse = max(pulse, 1.0 - dt_ / 0.2)
                continue
            if s <= 0.0:
                continue
            x, y, ang = self.path.at(s)
            _dash_at(canvas, x, y, ang, 7.0 - 4.2 * s)         # sinks as it coils in
        _dash_at(canvas, cxx, cyy, 0.0, 4.2 + 2.6 * pulse)     # the cart core
        if pulse > 0.0:                                        # lock flash ring
            rr = 8.0 + 14.0 * _eout(1.0 - pulse)
            n = 18
            for k in range(n):
                a = TAU * k / n
                canvas.set_dot(cxx + rr * math.cos(a), cyy + rr * 0.6 * math.sin(a))

    def status(self):
        return "IN CART" if self._u() > 0.9 else "ADDING"


# ===========================================================================
# #8 option 2 — CART · TUNNEL  (the spiral with real depth: rings recede)
# ===========================================================================
class TunnelCartScene(RS):
    name = "cart · tunnel"
    CYCLE = 5.5
    N_RINGS = 7
    Z0, DZ = 1.0, 0.85
    W, H = 1.5, 0.95      # ring half extents (world units)

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.16 * math.sin(t * 0.4), 0.10 * math.sin(t * 0.27), 0.0))
        # the receding rect rings — outside (near) to inside (far)
        for k in range(self.N_RINGS):
            z = self.Z0 + k * self.DZ
            sh = 1.0 - 0.06 * k                                # gently tapering
            w, h = self.W * sh, self.H * sh
            cs = [(-w, -h, z), (w, -h, z), (w, h, z), (-w, h, z)]
            for i in range(4):
                ax, ay, az = cs[i]
                bx, by, bz = cs[(i + 1) % 4]
                for kk in range(15):
                    e = kk / 14.0
                    p = cam.project(ax + (bx - ax) * e, ay + (by - ay) * e, az)
                    if p and kk % 2 == 0:
                        canvas.set_dot(p[0], p[1])
        # the item corkscrews around the rings, away from the camera
        for it in range(2):
            s = (u + it * 0.5) % 1.0
            e = _expo(s)
            ang = e * self.TURNS_ANG + it * 2.4
            z = self.Z0 + e * (self.N_RINGS - 1) * self.DZ
            sh = 1.0 - 0.06 * (e * (self.N_RINGS - 1))
            # ride the rect perimeter: parametrised by angle, clamped to the rect
            ca, sa = math.cos(ang), math.sin(ang)
            m = max(abs(ca) / (self.W * sh), abs(sa) / (self.H * sh))
            x, y = ca / m, sa / m
            p = cam.project(x, y, z)
            if p:
                _mark(canvas, p, (0.075 - 0.030 * e) * p[2])
        # the core: a small far block that pulses when an item arrives
        arr = max(0.0, math.sin(math.pi * ((u * 2.0) % 1.0))) ** 6
        p = cam.project(0.0, 0.0, self.Z0 + (self.N_RINGS - 0.4) * self.DZ)
        if p:
            _mark(canvas, p, (0.13 + 0.06 * arr) * p[2])

    TURNS_ANG = TAU * 2.6

    def status(self):
        return "ADDING"


# ===========================================================================
# #9 option 1 — TX · KNOT  (rings -> a line -> a receipt -> /clear; one shot)
# ===========================================================================
class KnotTxScene(RS):
    name = "tx · knot"
    CYCLE = 8.0
    N_RINGS = 3
    R = 1.05

    def _ring(self, canvas, cam, yaw, pitch, rr, dashes, dash_size):
        cy_, sy_ = math.cos(yaw), math.sin(yaw)
        cp_, sp_ = math.cos(pitch), math.sin(pitch)
        n = 44
        prev = None
        for i in range(n + 1):
            a = TAU * i / n
            x, y, z = math.cos(a) * rr, math.sin(a) * rr, 0.0
            x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
            y, z = y * cp_ - z * sp_, y * sp_ + z * cp_
            p = cam.project(x, y, z + 3.0)
            cur = (p[0], p[1]) if p else None
            if cur and prev and i % 3 == 0:
                canvas.set_dot(cur[0], cur[1])
            prev = cur
        for k in range(dashes):                                # the segmented tube
            a = TAU * k / dashes + yaw * 0.5
            x, y, z = math.cos(a) * rr, math.sin(a) * rr, 0.0
            x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
            y, z = y * cp_ - z * sp_, y * sp_ + z * cp_
            p = cam.project(x, y, z + 3.0)
            if p:
                ang = a + math.pi / 2
                _dash_at(canvas, p[0], p[1], ang, dash_size * p[2])

    def draw(self, canvas):
        u = self._u()
        t = self.t
        wu, hu = canvas.wu, canvas.hu
        cam = Cam(canvas, (0.0, 0.0, 0.0))
        cx, cy = wu / 2.0, hu / 2.0

        if u < 0.42:                                           # the knot, working
            spin = t * (0.7 + 1.6 * _smooth(u / 0.42))         # tightening up
            for j in range(self.N_RINGS):
                rr = self.R * (0.78 + 0.14 * j)                # nested, legible
                self._ring(canvas, cam, spin * (0.6 + 0.2 * j) + j * 1.3,
                           spin * 0.45 + j * 0.8, rr, 7, 0.045)
        elif u < 0.56:                                         # flatten to a line
            e = _expo((u - 0.42) / 0.14)
            for j in range(self.N_RINGS):
                rr = self.R * (0.78 + 0.14 * j) * (1.0 - 0.25 * e)
                self._ring(canvas, cam, (1.0 - e) * (t * 0.8 + j * 1.3),
                           (1.0 - e) * (t * 0.45 + j * 0.8),
                           rr, 7, 0.045 * (1.0 - 0.5 * e))
        elif u < 0.60:                                         # the flash line
            w = wu * 0.30
            _hbar_block(canvas, cx - w, cx + w, cy, 3.0)
        elif u < 0.88:                                         # type the receipt
            e = (u - 0.60) / 0.28
            n_typed = int(e * 9)
            for k in range(min(9, n_typed + 1)):
                bx = cx - wu * 0.16 + k * (wu * 0.04)
                _dash_at(canvas, bx, cy, 0.0, 4.6 if k < 7 else 3.2)
            if ((t * 2.5) % 1.0) < 0.5:                        # the cursor blinks
                _dash_at(canvas, cx - wu * 0.16 + min(9, n_typed + 1) * (wu * 0.04),
                         cy, 0.0, 4.0)
        else:                                                  # /clear -> empty
            e = _expo((u - 0.88) / 0.12)
            if e < 0.85:
                for k in range(9):
                    bx = cx - wu * 0.16 + k * (wu * 0.04)
                    if (k / 9.0) > e * 1.15:                   # wiped left -> right
                        _dash_at(canvas, bx, cy, 0.0, 4.6 if k < 7 else 3.2)

    def status(self):
        u = self._u()
        if u < 0.56:
            return "TRANSACTING"
        if u < 0.88:
            return "PURCHASED"
        return "/CLEAR"


# ===========================================================================
# #9 option 2 — TX · UNWIND  (the rings fling off; a cursor blinks; clear)
# ===========================================================================
class UnwindTxScene(KnotTxScene):
    name = "tx · unwind"
    CYCLE = 7.0

    def draw(self, canvas):
        u = self._u()
        t = self.t
        wu, hu = canvas.wu, canvas.hu
        cam = Cam(canvas, (0.0, 0.0, 0.0))
        cx, cy = wu / 2.0, hu / 2.0

        if u < 0.66:                                           # rings peel away
            for j in range(self.N_RINGS):
                gone = _ein(_clamp((u - 0.18 - j * 0.11) / 0.16, 0.0, 1.0))
                if gone >= 1.0:
                    continue
                rr = self.R * (1.0 + gone * 4.0)               # flies past the eye
                self._ring(canvas, cam, t * (0.7 + 0.2 * j) + j * 1.3,
                           t * 0.45 + j * 0.8, rr, 9, 0.045 * (1.0 - gone))
        if u >= 0.60:                                          # the new session
            e = _smooth((u - 0.60) / 0.10)
            _dash_at(canvas, cx - wu * 0.18, cy - hu * 0.10, 0.0, 5.2 * e)
            if ((t * 2.5) % 1.0) < 0.5 and u < 0.94:
                _dash_at(canvas, cx - wu * 0.18 + 10, cy - hu * 0.10, 0.0, 3.6 * e)

    def status(self):
        return "TRANSACTING" if self._u() < 0.6 else "NEW SESSION"


# ===========================================================================
# #10 option 1 — COMPARE · STARBURST  (segmented arms in all 3D directions)
# ===========================================================================
def _fib_dirs(n):
    """n directions spread over the sphere (fibonacci)."""
    out = []
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        y = 1.0 - 2.0 * (i + 0.5) / n
        r = math.sqrt(max(0.0, 1.0 - y * y))
        a = ga * i
        out.append((math.cos(a) * r, y, math.sin(a) * r))
    return out


class StarburstCompareScene(RS):
    name = "compare · starburst"
    CYCLE = 7.0
    N_ARMS = 14
    R0, R1 = 0.22, 1.55

    def __init__(self):
        super().__init__()
        self.dirs = _fib_dirs(self.N_ARMS)

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, 0.0))
        ya, pa = t * 0.20, t * 0.12                            # the slow tumble
        cy_, sy_ = math.cos(ya), math.sin(ya)
        cp_, sp_ = math.cos(pa), math.sin(pa)
        hot = int(u * self.N_ARMS) % self.N_ARMS               # the arm in review
        hu_ = (u * self.N_ARMS) % 1.0
        flare = math.sin(math.pi * _clamp(hu_, 0.0, 1.0))
        for ai, (dx, dy, dz) in enumerate(self.dirs):
            x, z = dx * cy_ + dz * sy_, -dx * sy_ + dz * cy_
            y, z2 = dy * cp_ - z * sp_, dy * sp_ + z * cp_
            ext = 1.0 + (0.16 * flare if ai == hot else 0.0)   # extends when hot
            # the dotted ray
            for kk in range(12):
                e = kk / 11.0
                r = (self.R0 + (self.R1 - self.R0) * e) * ext
                p = cam.project(x * r, y * r, z2 * r + 3.2)
                if p:
                    canvas.set_dot(p[0], p[1])
            # the segmented rod dashes, chunkier while in review
            for rr in (0.45, 0.75, 1.05, 1.35):
                r = rr * ext
                p = cam.project(x * r, y * r, z2 * r + 3.2)
                if p:
                    ang = math.atan2(-(y), x) if abs(x) + abs(y) > 0.1 else 0.0
                    boost = 1.8 if ai == hot else 1.0
                    _mark(canvas, p, 0.045 * boost * p[2])
        p = cam.project(0.0, 0.0, 3.2)                         # the centre block
        if p:
            _mark(canvas, p, 0.110 * p[2])

    def status(self):
        return "COMPARING"


# ===========================================================================
# #10 option 2 — COMPARE · SATELLITES  (block candidates at the arm tips)
# ===========================================================================
class SatellitesCompareScene(RS):
    name = "compare · satellites"
    CYCLE = 8.0
    N = 6
    R = 1.45

    def __init__(self):
        super().__init__()
        self.dirs = _fib_dirs(self.N)

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, 0.0))
        ya, pa = t * 0.16, t * 0.10
        cy_, sy_ = math.cos(ya), math.sin(ya)
        cp_, sp_ = math.cos(pa), math.sin(pa)
        hot = int(u * self.N) % self.N
        hu_ = (u * self.N) % 1.0
        exam = math.sin(math.pi * hu_)                         # the review pulse
        for ai, (dx, dy, dz) in enumerate(self.dirs):
            x, z = dx * cy_ + dz * sy_, -dx * sy_ + dz * cy_
            y, z2 = dy * cp_ - z * sp_, dy * sp_ + z * cp_
            bob = 1.0 + 0.05 * math.sin(t * 0.9 + ai * 1.7)
            r1 = self.R * bob
            # the arm: denser dotted when its satellite is in review
            steps = 14 if ai == hot else 9
            for kk in range(steps):
                e = 0.16 + 0.84 * kk / (steps - 1)
                p = cam.project(x * r1 * e, y * r1 * e, z2 * r1 * e + 3.0)
                if p:
                    canvas.set_dot(p[0], p[1])
            # the satellite block — swells while considered
            p = cam.project(x * r1, y * r1, z2 * r1 + 3.0)
            if p:
                grow = 1.0 + (0.9 * exam if ai == hot else 0.0)
                _mark(canvas, p, 0.055 * grow * p[2])
        p = cam.project(0.0, 0.0, 3.0)
        if p:
            _mark(canvas, p, 0.075 * p[2])

    def status(self):
        return "COMPARING"


# ===========================================================================
# #11 option 1 — TABLE · SCRIBES  (dash-trains draw the rules, ink trailing)
# ===========================================================================
class ScribeTableScene(RS):
    name = "table · scribes"
    CYCLE = 7.0
    W_FRAC = 0.86

    def _geo(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        W = wu * self.W_FRAC
        H = W / _GRID_ASPECT
        x0, y0 = (wu - W) / 2.0, (hu - H) / 2.0
        rules = []
        for gy in _H_YS:                                       # rows, top -> bottom
            rules.append((x0 + _H_X0 * W, y0 + gy * H, x0 + W, y0 + gy * H))
        for gx in _V_XS:                                       # columns, l -> r
            rules.append((x0 + gx * W, y0, x0 + gx * W, y0 + H))
        return rules

    def draw(self, canvas):
        u = self._u()
        rules = self._geo(canvas)
        n = len(rules)
        draw_end, hold_end = 0.62, 0.80
        for i, (ax, ay, bx, by) in enumerate(rules):
            t0 = 0.03 + (draw_end - 0.10) * i / n              # staggered starts
            e = _clamp((u - t0) / 0.11, 0.0, 1.0)
            head = _smooth(e)
            erase = _expo(_clamp((u - hold_end - 0.02 * i / n) / 0.16, 0.0, 1.0))
            if erase >= 1.0:
                continue
            tail = erase                                        # the ink un-draws
            if head <= tail:
                continue
            # the ink: dots from tail..head along the rule
            length = math.hypot(bx - ax, by - ay)
            steps = max(2, int(length / 2.5))
            for k in range(steps + 1):
                s = k / steps
                if tail <= s <= head:
                    canvas.set_dot(ax + (bx - ax) * s, ay + (by - ay) * s)
            # the scribe itself: a dash-train at the head, flying its diagonal in
            if 0.0 < e < 1.0:
                hx, hy = ax + (bx - ax) * head, ay + (by - ay) * head
                ang = math.atan2(by - ay, bx - ax)
                for j in range(3):                             # the little train
                    lag = j * 4.5
                    _dash_at(canvas, hx - math.cos(ang) * lag,
                             hy - math.sin(ang) * lag, ang, 4.6 - j * 1.1)

    def status(self):
        u = self._u()
        return "DRAWN" if 0.62 < u <= 0.80 else "DRAWING" if u <= 0.62 else "CLEARING"


# ===========================================================================
# #11 option 2 — TABLE · RAIN  (dashes rain in diagonally and snap into rules)
# ===========================================================================
class RainTableScene(RS):
    name = "table · rain"
    CYCLE = 6.5
    W_FRAC = 0.86
    GAP = 3.2             # dot spacing along the rules

    def __init__(self):
        super().__init__()
        self._key = None

    def _build(self, canvas):
        if self._key == (canvas.wu, canvas.hu):
            return
        self._key = (canvas.wu, canvas.hu)
        wu, hu = canvas.wu, canvas.hu
        W = wu * self.W_FRAC
        H = W / _GRID_ASPECT
        x0, y0 = (wu - W) / 2.0, (hu - H) / 2.0
        slots = []
        lines = [((x0 + _H_X0 * W, y0 + gy * H), (x0 + W, y0 + gy * H))
                 for gy in _H_YS]
        lines += [((x0 + gx * W, y0), (x0 + gx * W, y0 + H)) for gx in _V_XS]
        for (ax, ay), (bx, by) in lines:
            d = math.hypot(bx - ax, by - ay)
            nn = max(2, int(d / self.GAP))
            for k in range(nn + 1):
                e = k / nn
                slots.append((ax + (bx - ax) * e, ay + (by - ay) * e))
        self.slots = slots

    def draw(self, canvas):
        self._build(canvas)
        u = self._u()
        wu, hu = canvas.wu, canvas.hu
        D = math.hypot(wu, hu) * 0.30                          # the rain distance
        for i, (tx, ty) in enumerate(self.slots):
            # build wave sweeps down the diagonal; each dot flies in on it
            key = (tx / wu + ty / hu) * 0.5
            e = _expo(_clamp((u * 2.4 - key * 0.9 - _h(i) * 0.12), 0.0, 1.0))
            blow = _expo(_clamp((u - 0.82 - key * 0.10) / 0.12, 0.0, 1.0))
            if blow >= 1.0:
                continue
            if e <= 0.0:
                continue
            if blow > 0.0:                                     # blown off, same diag
                x = tx + blow * D * 0.8
                y = ty - blow * D * 0.8 * (hu / wu)
                _dash_at(canvas, x, y, -0.6, 2.0)
                continue
            if e >= 1.0:
                canvas.set_dot(tx, ty)                         # settled ink
                continue
            x = tx - (1.0 - e) * D                             # inbound, upper-left
            y = ty - (1.0 - e) * D * (hu / wu)
            _dash_at(canvas, x, y, 0.7, 1.4 + 1.2 * (1.0 - e))

    def status(self):
        u = self._u()
        return "BUILT" if 0.55 < u <= 0.82 else "RAINING" if u <= 0.55 else "CLEARING"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        ChevronSectionScene(),       # 1  #7  section, tempo-shape chevrons
        ZoomSectionScene(),          # 2  #7  section, anchor-grid fractal zoom
        SpiralCartScene(),           # 3  #8  cart, flat spiral outside->in
        TunnelCartScene(),           # 4  #8  cart, spiral with true depth
        KnotTxScene(),               # 5  #9  transaction -> receipt -> /clear
        UnwindTxScene(),             # 6  #9  transaction, rings fling off
        StarburstCompareScene(),     # 7  #10 compare, 3D segmented starburst
        SatellitesCompareScene(),    # 8  #10 compare, block satellites
        ScribeTableScene(),          # 9  #11 table drawn by scribes
        RainTableScene(),            # 10 #11 table assembled from dash rain
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
