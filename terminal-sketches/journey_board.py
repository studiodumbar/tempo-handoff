#!/usr/bin/env python3
"""
journey_board — a commerce flow as a Figma board you pan across, step by step.

The opposite of a zero-g star-flight: there is no dust, no constellation, no
sense of floating in a void. Instead each step is its OWN thing — a big, macro
composition sitting alone on a black board with negative space all around it.
You park on one, it holds; then a decision is made (we just guess the user's
input) and the camera PANS in that direction to the next step. A chosen-path cue
shoots off toward wherever we're headed, so the move means something.

The assets are a mix — not all spheres:

    idle      a hatched sphere            (the hero you start on)
    search    a ruled grid, scanning
    browse    concentric tilted ellipses  ] the two branches off `search`
    refine    a rotating wireframe cube    ]
    select    a gyroscope of rings
    cart      a tally of block columns     ] the two branches off `select`
    pay       an orbit with a locking bead ]
    done      a radial burst, then a bloom that resets to idle

Two branch points (search -> browse/refine, select -> cart/pay) mean each loop
takes one of four routes, so the "decision" lands differently each time. Short:
six legs a loop. Strong ease-in-out-expo on every pan. Paced by hatch_grid's 60fps
explorer. Run: `python journey_board.py`.
"""

import math
import sys

from mpp import Scene, _clamp, EASE, EASE_BACK
from scenes import _dash

TAU = 2.0 * math.pi


# ---- easings --------------------------------------------------------------
def _expo_io(x):
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    return 0.5 * 2.0 ** (20.0 * x - 10.0) if x < 0.5 \
        else 1.0 - 0.5 * 2.0 ** (-20.0 * x + 10.0)


def _eout(x):
    if x <= 0.0:
        return 0.0
    return 1.0 if x >= 1.0 else 1.0 - 2.0 ** (-10.0 * x)


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _norm2(dx, dy):
    m = math.hypot(dx, dy) or 1.0
    return dx / m, dy / m


# ===========================================================================
# The board — nodes at fixed positions, a small decision graph, a repeating
# route that branches. Board units: 1.0 ~ a bit over one frame, so a parked
# step's neighbours sit fully off-screen (that is the negative space).
# ===========================================================================
POS = {
    "idle":   (0.0, 0.0),
    "search": (1.5, 0.0),
    "browse": (3.0, -1.15),
    "refine": (3.0, 1.15),
    "select": (4.5, 0.0),
    "cart":   (6.0, -1.15),
    "pay":    (6.0, 1.15),
    "done":   (7.5, 0.0),
}
KIND = {"idle": "sphere", "search": "grid", "browse": "ellipses",
        "refine": "wire", "select": "rings", "cart": "stack",
        "pay": "orbit", "done": "burst"}
STATUS = {"idle": "IDLE", "search": "SEARCHING", "browse": "BROWSING",
          "refine": "REFINING", "select": "SELECTING", "cart": "IN CART",
          "pay": "PAYING", "done": "CONFIRMED"}
ADJ = {"idle": ["search"], "search": ["browse", "refine"],
       "browse": ["select"], "refine": ["select"],
       "select": ["cart", "pay"], "cart": ["done"], "pay": ["done"],
       "done": ["idle"]}

DWELL = 2.0            # seconds parked on a step
TRAVEL = 1.15         # seconds panning to the next
NLEG = 6              # legs per loop: idle search branch select branch done


def _route(loop):
    """The six steps of loop `loop`. The two branches are chosen from the loop
    index, so all four route combinations cycle through (our 'guessed' input)."""
    b1 = "browse" if not (loop & 1) else "refine"
    b2 = "cart" if not (loop & 2) else "pay"
    return ["idle", "search", b1, "select", b2, "done"]


# ===========================================================================
# Asset draws — each a self-contained macro composition centred at (cx, cy),
# radius R, animating on its own small loop. foc in [0,1] = how centred/in-focus
# the step is (1 when parked, ->0 as it slides off the board).
# ===========================================================================
def _a_sphere(canvas, cx, cy, R, t, foc):
    yaw, tilt = t * 0.32, 0.5
    cyaw, syaw = math.cos(yaw), math.sin(yaw)
    ct, st = math.cos(tilt), math.sin(tilt)
    breath = 1.0 + 0.03 * math.sin(t * 0.8)
    NL, LM = 24, 60
    for li in range(1, NL):
        th = math.pi * li / NL
        sth, cth = math.sin(th), math.cos(th)
        nlon = max(6, int(LM * sth))
        for j in range(nlon):
            ph = TAU * j / nlon
            ux, uy, uz = sth * math.cos(ph), cth, sth * math.sin(ph)
            x1 = ux * cyaw + uz * syaw
            z1 = -ux * syaw + uz * cyaw
            y2 = uy * ct - z1 * st
            z2 = uy * st + z1 * ct
            if z2 <= 0.06:
                continue
            px = cx + x1 * R * breath
            py = cy - y2 * R * breath
            _dash(canvas, px, py, R * 0.035 * (0.45 + 0.55 * z2))


def _a_grid(canvas, cx, cy, R, t, foc):
    NC, NR = 6, 4
    x0, x1 = cx - R, cx + R
    y0, y1 = cy - R * 0.66, cy + R * 0.66
    step = 3.2
    for r in range(NR + 1):                       # horizontal rules
        yy = y0 + (y1 - y0) * r / NR
        x = x0
        while x <= x1:
            canvas.set_dot(x, yy)
            x += step
    for c in range(NC + 1):                       # vertical rules
        xx = x0 + (x1 - x0) * c / NC
        y = y0
        while y <= y1:
            canvas.set_dot(xx, y)
            y += step
    scan = x0 + (x1 - x0) * _smooth((t * 0.5) % 1.0)   # a scan bar crossing
    y = y0
    while y <= y1:
        canvas.set_dot(scan, y)
        canvas.set_dot(scan + 1, y)
        y += 1.6


def _a_ellipses(canvas, cx, cy, R, t, foc):
    spin, sq = t * 0.5, 0.5
    for i in range(4):
        r = R * (0.34 + 0.66 * i / 3.0)
        n = max(16, int(r * 0.55))
        for k in range(n):
            a = TAU * k / n + spin * (0.5 + i * 0.22)
            canvas.set_dot(cx + r * math.cos(a), cy + r * sq * math.sin(a))
    canvas.rect_fill(cx, cy, R * 0.22, R * 0.22 * sq)   # embossed core


_CUBE_V = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
_CUBE_E = [(i, j) for i in range(8) for j in range(i + 1, 8)
           if bin(i ^ j).count("1") == 1]


def _a_wire(canvas, cx, cy, R, t, foc):
    yaw, pit = t * 0.5, t * 0.32
    cy_, sy_ = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pit), math.sin(pit)
    s = R * 0.6
    proj = []
    for (x, y, z) in _CUBE_V:
        x1 = x * cy_ + z * sy_
        z1 = -x * sy_ + z * cy_
        y2 = y * cp - z1 * sp
        proj.append((cx + x1 * s, cy - y2 * s))
    for (i, j) in _CUBE_E:
        ax, ay = proj[i]
        bx, by = proj[j]
        n = max(2, int(math.hypot(bx - ax, by - ay) / 3.0))
        for k in range(n + 1):
            e = k / n
            canvas.set_dot(ax + (bx - ax) * e, ay + (by - ay) * e)


def _a_rings(canvas, cx, cy, R, t, foc):
    r = R * 0.86
    for i in range(3):                            # three rings, tumbling
        yaw = t * (0.4 + 0.2 * i) + i * 1.1
        pit = t * 0.3 + i * 2.0
        cy_, sy_ = math.cos(yaw), math.sin(yaw)
        cp, sp = math.cos(pit), math.sin(pit)
        n = max(24, int(r * 0.7))
        for k in range(n):
            a = TAU * k / n
            x, y, z = math.cos(a) * r, math.sin(a) * r, 0.0
            x1 = x * cy_ + z * sy_
            z1 = -x * sy_ + z * cy_
            y2 = y * cp - z1 * sp
            canvas.set_dot(cx + x1, cy - y2)


def _a_stack(canvas, cx, cy, R, t, foc):
    cols = 7
    bw = 2.0 * R / cols
    colw = bw * 0.6
    base = cy + R * 0.66
    segh = (R * 1.3) / 8.0
    x0 = cx - R + bw * 0.5
    for c in range(cols):
        phase = t * 2.4 + c * 0.7
        h = 2 + int(3.0 + 3.0 * (0.5 + 0.5 * math.sin(phase)))
        xx = x0 + c * bw
        for k in range(h):
            canvas.rect_fill(xx, base - (k + 0.5) * segh, colw, segh * 0.8)
    canvas.line(x0 - bw * 0.5, base + 1, x0 + bw * (cols - 0.5), base + 1)


def _a_orbit(canvas, cx, cy, R, t, foc):
    r = R * 0.8
    n = max(30, int(r * 0.8))                     # the orbit ring
    for k in range(n):
        a = TAU * k / n
        canvas.set_dot(cx + r * math.cos(a), cy + r * math.sin(a))
    a0 = t * 2.0                                  # a bead riding the ring
    canvas.rect_fill(cx + r * math.cos(a0), cy + r * math.sin(a0), 4, 4)
    for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):   # a locking bracket
        gx, gy = cx + sx * R * 0.34, cy + sy * R * 0.34
        canvas.line(gx, gy, gx - sx * R * 0.14, gy)
        canvas.line(gx, gy, gx, gy - sy * R * 0.14)


def _a_burst(canvas, cx, cy, R, t, foc):
    u = (t * 0.8) % 1.0
    rr = R * _eout(u)                             # an expanding shockwave ring
    if 0.02 < u < 0.98:
        n = int(60 * (1.0 - u)) + 16
        for k in range(n):
            a = TAU * k / n
            canvas.set_dot(cx + rr * math.cos(a), cy + rr * math.sin(a))
    for k in range(12):                           # steady rays
        a = TAU * k / 12 + t * 0.2
        r0, r1 = R * 0.16, R * 0.5
        steps = 6
        for s in range(steps):
            e = s / steps
            r = r0 + (r1 - r0) * e
            canvas.set_dot(cx + r * math.cos(a), cy + r * math.sin(a))
    canvas.rect_fill(cx, cy, 6, 6)                # committed core


_DRAW = {"sphere": _a_sphere, "grid": _a_grid, "ellipses": _a_ellipses,
         "wire": _a_wire, "rings": _a_rings, "stack": _a_stack,
         "orbit": _a_orbit, "burst": _a_burst}


# ===========================================================================
# The decision cue — a chosen path shooting toward the next step, plus faint
# stubs for the branch not taken. Drawn while parked, leading into the pan.
# ===========================================================================
def _draw_cue(canvas, cx, cy, R, cur, nxt, options, q):
    for o in options:
        dx, dy = POS[o][0] - POS[cur][0], POS[o][1] - POS[cur][1]
        d = _norm2(dx, dy)
        chosen = (o == nxt)
        lo = R * 1.15
        hi = R * (1.95 if chosen else 1.5)
        gap = 2.6 if chosen else 5.0             # sparser dots for the road not taken
        r = lo
        while r <= hi:
            canvas.set_dot(cx + d[0] * r, cy + d[1] * r)
            r += gap
        if chosen:                                # a bead shoots off toward it
            rr = lo + (hi - lo + R * 0.6) * q
            canvas.rect_fill(cx + d[0] * rr, cy + d[1] * rr, 3.0, 3.0)


def _flood_disc(canvas, bx, by, r):
    """Solid white disc into the half-block layer — the reset bloom."""
    if r <= 0.0:
        return
    cols, rows = canvas.cols, canvas.rows
    half = canvas.half
    r2 = r * r
    hy0 = max(0, int((by - r) // 2))
    hy1 = min(rows * 2 - 1, int((by + r) // 2))
    hx0 = max(0, int((bx - r) // 2))
    hx1 = min(cols - 1, int((bx + r) // 2))
    for hy in range(hy0, hy1 + 1):
        dy = (hy * 2 + 1) - by
        row = half[hy >> 1]
        bit = 1 if (hy & 1) == 0 else 2
        dy2 = dy * dy
        for hx in range(hx0, hx1 + 1):
            dx = (hx * 2 + 1) - bx
            if dx * dx + dy2 <= r2:
                row[hx] |= bit


# ===========================================================================
# The scene
# ===========================================================================
class JourneyBoardScene(Scene):
    name = "journey · board"

    def _state(self, t):
        """(cur, nxt, bx, by, in_dwell, legt, leg, flash)."""
        leg_len = DWELL + TRAVEL
        loop_len = NLEG * leg_len
        loop = int(t // loop_len)
        lt = t % loop_len
        leg = int(lt // leg_len)
        legt = lt % leg_len
        in_dwell = legt < DWELL
        rt = 0.0 if in_dwell else (legt - DWELL) / TRAVEL
        route = _route(loop)
        cur = route[leg]
        nxt = route[leg + 1] if leg < NLEG - 1 else "idle"
        flash = 0.0
        if leg == NLEG - 1 and not in_dwell:      # done -> idle: a bloom reset
            flash = math.sin(math.pi * rt)
            bx, by = POS["done"] if rt < 0.5 else POS["idle"]
        elif in_dwell:
            bx, by = POS[cur]
        else:
            e = _expo_io(rt)
            a, b = POS[cur], POS[nxt]
            bx, by = a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e
        return cur, nxt, bx, by, in_dwell, legt, leg, flash

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        span = min(wu, hu) * 1.18                  # board unit -> braille units
        R = min(wu, hu) * 0.26                     # macro asset radius
        t = self.t
        cur, nxt, bx, by, in_dwell, legt, leg, flash = self._state(t)

        if flash >= 0.92:                          # fully bloomed: skip the render
            _flood_disc(canvas, cx, cy, math.hypot(wu, hu))
            return

        # draw whichever steps are near the viewport (usually one; two mid-pan)
        for name, (nx, ny) in POS.items():
            sx = cx + (nx - bx) * span
            sy = cy + (ny - by) * span
            d = math.hypot((sx - cx) / wu, (sy - cy) / hu)
            foc = _smooth(1.0 - d / 1.05)          # visible while it slides past,
            if foc <= 0.02:                         # alone (neighbours off) when parked
                continue
            reff = R * (0.7 + 0.3 * foc)
            _DRAW[KIND[name]](canvas, sx, sy, reff, t, foc)

        # the decision cue leads out of the current step toward the next
        if in_dwell and legt > DWELL * 0.5 and leg < NLEG - 1:
            q = _smooth((legt - DWELL * 0.5) / (DWELL * 0.5))
            _draw_cue(canvas, cx, cy, R, cur, nxt, ADJ.get(cur, []), q)

        if flash > 0.01:                           # the reset bloom growing/receding
            _flood_disc(canvas, cx, cy, math.hypot(wu, hu) * flash)

    def status(self):
        return STATUS[self._state(self.t)[0]]


def make_scenes():
    return [JourneyBoardScene()]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
