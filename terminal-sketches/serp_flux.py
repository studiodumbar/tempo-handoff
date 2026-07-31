#!/usr/bin/env python3
"""
serp_flux — the serpentine as a LIVING stack: layers of zigzag paths on an
endless treadmill, streaming through a central focus point.

Second attempt at the coil renders, this time dynamic-first. The shape is
never a welded static structure: it is a set of IDENTICAL layer-paths — the
signature zigzag of one serpentine level (V, a broken rising run, the peak,
the falling leg) — stacked at exponentially spaced depths and streaming
toward the camera forever. Exponential spacing means every step nearer is
the same *ratio* bigger, so the motion is a true self-similar recursive
zoom into the vanishing point: new levels are born as dots at the focus,
grow through braille lines into bold double-stroked tube, and whoosh past
the eye. The motion/feel references agent_states_3d scene 3 (the compute
plane firing each lattice layer in turn) and scene 5 (the POV corridor with
streaming ribs and rails).

    1  flux · dive      the flagship: one expo-in-out BEAT per level — the
                        whole stack steps a level deeper, the arriving layer
                        draws itself on at the focus, the layer crossing the
                        fire plane flares. Recursive zoom, forever.
    2  flux · ladder    each level is processed in sequence: a pulse runs
                        the full zigzag of the level crossing the fire band
                        (V -> gap -> rise -> peak -> fall), finishes with a
                        spark, and the treadmill feeds it the next level
    3  flux · corridor  POV from inside the break in the runs: ribs whoosh
                        past on both sides, longitudinal rails stream by,
                        and a scan bracket locks onto each passing peak
    4  flux · warp      the section jump: a calm crawl, then the stack
                        whips four levels deep in one expo whoosh — streak
                        lines converge on the focus — and settles with a ring
    5  flux · focus     idle hero: a slow constant zoom, layers breathing,
                        a shimmer cascading level to level down the stack

All layers animate sequentially — per-beat stepping, per-level pulses,
per-level lock-ons — never as one frozen object. House ease-in-out-expo,
seamless treadmill loops. Run standalone: `python serp_flux.py`.
"""

import math
import sys

from mpp import Scene, _clamp

TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------
# Easing
# ---------------------------------------------------------------------------
def _expo(x):
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


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


# ---------------------------------------------------------------------------
# One layer of the serpentine, as a path. Local frame: x right, y up, z is a
# small tilt so a layer is not a flat card. The dash breaks are real breaks —
# separate pieces — exactly like the segmented runs in the renders.
# ---------------------------------------------------------------------------
RAW_PIECES = [
    [(-2.65, 0.80, 0.30), (-1.55, -0.50, -0.10)],    # the V, falling leg
    [(-1.55, -0.50, -0.10), (-0.75, 0.35, 0.12)],    # the V, short rising leg
    [(-0.35, 0.62, 0.16), (0.35, 0.93, 0.27)],       # rise, first dash
    [(0.62, 1.05, 0.31), (1.30, 1.35, 0.42)],        # rise, second dash
    [(1.30, 1.35, 0.42), (2.60, -0.55, -0.05)],      # the fall past the peak
]
RAW_VERTS = [(-2.65, 0.80, 0.30), (-1.55, -0.50, -0.10), (-0.75, 0.35, 0.12),
             (0.35, 0.93, 0.27), (1.30, 1.35, 0.42), (2.60, -0.55, -0.05)]


def _build_slice():
    pts, piece_of, ranges = [], [], []
    step = 0.085
    for pi, piece in enumerate(RAW_PIECES):
        i0 = len(pts)
        for a, b in zip(piece, piece[1:]):
            seg = math.dist(a[:2], b[:2])
            n = max(2, int(seg / step))
            for k in range(n):
                f = k / n
                pts.append((a[0] + (b[0] - a[0]) * f,
                            a[1] + (b[1] - a[1]) * f,
                            a[2] + (b[2] - a[2]) * f))
                piece_of.append(pi)
        pts.append(piece[-1])
        piece_of.append(pi)
        ranges.append((i0, len(pts)))
    return pts, piece_of, ranges


SLICE, PIECE_OF, PIECES = _build_slice()
SN = len(SLICE)
V_APEX_I = PIECES[0][1] - 1                     # the V's low corner
PEAK_I = PIECES[4][0]                            # the top peak
TAIL_I = SN - 1                                  # the falling leg's tip
RAILS = (V_APEX_I, PEAK_I, TAIL_I)               # longitudinal rail anchors


def _spos(s):
    """Local point at path fraction s (interpolates across the dash gaps)."""
    f = _clamp(s, 0.0, 1.0) * (SN - 1)
    i = int(f)
    r = f - i
    a, b = SLICE[i], SLICE[min(i + 1, SN - 1)]
    return (a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r,
            a[2] + (b[2] - a[2]) * r)


# ---------------------------------------------------------------------------
# Camera + strokes
# ---------------------------------------------------------------------------
class Cam:
    def __init__(self, canvas, pos=(0.0, 0.0, 0.0), yaw=0.0, pitch=0.0, fov=0.9):
        self.px, self.py, self.pz = pos
        self.cyw, self.syw = math.cos(yaw), math.sin(yaw)
        self.cp, self.sp = math.cos(pitch), math.sin(pitch)
        self.F = min(canvas.wu, canvas.hu) * fov
        self.cx, self.cy = canvas.wu / 2.0, canvas.hu / 2.0
        self.wu, self.hu = canvas.wu, canvas.hu

    def project(self, x, y, z):
        rx, ry, rz = x - self.px, y - self.py, z - self.pz
        rx, rz = rx * self.cyw - rz * self.syw, rx * self.syw + rz * self.cyw
        ry, rz = ry * self.cp - rz * self.sp, ry * self.sp + rz * self.cp
        if rz < 0.16:
            return None
        f = self.F / rz
        if f > 240.0:
            return None
        return self.cx + rx * f, self.cy - ry * f, f


def _seg_visible(cam, a, b, m=30.0):
    """Cheap reject: both endpoints beyond the same screen edge."""
    if a[0] < -m and b[0] < -m:
        return False
    if a[0] > cam.wu + m and b[0] > cam.wu + m:
        return False
    if a[1] < -m and b[1] < -m:
        return False
    return not (a[1] > cam.hu + m and b[1] > cam.hu + m)


def _stroke(canvas, cam, z, d, w, prog=1.0, s0=0.0, scale=1.0, drift=(0.0, 0.0)):
    """Draw one layer at depth z (stack slot d) with weight w. prog/s0 bound
    the drawn arc [s0, prog] for draw-on and shimmer effects. Weight times
    nearness picks the glyph: sparse dots -> dots -> line -> double line."""
    if w <= 0.02:
        return
    dx, dy = drift[0] * d, drift[1] * d
    lo, hi = int(_clamp(s0, 0, 1) * SN), int(_clamp(prog, 0, 1) * SN)
    prev, prev_piece = None, -1
    for i in range(lo, hi):
        x, y, zl = SLICE[i]
        p = cam.project(x * scale + dx, y * scale + dy, z + zl * scale)
        if p is None:
            prev = None
            continue
        if PIECE_OF[i] != prev_piece:              # never bridge a dash gap
            prev, prev_piece = None, PIECE_OF[i]
        lvl = w * p[2]
        if lvl < 4.5:
            if i % 3 == 0:
                canvas.set_dot(p[0], p[1])
        elif lvl < 9.5:
            if i % 2 == 0:
                canvas.set_dot(p[0], p[1])
        elif lvl < 26.0:
            if prev and _seg_visible(cam, prev, p):
                canvas.line(prev[0], prev[1], p[0], p[1])
        else:
            if prev and _seg_visible(cam, prev, p):
                ddx, ddy = p[0] - prev[0], p[1] - prev[1]
                dl = math.hypot(ddx, ddy) or 1.0
                nx, ny = -ddy / dl * 0.6, ddx / dl * 0.6
                canvas.line(prev[0] + nx, prev[1] + ny, p[0] + nx, p[1] + ny)
                canvas.line(prev[0] - nx, prev[1] - ny, p[0] - nx, p[1] - ny)
        prev = p


def _bead(canvas, p, k=1.0):
    if p:
        canvas.square_fill(p[0], p[1], max(1.6, min(4.5, p[2] * 0.06)) * k)


def _bracket(canvas, x, y, r):
    for sx in (-1, 1):
        for sy in (-1, 1):
            canvas.line(x + sx * r, y + sy * r, x + sx * r * 0.45, y + sy * r)
            canvas.line(x + sx * r, y + sy * r, x + sx * r, y + sy * r * 0.45)


# ---------------------------------------------------------------------------
# The treadmill base: NL identical layers at exponentially spaced depths.
# flow advances in "slots"; +1 slot == every layer moves one level nearer and
# the nearest wraps to the far end — the seamless recursive zoom.
# ---------------------------------------------------------------------------
class FluxScene(Scene):
    NL = 12                 # layers on the treadmill
    Z_NEAR = 0.55           # depth of slot 0
    RATIO = 1.28            # depth ratio per slot (the self-similar step)
    CULL_Z = 0.42           # a layer this close has whooshed past the eye
    DRIFT = (0.055, 0.095)  # world offset per slot: far layers ride up-right
    SCALE = 1.0
    DFIRE = 5.2             # the fire plane's slot depth
    FADE_Z0 = 0.45          # whoosh fade: gone by here...
    FADE_ZW = 0.30          # ...over this depth window

    def _slots(self, flow):
        """[(d, z)] far -> near. d is fractional slot depth, z world depth."""
        out = []
        for i in range(self.NL):
            d = (i - flow) % self.NL - 0.62
            z = self.Z_NEAR * self.RATIO ** d
            if z >= self.CULL_Z:
                out.append((d, z))
        out.sort(key=lambda s: -s[1])
        return out

    def _fade(self, d, z):
        """Whoosh-past fade (near) times fade-in from the focus (far)."""
        return (_clamp((z - self.FADE_Z0) / self.FADE_ZW, 0.0, 1.0) *
                _clamp((self.NL - 0.62 - d) / 0.8, 0.0, 1.0))

    def _spawn_glyph(self, canvas, cam, t):
        """The focus point itself: a tiny breathing frame where levels are born."""
        d = self.NL - 0.9
        p = cam.project(self.DRIFT[0] * d, self.DRIFT[1] * d,
                        self.Z_NEAR * self.RATIO ** d)
        if p:
            canvas.square_outline(p[0], p[1], 2.2 + 0.8 * math.sin(t * 2.0))


# ===========================================================================
# 1 — DIVE  (one expo beat per level: the endless recursive zoom)
# ===========================================================================
class FluxDiveScene(FluxScene):
    name = "flux · dive"
    BEAT = 1.4

    def draw(self, canvas):
        t = self.t
        k = int(t / self.BEAT)
        fr = t / self.BEAT - k
        flow = k + _expo(fr)                       # one level per beat
        cam = Cam(canvas, (0.12 * math.sin(t * 0.40),
                           0.24 + 0.09 * math.sin(t * 0.27), 0.0),
                  pitch=0.02 * math.sin(t * 0.33))
        self._spawn_glyph(canvas, cam, t)
        for d, z in self._slots(flow):
            born = d > self.NL - 1.62              # the level arriving this beat
            prog = _eout(fr) if born else 1.0
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.55, 0.0, 1.0)
            w = (0.62 + 0.55 * flare) * self._fade(d, z)
            _stroke(canvas, cam, z, d, w, prog=prog, drift=self.DRIFT)
            if born and prog < 1.0:                # the spark writing the level
                x, y, zl = _spos(prog)
                _bead(canvas, cam.project(x + self.DRIFT[0] * d,
                                          y + self.DRIFT[1] * d, z + zl), 0.7)
            if flare > 0.55:                       # the fired level crystallises
                for vi in (V_APEX_I, PEAK_I):
                    x, y, zl = SLICE[vi]
                    _bead(canvas, cam.project(x + self.DRIFT[0] * d,
                                              y + self.DRIFT[1] * d, z + zl),
                          0.55 * flare)

    def status(self):
        return "LVL %02d" % (int(self.t / self.BEAT) % 100)


# ===========================================================================
# 2 — LADDER  (a pulse processes each level in sequence as it arrives)
# ===========================================================================
class FluxLadderScene(FluxScene):
    name = "flux · ladder"
    SLOT = 2.0                                     # one level per pulse
    M = 6                                          # the fire band's slot

    def draw(self, canvas):
        t = self.t
        k = int(t / self.SLOT)
        fr = t / self.SLOT - k
        flow = t / self.SLOT                       # continuous feed
        s = _expo(fr)                              # the pulse along the level
        px_l, py_l, pz_l = _spos(s)
        cam = Cam(canvas, (0.10 + px_l * 0.045,
                           0.30 + 0.05 * math.sin(t * 0.5), 0.0),
                  pitch=0.015 * math.sin(t * 0.37))
        hot_d = self.M - fr - 0.62                 # the level being processed
        for d, z in self._slots(flow):
            hot = abs(d - hot_d) < 0.45
            w = (0.60 + (0.45 if hot else 0.0)) * self._fade(d, z)
            _stroke(canvas, cam, z, d, w, drift=self.DRIFT)
            if hot:
                dx, dy = self.DRIFT[0] * d, self.DRIFT[1] * d
                _stroke(canvas, cam, z, d, 1.5, prog=s,
                        s0=max(0.0, s - 0.10), drift=self.DRIFT)
                _bead(canvas, cam.project(px_l + dx, py_l + dy, z + pz_l),
                      1.0 if s < 0.97 else 1.6)    # the head; a spark at the end
        self._spawn_glyph(canvas, cam, t)

    def status(self):
        return "PROC %02d" % (int(self.t / self.SLOT) % 100)


# ===========================================================================
# 3 — CORRIDOR  (POV from inside the break; ribs, rails, and lock-ons)
# ===========================================================================
class FluxCorridorScene(FluxScene):
    name = "flux · corridor"
    SCALE = 1.5
    CULL_Z = 0.9                                   # ribs dissolve, never smear
    FADE_Z0 = 0.95
    FADE_ZW = 0.65
    LOCK = 1.9                                     # seconds per lock-on

    def _tp(self, cam, vi, z, d):
        x, y, zl = SLICE[vi]
        return cam.project(x * self.SCALE + self.DRIFT[0] * d,
                           y * self.SCALE + self.DRIFT[1] * d,
                           z + zl * self.SCALE)

    def draw(self, canvas):
        t = self.t
        flow = t * 0.55 + 0.10 * math.sin(t * 0.9)   # streaming, gently surging
        cam = Cam(canvas, (-0.95 + 0.05 * math.sin(t * 0.5),
                           0.95 + 0.05 * math.sin(t * 0.31), 0.0),
                  yaw=0.06, pitch=0.02 * math.sin(t * 0.41))
        slots = self._slots(flow)
        prev = None
        for d, z in slots:                          # longitudinal rails first
            if prev and 1.6 < z < 7.5:
                for vi in RAILS:
                    a = self._tp(cam, vi, prev[1], prev[0])
                    b = self._tp(cam, vi, z, d)
                    if a and b and _seg_visible(cam, a, b):
                        canvas.line(a[0], a[1], b[0], b[1])
            prev = (d, z)
        lk = (t % self.LOCK) / self.LOCK
        lock_d = self.DFIRE - lk                    # the rib being scanned
        for d, z in slots:
            hot = _clamp(1.0 - abs(d - lock_d) / 0.5, 0.0, 1.0)
            w = (0.58 + 0.5 * hot) * self._fade(d, z)
            _stroke(canvas, cam, z, d, w, scale=self.SCALE, drift=self.DRIFT)
            if hot > 0.6 and lk > 0.35:             # the lock-on bracket
                p = self._tp(cam, PEAK_I, z, d)
                if p:
                    _bracket(canvas, p[0], p[1],
                             min(13.0, p[2] * 0.16) * _eout((lk - 0.35) / 0.3))

    def status(self):
        return "LOCK" if (self.t % self.LOCK) / self.LOCK > 0.35 else "SCAN"


# ===========================================================================
# 4 — WARP  (the section jump: crawl, a four-level whoosh, settle)
# ===========================================================================
class FluxWarpScene(FluxScene):
    name = "flux · warp"
    CYCLE = 6.0
    JUMP = 4                                       # levels per jump

    def _flow(self, t):
        c = math.floor(t / self.CYCLE)
        u = (t - c * self.CYCLE) / self.CYCLE
        return 0.10 * t + self.JUMP * (c + _expo(_clamp((u - 0.45) / 0.33, 0, 1)))

    def draw(self, canvas):
        t = self.t
        u = (t % self.CYCLE) / self.CYCLE
        flow = self._flow(t)
        vel = (flow - self._flow(t - 0.06)) / 0.06  # slots per second
        shake = _clamp(vel * 0.010, 0.0, 0.05)
        cam = Cam(canvas, (0.10 * math.sin(t * 0.40) + shake * math.sin(t * 31),
                           0.26 + 0.08 * math.sin(t * 0.23), 0.0),
                  pitch=0.02 * math.sin(t * 0.29))
        glow = 0.25 * (1.0 - _smooth((u - 0.78) / 0.20)) if u > 0.78 else 0.0
        for d, z in self._slots(flow):
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.55, 0.0, 1.0)
            w = (0.60 + 0.45 * flare + glow) * self._fade(d, z)
            _stroke(canvas, cam, z, d, w, drift=self.DRIFT)
            if vel > 2.0 and 0.6 < z < 4.5:        # anamorphic streaks
                k = min(0.9, vel * 0.09)
                for x, y, zl in RAW_VERTS:
                    a = cam.project(x + self.DRIFT[0] * d,
                                    y + self.DRIFT[1] * d, z + zl)
                    b = cam.project(x + self.DRIFT[0] * d,
                                    y + self.DRIFT[1] * d, (z + zl) * (1 + k))
                    if a and b and _seg_visible(cam, a, b):
                        canvas.line(a[0], a[1], b[0], b[1])
        if 0.80 < u < 0.96:                        # the arrival ring
            q = _eout((u - 0.80) / 0.16)
            r = 0.3 + 2.4 * q
            for j in range(0, 48, 2):
                a = TAU * j / 48
                p = cam.project(r * math.cos(a), 0.35 + r * math.sin(a), 1.35)
                if p:
                    canvas.set_dot(p[0], p[1])
        self._spawn_glyph(canvas, cam, t)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "SECTION" if u < 0.45 else "JUMPING" if u < 0.80 else "ARRIVED"


# ===========================================================================
# 5 — FOCUS  (idle hero: constant zoom, a shimmer cascading down the stack)
# ===========================================================================
class FluxFocusScene(FluxScene):
    name = "flux · focus"

    def draw(self, canvas):
        t = self.t
        flow = t * 0.30                            # the calm endless zoom
        px = 0.55 * math.sin(t * 0.16)
        cam = Cam(canvas, (px, 0.30 + 0.22 * math.sin(t * 0.11), 0.0),
                  yaw=-px * 0.10, pitch=0.02 * math.sin(t * 0.19) - 0.01)
        self._spawn_glyph(canvas, cam, t)
        for d, z in self._slots(flow):
            w = (0.58 + 0.06 * math.sin(t * 0.9 + d * 0.7)) * self._fade(d, z)
            _stroke(canvas, cam, z, d, w, drift=self.DRIFT)
            s0 = (t * 0.45 + d * 0.09) % 1.0       # the cascading shimmer
            _stroke(canvas, cam, z, d, 1.25 * self._fade(d, z),
                    prog=min(1.0, s0 + 0.07), s0=s0, drift=self.DRIFT)

    def status(self):
        return "READY"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        FluxDiveScene(),       # 1  beat-stepped recursive zoom
        FluxLadderScene(),     # 2  each level processed in sequence
        FluxCorridorScene(),   # 3  POV ribs + rails + lock-on
        FluxWarpScene(),       # 4  the multi-level section jump
        FluxFocusScene(),      # 5  idle hero zoom
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
