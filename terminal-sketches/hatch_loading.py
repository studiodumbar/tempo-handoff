#!/usr/bin/env python3
"""
hatch_loading — processing / loading indicators built on the hatched sphere.

The basis is the standard hatch-state globe (hatch_states scene 1, `HatchScene`):
a lat/long sphere where every front-facing sample is one short horizontal
scanline tick (`_dash`), the pole leaned toward the camera so its latitude rings
stack into a vortex. Each indicator here is just that globe with its two hooks
driven on a loop, so it reads as an ambient "working…" state:

    • bright(...) -> hatch-tick LENGTH  (longer = denser = brighter)
    • disp(...)   -> a RADIAL displacement (the surface ripples / breathes)

Unlike hatch_grid, these LOOP forever — they are spinners, not transitions.

    1  hatch · pole pulse   bright rings pulse from BOTH poles and converge at
                            the equator, flash, and repeat        (the headline)
    2  hatch · scan         one bright latitude band sweeps pole->pole and back
    3  hatch · orbit        a bead (with a comet trail) orbits a tilted great ring
    4  hatch · fill         a hatch tide fills south->north, a bright waterline
    5  hatch · ripple       concentric rings ripple out of the pole vortex, steady
    6  hatch · heartbeat    the whole globe swells + flashes on a double thump
    7  hatch · meridian     a bright meridian sweeps around, trailing (a spinner)
    8  hatch · shimmer      an indeterminate twinkle of ticks — background work

Same mpp vocabulary; paced by hatch_grid's steady 60fps explorer.
Run standalone: `python hatch_loading.py`.
"""

import math

from mpp import _clamp, EASE, EASE_BACK
from hatch_states import HatchScene, _expo, TAU
from scenes import _dash


def _smooth(x):
    """smoothstep — a gentle 0..1 ramp with zero slope at both ends."""
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _gauss(x, w):
    """Unit-height gaussian of half-width ~sqrt(w)."""
    return math.exp(-(x * x) / w)


# ===========================================================================
# 1 — POLE PULSE  (the headline: pulses fire from both poles -> converge)
# ===========================================================================
class HatchPolePulseScene(HatchScene):
    """A pulse leaves the north pole AND the south pole at once and travels down
    each hemisphere toward the equator, where the two rings meet, flare, and
    fade — then it fires again. Because the band is keyed to distance-from-the-
    nearest-pole, the two rings are always mirror images and merge exactly on the
    equator, so the convergence is built in. A slight radial bulge rides the band
    so the surface visibly ripples inward."""

    name = "hatch · pole pulse"
    SPIN = 0.10           # a slow turn so it reads as live processing
    TILT = 0.14           # near equator-on: poles sit top & bottom, equator mid
    CYCLE = 1.7           # seconds per pulse
    TRAVEL = 0.82         # fraction of the cycle spent travelling pole->equator
    REST = 0.30           # resting hatch length: a dim stipple the pulse rides over
    WIDTH = 0.05          # band width (gaussian denominator, in radians^2)
    DISP = 0.05           # radial bulge amplitude along the band (a gentle ripple)
    BRIGHT = 2.1          # peak hatch-length boost on the band
    FLASH = 1.5           # extra boost as the rings converge on the equator

    def _u(self, t):
        return (t / self.CYCLE) % 1.0

    def _pos(self, t):
        """Band position as distance-from-pole: 0 (pole) -> pi/2 (equator)."""
        return EASE(_clamp(self._u(t) / self.TRAVEL, 0.0, 1.0)) * (math.pi / 2.0)

    def _amp(self, t):
        """Envelope: fade in from the pole, hold, fade out after convergence, so
        the loop seam (equator -> pole) lands in the dark and never jumps."""
        u = self._u(t)
        rise = _smooth(u / 0.12)
        fall = 1.0 - _smooth((u - self.TRAVEL) / (1.0 - self.TRAVEL))
        return rise * fall

    def _pole_dist(self, theta):
        return theta if theta <= math.pi / 2.0 else math.pi - theta

    def _band(self, theta, t):
        return self._pole_dist(theta) - self._pos(t)

    def disp(self, ux, uy, uz, theta, t):
        return self.DISP * self._amp(t) * _gauss(self._band(theta, t), self.WIDTH)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        amp = self._amp(t)
        g = _gauss(self._band(theta, t), self.WIDTH)
        # As the band nears the equator the two rings overlap into one; add a
        # convergence flash there so the meeting reads as an impact.
        near_eq = _smooth((self._pos(t) / (math.pi / 2.0) - 0.72) / 0.28)
        conv = self.FLASH * amp * near_eq * _gauss(theta - math.pi / 2.0, self.WIDTH)
        return self.REST + self.BRIGHT * amp * g + conv

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 2 — SCAN  (a single latitude band sweeps pole -> pole -> pole)
# ===========================================================================
class HatchScanScene(HatchScene):
    """One bright latitude ring slides from the north pole down to the south and
    back, easing to a stop at each end — a CT-scanner pass over the globe."""

    name = "hatch · scan"
    SPIN = 0.07
    CYCLE = 2.8
    WIDTH = 0.04
    DISP = 0.05
    BRIGHT = 1.7

    def _pos(self, t):
        u = (t / self.CYCLE) % 1.0
        tri = 2.0 * u if u < 0.5 else 2.0 * (1.0 - u)   # 0 ->1 ->0
        return _smooth(tri) * math.pi                    # north pole -> south pole

    def disp(self, ux, uy, uz, theta, t):
        return self.DISP * _gauss(theta - self._pos(t), self.WIDTH)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        return 0.5 + self.BRIGHT * _gauss(theta - self._pos(t), self.WIDTH)

    def status(self):
        return "SCANNING"


# ===========================================================================
# 3 — ORBIT  (a bead with a comet trail circles a tilted great ring)
# ===========================================================================
class HatchOrbitScene(HatchScene):
    """The globe dims to a quiet stipple while a bright bead orbits it on a
    tilted great circle, dragging a fading comet trail — a spinner that reads as
    'busy' at a glance."""

    name = "hatch · orbit"
    SPIN = 0.16
    DIM = 0.28            # resting hatch: a dim stipple so the bead owns the eye
    RATE = 2.2            # bead angular speed (radians / second)
    RING_TILT = 0.6       # tilt of the orbit plane (radians)
    N_TRAIL = 26          # beads in the comet trail
    TRAIL_ARC = 2.0       # arc the trail spans (radians)
    RING_R = 1.04         # orbit radius (just clear of the surface)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        return self.DIM

    def extra(self, canvas, cx, cy, R, V, t):
        ct, st = math.cos(self.RING_TILT), math.sin(self.RING_TILT)
        r = self.RING_R
        for k in range(self.N_TRAIL):
            frac = k / self.N_TRAIL
            ang = self.RATE * t - frac * self.TRAIL_ARC
            # a point on a tilted great circle, lifted just off the surface
            wx = r * math.cos(ang)
            wy = r * math.sin(ang) * st
            wz = r * math.sin(ang) * ct
            px, py, z2, f = self._project(wx, wy, wz, cx, cy, R, V)
            if z2 <= -0.15:
                continue                                # hidden behind the globe
            if k < 2:                                   # the bead: a bright bar
                _dash(canvas, px, py, 2.6 * f)
            else:                                       # the trail: a dotted arc
                canvas.set_dot(px, py)

    def status(self):
        return "LOADING"


# ===========================================================================
# 4 — FILL  (a hatch tide rises south -> north, with a bright waterline)
# ===========================================================================
class HatchFillScene(HatchScene):
    """A determinate-looking progress fill: dense hatch floods up from the south
    pole to the north, the waterline flaring bright, then it resets and fills
    again."""

    name = "hatch · fill"
    SPIN = 0.18
    CYCLE = 2.8

    def _level(self, t):
        return -1.0 + 2.0 * ((t / self.CYCLE) % 1.0)    # uy: -1 (south) -> +1

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        level = self._level(t)
        if uy <= level:                                 # submerged: dense hatch
            edge = math.exp(-((uy - level) ** 2) / 0.006)
            return 1.2 + 0.9 * edge                     # brighter at the waterline
        return 0.28                                     # above water: sparse dots

    def status(self):
        return "LOADING"


# ===========================================================================
# 5 — RIPPLE  (concentric rings ripple out of the pole vortex, steady)
# ===========================================================================
class HatchRippleScene(HatchScene):
    """A continuous, even processing hum: concentric hatch bands roll outward
    from the leaned pole in a steady stream, the surface breathing along with
    them."""

    name = "hatch · ripple"
    SPIN = 0.5
    K = 6.0               # rings across the globe
    RATE = 3.2            # outward roll speed

    def disp(self, ux, uy, uz, theta, t):
        return 0.035 * math.sin(theta * self.K - t * self.RATE)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        band = 0.5 + 0.5 * math.sin(theta * self.K - t * self.RATE)
        return 0.5 + 1.2 * band * band

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 6 — HEARTBEAT  (the whole globe swells + flashes on a double thump)
# ===========================================================================
class HatchHeartbeatScene(HatchScene):
    """A lub-dub: two quick swells then a rest, the whole sphere bulging and the
    hatch flashing dense on each beat — a calm 'still working' pulse."""

    name = "hatch · heartbeat"
    SPIN = 0.16
    CYCLE = 1.6
    DISP_AMP = 0.11
    BRIGHT_AMP = 1.1

    def _beat(self, t):
        u = (t / self.CYCLE) % 1.0
        lub = math.exp(-((u - 0.12) ** 2) / 0.0016)
        dub = 0.7 * math.exp(-((u - 0.30) ** 2) / 0.0016)
        return _clamp(lub + dub, 0.0, 1.0)

    def disp(self, ux, uy, uz, theta, t):
        return self.DISP_AMP * self._beat(t)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        return 0.6 + self.BRIGHT_AMP * self._beat(t)

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 7 — MERIDIAN  (a bright meridian sweeps around, trailing — a spinner)
# ===========================================================================
class HatchMeridianScene(HatchScene):
    """A bright half-meridian of hatch sweeps around the globe with a fading
    trail behind it, like an indeterminate spinner wrapped onto a sphere."""

    name = "hatch · meridian"
    SPIN = 0.12
    SWEEP = 2.4           # sweep speed (radians / second)
    TRAIL = 2.4           # trail falloff (bigger = shorter trail)

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        # world longitude of the sample (undo the spin so the beam is its own motion)
        world_phi = phi + t * self.SPIN
        dphi = (t * self.SWEEP - world_phi) % TAU
        return 0.45 + 1.5 * math.exp(-dphi * self.TRAIL)

    def status(self):
        return "PROCESSING"


# ===========================================================================
# 8 — SHIMMER  (an indeterminate twinkle — ambient background work)
# ===========================================================================
class HatchShimmerScene(HatchScene):
    """No wavefront, no progress: the hatch just twinkles all over, ticks
    winking brighter and dimmer out of phase, the way a busy background task has
    no bar to show."""

    name = "hatch · shimmer"
    SPIN = 0.2
    RATE = 3.0
    DEPTH = 0.9

    def bright(self, ux, uy, uz, theta, phi, z2, t):
        # a smooth spatial hash: several incommensurate sines of position + time
        s = (math.sin(5.0 * ux + 1.7 * t)
             + math.sin(6.3 * uy - 1.3 * t)
             + math.sin(7.1 * uz + 0.9 * t)
             + math.sin(9.0 * (ux + uz) - self.RATE * t))
        tw = 0.5 + 0.5 * math.sin(s * 1.3)              # 0..1 twinkle
        return 0.55 + self.DEPTH * tw

    def status(self):
        return "PROCESSING"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        HatchPolePulseScene(),     # 1  pole pulse (headline)
        HatchScanScene(),          # 2  scan
        HatchOrbitScene(),         # 3  orbit
        HatchFillScene(),          # 4  fill
        HatchRippleScene(),        # 5  ripple
        HatchHeartbeatScene(),     # 6  heartbeat
        HatchMeridianScene(),      # 7  meridian
        HatchShimmerScene(),       # 8  shimmer
    ]


if __name__ == "__main__":
    import sys
    import mpp

    _scenes = make_scenes()
    # Bare interactive launch -> hatch_grid's steady 60fps explorer; any flag or
    # a non-TTY stdout hands off to mpp's standard dispatch.
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
