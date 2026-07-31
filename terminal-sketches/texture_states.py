#!/usr/bin/env python3
"""
texture_states — eight texture-field agent states.

Where the other sets center a shape (a sphere, a cart, a tunnel), these are all
FIELD: full-frame textures/materials that fill the space, with no discrete
object. The whole screen is the subject.

The trick that makes this work in pure monochrome: a continuous field value in
[0, 1] per character cell is rendered as ORDERED-DITHERED BRAILLE STIPPLE — the
cell lights that many of its 8 dots, in a dispersed order, with a 4x4 Bayer
threshold dithering the in-between levels across neighbours. So a smooth field
reads as a soft grayscale texture (0 = empty ... 8 dots = solid), no gray glyphs
needed. Zero-valued regions stay blank, so the texture breathes against negative
space.

Every state's motion is sequential and eased with **ease-in-out expo** (`_expo`)
— dead-flat at the ends, a hard snap through the middle:

    1  texture · haze          a soft drifting cloud that breathes brighter and back
    2  texture · dither wipe    a hard dithered edge fills the frame, then dissolves
    3  texture · flow           a swirling flow-field of strokes; an order-wave sweeps
    4  texture · contours        morphing topographic iso-lines, a focus band passing
    5  texture · scan bands      horizontal scanlines reveal top->bottom, a bright line
    6  texture · interference    ripple sources beating into a moiré that throbs
    7  texture · bloom           a dithered disc blooms out to white, then clears
    8  texture · fill            a liquid tide fills bottom->top in eased steps

Run standalone: `python texture_states.py` (mpp's runner flags all work).
"""

import math

from mpp import Scene, _clamp, _fbm, _value_noise

TAU = 2.0 * math.pi


def _expo(x):
    """easeInOutExpo: near-still at both ends, a hard snap through the middle."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


# Dispersed fill order for a cell's 8 braille dots (scatter, not clustered) and
# the precomputed glyph for each 0..8 level. Braille dot bits:
#   dot1 0x01  dot4 0x08     (top)
#   dot2 0x02  dot5 0x10
#   dot3 0x04  dot6 0x20
#   dot7 0x40  dot8 0x80     (bottom)
_DOT_ORDER = (0x01, 0x80, 0x10, 0x04, 0x08, 0x40, 0x02, 0x20)
_TEX_GLYPHS = []
for _n in range(9):
    _bits = 0
    for _k in range(_n):
        _bits |= _DOT_ORDER[_k]
    _TEX_GLYPHS.append(chr(0x2800 | _bits))

# 4x4 Bayer ordered-dither thresholds in (0, 1), indexed [row & 3][col & 3].
_BAYER = tuple(tuple((v + 0.5) / 16.0 for v in row) for row in
               ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5)))


class TextureScene(Scene):
    """Base: samples field(x, y, t) per cell (x, y in [0, 1]) and renders it as
    ordered-dithered braille stipple. self._aspect is width:height in square
    units (a cell is ~twice as tall as wide) for isotropic fields."""

    def field(self, x, y, t):
        return 0.0

    def overlay(self, canvas):
        pass

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        self._aspect = cols / (rows * 2.0)
        t = self.t
        setc = canvas.set_char
        G = _TEX_GLYPHS
        fld = self.field
        for r in range(rows):
            y = (r + 0.5) / rows
            br = _BAYER[r & 3]
            for c in range(cols):
                g = fld((c + 0.5) / cols, y, t)
                if g <= 0.0:
                    continue
                v = g * 8.0
                b = int(v)
                if v - b > br[c & 3]:
                    b += 1
                if b <= 0:
                    continue
                setc(c, r, G[8 if b > 8 else b])
        self.overlay(canvas)


# ===========================================================================
# 1 — HAZE  (a soft drifting cloud that breathes brighter and back)
# ===========================================================================
class HazeScene(TextureScene):
    name = "texture · haze"
    CYCLE = 6.0

    def field(self, x, y, t):
        v = _fbm(x * 2.2 + t * 0.16, y * 2.2 - t * 0.10)    # slow drifting cloud
        u = (t / self.CYCLE) % 1.0
        breath = 0.55 + 0.45 * _expo(1.0 - abs(2.0 * u - 1.0))  # swell in, then out
        return _clamp((v * 1.35 - 0.18) * breath, 0.0, 1.0)

    def status(self):
        return "HAZE"


# ===========================================================================
# 2 — DITHER WIPE  (a hard dithered edge fills, holds, dissolves)
# ===========================================================================
class DitherWipeScene(TextureScene):
    name = "texture · dither wipe"
    CYCLE = 3.6
    EDGE = 0.14

    def field(self, x, y, t):
        u = (t / self.CYCLE) % 1.0
        if u < 0.5:                                         # fill left -> right
            front = _expo(u / 0.5)
            return _clamp((front - x) / self.EDGE + 0.5, 0.0, 1.0)
        front = _expo((u - 0.5) / 0.5)                      # dissolve left -> right
        return _clamp((x - front) / self.EDGE + 0.5, 0.0, 1.0)

    def status(self):
        return "WIPE"


# ===========================================================================
# 3 — FLOW  (a swirling stroke field; an order-wave sweeps through)
# ===========================================================================
class FlowFieldScene(Scene):
    name = "texture · flow"
    STEP_C = 3
    STEP_R = 2
    CYCLE = 4.2

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        t = self.t
        front = _expo((t / self.CYCLE) % 1.0) * 1.4 - 0.2   # order-wave x-position
        for r in range(1, rows, self.STEP_R):
            ny = r / rows
            for c in range(1, cols, self.STEP_C):
                nx = c / cols
                ang = (_fbm(nx * 2.2 + t * 0.12, ny * 2.2) - 0.5) * TAU * 1.6
                w = math.exp(-((nx - front) ** 2) / 0.02)   # near the wave: align...
                ang *= (1.0 - w)                            # ...to horizontal
                length = 2.8 + 3.6 * w                      # ...and stretch out
                px, py = c * 2.0, r * 4.0
                dx, dy = math.cos(ang) * length, math.sin(ang) * length
                canvas.line(px - dx, py - dy, px + dx, py + dy)

    def status(self):
        return "FLOW"


# ===========================================================================
# 4 — CONTOURS  (morphing topographic iso-lines, a focus band passing)
# ===========================================================================
class ContourScene(TextureScene):
    name = "texture · contours"
    NB = 5          # elevation bands
    CYCLE = 6.0

    def field(self, x, y, t):
        v = _fbm(x * 3.0 + t * 0.13, y * 3.0 - t * 0.05)
        band = (v * self.NB) % 1.0                          # strata: ramp per band,
        g = 0.12 + 0.82 * band                              # with a hard edge (contour)
        u = (t / self.CYCLE) % 1.0
        foc = _expo(u)                                      # a bright focus band sweeps
        emph = 0.7 + 0.85 * math.exp(-((y - foc) ** 2) / 0.02)
        return _clamp(g * emph, 0.0, 1.0)

    def status(self):
        return "CONTOURS"


# ===========================================================================
# 5 — SCAN BANDS  (scanlines reveal top->bottom, a bright line leads)
# ===========================================================================
class ScanBandsScene(TextureScene):
    name = "texture · scan bands"
    NB = 15
    CYCLE = 3.4

    def field(self, x, y, t):
        u = (t / self.CYCLE) % 1.0
        front = _expo(u)                                    # reveal sweeps down
        opened = _clamp((front - y) / 0.05 + 0.5, 0.0, 1.0)
        band = 0.5 + 0.5 * math.sin(y * self.NB * TAU - t * 3.2)
        base = opened * (0.28 + 0.6 * band)
        scan = math.exp(-((y - front) ** 2) / 0.0009)       # bright leading line
        return _clamp(base + scan, 0.0, 1.0)

    def status(self):
        return "SCAN"


# ===========================================================================
# 6 — INTERFERENCE  (ripple sources beating into a throbbing moiré)
# ===========================================================================
class InterferenceScene(TextureScene):
    name = "texture · interference"
    CYCLE = 2.8
    K = 44.0
    SRCS = ((0.26, 0.0), (-0.22, 0.16), (-0.05, -0.24))

    # Overrides the base per-cell loop with an inlined, hoisted version (no
    # per-cell method call, source y-offsets lifted per row, locals for sin/hypot)
    # so the ripple field holds 60 fps even on a large terminal.
    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        t = self.t
        aspect = cols / (rows * 2.0)
        u = (t / self.CYCLE) % 1.0
        throb = 0.4 + 0.6 * _expo(1.0 - abs(2.0 * u - 1.0))   # swell in, then out
        w = t * 4.0
        k = self.K
        (s0x, s0y), (s1x, s1y), (s2x, s2y) = self.SRCS
        G = _TEX_GLYPHS
        setc = canvas.set_char
        sin = math.sin
        hypot = math.hypot
        inv_cols = 1.0 / cols
        inv_rows = 1.0 / rows
        for r in range(rows):
            ay = (r + 0.5) * inv_rows - 0.5
            d0y, d1y, d2y = ay - s0y, ay - s1y, ay - s2y
            br = _BAYER[r & 3]
            for c in range(cols):
                ax = ((c + 0.5) * inv_cols - 0.5) * aspect
                s = (sin(hypot(ax - s0x, d0y) * k - w)
                     + sin(hypot(ax - s1x, d1y) * k - w)
                     + sin(hypot(ax - s2x, d2y) * k - w))
                g = 0.5 + 0.16667 * s                        # 0.5 + 0.5*(s/3)
                g = g * g * throb                            # sharpen fringes + throb
                v = g * 8.0
                b = int(v)
                if v - b > br[c & 3]:
                    b += 1
                if b <= 0:
                    continue
                setc(c, r, G[8 if b > 8 else b])

    def status(self):
        return "INTERFERE"


# ===========================================================================
# 7 — BLOOM  (a dithered disc blooms out to white, then clears)
# ===========================================================================
class BloomScene(TextureScene):
    name = "texture · bloom"
    CYCLE = 2.6
    EDGE = 0.12

    def field(self, x, y, t):
        ax = (x - 0.5) * self._aspect
        ay = (y - 0.5)
        d = math.hypot(ax, ay)
        u = (t / self.CYCLE) % 1.0
        front = _expo(u) * 0.95                             # disc expands
        g = _clamp((front - d) / self.EDGE + 0.5, 0.0, 1.0)
        if u > 0.55:                                        # then clears from centre
            clear = _expo((u - 0.55) / 0.45) * 0.95
            g *= _clamp((d - clear) / self.EDGE + 0.5, 0.0, 1.0)
        return g

    def status(self):
        return "BLOOM"


# ===========================================================================
# 8 — FILL  (a liquid tide fills bottom->top in eased steps)
# ===========================================================================
class FillScene(TextureScene):
    name = "texture · fill"
    CYCLE = 4.4
    STEPS = 5

    def field(self, x, y, t):
        u = (t / self.CYCLE) % 1.0
        step = int(u * self.STEPS)
        frac = _expo(u * self.STEPS - step)                 # each chunk eases in
        level = (step + frac) / self.STEPS                  # 0..1 filled height
        surf = level + 0.028 * math.sin(x * 13.0 + t * 3.0) # wavy waterline
        waterline = 1.0 - surf                              # y grows downward
        return _clamp((y - waterline) / 0.05 + 0.5, 0.0, 1.0)

    def status(self):
        return "FILL"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        HazeScene(),             # 1  haze
        DitherWipeScene(),       # 2  dither wipe
        FlowFieldScene(),        # 3  flow
        ContourScene(),          # 4  contours
        ScanBandsScene(),        # 5  scan bands
        InterferenceScene(),     # 6  interference
        BloomScene(),            # 7  bloom
        FillScene(),             # 8  fill
    ]


if __name__ == "__main__":
    import mpp

    # The runner's sim already steps at 60 Hz (SIM_DT); only the draw cadence is
    # capped at 30 fps. Raise that cap to 60 fps at runtime (mpp.py untouched).
    mpp.FRAME_DT = 1.0 / 60.0
    mpp.main(make_scenes())
