#!/usr/bin/env python3
"""
sq_rings — the nested-square stack as a living tunnel.

From the reference frames: concentric square paths, staggered outward LINEARLY
(every ring the same step bigger than the last — never a geometric zoom), each
ring's line animating along its own square perimeter, the path ends fanning out
in a stagger. Centred composition, always.

The depth cue is not perspective, it is the stroke ramp. A ring is born as a
faint dotted square at the centre (far), grows through a hairline, and reaches
the rim as a bold double-stroked tube (near) before dissolving. Read outside ->
inside and you are looking down a square throat.

The nest is framed, not full-bleed: it holds well inside the canvas with
negative space on every side, so the rim dissolves in clear air rather than
running off the edge. See RingScene.REACH — everything else is sized off it.

Because the radii are linear rather than exponential there is no self-similar
lens zoom — instead `flow` IS the camera dolly. Advancing it by exactly +1 slot
means every ring steps one place outward, the outermost dissolves away, a new
one is born at the centre, and the picture is identical again. So a beat can be
one full ease-in-out-expo whoosh that loops seamlessly, forever.

    1  sq · bloom    the beat: hold, one expo whoosh outward, hold. The
                     whole stack steps a slot; the picture repeats exactly
    2  sq · trace    every newborn ring whips its line around its own square
                     as it emerges — a perpetual sequential draw-on
    3  sq · draw     the reference frame: staggered gaps in the top-right,
                     every ring perpetually redrawing, heads cascading out
    4  sq · fan      the cut orbits the stack — the fan of line-ends sweeps
                     around the squares while the treadmill flows
    5  sq · rails    corners wired ring-to-ring: the square throat made
                     explicit, stepping one slot per beat
    6  sq · dive     a crawl, then a three-slot whoosh with corner streaks,
                     then it catches its breath
    7  sq · chain    a zap runs centre -> rim, firing each ring it touches
    8  sq · march    a short arc marching around each square, staggered ring
                     to ring so the segments spiral — a quarter-turn a beat
    9  sq · lean     the vanishing point holds dead centre while the throat
                     swings around it: a camera orbiting inside the tunnel
    10 sq · breach   rings approach as ghosts, SNAP solid crossing the fire
                     radius, and burn down to dots once consumed
    11 sq · rewind   three slots out, hold, then snap all the way back —
                     the dolly breathing in and out
    12 sq · echo     a counter-flowing ghost stack collapses inward through
                     the main one
    13 sq · spiral   not rings at all: ONE continuous square spiral, drawn
                     on from the centre, seamless every turn
    14 sq · iris     the gaps ripple open and shut in sequence, a square
                     aperture breathing from the inside out
    15 sq · ticks    sleepers marching along every path, outward, forever
    16 sq · lock     sweep a bracket ring to ring, lock it, ZOOM two slots
                     into it, repeat — recursive lock-and-dive

House ease-in-out-expo throughout. Run standalone: `python sq_rings.py`.
"""

import math
import sys

from mpp import Scene, _clamp

TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------
def _expo(x):
    """The house ease: ease-in-out-expo. Hold, WHOOSH, hold."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


def _eout(x):
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 1.0 - 2.0 ** (-10.0 * x)


def _ein(x):
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 2.0 ** (10.0 * x - 10.0)


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


# ---------------------------------------------------------------------------
# The square path. Perimeter fraction s: 0 at the top-right corner, running
# left along the top, down the left side, right along the bottom, and up the
# right side back to 0 — the direction the reference paths travel.
#
# Only the corners are ever needed: a square's sides are straight, so a whole
# ring is four calls to line(). That is what keeps sixteen rings at 60fps.
# ---------------------------------------------------------------------------
_CORN = ((1.0, -1.0), (-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0))
_SIDE_N = ((0.0, -1.0), (-1.0, 0.0), (0.0, 1.0), (1.0, 0.0))   # outward normals


def _sq_pt(s, r):
    q = (s - math.floor(s)) * 4.0
    i = int(q)
    if i > 3:
        i = 3
    f = q - i
    ax, ay = _CORN[i]
    bx, by = _CORN[(i + 1) & 3]
    return ((ax + (bx - ax) * f) * r, (ay + (by - ay) * f) * r)


def _corners(s0, s1):
    """The perimeter fractions from s0 to s1 with every corner hit exactly."""
    ss = [s0]
    k = math.floor(s0 * 4.0) + 1
    while k * 0.25 < s1:
        ss.append(k * 0.25)
        k += 1
    ss.append(s1)
    return ss


def _cline(canvas, x0, y0, x1, y1):
    """canvas.line, Liang-Barsky clipped to the canvas first. Rings grow well
    past the frame before they fade, so without this the outer ones would burn
    thousands of set_dot calls on pixels that do not exist."""
    xmax, ymax = canvas.wu - 1.0, canvas.hu - 1.0
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0), (dx, xmax - x0), (-dy, y0), (dy, ymax - y0)):
        if p == 0.0:
            if q < 0.0:
                return
        else:
            r = q / p
            if p < 0.0:
                if r > t1:
                    return
                if r > t0:
                    t0 = r
            else:
                if r < t0:
                    return
                if r < t1:
                    t1 = r
    canvas.line(x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1)


def _poly(canvas, pts, w):
    """Stroke a polyline at weight w. The weight ramp IS the depth cue:
    sparse dots -> dashes -> hairline -> double-stroked tube."""
    if w <= 0.04 or len(pts) < 2:
        return
    if w < 0.62:                                   # far: the dotted ghost
        step = 3.4 if w < 0.32 else 1.9
        for a, b in zip(pts, pts[1:]):
            dx, dy = b[0] - a[0], b[1] - a[1]
            n = int(math.hypot(dx, dy) / step)
            for k in range(n + 1):
                f = k / n if n else 0.0
                canvas.set_dot(a[0] + dx * f, a[1] + dy * f)
        return
    if w < 1.30:                                   # mid: a clean hairline
        for a, b in zip(pts, pts[1:]):
            _cline(canvas, a[0], a[1], b[0], b[1])
        return
    off = 0.55 + 0.75 * min(w - 1.30, 1.10)        # near: the tube
    pp = pm = None
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        if ln < 1e-6:
            continue
        nx, ny = -dy / ln * off, dx / ln * off
        ap, bp = (a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny)
        am, bm = (a[0] - nx, a[1] - ny), (b[0] - nx, b[1] - ny)
        if pp is not None:                         # mitre the corner shut
            _cline(canvas, pp[0], pp[1], ap[0], ap[1])
            _cline(canvas, pm[0], pm[1], am[0], am[1])
        _cline(canvas, ap[0], ap[1], bp[0], bp[1])
        _cline(canvas, am[0], am[1], bm[0], bm[1])
        pp, pm = bp, bm


def _ring(canvas, cx, cy, r, w, s0=0.0, s1=1.0, rot=0.0):
    """One square ring (or an arc of one) centred at cx, cy."""
    if w <= 0.04 or r <= 0.6 or s1 <= s0:
        return
    if s1 - s0 > 1.0:
        s1 = s0 + 1.0
    pts = [_sq_pt(s, r) for s in _corners(s0, s1)]
    if rot:
        ca, sa = math.cos(rot), math.sin(rot)
        pts = [(x * ca - y * sa, x * sa + y * ca) for x, y in pts]
    _poly(canvas, [(cx + x, cy + y) for x, y in pts], w)


def _spiral(canvas, cx, cy, s0, s1, rfn, wfn):
    """A STEPPED square spiral. Each side is held at one radius, so it stays
    dead axis-aligned like the reference's sides, and the radius jogs at the
    corner instead — the way you draw a square spiral on graph paper. Sampling
    the radius continuously would slope every side and lose the crisp nest."""
    ss = _corners(s0, s1)
    prev = None
    for a, b in zip(ss, ss[1:]):
        m = (a + b) * 0.5
        r, w = rfn(m), wfn(m)
        ax, ay = _sq_pt(a, r)
        bx, by = _sq_pt(b, r)
        pa, pb = (cx + ax, cy + ay), (cx + bx, cy + by)
        if prev is not None:
            _poly(canvas, [prev, pa], w)       # the jog out, at the corner
        _poly(canvas, [pa, pb], w)
        prev = pb


def _bead(canvas, cx, cy, r, s, k=1.0, rot=0.0):
    """The draw-head marker, riding the path."""
    x, y = _sq_pt(s, r)
    if rot:
        ca, sa = math.cos(rot), math.sin(rot)
        x, y = x * ca - y * sa, x * sa + y * ca
    canvas.square_fill(cx + x, cy + y, max(1.8, min(5.0, r * 0.045)) * k)


def _tick(canvas, cx, cy, r, s, half):
    """A short mark laid across the path — the reference's little dashes."""
    x, y = _sq_pt(s, r)
    q = (s - math.floor(s)) * 4.0
    nx, ny = _SIDE_N[int(q) & 3]
    _cline(canvas, cx + x - nx * half, cy + y - ny * half,
           cx + x + nx * half, cy + y + ny * half)


def _bracket(canvas, cx, cy, r, k):
    """Corner brackets framing a ring."""
    e = r * 0.42
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            x, y = cx + sx * r * k, cy + sy * r * k
            _cline(canvas, x, y, x - sx * e * k, y)
            _cline(canvas, x, y, x, y - sy * e * k)


# ---------------------------------------------------------------------------
# The treadmill: NR rings on linearly spaced radii, flowing outward forever.
# A ring's slot u runs 0 (newborn, dead centre, far) -> NR (the rim, near).
# Radius is linear in u, so +1 flow reproduces the picture exactly.
# ---------------------------------------------------------------------------
class RingScene(Scene):
    # REACH under 1.0 holds the whole nest inside the frame with negative space
    # on every side, so the rim now DISSOLVES in clear air instead of whooshing
    # off-screen — hence the wider GONE window to make that dissolve graceful.
    # Zooming out also shrinks the gap between rings, so NR and W_OUT come down
    # with it: on a small terminal a fat tube would otherwise be wider than the
    # gap it sits in and the nest would silt up into a blob.
    NR = 9              # rings alive at once
    BIAS = 0.22         # a newborn's radius, in slots
    REACH = 0.76        # the rim, in half-min-canvas units
    BORN = 1.15         # fade-in window at the centre (slots)
    GONE = 2.00         # fade-out window at the rim (slots)
    W_IN = 0.18         # stroke weight of the innermost (far) ring
    W_OUT = 1.90        # ...and of the outermost (near) ring

    def _geom(self, canvas):
        """(centre x, centre y, radial step). Always centred."""
        return (canvas.wu * 0.5, canvas.hu * 0.5,
                min(canvas.wu, canvas.hu) * 0.5 * self.REACH / self.NR)

    def _slots(self, flow):
        """[(i, u)] inner -> outer. i is the ring's stable identity."""
        out = [(i, (i + flow) % self.NR) for i in range(self.NR)]
        out.sort(key=lambda s: s[1])
        return out

    def _fade(self, u):
        """Born from nothing at the centre, gone by the time it passes you."""
        return (_clamp(u / self.BORN, 0.0, 1.0) *
                _clamp((self.NR - u) / self.GONE, 0.0, 1.0))

    def _w(self, u, k=1.0):
        return ((self.W_IN + (self.W_OUT - self.W_IN) * (u / self.NR))
                * self._fade(u) * k)

    def _r(self, u, dR):
        return (u + self.BIAS) * dR


# ===========================================================================
# The beat
# ===========================================================================
class SqBloomScene(RingScene):
    name = "sq · bloom"
    BEAT = 1.25

    def draw(self, canvas):
        t = self.t
        k = math.floor(t / self.BEAT)
        flow = k + _expo(t / self.BEAT - k)        # one slot per beat, expo
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(flow):
            _ring(canvas, cx, cy, self._r(u, dR), self._w(u))

    def status(self):
        return "STEP %02d" % (int(self.t / self.BEAT) % 100)


class SqTraceScene(RingScene):
    name = "sq · trace"

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(t * 0.42):
            r = self._r(u, dR)
            pr = _expo(_clamp((u - 0.20) / 1.45, 0.0, 1.0))   # draw-on at birth
            _ring(canvas, cx, cy, r, self._w(u), 0.0, pr)
            if 0.02 < pr < 0.995:                             # the pen
                _bead(canvas, cx, cy, r, pr, 0.75)

    def status(self):
        return "TRACE"


class SqDrawScene(RingScene):
    """The reference frame: every path broken in the top-right, the gaps
    fanning outward, every ring perpetually redrawing itself."""
    name = "sq · draw"

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(t * 0.30):
            r = self._r(u, dR)
            fade = self._fade(u)
            h = 0.014 + 0.056 * (u / self.NR)      # the cut, fanning outward
            a, b = h, 1.0 - h
            pr = (t * 0.50 - u * 0.075) % 1.32     # redraw, then rest
            if pr < 1.0:
                s1 = a + (b - a) * _expo(pr)
                _ring(canvas, cx, cy, r, self._w(u), a, s1)   # laid down
                _ring(canvas, cx, cy, r, 0.30 * fade, s1, b)  # still to come
                _bead(canvas, cx, cy, r, s1, 0.7)
            else:
                _ring(canvas, cx, cy, r, self._w(u), a, b)

    def status(self):
        return "REDRAW"


class SqFanScene(RingScene):
    name = "sq · fan"

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        gc = t * 0.13                              # the cut, orbiting
        for _, u in self._slots(t * 0.34):
            r = self._r(u, dR)
            h = 0.010 + 0.062 * (u / self.NR)
            _ring(canvas, cx, cy, r, self._w(u), gc + h, gc + 1.0 - h)
            if self._w(u) > 1.0:                   # cap the fanned-out ends
                _tick(canvas, cx, cy, r, gc + h, 2.2)
                _tick(canvas, cx, cy, r, gc + 1.0 - h, 2.2)

    def status(self):
        return "FAN"


class SqRailsScene(RingScene):
    name = "sq · rails"
    BEAT = 1.40

    def draw(self, canvas):
        t = self.t
        k = math.floor(t / self.BEAT)
        flow = k + _expo(t / self.BEAT - k)
        cx, cy, dR = self._geom(canvas)
        prev = None
        for _, u in self._slots(flow):
            r, fade = self._r(u, dR), self._fade(u)
            if prev is not None:                   # wire the corners together
                pr, pf = prev
                w = 0.80 * min(fade, pf)
                if w > 0.30:
                    for c in range(4):
                        x0, y0 = _sq_pt(c * 0.25, pr)
                        x1, y1 = _sq_pt(c * 0.25, r)
                        _cline(canvas, cx + x0, cy + y0, cx + x1, cy + y1)
            _ring(canvas, cx, cy, r, self._w(u))
            prev = (r, fade)

    def status(self):
        return "THROAT"


# ===========================================================================
# The dolly riffs
# ===========================================================================
class SqDiveScene(RingScene):
    name = "sq · dive"
    CYCLE = 3.20

    def _flow(self, t):
        c = math.floor(t / self.CYCLE)
        return 3.0 * (c + _ein((t - c * self.CYCLE) / self.CYCLE))

    def draw(self, canvas):
        t = self.t
        flow = self._flow(t)
        vel = (flow - self._flow(t - 0.05)) / 0.05
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(flow):
            r, w = self._r(u, dR), self._w(u)
            _ring(canvas, cx, cy, r, w)
            if vel > 2.5 and w > 0.5:              # the whoosh streaks
                kk = min(0.30, vel * 0.022)
                for c in range(4):
                    x0, y0 = _sq_pt(c * 0.25, r)
                    x1, y1 = _sq_pt(c * 0.25, r * (1.0 - kk))
                    _cline(canvas, cx + x0, cy + y0, cx + x1, cy + y1)

    def status(self):
        return "WHOOSH" if (self.t % self.CYCLE) / self.CYCLE > 0.72 else "CRAWL"


class SqChainScene(RingScene):
    name = "sq · chain"
    BEAT = 1.15

    def draw(self, canvas):
        t = self.t
        fr = t / self.BEAT - math.floor(t / self.BEAT)
        zap = (self.NR + 1.0) * _expo(fr) - 0.5    # the pulse, centre -> rim
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(t * 0.16):
            hit = _clamp(1.0 - abs(u - zap) / 0.90, 0.0, 1.0)
            r = self._r(u, dR)
            _ring(canvas, cx, cy, r, self._w(u, 0.55 + 0.90 * hit))
            if hit > 0.55:
                for c in range(4):
                    _bead(canvas, cx, cy, r, c * 0.25, 0.6 * hit)

    def status(self):
        return "ZAP %02d" % (int(self.t / self.BEAT) % 100)


class SqMarchScene(RingScene):
    """A short arc marching around each square, staggered ring to ring so the
    segments spiral. Every side stays axis-aligned — rotating the rings instead
    turns their sides into long diagonal chords that hash the whole nest."""
    name = "sq · march"
    BEAT = 1.30
    ARC = 0.32

    def draw(self, canvas):
        t = self.t
        k = math.floor(t / self.BEAT)
        s0 = 0.25 * (k + _expo(t / self.BEAT - k))      # a quarter-turn a beat
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(t * 0.20):
            r = self._r(u, dR)
            a = s0 + u * (0.68 / self.NR)               # the stagger
            _ring(canvas, cx, cy, r, 0.38 * self._fade(u))       # the path
            _ring(canvas, cx, cy, r, self._w(u), a, a + self.ARC)
            _bead(canvas, cx, cy, r, a + self.ARC, 0.6)

    def status(self):
        return "MARCH %02d" % (int(self.t / self.BEAT) % 100)


class SqLeanScene(RingScene):
    """The vanishing point holds dead centre; the throat swings around it."""
    name = "sq · lean"

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        # The swing has to live inside the negative space the zoom-out bought,
        # or the outer rings lean straight back out of the frame.
        th = t * 0.42
        ax, ay = math.cos(th) * dR * 0.10, math.sin(th * 0.83) * dR * 0.10
        for _, u in self._slots(t * 0.38):
            _ring(canvas, cx + ax * u, cy + ay * u,
                  self._r(u, dR), self._w(u))

    def status(self):
        return "ORBIT"


class SqBreachScene(RingScene):
    name = "sq · breach"
    FIRE_F = 0.58       # the fire radius, as a fraction of the stack

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        self.FIRE = self.NR * self.FIRE_F      # must scale, or it fires in the
        for _, u in self._slots(t * 0.46):     # fade zone and never lands
            r, fade = self._r(u, dR), self._fade(u)
            pop = _clamp(1.0 - abs(u - self.FIRE) / 0.55, 0.0, 1.0)
            if pop > 0.0:                          # SNAP: crossing the plane
                _ring(canvas, cx, cy, r * (1.0 + 0.035 * pop), 2.35 * fade)
                for c in range(4):
                    _bead(canvas, cx, cy, r, c * 0.25, 0.65 * pop)
            elif u < self.FIRE:                    # approaching: a ghost
                _ring(canvas, cx, cy, r, 0.30 * fade)
            else:                                  # consumed: burning down
                k = _clamp((self.NR - u) / (self.NR - self.FIRE), 0.0, 1.0)
                _ring(canvas, cx, cy, r, (0.20 + 1.60 * k) * fade)

    def status(self):
        return "BREACH"


class SqRewindScene(RingScene):
    name = "sq · rewind"
    CYCLE = 4.60

    def draw(self, canvas):
        t = self.t
        u0 = (t % self.CYCLE) / self.CYCLE
        flow = (3.0 * _expo(_clamp(u0 / 0.50, 0.0, 1.0))
                - 3.0 * _expo(_clamp((u0 - 0.66) / 0.30, 0.0, 1.0)))
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(flow):
            _ring(canvas, cx, cy, self._r(u, dR), self._w(u))

    def status(self):
        u0 = (self.t % self.CYCLE) / self.CYCLE
        return "OUT" if u0 < 0.50 else "HOLD" if u0 < 0.66 else "REWIND"


class SqEchoScene(RingScene):
    name = "sq · echo"

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(-t * 0.30):        # the ghosts, collapsing in
            _ring(canvas, cx, cy, self._r(u, dR), 0.34 * self._fade(u))
        for _, u in self._slots(t * 0.44):
            _ring(canvas, cx, cy, self._r(u, dR), self._w(u))

    def status(self):
        return "ECHO"


# ===========================================================================
# The path riffs
# ===========================================================================
class SqSpiralScene(RingScene):
    """One continuous square spiral. Radius grows one step per turn, so it is
    the same linear stagger — and a +1 turn shift reproduces it exactly."""
    name = "sq · spiral"
    BEAT = 1.50

    def draw(self, canvas):
        t = self.t
        k = math.floor(t / self.BEAT)
        fl = (k + _expo(t / self.BEAT - k)) % 1.0  # only the turn phase matters
        cx, cy, dR = self._geom(canvas)

        def rfn(s):
            return (s + fl + self.BIAS) * dR

        def wfn(s):
            return self._w(_clamp(s + fl, 0.0, float(self.NR)))

        _spiral(canvas, cx, cy, 0.02 - fl, self.NR - fl, rfn, wfn)

    def status(self):
        return "SPIRAL"


class SqIrisScene(RingScene):
    name = "sq · iris"
    BEAT = 2.10

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(t * 0.26):
            ph = (t / self.BEAT - u * 0.10) % 1.0
            tri = 1.0 - abs(2.0 * ph - 1.0)        # shut -> open -> shut
            h = 0.43 * (1.0 - _expo(tri))          # the aperture, breathing
            _ring(canvas, cx, cy, self._r(u, dR), self._w(u), h, 1.0 - h)

    def status(self):
        return "IRIS"


class SqTicksScene(RingScene):
    name = "sq · ticks"
    NTICK = 10

    def draw(self, canvas):
        t = self.t
        cx, cy, dR = self._geom(canvas)
        for _, u in self._slots(t * 0.32):
            r, w = self._r(u, dR), self._w(u)
            _ring(canvas, cx, cy, r, w)
            if w > 0.62:                           # sleepers, marching outward
                half = min(3.2, 0.9 + r * 0.020)
                base = (t * 0.14) % (1.0 / self.NTICK)
                for j in range(self.NTICK):
                    _tick(canvas, cx, cy, r, base + j / self.NTICK, half)

    def status(self):
        return "TRACK"


class SqLockScene(RingScene):
    name = "sq · lock"
    CYCLE = 3.00

    def draw(self, canvas):
        t = self.t
        c = math.floor(t / self.CYCLE)
        u0 = (t - c * self.CYCLE) / self.CYCLE
        flow = 2.0 * (c + _expo(_clamp((u0 - 0.58) / 0.38, 0.0, 1.0))) + t * 0.05
        cx, cy, dR = self._geom(canvas)
        tgt = self.NR * (0.28 + 0.52 * _eout(_clamp(u0 / 0.36, 0.0, 1.0)))
        lockq = _clamp((u0 - 0.36) / 0.20, 0.0, 1.0)
        slots = self._slots(flow)
        best = min(slots, key=lambda s: abs(s[1] - tgt))
        for _, u in slots:
            hot = 0.60 * lockq if u == best[1] else 0.0
            _ring(canvas, cx, cy, self._r(u, dR), self._w(u, 0.55 + hot))
        if u0 < 0.62:                              # the roving bracket
            _bracket(canvas, cx, cy, self._r(best[1], dR),
                     1.16 - 0.12 * lockq)

    def status(self):
        u0 = (self.t % self.CYCLE) / self.CYCLE
        return "SWEEP" if u0 < 0.36 else "LOCK" if u0 < 0.58 else "ZOOM"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        SqBloomScene(),        # 1  the beat: one expo step per whoosh
        SqTraceScene(),        # 2  every newborn draws its own line on
        SqDrawScene(),         # 3  the reference: staggered cuts, redrawing
        SqFanScene(),          # 4  the cut orbiting the stack
        SqRailsScene(),        # 5  the square throat, wired
        SqDiveScene(),         # 6  crawl -> whoosh, with streaks
        SqChainScene(),        # 7  the zap, centre -> rim
        SqMarchScene(),        # 8  arcs marching the paths
        SqLeanScene(),         # 9  orbiting inside the tunnel
        SqBreachScene(),       # 10 ghost -> SNAP -> burn-down
        SqRewindScene(),       # 11 the breathing dolly
        SqEchoScene(),         # 12 the counter-flowing ghosts
        SqSpiralScene(),       # 13 one continuous square spiral
        SqIrisScene(),         # 14 the breathing aperture
        SqTicksScene(),        # 15 sleepers marching outward
        SqLockScene(),         # 16 sweep, lock, zoom, repeat
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
