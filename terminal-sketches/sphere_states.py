#!/usr/bin/env python3
"""
sphere_states — one 3D sphere, eight agent states.

Every scene here is the SAME primitive: a sphere built from a Fibonacci point
lattice, back-face culled and depth-shaded so it reads as a lit, solid ball
(points facing the camera are bright solid inverts; the limb falls off to faint
dots). Each state then applies its own motion/visual to that sphere:

    1  sphere · idle        slow rotation, a soft breathing pulse
    2  sphere · listening   sonar-ping rings sweeping pole-to-pole
    3  sphere · thinking    the surface churns with turbulence (it morphs)
    4  sphere · searching   a radar meridian sweeps around, a glow trailing it
    5  sphere · processing  tight concentric wave-bands ripple over a fast spin
    6  sphere · loading     a fill "tide" rises bottom->top, points solidifying
    7  sphere · buying      particles spiral inward and merge; the equator pulses
    8  sphere · confirmed   a bloom: the sphere swells, flashes, a shockwave rings out

Same mpp vocabulary (monochrome, square/line/invert; Braille + half-block). The
shading trick — brightness from how directly a point faces the camera (its rotated
depth) — is what turns a cloud of dots into a believable 3D sphere in a terminal.

Run standalone: `python sphere_states.py` (mpp's runner: --no-motion, --banner,
--export, --scene all work).
"""

import math
import random

from mpp import Scene, _clamp, EASE, EASE_BACK, GENTLE

TAU = 2.0 * math.pi


# ===========================================================================
# Sphere engine
# ===========================================================================
def _fib_sphere(n):
    """n roughly-even unit directions on a sphere (the sunflower / Fibonacci
    lattice) — the point basis every state deforms and shades."""
    pts = []
    ga = math.pi * (3.0 - math.sqrt(5.0))
    for i in range(n):
        y = 1.0 - 2.0 * (i + 0.5) / n
        r = math.sqrt(max(0.0, 1.0 - y * y))
        a = ga * i
        pts.append((r * math.cos(a), y, r * math.sin(a)))
    return pts


def _mkview(cx, cy, s, yaw=0.0, pitch=0.0, cam=3.2):
    return (math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch),
            cam, s, cx, cy)


def _rot(x, y, z, V):
    """Rotate a world point by the view's yaw (about Y) then pitch (about X).
    Returns rotated (x1, y2, z2); z2 is depth toward the camera (bigger = nearer,
    z2>0 is the camera-facing hemisphere)."""
    cyaw, syaw, cpit, spit = V[0], V[1], V[2], V[3]
    x1 = x * cyaw + z * syaw
    z1 = -x * syaw + z * cyaw
    y2 = y * cpit - z1 * spit
    z2 = y * spit + z1 * cpit
    return x1, y2, z2


def _proj(x1, y2, z2, V):
    """Pinhole-project a rotated point. Returns (sx, sy, f) or None if culled."""
    cam, s, cx, cy = V[4], V[5], V[6], V[7]
    denom = cam - z2
    if denom <= 0.05:
        return None
    f = cam / denom
    return (cx + x1 * f * s, cy + y2 * f * s, f)


def _circle(canvas, cx, cy, r, n=64):
    """A flat screen-space dotted circle (for billboarded shockwaves)."""
    if r <= 0:
        return
    for i in range(n):
        a = TAU * i / n
        canvas.set_dot(cx + r * math.cos(a), cy + r * math.sin(a))


class SphereScene(Scene):
    """Base: renders a lat/long wireframe globe (front hemisphere + silhouette,
    the back skipped so it reads opaque) and blooms a bright solid vertex wherever
    a state's shade() lights up. Subclasses override disp()/shade()/extra()."""

    LAT = 10          # latitude divisions (poles at i=0 and i=LAT)
    LON = 18          # longitude divisions
    R = 0.62          # sphere radius, world units
    SPIN = 0.28       # yaw rate
    PITCH = 0.34      # constant camera tilt (rad)
    CAM = 3.4
    SCALE = 0.55      # world->screen scale = mind * SCALE (kept small for wide margins)
    ROCK = 0.06       # slow pitch rock amplitude
    BACK_DOTS = False # front hemisphere + silhouette only -> clean, reads opaque
    _DIRS = None

    def _dirs(self):
        cls = SphereScene
        key = (self.LAT, self.LON)
        if cls._DIRS is None or cls._DIRS[0] != key:
            grid = []
            for i in range(self.LAT + 1):
                theta = math.pi * i / self.LAT
                st, ct = math.sin(theta), math.cos(theta)
                grid.append([(st * math.cos(TAU * j / self.LON), ct,
                              st * math.sin(TAU * j / self.LON))
                             for j in range(self.LON)])
            cls._DIRS = (key, grid)
        return cls._DIRS[1]

    # -- overridable hooks -------------------------------------------------
    def disp(self, d, t):
        """Radial displacement (fraction of R) for surface direction d."""
        return 0.0

    def shade(self, d, z2, r, disp, t):
        """Highlight brightness 0..1 (>0.6 blooms a solid vertex)."""
        return 0.0

    def extra(self, canvas, V, mind, R):
        """Per-state overlays drawn after the globe (rings, particles)."""
        pass

    # -- rendering ---------------------------------------------------------
    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        yaw = self.t * self.SPIN
        pitch = self.PITCH + self.ROCK * math.sin(self.t * 0.35)
        V = _mkview(cx, cy, mind * self.SCALE, yaw=yaw, pitch=pitch, cam=self.CAM)
        R, t = self.R, self.t
        grid = []
        for row in self._dirs():
            out = []
            for d in row:
                disp = self.disp(d, t)
                r = R * (1.0 + disp)
                x1, y2, z2 = _rot(d[0] * r, d[1] * r, d[2] * r, V)
                out.append((_proj(x1, y2, z2, V), z2, d, r, disp))
            grid.append(out)

        def seg(a, b):
            pa, za = a[0], a[1]
            pb, zb = b[0], b[1]
            if not (pa and pb):
                return
            if max(za, zb) > 0.0:                       # front / silhouette: line
                canvas.line(pa[0], pa[1], pb[0], pb[1])
            elif self.BACK_DOTS:                        # far side: a hint of dots
                canvas.set_dot(pa[0], pa[1])

        for i in range(1, self.LAT):                    # latitude rings
            for j in range(self.LON):
                seg(grid[i][j], grid[i][(j + 1) % self.LON])
        for j in range(self.LON):                       # longitude lines
            for i in range(self.LAT):
                seg(grid[i][j], grid[i + 1][j])
        # bloom bright vertices where the state's shade() lights up
        for row in grid:
            for (p, z2, d, r, disp) in row:
                if not p or z2 <= 0.0:
                    continue
                light = self.shade(d, z2, r, disp, t)
                if light > 0.6:
                    canvas.square_fill(p[0], p[1],
                                       max(p[2] * 0.02 * mind, mind * 0.014))
                elif light > 0.32:
                    canvas.square_outline(p[0], p[1], max(p[2] * 0.016 * mind,
                                                          mind * 0.01))
        self.extra(canvas, V, mind, R)


# ===========================================================================
# 1 — IDLE
# ===========================================================================
class SphereIdleScene(SphereScene):
    name = "sphere · idle"
    SPIN = 0.22

    def disp(self, d, t):
        return 0.025 * math.sin(t * 0.8)       # gentle whole-body breathe

    def status(self):
        return "IDLE"


# ===========================================================================
# 2 — LISTENING  (sonar pings sweeping pole -> pole)
# ===========================================================================
class SphereListeningScene(SphereScene):
    name = "sphere · listening"
    SPIN = 0.12
    PING = 1.25        # ping speed
    SPAN = math.pi + 0.7

    def _band(self, d, t):
        theta = math.acos(_clamp(d[1], -1.0, 1.0))     # 0 north .. pi south
        ping = (t * self.PING) % self.SPAN
        return theta - ping

    def disp(self, d, t):
        b = self._band(d, t)
        return 0.07 * math.exp(-(b * b) / 0.05)        # a bulging ring

    def shade(self, d, z2, r, disp, t):
        b = self._band(d, t)
        return math.exp(-(b * b) / 0.03)               # only the ping ring glows

    def status(self):
        return "LISTENING"


# ===========================================================================
# 3 — THINKING  (turbulent surface churn)
# ===========================================================================
class SphereThinkingScene(SphereScene):
    name = "sphere · thinking"
    SPIN = 0.3

    def _turb(self, d, t):
        x, y, z = d
        return ((math.sin(2.5 * x + t) + math.sin(2.5 * y - 1.3 * t)
                 + math.sin(2.5 * z + 0.7 * t)) / 3.0
                + 0.5 * math.sin(4.0 * x * y - 0.6 * t)
                + 0.4 * math.sin(3.3 * y * z + 0.9 * t))

    def disp(self, d, t):
        return 0.11 * self._turb(d, t)

    def shade(self, d, z2, r, disp, t):
        return _clamp(3.5 * max(0.0, disp), 0.0, 1.0)  # bulging crests bloom

    def status(self):
        return "THINKING"


# ===========================================================================
# 4 — SEARCHING  (radar meridian sweep + trailing glow)
# ===========================================================================
class SphereSearchingScene(SphereScene):
    name = "sphere · searching"
    SPIN = 0.18
    SWEEP = 1.5

    def shade(self, d, z2, r, disp, t):
        phi = math.atan2(d[2], d[0])
        dphi = (t * self.SWEEP - phi) % TAU            # angle since the beam passed
        return math.exp(-dphi * 2.6)                   # the beam + a fading trail

    def status(self):
        return "SEARCHING"


# ===========================================================================
# 5 — PROCESSING  (tight concentric wave-bands + fast spin)
# ===========================================================================
class SphereProcessingScene(SphereScene):
    name = "sphere · processing"
    SPIN = 0.85
    K = 7.0
    RATE = 4.0

    def disp(self, d, t):
        theta = math.acos(_clamp(d[1], -1.0, 1.0))
        return 0.05 * math.sin(theta * self.K - t * self.RATE)

    def shade(self, d, z2, r, disp, t):
        theta = math.acos(_clamp(d[1], -1.0, 1.0))
        band = 0.5 + 0.5 * math.sin(theta * self.K - t * self.RATE)
        return band * band                             # crest bands bloom bright

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 6 — LOADING  (a fill tide rising bottom -> top)
# ===========================================================================
class SphereLoadingScene(SphereScene):
    name = "sphere · loading"
    SPIN = 0.25
    PITCH = 0.0        # upright axis so the waterline reads horizontal
    ROCK = 0.0
    CYCLE = 3.2

    def _level(self, t):
        return -1.0 + 2.0 * ((t / self.CYCLE) % 1.0)   # -1 .. +1

    def shade(self, d, z2, r, disp, t):
        return 1.0 if d[1] <= self._level(t) else 0.0        # filled cap blooms

    def extra(self, canvas, V, mind, R):
        # a bright waterline ring at the current fill level
        yy = _clamp(self._level(self.t), -0.97, 0.97)
        rr = R * math.sqrt(max(0.0, 1.0 - yy * yy))
        prev = None
        for i in range(41):
            a = TAU * i / 40
            x1, y2, z2 = _rot(rr * math.cos(a), R * yy, rr * math.sin(a), V)
            cur = _proj(x1, y2, z2, V) if z2 > 0.0 else None
            if cur and prev:
                canvas.line(prev[0], prev[1], cur[0], cur[1])
            prev = cur

    def status(self):
        return "LOADING"


# ===========================================================================
# 7 — BUYING  (particles spiral inward, equator pulses)
# ===========================================================================
class SphereBuyingScene(SphereScene):
    name = "sphere · buying"
    SPIN = 0.2
    CYCLE = 2.4
    N_P = 14

    def shade(self, d, z2, r, disp, t):
        u = (t / self.CYCLE) % 1.0
        if u > 0.72:                                   # equator flares on merge
            return EASE((u - 0.72) / 0.28) * math.exp(-(d[1] ** 2) / 0.02)
        return 0.0

    def extra(self, canvas, V, mind, R):
        u = (self.t / self.CYCLE) % 1.0
        for k in range(self.N_P):
            a0 = TAU * k / self.N_P
            pu = _clamp(u / 0.72 - (k % 4) * 0.04, 0.0, 1.0)
            e = EASE(pu)
            rad = 1.9 * R * (1.0 - e) + R * e
            ang = a0 + pu * 4.2                          # spiral inward
            x, y, z = rad * math.cos(ang), 0.0, rad * math.sin(ang)
            x1, y2, z2 = _rot(x, y, z, V)
            p = _proj(x1, y2, z2, V)
            if p and pu < 0.999:
                canvas.square_fill(p[0], p[1], max(p[2] * 0.02 * mind, mind * 0.014))
        # a bright equatorial ring pulsing outward as they merge
        if u > 0.72:
            rr = R * (1.0 + 0.6 * EASE((u - 0.72) / 0.28))
            prev = None
            for i in range(49):
                a = TAU * i / 48
                x1, y2, z2 = _rot(rr * math.cos(a), 0.0, rr * math.sin(a), V)
                cur = _proj(x1, y2, z2, V) if z2 > -0.1 else None
                if cur and prev:
                    canvas.line(prev[0], prev[1], cur[0], cur[1])
                prev = cur

    def status(self):
        return "BUYING"


# ===========================================================================
# 8 — CONFIRMED  (bloom: swell, flash, shockwave)
# ===========================================================================
class SphereConfirmedScene(SphereScene):
    name = "sphere · confirmed"
    SPIN = 0.3
    CYCLE = 2.6

    def _amp(self, t):
        u = (t / self.CYCLE) % 1.0
        swell = EASE_BACK(_clamp(u / 0.26, 0.0, 1.0))
        relax = EASE(_clamp((u - 0.62) / 0.38, 0.0, 1.0))
        return swell * (1.0 - relax)

    def disp(self, d, t):
        return 0.2 * self._amp(t)

    def shade(self, d, z2, r, disp, t):
        u = (t / self.CYCLE) % 1.0
        return 1.0 - EASE(_clamp((u - 0.12) / 0.5, 0.0, 1.0))   # whole sphere flashes

    def extra(self, canvas, V, mind, R):
        u = (self.t / self.CYCLE) % 1.0
        if 0.1 < u < 0.72:                               # billboarded shockwave
            sr = EASE((u - 0.1) / 0.62)
            base = R * V[5]                              # sphere's on-screen radius
            _circle(canvas, V[6], V[7], base * (1.2 + sr * 1.4), n=72)

    def status(self):
        return "CONFIRMED"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        SphereIdleScene(),           # 1  idle
        SphereListeningScene(),      # 2  listening
        SphereThinkingScene(),       # 3  thinking
        SphereSearchingScene(),      # 4  searching
        SphereProcessingScene(),     # 5  processing
        SphereLoadingScene(),        # 6  loading
        SphereBuyingScene(),         # 7  buying
        SphereConfirmedScene(),      # 8  confirmed
    ]


if __name__ == "__main__":
    import mpp

    mpp.main(make_scenes())
