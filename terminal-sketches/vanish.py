#!/usr/bin/env python3
"""
vanish — seamless infinite dolly-in toward one sharp central vanishing point.

The concept, held strictly across every scene:
  - continuous, smooth forward camera motion — a constant-speed dolly, never
    a beat or a stop, running forever
  - one singular vanishing point, dead centre: all longitudinal lines are
    z-parallel, so they converge exactly on the screen centre no matter how
    the camera breathes (position sway gives parallax; the VP never moves)
  - full-screen composition: architecture spans past the frame edges near
    the eye and dissolves to dust at depth
  - strictly angular / rectilinear / polygonal — rectangles, diagonals,
    right angles, shards. No circles, no curves, no spheres anywhere.
  - deep parallax: 14 exponentially spaced layers (each step nearer is the
    same ratio bigger — a self-similar zoom), plus fixed rails threading
    every depth

Layers live on the exponential treadmill: depth d = a - t*SPEED, z = ZN *
RATIO^d. Each passing layer has a stable identity `a`, hashed for its
furniture; identities repeat every PERIOD layers, so every scene is an
EXACT loop of PERIOD/SPEED seconds while still reading as endless.

    1  vanish · tunnel     nested rectangular frames + corner rails
    2  vanish · diamonds   square / 45-degree frames alternating, corners
                           woven together into an angular lattice tube
    3  vanish · vault      triple-nested frames with corner ribs — the
                           densest, most architectural bore
    4  vanish · twist      an open U-frame rotating 90 degrees per layer:
                           a right-angled spiral staircase of walls
    5  vanish · mondrian   glass panes: each layer partitioned by hash
                           into panels, near panes flashing solid
    6  vanish · gridfloor  floor + ceiling lattices, lateral rungs
                           whooshing, pillar pairs at hashed depths
    7  vanish · canyon     a street canyon: slab buildings left and right,
                           antennas, centreline dashes, kerb rails
    8  vanish · colonnade  pylon pairs under lintels, every fourth layer a
                           full portal frame
    9  vanish · scaffold   hashed beams — horizontal, vertical, diagonal
                           braces — an endless construction lattice
    10 vanish · shards     angular debris: triangles and quads orbiting the
                           clear centre lane, deep parallax field
    11 vanish · strands    a curtain field of vertical edges over a floor
                           of lateral rungs

Run standalone: `python vanish.py` (60fps explorer; flags fall to mpp).
"""

import math
import sys

from mpp import Scene, _clamp
from serp_flux import Cam, _seg_visible

TAU = 2.0 * math.pi
HW, HH = 2.15, 1.32          # the tunnel's half extents (frame-filling)


def _h(i, j=0):
    """Deterministic hash -> [0, 1)."""
    n = (i * 2654435761 + j * 40503) & 0xFFFFFFFF
    n ^= n >> 13
    n = (n * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


# ---------------------------------------------------------------------------
# Strokes: everything is a straight 3D segment through the depth-style ramp.
# ---------------------------------------------------------------------------
def _sty(canvas, cam, pa, pb, lvl):
    if pa is None or pb is None or pa[2] > 300 or pb[2] > 300:
        return
    if not _seg_visible(cam, pa, pb):
        return
    dx, dy = pb[0] - pa[0], pb[1] - pa[1]
    if abs(dx) + abs(dy) > 150.0:
        return
    if lvl < 2.4:
        canvas.set_dot(pa[0], pa[1])
    elif lvl < 6.5:
        canvas.set_dot(pa[0], pa[1])
        canvas.set_dot((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
        canvas.set_dot(pb[0], pb[1])
    elif lvl < 20.0:
        canvas.line(pa[0], pa[1], pb[0], pb[1])
    else:
        dl = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / dl * 0.6, dx / dl * 0.6
        canvas.line(pa[0] + nx, pa[1] + ny, pb[0] + nx, pb[1] + ny)
        canvas.line(pa[0] - nx, pa[1] - ny, pb[0] - nx, pb[1] - ny)


def _seg(canvas, cam, A, B, w, sub=1):
    if w <= 0.02:
        return
    pts = [cam.project(A[0] + (B[0] - A[0]) * k / sub,
                       A[1] + (B[1] - A[1]) * k / sub,
                       A[2] + (B[2] - A[2]) * k / sub)
           for k in range(sub + 1)]
    for k in range(sub):
        pa, pb = pts[k], pts[k + 1]
        if pa and pb:
            _sty(canvas, cam, pa, pb, w * (pa[2] + pb[2]) * 0.5)


def _rect(canvas, cam, cx, cy, hw, hh, z, w):
    c = ((cx - hw, cy - hh, z), (cx + hw, cy - hh, z),
         (cx + hw, cy + hh, z), (cx - hw, cy + hh, z))
    for k in range(4):
        _seg(canvas, cam, c[k], c[(k + 1) % 4], w, sub=2)


def _poly(canvas, cam, pts, z, w, close=True):
    n = len(pts)
    for k in range(n if close else n - 1):
        ax, ay = pts[k]
        bx, by = pts[(k + 1) % n]
        _seg(canvas, cam, (ax, ay, z), (bx, by, z), w)


def _rail(canvas, cam, x, y, z0, z1, w):
    _seg(canvas, cam, (x, y, z0), (x, y, z1), w, sub=8)


class VanishScene(Scene):
    NL = 14                  # layers in flight
    ZN = 0.50                # nearest depth
    RATIO = 1.26             # self-similar step ratio
    SPEED = 0.85             # layers per second — constant, forever
    PERIOD = 12              # furniture repeats -> an exact seamless loop
    FOV = 1.05
    SWAY = 0.035             # positional only: parallax, VP stays centred

    def _cam(self, canvas):
        t = self.t
        return Cam(canvas,
                   (self.SWAY * math.sin(t * 0.26),
                    self.SWAY * 0.7 * math.sin(t * 0.19), 0.0),
                   fov=self.FOV)

    def _layers(self):
        """[(seed, z, w)] far -> near, streaming continuously."""
        flow = self.t * self.SPEED
        m = math.floor(flow)
        out = []
        for j in range(self.NL + 1):
            a = m + j
            d = a - flow + 0.40
            z = self.ZN * self.RATIO ** d
            w = (_clamp((z - 0.40) / 0.30, 0.0, 1.0) *
                 _clamp((self.NL - 0.4 - d) / 1.2, 0.0, 1.0))
            if w > 0.02:
                out.append((a % self.PERIOD, z, w))
        out.sort(key=lambda L: -L[1])
        return out

    def _zspan(self):
        return self.ZN * 1.05, self.ZN * self.RATIO ** (self.NL - 0.8)

    def _vp(self, canvas, cam):
        """The vanishing point itself: a tiny breathing plus, dead centre."""
        r = 2.0 + 0.7 * math.sin(self.t * 1.7)
        canvas.line(cam.cx - r, cam.cy, cam.cx + r, cam.cy)
        canvas.line(cam.cx, cam.cy - r * 0.6, cam.cx, cam.cy + r * 0.6)

    def status(self):
        return "∞ %03d" % (int(self.t * self.SPEED) % 1000)


# ===========================================================================
# 1 — TUNNEL  (nested rectangular frames + corner rails)
# ===========================================================================
class VanishTunnelScene(VanishScene):
    name = "vanish · tunnel"

    def draw(self, canvas):
        cam = self._cam(canvas)
        z0, z1 = self._zspan()
        for sx in (-1, 1):                         # the four corner rails
            for sy in (-1, 1):
                _rail(canvas, cam, sx * HW, sy * HH, z0, z1, 0.5)
        for seed, z, w in self._layers():
            _rect(canvas, cam, 0.0, 0.0, HW, HH, z, 0.85 * w)
            if _h(seed, 3) > 0.55:                 # some frames are doubled
                _rect(canvas, cam, 0.0, 0.0, HW * 0.62, HH * 0.62, z, 0.55 * w)
        self._vp(canvas, cam)


# ===========================================================================
# 2 — DIAMONDS  (square / 45-degree frames, corners woven into a lattice)
# ===========================================================================
class VanishDiamondScene(VanishScene):
    name = "vanish · diamonds"
    SQ = ((-HW * 0.80, -HH * 1.02), (HW * 0.80, -HH * 1.02),
          (HW * 0.80, HH * 1.02), (-HW * 0.80, HH * 1.02))
    DM = ((0.0, -HH * 1.30), (HW * 0.95, 0.0),
          (0.0, HH * 1.30), (-HW * 0.95, 0.0))

    def draw(self, canvas):
        cam = self._cam(canvas)
        prev = None
        for seed, z, w in self._layers():
            pts = self.SQ if seed % 2 == 0 else self.DM
            _poly(canvas, cam, pts, z, 0.8 * w)
            if prev:                               # weave corner to corner
                ppts, pz, pw = prev
                for k in range(4):
                    _seg(canvas, cam, (ppts[k][0], ppts[k][1], pz),
                         (pts[k][0], pts[k][1], z), 0.4 * min(w, pw), sub=2)
            prev = (pts, z, w)
        self._vp(canvas, cam)


# ===========================================================================
# 3 — VAULT  (triple-nested frames with corner ribs — the densest bore)
# ===========================================================================
class VanishVaultScene(VanishScene):
    name = "vanish · vault"
    SPEED = 0.75
    NL = 12                  # wider spacing: the triple nesting supplies
    RATIO = 1.31             # the density, so fewer layers in flight

    def draw(self, canvas):
        cam = self._cam(canvas)
        z0, z1 = self._zspan()
        for sx in (-1, 1):
            for sy in (-1, 1):
                _rail(canvas, cam, sx * HW, sy * HH, z0, z1, 0.45)
        for seed, z, w in self._layers():
            _rect(canvas, cam, 0.0, 0.0, HW, HH, z, 0.85 * w)
            _rect(canvas, cam, 0.0, 0.0, HW * 0.62, HH * 0.62, z, 0.6 * w)
            if _h(seed, 2) > 0.4:
                _rect(canvas, cam, 0.0, 0.0, HW * 0.36, HH * 0.36, z, 0.45 * w)
            for sx in (-1, 1):                     # corner ribs, outer->inner
                for sy in (-1, 1):
                    _seg(canvas, cam, (sx * HW, sy * HH, z),
                         (sx * HW * 0.36, sy * HH * 0.36, z), 0.4 * w)
        self._vp(canvas, cam)


# ===========================================================================
# 4 — TWIST  (an open U-frame rotating 90 degrees per layer: a right-angled
#             spiral staircase of walls; the open ends spiral as rails)
# ===========================================================================
class VanishTwistScene(VanishScene):
    name = "vanish · twist"
    S = 1.48

    @staticmethod
    def _rot90(pts, k):
        for _ in range(k % 4):
            pts = [(-y, x) for (x, y) in pts]
        return pts

    def draw(self, canvas):
        cam = self._cam(canvas)
        base = [(-self.S, -self.S), (-self.S, self.S),
                (self.S, self.S), (self.S, -self.S)]   # open at the bottom
        prev = None
        for seed, z, w in self._layers():
            pts = self._rot90(base, seed)
            _poly(canvas, cam, pts, z, 0.85 * w, close=False)
            if prev:                               # the open ends spiral
                ppts, pz, pw = prev
                for k in (0, 3):
                    _seg(canvas, cam, (ppts[k][0], ppts[k][1], pz),
                         (pts[k][0], pts[k][1], z), 0.45 * min(w, pw), sub=2)
            prev = (pts, z, w)
        self._vp(canvas, cam)


# ===========================================================================
# 5 — MONDRIAN  (hash-partitioned glass panes; near panels flash solid)
# ===========================================================================
class VanishMondrianScene(VanishScene):
    name = "vanish · mondrian"

    def draw(self, canvas):
        cam = self._cam(canvas)
        for seed, z, w in self._layers():
            _rect(canvas, cam, 0.0, 0.0, HW, HH, z, 0.8 * w)
            vx = (_h(seed, 1) - 0.5) * 2.4          # one vertical partition
            hy = (_h(seed, 2) - 0.5) * 1.7          # one horizontal, per side
            _seg(canvas, cam, (vx, -HH, z), (vx, HH, z), 0.7 * w, sub=2)
            side = 1.0 if _h(seed, 3) > 0.5 else -1.0
            x0, x1 = (vx, HW) if side > 0 else (-HW, vx)
            _seg(canvas, cam, (x0, hy, z), (x1, hy, z), 0.7 * w, sub=2)
            if _h(seed, 5) > 0.55:                  # the solid pane accent
                p1 = cam.project(x0, hy, z)
                p2 = cam.project(x1, side * HH, z)
                if p1 and p2:
                    pw_, ph_ = abs(p2[0] - p1[0]), abs(p2[1] - p1[1])
                    if 4.0 < pw_ < 46.0 and 4.0 < ph_ < 46.0:
                        canvas.rect_fill((p1[0] + p2[0]) / 2,
                                         (p1[1] + p2[1]) / 2,
                                         pw_ * 0.8, ph_ * 0.8)
        self._vp(canvas, cam)


# ===========================================================================
# 6 — GRIDFLOOR  (floor + ceiling lattices, rungs whooshing, pillar pairs)
# ===========================================================================
class VanishGridFloorScene(VanishScene):
    name = "vanish · gridfloor"
    FY, CY = -1.30, 1.30

    def draw(self, canvas):
        cam = self._cam(canvas)
        z0, z1 = self._zspan()
        for k in range(-4, 5):                     # longitudinal grid rails
            x = k * 0.78
            _rail(canvas, cam, x, self.FY, z0, z1, 0.42)
            _rail(canvas, cam, x, self.CY, z0, z1, 0.30)
        for seed, z, w in self._layers():          # lateral rungs
            _seg(canvas, cam, (-3.4, self.FY, z), (3.4, self.FY, z),
                 0.7 * w, sub=3)
            _seg(canvas, cam, (-3.4, self.CY, z), (3.4, self.CY, z),
                 0.45 * w, sub=3)
            if _h(seed, 7) > 0.55:                 # a pillar pair
                x = 0.9 + 1.7 * _h(seed, 8)
                for sx in (-1, 1):
                    _seg(canvas, cam, (sx * x, self.FY, z),
                         (sx * x, self.CY, z), 0.75 * w, sub=2)
        self._vp(canvas, cam)


# ===========================================================================
# 7 — CANYON  (slab buildings left and right, antennas, centreline dashes)
# ===========================================================================
class VanishCanyonScene(VanishScene):
    name = "vanish · canyon"
    SPEED = 0.7
    FY = -1.28

    def draw(self, canvas):
        cam = self._cam(canvas)
        z0, z1 = self._zspan()
        for sx in (-1, 1):                         # the kerb rails
            _rail(canvas, cam, sx * 0.72, self.FY, z0, z1, 0.5)
        for seed, z, w in self._layers():
            _seg(canvas, cam, (0.0, self.FY, z - 0.16),   # centreline dash
                 (0.0, self.FY, z + 0.16), 0.8 * w)
            for si, sx in ((0, -1.0), (1, 1.0)):   # a slab per side
                xi = 0.78 + 0.8 * _h(seed, 11 + si)
                xo = xi + 0.9 + 0.9 * _h(seed, 21 + si)
                top = self.FY + 1.2 + 1.5 * _h(seed, 31 + si)
                _rect(canvas, cam, sx * (xi + xo) / 2, (self.FY + top) / 2,
                      (xo - xi) / 2, (top - self.FY) / 2, z, 0.8 * w)
                if _h(seed, 41 + si) > 0.6:        # an antenna mast
                    ax = sx * (xi + (xo - xi) * _h(seed, 51 + si))
                    _seg(canvas, cam, (ax, top, z), (ax, top + 0.55, z),
                         0.6 * w)
        self._vp(canvas, cam)


# ===========================================================================
# 8 — COLONNADE  (pylon pairs under lintels; every fourth layer a portal)
# ===========================================================================
class VanishColonnadeScene(VanishScene):
    name = "vanish · colonnade"
    FY = -1.30

    def draw(self, canvas):
        cam = self._cam(canvas)
        z0, z1 = self._zspan()
        for sx in (-1, 1):
            _rail(canvas, cam, sx * 1.9, self.FY, z0, z1, 0.45)
        for seed, z, w in self._layers():
            for sx in (-1, 1):                     # the pylons
                _rect(canvas, cam, sx * 1.55, -0.27, 0.28, 1.03, z, 0.8 * w)
            _rect(canvas, cam, 0.0, 0.95, 1.85, 0.16, z, 0.7 * w)   # lintel
            if seed % 4 == 0:                      # the portal frame
                _rect(canvas, cam, 0.0, 0.0, HW, HH, z, 0.85 * w)
        self._vp(canvas, cam)


# ===========================================================================
# 9 — SCAFFOLD  (hashed beams: horizontal, vertical, diagonal braces)
# ===========================================================================
class VanishScaffoldScene(VanishScene):
    name = "vanish · scaffold"
    SPEED = 0.95

    def draw(self, canvas):
        cam = self._cam(canvas)
        for seed, z, w in self._layers():
            by = (_h(seed, 1) - 0.5) * 2.2         # a horizontal beam
            for off in (-0.035, 0.035):
                _seg(canvas, cam, (-3.0, by + off, z), (3.0, by + off, z),
                     0.6 * w, sub=3)
            bx = (_h(seed, 2) - 0.5) * 4.4         # a vertical beam
            for off in (-0.035, 0.035):
                _seg(canvas, cam, (bx + off, -1.7, z), (bx + off, 1.7, z),
                     0.6 * w, sub=2)
            if _h(seed, 3) > 0.45:                 # a diagonal brace
                dx0 = (_h(seed, 4) - 0.5) * 3.6
                _seg(canvas, cam, (dx0, -1.7, z),
                     (dx0 + (1.6 if _h(seed, 5) > 0.5 else -1.6), 1.7, z),
                     0.5 * w, sub=2)
        self._vp(canvas, cam)


# ===========================================================================
# 10 — SHARDS  (angular debris orbiting a clear centre lane)
# ===========================================================================
class VanishShardsScene(VanishScene):
    name = "vanish · shards"
    SPEED = 1.05
    SWAY = 0.05

    def draw(self, canvas):
        cam = self._cam(canvas)
        for seed, z, w in self._layers():
            for k in range(5):
                an = TAU * _h(seed, 10 + k)
                r = 0.75 + 1.75 * _h(seed, 20 + k)
                cx, cy = r * math.cos(an), r * math.sin(an) * 0.72
                s = 0.22 + 0.42 * _h(seed, 30 + k)
                ro = TAU * _h(seed, 40 + k)
                ca, sa = math.cos(ro), math.sin(ro)
                if _h(seed, 50 + k) > 0.5:         # a quad shard
                    loc = ((-s, -s * 0.6), (s, -s * 0.6),
                           (s * 0.7, s * 0.6), (-s * 0.7, s * 0.6))
                else:                              # a triangle shard
                    loc = ((-s, -s * 0.55), (s, -s * 0.55), (0.0, s * 0.8))
                pts = [(cx + x * ca - y * sa, cy + x * sa + y * ca)
                       for (x, y) in loc]
                _poly(canvas, cam, pts, z, 0.7 * w)
        self._vp(canvas, cam)


# ===========================================================================
# 11 — STRANDS  (a curtain field of vertical edges over lateral rungs)
# ===========================================================================
class VanishStrandsScene(VanishScene):
    name = "vanish · strands"

    def draw(self, canvas):
        cam = self._cam(canvas)
        for seed, z, w in self._layers():
            _seg(canvas, cam, (-3.2, -1.42, z), (3.2, -1.42, z),
                 0.4 * w, sub=3)                   # the floor rung
            for k in range(7):
                x = (_h(seed, 10 + k) - 0.5) * 4.8
                y0 = -1.42
                y1 = y0 + 0.9 + 1.9 * _h(seed, 20 + k)
                _seg(canvas, cam, (x, y0, z), (x, y1, z), 0.75 * w, sub=2)
        self._vp(canvas, cam)


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        VanishTunnelScene(),      # 1  frames + corner rails
        VanishDiamondScene(),     # 2  square/diamond weave
        VanishVaultScene(),       # 3  triple-nested ribbed bore
        VanishTwistScene(),       # 4  right-angled spiral walls
        VanishMondrianScene(),    # 5  partitioned glass panes
        VanishGridFloorScene(),   # 6  floor/ceiling lattice
        VanishCanyonScene(),      # 7  slab-building street canyon
        VanishColonnadeScene(),   # 8  pylons, lintels, portals
        VanishScaffoldScene(),    # 9  beam lattice
        VanishShardsScene(),      # 10 angular debris field
        VanishStrandsScene(),     # 11 vertical-edge curtain
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
