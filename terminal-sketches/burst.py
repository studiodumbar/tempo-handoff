#!/usr/bin/env python3
"""
burst — sketches on the needle burst: long segmented rays pinched through a
central waist, like a bundle of straws crossing at one bright knot.

The reference render: a dozen thin rods radiating through a common crossing
point, each rod broken into dashes by little couplings, the whole system
tilted into a shallow X. Here that is a true 3D sheaf: every ray is a line
through EXACTLY the origin — one clean intersection point shared by all of
them — with a deterministic dash pattern along its length. The bundle is
sized so it always sits inside the frame with real negative space around
it; nothing crops off screen. Every sketch keeps the shape dynamic: rays
grow, flow, shoot, recoil, and stream past the camera; never a frozen prop.

    1  burst · bloom    rays draw themselves out of the knot, tip sparks
                        leading, hold, then fold back in — staggered expo
    2  burst · drift    idle hero: the dash pattern flows outward along
                        every ray, the sheaf slowly tumbling
    3  burst · sparks   tracers ride the rays through the waist; the knot
                        flares every time one crosses
    4  burst · spin     the whole sheaf tumbles end over end — the bowtie
                        opens into a starburst and closes again
    5  burst · flip     one expo beat per quarter-turn: bowtie, starburst,
                        bowtie — the sheaf snaps between its two readings
    6  burst · ping     a radial wavefront expands from the knot, lighting
                        every dash it passes — sonar through the bundle
    7  burst · recoil   the sheaf inhales toward the centre, charges, and
                        releases with a shock ring — one heartbeat per bar
    8  burst · volley   needles shoot themselves along their own axes
                        through the waist, a ghost of the sheaf behind them
    9  burst · thru     POV: an endless chain of knots streams past, each
                        oriented its own way — flying down the needle field

Deterministic geometry (hash-seeded), house ease-in-out-expo, seamless
loops. Depth does the styling: far rays are dotted whispers, near rays
double-stroked rods with coupling ticks. Run: `python burst.py`.
"""

import math
import sys

from mpp import Scene, _clamp
from serp_flux import Cam, _bead, _expo, _eout, _smooth, _seg_visible

TAU = 2.0 * math.pi
CENTER = (0.0, 0.0, 4.6)
N_RAYS = 13


def _h(i, j=0):
    """Deterministic hash -> [0, 1)."""
    n = (i * 2654435761 + j * 40503) & 0xFFFFFFFF
    n ^= n >> 13
    n = (n * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


def _mk_rays():
    """Rays as (cx, cy, cz, dx, dy, dz, L2, dashes). Every ray passes through
    the exact origin — one shared intersection point — and its first dash
    starts AT the point, so the crossing is clean. The dash pattern lives in
    q-space — distance from the crossing, 0..1 — and is mirrored to both
    halves, so anything that moves the pattern flows OUT of the knot."""
    rays = []
    ca, sa = math.cos(0.20), math.sin(0.20)        # the shared shallow tilt
    for i in range(N_RAYS):
        dx = 0.9 + 0.5 * _h(i, 1)
        dy = (_h(i, 2) - 0.5) * 1.60
        dz = (_h(i, 3) - 0.5) * 0.70
        n = 1.0 / math.sqrt(dx * dx + dy * dy + dz * dz)
        dx, dy, dz = dx * n, dy * n, dz * n
        dx, dy = dx * ca - dy * sa, dx * sa + dy * ca
        L2 = 1.35 + 0.55 * _h(i, 4)                # half-length, frame-safe
        q, j, dashes = 0.0, 0, []
        while q < 1.0:
            dl = 0.16 + 0.24 * _h(i, 20 + j)
            dashes.append((q, min(1.0, q + dl)))
            q += dl + 0.03 + 0.05 * _h(i, 40 + j)
            j += 1
        rays.append((0.0, 0.0, 0.0, dx, dy, dz, L2, tuple(dashes)))
    return rays


RAYS = _mk_rays()


def _ray_draw(canvas, cam, ray, w, grow=1.0, shift=0.0, slide=0.0,
              cy_=1.0, sy_=0.0, cp_=1.0, sp_=0.0, center=CENTER,
              zclip=None, hotR=None, ticks=True):
    """One ray: dashes in q-space, mirrored about the waist, optionally
    grown from the centre, pattern-shifted (flow), slid along its own axis
    (volley), sheaf-rotated, near-plane clipped, and wavefront-boosted."""
    if w <= 0.02 or grow <= 0.0:
        return
    ox, oy, oz, dx, dy, dz, L2, dashes = ray
    for qa0, qb0 in dashes:
        ln = qb0 - qa0
        qa = (qa0 + shift) % 1.0
        parts = [(qa, qa + ln)] if qa + ln <= 1.0 else \
            [(qa, 1.0), (0.0, qa + ln - 1.0)]
        for pa, pb in parts:
            pa, pb = max(pa, 0.0), min(pb, grow)
            if pb <= pa:
                continue
            wd = w
            if hotR is not None:                   # the expanding wavefront
                R, band, gain = hotR
                wd += gain * _clamp(
                    1.0 - abs((pa + pb) * 0.5 * L2 - R) / band, 0.0, 1.0)
            for sign in (1.0, -1.0):
                pts = []
                for q in (pa, pb):
                    x = ox + dx * (sign * q * L2 + slide)
                    y = oy + dy * (sign * q * L2 + slide)
                    z = oz + dz * (sign * q * L2 + slide)
                    x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
                    y, z = y * cp_ - z * sp_, y * sp_ + z * cp_
                    pts.append((x + center[0], y + center[1], z + center[2]))
                a, b = pts
                if zclip is not None:              # clip to the near plane
                    if a[2] < zclip and b[2] < zclip:
                        continue
                    if a[2] < zclip or b[2] < zclip:
                        lo, hi = (a, b) if a[2] < b[2] else (b, a)
                        e = (zclip - lo[2]) / (hi[2] - lo[2])
                        cut = (lo[0] + (hi[0] - lo[0]) * e,
                               lo[1] + (hi[1] - lo[1]) * e, zclip)
                        a, b = (cut, hi)
                pa_, pb_ = cam.project(*a), cam.project(*b)
                if pa_ is None or pb_ is None or pa_[2] > 150 or pb_[2] > 150:
                    continue
                if not _seg_visible(cam, pa_, pb_):
                    continue
                if abs(pa_[0] - pb_[0]) + abs(pa_[1] - pb_[1]) > 110:
                    continue
                lvl = wd * (pa_[2] + pb_[2]) * 0.5
                if lvl < 2.6:                      # deep: a single whisper
                    canvas.set_dot(pa_[0], pa_[1])
                    continue
                if lvl < 8.5:                      # far: dotted endpoints
                    canvas.set_dot(pa_[0], pa_[1])
                    canvas.set_dot(pb_[0], pb_[1])
                    continue
                ddx, ddy = pb_[0] - pa_[0], pb_[1] - pa_[1]
                dl = math.hypot(ddx, ddy) or 1.0
                nx, ny = -ddy / dl, ddx / dl
                if lvl < 22.0 or pa < 0.14:        # rods pinch to a single
                    canvas.line(pa_[0], pa_[1], pb_[0], pb_[1])   # clean point
                else:                              # near: a double-stroked rod
                    canvas.line(pa_[0] + nx * 0.55, pa_[1] + ny * 0.55,
                                pb_[0] + nx * 0.55, pb_[1] + ny * 0.55)
                    canvas.line(pa_[0] - nx * 0.55, pa_[1] - ny * 0.55,
                                pb_[0] - nx * 0.55, pb_[1] - ny * 0.55)
                if ticks and lvl >= 15.0 and pa >= 0.14:   # the coupling tick
                    canvas.line(pa_[0] - nx * 1.3, pa_[1] - ny * 1.3,
                                pa_[0] + nx * 1.3, pa_[1] + ny * 1.3)


def _ray_pt(ray, q, sign, slide=0.0, cy_=1.0, sy_=0.0, cp_=1.0, sp_=0.0,
            center=CENTER):
    ox, oy, oz, dx, dy, dz, L2, _ = ray
    x = ox + dx * (sign * q * L2 + slide)
    y = oy + dy * (sign * q * L2 + slide)
    z = oz + dz * (sign * q * L2 + slide)
    x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
    y, z = y * cp_ - z * sp_, y * sp_ + z * cp_
    return (x + center[0], y + center[1], z + center[2])


def _ring(canvas, cam, r, cy_=1.0, sy_=0.0, cp_=1.0, sp_=0.0, center=CENTER):
    for k in range(0, 44, 2):
        a = TAU * k / 44
        x, y, z = r * math.cos(a), r * math.sin(a), 0.0
        x, z = x * cy_ + z * sy_, -x * sy_ + z * cy_
        y, z = y * cp_ - z * sp_, y * sp_ + z * cp_
        p = cam.project(x + center[0], y + center[1], z + center[2])
        if p:
            canvas.set_dot(p[0], p[1])


class BurstScene(Scene):
    def _bcam(self, canvas, px=0.0, py=0.04, yaw=0.0, pitch=-0.01):
        t = self.t
        return Cam(canvas,
                   (px + 0.06 * math.sin(t * 0.34),
                    py + 0.04 * math.sin(t * 0.21), 0.0),
                   yaw=yaw, pitch=pitch + 0.010 * math.sin(t * 0.27),
                   fov=0.8)

    def _knot(self, canvas, cam, k=1.0):
        _bead(canvas, cam.project(*CENTER), 0.5 * k)


# ===========================================================================
# 1 — BLOOM  (rays draw out of the knot, hold, fold back in)
# ===========================================================================
class BurstBloomScene(BurstScene):
    name = "burst · bloom"
    CYCLE = 6.5

    def draw(self, canvas):
        t = self.t
        u = (t % self.CYCLE) / self.CYCLE
        cam = self._bcam(canvas, yaw=0.05 * math.sin(t * 0.4))
        self._knot(canvas, cam, 1.7 + 0.4 * math.sin(t * 2.1))
        for i, ray in enumerate(RAYS):
            tk = 0.03 + 0.42 * _h(i, 9)
            gi = _expo(_clamp((u - tk) / 0.26, 0.0, 1.0))
            fo = _expo(_clamp((u - 0.74 - 0.14 * _h(i, 9)) / 0.12, 0.0, 1.0))
            grow = max(0.05, gi * (1.0 - fo))      # folds to a seed, never gone
            _ray_draw(canvas, cam, ray, 0.55, grow=grow)
            if 0.05 < grow < 0.97:                 # the tip sparks, leading
                for sign in (1.0, -1.0):
                    _bead(canvas, cam.project(*_ray_pt(ray, grow, sign)), 0.5)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        return "BLOOM" if u < 0.5 else "HOLD" if u < 0.74 else "FOLD"


# ===========================================================================
# 2 — DRIFT  (idle: the dash pattern flows outward, the sheaf tumbles)
# ===========================================================================
class BurstDriftScene(BurstScene):
    name = "burst · drift"

    def draw(self, canvas):
        t = self.t
        yaw, pit = 0.25 * math.sin(t * 0.11), 0.12 * math.sin(t * 0.09)
        cy_, sy_ = math.cos(yaw), math.sin(yaw)
        cp_, sp_ = math.cos(pit), math.sin(pit)
        cam = self._bcam(canvas)
        self._knot(canvas, cam, 0.9 + 0.3 * math.sin(t * 1.4))
        for i, ray in enumerate(RAYS):
            _ray_draw(canvas, cam, ray, 0.5 + 0.10 * math.sin(t * 0.8 + i),
                      shift=t * 0.06, cy_=cy_, sy_=sy_, cp_=cp_, sp_=sp_)

    def status(self):
        return "DRIFT"


# ===========================================================================
# 3 — SPARKS  (tracers ride the rays through the waist; the knot flares)
# ===========================================================================
class BurstSparksScene(BurstScene):
    name = "burst · sparks"
    N_TR = 5
    PER = 2.6

    def draw(self, canvas):
        t = self.t
        cam = self._bcam(canvas)
        traced = {}
        flare = 0.0
        for k in range(self.N_TR):
            ph = (t / self.PER + _h(k, 61)) % 1.0
            ri = (k * 3 + int(t / self.PER + _h(k, 61))) % N_RAYS
            s = -1.12 + 2.24 * ph                  # tip -> waist -> far tip
            q, sign = abs(s), 1.0 if s >= 0 else -1.0
            if q <= 1.0:
                _bead(canvas, cam.project(*_ray_pt(RAYS[ri], q, sign)), 0.85)
                traced[ri] = q * RAYS[ri][6]       # a glint at its radius
            flare = max(flare, _clamp(1.0 - abs(s) / 0.08, 0.0, 1.0))
        for i, ray in enumerate(RAYS):
            hot = traced.get(i)
            _ray_draw(canvas, cam, ray, 0.42,
                      hotR=(hot, 0.40, 1.0) if hot is not None else None)
        self._knot(canvas, cam, 0.8 + 1.6 * flare)
        if flare > 0.55:
            _ring(canvas, cam, 0.25 + 0.5 * (1.0 - flare))

    def status(self):
        return "SPARK"


# ===========================================================================
# 4 — SPIN  (the sheaf tumbles: bowtie -> starburst -> bowtie)
# ===========================================================================
class BurstSpinScene(BurstScene):
    name = "burst · spin"

    def draw(self, canvas):
        t = self.t
        yaw, pit = t * 0.45, 0.32 * math.sin(t * 0.21)
        cy_, sy_ = math.cos(yaw), math.sin(yaw)
        cp_, sp_ = math.cos(pit), math.sin(pit)
        cam = self._bcam(canvas)
        self._knot(canvas, cam)
        for i, ray in enumerate(RAYS):
            _ray_draw(canvas, cam, ray, 0.5 + 0.12 * math.sin(t * 1.6 + i * 1.3),
                      cy_=cy_, sy_=sy_, cp_=cp_, sp_=sp_)

    def status(self):
        return "SPIN"


# ===========================================================================
# 5 — FLIP  (one expo beat per quarter-turn between the two readings)
# ===========================================================================
class BurstFlipScene(BurstScene):
    name = "burst · flip"
    BEAT = 1.7

    def draw(self, canvas):
        t = self.t
        k = int(t / self.BEAT)
        fr = t / self.BEAT - k
        yaw = (k + _expo(fr)) * (math.pi / 2.0)    # snap a quarter-turn
        cy_, sy_ = math.cos(yaw), math.sin(yaw)
        cam = self._bcam(canvas)
        self._knot(canvas, cam, 0.8 + 0.8 * math.sin(math.pi * fr))
        for ray in RAYS:
            _ray_draw(canvas, cam, ray, 0.55, cy_=cy_, sy_=sy_)

    def status(self):
        return "AXIS" if int(self.t / self.BEAT) % 2 else "BOWTIE"


# ===========================================================================
# 6 — PING  (a radial wavefront lights every dash it passes)
# ===========================================================================
class BurstPingScene(BurstScene):
    name = "burst · ping"
    PER = 2.4

    def draw(self, canvas):
        t = self.t
        pu = (t % self.PER) / self.PER
        R = _eout(pu) * 3.2
        cam = self._bcam(canvas, yaw=0.04 * math.sin(t * 0.3))
        self._knot(canvas, cam, 1.6 * (1.0 - _smooth(pu / 0.25)) + 0.6)
        for ray in RAYS:
            _ray_draw(canvas, cam, ray, 0.35, hotR=(R, 0.42, 0.95))
        if 0.04 < pu < 0.8:                        # the wavefront itself,
            _ring(canvas, cam, min(R * 0.85, 1.75))   # held inside the frame

    def status(self):
        return "PING"


# ===========================================================================
# 7 — RECOIL  (inhale toward the knot, charge, release with a shock ring)
# ===========================================================================
class BurstRecoilScene(BurstScene):
    name = "burst · recoil"
    CYCLE = 2.3

    def draw(self, canvas):
        t = self.t
        pu = (t % self.CYCLE) / self.CYCLE
        charge = _expo(_clamp(pu / 0.55, 0.0, 1.0))
        release = _eout(_clamp((pu - 0.55) / 0.22, 0.0, 1.0))
        grow = 1.0 - 0.42 * charge + 0.47 * release
        cam = self._bcam(canvas, py=0.16,
                         pitch=-0.03 - 0.01 * charge)
        cam.pz = 0.22 * charge * (1.0 - release)   # lean in during the charge
        self._knot(canvas, cam, 0.6 + 1.4 * charge * (1.0 - release))
        for ray in RAYS:
            _ray_draw(canvas, cam, ray, 0.45 + 0.35 * charge * (1 - release),
                      grow=min(1.0, grow))
        if 0.55 < pu < 0.85:
            _ring(canvas, cam,
                  min(0.2 + _eout((pu - 0.55) / 0.30) * 2.6, 1.75))

    def status(self):
        return "CHARGE" if (self.t % self.CYCLE) / self.CYCLE < 0.55 else "BURST"


# ===========================================================================
# 8 — VOLLEY  (needles shoot themselves through the waist, one by one)
# ===========================================================================
class BurstVolleyScene(BurstScene):
    name = "burst · volley"
    PER = 3.0

    def draw(self, canvas):
        t = self.t
        cam = self._bcam(canvas)
        for ray in RAYS:                           # the ghost of the sheaf
            _ray_draw(canvas, cam, ray, 0.14, ticks=False)
        flare = 0.0
        for i, ray in enumerate(RAYS):
            ph = (t / self.PER + _h(i, 11)) % 1.0
            if ph >= 0.55:
                continue
            reach = ray[6] * 0.40 + 0.10           # tips never leave the frame
            slide = reach * (2.0 * _expo(ph / 0.55) - 1.0)
            edge = min(_smooth(ph / 0.06), _smooth((0.55 - ph) / 0.06))
            _ray_draw(canvas, cam, ray, 0.9 * edge, slide=slide)
            flare = max(flare, _clamp(1.0 - abs(slide) / 0.35, 0.0, 1.0))
        self._knot(canvas, cam, 0.5 + 1.5 * flare)

    def status(self):
        return "VOLLEY"


# ===========================================================================
# 9 — THRU  (POV: an endless chain of knots streams past the camera)
# ===========================================================================
class BurstThruScene(BurstScene):
    name = "burst · thru"
    SPACING = 6.5                                  # farther apart than a needle
    SPEED = 1.6

    def draw(self, canvas):
        t = self.t
        cam = Cam(canvas, (0.06 * math.sin(t * 0.5),
                           0.10 + 0.05 * math.sin(t * 0.33), 0.0),
                  pitch=0.012 * math.sin(t * 0.4))
        m = math.floor(t * self.SPEED / self.SPACING)
        for j in (3, 2, 1, 0):                     # far -> near knots
            n = m + j
            cz = (j + 1) * self.SPACING - (t * self.SPEED) % self.SPACING + 0.3
            ctr = ((_h(n, 1) - 0.5) * 1.0, 0.05 + (_h(n, 2) - 0.5) * 0.5, cz)
            yaw = _h(n, 3) * math.pi + t * 0.06
            cy_, sy_ = math.cos(yaw), math.sin(yaw)
            w = (0.50 * _clamp((cz - 3.2) / 1.4, 0.0, 1.0) *
                 _clamp((14.0 - cz) / 3.0, 0.0, 1.0))   # dissolve before the
            # bundle can reach the frame edges, and before the deep blur
            if w <= 0.02:
                continue
            for ray in RAYS:
                _ray_draw(canvas, cam, ray, w, grow=0.75, cy_=cy_, sy_=sy_,
                          center=ctr, zclip=0.5, shift=t * 0.04)
            _bead(canvas, cam.project(*ctr), 1.4 * w)

    def status(self):
        return "THRU %02d" % (math.floor(self.t * self.SPEED / self.SPACING) % 100)


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        BurstBloomScene(),     # 1  grow out of the knot, fold back
        BurstDriftScene(),     # 2  idle outward dash flow
        BurstSparksScene(),    # 3  tracers through the waist
        BurstSpinScene(),      # 4  the tumbling sheaf
        BurstFlipScene(),      # 5  quarter-turn snaps
        BurstPingScene(),      # 6  radial sonar wavefront
        BurstRecoilScene(),    # 7  inhale / shock-ring heartbeat
        BurstVolleyScene(),    # 8  needles shooting the knot
        BurstThruScene(),      # 9  POV down the knot chain
    ]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
