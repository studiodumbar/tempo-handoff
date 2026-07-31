#!/usr/bin/env python3
"""
spatial_states — the eight agent states as true-3D rooms, in braille and blocks.

Not the wire-and-bead look: these are free spatial compositions with a real
perspective camera. The braille/block mix IS the depth cue — one shared mark
helper draws everything, and the glyph class falls out of projected size:

    far / small   ->  a single braille dot
    mid           ->  a short braille dash
    near / big    ->  a solid block slab   (▁▄█ block chars, whole cells)

so bodies genuinely change material as they move through space, and every
scene reads as a place with depth rather than a flat pattern.

    1  3d · loading    a receding ring tunnel solidifies far -> near, then the
                       finished tunnel rushes past the camera
    2  3d · thinking   a tumbling cloud of dots; clusters crystallise into
                       blocks, hold, and melt somewhere else
    3  3d · fetching   packets launch from a far gate and fly past the camera,
                       growing dot -> dash -> slab
    4  3d · comparing  two tilted dot panels face each other; focus alternates,
                       the active one solidifying row by row
    5  3d · overview   the camera pulls up and back over a dot-grid floor of
                       block towers — from one tower to the whole field
    6  3d · section    a parallax whip: three depth layers of content slide at
                       different speeds as we travel to the next section
    7  3d · cart       block items arc down into a braille wireframe bin and
                       stack inside; the bin pulses on every catch
    8  3d · edit       one item levitates out of the bin and resizes; another
                       is ejected and the stack repacks with a settle

House ease-in-out-expo, seamless loops, big negative space. Run standalone:
`python spatial_states.py` (60fps explorer; flags fall through to mpp).
"""

import math
import sys

from mpp import Scene, _clamp, EASE_BACK
from sketches import _hbar_block, _vbar_block

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
# The camera and the mark — everything below draws through these two.
# ---------------------------------------------------------------------------
class Cam:
    """A pinhole at `pos`, pitched about X. World: x right, y up, z away."""

    def __init__(self, canvas, pos=(0.0, 0.0, 0.0), pitch=0.0, fov=1.1):
        self.px, self.py, self.pz = pos
        self.cp, self.sp = math.cos(pitch), math.sin(pitch)
        self.F = min(canvas.wu, canvas.hu) * fov
        self.cx, self.cy = canvas.wu / 2.0, canvas.hu / 2.0

    def project(self, x, y, z):
        """(sx, sy, f) or None if behind the near plane. f scales sizes."""
        rx, ry, rz = x - self.px, y - self.py, z - self.pz
        ry, rz = ry * self.cp - rz * self.sp, ry * self.sp + rz * self.cp
        if rz < 0.18:
            return None
        f = self.F / rz
        return self.cx + rx * f, self.cy - ry * f, f


def _mark(canvas, p, size, vert=False):
    """The braille->block depth ramp: one mark, glyph class by projected size."""
    if p is None:
        return
    x, y, _f = p
    size = min(size, 15.0)                 # near-plane guard: never a giant slab
    if size < 1.1:
        canvas.set_dot(x, y)
    elif size < 3.0:
        canvas.line(x - size / 2.0, y, x + size / 2.0, y)   # braille dash
    elif vert:
        _vbar_block(canvas, x, y - size / 2.0, y + size / 2.0,
                    max(2.4, size * 0.8))
    else:
        _hbar_block(canvas, x - size / 2.0, x + size / 2.0, y,
                    max(2.4, size * 0.8))


def _wire_rect(canvas, cam, corners, gap=2.6):
    """A braille dotted rectangle (or any polygon) through 3D corners."""
    n = len(corners)
    for i in range(n):
        ax, ay, az = corners[i]
        bx, by, bz = corners[(i + 1) % n]
        steps = 18
        for k in range(steps + 1):
            e = k / steps
            p = cam.project(ax + (bx - ax) * e, ay + (by - ay) * e,
                            az + (bz - az) * e)
            if p and (k % 2 == 0):
                canvas.set_dot(p[0], p[1])


def _h(i, j=0):
    """Deterministic hash -> [0, 1)."""
    n = (i * 2654435761 + j * 40503) & 0xFFFFFFFF
    n ^= n >> 13
    n = (n * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


class SpatialScene(Scene):
    CYCLE = 5.0

    def _u(self):
        return (self.t % self.CYCLE) / self.CYCLE


# ===========================================================================
# 1 — LOADING  (a ring tunnel solidifies far -> near, then flushes past)
# ===========================================================================
class TunnelLoadScene(SpatialScene):
    name = "3d · loading"
    CYCLE = 6.0
    N_RINGS = 12
    PER = 30              # points per ring
    R = 1.05              # tunnel radius (world units)
    Z0, Z1 = 0.9, 6.4     # nearest / farthest ring

    def draw(self, canvas):
        u = self._u()
        t = self.t
        # the camera breathes and sways a little inside the tube
        cam = Cam(canvas, (0.14 * math.sin(t * 0.5), 0.10 * math.sin(t * 0.33), 0.0),
                  pitch=0.03 * math.sin(t * 0.4))
        fill = _expo(_clamp(u / 0.74, 0.0, 1.0))            # far -> near fill
        flush = _ein(_clamp((u - 0.84) / 0.16, 0.0, 1.0))   # then it takes you
        for i in range(self.N_RINGS):
            ri = i / (self.N_RINGS - 1)                     # 0 near .. 1 far
            z = self.Z0 + (self.Z1 - self.Z0) * ri - flush * self.Z1
            if z < 0.22:
                continue
            # rings solidify starting from the FAR end, arriving at the viewer
            lit = _clamp((fill - (1.0 - ri)) * self.N_RINGS * 0.5, 0.0, 1.0)
            front = 1.0 if 0.02 < lit < 0.98 else 0.0       # the active ring flares
            wob = 0.03 * math.sin(t * 1.1 + i)
            for k in range(self.PER):
                a = TAU * k / self.PER + i * 0.13
                x = (self.R + wob) * math.cos(a)
                y = (self.R + wob) * math.sin(a)
                p = cam.project(x, y, z)
                if p is None:
                    continue
                size = (0.006 + (0.030 + 0.012 * front) * lit) * p[2]
                _mark(canvas, p, size)

    def status(self):
        u = self._u()
        return "LOADED" if 0.74 < u <= 0.84 else "LOADING"


# ===========================================================================
# 2 — THINKING  (a tumbling dot cloud; clusters crystallise and melt)
# ===========================================================================
class CloudThinkScene(SpatialScene):
    name = "3d · thinking"
    CYCLE = 7.5
    N = 130               # points in the cloud
    K = 3                 # crystallising clusters per cycle

    def __init__(self):
        super().__init__()
        self.pts = []
        for i in range(self.N):
            th = math.acos(2.0 * _h(i, 1) - 1.0)
            ph = TAU * _h(i, 2)
            r = 0.75 + 0.5 * _h(i, 3)                       # a rough, lumpy cloud
            self.pts.append((r * math.sin(th) * math.cos(ph),
                             r * math.cos(th),
                             r * math.sin(th) * math.sin(ph)))
        self.centers = [self.pts[int(_h(9, k) * self.N)] for k in range(self.K)]

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, -3.1))
        ya, pa = t * 0.22, t * 0.13                         # the slow tumble
        cy_, sy_ = math.cos(ya), math.sin(ya)
        cp_, sp_ = math.cos(pa), math.sin(pa)
        # which cluster is crystallising, and how strongly
        seg = u * self.K
        ci = min(self.K - 1, int(seg))
        cu = seg - ci
        amp = _smooth(cu / 0.35) * (1.0 - _smooth((cu - 0.62) / 0.38))
        ccx, ccy, ccz = self.centers[ci]
        for i, (x0, y0, z0) in enumerate(self.pts):
            # crystallised points pull slightly toward their cluster centre
            d2 = (x0 - ccx) ** 2 + (y0 - ccy) ** 2 + (z0 - ccz) ** 2
            g = math.exp(-d2 * 1.3) * amp
            x = x0 + (ccx - x0) * 0.5 * g
            y = y0 + (ccy - y0) * 0.5 * g
            z = z0 + (ccz - z0) * 0.5 * g
            x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_    # tumble
            y, z = y * cp_ - z * sp_, y * sp_ + z * cp_
            p = cam.project(x, y, z)
            if p is None:
                continue
            drift = 0.4 + 0.6 * _h(i, 7)
            size = (0.006 + 0.130 * g * drift) * p[2]
            _mark(canvas, p, size)

    def status(self):
        return "THINKING"


# ===========================================================================
# 3 — FETCHING  (packets launch from a far gate and fly past the camera)
# ===========================================================================
class GateFetchScene(SpatialScene):
    name = "3d · fetching"
    CYCLE = 3.6
    N_PKT = 8
    GATE = (0.9, 0.55, 7.5)   # the far gate's centre
    GW, GH = 1.15, 0.78        # its half extents

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, 0.0), pitch=0.02 * math.sin(t * 0.5))
        gx, gy, gz = self.GATE
        gx += 0.08 * math.sin(t * 0.4)                      # the gate drifts
        gy += 0.05 * math.sin(t * 0.27)
        _wire_rect(canvas, cam, [(gx - self.GW, gy - self.GH, gz),
                                 (gx + self.GW, gy - self.GH, gz),
                                 (gx + self.GW, gy + self.GH, gz),
                                 (gx - self.GW, gy + self.GH, gz)])
        for k in range(self.N_PKT):
            s = (u + k / self.N_PKT) % 1.0
            e = 0.3 * s + 0.7 * _ein(s)                     # crawls far, rushes near
            # each packet exits the gate toward its own near-plane point
            hx = (_h(k, 11) - 0.5) * 3.6
            hy = (_h(k, 12) - 0.5) * 2.6
            x = gx + (hx - gx) * e
            y = gy + (hy - gy) * e + 0.35 * math.sin(math.pi * e)  # a gentle arc
            z = gz + (0.3 - gz) * e
            p = cam.project(x, y, z)
            if p is None:
                continue
            _mark(canvas, p, (0.012 + 0.038 * e) * p[2])
        # the request beam: a dotted convergence line toward the gate
        for k in range(16):
            e = k / 15.0
            p = cam.project(-1.6 + (gx + 1.6) * e, -1.2 + (gy + 1.2) * e,
                            0.6 + (gz - 0.6) * e)
            if p and k % 2 == 0:
                canvas.set_dot(p[0], p[1])

    def status(self):
        return "FETCHING"


# ===========================================================================
# 4 — COMPARING  (two tilted dot panels; focus alternates, one solidifies)
# ===========================================================================
class PanelCompareScene(SpatialScene):
    name = "3d · comparing"
    CYCLE = 6.0
    GC, GR = 5, 7         # panel grid: columns x rows

    def _panel(self, canvas, cam, side, focus, sweep, t):
        """One tilted panel of grid marks. side=-1 left, +1 right."""
        cx = side * 1.12                                    # panel centre x
        yaw = -side * (0.45 - 0.28 * focus)                 # turns toward us in focus
        cyw, syw = math.cos(yaw), math.sin(yaw)
        bob = 0.05 * math.sin(t * 0.7 + (0 if side < 0 else 1.7))
        for r in range(self.GR):
            for c in range(self.GC):
                lx = (c / (self.GC - 1) - 0.5) * 1.5
                ly = (r / (self.GR - 1) - 0.5) * 2.0 + bob
                x = cx + lx * cyw
                z = 2.6 + lx * syw * -1.0
                p = cam.project(x, ly, z)
                if p is None:
                    continue
                # the focus sweep solidifies the panel row by row (top-down)
                row_lit = _clamp(sweep * self.GR - (self.GR - 1 - r), 0.0, 1.0)
                size = (0.015 + 0.055 * focus * row_lit) * p[2]
                _mark(canvas, p, size)

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, 0.0))
        # focus alternates left -> right with a hard expo handoff each half
        half = 0 if u < 0.5 else 1
        hu_ = (u * 2.0) % 1.0
        f_new = _expo(_clamp(hu_ / 0.30, 0.0, 1.0))
        sweep = _clamp((hu_ - 0.10) / 0.55, 0.0, 1.0)
        fl = (1.0 - f_new) if half == 1 else f_new
        fr = f_new if half == 1 else (1.0 - f_new)
        self._panel(canvas, cam, -1, fl, sweep if half == 0 else 1.0 - 0.0, t)
        self._panel(canvas, cam, +1, fr, sweep if half == 1 else 1.0 - 0.0, t)
        # the cursor slab hops across during the handoff
        hop = _expo(_clamp((hu_ - 0.02) / 0.26, 0.0, 1.0))
        frm = 1.12 if half == 0 else -1.12                  # from the old panel
        x = frm + (-frm - frm) * 0.0 + (-2.0 * frm) * hop
        y = 1.35 - 0.5 * math.sin(math.pi * hop)
        p = cam.project(x, y, 2.6)
        _mark(canvas, p, 0.065 * (p[2] if p else 60.0))

    def status(self):
        return "COMPARING ←" if self._u() < 0.5 else "COMPARING →"


# ===========================================================================
# 5 — OVERVIEW  (the camera pulls up and back over a floor of block towers)
# ===========================================================================
class FieldOverviewScene(SpatialScene):
    name = "3d · overview"
    CYCLE = 8.0
    TOWERS = ((-1.8, 1.6, 0.9), (-0.6, 2.4, 1.5), (0.9, 1.9, 0.7),
              (1.9, 3.1, 1.2), (-1.2, 3.8, 1.8), (0.2, 4.4, 1.0),
              (1.4, 4.9, 1.6), (-2.2, 5.2, 0.8))   # (x, z, height)

    def draw(self, canvas):
        u = self._u()
        t = self.t
        # dolly: low & close -> high & back (the reveal), hold, descend
        if u < 0.34:
            e = _expo(u / 0.34)
        elif u < 0.72:
            e = 1.0
        else:
            e = 1.0 - _expo((u - 0.72) / 0.28)
        camY = 0.55 + 2.6 * e
        camZ = 0.4 - 1.6 * e
        pitch = -(0.10 + 0.38 * e)                          # look down as we rise
        cam = Cam(canvas, (0.35 * math.sin(t * 0.15), camY, camZ), pitch=pitch)
        # the floor: a braille dot grid receding to the horizon
        for zi in range(10):
            z = 1.0 + zi * 0.62
            for xi in range(-6, 7):
                p = cam.project(xi * 0.52, 0.0, z)
                if p:
                    canvas.set_dot(p[0], p[1])
        # the towers: stacked block slabs, block-sized by proximity
        for ti, (tx, tz, th) in enumerate(self.TOWERS):
            wob = 1.0 + 0.04 * math.sin(t * 0.8 + ti)
            lvls = max(2, int(th / 0.30))
            for li in range(lvls):
                y = (li + 0.5) * 0.30 * wob
                p = cam.project(tx, y, tz)
                if p is None:
                    continue
                _mark(canvas, p, 0.085 * p[2])

    def status(self):
        u = self._u()
        return "OVERVIEW" if 0.34 <= u < 0.72 else "RISING" if u < 0.34 else "DIVING"


# ===========================================================================
# 6 — SECTION  (a parallax whip across three depth layers of content)
# ===========================================================================
class ParallaxSectionScene(SpatialScene):
    name = "3d · section"
    CYCLE = 4.4
    W = 5.2               # one section's width in world units

    def _content(self, canvas, cam, sec):
        """One section's furniture, deterministic per section index."""
        bx = sec * self.W
        for k in range(4):                                  # near slabs
            x = bx + (_h(sec, k) - 0.5) * 4.2
            y = (_h(sec, k + 9) - 0.5) * 1.6
            p = cam.project(x, y, 1.35)
            if p:
                _mark(canvas, p, (0.045 + 0.022 * _h(sec, k + 4)) * p[2])
        for k in range(7):                                  # mid dashes / small slabs
            x = bx + (_h(sec, k + 20) - 0.5) * 4.0
            y = (_h(sec, k + 29) - 0.5) * 2.2
            p = cam.project(x, y, 2.6)
            if p:
                _mark(canvas, p, (0.020 + 0.014 * _h(sec, k + 24)) * p[2])
        # a far braille frame (the next room's doorway) + dot scatter
        _wire_rect(canvas, cam, [(bx - 1.0, -0.8, 5.2), (bx + 1.0, -0.8, 5.2),
                                 (bx + 1.0, 0.8, 5.2), (bx - 1.0, 0.8, 5.2)])
        for k in range(10):
            x = bx + (_h(sec, k + 40) - 0.5) * 5.0
            y = (_h(sec, k + 48) - 0.5) * 2.6
            p = cam.project(x, y, 4.2 + 1.5 * _h(sec, k + 52))
            if p:
                canvas.set_dot(p[0], p[1])

    def draw(self, canvas):
        u = self._u()
        # dwell, then whip one section-width; parallax comes free from depth
        sw = _expo(_clamp((u - 0.42) / 0.44, 0.0, 1.0))
        base = math.floor(self.t / self.CYCLE)              # which section we're on
        camX = (base + sw) * self.W
        cam = Cam(canvas, (camX, 0.0, 0.0),
                  pitch=0.02 * math.sin(self.t * 0.5))
        for sec in (base - 1, base, base + 1, base + 2):
            self._content(canvas, cam, int(sec) % 97)

    def status(self):
        return "TRAVELLING" if self._u() > 0.42 else "SECTION"


# ===========================================================================
# 7 — CART  (block items arc into a wireframe bin; the bin pulses per catch)
# ===========================================================================
class BinCartScene(SpatialScene):
    name = "3d · cart"
    CYCLE = 8.5
    N_ITEMS = 5
    BIN = (1.05, -0.55, 2.1)   # the bin's centre
    BW, BH, BD = 0.85, 0.6, 0.5

    def _bin(self, canvas, cam, squash):
        bx, by, bz = self.BIN
        w, h, d = self.BW * (1 + 0.14 * squash), self.BH * (1 - 0.10 * squash), self.BD
        # front face + open-top rim: braille wireframe
        _wire_rect(canvas, cam, [(bx - w, by - h, bz - d), (bx + w, by - h, bz - d),
                                 (bx + w, by + h, bz - d), (bx - w, by + h, bz - d)])
        _wire_rect(canvas, cam, [(bx - w, by + h, bz - d), (bx + w, by + h, bz - d),
                                 (bx + w, by + h, bz + d), (bx - w, by + h, bz + d)])

    def _contents(self, canvas, cam, n, lift_k=None, lift_y=0.0, gap_close=0.0,
                  skip=None):
        """n stacked rows of slabs inside the bin (2 per row)."""
        bx, by, bz = self.BIN
        drawn = 0
        for k in range(n):
            row, col = divmod(k, 2)
            x = bx + (col - 0.5) * 0.72
            y = (by - self.BH * 0.62) + row * 0.34
            if gap_close > 0.0 and lift_k is not None and k > lift_k:
                # rows above the removed one settle down into the gap
                y -= 0.34 * gap_close * (1 if (k - 2) >= lift_k else 0)
            if k == skip:
                continue
            yy = y + (lift_y if k == lift_k else 0.0)
            p = cam.project(x, yy, bz - self.BD * 0.6)
            if p:
                _mark(canvas, p, 0.060 * p[2])
            drawn += 1
        return drawn

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, 0.0), pitch=0.03 * math.sin(t * 0.45))
        land_w = 0.86 / self.N_ITEMS
        landed = 0
        squash = 0.0
        for k in range(self.N_ITEMS):
            t0 = 0.06 + k * land_w
            e = _clamp((u - t0) / (land_w * 0.9), 0.0, 1.0)
            if e >= 1.0:
                landed += 1
                # a fresh catch squashes the bin (springy, decaying)
                dt_ = (u - (t0 + land_w * 0.9)) * self.CYCLE
                if dt_ < 0.7:
                    squash = max(squash, EASE_BACK(_clamp(1.0 - dt_ / 0.7, 0, 1)) * 0.8)
                continue
            if e <= 0.0:
                continue
            ee = _expo(e)
            # the flight: from far upper-left, arcing down into the bin's mouth
            sx, sy, sz = -2.6, 1.7, 5.6
            bx, by, bz = self.BIN
            x = sx + (bx - sx) * ee
            y = sy + (by + self.BH * 0.9 - sy) * ee + 0.9 * math.sin(math.pi * ee)
            z = sz + (bz - sz) * ee
            drop = _clamp((e - 0.86) / 0.14, 0.0, 1.0)      # the final drop in
            y -= drop * self.BH * 1.1
            p = cam.project(x, y, z)
            if p:
                _mark(canvas, p, (0.016 + 0.034 * ee) * p[2])
        self._bin(canvas, cam, squash)
        self._contents(canvas, cam, landed)

    def status(self):
        return "ADDED" if self._u() > 0.92 else "ADDING"


# ===========================================================================
# 8 — EDIT  (an item levitates out of the bin and resizes; one is ejected)
# ===========================================================================
class BinEditScene(BinCartScene):
    name = "3d · edit"
    CYCLE = 9.0

    def draw(self, canvas):
        u = self._u()
        t = self.t
        cam = Cam(canvas, (0.0, 0.0, 0.0), pitch=0.03 * math.sin(t * 0.45))
        bx, by, bz = self.BIN
        phase = min(2, int(u * 3))
        pu = (u * 3) % 1.0

        self._bin(canvas, cam, 0.0)
        if phase < 2:
            # levitate item 3 (top row), hover, resize, drop back
            up = _expo(_clamp(pu / 0.30, 0.0, 1.0))
            dn = _expo(_clamp((pu - 0.66) / 0.30, 0.0, 1.0))
            lift = (self.BH * 2.1) * up * (1.0 - dn)
            self._contents(canvas, cam, 5, lift_k=4, lift_y=lift,
                           skip=4 if lift > 0.05 else None)
            # while hovering it resizes (grow first phase, shrink second)
            mid = _smooth(_clamp((pu - 0.32) / 0.30, 0.0, 1.0))
            if lift > 0.05:
                px = cam.project(bx - 0.5 * 0.72 + 0.72, by + lift, bz)
                scale = (1.0 + 0.9 * mid) if phase == 0 else (1.6 - 1.1 * mid)
                if px:
                    _mark(canvas, px, 0.060 * px[2] * scale)
        else:
            # eject item 2 up and off; the rows above settle into the gap
            fl = _ein(_clamp((pu - 0.20) / 0.40, 0.0, 1.0))
            gap = _expo(_clamp((pu - 0.62) / 0.34, 0.0, 1.0))
            self._contents(canvas, cam, 5 if fl < 1.0 else 4,
                           lift_k=2 if fl < 1.0 else None,
                           lift_y=fl * 3.2, gap_close=gap)
            if 0.0 < fl < 1.0:
                # the ejected item tumbles away toward upper-left, shrinking
                p = cam.project(bx - 1.0 - fl * 2.6, by + 0.4 + fl * 2.2,
                                bz + fl * 2.6)
                if p:
                    _mark(canvas, p, 0.040 * p[2] * (1.0 - 0.5 * fl))

    def status(self):
        return ("RESIZE +", "RESIZE −", "REMOVE")[min(2, int(self._u() * 3))]


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        TunnelLoadScene(),         # 1  loading
        CloudThinkScene(),         # 2  thinking
        GateFetchScene(),          # 3  fetching
        PanelCompareScene(),       # 4  comparing
        FieldOverviewScene(),      # 5  overview
        ParallaxSectionScene(),    # 6  going to another section
        BinCartScene(),            # 7  adding to cart
        BinEditScene(),            # 8  editing cart
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
