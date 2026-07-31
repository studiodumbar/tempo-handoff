#!/usr/bin/env python3
"""
hatch_states_top — the eight hatch agent-states, seen straight down the NORTH
POLE, with SCALING as a key movement in every scene.

Two changes from hatch_states:

  * VIEW — instead of the pole leaned partway toward the camera (a side/oblique
    vortex), we look directly down the pole axis (TILT = pi/2). The latitude rings
    become a clean concentric bullseye centred on the pole; the equator is the
    outer ring. This axial view happens to suit the states well — the searching
    beam becomes a radar sweep, processing becomes concentric ripples, buying an
    inward spiral, confirmed a shockwave.

  * SCALE — every scene now pulses its overall size up and down as a primary
    motion (`scale(t)` multiplies the sphere radius and the hatch-tick length
    together, so it reads as a true zoom). The scaling is tuned per state: idle
    breathes, processing throbs with its rings, loading grows as it fills,
    confirmed does a big hero swell, and so on.

Each state reuses hatch_states' own disp()/bright()/extra(); only the projection
(axial + scaled) is overridden here. Run: `python hatch_states_top.py`.
"""

import math

from mpp import _clamp, EASE, EASE_BACK
from hatch_states import HatchScene, TAU
import hatch_states as hs


# ===========================================================================
# Axial + scaling base — look down the pole, zoom the whole sphere per frame
# ===========================================================================
class TopScene(HatchScene):
    TILT = math.pi / 2.0     # look straight down the north pole (axial)
    TILT_WOBBLE = 0.0        # hold the axis on-camera (the scale is the motion)
    RADIUS_FRAC = 0.30       # a touch smaller so a scale-up still fits the frame

    def scale(self, t):
        """Global size multiplier — the key movement. Default: a calm breathe."""
        return 1.0 + 0.13 * math.sin(t * 1.0)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        t = self.t
        sc = self.scale(t)
        R = min(wu, hu) * self.RADIUS_FRAC * sc          # <- scaled radius
        yaw = t * self.SPIN
        tilt = self.TILT + self.TILT_WOBBLE * math.sin(t * self.TILT_RATE)
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        ct, st = math.cos(tilt), math.sin(tilt)
        focal = self.FOCAL_FRAC * R
        DASH = self.DASH * sc                            # ticks scale with the ball
        for li in range(1, self.N_LAT):
            theta = math.pi * li / self.N_LAT
            sint, cost = math.sin(theta), math.cos(theta)
            nlon = max(6, int(self.LON_MAX * sint))
            for j in range(nlon):
                phi = TAU * j / nlon
                ux = sint * math.cos(phi)
                uz = sint * math.sin(phi)
                uy = cost
                x1 = ux * cyaw + uz * syaw
                z1 = -ux * syaw + uz * cyaw
                y2 = uy * ct - z1 * st
                z2 = uy * st + z1 * ct
                if z2 <= self.EPS:                        # front (north) cap only
                    continue
                rr = R * (1.0 + self.disp(ux, uy, uz, theta, t))
                f = focal / (focal - z2 * rr)
                px = cx + x1 * rr * f
                py = cy - y2 * rr * f
                half = (DASH * f * (0.45 + 0.55 * z2)
                        * self.bright(ux, uy, uz, theta, phi, z2, t))
                if half > 0.0:
                    hs._dash(canvas, px, py, half)
        self.extra(canvas, cx, cy, R, (cyaw, syaw, ct, st, focal), t)


# ===========================================================================
# The eight states — axial view + a per-state scaling motion
# ===========================================================================
class TopIdleScene(TopScene, hs.HatchIdleScene):
    name = "top · idle"

    def scale(self, t):                                  # a calm, slow breathe
        return 1.0 + 0.15 * math.sin(t * 0.9)


class TopListeningScene(TopScene, hs.HatchListeningScene):
    name = "top · listening"

    def scale(self, t):                                  # leans in on each ping
        u = (t * self.PING) % self.SPAN / self.SPAN
        return 1.0 + 0.18 * math.sin(u * math.pi)


class TopThinkingScene(TopScene, hs.HatchThinkingScene):
    name = "top · thinking"

    def scale(self, t):                                  # restless, uneven throb
        return (1.0 + 0.09 * math.sin(t * 2.7)
                + 0.05 * math.sin(t * 6.1 + 1.0))


class TopSearchingScene(TopScene, hs.HatchSearchingScene):
    name = "top · searching"

    def scale(self, t):                                  # one swell per sweep
        return 1.0 + 0.12 * (0.5 + 0.5 * math.sin(t * self.SWEEP))


class TopProcessingScene(TopScene, hs.HatchProcessingScene):
    name = "top · processing"

    def scale(self, t):                                  # throbs with the rings
        return 1.0 + 0.11 * math.sin(t * self.RATE)


class TopLoadingScene(TopScene, hs.HatchLoadingScene):
    name = "top · loading"

    def scale(self, t):                                  # grows as it fills, resets
        u = (t / self.CYCLE) % 1.0
        return 0.66 + 0.52 * EASE(u)


class TopBuyingScene(TopScene, hs.HatchBuyingScene):
    name = "top · buying"

    def scale(self, t):                                  # a pop on the merge/flare
        u = (t / self.CYCLE) % 1.0
        pop = EASE(_clamp((u - 0.72) / 0.28, 0.0, 1.0)) if u > 0.72 else 0.0
        settle = 0.5 + 0.5 * math.sin(t * 1.6)
        return 1.0 + 0.06 * settle + 0.26 * pop


class TopConfirmedScene(TopScene, hs.HatchConfirmedScene):
    name = "top · confirmed"

    def scale(self, t):                                  # the hero swell + settle
        return 1.0 + 0.34 * self._amp(t)                 # reuse its own swell curve


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        TopIdleScene(),          # 1  idle
        TopListeningScene(),     # 2  listening
        TopThinkingScene(),      # 3  thinking
        TopSearchingScene(),     # 4  searching
        TopProcessingScene(),    # 5  processing
        TopLoadingScene(),       # 6  loading
        TopBuyingScene(),        # 7  buying
        TopConfirmedScene(),     # 8  confirmed
    ]


if __name__ == "__main__":
    import sys
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
