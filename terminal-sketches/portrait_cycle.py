#!/usr/bin/env python3
"""
portrait_cycle — six mathematically driven loops composed for a 1080 x 1920
portrait frame.

Every scene here designs into a fixed 9:16 PORTRAIT RECT fitted to whatever
canvas it gets — centred, pillarboxed in a landscape terminal, full-bleed when
the output is cropped to the rect for the portrait comp. Coordinates inside a
scene are portrait units: x in [-1, 1] spans the width, y in [-16/9, 16/9]
spans the height, so a composition reads identically at any canvas size.

Every scene is a PERFECT LOOP: all motion is keyed to the cycle fraction
u = (t % CYCLE) / CYCLE, every travelling wave runs an INTEGER number of
periods per cycle, every needle an integer number of turns — frame u=0 and
frame u=1 are byte-identical. No intros, no outros: these are backdrops in
CONSTANT MOTION, cut-anywhere loopable.

    1  tall · wall     a 9 x 16 wall of rotating needles, each one full turn
                       per cycle, phase offset by a diagonal plane wave — the
                       wave is visible as a travelling stripe of alignment,
                       with a crest of solid chips sweeping through the grid
    2  tall · lissa    a 3 x 5 Lissajous table (fx = column, fy = row), the
                       shared phase rolling one full turn per cycle so every
                       figure breathes through line -> ellipse -> line, a
                       head chip lapping each curve once per cycle
    3  tall · ripple   a ripple tank: two point sources at the top and bottom
                       of the frame, interference fringes on a dot lattice —
                       crests swell into solid chips, troughs go dark
    4  tall · moire    two dot lattices, one twisting sinusoidally over the
                       other — moiré beat rings bloom and collapse, and twice
                       a cycle the lattices snap into coincidence: a full-
                       frame flash of solid chips
    5  tall · helix    a double helix climbing the frame — strands, rungs on
                       fixed phase stations riding upward, beads weighted by
                       depth so the front strand reads in front
    6  tall · munch    munching squares: cell value = (x XOR y) mod 16, a
                       smooth threshold wave cycling through XOR-space once
                       per cycle — nested fractal brackets folding through
                       the grid

Run: `python portrait_cycle.py`.
"""

import math
import sys

from mpp import Scene, _clamp

TAU = math.tau
VR = 16.0 / 9.0     # portrait half-height per half-width: 1080 x 1920


class PortraitScene(Scene):
    """Base: the fitted 9:16 design rect and the portrait-unit helpers.
    Subclasses draw exclusively through _pt/_dot/_chip/_poly in portrait
    units, so the piece survives any canvas and crops cleanly to 9:16."""

    CYCLE = 9.0
    FILL = 0.97      # fraction of the fitted rect actually used

    def _begin(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        self._cx = wu / 2.0
        self._cy = hu / 2.0
        self._w2 = min(wu / 2.0, (hu / 2.0) / VR) * self.FILL
        return round((self.t % self.CYCLE) / self.CYCLE, 12)

    def _pt(self, x, y):
        return (self._cx + x * self._w2, self._cy + y * self._w2)

    def _dot(self, canvas, x, y):
        px, py = self._pt(x, y)
        canvas.set_dot(px, py)

    def _chip(self, canvas, x, y, s):
        """A solid block chip; side s in portrait units."""
        size = s * self._w2
        if size >= 0.7:
            px, py = self._pt(x, y)
            canvas.square_fill(px, py, size)

    def _seg(self, canvas, x0, y0, x1, y1):
        ax, ay = self._pt(x0, y0)
        bx, by = self._pt(x1, y1)
        canvas.line(ax, ay, bx, by)

    def _poly(self, canvas, pts):
        for i in range(len(pts) - 1):
            self._seg(canvas, pts[i][0], pts[i][1],
                      pts[i + 1][0], pts[i + 1][1])


# ===========================================================================
# 1 — WALL: a 9 x 16 grid of needles, one turn per cycle, plane-wave phase
# ===========================================================================
class PhaseWallScene(PortraitScene):
    name = "tall · wall"
    CYCLE = 9.0

    NX, NY = 9, 16      # the grid echoes the frame: square cells in 9:16
    TURNS = 1           # integer needle turns per cycle — the loop
    WX, WY = 1, 2       # integer wave periods across / down the grid
    NEEDLE = 0.42       # needle half-length, in cell units
    BREATHE = 0.28      # how much the crest lengthens a needle

    def draw(self, canvas):
        u = self._begin(canvas)
        cell = 2.0 / self.NX
        for j in range(self.NY):
            y = ((j + 0.5) / self.NY * 2.0 - 1.0) * VR
            for i in range(self.NX):
                x = (i + 0.5) / self.NX * 2.0 - 1.0
                ph = TAU * (self.TURNS * u
                            - (self.WX * (i + 0.5) / self.NX
                               + self.WY * (j + 0.5) / self.NY))
                c, s = math.cos(ph), math.sin(ph)
                L = self.NEEDLE * cell * (1.0 - self.BREATHE + self.BREATHE * c)
                self._seg(canvas, x - L * c, y - L * s, x + L * c, y + L * s)
                cr = max(0.0, c)
                self._chip(canvas, x, y, 0.34 * cell * cr * cr * cr)

    def status(self):
        return "SWEEP"


# ===========================================================================
# 2 — LISSA: the Lissajous table, phase rolling one turn per cycle
# ===========================================================================
class LissaTableScene(PortraitScene):
    name = "tall · lissa"
    CYCLE = 12.0

    COLS, ROWS = 3, 5   # fx = col+1 (1..3), fy = row+1 (1..5)
    DELTA = 1           # integer phase turns per cycle — the morph AND the loop
    N = 120             # samples per curve
    RAD = 0.40          # figure radius, in cell units
    HEAD = 0.055        # head chip side, portrait units

    def draw(self, canvas):
        u = self._begin(canvas)
        cw = 2.0 / self.COLS
        chh = 2.0 * VR / self.ROWS
        r = self.RAD * min(cw, chh)
        d = TAU * self.DELTA * u
        for row in range(self.ROWS):
            cy = -VR + (row + 0.5) * chh
            fy = row + 1
            for col in range(self.COLS):
                cx = -1.0 + (col + 0.5) * cw
                fx = col + 1
                pts = []
                for k in range(self.N + 1):
                    s = k / self.N
                    pts.append((cx + r * math.sin(TAU * fx * s + d),
                                cy + r * math.sin(TAU * fy * s)))
                self._poly(canvas, pts)
                # the head laps the figure exactly once per cycle
                self._chip(canvas,
                           cx + r * math.sin(TAU * fx * u + d),
                           cy + r * math.sin(TAU * fy * u),
                           self.HEAD)

    def status(self):
        return "MORPH"


# ===========================================================================
# 3 — RIPPLE: two-source interference on a dot lattice
# ===========================================================================
class RippleTankScene(PortraitScene):
    name = "tall · ripple"
    CYCLE = 8.0

    SP = 0.075          # lattice spacing, portrait units
    F = 2               # integer wave beats per cycle — the loop
    WAVELEN = 0.60      # spatial wavelength of the rings
    SRC = ((0.0, -1.15), (0.0, 1.15))   # sources up and down the tall axis

    def draw(self, canvas):
        u = self._begin(canvas)
        w = TAU * self.F * u
        k = TAU / self.WAVELEN
        nx = int(1.0 / self.SP)
        ny = int(VR / self.SP)
        for j in range(-ny, ny + 1):
            y = j * self.SP
            for i in range(-nx, nx + 1):
                x = i * self.SP
                a = 0.0
                for sx, sy in self.SRC:
                    a += math.sin(w - k * math.hypot(x - sx, y - sy))
                a /= len(self.SRC)
                if a > 0.12:
                    self._chip(canvas, x, y,
                               self.SP * (0.30 + 0.72 * a))
                elif a > -0.35:
                    self._dot(canvas, x, y)

    def status(self):
        return "PULSE"


# ===========================================================================
# 4 — MOIRE: a twisting lattice over a still one; coincidence = a chip
# ===========================================================================
class MoireTwistScene(PortraitScene):
    name = "tall · moire"
    CYCLE = 10.0

    SP = 0.105          # lattice pitch, portrait units
    THETA = 0.16        # max twist, radians
    SWAYS = 1           # integer twist oscillations per cycle — the loop
    NEAR = 0.50         # coincidence threshold: only true beats get a chip

    @staticmethod
    def _wrap(v, sp):
        """Signed distance to the nearest multiple of sp."""
        return (v + sp * 0.5) % sp - sp * 0.5

    def draw(self, canvas):
        u = self._begin(canvas)
        th = self.THETA * math.sin(TAU * self.SWAYS * u)
        ct, st = math.cos(th), math.sin(th)
        sp = self.SP
        nx = int(1.0 / sp)
        ny = int(VR / sp)
        lim = sp * 0.5
        for j in range(-ny, ny + 1):
            y = j * sp
            for i in range(-nx, nx + 1):
                x = i * sp
                self._dot(canvas, x, y)          # the still lattice
                rx = x * ct - y * st             # the twisting lattice
                ry = x * st + y * ct
                if abs(rx) > 1.0 or abs(ry) > VR:
                    continue
                # the twisting lattice is DRAWN only where it lands on the
                # still one — the beat pattern itself, not the grit of two
                # interleaved dot fields
                d = math.hypot(self._wrap(rx, sp), self._wrap(ry, sp))
                near = 1.0 - d / lim
                if near > self.NEAR:
                    self._chip(canvas, rx, ry, sp * (0.30 + 0.62 * near))

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "BEAT" if abs(math.sin(TAU * self.SWAYS * u)) < 0.25 else "TWIST"


# ===========================================================================
# 5 — HELIX: a double helix climbing the frame, rungs riding phase stations
# ===========================================================================
class HelixClimbScene(PortraitScene):
    name = "tall · helix"
    CYCLE = 9.0

    A = 0.60            # helix half-width
    TWIST = 2.75        # strand turns over the full height (any value loops)
    CLIMB = 1           # integer phase turns per cycle — the loop
    RPT = 5             # rung phase stations per turn (odd: varied lengths)
    N = 150             # strand samples

    def _phase(self, h, u):
        return TAU * (self.TWIST * h + self.CLIMB * u)

    def draw(self, canvas):
        u = self._begin(canvas)
        for sgn in (0.0, math.pi):               # the two strands
            pts = []
            for kk in range(self.N + 1):
                h = kk / self.N
                ph = self._phase(h, u) + sgn
                pts.append((self.A * math.sin(ph), -VR + 2.0 * VR * h))
            self._poly(canvas, pts)
            # depth beads: the front-facing runs of the strand get weight
            for kk in range(0, self.N + 1, 5):
                h = kk / self.N
                ph = self._phase(h, u) + sgn
                z = math.cos(ph)
                if z > 0.35:
                    self._chip(canvas, self.A * math.sin(ph),
                               -VR + 2.0 * VR * h, 0.016 + 0.016 * z)
        # rungs live on fixed phase stations m/RPT; as u climbs they ride up
        m0 = math.ceil(self.CLIMB * u * self.RPT - 1e-9)
        m1 = math.floor((self.TWIST + self.CLIMB * u) * self.RPT + 1e-9)
        for m in range(m0, m1 + 1):
            h = (m / self.RPT - self.CLIMB * u) / self.TWIST
            if h < 0.0 or h > 1.0:
                continue
            x1 = self.A * math.sin(TAU * m / self.RPT)
            if abs(x1) < 0.05:                   # crossover: no rung
                continue
            y = -VR + 2.0 * VR * h
            self._seg(canvas, x1, y, -x1, y)
            z = math.cos(TAU * m / self.RPT)
            self._chip(canvas, x1, y, 0.030 + 0.022 * (z + 1.0) / 2.0)
            self._chip(canvas, -x1, y, 0.030 + 0.022 * (1.0 - z) / 2.0)

    def status(self):
        return "CLIMB"


# ===========================================================================
# 6 — MUNCH: (x XOR y) mod 16, every cell a sawtooth in XOR order
# ===========================================================================
class MunchFoldScene(PortraitScene):
    name = "tall · munch"
    CYCLE = 10.0

    GX, GY = 16, 28     # 16 x 28 cells — square cells in the 9:16 rect
    M = 16              # XOR-space period; the wave laps it once per cycle
    DECAY = 1.6         # fade curve after a cell pops (higher = snappier)

    def draw(self, canvas):
        u = self._begin(canvas)
        T = self.M * u
        cw = 2.0 / self.GX
        chh = 2.0 * VR / self.GY
        cell = min(cw, chh)
        for gy in range(self.GY):
            y = -VR + (gy + 0.5) * chh
            for gx in range(self.GX):
                x = -1.0 + (gx + 0.5) * cw
                v = (gx ^ (gy % self.M)) % self.M
                # each cell pops solid the instant the wave hits its value,
                # then decays over the whole cycle until it pops again —
                # cells sharing an XOR value pulse together, so the fresh
                # generations read as nested brackets folding through
                age = ((T - v) % self.M) / self.M
                b = (1.0 - age) ** self.DECAY
                if b > 0.10:
                    self._chip(canvas, x, y, cell * 0.94 * b)
                else:
                    self._dot(canvas, x, y)

    def status(self):
        return "XOR"


# ===========================================================================
# Integer periods or the loop tears
# ===========================================================================
def _selfcheck():
    assert abs(VR - 16.0 / 9.0) < 1e-12, "portrait_cycle: rect is not 9:16"
    for cls, keys in ((PhaseWallScene, ("TURNS", "WX", "WY")),
                      (LissaTableScene, ("DELTA",)),
                      (RippleTankScene, ("F",)),
                      (MoireTwistScene, ("SWAYS",)),
                      (HelixClimbScene, ("CLIMB", "RPT")),
                      (MunchFoldScene, ("M",))):
        for key in keys:
            v = getattr(cls, key)
            assert v == int(v) and v > 0, (
                "portrait_cycle: %s.%s = %r is not a positive integer — "
                "the loop would tear" % (cls.__name__, key, v))
    fx, fy = LissaTableScene.COLS, LissaTableScene.ROWS
    assert fx >= 1 and fy >= 1, "portrait_cycle: empty Lissajous table"


_selfcheck()


def make_scenes():
    return [
        PhaseWallScene(),    # 1  needle wall, travelling alignment
        LissaTableScene(),   # 2  the morphing Lissajous table
        RippleTankScene(),   # 3  two-source interference
        MoireTwistScene(),   # 4  twisting moiré, coincidence flashes
        HelixClimbScene(),   # 5  climbing double helix
        MunchFoldScene(),    # 6  munching squares, smooth wave
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
