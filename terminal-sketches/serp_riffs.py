#!/usr/bin/env python3
"""
serp_riffs — MANY dynamic riffs on agent_states_3d scenes 3 + 5, all built
from the serpentine zigzag layer.

The premise: the shape is never static. Every scene here is the same living
machine — identical zigzag level-paths (V, broken rise, peak, fall) on the
exponential depth treadmill from serp_flux, streaming through the central
focus point — but each riff changes ONE idea about how the layers move,
fire, or arrange themselves. Family one grows out of scene 3 (the lattice
dive: a plane firing each layer as you pass through); family two out of
scene 5 (the aisle: a POV corridor with ribs, rails, scan plane, lock-on).

    scene-3 family — the dive riffs
    1  zig · plane     a compute plane cycles through the stack, firing
                       whichever level it touches (the straight homage)
    2  zig · chain     a zap wavefront runs focus -> eye through every
                       level, one chain reaction per beat
    3  zig · inkfall   every level perpetually redraws itself; the draw
                       heads cascade down the stack like falling ink
    4  zig · spool     the dive spins up from a crawl to a whoosh each
                       cycle, streaking, then catches its breath
    5  zig · twist     each level is rotated a little more than the last:
                       a helix that unwinds as it reaches you
    6  zig · breach    levels approach as ghosts, SNAP solid crossing the
                       fire plane, and burn down to dots once consumed
    7  zig · rewind    three levels forward, hold, snap all the way back —
                       the zoom breathes in and out
    8  zig · duplex    a mirrored ghost stack streams the other way,
                       passing through the main dive

    scene-5 family — the aisle riffs
    9  zig · aisle     two mirrored banks form the corridor; a scan plane
                       sweeps the ribs and a bracket locks on
    10 zig · strafe    the camera slides across the stream, shearing the
                       stack while always facing the focus
    11 zig · snake     the road curves: levels weave left-right as they
                       approach, the whole stream undulating
    12 zig · banks     levels alternate left bank / right bank as they
                       arrive, one expo beat per side — the double
                       serpentine interleaved in depth
    13 zig · lockstep  sweep, lock a level, then ZOOM two levels into it;
                       repeat forever — recursive lock-and-dive
    14 zig · fall      the stack rains from above: levels drop into place
                       as they near, one beat per catch

House ease-in-out-expo, seamless treadmills, the dot -> line -> double-tube
depth ramp throughout. Run standalone: `python serp_riffs.py`.
"""

import math
import sys

from mpp import _clamp
from serp_flux import (FluxScene, Cam, SLICE, SN, PIECE_OF, V_APEX_I, PEAK_I,
                       TAIL_I, RAW_VERTS, _bead, _bracket, _seg_visible,
                       _spos, _expo, _eout, _smooth)

TAU = 2.0 * math.pi
NL = FluxScene.NL


def _wrapd(a, b, n=NL):
    d = abs(a - b) % n
    return min(d, n - d)


def _ein(x):
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 2.0 ** (10.0 * x - 10.0)


# ---------------------------------------------------------------------------
# The generalised layer stroke: offset, scale, z-rotation, mirror. Same glyph
# ramp as serp_flux (sparse dots -> dots -> line -> double line).
# ---------------------------------------------------------------------------
def _xform(vi, z, ox, oy, scale=1.0, rot=0.0, mir=1.0):
    """World position of slice vertex vi under the layer transform."""
    x, y, zl = SLICE[vi]
    x, y = x * mir * scale, y * scale
    if rot:
        ca, sa = math.cos(rot), math.sin(rot)
        x, y = x * ca - y * sa, x * sa + y * ca
    return (x + ox, y + oy, z + zl * scale)


def _zig(canvas, cam, z, w, ox=0.0, oy=0.0, prog=1.0, s0=0.0,
         scale=1.0, rot=0.0, mir=1.0):
    if w <= 0.02:
        return
    ca, sa = (math.cos(rot), math.sin(rot)) if rot else (1.0, 0.0)
    lo, hi = int(_clamp(s0, 0, 1) * SN), int(_clamp(prog, 0, 1) * SN)
    prev, prev_piece = None, -1
    for i in range(lo, hi):
        x, y, zl = SLICE[i]
        x, y = x * mir * scale, y * scale
        if rot:
            x, y = x * ca - y * sa, x * sa + y * ca
        p = cam.project(x + ox, y + oy, z + zl * scale)
        if p is None or p[2] > 150.0:              # too near: dissolved
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
            if (prev and _seg_visible(cam, prev, p) and
                    abs(p[0] - prev[0]) + abs(p[1] - prev[1]) < 90.0):
                canvas.line(prev[0], prev[1], p[0], p[1])
        else:
            if prev and _seg_visible(cam, prev, p):
                ddx, ddy = p[0] - prev[0], p[1] - prev[1]
                if abs(ddx) + abs(ddy) < 90.0:     # cap runaway near segments
                    dl = math.hypot(ddx, ddy) or 1.0
                    nx, ny = -ddy / dl * 0.6, ddx / dl * 0.6
                    canvas.line(prev[0] + nx, prev[1] + ny, p[0] + nx, p[1] + ny)
                    canvas.line(prev[0] - nx, prev[1] - ny, p[0] - nx, p[1] - ny)
        prev = p


class ZigScene(FluxScene):
    """Shared breathing camera; subclasses supply the riff."""

    def _cam(self, canvas, px=0.0, py=0.26, yaw=0.0, pitch=0.0):
        t = self.t
        return Cam(canvas,
                   (px + 0.10 * math.sin(t * 0.37),
                    py + 0.07 * math.sin(t * 0.23), 0.0),
                   yaw=yaw, pitch=pitch + 0.018 * math.sin(t * 0.31))

    def _dw(self, d):
        """The standard up-right recession offsets for slot depth d."""
        return self.DRIFT[0] * d, self.DRIFT[1] * d


# ===========================================================================
# scene-3 family — the dive riffs
# ===========================================================================
class ZigPlaneScene(ZigScene):
    name = "zig · plane"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas)
        pd = NL - (t * 0.9) % NL                   # the plane, sweeping nearer
        for d, z in self._slots(t * 0.42):
            ox, oy = self._dw(d)
            act = _clamp(1.0 - _wrapd(d, pd) / 0.8, 0.0, 1.0)
            _zig(canvas, cam, z, (0.42 + 0.75 * act) * self._fade(d, z), ox, oy)
            if act > 0.5:                          # the fired level's nodes
                for vi in (V_APEX_I, PEAK_I, TAIL_I):
                    _bead(canvas, cam.project(*_xform(vi, z, ox, oy)), 0.5 * act)

    def status(self):
        return "COMPUTE"


class ZigChainScene(ZigScene):
    name = "zig · chain"
    BEAT = 1.1

    def draw(self, canvas):
        t = self.t
        k = int(t / self.BEAT)
        fr = t / self.BEAT - k
        cam = self._cam(canvas)
        wd = (NL + 1.0) * (1.0 - _expo(fr)) - 0.5  # the zap, focus -> eye
        for d, z in self._slots(t * 0.14):
            ox, oy = self._dw(d)
            hit = _clamp(1.0 - abs(d - wd) / 0.6, 0.0, 1.0)
            _zig(canvas, cam, z, (0.50 + 0.80 * hit) * self._fade(d, z), ox, oy)
            if hit > 0.6:
                _bead(canvas, cam.project(*_xform(PEAK_I, z, ox, oy)), 0.6 * hit)

    def status(self):
        return "CHAIN %02d" % (int(self.t / self.BEAT) % 100)


class ZigInkfallScene(ZigScene):
    name = "zig · inkfall"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas)
        for d, z in self._slots(t * 0.22):
            ox, oy = self._dw(d)
            fade = self._fade(d, z)
            pr = (t * 0.55 + (NL - d) * 0.12) % 1.25   # redraw, then rest
            _zig(canvas, cam, z, 0.22 * fade, ox, oy)  # the ghost of the level
            _zig(canvas, cam, z, 0.85 * fade, ox, oy, prog=min(1.0, pr))
            if pr < 1.0:                               # the ink head
                x, y, zl = _spos(pr)
                _bead(canvas, cam.project(x + ox, y + oy, z + zl), 0.6)

    def status(self):
        return "INK"


class ZigSpoolScene(ZigScene):
    name = "zig · spool"
    CYCLE = 3.6

    def _flow(self, t):
        c = math.floor(t / self.CYCLE)
        return 6.0 * (c + _ein((t - c * self.CYCLE) / self.CYCLE))

    def draw(self, canvas):
        t = self.t
        flow = self._flow(t)
        vel = (flow - self._flow(t - 0.06)) / 0.06
        shake = _clamp(vel * 0.008, 0.0, 0.04)
        cam = self._cam(canvas, px=shake * math.sin(t * 29))
        for d, z in self._slots(flow):
            ox, oy = self._dw(d)
            _zig(canvas, cam, z, 0.58 * self._fade(d, z), ox, oy)
            if vel > 2.5 and 0.6 < z < 4.2:        # the spool-up streaks
                kk = min(0.8, vel * 0.05)
                for x, y, zl in RAW_VERTS:
                    a = cam.project(x + ox, y + oy, z + zl)
                    b = cam.project(x + ox, y + oy, (z + zl) * (1 + kk))
                    if a and b and _seg_visible(cam, a, b):
                        canvas.line(a[0], a[1], b[0], b[1])

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "SPOOLING" if u < 0.75 else "WHOOSH"


class ZigTwistScene(ZigScene):
    name = "zig · twist"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas)
        for d, z in self._slots(t * 0.40):
            rot = d * 0.12 + t * 0.20              # the helix, unwinding near
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.7, 0.0, 1.0)
            _zig(canvas, cam, z, (0.52 + 0.4 * flare) * self._fade(d, z),
                 self.DRIFT[0] * d * 0.4, self.DRIFT[1] * d * 0.4, rot=rot)

    def status(self):
        return "TWIST"


class ZigBreachScene(ZigScene):
    name = "zig · breach"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas)
        for d, z in self._slots(t * 0.50):
            ox, oy = self._dw(d)
            fade = self._fade(d, z)
            pop = _clamp(1.0 - abs(d - self.DFIRE) / 0.45, 0.0, 1.0)
            if pop > 0.0:                          # SNAP: crossing the plane
                _zig(canvas, cam, z, 1.30 * fade, ox, oy,
                     scale=1.0 + 0.08 * pop)
                for vi in (V_APEX_I, PEAK_I, TAIL_I):
                    _bead(canvas, cam.project(*_xform(vi, z, ox, oy)), 0.6 * pop)
            elif d > self.DFIRE:                   # approaching: a ghost
                _zig(canvas, cam, z, 0.30 * fade, ox, oy)
            else:                                  # consumed: burning down
                _zig(canvas, cam, z,
                     (0.06 + 0.50 * _clamp(d / self.DFIRE, 0, 1)) * fade, ox, oy)

    def status(self):
        return "BREACH"


class ZigRewindScene(ZigScene):
    name = "zig · rewind"
    CYCLE = 5.0

    def draw(self, canvas):
        t = self.t
        u = (t % self.CYCLE) / self.CYCLE
        flow = (t * 0.06 + 3.0 * _expo(_clamp(u / 0.52, 0, 1))
                - 3.0 * _expo(_clamp((u - 0.68) / 0.28, 0, 1)))
        cam = self._cam(canvas)
        for d, z in self._slots(flow):
            ox, oy = self._dw(d)
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.7, 0.0, 1.0)
            _zig(canvas, cam, z, (0.52 + 0.4 * flare) * self._fade(d, z), ox, oy)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "ADVANCE" if u < 0.52 else "HOLD" if u < 0.68 else "REWIND"


class ZigDuplexScene(ZigScene):
    name = "zig · duplex"

    def draw(self, canvas):
        t = self.t
        flow = t * 0.45
        cam = self._cam(canvas)
        ghosts = []                                # the counter-flowing stack
        for i in range(NL):
            d = (i + flow * 0.75) % NL - 0.62
            z = self.Z_NEAR * self.RATIO ** d
            if z >= self.CULL_Z:
                ghosts.append((d, z))
        ghosts.sort(key=lambda s: -s[1])
        for d, z in ghosts:
            _zig(canvas, cam, z, 0.26 * self._fade(d, z),
                 -self.DRIFT[0] * d, self.DRIFT[1] * d, mir=-1.0)
        for d, z in self._slots(flow):
            ox, oy = self._dw(d)
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.6, 0.0, 1.0)
            _zig(canvas, cam, z, (0.55 + 0.45 * flare) * self._fade(d, z), ox, oy)

    def status(self):
        return "DUPLEX"


# ===========================================================================
# scene-5 family — the aisle riffs
# ===========================================================================
class ZigAisleScene(ZigScene):
    name = "zig · aisle"
    CULL_Z = 0.9
    FADE_Z0 = 0.95
    FADE_ZW = 0.65
    LOCK = 2.1
    SC = 0.68

    def draw(self, canvas):
        t = self.t
        lk = (t % self.LOCK) / self.LOCK
        cam = self._cam(canvas, py=0.30, yaw=0.05 * math.sin(TAU * lk))
        slots = self._slots(t * 0.55)
        prev = None
        for d, z in slots:                         # rails down both walls
            if prev and 1.6 < z < 7.5:
                for side in (-1.0, 1.0):
                    for vi in (PEAK_I, V_APEX_I):
                        a = cam.project(*_xform(vi, prev, side * 2.35, 0.0,
                                                self.SC, 0.0, side))
                        b = cam.project(*_xform(vi, z, side * 2.35, 0.0,
                                                self.SC, 0.0, side))
                        if a and b and _seg_visible(cam, a, b):
                            canvas.line(a[0], a[1], b[0], b[1])
            prev = z
        sd = NL * (1.0 - (t * 0.5) % 1.0)          # the scan plane
        for d, z in slots:
            hot = _clamp(1.0 - abs(d - sd) / 0.7, 0.0, 1.0)
            for side in (-1.0, 1.0):
                _zig(canvas, cam, z, (0.5 + 0.55 * hot) * self._fade(d, z),
                     side * 2.35, 0.0, scale=self.SC, mir=side)
            if hot > 0.6 and lk > 0.5:             # lock the scanned rib
                side = -1.0 if int(t / self.LOCK) % 2 else 1.0
                p = cam.project(*_xform(PEAK_I, z, side * 2.35, 0.0,
                                        self.SC, 0.0, side))
                if p:
                    _bracket(canvas, p[0], p[1],
                             min(12.0, p[2] * 0.15) * _eout((lk - 0.5) / 0.3))

    def status(self):
        return "LOCK" if (self.t % self.LOCK) / self.LOCK > 0.5 else "SCAN"


class ZigStrafeScene(ZigScene):
    name = "zig · strafe"

    def draw(self, canvas):
        t = self.t
        px = 1.5 * math.sin(t * 0.28)              # slide across the stream
        cam = self._cam(canvas, px=px, yaw=-math.atan2(px, 4.0) * 0.8)
        for d, z in self._slots(t * 0.45):
            ox, oy = self._dw(d)
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.7, 0.0, 1.0)
            _zig(canvas, cam, z, (0.52 + 0.4 * flare) * self._fade(d, z), ox, oy)

    def status(self):
        return "STRAFE"


class ZigSnakeScene(ZigScene):
    name = "zig · snake"

    def _road(self, d):
        return 1.15 * math.sin(d * 0.55 - self.t * 1.1)

    def draw(self, canvas):
        t = self.t
        px = 0.5 * self._road(1.5)                 # follow the road's near end
        cam = self._cam(canvas, px=px, yaw=(self._road(4.5) - px) * 0.10)
        for d, z in self._slots(t * 0.50):
            _zig(canvas, cam, z, 0.55 * self._fade(d, z),
                 self._road(d) + self.DRIFT[0] * d * 0.3,
                 self.DRIFT[1] * d * 0.5)

    def status(self):
        return "SNAKE"


class ZigBanksScene(ZigScene):
    name = "zig · banks"
    BEAT = 1.2
    SC = 0.8

    def draw(self, canvas):
        t = self.t
        k = int(t / self.BEAT)
        fr = t / self.BEAT - k
        flow = k + _expo(fr)                       # one level, one side, per beat
        cam = self._cam(canvas,
                        yaw=0.07 * math.sin(math.pi * fr) * (1 if k % 2 else -1))
        slots = []
        for i in range(NL):
            d = (i - flow) % NL - 0.62
            z = self.Z_NEAR * self.RATIO ** d
            if z >= self.CULL_Z:
                slots.append((d, z, 1.0 if i % 2 else -1.0))
        slots.sort(key=lambda s: -s[1])
        for d, z, side in slots:
            born = d > NL - 1.62
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.6, 0.0, 1.0)
            _zig(canvas, cam, z, (0.55 + 0.45 * flare) * self._fade(d, z),
                 side * 1.25, self.DRIFT[1] * d * 0.6,
                 prog=_eout(fr) if born else 1.0, scale=self.SC, mir=-side)

    def status(self):
        return "→ R" if int(self.t / self.BEAT) % 2 else "L ←"


class ZigLockstepScene(ZigScene):
    name = "zig · lockstep"
    CYCLE = 3.2

    def draw(self, canvas):
        t = self.t
        c = math.floor(t / self.CYCLE)
        u = (t - c * self.CYCLE) / self.CYCLE
        flow = 2.0 * (c + _expo(_clamp((u - 0.55) / 0.40, 0, 1))) + 0.05 * t
        cam = self._cam(canvas)
        td = 9.0 - 3.8 * _eout(_clamp(u / 0.35, 0, 1))   # sweep, then hold
        lockq = _clamp((u - 0.35) / 0.20, 0.0, 1.0)
        slots = self._slots(flow)
        best = min(slots, key=lambda s: abs(s[0] - td)) if slots else None
        for d, z in slots:
            ox, oy = self._dw(d)
            hot = 0.55 * lockq if best and d == best[0] else 0.0
            _zig(canvas, cam, z, (0.50 + hot) * self._fade(d, z), ox, oy)
        if best and u < 0.62:                      # the roving bracket
            d, z = best
            p = cam.project(*_xform(PEAK_I, z, *self._dw(d)))
            if p:
                _bracket(canvas, p[0], p[1],
                         min(15.0, p[2] * 0.18) * (1.0 - 0.35 * lockq))

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "SWEEP" if u < 0.35 else "LOCK" if u < 0.55 else "ZOOM"


class ZigFallScene(ZigScene):
    name = "zig · fall"
    BEAT = 1.3

    def draw(self, canvas):
        t = self.t
        k = int(t / self.BEAT)
        fr = t / self.BEAT - k
        flow = k + _expo(fr)
        cam = self._cam(canvas, py=0.35, pitch=0.05)
        for d, z in self._slots(flow):
            drop = z - self.Z_NEAR                 # offsets shrink with depth,
            ox, oy = 0.08 * drop, 0.55 * drop      # so layers LAND as they near
            flare = _clamp(1.0 - abs(d - self.DFIRE) / 0.6, 0.0, 1.0)
            born = d > NL - 1.62
            _zig(canvas, cam, z, (0.55 + 0.45 * flare) * self._fade(d, z),
                 ox, oy, prog=_eout(fr) if born else 1.0)

    def status(self):
        return "FALL %02d" % (int(self.t / self.BEAT) % 100)


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        ZigPlaneScene(),       # 1  the compute plane homage
        ZigChainScene(),       # 2  zap wavefront, focus -> eye
        ZigInkfallScene(),     # 3  cascading perpetual redraws
        ZigSpoolScene(),       # 4  crawl -> whoosh spin-ups
        ZigTwistScene(),       # 5  the unwinding helix
        ZigBreachScene(),      # 6  ghost -> SNAP -> burn-down
        ZigRewindScene(),      # 7  the breathing zoom
        ZigDuplexScene(),      # 8  counter-flowing ghost stack
        ZigAisleScene(),       # 9  corridor + scan + lock-on
        ZigStrafeScene(),      # 10 sliding across the stream
        ZigSnakeScene(),       # 11 the undulating road
        ZigBanksScene(),       # 12 L/R alternating banks
        ZigLockstepScene(),    # 13 sweep, lock, zoom, repeat
        ZigFallScene(),        # 14 raining into place
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
