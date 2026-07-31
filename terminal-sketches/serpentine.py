#!/usr/bin/env python3
"""
serpentine — section-transition scenes built on the double serpentine coil.

The reference shape: two mirrored banks of serpentine tubing. Each layer is a
chevron (a V in plan, apex toward the viewer), layers stack vertically and
hairpin U-bends alternate between the outer and inner ends — one continuous
pipe. Flow enters at the bottom of the right bank, climbs the hairpins,
crosses the middle gap along the top ridge, and descends the left bank:

        down the left  <——  ridge  ——<  up the right
              bank                          bank

The whole pipe is built once as an arc-length-parametrized 3D path, so every
scene is just a different way of moving along or revealing the same shape.
Sequential stages of "travelling to a new section":

    1  serp · build     layers fly up from the deep and stack bottom-first;
                        hairpins sweep closed; the ridge links the banks last
    2  serp · trace     the route draws itself end to end — crawls the first
                        bank, whips the ridge at expo-mid, eases into arrival
    3  serp · flow      steady state: a packet train circulates the circuit,
                        flaring each hairpin as it snaps through
    4  serp · crossing  the handoff: one bright pulse carries you bank to
                        bank while the camera dollies with it; the old bank
                        thins to dots, the new one solidifies (ping-pongs)
    5  serp · ride      chase-cam POV along the pipe itself — dive in from a
                        wide shot, surge chapter by chapter, lift back out
    6  serp · idle      arrival hold: a slow hero orbit, layers breathing,
                        one quiet bead still circulating

House ease-in-out-expo everywhere, seamless loops, painter's-order depth:
far -> sparse braille dots, mid -> a braille line, near -> a double-stroked
tube. Run standalone: `python serpentine.py` (60fps explorer; flags fall
through to mpp).
"""

import math
import sys

from mpp import Scene, _clamp

TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------
def _expo(x):
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
# The coil. World: x right, y up, z away from the camera.
# ---------------------------------------------------------------------------
K = 8                      # layers per bank
DY = 0.34                  # vertical layer spacing
Y_TOP = 1.16               # top layer height (stack is centred near y=0)
ZC = 4.60                  # structure centre depth
ZF = ZC - 1.35             # apex depth (front, toward the viewer)
ZB = ZC + 1.05             # leg-end depth (back)
APX, INX, OUX = 1.55, 0.62, 2.85   # |x| of apex / inner end / outer end
C_PT = (0.0, Y_TOP, ZC + 2.05)     # the ridge peak where the banks meet
STEP = 0.11                # path resample step (world units)
BULGE = DY * 0.62          # hairpin horizontal bulge


def _anchors(side, m):
    """(inner, apex, outer) anchor points of layer m (0 = top). side=+-1."""
    y = Y_TOP - m * DY
    return ((side * INX, y, ZB), (side * APX, y, ZF), (side * OUX, y, ZB))


def _bend_pts(e0, e1, apex):
    """A hairpin U-bend from e0 to e1 (same x/z, one layer apart), bulging
    horizontally outward along the leg direction, away from the apex."""
    mx, my, mz = e0[0], (e0[1] + e1[1]) / 2.0, e0[2]
    vy = (e1[1] - e0[1]) / 2.0                    # signed vertical radius
    dx, dz = e0[0] - apex[0], e0[2] - apex[2]
    dl = math.hypot(dx, dz) or 1.0
    dx, dz = dx / dl, dz / dl
    n = 7
    return [(mx + BULGE * math.sin(math.pi * j / n) * dx,
             my - vy * math.cos(math.pi * j / n),
             mz + BULGE * math.sin(math.pi * j / n) * dz)
            for j in range(n + 1)]


def _chunks():
    """The whole pipe in flow order as (key, control-polyline) chunks."""
    ch = []
    # right bank: bottom -> top, serpentine (parity picks the traversal)
    for m in range(K - 1, -1, -1):
        inn, apx, out = _anchors(+1, m)
        if m == 0:
            poly = [out, apx]                     # inner leg becomes the ridge
        elif m % 2 == 1:
            poly = [inn, apx, out]
        else:
            poly = [out, apx, inn]
        ch.append((("R", m), poly))
        if m > 0:                                 # hairpin up to the next layer
            e0 = poly[-1]
            ch.append((("RB", m), _bend_pts(e0, (e0[0], e0[1] + DY, e0[2]), apx)))
    # the ridge: both top inner legs extended to a shared peak
    ar = _anchors(+1, 0)[1]
    al = _anchors(-1, 0)[1]
    ch.append((("BR", 0), [ar, C_PT, al]))
    # left bank: top -> bottom, mirrored serpentine
    for m in range(K):
        inn, apx, out = _anchors(-1, m)
        if m == 0:
            poly = [apx, out]
        elif m % 2 == 1:
            poly = [out, apx, inn]
        else:
            poly = [inn, apx, out]
        ch.append((("L", m), poly))
        if m < K - 1:                             # hairpin down a layer
            e0 = poly[-1]
            ch.append((("LB", m), _bend_pts(e0, (e0[0], e0[1] - DY, e0[2]), apx)))
    return ch


def _build():
    """Resample the flow-order chunks at a fixed step -> (points, ranges)."""
    pts, ranges = [], {}
    carry, tail, last_key = 0.0, None, None
    for key, poly in _chunks():
        i0 = len(pts)
        for a, b in zip(poly, poly[1:]):
            seg = math.dist(a, b)
            if seg < 1e-9:
                continue
            while carry < seg:
                f = carry / seg
                pts.append((a[0] + (b[0] - a[0]) * f,
                            a[1] + (b[1] - a[1]) * f,
                            a[2] + (b[2] - a[2]) * f))
                carry += STEP
            carry -= seg
        tail, last_key = poly[-1], key
        ranges[key] = (i0, len(pts))
    pts.append(tail)                              # close the very end
    ranges[last_key] = (ranges[last_key][0], len(pts))
    return pts, ranges


PTS, RANGES = _build()
N = len(PTS)
BR0, BR1 = RANGES[("BR", 0)]                      # the ridge's sample range
BEND_MID = {k: (v[0] + v[1]) / (2.0 * N)
            for k, v in RANGES.items() if k[0] in ("RB", "LB")}


def _ppos(s):
    """World point at path fraction s (wraps)."""
    f = (s % 1.0) * (N - 1)
    i = int(f)
    r = f - i
    ax, ay, az = PTS[i]
    bx, by, bz = PTS[min(i + 1, N - 1)]
    return (ax + (bx - ax) * r, ay + (by - ay) * r, az + (bz - az) * r)


# ---------------------------------------------------------------------------
# Camera and the tube stroke — every scene draws through these two.
# ---------------------------------------------------------------------------
class Cam:
    """Pinhole at pos, yawed about Y then pitched about X. Negative pitch
    looks down. project() -> (sx, sy, f) or None; f is nearness."""

    def __init__(self, canvas, pos=(0.0, 0.0, 0.0), yaw=0.0, pitch=0.0, fov=1.08):
        self.px, self.py, self.pz = pos
        self.cyw, self.syw = math.cos(yaw), math.sin(yaw)
        self.cp, self.sp = math.cos(pitch), math.sin(pitch)
        self.F = min(canvas.wu, canvas.hu) * fov
        self.cx, self.cy = canvas.wu / 2.0, canvas.hu / 2.0

    def project(self, x, y, z):
        rx, ry, rz = x - self.px, y - self.py, z - self.pz
        rx, rz = rx * self.cyw - rz * self.syw, rx * self.syw + rz * self.cyw
        ry, rz = ry * self.cp - rz * self.sp, ry * self.sp + rz * self.cp
        if rz < 0.2:
            return None
        f = self.F / rz
        return self.cx + rx * f, self.cy - ry * f, f


def _tube(canvas, cam, i0, i1, w, oy=0.0, oz=0.0, ox=0.0):
    """Stroke path samples [i0, i1). Weight w times nearness f picks the
    glyph class: sparse dots -> dots -> braille line -> double-stroked tube."""
    prev = None
    for i in range(max(0, i0), min(N, i1)):
        x, y, z = PTS[i]
        p = cam.project(x + ox, y + oy, z + oz)
        if p is None or p[2] > 70.0:              # culled or unusably close
            prev = None
            continue
        lvl = w * p[2]
        if lvl < 1.6:
            pass
        elif lvl < 4.0:
            if i % 3 == 0:
                canvas.set_dot(p[0], p[1])
        elif lvl < 9.0:
            if i % 2 == 0:
                canvas.set_dot(p[0], p[1])
        elif lvl < 24.0:
            if prev:
                canvas.line(prev[0], prev[1], p[0], p[1])
        else:
            if prev:
                dx, dy = p[0] - prev[0], p[1] - prev[1]
                d = math.hypot(dx, dy) or 1.0
                nx, ny = -dy / d * 0.55, dx / d * 0.55
                canvas.line(prev[0] + nx, prev[1] + ny, p[0] + nx, p[1] + ny)
                canvas.line(prev[0] - nx, prev[1] - ny, p[0] - nx, p[1] - ny)
        prev = p


def _bead(canvas, p, k=1.0):
    if p:
        canvas.square_fill(p[0], p[1], max(1.6, p[2] * 0.08) * k)


def _ring(canvas, cam, c, r, n=44):
    """A dotted horizontal shockwave ring around world point c."""
    for k in range(0, n, 2):
        a = TAU * k / n
        p = cam.project(c[0] + r * math.cos(a), c[1], c[2] + r * math.sin(a))
        if p:
            canvas.set_dot(p[0], p[1])


class SerpScene(Scene):
    CYCLE = 6.0

    def _u(self):
        return (self.t % self.CYCLE) / self.CYCLE


# ===========================================================================
# 1 — BUILD  (layers stack bottom-first; hairpins close; the ridge links)
# ===========================================================================
class SerpBuildScene(SerpScene):
    name = "serp · build"
    CYCLE = 8.0
    T0, GAP, W = 0.03, 0.062, 0.17                # layer stagger timing

    def _land(self, m):
        return self.T0 + (K - 1 - m) * self.GAP   # bottom layers land first

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas,
                  (0.0, 1.35, -0.25 + 0.45 * _smooth((u - 0.66) / 0.30)),
                  yaw=0.05 * math.sin(t * 0.3), pitch=-0.26)
        drop = _ein(_clamp((u - 0.93) / 0.07, 0.0, 1.0))   # the exit fall
        # ghost blueprint: the whole route as faint dots, always present
        for i in range(0, N, 5):
            p = cam.project(*PTS[i])
            if p:
                canvas.set_dot(p[0], p[1])
        for bank in ("R", "L"):
            for m in range(K):
                e = _expo(_clamp((u - self._land(m)) / self.W, 0.0, 1.0))
                if e <= 0.0:
                    continue
                i0, i1 = RANGES[(bank, m)]
                w = (0.30 + 0.45 * e + 0.05 * math.sin(t * 1.1 + m)) * (1 - drop)
                _tube(canvas, cam, i0, i1, w,
                      oy=-2.4 * (1 - e) - 3.6 * drop, oz=2.2 * (1 - e))
            for m in range(K):                     # hairpins sweep shut
                key = (bank + "B", m)
                if key not in RANGES:
                    continue
                upper = m - 1 if bank == "R" else m
                eb = _eout(_clamp((u - self._land(upper) - self.W) / 0.10, 0, 1))
                if eb <= 0.0 or drop >= 1.0:
                    continue
                i0, i1 = RANGES[key]
                _tube(canvas, cam, i0, i0 + int((i1 - i0) * eb),
                      0.75 * (1 - drop), oy=-3.6 * drop)
        # the ridge draws across last, right to left, and flashes at the peak
        eb = _expo(_clamp((u - 0.66) / 0.14, 0.0, 1.0))
        if eb > 0.0:
            _tube(canvas, cam, BR0, BR0 + int((BR1 - BR0) * eb),
                  0.85 * (1 - drop), oy=-3.6 * drop)
        if eb >= 1.0 and drop <= 0.0:
            q = _clamp((u - 0.80) / 0.12, 0.0, 1.0)
            if q < 1.0:
                _ring(canvas, cam, C_PT, 0.2 + _eout(q) * 1.8)
                _bead(canvas, cam.project(*C_PT), 1.0 - 0.5 * q)

    def status(self):
        u = self._u()
        return "STACKING" if u < 0.66 else "LINKING" if u < 0.80 else "LINKED"


# ===========================================================================
# 2 — TRACE  (the route draws end to end, whipping the ridge at expo-mid)
# ===========================================================================
class SerpTraceScene(SerpScene):
    name = "serp · trace"
    CYCLE = 7.0

    def draw(self, canvas):
        u = self._u()
        t = self.t
        s = _expo(_clamp((u - 0.04) / 0.80, 0.0, 1.0))
        fade = 1.0 - _ein(_clamp((u - 0.94) / 0.06, 0.0, 1.0))
        hx, hy, hz = _ppos(s * 0.999)
        cam = Cam(canvas,
                  (hx * 0.32, 1.25 + 0.08 * math.sin(t * 0.5),
                   -0.35 + 0.50 * _smooth(s)),
                  yaw=hx * 0.03, pitch=-0.24)
        for i in range(0, N, 4):                   # the faint planned route
            p = cam.project(*PTS[i])
            if p:
                canvas.set_dot(p[0], p[1])
        head = int(s * N)
        breathe = 0.06 * math.sin(t * 1.3) if s >= 1.0 else 0.0
        _tube(canvas, cam, 0, head, (0.80 + breathe) * fade)   # the inked route
        if 0.0 < s < 1.0 and fade > 0.0:
            _tube(canvas, cam, head - 18, head, 1.35 * fade)   # hot tip
            _bead(canvas, cam.project(hx, hy, hz), fade)
            for k in (0.010, 0.022, 0.036):        # scout dots ahead
                p = cam.project(*_ppos(min(0.999, s + k)))
                if p:
                    canvas.set_dot(p[0], p[1])
        if u > 0.84:                               # arrival ring at the exit
            q = _clamp((u - 0.84) / 0.12, 0.0, 1.0)
            _ring(canvas, cam, PTS[N - 1], 0.15 + _eout(q) * 1.4)

    def status(self):
        return "ROUTED" if self._u() > 0.84 else "TRACING"


# ===========================================================================
# 3 — FLOW  (a packet train circulates; hairpins flare as packets snap through)
# ===========================================================================
class SerpFlowScene(SerpScene):
    name = "serp · flow"
    CYCLE = 6.0
    N_PKT = 7

    def draw(self, canvas):
        u = self._u()
        t = self.t
        yaw = 0.16 * math.sin(t * 0.13)            # slow true orbit
        r0 = 4.8
        cam = Cam(canvas, (r0 * math.sin(yaw), 1.30, ZC - r0 * math.cos(yaw)),
                  yaw=yaw, pitch=-0.26)
        _tube(canvas, cam, 0, N, 0.50 + 0.05 * math.sin(t * 0.8))
        ss = [(u + i / self.N_PKT) % 1.0 for i in range(self.N_PKT)]
        for s in ss:                               # the train: bead + comet tail
            head = int(s * (N - 1))
            _tube(canvas, cam, head - 12, head, 1.35)
            _bead(canvas, cam.project(*_ppos(s)))
        for key, mid in BEND_MID.items():          # hairpin flare on pass
            d = min(min(abs(mid - s), 1.0 - abs(mid - s)) for s in ss)
            glow = _clamp(1.0 - d / 0.025, 0.0, 1.0)
            if glow > 0.0:
                i0, i1 = RANGES[key]
                _tube(canvas, cam, i0, i1, 0.9 + 0.5 * glow)

    def status(self):
        return "FLOWING"


# ===========================================================================
# 4 — CROSSING  (the handoff pulse; the camera dollies bank to bank)
# ===========================================================================
class SerpCrossScene(SerpScene):
    name = "serp · crossing"
    CYCLE = 7.5

    def draw(self, canvas):
        u = self._u()
        t = self.t
        fwd = int(self.t / self.CYCLE) % 2 == 0    # ping-pong per cycle
        pr = _expo(_clamp((u - 0.14) / 0.58, 0.0, 1.0))
        s_p = pr if fwd else 1.0 - pr
        leave = _smooth(_clamp((pr - 0.42) / 0.33, 0.0, 1.0))
        arrive = _smooth(_clamp((pr - 0.52) / 0.36, 0.0, 1.0))
        w_src = 0.85 - 0.60 * leave
        w_dst = 0.25 + 0.65 * arrive
        # camera dolly: framed on the old bank, arcs up and over to the new
        pan = _expo(_clamp((u - 0.22) / 0.52, 0.0, 1.0))
        x0 = 1.5 if fwd else -1.5
        px = x0 * (1.0 - 2.0 * pan)
        py = 1.15 + 0.55 * math.sin(math.pi * pan)
        cam = Cam(canvas, (px, py, -0.1),
                  yaw=math.atan2(-px, ZC + 0.1) * 0.6,
                  pitch=-0.24 - 0.10 * math.sin(math.pi * pan))
        _tube(canvas, cam, 0, BR0, w_src if fwd else w_dst)     # right bank
        _tube(canvas, cam, BR1, N, w_dst if fwd else w_src)     # left bank
        _tube(canvas, cam, BR0, BR1, 0.35 + 0.9 * _clamp(
            1.0 - abs(s_p - 0.5) / 0.22, 0.0, 1.0))             # the ridge
        head = int(s_p * (N - 1))
        if 0.0 < pr < 1.0:                          # the pulse: comet + sparks
            tail = 34
            if fwd:
                _tube(canvas, cam, head - tail, head, 1.45)
            else:
                _tube(canvas, cam, head, head + tail, 1.45)
            _bead(canvas, cam.project(*_ppos(s_p)), 1.2)
            for k in (0.008, 0.018):
                sa = s_p + (k if fwd else -k)
                p = cam.project(*_ppos(_clamp(sa, 0.0, 0.999)))
                if p:
                    canvas.set_dot(p[0], p[1])
        else:                                       # dwelling: an idle ember
            _bead(canvas, cam.project(*_ppos(s_p)), 0.6 + 0.2 * math.sin(t * 3.0))
        if pr > 0.90:                               # arrival shockwave
            q = _clamp((pr - 0.90) / 0.10, 0.0, 1.0)
            apex = (-APX if fwd else APX, Y_TOP, ZF)
            _ring(canvas, cam, apex, 0.2 + _eout(q) * 1.5)

    def status(self):
        pr = _expo(_clamp((self._u() - 0.14) / 0.58, 0.0, 1.0))
        if pr <= 0.02:
            return "SECTION"
        return "ARRIVED" if pr > 0.92 else "CROSSING"


# ===========================================================================
# 5 — RIDE  (chase-cam POV: dive in wide, surge the pipe, lift back out)
# ===========================================================================
class SerpRideScene(SerpScene):
    name = "serp · ride"
    CYCLE = 12.0
    NCH = 10                                       # surge chapters per ride
    WIDE = (0.0, 2.7, -1.15)                       # the establishing position
    CENTER = (0.0, -0.05, ZC)                      # what the wide shot frames

    def _pose(self, v):
        """Chase pose at ride progress v: a drone 1.9 out and 0.65 above the
        runner, radially outside the coil, aimed a little way up the pipe."""
        v = _clamp(v, 0.0, 1.0)
        j = min(self.NCH - 1, int(v * self.NCH))
        fr = v * self.NCH - j
        sv = (j + 0.35 * fr + 0.65 * _expo(fr)) / self.NCH
        s = 0.02 + 0.955 * sv
        hx, hy, hz = _ppos(s)
        rx, rz = hx, hz - ZC                       # radial from the coil axis
        rl = math.hypot(rx, rz) or 1.0
        pos = (hx + rx / rl * 1.9, hy + 0.65, hz + rz / rl * 1.9)
        return pos, _ppos(min(0.999, s + 0.035)), s

    def draw(self, canvas):
        u = self._u()
        if u < 0.10:                               # dive from the wide shot
            pos, tgt, s = self._pose(0.0)
            q = _expo(u / 0.10)
        elif u < 0.88:                             # the ride itself
            pos, tgt, s = self._pose((u - 0.10) / 0.78)
            q = 1.0
        else:                                      # lift back out
            pos, tgt, s = self._pose(1.0)
            q = 1.0 - _expo((u - 0.88) / 0.12)
        wp, ct = self.WIDE, self.CENTER
        px = wp[0] + (pos[0] - wp[0]) * q          # position eases wide<->chase
        py = wp[1] + (pos[1] - wp[1]) * q
        pz = wp[2] + (pos[2] - wp[2]) * q
        tx = ct[0] + (tgt[0] - ct[0]) * q          # ...but the aim is always a
        ty = ct[1] + (tgt[1] - ct[1]) * q          # look-at, so the coil never
        tz = ct[2] + (tgt[2] - ct[2]) * q          # leaves the frame
        dx, dy, dz = tx - px, ty - py, tz - pz
        cam = Cam(canvas, (px, py, pz),
                  yaw=math.atan2(dx, dz),
                  pitch=math.atan2(dy, math.hypot(dx, dz)))
        _tube(canvas, cam, 0, N, 0.70)
        head = min(0.999, s + 0.012)               # the runner we're chasing
        _tube(canvas, cam, int(s * N) - 8, int(head * N), 1.3)
        _bead(canvas, cam.project(*_ppos(head)))

    def status(self):
        u = self._u()
        if u < 0.10:
            return "DIVE"
        if u < 0.88:
            return "RIDE %d/%d" % (min(self.NCH - 1,
                                       int((u - 0.10) / 0.78 * self.NCH)) + 1,
                                   self.NCH)
        return "WIDE"


# ===========================================================================
# 6 — IDLE  (arrival hold: hero orbit, breathing layers, one quiet bead)
# ===========================================================================
class SerpIdleScene(SerpScene):
    name = "serp · idle"
    CYCLE = 9.0

    def _bob(self, bank, m):
        return 0.035 * math.sin(self.t * 0.8 + m * 0.55 +
                                (0.0 if bank == "R" else 1.9))

    def draw(self, canvas):
        u = self._u()
        t = self.t
        yaw = 0.35 * math.sin(t * 0.10)            # the slow hero orbit
        r0 = 5.6
        py = 1.5 + 0.25 * math.sin(t * 0.13)
        cam = Cam(canvas, (r0 * math.sin(yaw), py, ZC - r0 * math.cos(yaw)),
                  yaw=yaw, pitch=-math.atan2(py, r0) * 0.9)
        for bank in ("R", "L"):                    # layers breathe out of phase
            for m in range(K):
                i0, i1 = RANGES[(bank, m)]
                _tube(canvas, cam, i0, i1,
                      0.55 + 0.06 * math.sin(t * 0.9 + m), oy=self._bob(bank, m))
            for m in range(K):
                key = (bank + "B", m)
                if key in RANGES:
                    i0, i1 = RANGES[key]
                    _tube(canvas, cam, i0, i1, 0.50, oy=self._bob(bank, m))
        _tube(canvas, cam, BR0, BR1, 0.55, oy=self._bob("R", 0) * 0.5)
        # one quiet bead still making the circuit, fading through the seam
        k = _clamp(min(u, 1.0 - u) * 12.0, 0.0, 1.0)
        if k > 0.0:
            head = int(u * (N - 1))
            _tube(canvas, cam, head - 8, head, 1.1 * k)
            _bead(canvas, cam.project(*_ppos(u)), 0.8 * k)

    def status(self):
        return "READY"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        SerpBuildScene(),      # 1  the structure assembles
        SerpTraceScene(),      # 2  the route draws on
        SerpFlowScene(),       # 3  steady circulation
        SerpCrossScene(),      # 4  the section handoff
        SerpRideScene(),       # 5  POV flythrough
        SerpIdleScene(),       # 6  arrival hold
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
