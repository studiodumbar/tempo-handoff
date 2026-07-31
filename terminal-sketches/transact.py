#!/usr/bin/env python3
"""
transact — abstract, spatial sketches for the moments of a purchase / transaction.

Not literal (no coins, no card): each is a small piece of choreography about value
moving through space and locking in. They share a language — braille dots for the
quiet field, solid blocks for the committed state, and a strong ease-in-out-expo
so every move HOLDS, then SNAPS, then holds. All loop, and all read as sequential:
one thing after another, arriving.

    1  tx · relay     a value packet hops node -> node through receding space,
                      then a confirm ring rings out at the front
    2  tx · stack     block columns tally up bottom-first, left-to-right, then
                      commit in a flash and clear
    3  tx · mint      concentric rings assemble a token outside-in, its centre
                      embosses solid, then it disperses
    4  tx · lock      four brackets fly in from the corners and clamp the frame
                      shut — secured — then release
    5  tx · sweep     a scan front crosses a receding field, upgrading braille
                      dots to solid blocks behind it (verified), then resets
    6  tx · balance   two sides settle: a stream of marks arcs from the heavy
                      side to the light until a beam levels out

Run: `python transact.py` (60fps explorer; flags delegate to mpp).
"""

import math

from mpp import Scene, _clamp, EASE_BACK

TAU = 2.0 * math.pi


# ---- strong easings -------------------------------------------------------
def _expo(x):
    """easeInOutExpo — flat, then a hard snap, then flat."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    return 0.5 * 2.0 ** (20.0 * x - 10.0) if x < 0.5 \
        else 1.0 - 0.5 * 2.0 ** (-20.0 * x + 10.0)


def _eout(x):
    """easeOutExpo — a fast burst that decelerates hard."""
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 1.0 - 2.0 ** (-10.0 * x)


def _ein(x):
    """easeInExpo — creeps, then rushes to the finish."""
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 2.0 ** (10.0 * x - 10.0)


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _seg(u, a, b):
    """Local progress of u within the window [a, b], clamped to [0, 1]."""
    return _clamp((u - a) / (b - a), 0.0, 1.0) if b > a else 0.0


def _blockspan(canvas, x0, x1, cy, h, ch="█"):
    """Fill a horizontal run of whole cells from x0..x1 at row of cy, `h` braille
    units tall (rounded to whole cells), as literal block glyphs."""
    row0 = int((cy - h / 2.0) // 4)
    row1 = int((cy + h / 2.0) // 4)
    c0 = int(min(x0, x1) // 2)
    c1 = int(max(x0, x1) // 2)
    for r in range(max(0, row0), min(canvas.rows - 1, row1) + 1):
        for c in range(max(0, c0), min(canvas.cols - 1, c1) + 1):
            canvas.set_char(c, r, ch)


class TxScene(Scene):
    CYCLE = 4.0

    def _u(self):
        return (self.t % self.CYCLE) / self.CYCLE


# ===========================================================================
# 1 — RELAY  (a packet hops node -> node through receding space)
# ===========================================================================
class RelayScene(TxScene):
    name = "tx · relay"
    CYCLE = 4.6
    N = 5                 # nodes along the wire
    K = 2.6               # perspective compression (bigger = deeper)
    SIZE = 17.0           # near-node size (braille units)

    def _place(self, canvas, d):
        """Screen (x, y) and perspective factor for depth d in [0,1] (0 near)."""
        wu, hu = canvas.wu, canvas.hu
        f = 1.0 / (1.0 + d * self.K)
        y = hu * 0.20 + (hu * 0.9 - hu * 0.20) * f
        x = wu / 2.0 + (wu * 0.08) * (1.0 - f)          # a slight lean into depth
        return x, y, f

    def draw(self, canvas):
        u = self._u()
        n = self.N
        # the packet arrives far -> near, one strong-eased hop after another
        g = _seg(u, 0.06, 0.72) * (n - 1)
        j = min(int(g), n - 2)
        travelled = j + _expo(g - j)
        dep = (n - 1) - travelled                        # depth index N-1 -> 0

        for i in range(n):
            d = i / (n - 1)
            x, y, f = self._place(canvas, d)
            s = self.SIZE * f
            if abs(dep - i) < 0.5:                        # lit as the packet lands
                canvas.rect_fill(x, y, s * 0.72, s * 0.72)
            else:
                canvas.square_outline(x, y, s)

        # the trailing wire behind the packet + the packet itself
        for k in range(1, 6):
            td = _clamp((dep + k * 0.3) / (n - 1), 0.0, 1.0)
            tx, ty, _tf = self._place(canvas, td)
            canvas.set_dot(tx, ty)
        px, py, pf = self._place(canvas, _clamp(dep / (n - 1), 0.0, 1.0))
        ps = self.SIZE * pf * 0.68
        canvas.rect_fill(px, py, ps, ps)

        # confirm ring rings out at the front node once it arrives
        c = _seg(u, 0.74, 0.98)
        if 0.0 < c < 1.0:
            x0, y0, _f = self._place(canvas, 0.0)
            rr = _eout(c) * self.SIZE * 2.4
            fade = 1 - c
            nd = max(18, int(rr))
            step = 1 if fade > 0.4 else 2
            for k in range(0, nd, step):
                a = TAU * k / nd
                canvas.set_dot(x0 + rr * math.cos(a), y0 + rr * 0.62 * math.sin(a))

    def status(self):
        return "RELAY"


# ===========================================================================
# 2 — STACK  (block columns tally up, then commit)
# ===========================================================================
class StackScene(TxScene):
    name = "tx · stack"
    CYCLE = 4.2
    HEIGHTS = (3, 5, 6, 8, 7, 8, 6, 4, 2)   # target segments per column
    MAXSEG = 8

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        u = self._u()
        cols = len(self.HEIGHTS)
        total = float(sum(self.HEIGHTS))
        block_w = wu * 0.82 / cols
        colw = block_w * 0.62
        segh = (hu * 0.62) / self.MAXSEG
        x0 = (wu - block_w * cols) / 2.0 + block_w / 2.0
        base_y = hu * 0.84

        fill = _expo(_seg(u, 0.05, 0.66)) * total        # segments revealed so far
        commit = _seg(u, 0.68, 0.80)                      # the flash
        clear = _expo(_seg(u, 0.86, 1.0)) * total         # dissolve, same order

        idx = 0
        for c in range(cols):
            cx = x0 + c * block_w
            for k in range(self.HEIGHTS[c]):
                shown = fill - idx
                gone = clear - idx
                idx += 1
                if shown <= 0.0 or gone > 1.0:
                    continue
                pop = EASE_BACK(_clamp(shown, 0.0, 1.0))  # newest segment overshoots
                if gone > 0.0:
                    pop *= (1.0 - _smooth(gone))          # and later melts away
                y = base_y - (k + 0.5) * segh
                w = colw * pop
                h = segh * 0.82 * pop
                if commit > 0.0 and gone <= 0.0:          # committed -> crisp blocks
                    _blockspan(canvas, cx - w / 2, cx + w / 2, y, h)
                else:
                    canvas.rect_fill(cx, y, w, h)
        # the ground line the columns sit on
        canvas.line(x0 - block_w * 0.5, base_y + 1, x0 + block_w * (cols - 0.5),
                    base_y + 1)

    def status(self):
        return "STACK"


# ===========================================================================
# 3 — MINT  (concentric rings assemble a token, centre embosses)
# ===========================================================================
class MintScene(TxScene):
    name = "tx · mint"
    CYCLE = 3.8
    RINGS = 5
    SQUASH = 0.52         # vertical squash -> a token seen at an angle

    def _ellipse(self, canvas, cx, cy, r, spin, scale):
        n = max(14, int(r * 0.7))
        for k in range(n):
            a = TAU * k / n + spin
            canvas.set_dot(cx + r * scale * math.cos(a),
                           cy + r * self.SQUASH * scale * math.sin(a))

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = self._u()
        spin = self.t * 0.5
        rmax = min(wu, hu) * 0.42

        # rings snap in from the OUTSIDE in, one after another
        for i in range(self.RINGS):
            outer = i / self.RINGS                        # 0 outer .. -> inner
            appear = _seg(u, 0.05 + outer * 0.36, 0.20 + outer * 0.36)
            gone = _seg(u, 0.80 + outer * 0.06, 0.95 + outer * 0.06)
            a = _expo(appear) * (1.0 - _expo(gone))
            if a <= 0.02:
                continue
            r = rmax * (1.0 - i / self.RINGS * 0.82)
            self._ellipse(canvas, cx, cy, r, spin * (0.4 + i * 0.2), a)

        # the centre embosses solid once the rings are home, then relaxes
        emb = _expo(_seg(u, 0.5, 0.66)) * (1.0 - _smooth(_seg(u, 0.82, 0.95)))
        if emb > 0.02:
            rr = rmax * 0.26 * emb
            canvas.rect_fill(cx, cy, rr * 2.0, rr * 2.0 * self.SQUASH)

    def status(self):
        return "MINT"


# ===========================================================================
# 4 — LOCK  (corner brackets fly in and clamp shut)
# ===========================================================================
class LockScene(TxScene):
    name = "tx · lock"
    CYCLE = 3.6
    ARM = 12.0            # bracket arm length (braille units)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = self._u()
        half = min(wu, hu) * 0.30                          # locked frame half-size
        arm = self.ARM

        corners = ((-1, -1), (1, -1), (-1, 1), (1, 1))     # TL, TR, BL, BR order
        for i, (sx, sy) in enumerate(corners):
            # each bracket slides in from far out, staggered -> sequential clamp
            a = _expo(_seg(u, 0.05 + i * 0.10, 0.45 + i * 0.10))
            r = _expo(_seg(u, 0.80, 0.98))                 # release together
            prog = a * (1.0 - r)
            off = (1.0 - prog) * min(wu, hu) * 0.55        # how far still out
            gx = cx + sx * (half + off)
            gy = cy + sy * (half + off)
            # an L-bracket hugging this corner
            canvas.line(gx, gy, gx - sx * arm, gy)
            canvas.line(gx, gy, gx, gy - sy * arm)

        # when clamped, the frame flashes solid and a core mark commits
        locked = _smooth(_seg(u, 0.46, 0.56)) * (1.0 - _smooth(_seg(u, 0.78, 0.9)))
        if locked > 0.1:
            for sx, sy in corners:
                gx = cx + sx * half
                gy = cy + sy * half
                _blockspan(canvas, gx, gx - sx * arm, gy, 3)   # solid arms
            canvas.rect_fill(cx, cy, 6 * locked, 6 * locked)

    def status(self):
        return "LOCK"


# ===========================================================================
# 5 — SWEEP  (a scan front upgrades a field from dots to blocks)
# ===========================================================================
class SweepScene(TxScene):
    name = "tx · sweep"
    CYCLE = 4.0
    NX = 26               # field columns
    NZ = 10               # field rows (depth)
    K = 1.7               # depth compression

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx = wu / 2.0
        u = self._u()
        # scan front in world-x [-1,1], strong ease across, then resets
        front = -1.0 + 2.0 * _expo(_seg(u, 0.08, 0.8))
        wipe = _seg(u, 0.86, 1.0)                          # clear back to dots

        for iz in range(self.NZ):
            gz = iz / (self.NZ - 1)
            f = 1.0 / (1.0 + gz * self.K)                  # perspective
            y = hu * 0.30 + (hu * 0.9 - hu * 0.30) * f
            halfw = wu * 0.46 * f
            for ix in range(self.NX):
                gx = -1.0 + 2.0 * ix / (self.NX - 1)
                x = cx + gx * halfw
                verified = gx <= front and not (wipe > 0 and gx <= -1 + 2 * wipe)
                if verified:
                    # committed cell — a solid block, brighter up close
                    s = 2.2 * f + 1.2
                    canvas.rect_fill(x, y, s, s)
                else:
                    canvas.set_dot(x, y)                    # unscanned field
        # the bright scan bar itself
        if 0.0 < _seg(u, 0.08, 0.8) < 1.0:
            for iz in range(self.NZ):
                gz = iz / (self.NZ - 1)
                f = 1.0 / (1.0 + gz * self.K)
                y = hu * 0.30 + (hu * 0.9 - hu * 0.30) * f
                x = cx + front * wu * 0.46 * f
                canvas.set_dot(x, y - 1)
                canvas.set_dot(x, y + 1)

    def status(self):
        return "SWEEP"


# ===========================================================================
# 6 — BALANCE  (two sides settle level as marks arc across)
# ===========================================================================
class BalanceScene(TxScene):
    name = "tx · balance"
    CYCLE = 4.4
    NFLOW = 14            # marks in flight across the transfer
    TILT = 0.42          # max beam tilt (radians)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = self._u()
        span = min(wu, hu) * 0.34                          # beam half-length
        # imbalance eases from full (heavy left) to level
        imb = 1.0 - _expo(_seg(u, 0.12, 0.82))
        ang = -self.TILT * imb                             # left dips when heavy
        ca, sa = math.cos(ang), math.sin(ang)

        # the beam + its pivot
        lx, ly = cx - span * ca, cy - span * sa
        rx, ry = cx + span * ca, cy + span * sa
        canvas.line(lx, ly, rx, ry)
        canvas.line(cx, cy, cx, cy + hu * 0.14)            # the stand
        canvas.rect_fill(cx, cy, 3, 3)

        # pans: mass moves left -> right as it settles
        lmass = 0.5 + 0.5 * imb
        rmass = 1.0 - lmass
        self._pan(canvas, lx, ly + 6, lmass)
        self._pan(canvas, rx, ry + 6, rmass)

        # a sequential stream of marks arcing from the heavy pan to the light one
        if 0.0 < _seg(u, 0.12, 0.82) < 1.0:
            for k in range(self.NFLOW):
                ph = (u * 3.4 - k / self.NFLOW) % 1.0
                e = _smooth(ph)
                bx = lx + (rx - lx) * e
                by = (ly + 6) + ((ry + 6) - (ly + 6)) * e - math.sin(ph * math.pi) * hu * 0.16
                canvas.set_dot(bx, by)

    def _pan(self, canvas, x, y, mass):
        w = 4 + mass * 22
        canvas.line(x - w / 2, y, x + w / 2, y)
        # a little stack of solid mass sitting in the pan
        h = 2 + mass * 14
        canvas.rect_fill(x, y + h / 2 + 1, w * 0.7, h)

    def status(self):
        return "BALANCE"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        RelayScene(),      # 1  relay
        StackScene(),      # 2  stack
        MintScene(),       # 3  mint
        LockScene(),       # 4  lock
        SweepScene(),      # 5  sweep
        BalanceScene(),    # 6  balance
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
