#!/usr/bin/env python3
"""
table_cycle — the ruling lines of a data table, given the full life cycle.

No values, no text — just the grid: column dividers, row rules, a header
band, a cursor. Six scenes, each a different way for a table to ASSEMBLE,
hold (with one quiet, sequential motion — a cursor, a shimmer, a rain of
dashes), and DISASSEMBLE. The vocabulary of the reference sheets: thin
braille rules, an occasional solid block bar where a header or a highlight
wants weight, everything staggered on ease-in-out-expo windows so a front
sweeps through the table — lines never pop.

Every scene: intro over [0, T_IN], hold over [T_IN, T_OUT], outro over
[T_OUT, 1], truly empty frame at the wrap, loop byte-identical. Hold motions
fade in and out on a sin envelope so they never snap at the phase edges.

    1  table · rules    row rules pen in left-to-right, top-to-bottom, then
                        the columns stitch down; a bold cursor rule steps
                        row by row during the hold; unbuilds in reverse
    2  table · split    the border pens around, then dividers grow from
                        their midpoints, centre-outward, alternating
                        vertical / horizontal — the table subdivides itself
    3  table · unfold   every row line starts stacked on the top rule and
                        deals downward into place, the columns stretching
                        to keep up; an accordion breath during the hold
    4  table · cells    each cell grows out of its own centre in a diagonal
                        wave until the outlines fuse into one grid; corner
                        chips glow along the same diagonal during the hold
    5  table · blinds   columns drop in from above the frame like blinds,
                        rows wipe across; a thin rain of dashes falls down
                        the columns while the table holds
    6  table · ledger   a solid block header band wipes in first, the body
                        follows; a block cursor bar sweeps the rows

Run: `python table_cycle.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from listen_cycle import _expo, _stag

TAU = 2.0 * math.pi


def _bar(canvas, xa, ya, xb, yb, th):
    """A solid block bar, drawn in short chunks (rect_fill scans the whole
    bounding box, so one long bar would cost its length squared)."""
    L = math.hypot(xb - xa, yb - ya)
    if L <= 0.5 or th <= 0.5:
        return
    ang = math.atan2(yb - ya, xb - xa)
    n = max(1, int(L / max(8.0, th * 3.0)))
    for i in range(n):
        m = (i + 0.5) / n
        canvas.rect_fill(xa + (xb - xa) * m, ya + (yb - ya) * m,
                         L / n + 1.0, th, ang)


class TableScene(Scene):
    """The table's geometry and the phase machinery. A scene implements
    table(canvas, xs, ys, u, a, b): xs/ys are the column/row line positions,
    a and b the intro/outro progresses."""

    CYCLE = 9.00
    T_IN = 0.32
    T_OUT = 0.72
    W = 0.50           # stagger window width
    NC, NR = 5, 4      # columns, rows (of cells)
    WF, HF = 0.74, 0.58

    def _geom(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        tw, th = wu * self.WF, hu * self.HF
        x0, y0 = (wu - tw) / 2.0, (hu - th) / 2.0
        xs = [x0 + tw * i / self.NC for i in range(self.NC + 1)]
        ys = [y0 + th * j / self.NR for j in range(self.NR + 1)]
        return xs, ys

    def _phases(self, u):
        a = _clamp(u / self.T_IN, 0.0, 1.0)
        b = _clamp((u - self.T_OUT) / (1.0 - self.T_OUT), 0.0, 1.0)
        return a, b

    def _hold(self, u):
        """Hold progress 0..1, and its fade envelope (0 at both edges)."""
        hl = _clamp((u - self.T_IN) / (self.T_OUT - self.T_IN), 0.0, 1.0)
        return hl, math.sin(math.pi * hl)

    @staticmethod
    def _hspan(canvas, y, xa, xb, f0, f1):
        if f1 - f0 > 1e-3:
            canvas.line(xa + (xb - xa) * f0, y, xa + (xb - xa) * f1, y)

    @staticmethod
    def _vspan(canvas, x, ya, yb, f0, f1):
        if f1 - f0 > 1e-3:
            canvas.line(x, ya + (yb - ya) * f0, x, ya + (yb - ya) * f1)

    def draw(self, canvas):
        u = (self.t % self.CYCLE) / self.CYCLE
        a, b = self._phases(u)
        if a <= 0.0 and b >= 1.0:
            return
        xs, ys = self._geom(canvas)
        self.table(canvas, xs, ys, u, a, b)

    def table(self, canvas, xs, ys, u, a, b):
        raise NotImplementedError

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < self.T_IN:
            return "BUILD"
        return "HOLD" if u < self.T_OUT else "CLEAR"


# ===========================================================================
# 1 — RULES: rows pen in, columns stitch down, a cursor steps the rows
# ===========================================================================
class TableRulesScene(TableScene):
    name = "table · rules"
    HSPLIT = 0.55   # fraction of the intro the row rules own

    def table(self, canvas, xs, ys, u, a, b):
        a1 = _clamp(a / self.HSPLIT, 0.0, 1.0)
        a2 = _clamp((a - self.HSPLIT) / (1.0 - self.HSPLIT), 0.0, 1.0)
        b1 = _clamp(b / (1.0 - self.HSPLIT), 0.0, 1.0)          # columns out
        b2 = _clamp((b - (1.0 - self.HSPLIT)) / self.HSPLIT, 0.0, 1.0)
        for j in range(self.NR + 1):                # row rules, top -> bottom
            f1 = _stag(a1, j, self.NR + 1, self.W)
            f0 = _stag(b2, j, self.NR + 1, self.W)
            self._hspan(canvas, ys[j], xs[0], xs[-1], f0, f1)
        for i in range(self.NC + 1):                # columns, left -> right
            g1 = _stag(a2, i, self.NC + 1, self.W)
            g0 = _stag(b1, i, self.NC + 1, self.W)
            self._vspan(canvas, xs[i], ys[0], ys[-1], g0, g1)
        hl, env = self._hold(u)
        if env > 0.05:
            # the cursor: a bold rule stepping down the row boundaries
            step = hl * self.NR
            n = min(int(step), self.NR - 1)
            yc = ys[0] + (n + _expo(_clamp(step - n, 0.0, 1.0))) \
                * (ys[1] - ys[0])
            _bar(canvas, xs[0], yc, xs[-1], yc, 2.6 * env)

    def status(self):
        return "RULES"


# ===========================================================================
# 2 — SPLIT: the table subdivides itself, centre-outward
# ===========================================================================
class TableSplitScene(TableScene):
    name = "table · split"
    BORDER = 0.28   # fraction of the intro the border pen owns

    def _order(self):
        """Dividers centre-outward, alternating vertical / horizontal."""
        vs = sorted(range(1, self.NC), key=lambda i: abs(i - self.NC / 2.0))
        hs = sorted(range(1, self.NR), key=lambda j: abs(j - self.NR / 2.0))
        out, k = [], 0
        while k < max(len(vs), len(hs)):
            if k < len(vs):
                out.append(("v", vs[k]))
            if k < len(hs):
                out.append(("h", hs[k]))
            k += 1
        return out

    def _border(self, canvas, xs, ys, f0, f1):
        """The perimeter from fraction f0 to f1, clockwise from top-left."""
        if f1 - f0 <= 1e-3:
            return
        w, h = xs[-1] - xs[0], ys[-1] - ys[0]
        P = 2.0 * (w + h)
        marks = [0.0, w / P, (w + h) / P, (2 * w + h) / P, 1.0]
        cor = [(xs[0], ys[0]), (xs[-1], ys[0]), (xs[-1], ys[-1]),
               (xs[0], ys[-1]), (xs[0], ys[0])]

        def at(s):
            for k in range(4):
                if s <= marks[k + 1] or k == 3:
                    f = (s - marks[k]) / (marks[k + 1] - marks[k])
                    ax, ay = cor[k]
                    bx, by = cor[k + 1]
                    return (ax + (bx - ax) * f, ay + (by - ay) * f)
        pts = [at(f0 + (f1 - f0) * k / 48) for k in range(49)]
        for p, q in zip(pts, pts[1:]):
            canvas.line(p[0], p[1], q[0], q[1])

    def table(self, canvas, xs, ys, u, a, b):
        a1 = _clamp(a / self.BORDER, 0.0, 1.0)
        a2 = _clamp((a - self.BORDER) / (1.0 - self.BORDER), 0.0, 1.0)
        b1 = _clamp(b / (1.0 - self.BORDER), 0.0, 1.0)
        b2 = _clamp((b - (1.0 - self.BORDER)) / self.BORDER, 0.0, 1.0)
        self._border(canvas, xs, ys, _expo(b2), _expo(a1))
        order = self._order()
        nd = len(order)
        for r, (kind, idx) in enumerate(order):
            e = (_stag(a2, r, nd, self.W)
                 * (1.0 - _stag(b1, nd - 1 - r, nd, self.W)))
            if e <= 0.004:
                continue
            if kind == "v":
                ym = (ys[0] + ys[-1]) / 2.0
                half = (ys[-1] - ys[0]) / 2.0 * e
                canvas.line(xs[idx], ym - half, xs[idx], ym + half)
            else:
                xm = (xs[0] + xs[-1]) / 2.0
                half = (xs[-1] - xs[0]) / 2.0 * e
                canvas.line(xm - half, ys[idx], xm + half, ys[idx])
        hl, env = self._hold(u)
        if env > 0.05:
            # a bold cell outline hopping down the diagonal
            k = min(self.NC, self.NR)
            step = hl * k
            n = min(int(step), k - 1)
            e = _expo(_clamp(step - n, 0.0, 1.0))
            ci = n if n == k - 1 else n + e          # slides cell to cell
            x0 = xs[0] + (xs[1] - xs[0]) * ci
            y0 = ys[0] + (ys[1] - ys[0]) * ci
            th = 2.2 * env
            _bar(canvas, x0, y0, x0 + xs[1] - xs[0], y0, th)
            _bar(canvas, x0, y0 + ys[1] - ys[0],
                 x0 + xs[1] - xs[0], y0 + ys[1] - ys[0], th)
            _bar(canvas, x0, y0, x0, y0 + ys[1] - ys[0], th)
            _bar(canvas, x0 + xs[1] - xs[0], y0,
                 x0 + xs[1] - xs[0], y0 + ys[1] - ys[0], th)

    def status(self):
        return "SPLIT"


# ===========================================================================
# 3 — UNFOLD: rows deal downward out of the top rule
# ===========================================================================
class TableUnfoldScene(TableScene):
    name = "table · unfold"
    BREATH = 0.055  # accordion amplitude, in row heights

    def table(self, canvas, xs, ys, u, a, b):
        hl, env = self._hold(u)
        a1 = _clamp(a * 2.5, 0.0, 1.0)               # the top rule, quickly
        b2 = _clamp((b - 0.75) / 0.25, 0.0, 1.0)     # and it leaves last
        self._hspan(canvas, ys[0], xs[0], xs[-1], _expo(b2), _expo(a1))
        ymax = ys[0]
        for j in range(1, self.NR + 1):              # rows deal downward
            e = (_stag(a, j - 1, self.NR, self.W)
                 * (1.0 - _stag(b, self.NR - j, self.NR, self.W)))
            if e <= 0.004:
                continue
            yj = ys[0] + (ys[j] - ys[0]) * e
            yj += (ys[1] - ys[0]) * self.BREATH * env \
                * math.sin(TAU * hl - 0.9 * j)
            self._hspan(canvas, yj, xs[0], xs[-1], 0.0, 1.0)
            ymax = max(ymax, yj)
        if ymax - ys[0] > 1.0:                       # columns keep up
            for i in range(self.NC + 1):
                canvas.line(xs[i], ys[0], xs[i], ymax)

    def status(self):
        return "UNFOLD"


# ===========================================================================
# 4 — CELLS: the grid fuses out of cells growing in a diagonal wave
# ===========================================================================
class TableCellsScene(TableScene):
    name = "table · cells"
    W = 0.60

    def table(self, canvas, xs, ys, u, a, b):
        ranks = self.NC + self.NR - 1
        for j in range(self.NR):
            for i in range(self.NC):
                r = i + j
                e = (_stag(a, r, ranks, self.W)
                     * (1.0 - _stag(b, r, ranks, self.W)))
                if e <= 0.004:
                    continue
                cx = (xs[i] + xs[i + 1]) / 2.0
                cy = (ys[j] + ys[j + 1]) / 2.0
                hw = (xs[i + 1] - xs[i]) / 2.0 * e
                hh = (ys[j + 1] - ys[j]) / 2.0 * e
                canvas.line(cx - hw, cy - hh, cx + hw, cy - hh)
                canvas.line(cx - hw, cy + hh, cx + hw, cy + hh)
                canvas.line(cx - hw, cy - hh, cx - hw, cy + hh)
                canvas.line(cx + hw, cy - hh, cx + hw, cy + hh)
        hl, env = self._hold(u)
        if env > 0.05:
            # corner chips glowing along the same diagonal, one sweep
            wave = hl * (ranks + 2.0) - 1.0
            for j in range(1, self.NR):
                for i in range(1, self.NC):
                    act = math.exp(-((i + j - wave) ** 2) / 1.1)
                    size = 2.6 * act * env
                    if size >= 0.8:
                        canvas.square_fill(xs[i], ys[j], size)

    def status(self):
        return "CELLS"


# ===========================================================================
# 5 — BLINDS: columns drop in from above, dash-rain while it holds
# ===========================================================================
class TableBlindsScene(TableScene):
    name = "table · blinds"
    VSPLIT = 0.58   # fraction of the intro the falling columns own
    RAIN = 3        # integer rain laps per cycle (keeps the loop exact)

    def table(self, canvas, xs, ys, u, a, b):
        a1 = _clamp(a / self.VSPLIT, 0.0, 1.0)
        a2 = _clamp((a - self.VSPLIT) / (1.0 - self.VSPLIT), 0.0, 1.0)
        b1 = _clamp(b / (1.0 - self.VSPLIT), 0.0, 1.0)      # rows leave first
        b2 = _clamp((b - (1.0 - self.VSPLIT)) / self.VSPLIT, 0.0, 1.0)
        drop = ys[-1] + 8.0                          # start above the frame
        for i in range(self.NC + 1):                 # blinds drop in...
            e = (_stag(a1, i, self.NC + 1, self.W)
                 * (1.0 - _stag(b2, i, self.NC + 1, self.W)))
            if e <= 0.004:
                continue
            off = drop * (1.0 - e)
            canvas.line(xs[i], ys[0] - off, xs[i], ys[-1] - off)
        for j in range(self.NR + 1):                 # ...rows wipe across
            f1 = _stag(a2, j, self.NR + 1, self.W)
            f0 = _stag(b1, j, self.NR + 1, self.W)
            self._hspan(canvas, ys[j], xs[0], xs[-1], f0, f1)
        hl, env = self._hold(u)
        if env > 0.05:
            # dashes raining down the column interiors, fading at the ends
            for i in range(self.NC):
                x = (xs[i] + xs[i + 1]) / 2.0
                for k in (0.0, 0.5):
                    ph = (u * self.RAIN + k + i * 0.37) % 1.0
                    dl = 3.5 * env * math.sin(math.pi * ph)
                    if dl >= 1.0:
                        y = ys[0] + ph * (ys[-1] - ys[0])
                        canvas.line(x, y - dl / 2.0, x, y + dl / 2.0)

    def status(self):
        return "BLINDS"


# ===========================================================================
# 6 — LEDGER: a block header band, a block cursor sweeping the rows
# ===========================================================================
class TableLedgerScene(TableScene):
    name = "table · ledger"
    HDR = 0.30      # fraction of the intro the header band owns
    SWEEPS = 2      # cursor passes per hold

    def table(self, canvas, xs, ys, u, a, b):
        a1 = _clamp(a / self.HDR, 0.0, 1.0)
        a2 = _clamp((a - self.HDR) / (1.0 - self.HDR), 0.0, 1.0)
        b1 = _clamp(b / (1.0 - self.HDR), 0.0, 1.0)
        b2 = _clamp((b - (1.0 - self.HDR)) / self.HDR, 0.0, 1.0)
        # the header band: solid, wipes in left to right, out right to left
        e0, e1 = _expo(b2), _expo(a1)
        if e1 - e0 > 0.01:
            xa = xs[0] + (xs[-1] - xs[0]) * e0
            xb = xs[0] + (xs[-1] - xs[0]) * e1
            _bar(canvas, xa, ys[0], xb, ys[0], 3.0)
        for j in range(1, self.NR + 1):              # body rules pen in
            f1 = _stag(a2, j - 1, self.NR, self.W)
            f0 = _stag(b1, j - 1, self.NR, self.W)
            self._hspan(canvas, ys[j], xs[0], xs[-1], f0, f1)
        for i in range(self.NC + 1):                 # columns stitch after
            g1 = _stag(a2, i, self.NC + 1, self.W * 0.8)
            g0 = _stag(b1, i, self.NC + 1, self.W * 0.8)
            self._vspan(canvas, xs[i], ys[0], ys[-1], g0, g1)
        hl, env = self._hold(u)
        if env > 0.05:
            # the cursor: a block bar sweeping the body rows, fading at wraps
            ph = (hl * self.SWEEPS) % 1.0
            yc = ys[0] + ph * (ys[-1] - ys[0])
            th = 2.4 * env * math.sin(math.pi * ph)
            _bar(canvas, xs[0], yc, xs[-1], yc, th)

    def status(self):
        return "LEDGER"


# ===========================================================================
# The phases have to nest, and the rain has to lap whole
# ===========================================================================
def _selfcheck():
    c = TableScene
    assert 0.0 < c.T_IN < c.T_OUT < 1.0, "table_cycle: phases out of order"
    assert TableBlindsScene.RAIN == int(TableBlindsScene.RAIN), (
        "table_cycle: fractional rain laps tear the loop")
    assert TableLedgerScene.SWEEPS == int(TableLedgerScene.SWEEPS)


_selfcheck()


def make_scenes():
    return [
        TableRulesScene(),      # 1  rules then columns, stepping cursor
        TableSplitScene(),      # 2  recursive subdivision
        TableUnfoldScene(),     # 3  rows dealing downward
        TableCellsScene(),      # 4  cells fusing in a diagonal wave
        TableBlindsScene(),     # 5  falling columns, dash rain
        TableLedgerScene(),     # 6  block header, sweeping cursor
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
