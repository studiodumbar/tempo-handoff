#!/usr/bin/env python3
"""
sq_axis — the square corridor as a considered loop, not a flight.

Third pass at the spatial reading. sq_space put a real camera in the nest and
then moved everything at once — dolly plus roll plus orbit plus tilt, over an
endless treadmill forever birthing and killing gates. Plenty of motion, no
through-line: nothing in a frame was a decision you could point at.

Four rules, and they are rules rather than taste:

  * ONE AXIS. Each scene animates exactly ONE property — depth, or scale, or x,
    or pitch, or the perimeter — and holds every other dead still. The camera
    is bolted to the origin. Exactly one scene moves it, and says so in its name.
  * ALWAYS STAGGERED. That property runs the stack on a per-gate phase lag
    (LAG), so what you see is a WAVE with a direction and a front, not six
    things twitching at once. The stagger IS the composition.
  * FIXED SET. Six gates at six fixed depths. No treadmill, nothing born,
    nothing culled, the frame never rearranges — a wave needs something stable
    to read against.
  * FRAMED. The nearest gate is sized to FRAC of the half-frame, leaving a lot
    of air on all four sides, and no motion is ever allowed to spend it.

THE AMPLITUDES ARE SOLVED, NOT TUNED. This is what the first attempt got wrong.
A staggered expo snap puts neighbouring gates at opposite ends of their swing
for an instant, so any amplitude bigger than the gap between two gates tears the
nest into a jumble — which is exactly what "random" looks like. So each axis
carries a closed-form bound (see _bound_*) for the amplitude at which antiphase
neighbours exactly touch, and every scene spends only SAFE of it. The nest can
then shear, breathe and pitch as hard as it likes and still never cross itself.

The offsets are CONSTANT IN WORLD UNITS, not constant on screen, and that is
load-bearing: both a gate's swing and its gap to the next one go as 1/z, so a
world-constant offset gives every gate the SAME swing-to-gap ratio. One number
governs the whole nest. Screen-constant offsets — the obvious choice — swing the
inner gates many times their own gap and scramble them.

Still honest 3D: six squares at real depths through a real pinhole camera, long
lens and stood well off, which flattens perspective back toward the graphic
reading of the reference frames while keeping the depth real. The glyph ramp
(dots -> dash -> hairline -> tube) carries outside-to-inside on its own.

Every scene rides ONE time curve, _wave: an ease-in-out-expo there-and-back
holding at both ends. Hold, snap, hold, snap back — staggered down the stack.
Each scene loops exactly on BEAT — except march, which takes four (it turns a
quarter per beat, so it needs four to come home).

    1  axis · depth   z. Gates surge toward you and back, in sequence — a
                      longitudinal wave running down the corridor
    2  axis · scale   size. The nest breathes, near to far, one gate at a time
    3  axis · slide   x. A lateral serpentine: the corridor shears sideways
    4  axis · rise    y. The same wave stood on end
    5  axis · tilt    pitch about x. Cards turning over in sequence
    6  axis · turn    yaw about y. The same, squashing the other way. (There
                      is no roll scene — see the note above TiltScene)
    7  axis · draw    the perimeter. Each gate's line runs around its own
                      square and its tail chases it home
    8  axis · march   the perimeter again: one short arc orbiting each square,
                      a quarter-turn a beat, staggered into a spiral. The one
                      scene whose loop is four beats rather than one
    9  axis · gap     the aperture. Each square opens and shuts in turn
    10 axis · weight  the stroke, and nothing else. A light pulse down the
                      stack — the whole nest still, only the ink moving
    11 axis · dolly   the one moving camera, on z alone. Its stagger is
                      parallax: near gates sweep further than far ones

Camera and stroke layer come from sq_space, square-path maths from sq_rings.
Run: `python sq_axis.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from sq_rings import _expo
from sq_space import Cam, _quad, _rot, UX, UY


# ---------------------------------------------------------------------------
# The one time curve in the file.
# ---------------------------------------------------------------------------
def _wave(ph):
    """One ease-in-out-expo there-and-back, period 1. Hold, snap out, hold,
    snap back. Every scene's single axis rides this and nothing else — which is
    what makes eleven different ideas feel like one hand made them."""
    u = ph - math.floor(ph)
    return _expo(u * 2.0) if u < 0.5 else 1.0 - _expo((u - 0.5) * 2.0)


class AxisScene(Scene):
    """Six gates, fixed depths, bolted camera. Subclasses move ONE thing."""

    NG = 6              # gates. Fixed set: none born, none culled
    Z0 = 4.00           # depth of the nearest gate
    RATIO = 1.26        # depth ratio per gate — perspective does the nesting
    R = 1.00            # gate half-size, world units
    FOV = 0.90          # long lens, stood well off: flat, graphic, framed
    FRAC = 0.42         # ...which lands the near gate at 42% of the half-frame
    WNEAR = 2.05        # stroke weight at the nearest gate
    BEAT = 1.60         # one full there-and-back
    LAG = 0.100         # phase lag per gate — THE stagger
    SAFE = 0.70         # fraction of each crossing bound a scene may spend

    # -- the crossing bounds ------------------------------------------------
    # Amplitude at which two antiphase neighbours exactly touch. Past these the
    # nest tears; every scene spends only SAFE of its own. All verified against
    # a brute-force search.
    @classmethod
    def _bound_shift(cls):
        """World offset whose screen swing equals the gap to the next gate.
        Swing and gap BOTH go as 1/z, so this single number holds for every
        gate at once — the reason offsets here are world-constant."""
        return cls.R * (1.0 - 1.0 / cls.RATIO)

    @classmethod
    def _bound_scale(cls):
        """(1-A)/(1+A) == 1/RATIO — a shrinking gate meeting a growing one."""
        return (cls.RATIO - 1.0) / (cls.RATIO + 1.0)

    @classmethod
    def _bound_depth(cls):
        """In slots: antiphase neighbours meet when one closes the whole slot."""
        return 0.50

    def _amp(self, which):
        return self.SAFE * getattr(self, "_bound_" + which)()

    # -- geometry -----------------------------------------------------------
    def _z(self, i):
        return self.Z0 * self.RATIO ** i

    def _cam(self, canvas, pos=(0.0, 0.0, 0.0)):
        return Cam(canvas, pos, fov=self.FOV, gain=self.WNEAR * self.Z0)

    def _v(self, i):
        """The staggered wave for gate i, 0..1. Later gates lag, so the front
        travels away from the eye, down the corridor."""
        return _wave(self.t / self.BEAT - i * self.LAG)

    def _s(self, i):
        """...and its symmetric form, -1..1."""
        return 2.0 * self._v(i) - 1.0

    def _gates(self):
        """Gate indices, far -> near, so the near ones stroke last."""
        return range(self.NG - 1, -1, -1)

    def draw(self, canvas):
        cam = self._cam(canvas)
        for i in self._gates():
            self._gate(canvas, cam, i)

    def _gate(self, canvas, cam, i):
        _quad(canvas, cam, (0.0, 0.0, self._z(i)), UX, UY, self.R, 1.0)

    def status(self):
        return self.name.split("·")[-1].strip().upper()


# ===========================================================================
# Translation — one axis each
# ===========================================================================
class DepthScene(AxisScene):
    name = "axis · depth"

    def _gate(self, canvas, cam, i):
        z = self.Z0 * self.RATIO ** (i + self._amp("depth") * self._s(i))
        _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, 1.0)


class ScaleScene(AxisScene):
    name = "axis · scale"

    def _gate(self, canvas, cam, i):
        r = self.R * (1.0 + self._amp("scale") * self._s(i))
        _quad(canvas, cam, (0.0, 0.0, self._z(i)), UX, UY, r, 1.0)


class SlideScene(AxisScene):
    name = "axis · slide"

    def _gate(self, canvas, cam, i):
        _quad(canvas, cam, (self._amp("shift") * self._s(i), 0.0, self._z(i)),
              UX, UY, self.R, 1.0)


class RiseScene(AxisScene):
    name = "axis · rise"

    def _gate(self, canvas, cam, i):
        _quad(canvas, cam, (0.0, self._amp("shift") * self._s(i), self._z(i)),
              UX, UY, self.R, 1.0)


# ===========================================================================
# Rotation — one axis each
# ===========================================================================
# There is no roll scene, and that is a finding rather than an oversight.
# Spinning concentric squares in their own plane has now failed three times
# across this thread — sq_rings' twist, sq_space's tumble, and here. The reason
# is specific: an in-plane roll makes every gate's sides non-parallel to its
# neighbour's, so the nest moires no matter how small the angle or how tight the
# stagger. Bounding the corners (cos A + sin A < RATIO) stops them CROSSING and
# still looks like a hash, because bounding extent is not the thing that reads.
#
# Rotating about an in-plane axis is a different animal and works fine: it
# foreshortens instead of spinning, so sides stay parallel to their neighbours'
# and the nest survives. Hence tilt and turn, and no roll.
class TiltScene(AxisScene):
    """Pitch, about x. No clean crossing bound exists — the gate leans INTO
    depth, so its near edge magnifies rather than simply growing. Held to a
    measured limit (_selfcheck pins the reach) instead of a solved one."""
    name = "axis · tilt"
    A = 0.45            # radians, ~26 degrees

    def _gate(self, canvas, cam, i):
        rx = self.A * self._s(i)
        _quad(canvas, cam, (0.0, 0.0, self._z(i)),
              _rot(UX, rx=rx), _rot(UY, rx=rx), self.R, 1.0)


class TurnScene(AxisScene):
    """Yaw, about y — tilt's other in-plane axis. Squashes horizontally where
    tilt squashes vertically."""
    name = "axis · turn"
    A = 0.45

    def _gate(self, canvas, cam, i):
        ry = self.A * self._s(i)
        _quad(canvas, cam, (0.0, 0.0, self._z(i)),
              _rot(UX, ry=ry), _rot(UY, ry=ry), self.R, 1.0)


# ===========================================================================
# The perimeter — the reference's own axis
# ===========================================================================
class DrawScene(AxisScene):
    """The line runs around its square, then its tail chases it home. Head and
    tail are the same expo half a cycle apart, so the loop closes exactly."""
    name = "axis · draw"

    def _gate(self, canvas, cam, i):
        u = (self.t / self.BEAT - i * self.LAG) % 1.0
        head = _expo(_clamp(u * 2.0, 0.0, 1.0))
        tail = _expo(_clamp(u * 2.0 - 1.0, 0.0, 1.0))
        if head > tail:
            _quad(canvas, cam, (0.0, 0.0, self._z(i)), UX, UY, self.R, 1.0,
                  tail, head)


class MarchScene(AxisScene):
    name = "axis · march"
    ARC = 0.30

    def _gate(self, canvas, cam, i):
        ph = self.t / self.BEAT - i * self.LAG
        k = math.floor(ph)
        a = 0.25 * (k + _expo(ph - k))             # a quarter-turn a beat
        z = self._z(i)
        _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, 0.26)   # the path
        _quad(canvas, cam, (0.0, 0.0, z), UX, UY, self.R, 1.0, a, a + self.ARC)


class GapScene(AxisScene):
    name = "axis · gap"
    A = 0.42

    def _gate(self, canvas, cam, i):
        h = self.A * (1.0 - self._v(i))
        _quad(canvas, cam, (0.0, 0.0, self._z(i)), UX, UY, self.R, 1.0,
              h, 1.0 - h)


# ===========================================================================
# The ink, and the one moving camera
# ===========================================================================
class WeightScene(AxisScene):
    """Nothing moves at all. The only animated quantity is stroke weight, run
    down the stack as a pulse — the glyph ramp used as the sole axis."""
    name = "axis · weight"

    def _gate(self, canvas, cam, i):
        _quad(canvas, cam, (0.0, 0.0, self._z(i)), UX, UY, self.R,
              0.30 + 1.30 * self._v(i))


class DollyScene(AxisScene):
    """The one scene that moves the camera, and only along z. Its stagger is not
    authored — it is parallax: for the same camera step the near gate sweeps far
    further than the far one, so the nest opens and closes in order by itself.
    The one place the rule is a consequence rather than a choice."""
    name = "axis · dolly"
    A = 0.70            # world units; _selfcheck pins what it costs in frame

    def draw(self, canvas):
        camz = self.A * (2.0 * _wave(self.t / self.BEAT) - 1.0)
        cam = self._cam(canvas, pos=(0.0, 0.0, camz))
        for i in self._gates():
            _quad(canvas, cam, (0.0, 0.0, self._z(i)), UX, UY, self.R, 1.0)


# ===========================================================================
# Framing budget — enforced, not trusted
# ===========================================================================
def _selfcheck():
    """The nearest gate sits at FRAC of the half-frame; every scene's worst
    reach must still leave real air. Runs on import."""
    b = AxisScene
    reach = {
        "depth":  b.FRAC * b.RATIO ** (b.SAFE * b._bound_depth()),
        "scale":  b.FRAC * (1.0 + b.SAFE * b._bound_scale()),
        "slide":  b.FRAC * (1.0 + b.SAFE * b._bound_shift() / b.R),
        "rise":   b.FRAC * (1.0 + b.SAFE * b._bound_shift() / b.R),
        "tilt":   b.FRAC * b.Z0 / (b.Z0 - b.R * math.sin(TiltScene.A)),
        "turn":   b.FRAC * b.Z0 / (b.Z0 - b.R * math.sin(TurnScene.A)),
        "dolly":  b.FRAC * b.Z0 / (b.Z0 - DollyScene.A),
    }
    for name, r in reach.items():
        assert r < 0.80, (
            "sq_axis: '%s' reaches %.0f%% of the half-frame — too little air. "
            "Lower its amplitude, SAFE, or FRAC." % (name, r * 100))
    return reach


_REACH = _selfcheck()


def make_scenes():
    return [
        DepthScene(),          # 1  z
        ScaleScene(),          # 2  size
        SlideScene(),          # 3  x
        RiseScene(),           # 4  y
        TiltScene(),           # 5  pitch about x
        TurnScene(),           # 6  yaw about y
        DrawScene(),           # 7  the perimeter, drawn on
        MarchScene(),          # 8  the perimeter, orbited
        GapScene(),            # 9  the aperture
        WeightScene(),         # 10 the ink alone
        DollyScene(),          # 11 the camera, on z
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
