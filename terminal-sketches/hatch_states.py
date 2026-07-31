#!/usr/bin/env python3
"""
hatch_states — eight agent states on the scene-17 HATCHED SPHERE.

The basis is `scenes.py`'s scene 17 (HatchSphereScene): a latitude/longitude
globe where every front-facing sample is drawn as one short horizontal scanline
tick (`_dash`), so the surface reads as dense hatching, and the pole is leaned
toward the camera so its latitude rings stack into a concentric vortex.

Here that hatched globe is the shared primitive, and each state applies its own
motion/visual by modulating two things per surface sample:

    • bright(...)  -> the hatch-tick LENGTH (longer = denser hatch = brighter;
                      short collapses to a dot = darker), the shading lever
    • disp(...)    -> a RADIAL displacement (the globe deforms / breathes)

plus per-state spin, the pole vortex, and optional overlays.

    1  hatch · idle        a slow-turning hatched globe, softly breathing
    2  hatch · listening   a bright hatch-ring pings pole -> pole
    3  hatch · thinking    the hatched surface churns with turbulence
    4  hatch · searching   a bright meridian of hatching sweeps around, trailing
    5  hatch · processing  concentric hatch-bands ripple out of the pole vortex, fast spin
    6  hatch · loading     a fill tide: dense hatch below a rising line, sparse above
    7  hatch · buying      ticks spiral inward to the equator, which flares dense
    8  hatch · confirmed   the globe swells, the hatch flashes solid, a ring rings out

Same mpp vocabulary. Run standalone: `python hatch_states.py`.
"""

import math

from mpp import Scene, _clamp, EASE, EASE_BACK
from scenes import _dash

TAU = 2.0 * math.pi


def _expo(x):
    """easeInOutExpo."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


# ===========================================================================
# Hatched-sphere engine (scene 17's projection, opened up with hooks)
# ===========================================================================
class HatchScene(Scene):
    N_LAT = 44            # latitude scanline bands
    LON_MAX = 132         # longitude samples at the equator
    RADIUS_FRAC = 0.34    # sphere radius as a fraction of the short axis
    SPIN = 0.32           # yaw, radians / second
    TILT = 0.46           # pole leaned toward the camera (radians)
    TILT_WOBBLE = 0.16    # gentle nod amplitude
    TILT_RATE = 0.5
    FOCAL_FRAC = 3.0      # perspective focal distance, in radius units
    DASH = 1.7            # scanline half-length at the near plane
    EPS = 0.05            # cull the grazing limb for a crisp silhouette

    # -- hooks -------------------------------------------------------------
    def disp(self, ux, uy, uz, theta, t):
        """Radial displacement (fraction of R) for this surface direction."""
        return 0.0

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        """Hatch-tick length multiplier (1 = normal, >1 brighter, <1 dimmer)."""
        return 1.0

    def extra(self, canvas, cx, cy, R, V, t):
        """Overlays after the globe. V = (cyaw, syaw, ct, st, focal)."""
        pass

    # -- render ------------------------------------------------------------
    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R = min(wu, hu) * self.RADIUS_FRAC
        t = self.t
        yaw = t * self.SPIN
        tilt = self.TILT + self.TILT_WOBBLE * math.sin(t * self.TILT_RATE)
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        ct, st = math.cos(tilt), math.sin(tilt)
        focal = self.FOCAL_FRAC * R
        DASH = self.DASH
        for li in range(1, self.N_LAT):
            theta = math.pi * li / self.N_LAT
            sint, cost = math.sin(theta), math.cos(theta)
            nlon = max(6, int(self.LON_MAX * sint))
            for j in range(nlon):
                phi = TAU * j / nlon
                ux = sint * math.cos(phi)
                uz = sint * math.sin(phi)
                uy = cost
                x1 = ux * cyaw + uz * syaw           # yaw about Y
                z1 = -ux * syaw + uz * cyaw
                y2 = uy * ct - z1 * st                # lean the pole forward
                z2 = uy * st + z1 * ct
                if z2 <= self.EPS:                    # front hemisphere only
                    continue
                rr = R * (1.0 + self.disp(ux, uy, uz, theta, t))
                f = focal / (focal - z2 * rr)
                px = cx + x1 * rr * f
                py = cy - y2 * rr * f
                half = (DASH * f * (0.45 + 0.55 * z2)
                        * self.bright(ux, uy, uz, theta, phi, z2, t))
                if half > 0.0:
                    _dash(canvas, px, py, half)
        self.extra(canvas, cx, cy, R, (cyaw, syaw, ct, st, focal), t)

    # -- shared: project an arbitrary world point (for overlays) -----------
    @staticmethod
    def _project(wx, wy, wz, cx, cy, R, V):
        cyaw, syaw, ct, st, focal = V
        x1 = wx * cyaw + wz * syaw
        z1 = -wx * syaw + wz * cyaw
        y2 = wy * ct - z1 * st
        z2 = wy * st + z1 * ct
        f = focal / (focal - z2 * R)
        return cx + x1 * R * f, cy - y2 * R * f, z2, f


# ===========================================================================
# 1 — IDLE
# ===========================================================================
class HatchIdleScene(HatchScene):
    name = "hatch · idle"
    SPIN = 0.24

    def disp(self, ux, uy, uz, theta, t):
        return 0.03 * math.sin(t * 0.8)

    def status(self):
        return "IDLE"


# ===========================================================================
# 2 — LISTENING  (a hatch-ring pings pole -> pole)
# ===========================================================================
class HatchListeningScene(HatchScene):
    name = "hatch · listening"
    SPIN = 0.12
    PING = 1.2
    SPAN = math.pi + 0.7

    def _band(self, theta, t):
        return theta - (t * self.PING) % self.SPAN

    def disp(self, ux, uy, uz, theta, t):
        b = self._band(theta, t)
        return 0.05 * math.exp(-(b * b) / 0.03)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        b = self._band(theta, t)
        return 0.55 + 1.3 * math.exp(-(b * b) / 0.02)

    def status(self):
        return "LISTENING"


# ===========================================================================
# 3 — THINKING  (turbulent hatch churn)
# ===========================================================================
class HatchThinkingScene(HatchScene):
    name = "hatch · thinking"
    SPIN = 0.28

    def _turb(self, ux, uy, uz, t):
        return ((math.sin(2.5 * ux + t) + math.sin(2.5 * uy - 1.3 * t)
                 + math.sin(2.5 * uz + 0.7 * t)) / 3.0
                + 0.5 * math.sin(4.0 * ux * uy - 0.6 * t))

    def disp(self, ux, uy, uz, theta, t):
        return 0.10 * self._turb(ux, uy, uz, t)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        return 0.6 + 1.4 * max(0.0, self._turb(ux, uy, uz, t))

    def status(self):
        return "THINKING"


# ===========================================================================
# 4 — SEARCHING  (a meridian of hatching sweeps around, trailing)
# ===========================================================================
class HatchSearchingScene(HatchScene):
    name = "hatch · searching"
    SPIN = 0.1
    SWEEP = 1.5

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        # world longitude of this sample (undo the spin so the beam is its own motion)
        world_phi = phi + t * self.SPIN
        dphi = (t * self.SWEEP - world_phi) % TAU
        return 0.5 + 1.4 * math.exp(-dphi * 2.6)

    def status(self):
        return "SEARCHING"


# ===========================================================================
# 5 — PROCESSING  (concentric hatch-bands ripple out of the vortex, fast spin)
# ===========================================================================
class HatchProcessingScene(HatchScene):
    name = "hatch · processing"
    SPIN = 0.8
    K = 7.0
    RATE = 4.0

    def disp(self, ux, uy, uz, theta, t):
        return 0.04 * math.sin(theta * self.K - t * self.RATE)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        band = 0.5 + 0.5 * math.sin(theta * self.K - t * self.RATE)
        return 0.5 + 1.2 * band * band

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 6 — LOADING  (a fill tide: dense hatch below a rising line)
# ===========================================================================
class HatchLoadingScene(HatchScene):
    name = "hatch · loading"
    SPIN = 0.22
    CYCLE = 3.4

    def _level(self, t):
        return 1.0 - 2.0 * ((t / self.CYCLE) % 1.0)   # +1 (north) -> -1 (south)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        level = self._level(t)
        if uy >= level:                               # filled cap (from the top)
            edge = math.exp(-((uy - level) ** 2) / 0.006)
            return 1.25 + 0.9 * edge                  # bright, brighter at waterline
        return 0.28                                   # unfilled: sparse dots

    def status(self):
        return "LOADING"


# ===========================================================================
# 7 — BUYING  (ticks spiral inward to the equator, which flares dense)
# ===========================================================================
class HatchBuyingScene(HatchScene):
    name = "hatch · buying"
    SPIN = 0.18
    CYCLE = 2.4
    N_P = 16

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        u = (t / self.CYCLE) % 1.0
        if u > 0.72:                                  # equator flares on merge
            flare = EASE((u - 0.72) / 0.28) * math.exp(-(uy * uy) / 0.02)
            return 1.0 + 1.3 * flare
        return 0.85

    def extra(self, canvas, cx, cy, R, V, t):
        u = (t / self.CYCLE) % 1.0
        for k in range(self.N_P):
            a0 = TAU * k / self.N_P
            pu = _clamp(u / 0.72 - (k % 4) * 0.04, 0.0, 1.0)
            if pu >= 0.999:
                continue
            e = EASE(pu)
            rad = 1.9 * (1.0 - e) + 1.0 * e           # 1.9R -> R, in unit radii
            ang = a0 + pu * 4.2                        # spiral inward
            px, py, z2, f = self._project(rad * math.cos(ang), 0.0,
                                          rad * math.sin(ang), cx, cy, R, V)
            if z2 > 0.0:
                _dash(canvas, px, py, 1.6 * f)

    def status(self):
        return "BUYING"


# ===========================================================================
# 8 — CONFIRMED  (swell, hatch flashes solid, a ring rings out)
# ===========================================================================
class HatchConfirmedScene(HatchScene):
    name = "hatch · confirmed"
    SPIN = 0.3
    CYCLE = 2.6

    def _amp(self, t):
        u = (t / self.CYCLE) % 1.0
        swell = EASE_BACK(_clamp(u / 0.26, 0.0, 1.0))
        relax = EASE(_clamp((u - 0.62) / 0.38, 0.0, 1.0))
        return swell * (1.0 - relax)

    def disp(self, ux, uy, uz, theta, t):
        return 0.16 * self._amp(t)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        u = (t / self.CYCLE) % 1.0
        flash = 1.0 - EASE(_clamp((u - 0.12) / 0.5, 0.0, 1.0))
        return 0.7 + 1.3 * flash

    def extra(self, canvas, cx, cy, R, V, t):
        u = (t / self.CYCLE) % 1.0
        if 0.1 < u < 0.72:                            # a hatched shockwave ring
            sr = EASE((u - 0.1) / 0.62)
            rr = R * (1.15 + sr * 1.5)
            n = max(24, int(rr * 0.6))
            for k in range(n):
                a = TAU * k / n
                _dash(canvas, cx + rr * math.cos(a), cy + rr * math.sin(a), 1.4)

    def status(self):
        return "CONFIRMED"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        HatchIdleScene(),          # 1  idle
        HatchListeningScene(),     # 2  listening
        HatchThinkingScene(),      # 3  thinking
        HatchSearchingScene(),     # 4  searching
        HatchProcessingScene(),    # 5  processing
        HatchLoadingScene(),       # 6  loading
        HatchBuyingScene(),        # 7  buying
        HatchConfirmedScene(),     # 8  confirmed
    ]


if __name__ == "__main__":
    import mpp

    mpp.main(make_scenes())
