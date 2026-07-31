#!/usr/bin/env python3
"""
hatch_cap — the hatched sphere (hatch_states scene 1) morphing into a 3D dad cap.

Same hatched-globe basis: a lat/long grid, each front-facing sample drawn as a
short horizontal scanline tick (`_dash`). A morph parameter m in [0,1] blends
each sample from its sphere position to a CAP position, reparametrised so the
surface stays continuous:

    • crown   (upper latitudes)          -> a rounded dome, barely moves
    • bill    (lower latitudes, FRONT)   -> swings outward + down into a visor
    • band    (lower latitudes, BACK)    -> tucks up into the headband rim

So the sphere's bottom half peels apart into the brim (front) and closes into
the band (back) while the top stays put — a believable sphere -> cap transition.
m eases in (expo), holds as a slowly rotating cap for most of the loop, eases
back out, and loops seamlessly. The whole thing yaws slowly the entire time, so
the cap always turns.
"""

import math

from mpp import Scene, _clamp
from scenes import _dash

TAU = 2.0 * math.pi


def _expo(x):
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


class HatchCapScene(Scene):
    name = "hatch · sphere -> cap"

    N_LAT = 40
    LON_MAX = 112
    LON_MIN = 48
    RADIUS_FRAC = 0.3
    FACE = 2.3            # base facing angle (rad): which way the bill points.
    #                       0 ~ bill to the right, ~1.6 toward the camera,
    #                       ~3.1 to the left, ~4.7 away. Wraps every 2*pi.
    SPIN = 0.35           # slow continuous yaw on top of FACE (rad/s); 0 = hold still
    TILT = 0.38           # slight look-down (keep the bill visible, not culled)
    FOCAL_FRAC = 8.0      # flatter perspective: stops the bill ballooning when it
    #                       swings toward the camera (that caused the "teardrop")
    DASH = 1.7
    EPS = 0.02

    CYCLE = 13.0
    IN0, IN1 = 0.10, 0.33     # morph sphere -> cap
    OUT0, OUT1 = 0.84, 1.0    # morph cap -> sphere (long cap hold between)

    # cap shape
    THETA_RIM = 0.5 * math.pi    # rim at the equator: crown = clean upper dome
    CROWN_SQ = 0.78              # crown vertical squash (a dome, not a ball)
    # bill = a broad flat D-visor. Every front-arc sample projects FORWARD (+X)
    # from its own point on the headband rim, so the bill's back edge IS the rim
    # (seamless attach) and its width is the full front arc — no pointy tongue.
    FRONT_ARC = 1.30            # half the front arc the bill spans (radians): width
    BILL_LEN = 0.62             # forward projection at the centre (unit radii)
    BILL_DROP = 0.30            # downward angle of the projecting bill
    BILL_CUP = 0.10             # front corners curl down a touch (a cupped bill)
    NOSE_FLAT = 0.55            # 0 = circular front, ->1 = flatter front, round corners
    # back adjuster gap: a rounded slot at the back-centre of the headband
    GAP_W = 0.5                 # half-arc of the gap (radians)
    GAP_UP = 0.34               # how far up into the crown the slot cuts
    GAP_DN = 0.5                # how far down into the tuck the slot cuts

    def _in_gap(self, theta, ph):
        """True if this sample is inside the back adjuster slot (skip it)."""
        back = math.pi - abs(ph)                         # 0 at the back centre
        if back >= self.GAP_W:
            return False
        prof = math.sqrt(1.0 - (back / self.GAP_W) ** 2)   # rounded slot ends
        return (self.THETA_RIM - self.GAP_UP * prof <= theta
                <= self.THETA_RIM + self.GAP_DN * prof)

    def _morph(self, t):
        u = (t % self.CYCLE) / self.CYCLE
        if u < self.IN0:
            return 0.0
        if u < self.IN1:
            return _smooth(_expo((u - self.IN0) / (self.IN1 - self.IN0)))
        if u < self.OUT0:
            return 1.0
        return 1.0 - _smooth(_expo((u - self.OUT0) / (self.OUT1 - self.OUT0)))

    def _cap(self, theta, ph, cosph, sinph, sx, sy, sz):
        """Cap position for this sample (sphere point sx,sy,sz given, ph in [-pi,pi])."""
        if theta <= self.THETA_RIM:
            return sx, sy * self.CROWN_SQ, sz            # crown dome
        # below the rim: everything tucks up onto the headband rim line, EXCEPT the
        # front arc, which projects forward off the rim into a flat D-shaped bill.
        r_rim = math.sin(self.THETA_RIM)
        y_rim = math.cos(self.THETA_RIM) * self.CROWN_SQ
        rimx, rimy, rimz = r_rim * cosph, y_rim, r_rim * sinph
        if abs(ph) >= self.FRONT_ARC:
            return rimx, rimy, rimz                      # sides / back: the headband
        # Bill: project this rim point straight FORWARD (+X). The forward reach is
        # scaled by `nose`, which -> 0 at the arc edges, so the side samples stay ON
        # the rim (seamless join) while the centre reaches out — a broad rounded D,
        # NOT a tapering tongue. `a` fills the plate from the rim back-edge forward.
        a = (theta - self.THETA_RIM) / (math.pi - self.THETA_RIM)   # 0 rim .. 1 deep
        b = ph / self.FRONT_ARC                                     # -1..1 across
        # flat-ish rounded front profile (superellipse): near 1 across the middle,
        # rolling to 0 only near the corners.
        nose = (1.0 - abs(b) ** (2.0 / (1.0 - self.NOSE_FLAT))) ** 0.5
        lift = a * nose                                             # 0 at rim & edges
        bx = rimx + self.BILL_LEN * lift                           # forward plate
        by = rimy - self.BILL_DROP * lift - self.BILL_CUP * b * b * lift
        bz = rimz                                                  # width follows rim
        return bx, by, bz

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx0, cy0 = wu / 2.0, hu / 2.0
        R = min(wu, hu) * self.RADIUS_FRAC
        t = self.t
        m = self._morph(t)
        yaw = self.FACE + t * self.SPIN
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        ct, st = math.cos(self.TILT), math.sin(self.TILT)
        focal = self.FOCAL_FRAC * R
        DASH = self.DASH
        for li in range(1, self.N_LAT):
            theta = math.pi * li / self.N_LAT
            sint, cost = math.sin(theta), math.cos(theta)
            nlon = max(self.LON_MIN, int(self.LON_MAX * sint))
            for j in range(nlon):
                phi = TAU * j / nlon
                cosph, sinph = math.cos(phi), math.sin(phi)
                sx, sy, sz = sint * cosph, cost, sint * sinph
                if m <= 0.0:
                    wx, wy, wz = sx, sy, sz
                else:
                    ph = phi - TAU if phi > math.pi else phi
                    if m > 0.5 and self._in_gap(theta, ph):
                        continue                          # the back adjuster slot
                    cx, cy, cz = self._cap(theta, ph, cosph, sinph, sx, sy, sz)
                    wx = sx + (cx - sx) * m
                    wy = sy + (cy - sy) * m
                    wz = sz + (cz - sz) * m
                x1 = wx * cyaw + wz * syaw               # yaw about Y
                z1 = -wx * syaw + wz * cyaw
                y2 = wy * ct - z1 * st                    # lean top toward camera
                z2 = wy * st + z1 * ct
                if z2 <= self.EPS:                        # front faces only
                    continue
                f = focal / (focal - z2 * R)
                px = cx0 + x1 * R * f
                py = cy0 - y2 * R * f
                half = DASH * f * (0.45 + 0.55 * z2)
                if half > 0.0:
                    _dash(canvas, px, py, half)

    def status(self):
        m = self._morph(self.t)
        return "SPHERE" if m < 0.02 else "CAP" if m > 0.98 else "MORPH"


def make_scenes():
    return [HatchCapScene()]


if __name__ == "__main__":
    import mpp

    mpp.main(make_scenes())
