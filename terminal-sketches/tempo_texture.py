#!/usr/bin/env python3
"""
tempo_texture — the TEMPO SHOP wordmark, rendered with many BRAILLE TEXTURES.

The clean fill (tempo_shop) reads as too perfect: a dead-flat solid raster. This
file keeps the exact same letterforms — the 9 SVG glyphs, parsed and even-odd
scanline-filled into Braille sub-pixels (all reused from tempo_shop) — but treats
the FILL as a surface to rough up. Every scene is a STILL (no motion): flip
between them with the digit keys / arrows to compare treatments.

The rasteriser hands each scene three things per size (built once, cached):
  • a dense point cloud of every filled sub-pixel, each carrying its glyph, its
    normalised (nx, ny) position in the mark, a stable hash, its distance to the
    nearest empty cell (edge distance), and a smooth value-noise sample
  • the filled-cell set (for coarse-grid halftone / size treatments)
  • the mark's bounding box (for left->right gradients)

    1  solid          the flat reference — every sub-pixel (the "too perfect" one)
    2  stipple grad   density thins left->right, a dry-brush fade
    3  halftone       a regular dot screen — even braille discs on a grid
    4  size mix       marks grow left->right: fine dots -> bold half-blocks
    5  jumble         every dot jittered off its cell — a hand-stippled wobble
    6  distressed     worn ink: blotchy holes punched out, edges nibbled
    7  grain          a light film speckle, mostly solid
    8  rough edges    solid core, ragged distressed outline
    9  scanlines      horizontal rules with gaps — a woven / CRT hatch
   10  contour        concentric bands keyed to edge distance — topographic
   11  mottle         cloudy patchy coverage straight from the noise field
   12  crosshatch     engraving hatch, graded from cross- to single-hatch
   13  spray          solid mark plus an ink spatter flung off the edges

Textures mix the two mpp layers: fine Braille dots for stipple, and solid
half-blocks (square_fill) for the big end of the size mix. Same runner as the
hatch_* family. Run standalone: `python tempo_texture.py`.
"""

import math
from collections import deque

from mpp import Scene, _clamp
from tempo_shop import (_GLYPHS, _MINX, _MINY, _SVG_W, _SVG_H, _hash01)

TAU = 2.0 * math.pi


# ===========================================================================
# Smooth 2-octave value noise over Braille units — the organic field the
# distress / mottle / spray treatments carve the fill with.
# ===========================================================================
def _vnoise(x, y):
    def octave(freq):
        gx, gy = x * freq, y * freq
        x0, y0 = int(math.floor(gx)), int(math.floor(gy))
        fx, fy = gx - x0, gy - y0
        sx = fx * fx * (3.0 - 2.0 * fx)
        sy = fy * fy * (3.0 - 2.0 * fy)
        n00 = _hash01(x0 & 0xFFFF, y0 & 0xFFFF)
        n10 = _hash01((x0 + 1) & 0xFFFF, y0 & 0xFFFF)
        n01 = _hash01(x0 & 0xFFFF, (y0 + 1) & 0xFFFF)
        n11 = _hash01((x0 + 1) & 0xFFFF, (y0 + 1) & 0xFFFF)
        a = n00 + (n10 - n00) * sx
        b = n01 + (n11 - n01) * sx
        return a + (b - a) * sy
    return 0.62 * octave(0.11) + 0.38 * octave(0.26)


def _disc(canvas, x, y, r):
    """A small filled disc of Braille dots — the round mark the dotted textures
    stamp (collapses to a single dot when tiny)."""
    if r <= 0.75:
        canvas.set_dot(x, y)
        return
    ri = int(r) + 1
    r2 = r * r
    for dy in range(-ri, ri + 1):
        yy = y + dy
        d2y = dy * dy
        for dx in range(-ri, ri + 1):
            if dx * dx + d2y <= r2:
                canvas.set_dot(x + dx, yy)


# ===========================================================================
# Base: rasterise the mask once per size, expose the enriched point cloud.
# Point tuple: (bx, by, gi, nx, ny, rnd, edge, noise)
#   0 bx,by  Braille-unit position      3 nx,ny  normalised in the mark 0..1
#   2 gi     glyph index                5 rnd    stable hash 0..1
#   6 edge   distance to nearest empty  7 noise  value-noise 0..1
# ===========================================================================
class TempoTextureScene(Scene):
    WIDTH_FRAC = 0.92     # wordmark width as a fraction of the canvas width

    def __init__(self):
        super().__init__()
        self._key = None
        self.pts = []
        self.filled = set()
        self.mbox = (0.0, 0.0, 1.0, 1.0)
        self.wu = self.hu = 0

    def _build(self, cols, rows):
        wu, hu = cols * 2, rows * 4
        s = min(self.WIDTH_FRAC * wu / _SVG_W, 0.86 * hu / _SVG_H)
        ox = (wu - _SVG_W * s) / 2.0 - _MINX * s
        oy = (hu - _SVG_H * s) / 2.0 - _MINY * s
        mw, mh = _SVG_W * s, _SVG_H * s
        mx0, my0 = (wu - mw) / 2.0, (hu - mh) / 2.0

        filled = set()
        raw = []
        for gi, glyph in enumerate(_GLYPHS):
            edges = []
            ys = []
            for sub in glyph:
                tsub = [(ox + x * s, oy + y * s) for (x, y) in sub]
                for k in range(len(tsub) - 1):
                    ax, ay = tsub[k]
                    bx, by = tsub[k + 1]
                    if ay != by:
                        edges.append((ax, ay, bx, by))
                    ys.append(ay)
            if not edges:
                continue
            iy0 = max(0, int(min(ys)))
            iy1 = min(hu - 1, int(max(ys)) + 1)
            for iy in range(iy0, iy1 + 1):
                yc = iy + 0.5
                xs = []
                for (ax, ay, bx, by) in edges:
                    if (ay <= yc < by) or (by <= yc < ay):
                        xs.append(ax + (yc - ay) / (by - ay) * (bx - ax))
                xs.sort()
                for m in range(0, len(xs) - 1, 2):
                    xlo = max(0, int(math.ceil(xs[m])))
                    xhi = min(wu - 1, int(math.floor(xs[m + 1])))
                    for ix in range(xlo, xhi + 1):
                        filled.add((ix, iy))
                        raw.append((ix, iy, gi))

        # Edge-distance transform: multi-source BFS inward from the boundary, so
        # every cell knows how deep into the stroke it sits (1 = on the edge).
        dist = {}
        dq = deque()
        for (ix, iy) in filled:
            if ((ix - 1, iy) not in filled or (ix + 1, iy) not in filled
                    or (ix, iy - 1) not in filled or (ix, iy + 1) not in filled):
                dist[(ix, iy)] = 1
                dq.append((ix, iy))
        while dq:
            x, y = dq.popleft()
            d = dist[(x, y)]
            for nb in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nb in filled and nb not in dist:
                    dist[nb] = d + 1
                    dq.append(nb)

        pts = []
        for (ix, iy, gi) in raw:
            nx = (ix - mx0) / mw if mw else 0.0
            ny = (iy - my0) / mh if mh else 0.0
            pts.append((float(ix), float(iy), gi, nx, ny,
                        _hash01(ix, iy), dist.get((ix, iy), 1), _vnoise(ix, iy)))

        self.pts = pts
        self.filled = filled
        self.mbox = (mx0, my0, mw, mh)
        self.wu, self.hu = wu, hu
        self._key = (cols, rows)

    def draw(self, canvas):
        if self._key != (canvas.cols, canvas.rows):
            self._build(canvas.cols, canvas.rows)
        self.render(canvas)

    # -- overridable -------------------------------------------------------
    def render(self, canvas):
        """Default: draw every point the treatment keeps, as a single dot."""
        dot = canvas.set_dot
        for p in self.pts:
            if self.keep(p):
                dot(p[0], p[1])

    def keep(self, p):
        return True

    def status(self):
        return "STILL"


# ===========================================================================
# 1 — SOLID  (the flat reference)
# ===========================================================================
class TxSolidScene(TempoTextureScene):
    name = "tempo · solid"


# ===========================================================================
# 2 — STIPPLE GRADIENT  (density thins left -> right)
# ===========================================================================
class TxStippleGradScene(TempoTextureScene):
    name = "tempo · stipple grad"

    def keep(self, p):
        density = 1.18 - 1.08 * p[3]          # ~full at the left, ~10% at the right
        return p[5] < density


# ===========================================================================
# 3 — HALFTONE  (a regular dot screen on a grid)
# ===========================================================================
class TxHalftoneScene(TempoTextureScene):
    name = "tempo · halftone"
    G = 3                                      # screen pitch (Braille units)
    R = 1.15                                   # dot radius

    def render(self, canvas):
        mx0, my0, mw, mh = self.mbox
        filled = self.filled
        x0, y0 = int(mx0) - self.G, int(my0) - self.G
        x1, y1 = int(mx0 + mw) + self.G, int(my0 + mh) + self.G
        y = y0
        while y <= y1:
            x = x0
            while x <= x1:
                if (x, y) in filled:
                    _disc(canvas, x, y, self.R)
                x += self.G
            y += self.G


# ===========================================================================
# 4 — SIZE MIX  (marks grow left -> right: fine dots -> bold blocks)
# ===========================================================================
class TxSizeMixScene(TempoTextureScene):
    name = "tempo · size mix"
    G = 4

    def render(self, canvas):
        mx0, my0, mw, mh = self.mbox
        filled = self.filled
        x0, y0 = int(mx0) - self.G, int(my0) - self.G
        x1, y1 = int(mx0 + mw) + self.G, int(my0 + mh) + self.G
        y = y0
        while y <= y1:
            x = x0
            while x <= x1:
                if (x, y) in filled:
                    nx = (x - mx0) / mw if mw else 0.0
                    size = 0.6 + nx * nx * 6.0     # eased so the big end dominates
                    if size < 1.2:
                        canvas.set_dot(x, y)
                    elif size < 3.0:
                        _disc(canvas, x, y, size * 0.5)
                    else:
                        canvas.square_fill(x, y, size)   # bold half-block
                x += self.G
            y += self.G


# ===========================================================================
# 5 — JUMBLE  (every dot jittered off its cell)
# ===========================================================================
class TxJumbleScene(TempoTextureScene):
    name = "tempo · jumble"
    J = 2.3                                    # jitter radius (Braille units)

    def render(self, canvas):
        dot = canvas.set_dot
        J = self.J
        for p in self.pts:
            h2 = _hash01(int(p[1]) * 3 + 1, int(p[0]) * 3 + 1)   # 2nd hash
            ox = (p[5] - 0.5) * 2.0 * J
            oy = (h2 - 0.5) * 2.0 * J
            dot(p[0] + ox, p[1] + oy)


# ===========================================================================
# 6 — DISTRESSED  (worn ink: blotchy holes + nibbled edges)
# ===========================================================================
class TxDistressedScene(TempoTextureScene):
    name = "tempo · distressed"

    def keep(self, p):
        n, edge = p[7], p[6]
        if n < 0.34:                           # worn-through blotches
            return False
        if edge <= 1 and p[5] < 0.5:           # nibble the outline
            return False
        if edge <= 2 and n < 0.44:             # thin the near-edge ink
            return False
        return True


# ===========================================================================
# 7 — GRAIN  (a light film speckle, mostly solid)
# ===========================================================================
class TxGrainScene(TempoTextureScene):
    name = "tempo · grain"

    def keep(self, p):
        return p[5] > 0.12                     # drop ~1 in 8 sub-pixels


# ===========================================================================
# 8 — ROUGH EDGES  (solid core, ragged distressed outline)
# ===========================================================================
class TxRoughEdgesScene(TempoTextureScene):
    name = "tempo · rough edges"

    def keep(self, p):
        if p[6] > 2:                           # deep interior stays solid
            return True
        return p[7] > 0.44 or p[5] > 0.62      # boundary frays on the noise field


# ===========================================================================
# 9 — SCANLINES  (horizontal rules with gaps)
# ===========================================================================
class TxScanlinesScene(TempoTextureScene):
    name = "tempo · scanlines"

    def keep(self, p):
        return (int(p[1]) % 3) != 2            # 2 rows on, 1 off


# ===========================================================================
# 10 — CONTOUR  (concentric bands keyed to edge distance)
# ===========================================================================
class TxContourScene(TempoTextureScene):
    name = "tempo · contour"

    def keep(self, p):
        e = int(p[6])
        return e == 1 or (e % 2) == 0          # outline + alternating inner bands


# ===========================================================================
# 11 — MOTTLE  (cloudy patchy coverage from the noise field)
# ===========================================================================
class TxMottleScene(TempoTextureScene):
    name = "tempo · mottle"

    def keep(self, p):
        return p[7] > 0.46


# ===========================================================================
# 12 — CROSSHATCH  (engraving hatch, graded cross- -> single-hatch)
# ===========================================================================
class TxCrosshatchScene(TempoTextureScene):
    name = "tempo · crosshatch"

    def keep(self, p):
        a = (int(p[0] + p[1]) % 4) == 0        # one diagonal family
        b = (int(p[0] - p[1]) % 4) == 0        # the other
        if p[3] < 0.5:                         # dense left: full crosshatch
            return a or b
        return a                               # sparse right: single hatch


# ===========================================================================
# 13 — SPRAY  (solid mark plus an ink spatter flung off the edges)
# ===========================================================================
class TxSprayScene(TempoTextureScene):
    name = "tempo · spray"

    def render(self, canvas):
        dot = canvas.set_dot
        for p in self.pts:
            if p[6] > 1 or p[5] > 0.18:        # near-solid body (edges lightly worn)
                dot(p[0], p[1])
            if p[6] <= 1 and p[7] > 0.5:       # fling spatter off the outline
                for k in range(2):
                    h = _hash01(int(p[0]) * 5 + k * 31, int(p[1]) * 5 + k * 17)
                    h2 = _hash01(int(p[1]) * 7 + k * 13, int(p[0]) * 7 + k * 29)
                    ang = h * TAU
                    rr = 1.5 + h2 * 4.5
                    dot(p[0] + math.cos(ang) * rr, p[1] + math.sin(ang) * rr)


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        TxSolidScene(),            # 1  solid (reference)
        TxStippleGradScene(),      # 2  stipple gradient
        TxHalftoneScene(),         # 3  halftone
        TxSizeMixScene(),          # 4  size mix
        TxJumbleScene(),           # 5  jumble
        TxDistressedScene(),       # 6  distressed
        TxGrainScene(),            # 7  grain
        TxRoughEdgesScene(),       # 8  rough edges
        TxScanlinesScene(),        # 9  scanlines
        TxContourScene(),          # 10 contour
        TxMottleScene(),           # 11 mottle
        TxCrosshatchScene(),       # 12 crosshatch
        TxSprayScene(),            # 13 spray
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
