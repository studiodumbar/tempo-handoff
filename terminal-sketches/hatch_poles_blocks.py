#!/usr/bin/env python3
"""
hatch_poles_blocks — hatch_poles rendered with BOTH braille dots AND a block ramp.

Same rigid sphere and the same five "poles meeting in the centre" effects as
hatch_poles (pinch / beads / rings / drift / spiral — no surface morphing), but
each hatch mark is now drawn through an intensity RAMP instead of a plain braille
tick:

    dim    -> a single braille sub-pixel dot        (the fine stipple)
    mid    -> a short braille hatch line
    bright -> a run of block glyphs  ▁ ▂ ▃ ▄ ▅ ▆ ▇ █  (a solid bar of whole cells)

So the quiet resting sphere stays a delicate braille dot-field while the bright
converging fronts, belts and beads crystallise into chunky white blocks — the
mixed dot/block look from the reference. The block level is driven by the same
`bright()` each effect already computes, so nothing about the motion changes.

Reuses hatch_poles' effect logic via a small render mixin. The block ramp is
tempo/scenes' `_BLOCK_DOWN`. Run: `python hatch_poles_blocks.py`.
"""

import math

from mpp import _clamp
from hatch_states import TAU
import hatch_poles as hp

# The block ramp: bottom-anchored bars from a thin sliver up to a full solid cell.
_BLOCKS = ("▁", "▂", "▃", "▄", "▅", "▆", "▇", "▆")

# Where on the bright() scale marks leave braille and become blocks, and where
# they reach a full solid █. (hatch_poles: rest ~0.3 -> dots; converging fronts /
# belts run ~1.3-3.6 -> blocks.)
BLOCK_LO = 1.25
BLOCK_HI = 2.40


def _ramp_mark(canvas, px, py, half, lvl):
    """Draw one hatch mark somewhere on the braille->block ramp.

    lvl <= 0  : braille — a single dot (faint) or a short line (mid).
    lvl  > 0  : a block glyph (▁..█ by lvl) in this mark's own cell. One block
                per sample (not a filled run), so where the hatch is dense the
                blocks pack into a solid bar and where it thins they read as
                spaced blocks interleaved with the braille dots around them."""
    if lvl <= 0.0:
        if half < 0.5:
            canvas.set_dot(px, py)
        else:
            canvas.line(px - half, py, px + half, py)
        return
    ch = _BLOCKS[min(7, int(lvl * 7.0 + 0.5))]
    canvas.set_char(int(px // 2), int(py // 4), ch)


def _block_level(b):
    """bright() value -> block fill level in [0,1] (0 stays braille)."""
    return _clamp((b - BLOCK_LO) / (BLOCK_HI - BLOCK_LO), 0.0, 1.0)


# ===========================================================================
# Render mixin — the hatched-sphere projection loop, but every mark runs the ramp
# ===========================================================================
class RampMixin:
    """Override the sphere draw so each hatch mark passes through _ramp_mark.
    Everything else (the per-effect bright()/extra() and the rigid geometry) is
    inherited unchanged from the hatch_poles scene it is mixed into."""

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
                x1 = ux * cyaw + uz * syaw
                z1 = -ux * syaw + uz * cyaw
                y2 = uy * ct - z1 * st
                z2 = uy * st + z1 * ct
                if z2 <= self.EPS:
                    continue
                rr = R * (1.0 + self.disp(ux, uy, uz, theta, t))    # disp == 0: rigid
                f = focal / (focal - z2 * rr)
                px = cx + x1 * rr * f
                py = cy - y2 * rr * f
                b = self.bright(ux, uy, uz, theta, phi, z2, t)
                half = DASH * f * (0.45 + 0.55 * z2) * b
                if half <= 0.0:
                    continue
                _ramp_mark(canvas, px, py, half, _block_level(b))
        self.extra(canvas, cx, cy, R, (cyaw, syaw, ct, st, focal), t)


# ===========================================================================
# The five effects, re-rendered through the ramp
# ===========================================================================
class BlockPinchScene(RampMixin, hp.PolePinchScene):
    name = "poles▓ · pinch"


class BlockRingsScene(RampMixin, hp.PoleRingsScene):
    name = "poles▓ · rings"


class BlockDriftScene(RampMixin, hp.PoleDriftScene):
    name = "poles▓ · drift"


class BlockBeadsScene(RampMixin, hp.PoleBeadsScene):
    # The beads already land as solid rect_fill blocks on a braille sphere — a
    # natural braille+block pairing; only the sphere render changes here.
    name = "poles▓ · beads"


class BlockSpiralScene(RampMixin, hp.PoleSpiralScene):
    """The arms stream in as braille dots and thicken into blocks as they reach
    the equatorial meeting band."""

    name = "poles▓ · spiral"

    def extra(self, canvas, cx, cy, R, V, t):
        flow = (t * self.RATE) % 1.0
        for pole in (+1.0, -1.0):
            for arm in range(self.ARMS):
                a0 = TAU * arm / self.ARMS
                for k in range(self.N):
                    s = (k / self.N + flow) % 1.0
                    theta_local = s * hp.HALF_PI
                    phi = a0 + s * self.TURNS * TAU
                    stt = math.sin(theta_local)
                    wy = pole * math.cos(theta_local)
                    wx = stt * math.cos(phi)
                    wz = stt * math.sin(phi)
                    px, py, z2, f = self._project(wx, wy, wz, cx, cy, R, V)
                    if z2 <= self.EPS:
                        continue
                    half = (0.7 + 1.1 * s) * f
                    lvl = _clamp((s - 0.72) / 0.28, 0.0, 1.0)   # blocks near equator
                    _ramp_mark(canvas, px, py, half, lvl)


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        BlockPinchScene(),     # 1  pinch
        BlockBeadsScene(),     # 2  beads
        BlockRingsScene(),     # 3  rings
        BlockDriftScene(),     # 4  drift
        BlockSpiralScene(),    # 5  spiral
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
