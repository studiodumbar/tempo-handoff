#!/usr/bin/env python3
"""
sq_space — the square nest, but actually in space.

sq_rings keeps its squares on linearly staggered radii, which is a deliberate
REFUSAL of perspective: linear spacing is what a nest looks like as a flat
graphic, not what a corridor looks like from inside it. This file gives that up
and goes the other way — real squares at real depths, seen through a real
pinhole camera, from angles a flat nest could never show you.

Two things fall out of that trade:

  * Depth spacing is exponential (Z0 * RATIO**d), so the dolly is genuinely
    self-similar: advance flow by exactly +1 and every gate lands on the slot
    the one ahead of it just left. The picture repeats, forever, seamlessly.
    The 2D file has to fake this; here it is just what perspective does.
  * The nest is now geometric, not linear — gates crowd toward the vanishing
    point instead of stepping evenly. That crowding IS the depth.

Weight comes off camera depth (Cam.gain / z), so the glyph ramp — sparse dots,
dashes, hairline, double-stroked tube — is driven by how far away a thing
actually is, and is independent of canvas size. The gain is normalised per
scene (WNEAR * GAIN_Z, defaulting to Z0), so a scene can move its stack out for
a longer lens without the whole nest quietly fading to dots.

    1  space · gates    the recursive dolly: one expo beat per gate, flying
                        the corridor forever. The 3D reading of sq · bloom
    2  space · dutch    the camera rolls and drifts off-axis — a canted
                        horizon on a corridor that has no horizon
    3  space · oblique  slide off the axis, yaw part-way back: the vanishing
                        point slides out of centre and the gates go trapezoid
    4  space · tumble   a torsion wave: gates turning on their own axis with a
                        lag down the stack — the twist 2D cannot have at all
    5  space · swing    the whole stack tilts away and back on one expo snap,
                        stopping at a steep oblique — far edges converging
    6  space · helix    gate centres orbit the axis as they recede — the
                        throat corkscrews away from you
    7  space · fold     the corridor runs straight, then bends: gates lean and
                        yaw off toward a second vanishing point
    8  space · vertigo  the dolly zoom. Pull back while going wide, holding
                        one gate pinned — the space stretches around it
    9  space · shear    centres offset by slot, so the near end leans hard and
                        the far end converges back to true
    10 space · well     gates lying flat, stacked downward, corner rails
                        plunging: a square shaft underfoot, slowly turning
    11 space · drift    the camera orbits OUTSIDE the stack — the gates read
                        edge-on as a receding ladder, then swing to face-on

The square-path maths and the stroke ramp come straight from sq_rings; this
file adds the camera. House ease-in-out-expo. Run: `python sq_space.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from sq_rings import _sq_pt, _corners, _poly, _expo

NEAR = 0.14         # near plane; edges get clipped to it in 3D, before project

UX = (1.0, 0.0, 0.0)
UY = (0.0, 1.0, 0.0)
UZ = (0.0, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Camera. Yaw about y, then pitch about x, then ROLL about z — roll is what
# buys the canted, surreal angles a flat nest can never show.
# ---------------------------------------------------------------------------
class Cam:
    def __init__(self, canvas, pos=(0.0, 0.0, 0.0), yaw=0.0, pitch=0.0,
                 roll=0.0, fov=0.50, gain=2.4):
        self.px, self.py, self.pz = pos
        self.cyw, self.syw = math.cos(yaw), math.sin(yaw)
        self.cp, self.sp = math.cos(pitch), math.sin(pitch)
        self.cr, self.sr = math.cos(roll), math.sin(roll)
        self.roll = roll
        self.F = min(canvas.wu, canvas.hu) * fov
        self.cx, self.cy = canvas.wu * 0.5, canvas.hu * 0.5
        # Stroke weight is gain/depth. The gain rides on the camera so a scene
        # that moves its stack out cannot silently fade the whole nest to dots.
        self.gain = gain

    def view(self, x, y, z):
        """World -> camera space."""
        rx, ry, rz = x - self.px, y - self.py, z - self.pz
        rx, rz = rx * self.cyw - rz * self.syw, rx * self.syw + rz * self.cyw
        ry, rz = ry * self.cp - rz * self.sp, ry * self.sp + rz * self.cp
        if self.roll:
            rx, ry = rx * self.cr - ry * self.sr, rx * self.sr + ry * self.cr
        return (rx, ry, rz)

    def proj(self, v):
        """Camera space -> (screen x, screen y, depth). None if behind near."""
        rx, ry, rz = v
        if rz < NEAR:
            return None
        f = self.F / rz
        return (self.cx + rx * f, self.cy - ry * f, rz)


def _lookat(pos, tgt):
    """(yaw, pitch) that points a Cam at tgt. Matches Cam.view's order."""
    dx, dy, dz = tgt[0] - pos[0], tgt[1] - pos[1], tgt[2] - pos[2]
    return math.atan2(dx, dz), math.atan2(dy, math.hypot(dx, dz))


def _rot(v, rx=0.0, ry=0.0, rz=0.0):
    x, y, z = v
    if rz:
        c, s = math.cos(rz), math.sin(rz)
        x, y = x * c - y * s, x * s + y * c
    if rx:
        c, s = math.cos(rx), math.sin(rx)
        y, z = y * c - z * s, y * s + z * c
    if ry:
        c, s = math.cos(ry), math.sin(ry)
        z, x = z * c - x * s, z * s + x * c
    return (x, y, z)


def _lerp3(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t)


# ---------------------------------------------------------------------------
# Strokes
# ---------------------------------------------------------------------------
def _edge(canvas, cam, pa, pb, k):
    """One world-space segment. Clipped to the near plane in 3D FIRST — a
    corner behind the eye projects to garbage, and once a gate is whooshing
    past you that is most of them. Subdivided when the two ends sit at very
    different depths, so the weight ramp runs along the edge instead of
    stepping at the ends (a tilted gate spans a lot of depth)."""
    if k <= 0.02:
        return
    va, vb = cam.view(*pa), cam.view(*pb)
    za, zb = va[2], vb[2]
    if za < NEAR and zb < NEAR:
        return
    if za < NEAR:
        va = _lerp3(va, vb, (NEAR - za) / (zb - za))
    elif zb < NEAR:
        vb = _lerp3(vb, va, (NEAR - zb) / (za - zb))
    zr = max(va[2], vb[2]) / min(va[2], vb[2])
    n = 1 if zr < 1.4 else min(10, int(zr * 1.5))
    prev = None
    for i in range(n + 1):
        p = cam.proj(_lerp3(va, vb, i / n))
        if prev is not None and p is not None:
            _poly(canvas, [prev[:2], p[:2]],
                  k * cam.gain * 2.0 / (prev[2] + p[2]))
        prev = p


def _sq3(s, c, ux, uy, r):
    """The point at perimeter fraction s on a square in 3D."""
    lx, ly = _sq_pt(s, r)
    return (c[0] + ux[0] * lx + uy[0] * ly,
            c[1] + ux[1] * lx + uy[1] * ly,
            c[2] + ux[2] * lx + uy[2] * ly)


def _quad(canvas, cam, c, ux, uy, r, k, s0=0.0, s1=1.0):
    """A square in space: centre c, in-plane axes ux/uy, half-size r."""
    if k <= 0.02 or r <= 0.0 or s1 <= s0:
        return
    if s1 - s0 > 1.0:
        s1 = s0 + 1.0
    pts = [_sq3(s, c, ux, uy, r) for s in _corners(s0, s1)]
    for a, b in zip(pts, pts[1:]):
        _edge(canvas, cam, a, b, k)


# ---------------------------------------------------------------------------
# The treadmill. Depths are EXPONENTIAL, so +1 flow is an exact repeat: each
# gate lands where the one ahead of it was. That is the free lunch of doing
# this in 3D — the 2D file has to construct the same seam by hand.
# ---------------------------------------------------------------------------
class SpaceScene(Scene):
    NG = 11             # gates on the treadmill
    Z0 = 0.92           # depth of slot 0
    RATIO = 1.30        # depth ratio per slot — the self-similar step
    CULL = 0.60         # nearer than this and it has passed the eye
    R = 1.0             # gate half-size, world units
    FOV = 0.50
    GONE = 0.22         # whoosh-past fade window, in depth
    BORN = 0.90         # fade-in window at the vanishing point, in slots
    WNEAR = 2.60        # stroke weight at the stack's near end (see _cam)
    GAIN_Z = None       # CAMERA depth the weight ramp is tuned for; None -> Z0

    def _cam(self, canvas, pos=(0.0, 0.0, 0.0), yaw=0.0, pitch=0.0, roll=0.0,
             fov=None):
        # Weight is gain/depth, and that depth is measured from the CAMERA, so
        # the gain has to be normalised to wherever the camera actually sits.
        # Z0 is right for the scenes flying the axis; a scene that watches from
        # outside must say so via GAIN_Z or its whole nest fades to dots.
        gz = self.Z0 if self.GAIN_Z is None else self.GAIN_Z
        return Cam(canvas, pos, yaw, pitch, roll,
                   self.FOV if fov is None else fov, self.WNEAR * gz)

    def _slots(self, flow):
        """[(d, z)] far -> near. d is the fractional slot, z the world depth."""
        out = []
        for i in range(self.NG):
            d = (i - flow) % self.NG - 0.5
            z = self.Z0 * self.RATIO ** d
            if z >= self.CULL:
                out.append((d, z))
        out.sort(key=lambda s: -s[1])
        return out

    def _fade(self, d, z):
        return (_clamp((z - self.CULL) / self.GONE, 0.0, 1.0) *
                _clamp((self.NG - 0.5 - d) / self.BORN, 0.0, 1.0))


# ===========================================================================
# The corridor
# ===========================================================================
class GatesScene(SpaceScene):
    name = "space · gates"
    BEAT = 1.30

    def draw(self, canvas):
        t = self.t
        k = math.floor(t / self.BEAT)
        flow = k + _expo(t / self.BEAT - k)        # one gate per beat, expo
        cam = self._cam(canvas, pos=(0.05 * math.sin(t * 0.31),
                                     0.04 * math.sin(t * 0.23), 0.0))
        for d, z in self._slots(flow):
            _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, self._fade(d, z))

    def status(self):
        return "GATE %02d" % (int(self.t / self.BEAT) % 100)


class DutchScene(SpaceScene):
    name = "space · dutch"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas,
                        pos=(0.34 * math.sin(t * 0.27),
                             0.20 * math.cos(t * 0.31), 0.0),
                        roll=0.62 * math.sin(t * 0.33))
        for d, z in self._slots(t * 0.44):
            _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, self._fade(d, z))

    def status(self):
        return "CANT"


class ObliqueScene(SpaceScene):
    """Stack pushed out on a longer lens so the slide has somewhere to go: with
    the stack at Z0=0.92 the camera slides out to x=1.7 and ends up ALONGSIDE a
    gate that only spans x=-1..1, and the yaw then swings that far corner round
    to sit on the eye."""
    name = "space · oblique"
    Z0 = 1.55
    CULL = 1.15
    FOV = 0.85

    def draw(self, canvas):
        t = self.t
        px = 1.5 * math.sin(t * 0.30)
        # yaw only PART of the way back, so the vanishing point slides off
        # centre instead of staying pinned — that is what shears the gates.
        cam = self._cam(canvas, pos=(px, 0.55 * math.sin(t * 0.21), 0.0),
                        yaw=math.atan2(px, 5.0) * 0.72)
        for d, z in self._slots(t * 0.40):
            _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, self._fade(d, z))

    def status(self):
        return "OBLIQUE"


class TumbleScene(SpaceScene):
    """The twist sq_rings could not have — but only just. Depth separation buys
    real headroom over the 2D nest, where ANY rotation hashes: here the gates
    can genuinely turn. Measured, though, it runs out around 15 degrees; by 33
    it is back to a thicket of unrelated diagonals. So this is a torsion WAVE at
    a modest amplitude, not the free tumble the name suggests. In motion the
    lag down the stack reads far louder than a still frame lets on."""
    name = "space · tumble"
    Z0 = 1.60           # a tilted gate spans +/-R*sin(tilt) in DEPTH, so the
    CULL = 1.15         # stack has to clear the eye by more than that
    FOV = 0.85

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas)
        for d, z in self._slots(t * 0.36):
            ph = 0.26 * math.sin(t * 0.85 - d * 0.42)
            ux, uy = _rot(UX, ph * 0.35, ph), _rot(UY, ph * 0.35, ph)
            _quad(canvas, cam, (0.0, 0.0, z), ux, uy, self.R, self._fade(d, z))

    def status(self):
        return "TORSION"


class SwingScene(SpaceScene):
    """The stack tilts away and back. It stops at 60 degrees on purpose: taken
    all the way to edge-on every gate degenerates to a bar a few units wide and
    eleven of them pile into one smear. Stopping short keeps the perspective —
    you can still read each gate's far edge converging — which is the point.

    The stack also sits further out than the other scenes, on a longer lens: a
    tilted gate spans +/-R in DEPTH, so a near stack would straddle the eye."""
    name = "space · swing"
    CYCLE = 4.20
    Z0 = 2.60
    CULL = 1.95
    FOV = 1.10
    GONE = 0.40

    def _swing(self, t):
        u = (t % self.CYCLE) / self.CYCLE
        return 1.05 * _expo(1.0 - abs(2.0 * u - 1.0))

    def draw(self, canvas):
        t = self.t
        ry = self._swing(t)
        cam = self._cam(canvas)
        ux, uy = _rot(UX, 0.0, ry), _rot(UY, 0.0, ry)
        for d, z in self._slots(t * 0.30):
            _quad(canvas, cam, (0.0, 0.0, z), ux, uy, self.R, self._fade(d, z))

    def status(self):
        return "OBLIQUE" if self._swing(self.t) > 0.7 else "FACE"


class HelixScene(SpaceScene):
    name = "space · helix"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas)
        for d, z in self._slots(t * 0.40):
            th = d * 0.58 - t * 0.55
            c = (0.52 * math.cos(th), 0.52 * math.sin(th), z)
            _quad(canvas, cam, c, UX, UY, self.R * 0.82, self._fade(d, z))

    def status(self):
        return "CORKSCREW"


class FoldScene(SpaceScene):
    name = "space · fold"

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas, pos=(0.0, 0.12, 0.0))
        for d, z in self._slots(t * 0.38):
            bend = 0.30 * max(0.0, d - 2.6)        # straight, then it turns
            bend = min(bend, 1.30)
            c = (2.6 * (1.0 - math.cos(bend)), 0.0, z)
            ux, uy = _rot(UX, 0.0, -bend), UY
            _quad(canvas, cam, c, ux, uy, self.R, self._fade(d, z))

    def status(self):
        return "FOLD"


class VertigoScene(SpaceScene):
    """The dolly zoom: hold one gate pinned at a fixed size while the lens and
    the camera trade off, so the space stretches around it. Pinning means

        F*R / (ZT - camz) == min*PIN     =>     camz = ZT - fov*R/PIN

    which is a hard constraint, not a free choice: the FOV range picks where the
    camera goes. Pick it carelessly and camz solves to somewhere INSIDE the
    stack, putting gates behind the eye. So FOV_LO is chosen to keep camz behind
    the nearest gate at every point in the cycle — see the assert."""
    name = "space · vertigo"
    CYCLE = 4.60
    ZT = 3.10           # the gate held pinned
    PIN = 0.42          # ...at this projected half-size, in min-canvas units
    FOV_LO = 1.26       # wide end  -> camera closest  (camz = ZT - LO/PIN)
    FOV_HI = 3.78       # tele end  -> camera furthest back
    GAIN_Z = 2.00

    def reset(self):
        super().reset()
        znear = self.Z0 * self.RATIO ** -0.5          # the closest gate
        camz = self.ZT - self.FOV_LO * self.R / self.PIN
        assert camz < znear - 0.4, (
            "vertigo: FOV_LO=%.2f puts the camera at z=%.2f, inside the stack "
            "(nearest gate z=%.2f). Raise FOV_LO or PIN." % (
                self.FOV_LO, camz, znear))

    def _shot(self, t):
        u = (t % self.CYCLE) / self.CYCLE
        fov = self.FOV_LO + (self.FOV_HI - self.FOV_LO) * _expo(
            1.0 - abs(2.0 * u - 1.0))
        return fov, self.ZT - fov * self.R / self.PIN

    def draw(self, canvas):
        t = self.t
        fov, camz = self._shot(t)
        cam = self._cam(canvas, pos=(0.0, 0.0, camz), fov=fov)
        for d, z in self._slots(t * 0.16):
            _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, self._fade(d, z))

    def status(self):
        return "WIDE" if self._shot(self.t)[0] < 2.2 else "TELE"


class ShearScene(SpaceScene):
    name = "space · shear"

    def draw(self, canvas):
        t = self.t
        th = t * 0.36
        cam = self._cam(canvas)
        for d, z in self._slots(t * 0.40):
            # offset by SLOT, not by depth: depth grows exponentially, so the
            # far gates converge back to true while the near end leans hard.
            # Offsetting by z instead would just translate the whole tunnel.
            a = 0.26 * d
            c = (a * math.cos(th), a * math.sin(th) * 0.55, z)
            _quad(canvas, cam, c, UX, UY, self.R, self._fade(d, z))

    def status(self):
        return "SHEAR"


class WellScene(SpaceScene):
    """Gates lying flat, stacked downward, seen from just off vertical. Looking
    straight down a square shaft is geometrically IDENTICAL to looking down a
    square corridor, so the tilt is the only thing that says which way is down —
    and the corner rails are the only thing that says shaft at all. Without them
    this scene is just `gates` wearing a hat.

    Long lens, distant stack: perspective strength goes as size-over-distance,
    so a close stack shears violently under even a few degrees of tilt."""
    name = "space · well"
    R = 1.05
    Z0 = 3.20
    CULL = 2.35
    FOV = 1.35
    GONE = 0.55

    def draw(self, canvas):
        t = self.t
        cam = self._cam(canvas, yaw=t * 0.16,
                        pitch=-math.pi * 0.5 + 0.15 + 0.03 * math.sin(t * 0.4))
        prev = None
        for d, z in self._slots(t * 0.34):
            f = self._fade(d, z)
            if prev is not None:                   # the shaft's corner edges
                pz, pf = prev
                k = 0.72 * min(f, pf)
                for i in range(4):
                    _edge(canvas, cam,
                          _sq3(i * 0.25, (0.0, -pz, 0.0), UX, UZ, self.R),
                          _sq3(i * 0.25, (0.0, -z, 0.0), UX, UZ, self.R), k)
            _quad(canvas, cam, (0.0, -z, 0.0), UX, UZ, self.R, f)
            prev = (z, f)

    def status(self):
        return "SHAFT"


class DriftScene(SpaceScene):
    """Watching the stack from outside instead of flying it. Three things have
    to change to make that work, and all three are the same point: the camera
    is no longer sitting in the stack.

    The stack has to be COMPACT (the flying scenes run z from 0.7 out to 14 —
    orbit that at any sane radius and you are still inside it). The lens has to
    be long, because from 7 units back a 1-unit gate is otherwise a speck. And
    GAIN_Z has to say where the camera really is. The swing stops at 57 degrees
    too: a full orbit passes through the stack AND through pure edge-on."""
    name = "space · drift"
    NG = 8
    Z0 = 1.70
    RATIO = 1.24
    CULL = 1.30
    GONE = 0.30
    FOV = 2.20
    ORB = 7.50
    TGT = 4.20
    GAIN_Z = 6.50

    def draw(self, canvas):
        t = self.t
        th = 1.0 * math.sin(t * 0.30)
        pos = (self.ORB * math.sin(th), 1.1 * math.sin(t * 0.21),
               self.TGT - self.ORB * math.cos(th))
        yaw, pitch = _lookat(pos, (0.0, 0.0, self.TGT))
        cam = self._cam(canvas, pos=pos, yaw=yaw, pitch=pitch)
        for d, z in self._slots(t * 0.26):
            _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, self._fade(d, z))

    def status(self):
        return "SIDE" if abs(math.sin(self.t * 0.30)) > 0.6 else "FACE"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        GatesScene(),          # 1  the recursive dolly
        DutchScene(),          # 2  canted horizon
        ObliqueScene(),        # 3  sliding vanishing point
        TumbleScene(),         # 4  gates turning on their own axes
        SwingScene(),          # 5  the stack tilting away and back
        HelixScene(),          # 6  the corkscrew throat
        FoldScene(),           # 7  the corridor bends
        VertigoScene(),        # 8  the dolly zoom
        ShearScene(),          # 9  the leaning near end
        WellScene(),           # 10 the square shaft underfoot
        DriftScene(),          # 11 orbiting outside the stack
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
