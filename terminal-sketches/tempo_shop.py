#!/usr/bin/env python3
"""
tempo_shop — the TEMPO SHOP wordmark, animated in and out.

The SVG letterforms (9 glyph paths: T E M P O S H O P) are parsed once, flattened
(the cubic curves sampled to polylines), and even-odd scanline-filled into a mask
of Braille sub-pixels at the current canvas resolution. Every sketch then drives a
reveal / transform of that point set — always a quick, seamless loop eased with
**ease-in-out expo** (`_expo`): snap in, brief hold, snap out, repeat with no seam.

    1  tempo · wipe       a hard edge wipes the mark on L->R, then off L->R
    2  tempo · letters    each letter scale-pops in (staggered), then back out
    3  tempo · rise       letters rise up into place, then drop back down
    4  tempo · assemble   the mark flies together from a scatter, then apart
    5  tempo · scan       a bright scan bar reveals the mark, then wipes it away
    6  tempo · stretch    letters stretch open from thin vertical lines, then close

Run standalone: `python tempo_shop.py` (mpp's runner flags all work).
"""

import math
import re

from mpp import Scene, _clamp
from _tempo_paths import PATHS

TAU = 2.0 * math.pi


def _expo(x):
    """easeInOutExpo: near-still at the ends, a hard snap through the middle."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


# ===========================================================================
# SVG path -> filled polygons (subpaths of points, in SVG coords)
# ===========================================================================
_TOKEN = re.compile(r'[MLHCZ]|-?\d*\.?\d+')


def _flatten_cubic(out, p0, p1, p2, p3, steps=12):
    for k in range(1, steps + 1):
        t = k / steps
        mt = 1.0 - t
        a, b, c, d = mt * mt * mt, 3 * mt * mt * t, 3 * mt * t * t, t * t * t
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))


def _parse_path(d):
    """Return a list of closed subpaths (each a list of (x, y)) for a path's d."""
    toks = _TOKEN.findall(d)
    subs = []
    sub = []
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    cmd = None
    i, n = 0, len(toks)

    def flush():
        if len(sub) >= 2:
            subs.append(sub[:])

    while i < n:
        if toks[i] in "MLHCZ":
            cmd = toks[i]
            i += 1
            if cmd == "Z":
                sub.append(start)
                flush()
                sub.clear()
                cmd = None
                continue
        if cmd == "M":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            flush()
            sub.clear()
            sub.append((x, y))
            cur = start = (x, y)
            cmd = "L"                                   # extra pairs are lineto
        elif cmd == "L":
            x, y = float(toks[i]), float(toks[i + 1])
            i += 2
            sub.append((x, y))
            cur = (x, y)
        elif cmd == "H":
            x = float(toks[i])
            i += 1
            sub.append((x, cur[1]))
            cur = (x, cur[1])
        elif cmd == "C":
            p1 = (float(toks[i]), float(toks[i + 1]))
            p2 = (float(toks[i + 2]), float(toks[i + 3]))
            p3 = (float(toks[i + 4]), float(toks[i + 5]))
            i += 6
            _flatten_cubic(sub, cur, p1, p2, p3)
            cur = p3
        else:
            i += 1                                      # safety: skip stray token
    flush()
    return subs


# Parse the glyphs once at import; compute the overall bounding box.
_GLYPHS = [_parse_path(d) for d in PATHS]              # per-glyph list of subpaths
_MINX = min(p[0] for g in _GLYPHS for s in g for p in s)
_MAXX = max(p[0] for g in _GLYPHS for s in g for p in s)
_MINY = min(p[1] for g in _GLYPHS for s in g for p in s)
_MAXY = max(p[1] for g in _GLYPHS for s in g for p in s)
_SVG_W = _MAXX - _MINX
_SVG_H = _MAXY - _MINY


def _hash01(a, b):
    h = (a * 73856093 ^ b * 19349663) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


# ===========================================================================
# Base scene: rasterise the mask (cached per size) and loop a per-point anim
# ===========================================================================
class TempoScene(Scene):
    CYCLE = 2.8
    WIDTH_FRAC = 0.9      # wordmark width as a fraction of the canvas width
    IN_END = 0.30
    HOLD_END = 0.68
    STEP = 1             # dot-density stride: 1 fills every sub-pixel (dense);
    #                      raise it to sample the fill on a coarser grid so the
    #                      mark is built from fewer, evenly-spaced dots (~1/STEP^2
    #                      as many). Odd kept-rows are offset half a step so thin
    #                      strokes still catch dots (a quincunx, not a plain grid).

    def __init__(self):
        super().__init__()
        self._key = None
        self.pts = []
        self.gcx = []
        self.gcy = []

    def _build(self, cols, rows):
        """Even-odd scanline-fill the glyphs into Braille sub-pixels. Each point:
        (bx, by, gi, nx, ny, rnd). Also per-glyph centres in Braille units."""
        wu, hu = cols * 2, rows * 4
        s = min(self.WIDTH_FRAC * wu / _SVG_W, 0.86 * hu / _SVG_H)
        ox = (wu - _SVG_W * s) / 2.0 - _MINX * s
        oy = (hu - _SVG_H * s) / 2.0 - _MINY * s
        mw, mh = _SVG_W * s, _SVG_H * s
        mx0 = (wu - mw) / 2.0
        my0 = (hu - mh) / 2.0

        pts = []
        gsum = []
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
            step = max(1, int(self.STEP))
            sx = sy = cnt = 0.0
            for iy in range(iy0, iy1 + 1):
                if step > 1 and (iy % step):
                    continue                            # skip to a coarser grid
                yc = iy + 0.5
                xs = []
                for (ax, ay, bx, by) in edges:
                    if (ay <= yc < by) or (by <= yc < ay):
                        xs.append(ax + (yc - ay) / (by - ay) * (bx - ax))
                xs.sort()
                # offset every other kept row by half a step (quincunx), so the
                # dots interlock and thin strokes rarely fall entirely between rows.
                phase = (step // 2) if (step > 1 and (iy // step) & 1) else 0
                for m in range(0, len(xs) - 1, 2):
                    x_lo = max(0, int(math.ceil(xs[m])))
                    x_hi = min(wu - 1, int(math.floor(xs[m + 1])))
                    first = x_lo + ((phase - x_lo) % step) if step > 1 else x_lo
                    for ix in range(first, x_hi + 1, step):
                        nx = (ix - mx0) / mw if mw else 0.0
                        ny = (iy - my0) / mh if mh else 0.0
                        pts.append((float(ix), float(iy), gi, nx, ny,
                                    _hash01(ix, iy)))
                        sx += ix
                        sy += iy
                        cnt += 1
            gsum.append((gi, sx, sy, cnt))

        ng = len(_GLYPHS)
        self.gcx = [0.0] * ng
        self.gcy = [0.0] * ng
        for (gi, sx, sy, cnt) in gsum:
            if cnt:
                self.gcx[gi] = sx / cnt
                self.gcy[gi] = sy / cnt
        self.pts = pts
        self._key = (cols, rows)

    def draw(self, canvas):
        if self._key != (canvas.cols, canvas.rows):
            self._build(canvas.cols, canvas.rows)
        u = (self.t % self.CYCLE) / self.CYCLE
        ctx = self.frame(u, canvas)
        dot = canvas.set_dot
        for p in self.pts:
            r = self.point(p, u, ctx)
            if r is not None:
                dot(r[0], r[1])
        self.after(canvas, u, ctx)

    # -- overridable -------------------------------------------------------
    def frame(self, u, canvas):
        return None

    def point(self, p, u, ctx):
        return (p[0], p[1])

    def after(self, canvas, u, ctx):
        pass

    # in 0..1 during the intro, hold at 1, out 1..0 during the outro
    def _reveal(self, u):
        if u < self.IN_END:
            return _expo(u / self.IN_END)
        if u < self.HOLD_END:
            return 1.0
        return 1.0 - _expo((u - self.HOLD_END) / (1.0 - self.HOLD_END))

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "IN" if u < self.IN_END else "HOLD" if u < self.HOLD_END else "OUT"


# ===========================================================================
# 1 — WIPE  (a hard edge wipes on L->R, then off L->R)
# ===========================================================================
class TempoWipeScene(TempoScene):
    name = "tempo · wipe"
    EDGE = 0.06

    def frame(self, u, canvas):
        if u < self.HOLD_END:                          # wipe ON from the left
            front = _expo(_clamp(u / self.IN_END, 0.0, 1.0))
            return (True, front)
        front = _expo((u - self.HOLD_END) / (1.0 - self.HOLD_END))
        return (False, front)                          # wipe OFF from the left

    def point(self, p, u, ctx):
        on, front = ctx
        nx = p[3]
        vis = (nx <= front + self.EDGE) if on else (nx > front - self.EDGE)
        return (p[0], p[1]) if vis else None


# ===========================================================================
# 2 — LETTERS  (each letter scale-pops in, staggered, then out)
# ===========================================================================
class TempoLettersScene(TempoScene):
    name = "tempo · letters"
    STAGGER = 0.6          # fraction of the in-window spread across the letters

    def frame(self, u, canvas):
        ng = len(_GLYPHS)
        sc = []
        for gi in range(ng):
            frac = gi / max(1, ng - 1)
            if u < self.HOLD_END:
                a = _clamp((u / self.HOLD_END) * (1 + self.STAGGER)
                           - frac * self.STAGGER, 0.0, 1.0)
                # only the in-window portion eases; hold stays at 1
                sc.append(_expo(_clamp(a / (self.IN_END / self.HOLD_END), 0, 1)))
            else:
                o = (u - self.HOLD_END) / (1.0 - self.HOLD_END)
                a = _clamp(o * (1 + self.STAGGER) - (ng - 1 - gi) / max(1, ng - 1)
                           * self.STAGGER, 0.0, 1.0)
                sc.append(1.0 - _expo(a))
        return sc

    def point(self, p, u, ctx):
        gi = p[2]
        s = ctx[gi]
        if s <= 0.01:
            return None
        cx, cy = self.gcx[gi], self.gcy[gi]
        return (cx + (p[0] - cx) * s, cy + (p[1] - cy) * s)


# ===========================================================================
# 3 — RISE  (letters rise up into place, staggered, then drop back)
# ===========================================================================
class TempoRiseScene(TempoScene):
    name = "tempo · rise"
    RISE = 0.5             # start offset as a fraction of canvas height (below)
    STAGGER = 0.5

    def frame(self, u, canvas):
        ng = len(_GLYPHS)
        hu = canvas.rows * 4
        offs = []
        for gi in range(ng):
            frac = gi / max(1, ng - 1)
            if u < self.HOLD_END:
                a = _clamp((u / self.HOLD_END) * (1 + self.STAGGER)
                           - frac * self.STAGGER, 0.0, 1.0)
                rv = _expo(_clamp(a / (self.IN_END / self.HOLD_END), 0, 1))
            else:
                o = (u - self.HOLD_END) / (1.0 - self.HOLD_END)
                a = _clamp(o * (1 + self.STAGGER)
                           - (ng - 1 - gi) / max(1, ng - 1) * self.STAGGER,
                           0.0, 1.0)
                rv = 1.0 - _expo(a)
            offs.append((1.0 - rv) * self.RISE * hu)
        return offs

    def point(self, p, u, ctx):
        return (p[0], p[1] + ctx[p[2]])


# ===========================================================================
# 4 — ASSEMBLE  (flies together from a scatter, then apart)
# ===========================================================================
class TempoAssembleScene(TempoScene):
    name = "tempo · assemble"
    SPREAD = 0.55          # scatter distance as a fraction of the short axis
    STAGGER = 0.5

    def frame(self, u, canvas):
        mind = min(canvas.cols * 2, canvas.rows * 4)
        phase_in = u < self.HOLD_END
        if phase_in:
            base = _clamp(u / self.HOLD_END, 0.0, 1.0)
        else:
            base = (u - self.HOLD_END) / (1.0 - self.HOLD_END)
        return (phase_in, base, mind * self.SPREAD)

    def point(self, p, u, ctx):
        phase_in, base, spread = ctx
        rnd = p[5]
        stag = rnd * self.STAGGER
        if phase_in:
            prog = _expo(_clamp((base * (1 + self.STAGGER) - stag)
                                / max(1e-6, self.IN_END / self.HOLD_END), 0, 1))
        else:
            prog = 1.0 - _expo(_clamp(base * (1 + self.STAGGER) - stag, 0, 1))
        ang = rnd * TAU * 3.0 + p[3] * TAU
        d = (1.0 - prog) * spread
        return (p[0] + math.cos(ang) * d, p[1] + math.sin(ang) * d)


# ===========================================================================
# 5 — SCAN  (a bright scan bar reveals the mark, then wipes it away)
# ===========================================================================
class TempoScanScene(TempoScene):
    name = "tempo · scan"
    EDGE = 0.05

    def frame(self, u, canvas):
        if u < self.HOLD_END:
            front = _expo(_clamp(u / self.IN_END, 0.0, 1.0))
            return (True, front, canvas)
        front = _expo((u - self.HOLD_END) / (1.0 - self.HOLD_END))
        return (False, front, canvas)

    def point(self, p, u, ctx):
        on, front, _ = ctx
        nx = p[3]
        vis = (nx <= front + self.EDGE) if on else (nx > front - self.EDGE)
        return (p[0], p[1]) if vis else None

    def after(self, canvas, u, ctx):
        on, front, _ = ctx
        moving = u < self.IN_END or u >= self.HOLD_END
        if not moving:
            return
        wu, hu = canvas.wu, canvas.hu
        s = min(self.WIDTH_FRAC * wu / _SVG_W, 0.86 * hu / _SVG_H)
        mw = _SVG_W * s
        mx0 = (wu - mw) / 2.0
        my0 = (hu - _SVG_H * s) / 2.0
        x = mx0 + front * mw
        y = my0 - 3
        y1 = my0 + _SVG_H * s + 3
        while y <= y1:                                 # a bright vertical scan bar
            canvas.set_dot(x, y)
            canvas.set_dot(x + 1, y)
            y += 1


# ===========================================================================
# 6 — STRETCH  (letters stretch open from thin vertical lines, then close)
# ===========================================================================
class TempoStretchScene(TempoScene):
    name = "tempo · stretch"
    STAGGER = 0.5

    def frame(self, u, canvas):
        ng = len(_GLYPHS)
        sx = []
        for gi in range(ng):
            frac = gi / max(1, ng - 1)
            if u < self.HOLD_END:
                a = _clamp((u / self.HOLD_END) * (1 + self.STAGGER)
                           - frac * self.STAGGER, 0.0, 1.0)
                sx.append(_expo(_clamp(a / (self.IN_END / self.HOLD_END), 0, 1)))
            else:
                o = (u - self.HOLD_END) / (1.0 - self.HOLD_END)
                a = _clamp(o * (1 + self.STAGGER)
                           - (ng - 1 - gi) / max(1, ng - 1) * self.STAGGER,
                           0.0, 1.0)
                sx.append(1.0 - _expo(a))
        return sx

    def point(self, p, u, ctx):
        gi = p[2]
        s = ctx[gi]
        if s <= 0.01:
            return None
        cx = self.gcx[gi]
        return (cx + (p[0] - cx) * s, p[1])            # stretch on X only


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        TempoWipeScene(),          # 1  wipe
        TempoLettersScene(),       # 2  letters
        TempoRiseScene(),          # 3  rise
        TempoAssembleScene(),      # 4  assemble
        TempoScanScene(),          # 5  scan
        TempoStretchScene(),       # 6  stretch
    ]


if __name__ == "__main__":
    import mpp

    mpp.main(make_scenes())
