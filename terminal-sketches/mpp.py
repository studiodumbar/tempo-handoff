#!/usr/bin/env python3
"""
mpp-terminal — monochrome terminal scene generator.

A small exploration tool for a square-only brand identity. Everything is drawn
from one primitive: the square. Squares scale, connect with lines, and invert
to solid white. No colour, no other shape.

Two compositing layers, both implemented from scratch:
  - Braille layer  (2x4 sub-pixels per cell)  -> all lines + hollow outlines
  - Half-block layer (1x2 sub-pixels per cell) -> solid white fills

Run:  python mpp.py        (requires: pip install blessed)

Keys: 1-9 jump to scene · [ ] cycle prev/next · space pause · r restart ·
      q (or Ctrl-C) quit

With no arguments this launches the interactive explorer (above). Additional
modes (see --help) wrap around the same renderer for accessibility and handoff:
  --screen-reader   plain-text alternative for the mark, no animation/glyphs
  --no-motion       a single static frame of a scene
  --banner [scene]  a short (<=3s) non-blocking launch animation
  --export <scene> --out <dir>   plain-text frames + manifest.json (the handoff
                                 format a downstream implementation consumes)
  --play <dir>      replay an exported frame directory (proves the round-trip)
Env: MPP_SCREEN_READER=1 / TERM=dumb -> screen-reader; MPP_REDUCED_MOTION=1 ->
no-motion; MPP_BANNER_SEEN=1 -> banner shows a static frame (models not-first-run).

To add another scene: copy one of the Scene subclasses below, give it a
`name`, fill in reset/update/draw, and add it to the SCENES list in main().
"""

import argparse
import json
import math
import os
import signal
import sys
import time

from blessed import Terminal


# ---------------------------------------------------------------------------
# Canvas: two composited sub-pixel layers
# ---------------------------------------------------------------------------
#
# Coordinate system for all drawing is "braille units": the braille layer has
# 2 sub-pixels wide x 4 tall per character cell. A character cell is roughly
# 1 wide : 2 tall, so a braille sub-pixel is ~square (cell_w/2 by cell_h/4 =
# cell_w/2 by cell_w/2). Working in these square units means a square drawn
# with equal extents on both axes *looks* square. The half-block layer is half
# this resolution (1x2 per cell), so one half-block sub-pixel spans 2x2 braille
# units and is likewise ~square.

# Braille dot bit values, indexed by (sub-x in 0..1, sub-y in 0..3).
#   dot layout:   1 4
#                 2 5
#                 3 6
#                 7 8
_BR_BITS = {
    (0, 0): 0x01, (0, 1): 0x02, (0, 2): 0x04, (0, 3): 0x40,
    (1, 0): 0x08, (1, 1): 0x10, (1, 2): 0x20, (1, 3): 0x80,
}

# Half-block glyphs, indexed by a 2-bit mask (bit0 = top half, bit1 = bottom).
_HALF = {1: "▀", 2: "▄", 3: "█"}  # ▀ ▄ █


class Canvas:
    def __init__(self, cols, rows):
        self.cols = cols
        self.rows = rows
        # Drawing extent in braille units (square units).
        self.wu = cols * 2
        self.hu = rows * 4
        self.braille = None
        self.half = None
        self.clear()

    def clear(self):
        # bytearray(n) is zero-filled in C; recreating is faster than looping.
        self.braille = [bytearray(self.cols) for _ in range(self.rows)]
        self.half = [bytearray(self.cols) for _ in range(self.rows)]
        self.chars = {}        # sparse (row, col) -> literal glyph override

    # -- whole-character glyphs (for crisp ramps; bypass the sub-pixel layers)
    def set_char(self, col, row, ch):
        """Place a literal glyph at character cell (col, row). Takes precedence
        over the Braille / half-block layers in compose()."""
        col = int(col)
        row = int(row)
        if 0 <= col < self.cols and 0 <= row < self.rows:
            self.chars[(row, col)] = ch

    # -- low-level sub-pixel writes ----------------------------------------
    def set_dot(self, x, y):
        """Set one braille sub-pixel at braille-unit (x, y)."""
        x = int(x)
        y = int(y)
        if x < 0 or y < 0 or x >= self.wu or y >= self.hu:
            return
        self.braille[y >> 2][x >> 1] |= _BR_BITS[(x & 1, y & 3)]

    def _half_set(self, hx, hy):
        """Set one half-block sub-pixel at half-block coords (hx, hy)."""
        if hx < 0 or hy < 0 or hx >= self.cols or hy >= self.rows * 2:
            return
        self.half[hy >> 1][hx] |= 1 if (hy & 1) == 0 else 2

    # -- primitives (all coords in braille units) --------------------------
    def line(self, x0, y0, x1, y1):
        dx = x1 - x0
        dy = y1 - y0
        n = int(max(abs(dx), abs(dy)))
        if n == 0:
            self.set_dot(x0, y0)
            return
        for i in range(n + 1):
            t = i / n
            self.set_dot(round(x0 + dx * t), round(y0 + dy * t))

    def square_outline(self, cx, cy, size, angle=0.0):
        """Hollow square outline (Braille layer), optionally rotated."""
        h = size / 2.0
        ca = math.cos(angle)
        sa = math.sin(angle)
        corners = ((-h, -h), (h, -h), (h, h), (-h, h))
        pts = [(cx + lx * ca - ly * sa, cy + lx * sa + ly * ca)
               for lx, ly in corners]
        for i in range(4):
            x0, y0 = pts[i]
            x1, y1 = pts[(i + 1) % 4]
            self.line(x0, y0, x1, y1)

    def rect_fill(self, cx, cy, w, h, angle=0.0):
        """Solid filled rectangle (Half-block layer), optionally rotated.

        Scanline over the half-block sub-pixels covering the rect's bounding
        box; each sub-pixel whose centre lies inside the (rotated) rect is
        filled. Works for any angle, so a diamond fills as crisply as a square.
        """
        hw, hh = w / 2.0, h / 2.0
        ca = math.cos(angle)
        sa = math.sin(angle)
        bound = math.hypot(hw, hh)  # worst-case half-extent once rotated
        hx0 = int((cx - bound) // 2) - 1
        hx1 = int((cx + bound) // 2) + 1
        hy0 = int((cy - bound) // 2) - 1
        hy1 = int((cy + bound) // 2) + 1
        for hy in range(hy0, hy1 + 1):
            by = hy * 2 + 1  # sub-pixel centre in braille units
            for hx in range(hx0, hx1 + 1):
                bx = hx * 2 + 1
                dx = bx - cx
                dy = by - cy
                lx = dx * ca + dy * sa
                ly = -dx * sa + dy * ca
                if abs(lx) <= hw and abs(ly) <= hh:
                    self._half_set(hx, hy)

    def square_fill(self, cx, cy, size, angle=0.0):
        """Solid white square — a square `rect_fill`."""
        self.rect_fill(cx, cy, size, size, angle)

    # -- compositing -------------------------------------------------------
    def compose(self):
        """Return a rows x cols grid of single-character strings.

        Rule: a literal char-layer glyph wins; else if the half-block layer has
        any fill, the half-block glyph; else the braille glyph; else a space.
        """
        chars = self.chars
        grid = []
        for r in range(self.rows):
            br = self.braille[r]
            hf = self.half[r]
            row = []
            for c in range(self.cols):
                glyph = chars.get((r, c)) if chars else None
                if glyph is not None:
                    row.append(glyph)
                    continue
                hv = hf[c]
                if hv:
                    row.append(_HALF[hv])
                else:
                    b = br[c]
                    row.append(chr(0x2800 + b) if b else " ")
            grid.append(row)
        return grid


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def _cubic_bezier(x1, y1, x2, y2):
    """Return an ease(x) for the CSS cubic-bezier with control points
    (x1, y1) and (x2, y2); endpoints are fixed at (0,0) and (1,1)."""
    def _coord(t, a, b):  # bezier coordinate, P0=0 and P3=1 baked in
        mt = 1.0 - t
        return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t

    def ease(x):
        if x <= 0.0:
            return 0.0
        if x >= 1.0:
            return 1.0
        lo, hi = 0.0, 1.0  # bisect for the t whose x-coord equals x
        for _ in range(24):
            t = (lo + hi) * 0.5
            if _coord(t, x1, x2) < x:
                lo = t
            else:
                hi = t
        return _coord((lo + hi) * 0.5, y1, y2)

    return ease


# Sharp, snappy easing, slow at both ends, quick through the middle
EASE = _cubic_bezier(0.85, 0.0, 0.15, 1.0)

# Golden angle (~137.5°) — successive phyllotaxis nodes step by this, which is
# what packs a sunflower and makes the Fibonacci spiral arms emerge.
_GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))

# Punchy "ease-out-back": overshoots its target then settles — the confident,
# slightly springy motion of a strong identity system.
EASE_BACK = _cubic_bezier(0.34, 1.56, 0.64, 1.0)

# Gentle, sine-like ease-in-out: eases at both ends without the near-stop of
# EASE, for motion that should feel smooth and continuous rather than snappy.
GENTLE = _cubic_bezier(0.37, 0.0, 0.63, 1.0)


def _project3d(x, y, z, cyaw, syaw, cpit, spit, cam):
    """Perspective-project a 3D point: yaw about Y, then pitch about X, then a
    pinhole camera at distance `cam` (nearer -> bigger). Pass pre-computed
    cos/sin. Returns screen offsets (already scaled — add the centre yourself),
    the depth factor f, and the rotated depth z2."""
    x1 = x * cyaw + z * syaw
    z1 = -x * syaw + z * cyaw
    y2 = y * cpit - z1 * spit
    z2 = y * spit + z1 * cpit
    f = cam / (cam - z2)
    return x1 * f, y2 * f, f, z2


# ---------------------------------------------------------------------------
# Scene base class
# ---------------------------------------------------------------------------
class Scene:
    name = "scene"

    def __init__(self):
        self.t = 0.0
        self._init_done = False

    def reset(self):
        """Re-randomise / rewind the scene to its start."""
        self.t = 0.0

    def update(self, dt):
        self.t += dt

    def draw(self, canvas):
        raise NotImplementedError

    def status(self):
        """Optional short string for the event log (e.g. a phase name)."""
        return ""


# ---------------------------------------------------------------------------
# Scene 1 — Field and connections
# ---------------------------------------------------------------------------
import random  # noqa: E402  (kept near the scene that uses it)


class FieldScene(Scene):
    name = "field & connections"

    # -- tunables ----------------------------------------------------------
    NODE_COUNT = 48        # total scattered nodes
    CONNECTED = 12         # nodes joined into the branching graph
    HUBS = 3           # number of radiating hub nodes
    EXTRA_EDGES = 8      # nearest-neighbour cross-links beyond the tree
    SIZE_MIN = 4           # node side length, braille units
    SIZE_MAX = 11
    LINE_DRAW_TIME = 0.6   # seconds for the graph to draw itself in
    GROW_FRAC = 0.1       # fraction of that window each edge spends growing
    # 3D / spatial motion
    ROT_SPEED = 0.22       # yaw, radians / second (slow continuous turn)
    PITCH_AMP = 0.42       # pitch wobble amplitude, radians
    PITCH_RATE = 0.35      # pitch wobble rate, radians / second
    PERSP = 5.8            # camera distance in cloud-radius units (smaller = stronger)
    FILL = 0.46            # cloud half-extent as a fraction of the short axis
    NODE_SPIN = 0.5        # how much node squares rotate with the yaw

    def reset(self):
        self.t = 0.0

        # Nodes carry normalised 3D positions in a unit sphere, so the cloud
        # stays centred and the rotation never swings a point past the camera.
        self.nodes = []
        for _ in range(self.NODE_COUNT):
            while True:
                x = random.uniform(-1, 1)
                y = random.uniform(-1, 1)
                z = random.uniform(-1, 1)
                if x * x + y * y + z * z <= 1.0:
                    break
            self.nodes.append({
                "nx": x, "ny": y, "nz": z,
                "size": random.randint(self.SIZE_MIN, self.SIZE_MAX),
            })

        # Build a branching graph over a connected subset. Start from a few
        # hubs; each new node attaches to its nearest already-placed node, so
        # lines radiate out rather than crossing randomly.
        connected = random.sample(range(self.NODE_COUNT), self.CONNECTED)
        tree = connected[:self.HUBS]
        self.edges = []  # (a, b) — drawn growing a -> b
        seen = set()
        for node in connected[self.HUBS:]:
            parent = min(tree, key=lambda p: self._dist2(p, node))
            self.edges.append((parent, node))
            seen.add(frozenset((parent, node)))
            tree.append(node)

        # Add a handful of nearest-neighbour cross-links so the graph reads as
        # a denser, more spatial web rather than a bare tree.
        candidates = []
        for node in connected:
            nearest = sorted((m for m in connected if m != node),
                             key=lambda m: self._dist2(node, m))[:2]
            for m in nearest:
                key = frozenset((node, m))
                if key not in seen:
                    candidates.append((self._dist2(node, m), node, m, key))
        candidates.sort(key=lambda c: c[0])  # prefer the shortest links
        for _, a, b, key in candidates:
            if len(self.edges) - (self.CONNECTED - self.HUBS) >= self.EXTRA_EDGES:
                break
            if key not in seen:
                self.edges.append((a, b))
                seen.add(key)

    def _dist2(self, a, b):
        na, nb = self.nodes[a], self.nodes[b]
        return ((na["nx"] - nb["nx"]) ** 2 + (na["ny"] - nb["ny"]) ** 2
                + (na["nz"] - nb["nz"]) ** 2)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        mind = min(wu, hu)
        cx, cy = wu / 2.0, hu / 2.0

        # Rotation: a slow continuous yaw about the vertical axis, plus a gentle
        # pitch wobble so the cloud rocks rather than spinning flatly.
        yaw = self.t * self.ROT_SPEED
        pitch = self.PITCH_AMP * math.sin(self.t * self.PITCH_RATE)
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        cpit, spit = math.cos(pitch), math.sin(pitch)

        radius = mind * self.FILL / (self.PERSP / (self.PERSP - 1))
        cam = self.PERSP * radius
        # The projection is isotropic (depth-stable); we stretch only the final
        # screen position per axis to fill the frame, leaving squares square.
        sx, sy = wu / mind, hu / mind

        def project(nx, ny, nz):
            x, y, z = nx * radius, ny * radius, nz * radius
            x1 = x * cyaw + z * syaw          # yaw about Y
            z1 = -x * syaw + z * cyaw
            y2 = y * cpit - z1 * spit         # pitch about X
            z2 = y * spit + z1 * cpit
            f = cam / (cam - z2)              # perspective: nearer -> larger
            return cx + x1 * f * sx, cy + y2 * f * sy, f, z2

        proj = [project(nd["nx"], nd["ny"], nd["nz"]) for nd in self.nodes]

        # Connecting lines draw in over LINE_DRAW_TIME, staggered so the web
        # cascades outward, each edge growing with a sharp eased ramp. Growth is
        # interpolated in 3D then projected, so it tracks the perspective.
        n = max(len(self.edges), 1)
        grow = self.LINE_DRAW_TIME * self.GROW_FRAC
        for i, (a, b) in enumerate(self.edges):
            start = (i / n) * (self.LINE_DRAW_TIME - grow)
            frac = EASE(_clamp((self.t - start) / grow, 0.0, 1.0))
            na, nb = self.nodes[a], self.nodes[b]
            ax, ay = proj[a][0], proj[a][1]
            bx, by, _, _ = project(
                na["nx"] + (nb["nx"] - na["nx"]) * frac,
                na["ny"] + (nb["ny"] - na["ny"]) * frac,
                na["nz"] + (nb["nz"] - na["nz"]) * frac)
            canvas.line(ax, ay, bx, by)

        # All nodes are hollow outlines (no fills); size scales with depth and
        # the squares rotate gently with the yaw.
        angle = yaw * self.NODE_SPIN
        for k, nd in enumerate(self.nodes):
            px, py, f, _ = proj[k]
            canvas.square_outline(px, py, nd["size"] * f, angle)

        # The wordmark pops in at the centre while the cloud turns behind it.
        draw_word_intro(canvas, self.t, width_frac=0.40, cycle=7.0,
                        hold=2.6, style="pop")


# ---------------------------------------------------------------------------
# Scene 2 — Travelling wave across a grid
# ---------------------------------------------------------------------------
class WaveScene(Scene):
    name = "travelling wave"

    # -- tunables ----------------------------------------------------------
    COLS = 16
    ROWS = 8
    SIZE_MIN = 3.0          # idle square side, braille units
    SIZE_MAX = 12.0         # square side at the wavefront peak
    BAND = 14.             # gaussian width of the activated band, braille units
    SWEEP_TIME = 3      # seconds for one full left->right sweep
    SOLID_THRESHOLD = 0.55  # activation above which a square inverts to solid
    ROTATE = True           # rotate toward a 45° diamond at the peak

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu

        # Evenly spaced, centred grid using 90% of the canvas.
        usable_w = wu * 0.9
        usable_h = hu * 0.9
        step_x = usable_w / (self.COLS - 1) if self.COLS > 1 else 0
        step_y = usable_h / (self.ROWS - 1) if self.ROWS > 1 else 0
        start_x = (wu - usable_w) / 2
        start_y = (hu - usable_h) / 2

        # Wavefront sweeps left->right and loops. The eased phase makes it
        # whip across the middle and ease in/out at the off-screen margins.
        span = wu + self.BAND * 2
        cycle = (self.t % self.SWEEP_TIME) / self.SWEEP_TIME
        wf = EASE(cycle) * span - self.BAND

        for gy in range(self.ROWS):
            cy = start_y + gy * step_y
            for gx in range(self.COLS):
                cx = start_x + gx * step_x
                d = cx - wf
                act = math.exp(-((d / self.BAND) ** 2))  # gaussian falloff
                size = self.SIZE_MIN + act * (self.SIZE_MAX - self.SIZE_MIN)
                angle = act * (math.pi / 4) if self.ROTATE else 0.0
                if act > self.SOLID_THRESHOLD:
                    canvas.square_fill(cx, cy, size, angle)
                else:
                    canvas.square_outline(cx, cy, size, angle)


# ---------------------------------------------------------------------------
# Scene 3 — Pseudo-3D spiral
# ---------------------------------------------------------------------------
class SpiralScene(Scene):
    name = "pseudo-3D spiral"

    # -- tunables ----------------------------------------------------------
    NUM_POINTS = 78
    TURNS = 2.5       # full revolutions along the helix
    ROT_SPEED = 0.6         # radians / second the whole helix spins
    RADIUS_FRAC = 0.45      # helix radius as fraction of min(wu, hu)
    HEIGHT_FRAC = 1.0      # vertical extent as fraction of hu
    BASE_SIZE = 5.0         # square side at the near plane, braille units
    FOCAL_FRAC = 1.5      # perspective focal distance, in radius units
    SOLID_DEPTH = 40     # depth factor above which a point inverts to solid

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        radius = min(wu, hu) * self.RADIUS_FRAC
        vext = hu * self.HEIGHT_FRAC
        focal = radius * self.FOCAL_FRAC

        # Project every helix point once.
        pts = []  # (px, py, depth_factor, z3)
        n = self.NUM_POINTS
        for i in range(n):
            frac = i / (n - 1)
            ang = frac * self.TURNS * 2 * math.pi + self.t * self.ROT_SPEED
            x3 = radius * math.cos(ang)
            z3 = radius * math.sin(ang)
            y3 = (frac - 0.5) * vext
            # Negative z is toward the viewer -> larger depth factor -> nearer.
            f = focal / (focal + z3)
            pts.append((cx + x3 * f, cy + y3 * f, f, z3))

        # Ribbon: connect consecutive points (Braille) as a continuous spiral.
        for i in range(n - 1):
            canvas.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])

        # Squares painted far-to-near so nearer (solid) ones land on top.
        for px, py, f, z3 in sorted(pts, key=lambda p: p[3], reverse=True):
            size = self.BASE_SIZE * f
            if f >= self.SOLID_DEPTH:
                canvas.square_fill(px, py, size)
            else:
                canvas.square_outline(px, py, size)

        # Wordmark sits at the eye of the spiral, popping in periodically.
        draw_word_intro(canvas, self.t, width_frac=0.34, cycle=7.5,
                        hold=2.8, style="pop")


# ---------------------------------------------------------------------------
# Scene 4 — Wordmark galaxy
# ---------------------------------------------------------------------------
#
# The "mpp" wordmark (solid half-block dots) sits centred and still while a
# slow spiral of small hollow squares orbits around it, each dragging a curved
# trailing line behind it along its orbit. Outer squares travel faster, so
# their trails are longer.

# Dot-matrix glyphs, '#' = a solid square dot. Each glyph is its own natural
# width (no padding column), so a single uniform gap sits between every pair.
# 7 rows tall, baseline at row 3: 'm' fills the x-height, 'p' adds a descender.
# When rendered, a horizontal run of cells becomes one continuous bar while
# vertical strokes stay as separate (dotted) squares — the canonical look.
_GLYPHS = {
    "m": ("#####",
          "#.#.#",
          "#.#.#",
          "#.#.#",
          ".....",
          ".....",
          "....."),
    "p": ("####",
          "#..#",
          "#..#",
          "####",
          "#...",
          "#...",
          "#..."),
}
_WORD = "mpp"
_GLYPH_H = 7
_GLYPH_GAP = 1


def _word_width():
    """Total width of the laid-out word, in dot columns."""
    return (sum(len(_GLYPHS[ch][0]) for ch in _WORD)
            + _GLYPH_GAP * (len(_WORD) - 1))


def _word_cells():
    """Yield (col, row) for every filled dot, col absolute across the word.

    Glyphs advance by their own width plus one gap, so spacing is uniform."""
    col = 0
    for ch in _WORD:
        rows = _GLYPHS[ch]
        for r, line in enumerate(rows):
            for c, bit in enumerate(line):
                if bit == "#":
                    yield col + c, r
        col += len(rows[0]) + _GLYPH_GAP


# The block wordmark — the canonical mpp mark used by the scenes module too
# (it imports these glyphs). Its own design (5x5 letters, the p's bars wider
# than the m), distinct from the dot-matrix _GLYPHS above.
_WM_M = ("#...#", "##.##", "#.#.#", "#...#", "#...#")
_WM_P = ("#####", "#...#", "#####", "#....", "#....")
_WM_HEIGHT = len(_WM_M)


def _wm_cells():
    """Lit (col, row) cells of the block wordmark 'mpp' and its width in cols.

    Same merge-free bitmap as `_word_cells`, just for the block glyphs: m, p, p
    laid out 5 wide each with a one-column gap."""
    cells = set()
    col = 0
    for glyph in (_WM_M, _WM_P, _WM_P):
        gw = len(glyph[0])
        for r, line in enumerate(glyph):
            for c, bit in enumerate(line):
                if bit == "#":
                    cells.add((col + c, r))
        col += gw + 1
    return cells, col - 1


_WM_CELLS, _WM_WIDTH = _wm_cells()


def word_elements(pitch, thick_frac=0.78):
    """Wordmark as drawable elements, with (0, 0) at the word's centre.

    Each horizontal run of filled cells becomes ONE element — a continuous bar
    when it spans 2+ cells, a square when it's a lone cell — so the canonical
    look is "solid horizontal bars + dotted vertical stems". Each element is a
    dict: x, y (centre offset, braille units), w, h (size), col (leftmost cell,
    for left-to-right ordering), row, cfrac (0..1 centre fraction across width)."""
    width = _word_width()
    thick = pitch * thick_frac
    cxw = (width - 1) / 2.0
    cyw = (_GLYPH_H - 1) / 2.0
    cells = set(_word_cells())
    denom = max(width - 1, 1)
    elems = []
    for r in range(_GLYPH_H):
        c = 0
        while c < width:
            if (c, r) in cells:
                c1 = c
                while (c1 + 1, r) in cells:
                    c1 += 1
                mid = (c + c1) / 2.0
                elems.append({
                    "x": (mid - cxw) * pitch,
                    "y": (r - cyw) * pitch,
                    "w": (c1 - c) * pitch + thick,   # lone cell -> thick (square)
                    "h": thick,
                    "col": c, "row": r, "cfrac": mid / denom,
                })
                c = c1 + 1
            else:
                c += 1
    return elems


def word_glyph_elements(pitch, thick_frac=0.78):
    """Per-glyph elements for scenes that move the letters independently.

    Returns one dict per glyph in the word: `center_x` (its centre offset from
    the word centre, in braille units), `elems` (bar/square elements relative
    to the glyph's own centre, same merge rule as word_elements), and `half`
    (the glyph's half-width, for finding its inner/outer edges)."""
    width = _word_width()
    cxw = (width - 1) / 2.0
    cyw = (_GLYPH_H - 1) / 2.0
    thick = pitch * thick_frac
    glyphs = []
    col0 = 0
    for ch in _WORD:
        rows = _GLYPHS[ch]
        gw = len(rows[0])
        gcw = (gw - 1) / 2.0                       # glyph centre column (local)
        elems = []
        for r in range(len(rows)):
            line = rows[r]
            c = 0
            while c < gw:
                if line[c] == "#":
                    c1 = c
                    while c1 + 1 < gw and line[c1 + 1] == "#":
                        c1 += 1
                    mid = (c + c1) / 2.0
                    elems.append({
                        "x": (mid - gcw) * pitch,
                        "y": (r - cyw) * pitch,
                        "w": (c1 - c) * pitch + thick,
                        "h": thick,
                    })
                    c = c1 + 1
                else:
                    c += 1
        half = max((abs(e["x"]) + e["w"] / 2.0) for e in elems) if elems else 0.0
        glyphs.append({
            "center_x": (col0 + gcw - cxw) * pitch,
            "elems": elems,
            "half": half,
        })
        col0 += gw + _GLYPH_GAP
    return glyphs


def word_fit_pitch(wu, width_frac, lo=3.0, hi=9.0):
    """Dot pitch that makes the wordmark span `width_frac` of `wu`."""
    return _clamp((width_frac * wu) / max(_word_width() - 1, 1), lo, hi)


def _word_phase(t, cycle, in_t, hold, out_t):
    """Return (phase, u) for the periodic intro: 'in'/'hold'/'out'/'off'."""
    tt = t % cycle
    if tt < in_t:
        return "in", tt / in_t
    tt -= in_t
    if tt < hold:
        return "hold", 1.0
    tt -= hold
    if tt < out_t:
        return "out", tt / out_t
    return "off", 0.0


def draw_word_intro(canvas, t, width_frac=0.42, cycle=6.5, in_t=0.7,
                    hold=2.4, out_t=0.6, style="pop", cx=None, cy=None):
    """Overlay the centred wordmark with a periodic animate-in/hold/out cycle.

    Drawn as solid bars/squares (which composite on top of Braille), so it reads
    cleanly over a busy scene; absent during the gap so the scene also breathes.
    Styles: 'pop' (scale up), 'rise' (slide up + scale), 'wipe' (reveal the
    columns left->right, matching scenes that sweep that way)."""
    phase, u = _word_phase(t, cycle, in_t, hold, out_t)
    if phase == "off":
        return
    wu, hu = canvas.wu, canvas.hu
    if cx is None:
        cx = wu / 2.0
    if cy is None:
        cy = hu / 2.0
    pitch = word_fit_pitch(wu, width_frac)
    g = EASE(u) if phase == "in" else 1.0 if phase == "hold" else EASE(1.0 - u)
    front = (EASE(u) if phase == "in"
             else 1.2 if phase == "hold" else 1.0 - EASE(u))

    for e in word_elements(pitch):
        s, oy = g, 0.0
        if style == "rise":
            oy = (1.0 - g) * pitch * 3.0
            s = 0.55 + 0.45 * g
        elif style == "wipe":
            s = _clamp((front - e["cfrac"]) / 0.18, 0.0, 1.0)
        if s * e["h"] > 0.8:
            canvas.rect_fill(cx + e["x"], cy + e["y"] + oy,
                             e["w"] * s, e["h"] * s)


class GalaxyScene(Scene):
    name = "wordmark galaxy"

    # -- tunables ----------------------------------------------------------
    PARTICLES = 64       # orbiting squares
    SPIRAL_TWIST = 3.2     # radians of spiral winding from inner to outer edge
    R_IN_CLEAR = 1.05    # inner radius = this * the wordmark's bounding radius
    R_OUT_FRAC = 0.35     # outer radius as a fraction of max(wu, hu)
    OMEGA = 0.11           # base angular speed, radians / second
    DIFF = 0.55            # extra angular speed toward the centre (winds the spiral)
    TRAIL_TIME = 4   # seconds of orbit shown as the trailing line
    TRAIL_SEG = 12         # line segments per trail (more = smoother curve)
    SQUARE_MIN = 3.5       # orbiting square side, braille units
    SQUARE_MAX = 5.2
    SQUARE_SPIN = 0.4      # max per-square idle spin, radians / second
    BREATH = 0.2           # radial breathing rate, radians / second
    BREATH_AMP = 0.05      # breathing amplitude as a fraction of the ring depth
    LOGO_WIDTH_FRAC = 2.0  # wordmark width as a fraction of wu

    def reset(self):
        self.t = 0.0
        self.particles = []
        for _ in range(self.PARTICLES):
            frac = random.random()           # even spread across the ring depth
            # Even angular distribution with a global spiral twist by radius;
            # differential rotation then winds it into evolving spiral arms.
            theta0 = random.uniform(0, 2 * math.pi) + self.SPIRAL_TWIST * frac
            self.particles.append({
                "frac": frac,
                "theta0": theta0,
                "omega": self.OMEGA * (1.0 + self.DIFF * (1.0 - frac)),
                "size": random.uniform(self.SQUARE_MIN, self.SQUARE_MAX),
                "spin": random.uniform(-self.SQUARE_SPIN, self.SQUARE_SPIN),
                "sq_phase": random.uniform(0, math.pi / 2),
                "trail_k": random.uniform(0.7, 1.4),
                "breath_phase": random.uniform(0, 2 * math.pi),
            })

    # -- the centred wordmark (bars + dotted stems) ------------------------
    def _draw_logo(self, canvas, cx, cy, pitch):
        for e in word_elements(pitch):
            canvas.rect_fill(cx + e["x"], cy + e["y"], e["w"], e["h"])

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0

        # Size the wordmark to the canvas, then derive the orbit clearance.
        total_cols = _word_width()
        pitch = _clamp((self.LOGO_WIDTH_FRAC * wu) / (total_cols - 1), 3.0, 8.0)
        logo_half_w = (total_cols - 1) / 2.0 * pitch
        logo_half_h = (_GLYPH_H - 1) / 2.0 * pitch
        logo_radius = math.hypot(logo_half_w, logo_half_h)

        r_in = logo_radius * self.R_IN_CLEAR
        r_out = max(r_in + 1.0, max(wu, hu) * self.R_OUT_FRAC)
        depth = r_out - r_in
        breath_amp = depth * self.BREATH_AMP

        # Galaxy first (Braille), wordmark last (half-block sits on top anyway).
        for p in self.particles:
            r = r_in + p["frac"] * depth
            r += breath_amp * math.sin(self.t * self.BREATH + p["breath_phase"])
            theta = p["theta0"] + p["omega"] * self.t

            # Trailing line: an arc along the orbit, from the past up to now.
            dtheta = p["omega"] * self.TRAIL_TIME * p["trail_k"]
            prev = None
            for k in range(self.TRAIL_SEG + 1):
                a = theta - dtheta * (1.0 - k / self.TRAIL_SEG)
                px = cx + r * math.cos(a)
                py = cy + r * math.sin(a)
                if prev is not None:
                    canvas.line(prev[0], prev[1], px, py)
                prev = (px, py)

            # The square itself, with a slow idle spin for life.
            sx = cx + r * math.cos(theta)
            sy = cy + r * math.sin(theta)
            angle = p["sq_phase"] + self.t * p["spin"]
            canvas.square_outline(sx, sy, p["size"], angle)

        self._draw_logo(canvas, cx, cy, pitch)


# ---------------------------------------------------------------------------
# Scene 5 — Grid reveal
# ---------------------------------------------------------------------------
#
# A regular grid of squares cycles through three phases on a loop:
#   1. DEFAULT — the plain grid of small hollow squares.
#   2. REVEAL  — a scan bar sweeps left->right; the grid cells that spell the
#                "mpp" wordmark invert to solid and stay lit behind the bar.
#   3. EXIT    — a scan bar sweeps right->left, wiping the wordmark away.
# The wordmark is the same dot-matrix as Scene 4, mapped onto the grid cells.


class GridScene(Scene):
    name = "grid reveal"

    # -- tunables ----------------------------------------------------------
    GRID_PITCH = 7.0       # target cell pitch, braille units
    DOT_FRAC = 0.2    # idle hollow square side as a fraction of the pitch
    SOLID_FRAC = 0.60      # lit/solid square side as a fraction of the pitch
    SCAN_W = 0.06          # half-width of the scan bar, fraction of grid width
    # Phase durations (seconds); the loop is the sum of these.
    T_DEFAULT = 1.0
    T_REVEAL = 1.5
    T_HOLD = 1.6
    T_EXIT = 1.5

    def _layout(self, canvas):
        """Grid dimensions, pitch and origin for the current canvas size."""
        wu, hu = canvas.wu, canvas.hu
        total_cols = _WM_WIDTH
        # Enough cells to hold the wordmark with a margin, denser on big screens.
        gcols = max(total_cols + 2, int(wu / self.GRID_PITCH))
        grows = max(_WM_HEIGHT + 2, int(hu / self.GRID_PITCH))
        # One uniform pitch keeps cells square; the grid is then centred.
        pitch = min(wu * 0.96 / gcols, hu * 0.96 / grows)
        gw, gh = gcols * pitch, grows * pitch
        x0 = (wu - gw) / 2.0
        y0 = (hu - gh) / 2.0
        return gcols, grows, pitch, x0, y0

    def _mask(self, gcols, grows):
        """Set of (col, row) grid cells that spell the wordmark, centred."""
        left = (gcols - _WM_WIDTH) // 2
        top = (grows - _WM_HEIGHT) // 2
        return {(left + col, top + r) for col, r in _WM_CELLS}

    def _phase(self):
        """Return (front, scan_x, scanning) for the current loop time.

        `front` is the normalised x up to which wordmark cells are revealed;
        `scan_x` is where the sweep bar sits; `scanning` gates the bar."""
        cycle = self.T_DEFAULT + self.T_REVEAL + self.T_HOLD + self.T_EXIT
        tt = self.t % cycle
        if tt < self.T_DEFAULT:
            return 0.0, 0.0, False
        tt -= self.T_DEFAULT
        if tt < self.T_REVEAL:
            front = EASE(tt / self.T_REVEAL)        # 0 -> 1, sweeps right
            return front, front, True
        tt -= self.T_REVEAL
        if tt < self.T_HOLD:
            return 1.0, 0.0, False                  # fully revealed, held
        tt -= self.T_HOLD
        front = 1.0 - EASE(tt / self.T_EXIT)        # 1 -> 0, wipes left
        return front, front, True

    def status(self):
        cycle = self.T_DEFAULT + self.T_REVEAL + self.T_HOLD + self.T_EXIT
        tt = self.t % cycle
        if tt < self.T_DEFAULT:
            return "DEFAULT"
        tt -= self.T_DEFAULT
        if tt < self.T_REVEAL:
            return "REVEAL"
        tt -= self.T_REVEAL
        if tt < self.T_HOLD:
            return "HOLD"
        return "EXIT"

    def draw(self, canvas):
        gcols, grows, pitch, x0, y0 = self._layout(canvas)
        mask = self._mask(gcols, grows)
        front, scan_x, scanning = self._phase()

        dot = pitch * self.DOT_FRAC
        solid = pitch * self.SOLID_FRAC
        denom = max(gcols - 1, 1)

        for gc in range(gcols):
            fx = gc / denom
            cx = x0 + (gc + 0.5) * pitch
            revealed = fx <= front + 1e-6
            # Scan-bar emphasis: peaks at the bar, falls off across SCAN_W.
            emph = 0.0
            if scanning:
                emph = _clamp(1.0 - abs(fx - scan_x) / self.SCAN_W, 0.0, 1.0)
            for gr in range(grows):
                cy = y0 + (gr + 0.5) * pitch
                act = max(1.0 if (revealed and (gc, gr) in mask) else 0.0, emph)
                size = dot + act * (solid - dot)
                if act > 0.5:
                    canvas.square_fill(cx, cy, size)
                else:
                    canvas.square_outline(cx, cy, size)


# ---------------------------------------------------------------------------
# Scene 6 — Wordmark typewriter
# ---------------------------------------------------------------------------
#
# The "mpp" dots pop in one at a time, left to right, each with a sharp eased
# scale-up; the word holds, then shrinks back out. Loops.
class WordTypewriterScene(Scene):
    name = "wordmark typewriter"

    WIDTH_FRAC = 0.50      # wordmark width as a fraction of wu
    POP_TIME = 0.22        # grow time per element, seconds
    STAGGER = 0.05         # delay between successive dots, seconds
    HOLD = 1.6             # seconds the whole word stays up
    OUT_TIME = 0.45        # seconds to shrink back out

    def _phase_times(self, n):
        build = (n - 1) * self.STAGGER + self.POP_TIME
        return build, build + self.HOLD, build + self.HOLD + self.OUT_TIME

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        pitch = word_fit_pitch(wu, self.WIDTH_FRAC)
        elems = word_elements(pitch)
        order = sorted(range(len(elems)),
                       key=lambda i: (elems[i]["col"], elems[i]["row"]))
        build, hold_end, cycle = self._phase_times(len(elems))
        tt = self.t % cycle

        for rank, i in enumerate(order):
            e = elems[i]
            if tt < build:
                s = EASE(_clamp((tt - rank * self.STAGGER) / self.POP_TIME,
                                0.0, 1.0))
            elif tt < hold_end:
                s = 1.0
            else:
                s = EASE(1.0 - (tt - hold_end) / self.OUT_TIME)
            if s * e["h"] > 0.6:
                canvas.rect_fill(cx + e["x"], cy + e["y"],
                                 e["w"] * s, e["h"] * s)

    def status(self):
        build, hold_end, cycle = self._phase_times(len(word_elements(1.0)))
        tt = self.t % cycle
        return "BUILD" if tt < build else "HOLD" if tt < hold_end else "OUT"


# ---------------------------------------------------------------------------
# Scene 7 — Wordmark 3D spin
# ---------------------------------------------------------------------------
#
# The flat "mpp" wordmark turns in space: a continuous yaw about the vertical
# axis plus a gentle pitch wobble, projected with perspective so it reads like
# a spinning card. Dots scale with depth and are painted far-to-near.
class Word3DScene(Scene):
    name = "wordmark 3D spin"

    WIDTH_FRAC = 0.46
    YAW_SPEED = 0.6        # radians / second
    PITCH_AMP = 0.26       # radians
    PITCH_RATE = 0.5       # radians / second
    PERSP = 2.6            # camera distance in word-half-width units

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        pitch = word_fit_pitch(wu, self.WIDTH_FRAC)

        halfw = max((_word_width() - 1) / 2.0 * pitch, 1.0)
        cam = self.PERSP * halfw
        yaw = self.t * self.YAW_SPEED
        pit = self.PITCH_AMP * math.sin(self.t * self.PITCH_RATE)
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        cpit, spit = math.cos(pit), math.sin(pit)

        def project(x, y):               # point on the z = 0 plane -> screen
            x1 = x * cyaw                 # yaw about Y (z is 0)
            z1 = -x * syaw
            y2 = y * cpit - z1 * spit     # pitch about X
            z2 = y * spit + z1 * cpit
            f = cam / (cam - z2)
            return cx + x1 * f, cy + y2 * f, f, z2

        # Project each element's two horizontal ends so bars foreshorten as the
        # card turns; render far-to-near.
        proj = []
        for e in word_elements(pitch):
            lx, ly, lf, lz = project(e["x"] - e["w"] / 2.0, e["y"])
            rx, ry, rf, rz = project(e["x"] + e["w"] / 2.0, e["y"])
            f = (lf + rf) / 2.0
            w = max(abs(rx - lx), e["h"] * f)   # keep lone squares squarish
            proj.append(((lx + rx) / 2.0, (ly + ry) / 2.0, w, e["h"] * f,
                         (lz + rz) / 2.0))

        for px, py, w, h, _ in sorted(proj, key=lambda p: p[4]):
            canvas.rect_fill(px, py, w, h)


# ---------------------------------------------------------------------------
# Scene 8 — Wordmark assemble
# ---------------------------------------------------------------------------
#
# Squares scattered across the frame fly in and lock into the "mpp" wordmark,
# hold, then scatter back out. While travelling they are small hollow squares
# that spin; once assembled they snap to solid. Loops.
class WordAssembleScene(Scene):
    name = "wordmark assemble"

    WIDTH_FRAC = 0.50
    IN_TIME = 1.3
    HOLD = 1.4
    OUT_TIME = 1.1
    SCATTER = 0.62         # start radius as a fraction of max(wu, hu)

    def reset(self):
        self.t = 0.0
        self.n = len(word_elements(1.0))
        self.starts = [(random.uniform(-1, 1), random.uniform(-1, 1))
                       for _ in range(self.n)]
        self.spins = [random.uniform(-3.5, 3.5) for _ in range(self.n)]

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        pitch = word_fit_pitch(wu, self.WIDTH_FRAC)
        elems = word_elements(pitch)

        cycle = self.IN_TIME + self.HOLD + self.OUT_TIME
        tt = self.t % cycle
        if tt < self.IN_TIME:
            p = EASE(tt / self.IN_TIME)
        elif tt < self.IN_TIME + self.HOLD:
            p = 1.0
        else:
            p = EASE(1.0 - (tt - self.IN_TIME - self.HOLD) / self.OUT_TIME)

        sr = max(wu, hu) * self.SCATTER
        scale = 0.45 + 0.55 * p
        for i, e in enumerate(elems):
            sx, sy = self.starts[i]
            stx, sty = cx + sx * sr, cy + sy * sr
            tgx, tgy = cx + e["x"], cy + e["y"]
            px = stx + (tgx - stx) * p
            py = sty + (tgy - sty) * p
            ang = self.spins[i] * (1.0 - p)   # spin while in flight, settle level
            canvas.rect_fill(px, py, e["w"] * scale, e["h"] * scale, ang)

    def status(self):
        cycle = self.IN_TIME + self.HOLD + self.OUT_TIME
        tt = self.t % cycle
        if tt < self.IN_TIME:
            return "ASSEMBLE"
        if tt < self.IN_TIME + self.HOLD:
            return "HOLD"
        return "SCATTER"


# ---------------------------------------------------------------------------
# Scene 9 — Wordmark zoom
# ---------------------------------------------------------------------------
#
# The wordmark rushes in from a far point, settles to full size, then bursts
# through the camera: the dots scale up about the centre (spreading apart and
# flying off-frame) with a slight twist. Loops.
class WordZoomScene(Scene):
    name = "wordmark zoom"

    WIDTH_FRAC = 0.52
    IN_TIME = 1.0
    HOLD = 1.1
    THRU_TIME = 0.9
    START_SCALE = 0.08
    END_SCALE = 0.4
    TWIST = 0.6            # radians of swing across the zoom

    def _scale(self):
        cycle = self.IN_TIME + self.HOLD + self.THRU_TIME
        tt = self.t % cycle
        if tt < self.IN_TIME:
            return self.START_SCALE + (1.0 - self.START_SCALE) * EASE(
                tt / self.IN_TIME)
        if tt < self.IN_TIME + self.HOLD:
            return 1.0
        o = EASE((tt - self.IN_TIME - self.HOLD) / self.THRU_TIME)
        return 1.0 + (self.END_SCALE - 1.0) * o

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        pitch = word_fit_pitch(wu, self.WIDTH_FRAC)
        s = self._scale()
        ang = self.TWIST * (s - 1.0)
        ca, sa = math.cos(ang), math.sin(ang)
        for e in word_elements(pitch):
            rx, ry = e["x"] * s, e["y"] * s
            px = cx + rx * ca - ry * sa
            py = cy + rx * sa + ry * ca
            if e["h"] * s > 0.6:
                canvas.rect_fill(px, py, e["w"] * s, e["h"] * s, ang)

    def status(self):
        cycle = self.IN_TIME + self.HOLD + self.THRU_TIME
        tt = self.t % cycle
        if tt < self.IN_TIME:
            return "ZOOM-IN"
        if tt < self.IN_TIME + self.HOLD:
            return "HOLD"
        return "THROUGH"


# ---------------------------------------------------------------------------
# Scene 10 — Rotating cube
# ---------------------------------------------------------------------------
#
# A wireframe cube (the square, extruded) tumbling on two axes, drawn as
# Braille edges with a small square at each vertex; near vertices invert to
# solid to imply depth.
class CubeScene(Scene):
    name = "rotating cube"

    SIZE_FRAC = 0.30       # cube half-extent as a fraction of the short axis
    YAW_SPEED = 0.5
    PITCH_SPEED = 0.31
    PERSP = 3.2            # camera distance in cube-radius units
    VERT_SIZE = 4.0        # vertex square side, braille units

    # 8 cube corners and the 12 edges joining single-coordinate neighbours.
    _VERTS = [((i >> 2 & 1) * 2 - 1, (i >> 1 & 1) * 2 - 1, (i & 1) * 2 - 1)
              for i in range(8)]
    _EDGES = [(i, i ^ b) for i in range(8) for b in (4, 2, 1) if not (i & b)]

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        r = min(wu, hu) * self.SIZE_FRAC
        cam = self.PERSP * r
        yaw = self.t * self.YAW_SPEED
        pit = self.t * self.PITCH_SPEED
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        cpit, spit = math.cos(pit), math.sin(pit)

        proj = []
        for vx, vy, vz in self._VERTS:
            x, y, z = vx * r, vy * r, vz * r
            x1 = x * cyaw + z * syaw
            z1 = -x * syaw + z * cyaw
            y2 = y * cpit - z1 * spit
            z2 = y * spit + z1 * cpit
            f = cam / (cam - z2)
            proj.append((cx + x1 * f, cy + y2 * f, f, z2))

        for a, b in self._EDGES:
            canvas.line(proj[a][0], proj[a][1], proj[b][0], proj[b][1])

        near = max(p[3] for p in proj)
        for px, py, f, z2 in sorted(proj, key=lambda p: p[3]):
            if z2 > near - 1e-6 or f > 1.15:
                canvas.square_fill(px, py, self.VERT_SIZE * f)
            else:
                canvas.square_outline(px, py, self.VERT_SIZE * f)


# ---------------------------------------------------------------------------
# Scene 11 — Starfield
# ---------------------------------------------------------------------------
#
# Squares stream toward the viewer out of a vanishing point: each has a 3D
# position whose depth shrinks every frame, so it accelerates outward and
# grows, dragging a short streak. The nearest invert to solid. Respawns at the
# back when it passes the camera.
class StarfieldScene(Scene):
    name = "starfield"

    COUNT = 70
    SPEED = 0.45           # depth units / second toward the camera
    NEAR = 0.20            # respawn once depth drops below this
    SPREAD = 0.13          # screen spread factor (× wu/hu)
    SIZE = 2.2             # square side at depth 1, braille units
    MAX_SIZE = 9.0         # cap so near squares stay points, not slabs
    SOLID_Z = 0.34         # invert to solid below this depth

    def reset(self):
        self.t = 0.0
        self.stars = [self._spawn(random.uniform(self.NEAR, 1.0))
                      for _ in range(self.COUNT)]

    def _spawn(self, z):
        return {"x": random.uniform(-1, 1), "y": random.uniform(-1, 1),
                "z": z, "px": None, "py": None, "fresh": True}

    def update(self, dt):
        self.t += dt
        for s in self.stars:
            s["z"] -= self.SPEED * dt
            if s["z"] <= self.NEAR:
                s.update(self._spawn(1.0))

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        sx, sy = wu * self.SPREAD, hu * self.SPREAD
        for s in self.stars:
            inv = 1.0 / s["z"]
            px = cx + s["x"] * inv * sx
            py = cy + s["y"] * inv * sy
            size = min(self.SIZE * inv, self.MAX_SIZE)
            if not s["fresh"] and s["px"] is not None:
                canvas.line(s["px"], s["py"], px, py)   # motion streak
            if s["z"] < self.SOLID_Z:
                canvas.square_fill(px, py, size)
            else:
                canvas.square_outline(px, py, size)
            s["px"], s["py"], s["fresh"] = px, py, False

        # Wordmark zooms in at the vanishing point as the stars stream past.
        draw_word_intro(canvas, self.t, width_frac=0.42, cycle=6.5,
                        hold=2.4, style="pop")


# --- value-noise helpers (no library; hashed lattice + smoothstep) ---------
def _vhash(ix, iy):
    """Deterministic pseudo-random value in [0, 1) for integer lattice point."""
    h = (ix * 374761393 + iy * 668265263) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFF) / 65535.0


def _value_noise(x, y):
    """Smooth 2D value noise in [0, 1] (bilinear smoothstep over the lattice)."""
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    u = fx * fx * (3 - 2 * fx)
    v = fy * fy * (3 - 2 * fy)
    a = _vhash(ix, iy)
    b = _vhash(ix + 1, iy)
    c = _vhash(ix, iy + 1)
    d = _vhash(ix + 1, iy + 1)
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def _fbm(x, y, octaves=3):
    """Fractal (layered) value noise in [0, 1] for organic texture."""
    total, amp, freq, norm = 0.0, 0.5, 1.0, 0.0
    for _ in range(octaves):
        total += amp * _value_noise(x * freq, y * freq)
        norm += amp
        amp *= 0.5
        freq *= 2.0
    return total / norm


# ---------------------------------------------------------------------------
# Scene 12 — Noise field
# ---------------------------------------------------------------------------
#
# A grid of squares driven by drifting fractal noise. The activity originates
# at the left edge and washes rightward: a soft crest sweeps left->right, and
# wherever it passes the noise blooms (squares grow and invert to solid), then
# settles back to a faint grid as the crest moves on. The crest loops
# seamlessly, so fresh noise keeps being born at the left.
class NoiseScene(Scene):
    name = "noise field"

    PITCH = 6.0            # cell pitch, braille units
    DOT_FRAC = 0.15        # faint idle square side as a fraction of the pitch
    SOLID_FRAC = 0.74      # bloomed square side as a fraction of the pitch
    NOISE_SCALE = 0.24     # noise features per grid cell (smaller = larger blobs)
    FLOW = 0.55            # rightward drift of the noise texture, /second
    BOIL = 0.35            # vertical churn of the texture, /second
    WAVE_K = 4.8           # crest spatial frequency across the width (radians)
    WAVE_SPEED = 1.4       # crest travel rate (left -> right), /second
    GAMMA = 0.85         # contrast shaping of the activity (>1 keeps texture)
    SOLID_T = 0.40         # activity above which a square inverts to solid

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        gcols = max(2, int(wu / self.PITCH))
        grows = max(2, int(hu / self.PITCH))
        pitch = min(wu / gcols, hu / grows)
        x0 = (wu - gcols * pitch) / 2.0
        y0 = (hu - grows * pitch) / 2.0
        dot = pitch * self.DOT_FRAC
        solid = pitch * self.SOLID_FRAC
        denom = max(gcols - 1, 1)

        for gx in range(gcols):
            fx = gx / denom
            cxp = x0 + (gx + 0.5) * pitch
            # Rightward-travelling crest: high on its leading face, low behind,
            # so blooms originate at the left and spread across to the right.
            gate = 0.5 + 0.5 * math.sin(fx * self.WAVE_K - self.t * self.WAVE_SPEED)
            nx = gx * self.NOISE_SCALE - self.t * self.FLOW
            for gy in range(grows):
                cyp = y0 + (gy + 0.5) * pitch
                n = _fbm(nx, gy * self.NOISE_SCALE + self.t * self.BOIL)
                act = (n * gate) ** self.GAMMA
                size = dot + act * (solid - dot)
                if act > self.SOLID_T:
                    canvas.square_fill(cxp, cyp, size)
                else:
                    canvas.square_outline(cxp, cyp, size)

        # Wordmark wipes in left->right, riding the same wash as the noise.
        draw_word_intro(canvas, self.t, width_frac=0.80, cycle=6.0,
                        in_t=3.15, hold=1., out_t=0.6, style="wipe")


# ---------------------------------------------------------------------------
# Scene 13 — Orbiting rings
# ---------------------------------------------------------------------------
#
# Concentric rings of squares, tilted into ellipses so they read as 3D discs,
# counter-rotating at different speeds. Each ring's squares are joined into a
# polygon outline; a solid square marks the hub.
class RingsScene(Scene):
    name = "orbiting rings"

    RINGS = 6
    BASE_COUNT = 6         # squares on the innermost ring (+2 per ring out)
    SPEED = 0.6            # base angular speed, radians / second
    TILT = 1.85            # disc tilt, radians (sets the ellipse squash)
    TILT_WOBBLE = 0.9     # tilt oscillation amplitude
    SQUARE = 4.0           # ring square side, braille units
    HUB = 0.0              # centre square side, braille units

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        base = min(wu, hu) * 0.5
        tilt = self.TILT + self.TILT_WOBBLE * math.sin(self.t * 0.3)
        yscale = math.cos(tilt)                    # vertical squash -> ellipse

        for i in range(self.RINGS):
            # Rings sit in an annulus, leaving the centre clear for the hub/word.
            r = base * (0.5 + 0.5 * (i + 1) / self.RINGS)
            count = self.BASE_COUNT + 2 * i
            omega = self.SPEED * (-1 if i % 2 else 1) / (1.0 + 0.5 * i)
            a0 = self.t * omega
            pts = []
            for j in range(count):
                a = a0 + j * 2 * math.pi / count
                pts.append((cx + r * math.cos(a), cy + r * math.sin(a) * yscale))
            for j in range(count):                 # ring polygon
                x0, y0 = pts[j]
                x1, y1 = pts[(j + 1) % count]
                canvas.line(x0, y0, x1, y1)
            for px, py in pts:
                canvas.square_outline(px, py, self.SQUARE)

        canvas.square_fill(cx, cy, self.HUB)

        # The rings orbit around the wordmark, which pops in at the hub.
        draw_word_intro(canvas, self.t, width_frac=0.22, cycle=7.0,
                        hold=2.6, style="pop")


# ---------------------------------------------------------------------------
# Scene 14 — Spiral bloom (phyllotaxis / sunflower)
# ---------------------------------------------------------------------------
#
# A seamless loop. Nodes emit one-by-one from a single centre seed; each takes
# the next golden angle and drifts outward with a sqrt(age) radius, so the live
# field is a sunflower (Vogel's phyllotaxis) with Fibonacci spiral arms:
#   1. one node at the centre,
#   2. the sunflower grows outward from it,
#   3. the disc fills,
#   4. emission stops so the centre empties (negative space),
#   5. the wordmark wipes in left->right while the last nodes trail off.
# Every node has aged out by the end of the cycle, so it rejoins the single
# seed with no seam.
class BloomScene(Scene):
    name = "spiral bloom"

    N_EMIT = 82           # seeds emitted per cycle (sunflower density)
    CYCLE = 7.0            # seconds per loop
    LIFE = 0.8            # node lifespan as a fraction of the cycle
    EMIT_END = 0.40        # last birth time (fraction); after this the centre empties
    R_FRAC = 0.85    # max drift radius as a fraction of the short axis
    ROT_TURNS = 1.5        # whole-pattern turns per cycle (seam is empty either way)
    TRAIL_AGE = 0.04       # comet-tail length, in life-fraction
    TRAIL_SEG = 8          # segments per tail
    NODE_MIN = 4.2         # node square side near the centre, braille units
    NODE_MAX = 4.2         # node square side at the rim

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = (self.t % self.CYCLE) / self.CYCLE
        rmax = min(wu, hu) * self.R_FRAC
        k_rad = rmax / math.sqrt(self.LIFE)        # radius = k_rad * sqrt(age)
        spin = 2 * math.pi * self.ROT_TURNS

        for k in range(self.N_EMIT):
            birth = (k / self.N_EMIT) * self.EMIT_END
            age = u - birth
            if age < 0.0 or age > self.LIFE:
                continue
            base_ang = k * _GOLDEN_ANGLE
            size = (self.NODE_MIN
                    + (self.NODE_MAX - self.NODE_MIN) * (age / self.LIFE))
            # Head, then comet-tail sampled back in time: radius follows
            # sqrt(age) and the angle carries the running rotation, so the tail
            # curves the way the node actually drifted (golden ray + spin).
            head = prev = None
            for j in range(self.TRAIL_SEG + 1):
                aval = age - (j / self.TRAIL_SEG) * self.TRAIL_AGE
                if aval < 0.0:
                    break
                tau = u - (age - aval)
                r = k_rad * math.sqrt(aval)
                ang = base_ang + spin * tau
                x, y = cx + r * math.cos(ang), cy + r * math.sin(ang)
                if head is None:
                    head = (x, y)
                if prev is not None:
                    canvas.line(prev[0], prev[1], x, y)
                prev = (x, y)
            if head is not None:
                canvas.square_outline(head[0], head[1], size)

        # The wordmark wipes in left->right during the empty/trailing phase and
        # wipes away again before the loop point (offset so it is absent at u=0).
        draw_word_intro(canvas, self.t - 0.52 * self.CYCLE, width_frac=0.42,
                        cycle=self.CYCLE, in_t=0.13 * self.CYCLE,
                        hold=0.18 * self.CYCLE, out_t=0.13 * self.CYCLE,
                        style="wipe")

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < 0.04:
            return "SEED"
        if u < self.EMIT_END:
            return "EXPAND"
        if u < 0.55:
            return "EMPTYING"
        return "WORDMARK"


# ---------------------------------------------------------------------------
# Scene 15 — Wordmark relay
# ---------------------------------------------------------------------------
#
# A typographic sequence with strong, springy easing (studio-poster energy):
#   1. the wordmark animates in left to right,
#   2. the letters spread apart from the centre (overshoot, then settle),
#   3. a line of nodes relays along the path from the middle p to the end p,
#   4. then the baton continues from the end p across to the m,
#   5. the nodes animate out,
#   6. the letters spring back to their tight lockup.
# A short wipe-out returns it to empty so the loop rejoins the start.
class RelayScene(Scene):
    name = "wordmark relay"

    CYCLE = 8.0
    WIDTH_FRAC = 0.32      # tight wordmark width as a fraction of wu
    SPREAD_MULT = 1.9      # how far the letters fan out from centre
    GLYPH_STAGGER = 0.22   # left-to-right delay between letters on wipe in/out
    RELAY_NODES = 4        # nodes that travel each path
    RELAY_STAGGER = 0.18   # launch delay between nodes (fraction of the travel)
    NODE_FRAC = 0.7        # node square side as a fraction of the pitch

    # Phase windows (fractions of the cycle).
    WIPE_IN = (0.00, 0.12)
    SPREAD = (0.15, 0.28)
    PP_IN = (0.31, 0.46)   # relay: nodes travel middle p -> right p
    PP_OUT = (0.48, 0.55)  # those nodes shrink away
    PM_IN = (0.55, 0.70)   # relay: nodes travel middle p -> m
    PM_OUT = (0.72, 0.80)  # animate the nodes out
    UNSPREAD = (0.82, 0.92)
    WIPE_OUT = (0.93, 1.00)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = (self.t % self.CYCLE) / self.CYCLE
        pitch = word_fit_pitch(wu, self.WIDTH_FRAC)
        glyphs = word_glyph_elements(pitch)
        node = pitch * self.NODE_FRAC

        def seg(win):
            a, b = win
            return _clamp((u - a) / (b - a), 0.0, 1.0)

        # Letters fan out from centre (springy overshoot), hold, then return.
        sp = EASE_BACK(seg(self.SPREAD)) * (1.0 - EASE(seg(self.UNSPREAD)))
        pin = seg(self.WIPE_IN)
        pout = seg(self.WIPE_OUT)
        stag_span = 1.0 + 2.0 * self.GLYPH_STAGGER

        centers = []
        for i, g in enumerate(glyphs):
            # Per-glyph staggered scale-pop: wipe in (L->R), wipe out (L->R).
            a_i = EASE(_clamp(pin * stag_span - i * self.GLYPH_STAGGER, 0.0, 1.0))
            c_i = EASE(_clamp(pout * stag_span - i * self.GLYPH_STAGGER, 0.0, 1.0))
            gscale = a_i * (1.0 - c_i)
            cxg = cx + g["center_x"] * (1.0 + sp * (self.SPREAD_MULT - 1.0))
            centers.append(cxg)
            if gscale > 0.04:
                for e in g["elems"]:
                    canvas.rect_fill(cxg + e["x"], cy + e["y"],
                                     e["w"] * gscale, e["h"] * gscale)

        # Relay: a short train of nodes that actually travels from the source
        # glyph's edge to the target's, with a strong ease (staggered launches
        # spread them along the path while in motion), arrives, then shrinks out.
        def relay(i_src, i_dst, win_in, win_out):
            sgn = 1.0 if i_dst > i_src else -1.0
            xs = centers[i_src] + glyphs[i_src]["half"] * sgn
            xd = centers[i_dst] - glyphs[i_dst]["half"] * sgn
            tin = seg(win_in)
            shrink = EASE(seg(win_out))          # 0 while travelling, 1 = gone
            if tin <= 0.0 and shrink <= 0.0:
                return
            travel = max(1.0 - self.RELAY_STAGGER * (self.RELAY_NODES - 1), 0.1)
            for i in range(self.RELAY_NODES):
                launch = i * self.RELAY_STAGGER
                if tin < launch and shrink <= 0.0:
                    continue                     # this node hasn't launched yet
                p = EASE(_clamp((tin - launch) / travel, 0.0, 1.0))
                x = xs + (xd - xs) * p           # actual A -> B travel
                s = node * (1.0 - shrink)
                if s > 0.6:
                    canvas.square_fill(x, cy, s)

        relay(1, 2, self.PP_IN, self.PP_OUT)   # 03: middle p -> end p
        relay(2, 0, self.PM_IN, self.PM_OUT)   # 04/05: end p -> m (baton continues)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < 0.13:
            return "WIPE-IN"
        if u < 0.30:
            return "SPREAD"
        if u < 0.55:
            return "RELAY P-P"
        if u < 0.81:
            return "RELAY P-M"
        if u < 0.93:
            return "RETURN"
        return "WIPE-OUT"


# ---------------------------------------------------------------------------
# Runner: loop, input, resize, teardown
# ---------------------------------------------------------------------------
SIM_DT = 1.0 / 60.0    # fixed simulation timestep
FRAME_DT = 1.0 / 30.0  # target draw cadence (~30 fps)


class EventLog:
    """Append-only line log of runtime events, followed by `logview.py`.

    Lines look like:  12:34:56.789  +12.3s  SCENE   wordmark galaxy
    If the file cannot be opened, logging silently becomes a no-op."""

    def __init__(self, path):
        self.f = None
        self.t0 = time.monotonic()
        try:
            self.f = open(path, "a", buffering=1)  # line-buffered
        except OSError:
            self.f = None

    def event(self, kind, msg=""):
        if not self.f:
            return
        t = time.time()
        stamp = time.strftime("%H:%M:%S", time.localtime(t))
        rel = time.monotonic() - self.t0
        try:
            self.f.write("%s.%03d  +%7.1fs  %-7s %s\n"
                         % (stamp, int((t % 1) * 1000), rel, kind, msg))
        except OSError:
            pass

    def close(self):
        if self.f:
            try:
                self.f.close()
            except OSError:
                pass


def log_path():
    """Where events are written; shared with logview.py (override: $MPP_LOG)."""
    return os.environ.get("MPP_LOG") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "mpp.log")


_REV_ON = "\033[7m"     # reverse video on  (cell drawn in the foreground colour)
_REV_OFF = "\033[27m"   # reverse video off


def _solidify(s):
    """Render runs of full-block █ as reverse-video spaces for live display.

    Many terminal fonts inset the █ glyph slightly, so tiled █ shows a faint
    grid of seams. A space painted in reverse video fills the whole cell as its
    background — which tiles with no seams in any terminal — so solid regions
    read as clean blocks. Half-block ▀▄ and Braille glyphs are left untouched.
    SGR is balanced within the returned string. Only used for the interactive
    display; exported/piped frames keep the plain █ (no control codes)."""
    if "█" not in s:
        return s
    out = []
    rev = False
    for ch in s:
        if ch == "█":
            if not rev:
                out.append(_REV_ON)
                rev = True
            out.append(" ")
        else:
            if rev:
                out.append(_REV_OFF)
                rev = False
            out.append(ch)
    if rev:
        out.append(_REV_OFF)
    return "".join(out)


def _paint(term, out, grid, prev):
    """Diff `grid` against `prev` and append only changed runs to `out`."""
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    for r in range(rows):
        row = grid[r]
        prow = prev[r] if (prev is not None and r < len(prev)
                           and len(prev[r]) == cols) else None
        c = 0
        while c < cols:
            if prow is None or row[c] != prow[c]:
                start = c
                seg = []
                while c < cols and (prow is None or row[c] != prow[c]):
                    seg.append(row[c])
                    c += 1
                out.append(term.move_xy(start, r) + _solidify("".join(seg)))
            else:
                c += 1


def _run_static(scenes):
    """No TTY: render one frame of the first scene without control codes."""
    canvas = Canvas(80, 24)
    scenes[0].reset()
    scenes[0].update(0.5)  # nudge past t=0 so lines have drawn in
    scenes[0].draw(canvas)
    for row in canvas.compose():
        sys.stdout.write("".join(row) + "\n")


def _make_scenes():
    """The scene registry — shared by the interactive explorer and all modes."""
    from scenes import make_scenes as _extra_scenes
    return [
        FieldScene(), WaveScene(), SpiralScene(), GalaxyScene(), GridScene(),
        WordTypewriterScene(), Word3DScene(), WordAssembleScene(),
        WordZoomScene(),
        CubeScene(), StarfieldScene(), NoiseScene(), RingsScene(),
        BloomScene(), RelayScene(),
    ] + _extra_scenes()


def _run_interactive(scenes):
    """The default interactive explorer (behaviour unchanged)."""
    term = Terminal()
    if not sys.stdout.isatty():
        _run_static(scenes)
        return

    idx = 0
    paused = False
    scenes[idx].reset()

    log = EventLog(log_path())
    log.event("START", "%dx%d term, scene=%s" % (term.width, term.height,
                                                  scenes[idx].name))

    # Handle Ctrl-C / SIGINT by flipping a flag and breaking out of the loop
    # normally, rather than letting a KeyboardInterrupt unwind the stack at an
    # arbitrary point. This guarantees the context managers below tear down in
    # their normal order. (SIGWINCH needs no handler: we re-read the terminal
    # size every frame, so resizes are picked up regardless.)
    stop = {"flag": False}

    def _on_sigint(_signum, _frame):
        stop["flag"] = True

    prev_sigint = signal.signal(signal.SIGINT, _on_sigint)

    # fullscreen -> alternate screen buffer; hidden_cursor -> hide+restore
    # cursor; cbreak -> unbuffered keys. All three restore on ANY exit,
    # including exceptions, so teardown is guaranteed.
    try:
        with term.fullscreen(), term.hidden_cursor(), term.cbreak():
            canvas = None
            prev_grid = None
            prev_dims = None
            force = True
            last = time.monotonic()
            acc = 0.0
            frames = 0                 # frames since the last STATUS line
            status_last = last         # when the last STATUS line was written
            prev_status = scenes[idx].status()

            while not stop["flag"]:
                cols = term.width
                crows = max(term.height, 1)  # the scene fills the whole screen

                # Resize (or first frame): rebuild canvas and full-repaint.
                if (cols, term.height) != prev_dims:
                    if prev_dims is not None:
                        log.event("RESIZE", "%dx%d" % (cols, term.height))
                    prev_dims = (cols, term.height)
                    canvas = Canvas(cols, crows)
                    prev_grid = None
                    force = True
                    sys.stdout.write(term.home + term.clear)

                # Fixed-timestep simulation decoupled from draw.
                now = time.monotonic()
                dt = now - last
                last = now
                if dt > 0.25:
                    dt = 0.25  # avoid spiral-of-death after a stall
                acc += dt
                while acc >= SIM_DT:
                    if not paused:
                        scenes[idx].update(SIM_DT)
                    acc -= SIM_DT

                # Draw into the canvas and composite.
                canvas.clear()
                scenes[idx].draw(canvas)
                grid = canvas.compose()

                out = []
                _paint(term, out, grid, None if force else prev_grid)
                # Tiny scene number in the bottom-left corner, dim and drawn over
                # the frame every tick so the scene can't paint it away.
                out.append(term.move_xy(1, crows - 1)
                           + "\033[2m" + str(idx + 1) + "\033[22m")
                sys.stdout.write("".join(out))
                sys.stdout.flush()
                prev_grid = grid
                force = False

                # Log phase transitions as they happen, plus a ~1s heartbeat
                # carrying the measured frame rate.
                frames += 1
                st = scenes[idx].status()
                if st != prev_status:
                    if st:
                        log.event("PHASE", "%s: %s" % (scenes[idx].name, st))
                    prev_status = st
                if now - status_last >= 1.0:
                    fps = frames / (now - status_last)
                    extra = " phase=%s" % st if st else ""
                    pstate = " PAUSED" if paused else ""
                    log.event("STATUS", "scene=%s fps=%4.1f%s%s"
                              % (scenes[idx].name, fps, extra, pstate))
                    frames = 0
                    status_last = now

                # Input doubles as the frame limiter.
                key = term.inkey(timeout=FRAME_DT)
                if stop["flag"]:
                    break
                if not key:
                    continue
                ch = str(key).lower()
                new_idx = None
                if ch == "q":
                    break
                elif ch.isdigit() and 1 <= int(ch) <= len(scenes):
                    new_idx = int(ch) - 1
                elif key.name == "KEY_RIGHT" or ch == "]":
                    new_idx = (idx + 1) % len(scenes)
                elif key.name == "KEY_LEFT" or ch == "[":
                    new_idx = (idx - 1) % len(scenes)
                elif key == " ":
                    paused = not paused
                    log.event("PAUSE", "on" if paused else "off")
                elif ch == "r":
                    scenes[idx].reset()
                    log.event("RESTART", scenes[idx].name)
                    force = True
                if new_idx is not None:
                    idx = new_idx
                    scenes[idx].reset()
                    prev_status = scenes[idx].status()
                    force = True
                    log.event("SCENE", "%d %s" % (idx + 1, scenes[idx].name))
    except KeyboardInterrupt:
        pass  # backstop: context managers above restore the terminal cleanly
    finally:
        signal.signal(signal.SIGINT, prev_sigint)
        log.event("STOP", "ctrl-c" if stop["flag"] else "quit")
        log.close()


# ---------------------------------------------------------------------------
# Accessibility & handoff modes (argparse-selected; default stays interactive)
# ---------------------------------------------------------------------------
#
# These wrap the existing renderer, they do not replace it. The colour-role
# machinery from the source article does not apply: this system is monochrome
# by design, so the only degradation axis is motion/representation, not colour.
# Degradation order: animated -> single static frame -> plain squares -> the
# "mpp" text alternative (used by the screen-reader path).

MARK_ALT = "mpp"             # the mark is a graphic; this is its text alternative
BANNER_MAX_SECONDS = 3.0     # launch animation stays short and non-blocking
STATIC_SETTLE_SECONDS = 1.5  # how far into a scene a "settled" static frame sits
EXPORT_COLS = 96             # fixed export canvas (terminal-independent, reproducible)
EXPORT_ROWS = 28
EXPORT_FRAMES = 90           # default frames for --export
EXPORT_FPS = 30              # default fps for --export / --play

# Plain-language, glyph-free descriptions for the screen-reader / manifest text.
SCENE_BLURBS = {
    "field & connections": "a constellation of nodes joined by lines",
    "travelling wave": "a wave sweeping across a grid of squares",
    "pseudo-3D spiral": "a rotating 3D spiral",
    "wordmark galaxy": "the mpp mark with an orbiting halo of squares",
    "grid reveal": "the mpp mark revealed across a grid",
    "wordmark typewriter": "the mpp mark typed in left to right",
    "wordmark 3D spin": "the mpp mark turning in 3D",
    "wordmark assemble": "the mpp mark assembling from scattered squares",
    "wordmark zoom": "the mpp mark zooming in",
    "rotating cube": "a tumbling wireframe cube",
    "starfield": "squares streaming past like stars",
    "noise field": "a drifting field of noise",
    "orbiting rings": "counter-rotating rings of squares",
    "spiral bloom": "a sunflower spiral blooming then dispersing",
    "wordmark relay": "the mpp mark spreading apart as nodes relay between letters",
    "machine payment protocol":
        "the phrase machine payment protocol washing in left to right",
    "machine payment protocol (stretch wave)":
        "the phrase machine payment protocol, its dots stretching into lines as a"
        " wave travels across",
    "mpp wordmark": "the mpp wordmark in solid white blocks",
    "mpp wordmark relay":
        "the block mpp wordmark spreading apart as nodes relay between letters",
    "machine payment protocol (stretch wave, vertical)":
        "the phrase machine payment protocol, its dots stretching into vertical bars"
        " as a wave travels top to bottom",
}


def _scene_blurb(name):
    return SCENE_BLURBS.get(name, "an animated square composition")


def _default_idx(scenes):
    """Default scene for the accessibility / banner modes: a wordmark scene."""
    for i, sc in enumerate(scenes):
        if sc.name == "wordmark galaxy":
            return i
    return 0


def _resolve_idx(scenes, ident, default_idx):
    """Resolve a scene identifier (1-based number or name substring)."""
    if ident is None or ident == "":
        return default_idx
    s = str(ident).strip().lower()
    if s.isdigit():
        n = int(s)
        if 1 <= n <= len(scenes):
            return n - 1
    for i, sc in enumerate(scenes):
        if s in sc.name.lower():
            return i
    return default_idx


def _frame_dims(term):
    """Canvas size for a one-shot frame: the real terminal, or 80x24 off-TTY."""
    if sys.stdout.isatty():
        return term.width, term.height
    return 80, 24


def _advance_to_settled(scene):
    """Step a fresh scene to a representative 'settled' moment.

    Prefer a HOLD phase (the wordmark scenes expose one); otherwise stop at
    STATIC_SETTLE_SECONDS into the animation. Uses the same fixed timestep as
    the loop so the frame matches what the explorer would show."""
    scene.reset()
    hold_t = None
    t = 0.0
    while t < 8.0:
        scene.update(SIM_DT)
        t += SIM_DT
        if "HOLD" in (scene.status() or "").upper():
            hold_t = t
            break
    target = hold_t if hold_t is not None else STATIC_SETTLE_SECONDS
    scene.reset()
    t = 0.0
    while t < target:
        scene.update(SIM_DT)
        t += SIM_DT


def _compose_settled(scene, cols, rows):
    """Compose one settled frame of `scene` at the given size (no control codes)."""
    _advance_to_settled(scene)
    canvas = Canvas(cols, rows)
    scene.draw(canvas)
    return canvas.compose()


def _print_grid(grid):
    """Write a composed grid as plain text (rows may be lists or strings)."""
    sys.stdout.write("\n".join("".join(row) for row in grid) + "\n")


def _want_screen_reader(args):
    return bool(args.screen_reader
                or os.environ.get("MPP_SCREEN_READER") == "1"
                or os.environ.get("TERM") == "dumb")


def _want_reduced_motion(args):
    return bool(args.no_motion or os.environ.get("MPP_REDUCED_MOTION") == "1")


def _run_screen_reader(scenes, args):
    """Skip the art entirely: emit the mark's text alternative + a description.

    No alternate screen, no cursor control, no loop, no decorative glyph."""
    scene = scenes[_resolve_idx(scenes, args.scene, _default_idx(scenes))]
    sys.stdout.write(MARK_ALT + "\n")
    sys.stdout.write("mpp wordmark — %s (decorative)\n" % _scene_blurb(scene.name))


def _run_reduced_motion(scenes, args):
    """Show the design without motion: one settled static frame, then exit."""
    scene = scenes[_resolve_idx(scenes, args.scene, _default_idx(scenes))]
    cols, rows = _frame_dims(Terminal())
    _print_grid(_compose_settled(scene, cols, rows))


def _play_bounded(term, scene, max_seconds):
    """Animate `scene` for at most `max_seconds`, then restore the terminal.

    Mirrors the interactive loop's teardown discipline (alt screen, hidden
    cursor, SIGINT-to-flag) but shows no footer and takes no scene input — it
    is a transient, non-blocking launch banner that hands off to the prompt."""
    scene.reset()
    stop = {"flag": False}

    def _on_sigint(_signum, _frame):
        stop["flag"] = True

    prev_sigint = signal.signal(signal.SIGINT, _on_sigint)
    start = time.monotonic()   # bound total runtime, including terminal setup
    try:
        with term.fullscreen(), term.hidden_cursor(), term.cbreak():
            canvas = None
            prev_grid = None
            prev_dims = None
            force = True
            last = start
            acc = 0.0
            while not stop["flag"] and time.monotonic() - start < max_seconds:
                cols, rows = term.width, term.height
                if (cols, rows) != prev_dims:
                    prev_dims = (cols, rows)
                    canvas = Canvas(cols, rows)
                    prev_grid = None
                    force = True
                    sys.stdout.write(term.home + term.clear)
                now = time.monotonic()
                dt = now - last
                last = now
                if dt > 0.25:
                    dt = 0.25
                acc += dt
                while acc >= SIM_DT:
                    scene.update(SIM_DT)
                    acc -= SIM_DT
                canvas.clear()
                scene.draw(canvas)
                grid = canvas.compose()
                out = []
                _paint(term, out, grid, None if force else prev_grid)
                if out:
                    sys.stdout.write("".join(out))
                    sys.stdout.flush()
                prev_grid = grid
                force = False
                key = term.inkey(timeout=FRAME_DT)   # frame pacing; q skips early
                if (key and str(key).lower() == "q") or stop["flag"]:
                    break
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGINT, prev_sigint)


def _run_banner(scenes, args):
    """Bounded launch animation. Accessibility flags already took precedence."""
    ident = args.banner if args.banner else args.scene
    scene = scenes[_resolve_idx(scenes, ident, _default_idx(scenes))]
    term = Terminal()
    if not sys.stdout.isatty():
        _print_grid(_compose_settled(scene, 80, 24))
        return
    # In a shipped product a banner animates on first run only; model the
    # "already seen" case as a single static frame (no animation).
    if os.environ.get("MPP_BANNER_SEEN") == "1":
        cols, rows = _frame_dims(term)
        _print_grid(_compose_settled(scene, cols, rows))
        return
    _play_bounded(term, scene, BANNER_MAX_SECONDS)


def _run_export(scenes, args):
    """Export a scene as plain-text frames + manifest.json (the handoff format).

    Each frame is exactly the glyph grid (no colour, no control codes). The
    manifest mirrors the article's per-frame shape: an ordered list of
    {file, duration_ms} plus scene id/name, fps, canvas size and the mark's
    text alternative. See _run_play for the replay that proves it round-trips."""
    if not args.out:
        sys.stderr.write("--export requires --out <dir>\n")
        sys.exit(2)
    idx = _resolve_idx(scenes, args.export, _default_idx(scenes))
    scene = scenes[idx]
    fps = max(1, args.fps)
    n_frames = max(1, args.frames)
    frame_dt = 1.0 / fps
    dur_ms = int(round(1000.0 / fps))
    os.makedirs(args.out, exist_ok=True)

    scene.reset()
    grids = []
    frame_meta = []
    acc = 0.0
    for i in range(n_frames):
        canvas = Canvas(EXPORT_COLS, EXPORT_ROWS)
        scene.draw(canvas)
        lines = ["".join(row) for row in canvas.compose()]
        fname = "frame_%03d.txt" % i
        with open(os.path.join(args.out, fname), "w") as fh:
            fh.write("\n".join(lines) + "\n")
        grids.append(lines)
        frame_meta.append({"file": fname, "duration_ms": dur_ms})
        # Advance one frame using the same fixed sub-steps as the live loop.
        acc += frame_dt
        while acc >= SIM_DT:
            scene.update(SIM_DT)
            acc -= SIM_DT

    manifest = {
        "scene_id": idx + 1,
        "scene_name": scene.name,
        "fps": fps,
        "cols": EXPORT_COLS,
        "rows": EXPORT_ROWS,
        "mark_alt": MARK_ALT,
        "description": _scene_blurb(scene.name),
        "frames": frame_meta,
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    sys.stdout.write("exported %d frames + manifest.json to %s (scene: %s)\n"
                     % (n_frames, args.out, scene.name))
    if args.png:
        _export_png(args.out, grids, manifest)


def _export_png(out_dir, grids, manifest):
    """Optional, dependency-gated: per-frame PNGs + a contact-sheet strip.

    Monochrome (white glyphs on black, no colour). Best-effort: needs Pillow
    and a monospaced font with the box/block/Braille glyphs; skips cleanly if
    Pillow is absent."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        sys.stdout.write("Pillow not installed; skipping --png "
                         "(pip install pillow)\n")
        return
    cw, ch = 8, 16
    cols, rows = manifest["cols"], manifest["rows"]
    width, height = cols * cw, rows * ch
    font = None
    for path in ("DejaVuSansMono.ttf", "/System/Library/Fonts/Menlo.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"):
        try:
            font = ImageFont.truetype(path, ch)
            break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()
    imgs = []
    for i, lines in enumerate(grids):
        img = Image.new("L", (width, height), 0)   # 'L' = grayscale, no colour
        draw = ImageDraw.Draw(img)
        for r, line in enumerate(lines):
            draw.text((0, r * ch), line, fill=255, font=font)
        img.save(os.path.join(out_dir, "frame_%03d.png" % i))
        imgs.append(img)
    if imgs:                                        # horizontal contact sheet
        step = max(1, len(imgs) // 12)
        picks = imgs[::step][:12]
        tw, th = width // 4, height // 4
        sheet = Image.new("L", (tw * len(picks), th), 0)
        for j, im in enumerate(picks):
            sheet.paste(im.resize((tw, th)), (j * tw, 0))
        sheet.save(os.path.join(out_dir, "contact_sheet.png"))
    sys.stdout.write("wrote %d PNGs + contact_sheet.png\n" % len(grids))


def _run_play(args):
    """Replay an exported frame directory from its manifest — proves round-trip.

    Reads the plain-text frames and per-frame durations and reconstructs the
    animation. Honours the TTY check and restores the terminal on exit."""
    out_dir = args.play
    try:
        with open(os.path.join(out_dir, "manifest.json")) as fh:
            manifest = json.load(fh)
    except OSError as exc:
        sys.stderr.write("cannot read manifest: %s\n" % exc)
        sys.exit(2)
    frames = manifest.get("frames", [])
    if not frames:
        sys.stderr.write("no frames in manifest\n")
        sys.exit(2)

    def load(i):
        with open(os.path.join(out_dir, frames[i]["file"])) as fh:
            return fh.read().rstrip("\n").split("\n")

    term = Terminal()
    if not sys.stdout.isatty():
        _print_grid(load(0))   # off-TTY: emit the first frame as a static image
        return
    loaded = [load(i) for i in range(len(frames))]
    stop = {"flag": False}

    def _on_sigint(_signum, _frame):
        stop["flag"] = True

    prev_sigint = signal.signal(signal.SIGINT, _on_sigint)
    try:
        with term.fullscreen(), term.hidden_cursor(), term.cbreak():
            sys.stdout.write(term.home + term.clear)
            while not stop["flag"]:
                for i, lines in enumerate(loaded):
                    if stop["flag"]:
                        break
                    out = [term.move_xy(0, r) + _solidify(line)
                           for r, line in enumerate(lines)]
                    sys.stdout.write("".join(out))
                    sys.stdout.flush()
                    if term.inkey(timeout=frames[i]["duration_ms"] / 1000.0):
                        stop["flag"] = True
                        break
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGINT, prev_sigint)


def _parse_args():
    p = argparse.ArgumentParser(
        prog="mpp.py", add_help=True,
        description="Monochrome, square-only scene renderer for the mpp "
                    "identity. No arguments launches the interactive explorer.")
    p.add_argument("--scene", metavar="ID",
                   help="scene for --screen-reader/--no-motion/--banner "
                        "(number 1-N or name substring; default: a wordmark scene)")
    p.add_argument("--screen-reader", action="store_true",
                   help="emit a plain-text alternative for the mark and exit "
                        "(no animation, glyphs or control codes)")
    p.add_argument("--no-motion", action="store_true",
                   help="render one static frame of the scene and exit")
    p.add_argument("--banner", nargs="?", const="", default=None, metavar="SCENE",
                   help="play a scene briefly (<=%gs) then hand off to the prompt"
                        % BANNER_MAX_SECONDS)
    p.add_argument("--export", metavar="SCENE",
                   help="export a scene as plain-text frames + manifest.json")
    p.add_argument("--out", metavar="DIR", help="output directory for --export")
    p.add_argument("--frames", type=int, default=EXPORT_FRAMES,
                   help="frames to export (default %d)" % EXPORT_FRAMES)
    p.add_argument("--fps", type=int, default=EXPORT_FPS,
                   help="frames per second for export/playback (default %d)"
                        % EXPORT_FPS)
    p.add_argument("--png", action="store_true",
                   help="also emit per-frame PNGs + contact sheet (needs Pillow)")
    p.add_argument("--play", metavar="DIR",
                   help="replay an exported frame directory")
    return p.parse_args()


def main(scenes=None):
    args = _parse_args()
    if scenes is None:
        scenes = _make_scenes()

    # Data op: export is independent of the display/accessibility modes.
    if args.export is not None:
        _run_export(scenes, args)
        return
    # Accessibility takes precedence over banner/play (degrade, don't animate).
    if _want_screen_reader(args):
        _run_screen_reader(scenes, args)
        return
    if _want_reduced_motion(args):
        _run_reduced_motion(scenes, args)
        return
    if args.play is not None:
        _run_play(args)
        return
    if args.banner is not None:
        _run_banner(scenes, args)
        return
    # Default: the interactive explorer, exactly as before.
    _run_interactive(scenes)


if __name__ == "__main__":
    main()
