#!/usr/bin/env python3
"""
wire_cycle — eight wire figures from the sketch sheet, each given a life cycle.

Every scene is the same idea: a figure built from thin 3D wires (rings, arcs,
paths — all rendered as plain one-dot braille hairlines through a pinhole
camera), which ASSEMBLES sequentially, holds with one slow spatial motion,
then DISASSEMBLES sequentially, leaving a truly empty frame before the next
cycle. Entrances and exits are always staggered: element k gets its own
ease-in-out-expo window, the windows overlapping so a front sweeps through
the figure. Wires draw themselves on (a pen running along the path) and are
erased by a chase (the start catches up with the end), so lines travel —
they never pop.

All motion runs on cycle-local time, so every cycle is byte-identical and
the loop closes exactly at the empty frame. Camera is dead-on; each scene
bakes its own viewing tilt into the geometry.

    1  wire · rosette   four tilted circles fanned about the centre; they
                        pen on one after another, the rosette slowly yaws
    2  wire · slinky    a stack of rings drops in from above, each flattening
                        onto the pile as it lands; a compression wave rolls
                        down the chain; they spring back up to leave
    3  wire · unfurl    a flat arc low in the frame grows, arc by arc, into
                        a full standing ellipse — the trail of a roll-up;
                        the chain undulates while it holds
    4  wire · orbits    six great circles at spread inclinations pen on in
                        sequence into a wireframe sphere that slowly turns
    5  wire · coil      one ring pens on, then two more slide out of it
                        along the shared axis; the gap breathes; they merge
                        back and the last ring pens off
    6  wire · cascade   rounded cards recede into depth up a diagonal; each
                        pens on as it arrives from deep; a bob ripples
                        through the row
    7  wire · plume     arcs grow out of a single point, fanning around an
                        axis into an open pod that spins about its stem
    8  wire · chevron   a stack of zig-zag ribbons seen from above; each
                        draws left to right down the stack; the folds flex
                        in a staggered accordion wave

Timing, in cycle units: intro over [0, T_IN], hold over [T_IN, T_OUT], outro
over [T_OUT, 1]. All easing is ease-in-out-expo; the stagger is the solved
window stagger (the last element lands exactly at the phase end).

Run: `python wire_cycle.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from serp_flux import Cam
from listen_cycle import _expo, _stag

TAU = 2.0 * math.pi
Z = 4.6            # depth of every figure's centre, world units


def _rx(p, t):
    c, s = math.cos(t), math.sin(t)
    return (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c)


def _ry(p, t):
    c, s = math.cos(t), math.sin(t)
    return (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c)


def _rz(p, t):
    c, s = math.cos(t), math.sin(t)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def _norm(p):
    d = math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
    return (p[0] / d, p[1] / d, p[2] / d)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _cut(pts, f0, f1):
    """The piece of polyline `pts` between arclength fractions f0..f1 —
    the draw-on / chase-erase primitive for every wire."""
    f0, f1 = max(f0, 0.0), min(f1, 1.0)
    if f1 - f0 <= 1e-4 or len(pts) < 2:
        return []
    L = [0.0]
    for a, b in zip(pts, pts[1:]):
        L.append(L[-1] + math.dist(a, b))
    tot = L[-1]
    if tot <= 0.0:
        return []

    def at(d):
        for i in range(1, len(L)):
            if d <= L[i] or i == len(L) - 1:
                a, b = pts[i - 1], pts[i]
                seg = L[i] - L[i - 1]
                w = 0.0 if seg <= 0.0 else (d - L[i - 1]) / seg
                return (a[0] + (b[0] - a[0]) * w,
                        a[1] + (b[1] - a[1]) * w,
                        a[2] + (b[2] - a[2]) * w)

    out = [at(f0 * tot)]
    for i in range(1, len(pts) - 1):
        if f0 * tot < L[i] < f1 * tot:
            out.append(pts[i])
    out.append(at(f1 * tot))
    return out


# ===========================================================================
# Base: the wire figure life cycle
# ===========================================================================
class WireScene(Scene):
    """Phases, stagger, camera and the hairline renderer. A scene's draw()
    calls _begin() for (u, tl, a, b, cam), asks _pres()/_span() for each
    element's state, and pushes 3D polylines through _poly()."""

    CYCLE = 9.00
    T_IN = 0.26        # intro ends
    T_OUT = 0.74       # outro begins
    W = 0.55           # stagger window width (overlap between elements)
    FOV = 1.45

    def _begin(self, canvas):
        u = (self.t % self.CYCLE) / self.CYCLE
        tl = u * self.CYCLE
        a = _clamp(u / self.T_IN, 0.0, 1.0)
        b = _clamp((u - self.T_OUT) / (1.0 - self.T_OUT), 0.0, 1.0)
        return u, tl, a, b, Cam(canvas, (0.0, 0.0, 0.0), fov=self.FOV)

    def _pres(self, i, n, a, b):
        """Element i's presence 0..1: in on a's window, out on b's."""
        return _stag(a, i, n, self.W) * (1.0 - _stag(b, i, n, self.W))

    def _span(self, i, n, a, b):
        """Draw-on span (f0, f1): the pen end leads on the intro, the tail
        end chases on the outro, so the wire travels its own path."""
        return _stag(b, i, n, self.W), _stag(a, i, n, self.W)

    def _poly(self, canvas, cam, pts):
        prev = None
        for p in pts:
            cur = cam.project(p[0], p[1], p[2] + Z)
            if cur and prev:
                canvas.line(prev[0], prev[1], cur[0], cur[1])
            prev = cur

    def _arc(self, canvas, cam, c, ux, uy, f0, f1, n=72):
        """Arc f0..f1 (fractions of a turn) of the ellipse c + ux cos + uy sin."""
        if f1 - f0 <= 0.004:
            return
        steps = max(3, int(n * (f1 - f0)) + 1)
        pts = []
        for k in range(steps + 1):
            th = TAU * (f0 + (f1 - f0) * k / steps)
            co, si = math.cos(th), math.sin(th)
            pts.append((c[0] + ux[0] * co + uy[0] * si,
                        c[1] + ux[1] * co + uy[1] * si,
                        c[2] + ux[2] * co + uy[2] * si))
        self._poly(canvas, cam, pts)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "ENTER"
        return "HOLD" if u < self.T_OUT else "EXIT"


# ===========================================================================
# 1 — ROSETTE: four tilted circles fanned about the centre
# ===========================================================================
class RosetteScene(WireScene):
    name = "wire · rosette"
    K = 4
    R = 1.0
    TILT = 0.95     # how far each ring leans out of the view plane
    RATE = 0.20     # slow yaw of the whole rosette, rad/s
    FOV = 1.45

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        yaw = tl * self.RATE
        for k in range(self.K):
            f0, f1 = self._span(k, self.K, a, b)
            if f1 - f0 <= 0.004:
                continue
            ph = math.pi * k / self.K
            e1 = (math.cos(ph), math.sin(ph), 0.0)
            e2 = (-math.sin(ph), math.cos(ph), 0.0)
            ct, st = math.cos(self.TILT), math.sin(self.TILT)
            ux = _ry((e1[0] * self.R, e1[1] * self.R, 0.0), yaw)
            uy = _ry((e2[0] * ct * self.R, e2[1] * ct * self.R, st * self.R),
                     yaw)
            self._arc(canvas, cam, (0.0, 0.0, 0.0), ux, uy, f0, f1)


# ===========================================================================
# 2 — SLINKY: rings drop in and flatten onto the pile
# ===========================================================================
class SlinkyScene(WireScene):
    name = "wire · slinky"
    N = 5
    R = 1.0
    LOOK = -0.24    # scene tilted so flat rings read as thin ellipses
    WAVE = 0.075    # compression-wave amplitude, in chain units
    RATE = 0.42     # wave speed, cycles/s
    LAG = 1.15      # wave phase lag per ring
    FOV = 0.90

    # the chain path: w<0 is above the frame (face-on), w=1 is flat on the
    # floor. Ring i rests at w = i/(N-1), so the pile is the sketch. The
    # start (w = -DROP) puts the ring's LOWEST point above the frame top
    # (2.56 world units at this FOV), so entries slide in, never pop.
    DROP = 1.05

    def _state(self, w):
        y = 1.02 - 1.92 * _clamp(w, 0.0, 1.0) - min(w, 0.0) * 2.6
        tilt = _clamp(w, 0.0, 1.0) * 1.47
        return y, tilt

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        for i in range(self.N):
            p = self._pres(i, self.N, a, b)
            if p <= 0.0:
                continue
            rest = i / (self.N - 1.0)
            w = -self.DROP + (rest + self.DROP) * p
            w += self.WAVE * p * math.sin(TAU * self.RATE * tl - self.LAG * i)
            y, tilt = self._state(w)
            ct, st = math.cos(tilt), math.sin(tilt)
            c = _rx((0.0, y, 0.0), self.LOOK)
            ux = _rx((self.R, 0.0, 0.0), self.LOOK)
            uy = _rx((0.0, self.R * ct, self.R * st), self.LOOK)
            self._arc(canvas, cam, c, ux, uy, 0.0, 1.0)


# ===========================================================================
# 3 — UNFURL: a flat arc rolls up, stage by stage, into a standing ellipse
# ===========================================================================
class UnfurlScene(WireScene):
    name = "wire · unfurl"
    N = 9
    ORIENT = 0.55   # in-plane lean of the whole trail
    WAVE = 0.045    # undulation along the chain during the hold
    RATE = 0.38
    LAG = 2.10
    FOV = 1.10

    def _stage(self, s):
        """Geometry of chain stage s in [0,1]: centre, radius, arc span,
        and tilt (edge-on flat arc at 0 -> open standing ellipse at 1)."""
        c = (-0.95 + 1.45 * s, -0.62 + 1.02 * s, 0.0)
        r = 0.52 + 0.42 * s
        span = 0.30 + 0.70 * s
        tilt = 1.32 - 0.80 * s
        return c, r, span, tilt

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        for i in range(self.N):
            f0, f1 = self._span(i, self.N, a, b)
            if f1 - f0 <= 0.004:
                continue
            s = i / (self.N - 1.0)
            s = _clamp(s + self.WAVE * math.sin(TAU * self.RATE * tl
                                                - self.LAG * s), 0.0, 1.0)
            c, r, span, tilt = self._stage(s)
            c = _rz(c, self.ORIENT)
            ux = _rz(_rx((r, 0.0, 0.0), tilt), self.ORIENT)
            uy = _rz(_rx((0.0, r, 0.0), tilt), self.ORIENT)
            base = 0.5 - span / 2.0     # arc centred on the top of the ring
            self._arc(canvas, cam, c, ux, uy,
                      base + span * f0, base + span * f1)


# ===========================================================================
# 4 — ORBITS: six great circles pen on into a wireframe sphere
# ===========================================================================
class OrbitsScene(WireScene):
    name = "wire · orbits"
    M = 6
    R = 1.0
    RATE = 0.24     # slow turn of the assembled sphere, rad/s
    FOV = 1.45

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        yaw = tl * self.RATE
        for m in range(self.M):
            f0, f1 = self._span(m, self.M, a, b)
            if f1 - f0 <= 0.004:
                continue
            tilt = 0.35 + 1.05 * m / (self.M - 1.0)
            node = m * 2.4
            ux = _ry(_rz(_rx((self.R, 0.0, 0.0), tilt), node), yaw)
            uy = _ry(_rz(_rx((0.0, self.R, 0.0), tilt), node), yaw)
            self._arc(canvas, cam, (0.0, 0.0, 0.0), ux, uy, f0, f1)


# ===========================================================================
# 5 — COIL: two rings slide out of a first along the shared axis
# ===========================================================================
class CoilScene(WireScene):
    name = "wire · coil"
    R = 1.0
    GAP = 0.46
    AXIS = (0.55, 0.45, -0.70)
    BREATH = 0.30   # gap breathing amplitude during the hold
    RATE = 0.30
    SPIN = 0.14     # slow yaw of the whole coil, rad/s
    FOV = 1.30
    OFFS = (0.0, 1.0, -1.0)   # assembly order: centre ring, then out, then out

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        n = _norm(self.AXIS)
        p1 = _norm(_cross(n, (0.0, 1.0, 0.0)))
        p2 = _cross(n, p1)
        yaw = tl * self.SPIN
        for j, d in enumerate(self.OFFS):
            p = self._pres(j, 3, a, b)
            f0, f1 = self._span(j, 3, a, b)
            if f1 - f0 <= 0.004:
                continue
            off = self.GAP * d * p
            off *= 1.0 + self.BREATH * p * math.sin(TAU * self.RATE * tl
                                                    - 0.8 * j)
            c = _ry((n[0] * off, n[1] * off, n[2] * off), yaw)
            ux = _ry((p1[0] * self.R, p1[1] * self.R, p1[2] * self.R), yaw)
            uy = _ry((p2[0] * self.R, p2[1] * self.R, p2[2] * self.R), yaw)
            self._arc(canvas, cam, c, ux, uy, f0, f1)


# ===========================================================================
# 6 — CASCADE: rounded cards receding into depth up a diagonal
# ===========================================================================
class CascadeScene(WireScene):
    name = "wire · cascade"
    N = 6
    # every card lies in ONE tilted plane (a surface receding up-right), and
    # they step along the plane's uphill axis with a gap wider than a card —
    # so they can never intersect, whatever the camera does. Free per-card
    # tilts looked like the sketch on paper and rendered as a pile-up.
    TILT = 0.35     # lay the plane back only slightly — the sketch's cards
                    # read nearly face-on; steeper tilts collapse them into
                    # slivers that interleave on screen
    ROT = -0.55     # swing the plane to the diagonal (rotate about z)
    GAP = 0.66      # per-card step along the uphill axis, > card height
    W0, H0 = 0.95, 0.42         # card size in the plane (long, pill-like)
    SHRINK = 0.86   # explicit shrink; the shallow tilt gives little depth
    SLIDE = 2.0     # how far up the plane (deeper) a card starts — past the
                    # top corner, so entries arrive from off-frame up-right
    BOB = 0.05
    RATE = 0.36
    LAG = 0.95
    FOV = 1.00

    def _rrect(self, c, ew, eh, w, h, r, n=56):
        """A rounded rectangle in the (ew, eh) plane, as a closed polyline."""
        pts = []
        hw, hh = w / 2.0 - r, h / 2.0 - r
        # corner centres, walked in order; each corner sweeps a quarter turn
        corners = ((hw, hh, 0.25), (-hw, hh, 0.50),
                   (-hw, -hh, 0.75), (hw, -hh, 1.00))
        for (qx, qy, qe) in corners:
            q0 = qe - 0.25
            for k in range(n // 4 + 1):
                th = TAU * (q0 + 0.25 * k / (n // 4))
                lx = qx + r * math.cos(th)
                ly = qy + r * math.sin(th)
                pts.append((c[0] + ew[0] * lx + eh[0] * ly,
                            c[1] + ew[1] * lx + eh[1] * ly,
                            c[2] + ew[2] * lx + eh[2] * ly))
        pts.append(pts[0])
        return pts

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        ex = _rz(_rx((1.0, 0.0, 0.0), self.TILT), self.ROT)   # across the plane
        ey = _rz(_rx((0.0, 1.0, 0.0), self.TILT), self.ROT)   # uphill, deeper
        for i in range(self.N):
            p = self._pres(i, self.N, a, b)
            f0, f1 = self._span(i, self.N, a, b)
            if f1 - f0 <= 0.004:
                continue
            k = i - (self.N - 1) / 2.0
            d = k * self.GAP + (1.0 - p) * self.SLIDE \
                + self.BOB * p * math.sin(TAU * self.RATE * tl - self.LAG * i)
            c = (ey[0] * d, ey[1] * d, ey[2] * d)
            sc = self.SHRINK ** i
            pts = self._rrect(c, ex, ey, self.W0 * sc, self.H0 * sc,
                              0.15 * sc)
            self._poly(canvas, cam, _cut(pts, f0, f1))


# ===========================================================================
# 7 — PLUME: arcs grow out of one point, fanning around an axis
# ===========================================================================
class PlumeScene(WireScene):
    name = "wire · plume"
    M = 10
    R = 1.0
    REACH = 0.78    # how far around the sphere each arc runs (fraction of pi)
    AXIS = (-0.92, 0.10, -0.36)
    SPIN = 0.36     # revolution of the fan about its stem, rad/s
    FOV = 1.35

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        ax = _norm(self.AXIS)
        p1 = _norm(_cross(ax, (0.0, 1.0, 0.0)))
        p2 = _cross(ax, p1)
        spin = tl * self.SPIN
        for m in range(self.M):
            p = self._pres(m, self.M, a, b)
            if p <= 0.001:
                continue
            psi = TAU * m / self.M + spin
            bx = (p1[0] * math.cos(psi) + p2[0] * math.sin(psi),
                  p1[1] * math.cos(psi) + p2[1] * math.sin(psi),
                  p1[2] * math.cos(psi) + p2[2] * math.sin(psi))
            reach = p * self.REACH * math.pi
            steps = max(3, int(40 * p))
            pts = []
            for k in range(steps + 1):
                th = reach * k / steps
                co, si = math.cos(th), math.sin(th)
                pts.append((self.R * (co * ax[0] + si * bx[0]),
                            self.R * (co * ax[1] + si * bx[1]),
                            self.R * (co * ax[2] + si * bx[2])))
            self._poly(canvas, cam, pts)


# ===========================================================================
# 8 — CHEVRON: a stack of zig-zag ribbons, folds flexing in a wave
# ===========================================================================
class ChevronScene(WireScene):
    name = "wire · chevron"
    N = 8
    XS = (-1.30, -0.65, 0.0, 0.65, 1.30)
    ZAMP = 0.52     # fold depth of the zig-zag
    YSPAN = 1.05    # height of the stack
    LOOK = -0.60    # looking down at the stack, so depth reads as height
    FLEX = 0.17     # accordion amplitude during the hold
    RATE = 0.34
    LAG = 0.80
    FOV = 1.40

    def draw(self, canvas):
        u, tl, a, b, cam = self._begin(canvas)
        for i in range(self.N):
            f0, f1 = self._span(i, self.N, a, b)
            if f1 - f0 <= 0.004:
                continue
            y = -self.YSPAN / 2.0 + self.YSPAN * i / (self.N - 1.0)
            amp = self.ZAMP * (1.0 + self.FLEX
                               * math.sin(TAU * self.RATE * tl - self.LAG * i))
            pts = []
            for k, x in enumerate(self.XS):
                z = amp if k % 2 else -amp
                pts.append(_rx((x, y, z), self.LOOK))
            self._poly(canvas, cam, _cut(pts, f0, f1))


# ===========================================================================
# The phases have to nest, or an element is orphaned mid-flight
# ===========================================================================
def _selfcheck():
    c = WireScene
    assert 0.0 < c.T_IN < c.T_OUT < 1.0, "wire_cycle: phases out of order"
    assert 0.0 < c.W <= 1.0, "wire_cycle: stagger window out of range"


_selfcheck()


def make_scenes():
    return [
        RosetteScene(),      # 1  fanned circles
        SlinkyScene(),       # 2  rings dropping onto a pile
        UnfurlScene(),       # 3  arc rolling up into an ellipse
        OrbitsScene(),       # 4  great-circle sphere
        CoilScene(),         # 5  rings sliding along a shared axis
        CascadeScene(),      # 6  cards receding into depth
        PlumeScene(),        # 7  arcs fanning from a point
        ChevronScene(),      # 8  stacked zig-zags
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
