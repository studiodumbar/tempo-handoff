#!/usr/bin/env python3
"""
agent_states_3d — cinematic 3D sequential scenes for the AI-agent buying flow.

Where agent_states.py is flat/abstract, this file is all depth: pinhole-projected
3D geometry, camera fly-throughs and POV shots, and phased "little journeys" that
build, resolve, and loop. Still the mpp vocabulary — monochrome, square/line/
invert — but everything is placed in 3D and drawn with a depth-fog rule that is
the whole trick to making 3D read beautifully in a terminal:

    far  -> a single faint Braille dot          (dissolves into the dark)
    mid  -> a thin hollow square / line
    near -> a bold solid invert (half-block)     (occludes what's behind it,
            because a filled cell wins over Braille in compose)

Drawing far->near (painter's order) plus that rule gives real depth cueing and
cell-level occlusion without a z-buffer.

One flagship 3D sequence per state (more to come):

    1  default · orbit       a slowly turning armillary sphere suspended in dust
    2  loading · warp        POV flying a rifling ring-tunnel that surges + loops
    3  processing · lattice  POV diving through a volumetric grid, a compute plane
                             lighting each layer as you pass through it
    4  thinking · constellation  POV drifting a 3D idea-web as a reasoning wavefront
                             sweeps back-to-front, firing nodes and edges in turn
    5  searching · aisle     POV down an infinite shelf-corridor, a scan plane
                             flagging product-boxes, the agent locking onto one
    6  buying · vault        a token flies from the deep, an iris opens to admit it
                             and seals behind it with a shockwave
    7  confirm · assemble    cubes stream out of the dark and lock into a giant 3D
                             checkmark; a shockwave rings out; it scatters and loops
    8  cart · orbit3d        a wireframe cart in perspective, item-cubes arcing in
                             from depth to stack inside as a badge counts up

Run standalone: `python agent_states_3d.py` (mpp's runner: --no-motion, --banner,
--export, --scene all work). Combine with the flat set via `--all` (see bottom).
"""

import math
import random

from mpp import Scene, _clamp, EASE, EASE_BACK, GENTLE, _cubic_bezier

TAU = 2.0 * math.pi
CAM = 1.0                 # pinhole camera distance (world looks down +z toward it)
_CULL = 0.06              # near-plane: cull anything within this of the camera


# ===========================================================================
# 3D toolkit
# ===========================================================================
def _mkview(cx, cy, s, yaw=0.0, pitch=0.0, cam=CAM):
    """Pack a view: screen centre (cx, cy), world->screen scale s, camera yaw/
    pitch, camera distance cam. Passed to _P for every projection in a frame."""
    return (math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch),
            cam, s, cx, cy)


def _P(x, y, z, V):
    """Project world (x, y, z) through view V. Yaw about Y, pitch about X, then a
    pinhole at distance cam (nearer -> bigger). Returns (sx, sy, f) or None if the
    point is at/behind the near-plane. f is the perspective factor = 'nearness'."""
    cyaw, syaw, cpit, spit, cam, s, cx, cy = V
    x1 = x * cyaw + z * syaw
    z1 = -x * syaw + z * cyaw
    y2 = y * cpit - z1 * spit
    z2 = y * spit + z1 * cpit
    denom = cam - z2
    if denom <= _CULL:
        return None
    f = cam / denom
    return (cx + x1 * f * s, cy + y2 * f * s, f)


def _L(canvas, a, b):
    """Braille line between two projected points (skips if either was culled)."""
    if a and b:
        canvas.line(a[0], a[1], b[0], b[1])


def _fnode(canvas, p, mind, k=0.05, bold=1.5, thin=0.014):
    """Depth-fog node: size grows with nearness f; near ones invert to a solid
    square (occluder), mid ones are hollow, far ones a single dot."""
    if not p:
        return
    sx, sy, f = p
    size = f * k * mind
    if f >= bold:
        canvas.square_fill(sx, sy, max(size, mind * 0.02))
    elif size >= thin * mind:
        canvas.square_outline(sx, sy, size)
    else:
        canvas.set_dot(sx, sy)


def _loop3(canvas, pts3, V, solid_from=None, mind=0.0):
    """Project a closed loop of world points and stroke it; optionally drop a
    solid node at each vertex whose f exceeds solid_from (near vertices bloom)."""
    proj = [_P(p[0], p[1], p[2], V) for p in pts3]
    m = len(proj)
    for i in range(m):
        _L(canvas, proj[i], proj[(i + 1) % m])
    if solid_from is not None:
        for p in proj:
            if p and p[2] >= solid_from:
                canvas.square_fill(p[0], p[1], max(p[2] * 0.03 * mind, mind * 0.02))


def _ring3(R, z, n, spin=0.0, y0=0.0, x0=0.0):
    """n world points on a circle of radius R at depth z (optionally offset)."""
    return [(x0 + R * math.cos(TAU * i / n + spin),
             y0 + R * math.sin(TAU * i / n + spin), z) for i in range(n)]


def _resample(poly, n):
    """Evenly resample a 2D polyline into n points by arc length."""
    segs = []
    total = 0.0
    for i in range(len(poly) - 1):
        d = math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1])
        segs.append(d)
        total += d
    if total <= 0.0:
        return [poly[0]] * n
    out = []
    for k in range(n):
        target = (k / (n - 1)) * total if n > 1 else 0.0
        acc = 0.0
        for i, d in enumerate(segs):
            if d > 0.0 and acc + d >= target:
                f = (target - acc) / d
                out.append((poly[i][0] + (poly[i + 1][0] - poly[i][0]) * f,
                            poly[i][1] + (poly[i + 1][1] - poly[i][1]) * f))
                break
            acc += d
        else:
            out.append(poly[-1])
    return out


class _DustMixin:
    """A slowly drifting 3D dust cloud for atmosphere. Call _dust_reset in reset,
    _draw_dust in draw."""

    DUST_N = 70
    DUST_R = 2.6

    def _dust_reset(self):
        self.dust = []
        for _ in range(self.DUST_N):
            while True:
                x = random.uniform(-1, 1)
                y = random.uniform(-1, 1)
                z = random.uniform(-1, 1)
                if 0.15 < x * x + y * y + z * z <= 1.0:
                    break
            r = self.DUST_R
            self.dust.append((x * r, y * r, z * r))

    def _draw_dust(self, canvas, V, mind, drift=0.0):
        for (x, y, z) in self.dust:
            p = _P(x, y, z + drift, V)
            if p:
                if p[2] >= 1.4:
                    canvas.square_outline(p[0], p[1], p[2] * 0.02 * mind)
                else:
                    canvas.set_dot(p[0], p[1])


# ===========================================================================
# 1 — DEFAULT · orbit  (idle: a slowly turning armillary sphere in dust)
# ===========================================================================
class DefaultOrbitScene(Scene, _DustMixin):
    name = "default · orbit"
    SPIN = 0.28

    def reset(self):
        self.t = 0.0
        self._dust_reset()

    N = 56               # points per great circle

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        breath = 0.5 - 0.5 * math.cos(self.t * 0.8)
        yaw = self.t * self.SPIN
        pitch = 0.5 + 0.12 * math.sin(self.t * 0.35)
        V = _mkview(cx, cy, mind * 0.44, yaw=yaw, pitch=pitch, cam=3.0)
        self._draw_dust(canvas, V, mind)
        R = 0.66 + 0.02 * breath
        ang = [TAU * i / self.N for i in range(self.N)]
        # an armillary sphere: three orthogonal great-circle rings, all smooth
        # curves, so no straight edge can ever streak across the frame
        rings = (
            [(R * math.cos(a), R * math.sin(a), 0.0) for a in ang],       # equator
            [(0.0, R * math.cos(a), R * math.sin(a)) for a in ang],       # meridian
            [(R * math.sin(a), 0.0, R * math.cos(a)) for a in ang],       # meridian
        )
        for ring in rings:
            proj = [_P(x, y, z, V) for (x, y, z) in ring]
            for i in range(self.N):
                _L(canvas, proj[i], proj[(i + 1) % self.N])
        # a bead orbiting the equator, and gimbal poles
        for (x, y, z) in ((R * math.cos(self.t * 1.1), R * math.sin(self.t * 1.1), 0.0),
                          (0.0, R, 0.0), (0.0, -R, 0.0)):
            p = _P(x, y, z, V)
            if p:
                canvas.square_fill(p[0], p[1], mind * 0.016)
        # a slow breathing solid core
        canvas.square_fill(cx, cy, mind * 0.03 * (1.0 + 0.4 * breath))

    def status(self):
        return "IDLE"


# ===========================================================================
# 2 — LOADING · warp  (POV: a rifling ring-tunnel that surges and loops)
# ===========================================================================
class LoadingWarpScene(Scene):
    name = "loading · warp"
    N_RINGS = 18
    N_PTS = 30
    R = 0.62
    SURGE = 2.6       # seconds per surge cycle
    Z_BACK = -3.4     # far depth (z2)
    Z_FRONT = 0.92    # near depth (just before the camera at CAM=1)
    FAR_CUT = 0.34    # fog: past here rings fade to sparse dots

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        V = _mkview(cx, cy, mind * 0.62)
        span = self.Z_FRONT - self.Z_BACK
        # speed surges each cycle (spinning up), never stalling
        u_cyc = (self.t % self.SURGE) / self.SURGE
        flow = self.t * 0.16 + 0.08 * (1.0 - math.cos(TAU * u_cyc))
        spin = self.t * 0.32                          # the whole bore turns as one

        def loop_at(rr, z):
            return [_P(rr * math.cos(TAU * j / self.N_PTS + spin),
                       rr * math.sin(TAU * j / self.N_PTS + spin), z, V)
                    for j in range(self.N_PTS)]

        rings = []
        for i in range(self.N_RINGS):
            u = ((i / self.N_RINGS) + flow) % 1.0
            z = self.Z_BACK + u * span
            rings.append((z, 1.0 / (CAM - z), loop_at(self.R, z)))
        rings.sort(key=lambda r: r[0])                # far -> near (painter's)
        for z, f, pts in rings:
            if f < self.FAR_CUT:                      # deep fog: cull
                continue
            if f < 0.62:                              # far: a dotted circle
                for j in range(0, self.N_PTS, 3):
                    if pts[j]:
                        canvas.set_dot(pts[j][0], pts[j][1])
                continue
            for j in range(self.N_PTS):               # mid/near: full loop
                _L(canvas, pts[j], pts[(j + 1) % self.N_PTS])
        # a bright light-hoop rushing smoothly toward the camera (triple band)
        pulse_u = (self.t * 0.5) % 1.0
        zp = self.Z_BACK + pulse_u * span
        if 1.0 / (CAM - zp) >= 0.5:
            for rr in (self.R * 0.93, self.R, self.R * 1.07):
                hp = loop_at(rr, zp)
                for j in range(self.N_PTS):
                    _L(canvas, hp[j], hp[(j + 1) % self.N_PTS])

    def status(self):
        return "WARP"


# ===========================================================================
# 3 — PROCESSING · lattice  (POV diving a volume, a compute plane per layer)
# ===========================================================================
class ProcessingLatticeScene(Scene):
    name = "processing · lattice"
    NX = 5
    NY = 3
    N_LAYERS = 13
    SPAN = 0.82       # half-extent of the grid in x
    Z_BACK = -3.0
    Z_FRONT = 0.85
    SPEED = 0.14
    FAR_CUT = 0.42    # fog: deeper layers dissolve away
    PLANE = 0.28      # compute-plane sweep speed (cycles/sec)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        V = _mkview(cx, cy, mind * 0.62)
        span = self.Z_FRONT - self.Z_BACK
        W = self.SPAN
        H = self.SPAN * self.NY / self.NX
        flow = self.t * self.SPEED
        plane_u = (self.t * self.PLANE) % 1.0
        layers = []
        for i in range(self.N_LAYERS):
            u = ((i / self.N_LAYERS) + flow) % 1.0
            z = self.Z_BACK + u * span
            d = abs(u - plane_u)
            d = min(d, 1.0 - d)                       # wrap distance to the plane
            act = _clamp(1.0 - d / 0.09, 0.0, 1.0)    # 1 at the compute plane
            grid = [[_P((gx / (self.NX - 1) - 0.5) * 2 * W,
                        (gy / (self.NY - 1) - 0.5) * 2 * H, z, V)
                     for gx in range(self.NX)] for gy in range(self.NY)]
            layers.append((z, 1.0 / (CAM - z), act, grid))
        layers.sort(key=lambda L: L[0])               # far -> near
        for z, f, act, grid in layers:
            if f < self.FAR_CUT:                       # deep fog: skip
                continue
            hot = act > 0.5
            if hot:                                    # the active plane: mesh + glow
                for gy in range(self.NY):
                    for gx in range(self.NX):
                        p = grid[gy][gx]
                        if gx + 1 < self.NX:
                            _L(canvas, p, grid[gy][gx + 1])
                        if gy + 1 < self.NY:
                            _L(canvas, p, grid[gy + 1][gx])
                for row in grid:
                    for p in row:
                        if p:
                            canvas.square_fill(p[0], p[1],
                                               max(f * 0.028 * mind, mind * 0.02))
            else:                                      # dormant nodes: faint points
                for row in grid:
                    for p in row:
                        if not p:
                            continue
                        if f >= 1.15:
                            canvas.square_outline(p[0], p[1], f * 0.02 * mind)
                        else:
                            canvas.set_dot(p[0], p[1])

    def status(self):
        return "LATTICE"


# ===========================================================================
# 4 — THINKING · constellation  (POV idea-web, a reasoning wavefront firing it)
# ===========================================================================
class ThinkingConstellationScene(Scene):
    name = "thinking · constellation"
    N = 26
    K = 2            # nearest-neighbour edges per node
    DEPTH = 3.5
    ZMAX = -0.15     # nodes drift toward here (never past the camera -> no pop)
    SPEED = 0.5      # forward drift
    WAVE = 0.85      # reasoning wavefront speed

    def reset(self):
        self.t = 0.0
        self.nodes = []
        for _ in range(self.N):
            self.nodes.append((random.uniform(-1.15, 1.15),
                               random.uniform(-0.85, 0.85),
                               random.uniform(0.0, self.DEPTH)))   # z0 phase
        self.edges = []
        seen = set()
        for i in range(self.N):
            order = sorted(range(self.N),
                           key=lambda j: (9e9 if j == i else
                                          (self.nodes[i][0] - self.nodes[j][0]) ** 2
                                          + (self.nodes[i][1] - self.nodes[j][1]) ** 2
                                          + (self.nodes[i][2] - self.nodes[j][2]) ** 2))
            for j in order[:self.K]:
                key = (min(i, j), max(i, j))
                if key not in seen:
                    seen.add(key)
                    self.edges.append(key)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        yaw = 0.13 * math.sin(self.t * 0.24)          # gentle float
        pitch = 0.09 * math.sin(self.t * 0.19)
        V = _mkview(cx, cy, mind * 0.6, yaw=yaw, pitch=pitch)
        # each node drifts forward and wraps far -> near without passing the eye
        zz = []
        for (x, y, z0) in self.nodes:
            zz.append(self.ZMAX - ((z0 + self.t * self.SPEED) % self.DEPTH))
        proj = [_P(self.nodes[i][0], self.nodes[i][1], zz[i], V)
                for i in range(self.N)]
        # a reasoning wavefront sweeps back->front, firing what it touches
        front = self.ZMAX - ((self.t * self.WAVE) % self.DEPTH)
        fired = [_clamp(1.0 - abs(zz[i] - front) / 0.45, 0.0, 1.0)
                 for i in range(self.N)]
        for a, b in self.edges:                        # the web is always present
            _L(canvas, proj[a], proj[b])
        for i, p in enumerate(proj):
            if not p:
                continue
            f = p[2]
            if fired[i] > 0.5:                          # a node the wavefront lit
                canvas.square_fill(p[0], p[1], max(f * 0.04 * mind, mind * 0.022))
            elif f >= 0.62:
                canvas.square_outline(p[0], p[1], max(f * 0.028 * mind, mind * 0.012))
            else:
                canvas.set_dot(p[0], p[1])

    def status(self):
        return "REASONING"


# ===========================================================================
# 5 — SEARCHING · aisle  (POV shelf-corridor, scan plane, lock-on)
# ===========================================================================
class SearchAisleScene(Scene):
    name = "searching · aisle"
    N_FRAMES = 12     # corridor cross-frames in depth
    ROWS = 2          # shelf rows per wall
    W = 0.82          # corridor half-width
    H = 0.58          # corridor half-height
    Z_BACK = -3.4
    Z_FRONT = 0.9
    SPEED = 0.16
    FAR_CUT = 0.42    # fog: the corridor dissolves past here
    LOCK_CYCLE = 4.0

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        # the agent leans toward the shelf it locks onto
        lock_u = (self.t % self.LOCK_CYCLE) / self.LOCK_CYCLE
        lean = 0.05 * math.sin(TAU * lock_u) * EASE(_clamp(lock_u * 2, 0, 1))
        V = _mkview(cx, cy, mind * 0.6, yaw=lean)
        span = self.Z_FRONT - self.Z_BACK
        flow = self.t * self.SPEED
        W, H = self.W, self.H
        scan_z = self.Z_BACK + ((self.t * 0.5) % 1.0) * span

        frames = sorted(self.Z_BACK + (((i / self.N_FRAMES) + flow) % 1.0) * span
                        for i in range(self.N_FRAMES))
        # corridor rectangles + rails, culled into fog at the far end
        corners = [(-W, -H), (W, -H), (W, H), (-W, H)]
        prev = None
        for z in frames:
            if 1.0 / (CAM - z) < self.FAR_CUT:           # in the fog: don't draw
                prev = None
                continue
            cur = [_P(cxn, cyn, z, V) for (cxn, cyn) in corners]
            for k in range(4):
                _L(canvas, cur[k], cur[(k + 1) % 4])     # the frame rectangle
            if prev:
                for k in range(4):
                    _L(canvas, prev[k], cur[k])          # longitudinal rails
            prev = cur
        # product boxes on both walls (fogged, capped, few)
        best = None
        for z in frames:
            f = 1.0 / (CAM - z)
            if f < self.FAR_CUT:
                continue
            near_scan = abs(z - scan_z) < 0.26
            for side in (-1, 1):
                for r in range(self.ROWS):
                    y = (r / (self.ROWS - 1) - 0.5) * 2 * (H * 0.62)
                    p = _P(side * W * 0.9, y, z, V)
                    if not p:
                        continue
                    sz = min(p[2] * 0.045 * mind, mind * 0.06)
                    if near_scan:
                        canvas.square_fill(p[0], p[1], max(sz, mind * 0.02))
                        if p[2] >= 1.15 and (best is None or p[2] > best[2]):
                            best = p
                    else:
                        canvas.square_outline(p[0], p[1], max(sz, mind * 0.012))
        # lock-on bracket around the strongest scanned box
        if best and lock_u > 0.5:
            self._bracket(canvas, best[0], best[1], mind * 0.10)

    @staticmethod
    def _bracket(canvas, x, y, r):
        for sx in (-1, 1):
            for sy in (-1, 1):
                canvas.line(x + sx * r, y + sy * r, x + sx * r * 0.5, y + sy * r)
                canvas.line(x + sx * r, y + sy * r, x + sx * r, y + sy * r * 0.5)

    def status(self):
        return "SCANNING"


# ===========================================================================
# 6 — BUYING · vault  (a token flies in, an iris opens, admits, seals)
# ===========================================================================
class BuyingVaultScene(Scene):
    name = "buying · vault"
    CYCLE = 3.4
    N_BLADES = 12

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        V = _mkview(cx, cy, mind * 0.6)
        u = (self.t % self.CYCLE) / self.CYCLE
        # iris open profile: shut -> open (admit) -> shut
        openness = 0.0
        if u < 0.35:
            openness = EASE(u / 0.35) * 0.5
        elif u < 0.62:
            openness = 0.5 + 0.5 * EASE((u - 0.35) / 0.27)
        else:
            openness = (1.0 - EASE((u - 0.62) / 0.2)) if u < 0.82 else 0.0
        hole = 0.06 + openness * 0.5
        spin = self.t * 0.6
        # vault ring frame (static, in the z=0 plane)
        _loop3(canvas, _ring3(0.95, 0.0, 40), V)
        _loop3(canvas, _ring3(0.78, 0.0, 36), V)
        # iris blades: squares marching in toward the centre by `hole`
        for k in range(self.N_BLADES):
            a = TAU * k / self.N_BLADES + spin
            rr = hole + 0.16
            x, y = rr * math.cos(a), rr * math.sin(a)
            p = _P(x, y, 0.0, V)
            if p:
                canvas.square_fill(p[0], p[1], mind * 0.05)
            # a spoke from the rim inward to the blade
            _L(canvas, _P(0.74 * math.cos(a), 0.74 * math.sin(a), 0.0, V), p)
        # the token: flies from deep z toward and through the iris
        tz = -3.0 + EASE(_clamp(u / 0.6, 0, 1)) * 3.0        # -3 -> 0 by u=0.6
        if u < 0.62:
            self._token(canvas, V, tz, mind, spin=self.t * 3.0)
        # seal shockwave when it shuts behind the token
        if 0.62 < u < 0.9:
            sr = EASE((u - 0.62) / 0.28)
            _loop3(canvas, _ring3(0.1 + sr * 1.4, 0.0, 44), V)

    @staticmethod
    def _token(canvas, V, z, mind, spin):
        # a spinning coin: a square whose width foreshortens with the spin
        p = _P(0.0, 0.0, z, V)
        if not p:
            return
        w = abs(math.cos(spin))
        R = p[2] * 0.12 * mind
        if w > 0.12:
            canvas.rect_fill(p[0], p[1], max(2 * R * w, mind * 0.01), 2 * R)
        else:
            canvas.line(p[0], p[1] - R, p[0], p[1] + R)   # edge-on

    def status(self):
        return "AUTHORIZING"


# ===========================================================================
# 7 — CONFIRM · assemble  (cubes stream in and lock into a giant 3D check)
# ===========================================================================
class ConfirmAssembleScene(Scene):
    name = "confirm · assemble"
    N = 42
    CYCLE = 4.6

    def reset(self):
        self.t = 0.0
        poly = [(-0.62, 0.05), (-0.16, 0.5), (0.72, -0.55)]
        self.targets = [(x * 0.72, y * 0.72, 0.0)
                        for (x, y) in _resample(poly, self.N)]
        self.starts = []
        for i in range(self.N):
            a = random.uniform(0, TAU)
            r = random.uniform(1.4, 2.4)
            self.starts.append((r * math.cos(a), r * math.sin(a),
                                random.uniform(-3.5, -1.2)))
        self.order = list(range(self.N))
        random.shuffle(self.order)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        u = (self.t % self.CYCLE) / self.CYCLE
        # slow push-in during the hold
        push = 0.62 + 0.06 * EASE(_clamp((u - 0.5) / 0.25, 0, 1))
        yaw = 0.18 * math.sin(self.t * 0.3)
        V = _mkview(cx, cy, mind * push, yaw=yaw)
        assembled = 0
        for rank, i in enumerate(self.order):
            frac = rank / self.N
            if u < 0.5:                                   # fly in, staggered
                p_in = EASE(_clamp((u / 0.5 - frac * 0.6) / 0.4, 0, 1))
            elif u < 0.78:                                # hold
                p_in = 1.0
            else:                                         # scatter back out
                p_in = 1.0 - EASE(_clamp((u - 0.78) / 0.22 - frac * 0.3, 0, 1))
            sx, sy, sz = self.starts[i]
            tx, ty, tz = self.targets[i]
            x = sx + (tx - sx) * p_in
            y = sy + (ty - sy) * p_in
            z = sz + (tz - sz) * p_in
            p = _P(x, y, z, V)
            if not p:
                continue
            locked = p_in > 0.985
            if locked:
                assembled += 1
                canvas.square_fill(p[0], p[1], max(p[2] * 0.05 * mind, mind * 0.026))
            else:
                _fnode(canvas, p, mind, k=0.03, bold=1.6)
        # shockwave the instant it completes
        if 0.5 <= u < 0.72:
            sr = EASE((u - 0.5) / 0.22)
            _loop3(canvas, _ring3(0.2 + sr * 1.5, 0.0, 44), V)

    def status(self):
        return "CONFIRMED"


# ===========================================================================
# 8 — CART · orbit3d  (wireframe cart, item-cubes arc in from depth, badge)
# ===========================================================================
class Cart3DScene(Scene):
    name = "cart · orbit3d"
    CYCLE = 1.7
    CAP = 6

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0
        yaw = 0.5 + 0.35 * math.sin(self.t * 0.5)
        pitch = 0.42
        V = _mkview(cx, cy, mind * 0.62, yaw=yaw, pitch=pitch)
        # cart basket = an open box (a truncated pyramid), wider at the top
        top, bot = 0.62, 0.42
        yt, yb = -0.28, 0.30
        topq = [(-top, yt, -top), (top, yt, -top), (top, yt, top), (-top, yt, top)]
        botq = [(-bot, yb, -bot), (bot, yb, -bot), (bot, yb, bot), (-bot, yb, bot)]
        tp = [_P(x, y, z, V) for (x, y, z) in topq]
        bp = [_P(x, y, z, V) for (x, y, z) in botq]
        for k in range(4):
            _L(canvas, tp[k], tp[(k + 1) % 4])
            _L(canvas, bp[k], bp[(k + 1) % 4])
            _L(canvas, tp[k], bp[k])
        # wheels
        for wx in (-0.4, 0.4):
            for (ax, az) in ((wx, -0.3), (wx, 0.3)):
                wheel = [(ax + 0.12 * math.cos(a), 0.5, az + 0.12 * math.sin(a))
                         for a in [TAU * j / 10 for j in range(10)]]
                wp = [_P(x, y, z, V) for (x, y, z) in wheel]
                for k in range(len(wp)):
                    _L(canvas, wp[k], wp[(k + 1) % len(wp)])
        # stacked items already in the cart (accumulated count)
        n_in = 1 + int(self.t / self.CYCLE) % self.CAP
        for s in range(n_in):
            level = s // 2
            side = -0.18 if s % 2 == 0 else 0.18
            iy = yb - 0.08 - level * 0.16
            p = _P(side, iy, 0.0, V)
            if p:
                canvas.square_fill(p[0], p[1], max(p[2] * 0.05 * mind, mind * 0.02))
        # an item arcing in from the upper deep on a 3D parabola
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < 0.82:
            e = EASE(u / 0.82)
            ix = -1.4 + 1.4 * e
            iy = -1.3 + (yt + 0.05 + 1.3) * e - math.sin(e * math.pi) * 0.5
            iz = -1.6 + 1.6 * e
            p = _P(ix, iy, iz, V)
            if p:
                canvas.square_fill(p[0], p[1], max(p[2] * 0.045 * mind, mind * 0.02))
        # count badge: pips floating above the cart
        bx = -(n_in - 1) * 0.09
        for s in range(n_in):
            p = _P(bx + s * 0.18, -0.7, 0.0, V)
            if p:
                canvas.square_fill(p[0], p[1], mind * 0.015)

    def status(self):
        return "ADDING"


# ===========================================================================
# Registry
# ===========================================================================
def make_scenes():
    return [
        DefaultOrbitScene(),            # 1  default · orbit
        LoadingWarpScene(),             # 2  loading · warp
        ProcessingLatticeScene(),       # 3  processing · lattice
        ThinkingConstellationScene(),   # 4  thinking · constellation
        SearchAisleScene(),             # 5  searching · aisle
        BuyingVaultScene(),             # 6  buying · vault
        ConfirmAssembleScene(),         # 7  confirm · assemble
        Cart3DScene(),                  # 8  cart · orbit3d
    ]


if __name__ == "__main__":
    import sys
    import mpp

    scenes = make_scenes()
    if "--all" in sys.argv:                    # 3D set + the flat set together
        sys.argv.remove("--all")
        import agent_states
        scenes = scenes + agent_states.make_scenes()
    mpp.main(scenes)
