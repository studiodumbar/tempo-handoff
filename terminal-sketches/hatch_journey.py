#!/usr/bin/env python3
"""
hatch_journey — one continuous flight through a commerce flow, in zero gravity.

Not a spinner and not a morph-in-place: this is a single SCENE that FLIES. A
free look-at camera drifts through a 3D constellation of "stations", each one a
distinct agent state living at its own place in space. You start staring into
the signature hatched sphere; the camera then banks left, right, up and down —
a Figma board you travel across rather than a terminal that scrolls — dollying
in until a station fills the frame and pulling back out as the next one grows
from a far speck. The animation is what leads you from x to y.

The flow reads as a purchase journey, each leg a real transition of scale/space:

    idle       a hatched sphere, breathing            (the hero you begin on)
    searching  a bright meridian rakes the surface    (bank right, pull back)
    querying   query rings pulse off toward the next  (swing left + up)
    processing concentric hatch-bands boil outward    (right + down, we orbit)
    loading    a fill tide floods the sphere — ZOOM   (dive in close)
    defining   the sphere unpacks into a ruled grid   (pull WAY back to read it)
    purchasing particles spiral into a bright core    (drop down + left)
    confirmed  a bloom: swell, flash, shockwave ring  (rise into the light)

...then the light whites out and we emerge on the hero sphere again — a seamless
loop. Everything is drawn in the mpp vocabulary: every surface sample is one
short horizontal `_dash` tick, sized by perspective and shaded by how squarely
it faces the moving camera, so a cloud of ticks reads as a lit, solid, hatched
body from any angle. A sparse dust field gives the flight its parallax.

Same engine ideas as the hatch_* family (HatchScene's dash sphere, hatch_grid's
morph, sphere_states' overlays) but re-hosted under a true flying camera instead
of a fixed one. Paced by hatch_grid's steady 60fps explorer.
Run standalone: `python hatch_journey.py`.
"""

import math
import random
import sys

from mpp import Scene, _clamp, EASE, EASE_BACK, GENTLE
from scenes import _dash

TAU = 2.0 * math.pi
HALF_PI = math.pi / 2.0


# ===========================================================================
# Easing / shaping helpers
# ===========================================================================
def _expo_io(x):
    """easeInOutExpo — dead-flat at both ends, whips through the middle."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if x < 0.5:
        return 0.5 * (2.0 ** (20.0 * x - 10.0))
    return 1.0 - 0.5 * (2.0 ** (-20.0 * x + 10.0))


def _expo_i(x):
    """easeInExpo — creeps, then accelerates away (a fall into the bloom)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    return 2.0 ** (10.0 * x - 10.0)


def _smooth(x):
    x = _clamp(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _gauss(x, w):
    return math.exp(-(x * x) / w)


def _clamp01(x):
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _lerp(a, b, e):
    return a + (b - a) * e


def _lerp3(a, b, e):
    return (a[0] + (b[0] - a[0]) * e,
            a[1] + (b[1] - a[1]) * e,
            a[2] + (b[2] - a[2]) * e)


# ===========================================================================
# Tiny 3D vector helpers
# ===========================================================================
def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _norm(a):
    m = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) or 1.0
    return (a[0] / m, a[1] / m, a[2] / m)


# ===========================================================================
# The flying camera — a look-at pinhole. World lengths at depth z map to
# `PROJ / z` braille units on screen, which is the number every mark is sized by
# so things genuinely grow as we approach and shrink as we leave.
# ===========================================================================
NEAR = 0.30            # near clip (world units in front of the eye)
FOV_K = 1.05           # projection gain -> a radius~0.9 body fills ~1/3 frame at d~3


class Camera:
    __slots__ = ("pos", "right", "up", "fwd", "proj", "cx", "cy")

    def __init__(self, pos, look, roll, proj, cx, cy):
        self.pos = pos
        self.proj = proj
        self.cx = cx
        self.cy = cy
        fwd = _norm(_sub(look, pos))
        # world-up (0,1,0); guard the degenerate straight-up/down look
        wup = (0.0, 1.0, 0.0)
        if abs(fwd[1]) > 0.997:
            wup = (0.0, 0.0, 1.0)
        right = _norm(_cross(wup, fwd))
        up = _cross(fwd, right)
        if roll:                                   # bank in the right/up plane
            ca, sa = math.cos(roll), math.sin(roll)
            right = (right[0] * ca + up[0] * sa,
                     right[1] * ca + up[1] * sa,
                     right[2] * ca + up[2] * sa)
            up = _cross(fwd, right)
        self.right, self.up, self.fwd = right, up, fwd

    def project(self, w):
        """World point -> (sx, sy, depth, f) or None if behind the near plane.
        f = braille units per world unit at this depth (the mark-size scale)."""
        rel = (w[0] - self.pos[0], w[1] - self.pos[1], w[2] - self.pos[2])
        zc = rel[0] * self.fwd[0] + rel[1] * self.fwd[1] + rel[2] * self.fwd[2]
        if zc <= NEAR:
            return None
        xc = rel[0] * self.right[0] + rel[1] * self.right[1] + rel[2] * self.right[2]
        yc = rel[0] * self.up[0] + rel[1] * self.up[1] + rel[2] * self.up[2]
        f = self.proj / zc
        return (self.cx + xc * f, self.cy - yc * f, zc, f)


def _bb_ring(canvas, cam, center, r, n, half):
    """A billboarded ring of `n` ticks of radius `r` (world units) in the
    camera's right/up plane, centred at world `center` — reads flat-on to us."""
    rt, up = cam.right, cam.up
    for j in range(n):
        a = TAU * j / n
        cx_, cy_, sx_ = math.cos(a) * r, math.sin(a) * r, 0.0
        w = (center[0] + rt[0] * cx_ + up[0] * cy_,
             center[1] + rt[1] * cx_ + up[1] * cy_,
             center[2] + rt[2] * cx_ + up[2] * cy_)
        p = cam.project(w)
        if p:
            _dash(canvas, p[0], p[1], half * p[3] if half > 0 else 0.0)


# ===========================================================================
# The stations — a constellation laid out weaving through space. Anchors climb
# in z (we fly forward through them) while zig-zagging in x/y so the camera has
# to bank in every direction to visit them. Per station: a camera framing (a
# lateral offset ox/oy and an in/out dwell distance that dollies during the
# hold) and a `kind` that selects its surface behaviour + overlays.
# ===========================================================================
R_BODY = 0.92          # nominal body radius (world units)

STATIONS = [
    # name       status       anchor(x, y, z)      ox    oy   d_in  d_out  kind
    ("awaken",  "IDLE",       (0.0,  0.0,  0.0),   0.15, 0.55, 3.7,  3.1,  "idle"),
    ("search",  "SEARCHING",  (3.4,  0.7,  7.0),   1.05, 0.35, 4.3,  3.5,  "search"),
    ("query",   "QUERYING",   (-2.9, 2.0,  14.0), -1.25, 0.45, 4.6,  3.7,  "query"),
    ("process", "PROCESSING", (2.5, -1.9,  21.0),  1.30, -0.65, 4.1, 3.0,  "process"),
    ("load",    "LOADING",    (-1.7, -2.7, 28.0),  0.10, 0.30, 3.3,  2.0,  "load"),
    ("define",  "DEFINING",   (3.3,  1.5,  35.5),  0.55, 0.75, 4.0,  5.3,  "define"),
    ("buy",     "PURCHASING", (-2.7, -0.7, 43.0), -1.10, -0.45, 4.3, 3.2,  "buy"),
    ("confirm", "CONFIRMED",  (0.2,  2.5,  50.5),  0.00, 0.50, 4.4,  2.6,  "confirm"),
]

DWELL = 3.2            # seconds parked at a station
TRAVEL = 2.1          # seconds whooshing between two stations
WARP = 1.8            # final rush into the bloom before the loop wraps
SEAM_OUT = 1.05       # seconds the start bloom takes to clear (sphere emerges)
SEAM_IN = 1.4         # seconds the end bloom takes to whiteout


def _build_flightplan():
    """Precompute the camera keyframe segments and the timeline. Each segment is
    (t0, t1, pos0, pos1, look0, look1, ease, status)."""
    poses = []                 # (P_in, P_out, L) per station
    for (_n, _s, A, ox, oy, d_in, d_out, _k) in STATIONS:
        p_in = (A[0] + ox, A[1] + oy, A[2] - d_in)
        p_out = (A[0] + ox, A[1] + oy, A[2] - d_out)
        look = (A[0], A[1], A[2] + 0.15)          # aim a hair past the anchor
        poses.append((p_in, p_out, look))

    segs = []
    times = []                 # (Ta, Td) dwell window per station, for status/prog
    cursor = 0.0
    n = len(STATIONS)
    for i in range(n):
        p_in, p_out, look = poses[i]
        ta = cursor
        td = ta + DWELL
        times.append((ta, td))
        st = STATIONS[i][1]
        # the dwell: a slow dolly from the arrival distance to the departure one
        segs.append((ta, td, p_in, p_out, look, look, GENTLE, st))
        cursor = td
        if i < n - 1:
            np_in, _npo, nlook = poses[i + 1]
            segs.append((td, cursor + TRAVEL, p_out, np_in, look, nlook,
                         _expo_io, STATIONS[i + 1][1]))
            cursor += TRAVEL
        else:
            # warp: rush forward through the confirmed bloom, then wrap to start
            A = STATIONS[i][2]
            warp_end = (A[0], A[1], A[2] + 2.6)
            segs.append((td, cursor + WARP, p_out, warp_end, look, look,
                         _expo_i, st))
            cursor += WARP
    return segs, times, cursor


_SEGS, _TIMES, TOTAL = _build_flightplan()


def _pose(t):
    """Interpolated (pos, look, roll, status) at journey time t (wraps at TOTAL)."""
    tw = t % TOTAL
    seg = _SEGS[-1]
    for s in _SEGS:
        if s[0] <= tw < s[1]:
            seg = s
            break
    t0, t1, p0, p1, l0, l1, ease, status = seg
    e = ease((tw - t0) / (t1 - t0)) if t1 > t0 else 0.0
    pos = _lerp3(p0, p1, e)
    look = _lerp3(l0, l1, e)
    # zero-g drift: gentle, incommensurate sways so the eye never sits still
    pos = (pos[0] + 0.17 * math.sin(tw * 0.23),
           pos[1] + 0.12 * math.sin(tw * 0.31 + 1.7),
           pos[2] + 0.10 * math.sin(tw * 0.19 + 0.6))
    roll = 0.055 * math.sin(tw * 0.16) + 0.03 * math.sin(tw * 0.37 + 2.1)
    return pos, look, roll, status


def _dwell_prog(i, tw):
    """0..1 progress across station i's dwell (0 before arrival, 1 after)."""
    ta, td = _TIMES[i]
    return _clamp01((tw - ta) / (td - ta))


# ===========================================================================
# Cached sphere sample grids (one per level-of-detail). Each entry is a flat
# list of (theta, phi, ux, uy, uz) — the unit-sphere directions we hatch.
# ===========================================================================
_GRID_CACHE = {}


def _sphere_grid(n_lat, lon_max):
    key = (n_lat, lon_max)
    g = _GRID_CACHE.get(key)
    if g is not None:
        return g
    pts = []
    for li in range(1, n_lat):
        theta = math.pi * li / n_lat
        st, ct = math.sin(theta), math.cos(theta)
        nlon = max(5, int(lon_max * st))
        for j in range(nlon):
            phi = TAU * j / nlon
            pts.append((theta, phi, st * math.cos(phi), ct, st * math.sin(phi)))
    _GRID_CACHE[key] = pts
    return pts


TICK = 0.030           # hatch-tick half length in WORLD units (perspective-scaled)
HALF_MAX = 4.0         # clamp so a very close mark never draws a giant bar


def _local_rot(d, cyaw, syaw, ct, st):
    """Yaw about Y then tilt about X — the body's own orientation/spin."""
    ux, uy, uz = d
    x1 = ux * cyaw + uz * syaw
    z1 = -ux * syaw + uz * cyaw
    y2 = uy * ct - z1 * st
    z2 = uy * st + z1 * ct
    return (x1, y2, z2)


def _grid_target(theta, phi):
    """Where a surface sample lands when the sphere 'defines' into a ruled table:
    snapped onto the nearest column or row line of a grid in the body's xy plane."""
    u = phi / math.pi - 1.0                       # -1..1 across
    v = theta / HALF_PI - 1.0                     # -1..1 down
    NC, NR = 7, 5
    # nearest column / row lines
    cu = round((u + 1.0) * 0.5 * (NC - 1)) / (NC - 1) * 2.0 - 1.0
    rv = round((v + 1.0) * 0.5 * (NR - 1)) / (NR - 1) * 2.0 - 1.0
    if abs(u - cu) < abs(v - rv):                 # closer to a vertical rule
        gx, gy = cu, v
    else:                                         # closer to a horizontal rule
        gx, gy = u, rv
    return (gx * 1.15, gy * 1.15, 0.0)


# ===========================================================================
# Station renderer — projects one station's body (and overlays) through the
# flying camera, with distance-based level of detail so far specks stay cheap.
# ===========================================================================
def _render_station(canvas, cam, idx, t, min_axis):
    name, status, A, ox, oy, d_in, d_out, kind = STATIONS[idx]
    ac = cam.project((A[0], A[1], A[2]))
    if ac is None:
        return
    depth, fc = ac[2], ac[3]
    on_r = R_BODY * fc                            # body's on-screen radius (px)
    if on_r < min_axis * 0.006 or depth > 46.0:   # too tiny / too far behind us
        return
    # Quantise detail into a handful of LOD buckets so the sphere-grid cache
    # actually hits — a continuous detail would mint a fresh grid every frame.
    detail = _clamp01(on_r / (min_axis * 0.36))
    detail = round(detail * 6.0) / 6.0
    if kind == "define":
        detail = max(detail, 0.66)         # keep the ruled grid densely sampled
    n_lat = int(8 + 26 * detail)
    lon_max = int(20 + 80 * detail)

    tw = t % TOTAL
    prog = _dwell_prog(idx, tw)

    # ---- per-kind spin + a base pole-lean so the hatch vortex reads ----------
    spin_rate = {"idle": 0.24, "search": 0.14, "query": 0.5, "process": 0.8,
                 "load": 0.16, "define": 0.22, "buy": 0.2, "confirm": 0.3}[kind]
    base_tilt = 0.42
    m_grid = 0.0
    if kind == "define":
        m_grid = _expo_io(_clamp01((prog - 0.12) / 0.5))   # sphere -> grid, holds
        spin_rate *= (1.0 - m_grid)                        # stops turning...
        base_tilt *= (1.0 - m_grid)                        # ...and flattens to face us

    yaw = t * spin_rate
    cyaw, syaw = math.cos(yaw), math.sin(yaw)
    ct, st = math.cos(base_tilt), math.sin(base_tilt)

    # confirm bloom runs across the dwell AND into the warp that follows
    ta_c, td_c = _TIMES[idx]
    cp = _clamp01((tw - ta_c) / ((td_c - ta_c) + WARP)) if kind == "confirm" else 0.0
    swell = EASE_BACK(_clamp01(cp / 0.24)) * (1.0 - EASE(_clamp01((cp - 0.62) / 0.38)))

    grid = _sphere_grid(n_lat, lon_max)
    campos = cam.pos
    for (theta, phi, ux, uy, uz) in grid:
        # ---- surface displacement + brightness (the state's signature) -------
        disp = 0.0
        bri = 0.9
        if kind == "idle":
            disp = 0.03 * math.sin(t * 0.8)
        elif kind == "search":
            dphi = (t * 1.7 - phi) % TAU
            bri = 0.5 + 1.5 * math.exp(-dphi * 2.6)
        elif kind == "query":
            bri = 0.5 + 0.7 * (0.5 + 0.5 * math.sin(theta * 5.0 - t * 3.0))
        elif kind == "process":
            wv = math.sin(theta * 7.0 - t * 4.0)
            disp = 0.045 * wv
            band = 0.5 + 0.5 * wv
            bri = 0.5 + 1.25 * band * band
        elif kind == "load":
            pass                                  # brightness needs world-y, below
        elif kind == "define":
            bri = 0.85
        elif kind == "buy":
            if prog > 0.7:
                fl = EASE((prog - 0.7) / 0.3) * math.exp(-(uy * uy) / 0.02)
                bri = 0.85 + 1.3 * fl
        elif kind == "confirm":
            flash = 1.0 - EASE(_clamp01((cp - 0.1) / 0.5))
            disp = 0.18 * swell
            bri = 0.7 + 1.35 * flash

        # ---- body position: sphere, or morphing toward the ruled grid --------
        nd = _local_rot((ux, uy, uz), cyaw, syaw, ct, st)   # rotated normal
        if kind == "define" and m_grid > 0.0:
            g = _grid_target(theta, phi)
            gd = _local_rot(g, cyaw, syaw, ct, st)
            bp = (_lerp(nd[0], gd[0], m_grid),
                  _lerp(nd[1], gd[1], m_grid),
                  _lerp(nd[2], gd[2], m_grid))
        else:
            bp = (nd[0] * (1.0 + disp), nd[1] * (1.0 + disp), nd[2] * (1.0 + disp))

        w = (A[0] + R_BODY * bp[0], A[1] + R_BODY * bp[1], A[2] + R_BODY * bp[2])

        if kind == "load":                        # fill tide keyed to world height
            level = -1.0 + 2.0 * prog
            h = bp[1]
            if h <= level:
                bri = 1.2 + 0.9 * math.exp(-((h - level) ** 2) / 0.006)
            else:
                bri = 0.28

        p = cam.project(w)
        if p is None:
            continue
        # ---- face cull + shading from the CAMERA's angle ---------------------
        if not (kind == "define" and m_grid > 0.5):     # a flat grid has no back
            view = (w[0] - campos[0], w[1] - campos[1], w[2] - campos[2])
            vm = math.sqrt(view[0] ** 2 + view[1] ** 2 + view[2] ** 2) or 1.0
            facing = (nd[0] * view[0] + nd[1] * view[1] + nd[2] * view[2]) / vm
            if facing > -0.06:                    # limb / back face
                continue
            shade = 0.4 + 0.6 * (-facing)
        else:
            shade = 0.75
        half = TICK * p[3] * shade * bri
        if half > HALF_MAX:
            half = HALF_MAX
        _dash(canvas, p[0], p[1], half)

    _station_overlay(canvas, cam, idx, kind, A, tw, t, prog, cp, min_axis, ct, st)


def _station_overlay(canvas, cam, idx, kind, A, tw, t, prog, cp, min_axis, ct, st):
    """Per-state overlays: query pulses, the buy in-spiral, the load waterline,
    the confirm shockwave — all placed in world space so they fly with us."""
    if kind == "query":
        # thin dotted rings pulse outward off the sphere and thin as they go,
        # reading as query pulses that lead the eye toward the next node
        for k in range(3):
            u = ((t * 0.45) + k / 3.0) % 1.0
            if u <= 0.04 or u >= 0.94:
                continue
            r = R_BODY * (1.0 + 1.9 * u)
            n = int(70 * (1.0 - u)) + 14
            _bb_ring(canvas, cam, A, r, n, 0.0)
    elif kind == "buy":
        # particles spiral inward to the core, then it flares
        rt, up = cam.right, cam.up
        for k in range(16):
            a0 = TAU * k / 16
            pu = _clamp01(prog / 0.7 - (k % 4) * 0.05)
            if pu >= 0.999:
                continue
            e = EASE(pu)
            rad = R_BODY * (2.1 * (1.0 - e) + 1.0 * e)
            ang = a0 + pu * 4.4
            cxp, cyp = math.cos(ang) * rad, math.sin(ang) * rad
            w = (A[0] + rt[0] * cxp + up[0] * cyp,
                 A[1] + rt[1] * cxp + up[1] * cyp,
                 A[2] + rt[2] * cxp + up[2] * cyp)
            p = cam.project(w)
            if p:
                s = max(p[3] * 0.02, min_axis * 0.006)
                canvas.square_fill(p[0], p[1], s)
        if prog > 0.7:                            # merge flare ring
            rr = R_BODY * (1.0 + 0.7 * EASE((prog - 0.7) / 0.3))
            _bb_ring(canvas, cam, A, rr, 40, 1.4)
    elif kind == "load":
        # a bright waterline latitude ring at the current fill level
        level = _clamp(-1.0 + 2.0 * prog, -0.96, 0.96)
        rr = math.sqrt(max(0.0, 1.0 - level * level))
        prev = None
        for j in range(41):
            a = TAU * j / 40
            d = (rr * math.cos(a), level, rr * math.sin(a))
            nd = _local_rot(d, math.cos(t * 0.16), math.sin(t * 0.16), ct, st)
            w = (A[0] + R_BODY * nd[0], A[1] + R_BODY * nd[1], A[2] + R_BODY * nd[2])
            p = cam.project(w)
            cur = (p[0], p[1]) if p else None
            if cur and prev:
                canvas.line(prev[0], prev[1], cur[0], cur[1])
            prev = cur
    elif kind == "confirm":
        # dotted shockwave rings ringing out of the bloom, thinning as they grow
        if 0.06 < cp < 0.9:
            for k in range(3):
                sr = EASE(_clamp01((cp - 0.06 - k * 0.13) / 0.6))
                if 0.0 < sr < 1.0:
                    n = int(90 * (1.0 - sr)) + 22
                    _bb_ring(canvas, cam, A, R_BODY * (1.1 + sr * 1.9), n, 0.0)


# ===========================================================================
# The dust field — a fixed cloud of motes the flight parallaxes past, the single
# strongest cue that we are really moving through a volume. Generated once,
# each mote given a slow zero-g wander.
# ===========================================================================
def _make_dust(n):
    rng = random.Random(7)
    dust = []
    for _ in range(n):
        x = rng.uniform(-9.0, 9.0)
        y = rng.uniform(-6.5, 6.5)
        z = rng.uniform(-5.0, TOTAL * 0.0 + 56.0)
        ph = rng.uniform(0.0, TAU)
        rate = rng.uniform(0.15, 0.5)
        amp = rng.uniform(0.05, 0.16)
        dust.append((x, y, z, ph, rate, amp))
    return dust


def _flood_disc(canvas, bx, by, r):
    """Fill a solid white disc straight into the half-block layer — an O(area)
    whiteout far cheaper than rect_fill's rotated scan, used for the seam bloom."""
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


def _draw_dust(canvas, cam, dust, t, min_axis):
    for (x, y, z, ph, rate, amp) in dust:
        w = (x + amp * math.sin(t * rate + ph),
             y + amp * math.cos(t * rate * 0.9 + ph),
             z)
        p = cam.project(w)
        if p is None or p[2] > 60.0:
            continue
        if p[2] < 6.0:                            # a near mote reads as a short tick
            _dash(canvas, p[0], p[1], min(1.4, 3.0 / p[2]))
        else:
            canvas.set_dot(p[0], p[1])


# ===========================================================================
# The scene
# ===========================================================================
class JourneyScene(Scene):
    name = "hatch · journey"

    def reset(self):
        self.t = 0.0
        self.dust = _make_dust(260)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        min_axis = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        proj = min_axis * FOV_K
        t = self.t
        tw = t % TOTAL

        # The seam bloom: a whiteout that hides the loop's camera teleport and
        # reads as 'into / out of the light'. Compute it first — when it fully
        # covers the frame there is no point rendering (and drawing at all) the
        # stations behind it, which is also where the fly-through render is
        # heaviest, so this doubles as the worst-frame optimisation.
        f_out = 1.0 - _smooth(tw / SEAM_OUT)                   # emerging at start
        f_in = _smooth((tw - (TOTAL - SEAM_IN)) / SEAM_IN) if tw > TOTAL - SEAM_IN else 0.0
        flash = max(f_out, f_in)
        if flash >= 0.9:
            _flood_disc(canvas, cx, cy, math.hypot(wu, hu) * 1.2)
            return

        pos, look, roll, _status = _pose(t)
        cam = Camera(pos, look, roll, proj, cx, cy)

        _draw_dust(canvas, cam, self.dust, t, min_axis)

        # render stations far -> near so nearer marks land on top
        depths = []
        for i, st in enumerate(STATIONS):
            p = cam.project(st[2])
            depths.append((p[2] if p else 1e9, i))
        depths.sort(reverse=True)
        for _d, i in depths:
            _render_station(canvas, cam, i, t, min_axis)

        if flash > 0.01:
            # centre the bloom on the confirmed station while warping out, else mid
            ctr = (cx, cy)
            if f_in > f_out:
                p = cam.project(STATIONS[-1][2])
                if p:
                    ctr = (p[0], p[1])
            _flood_disc(canvas, ctr[0], ctr[1], math.hypot(wu, hu) * 1.2 * flash)

    def status(self):
        return _pose(self.t)[3]


def make_scenes():
    return [JourneyScene()]


if __name__ == "__main__":
    import mpp

    _scenes = make_scenes()
    # Bare interactive launch on a TTY -> hatch_grid's steady 60fps explorer;
    # any flag (--export/--no-motion/--banner/...) or a non-TTY stdout hands off
    # to mpp's standard dispatch so all existing behaviour is preserved.
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
