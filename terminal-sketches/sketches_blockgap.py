#!/usr/bin/env python3
"""
mpp-terminal — SEPARATED-BLOCK variant of sketches_block.py.

Same solid-block ramp top (past full braille ⣿ the crest pops to a solid block
█), but each glyph pixel is drawn as its OWN block of CELL_W x CELL_H terminal
cells, spaced apart by GAP_X / GAP_Y empty cells. So at the crest the blocks stay
distinct squares (an LED dot-matrix look) instead of merging into solid letters.
Tune CELL_W / CELL_H / GAP_X / GAP_Y on MachineScene. See `_ramp_glyph`.

The original two-set system is kept exactly: Braille (the default sub-pixel
grain) for dense text, and block elements (▁▂▃▄▅▆▇█ / ▏▎▍▌▋▊▉█) for wave
movement. Only four sketches:

   1  MachineScene              — OPEN-SOURCE (horizontal-line wash, bright braille crest)
  1b  MachineWaveScene          — MACHINE/PAYMENT/PROTOCOL cycled per line, wave-only
  1c  MachineListScene          — OPEN/PROTOCOL/MACHINE/TO MACHINE/PAYMENTS, left-aligned
  1d  MachineBannerScene        — MACHINE TO MACHINE scrolling marquee (loops right)
   2  MachineStretchScene       — MACHINE TO MACHINE on the Shape-Type-Studio stretch wave
   4  WordmarkRelayBlocksScene  — the mpp wordmark with the springy relay
  11  SphereWaveScene           — a wave rippling over a spinning sphere

StretchWaveScene (the reusable wave engine) and the `_*` helpers are shared
infrastructure, not numbered sketches. Run standalone: `python sketches.py`.
"""

import math

from mpp import Scene, _clamp, EASE, GENTLE, _WM_M, _WM_P, _cubic_bezier

# Short->large thickness ramps: lower blocks grow a horizontal bar upward from a
# baseline; left blocks grow a vertical bar rightward from a left edge.
_BLOCK_DOWN = (" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█")
_BLOCK_LEFT = (" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█")


def _down_char(level):
    return _BLOCK_DOWN[int(_clamp(level, 0.0, 1.0) * 8 + 0.5)]


def _left_char(level):
    return _BLOCK_LEFT[int(_clamp(level, 0.0, 1.0) * 8 + 0.5)]


def _quad_in_out(x):
    """Quadratic ease-in-out (the 'quadInOut' option in the Shape Type Studio
    tool): slow at both ends, quick through the middle. Plain quadratic, not the
    bezier above, so the wave matches the tool exactly."""
    return 2.0 * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 2) / 2.0


# A very strong ease-in-out shared by every wave sketch (all but the mpp relay):
# it holds hard at the dim and bright ends and snaps through the middle, so the
# wave reads as a crisp, punchy sweep rather than a soft sinusoid.
_WAVE_EASE = _cubic_bezier(0.95, 0.0, 0.05, 1.0)


def _wave_a(fx, k, wave_t, sharp, wobble, extra=0.0):
    """Activation in [0,1] for the travelling brightness wave at normalised
    position `fx`. `wobble` warps the wavefront with a slower secondary oscillation
    (phase modulation), so the highlighted band's width fluctuates over time and
    space — a more wave-like, less linear sweep; 0 is a plain constant-speed
    cosine. `extra` adds a per-line phase offset. Seamless over one wave_t loop."""
    phase = (fx * k - wave_t + extra
             + wobble * math.sin(fx * k * 0.5 - 2.0 * wave_t))
    return _WAVE_EASE((0.5 + 0.5 * math.cos(phase)) ** sharp)


# ---------------------------------------------------------------------------
# Scene 1 — Machine payment protocol
# ---------------------------------------------------------------------------
#
# The phrase "MACHINE PAYMENT PROTOCOL" built entirely from horizontal lines: a 5x5
# matrix font where every filled row of a letter is drawn as a horizontal bar,
# so vertical strokes read as stacked dashes (a venetian-blind letterform). The
# phrase is stacked on three rows. A bright crest washes left->right over and
# over at a steady, gentle cadence; where it passes, bars thicken from a thin
# Braille line to a solid half-block bar (the brand's outline->invert move). The
# reveal frontier eases smoothly outward so the phrase fills in left-to-right
# and the wash reaches a little further each pass — one continuous flow, not
# discrete stages. It fills, holds, dissolves, and loops.

# 5-wide x 5-tall horizontal-stroke font; only the letters in the phrases.
_M2M_FW = 5
_M2M_FH = 5
_M2M_FONT = {
    "M": ("#...#", "##.##", "#.#.#", "#...#", "#...#"),
    "A": (".###.", "#...#", "#####", "#...#", "#...#"),
    "C": (".####", "#....", "#....", "#....", ".####"),
    "H": ("#...#", "#...#", "#####", "#...#", "#...#"),
    "I": ("#####", "..#..", "..#..", "..#..", "#####"),
    "N": ("#...#", "##..#", "#.#.#", "#..##", "#...#"),
    "E": ("#####", "#....", "###..", "#....", "#####"),
    "T": ("#####", "..#..", "..#..", "..#..", "..#.."),
    "O": (".###.", "#...#", "#...#", "#...#", ".###."),
    "P": ("####.", "#...#", "####.", "#....", "#...."),
    "Y": ("#...#", ".#.#.", "..#..", "..#..", "..#.."),
    "R": ("####.", "#...#", "####.", "#.#..", "#..#."),
    "L": ("#....", "#....", "#....", "#....", "#####"),
    "S": (".####", "#....", ".###.", "....#", "####."),
    "U": ("#...#", "#...#", "#...#", "#...#", ".###."),
    "-": (".....", ".....", ".###.", ".....", "....."),
}
_M2M_GAP = 1     # blank dot-columns between letters
_M2M_SPACE = 3   # blank dot-columns for a word space


def _hbar(canvas, x0, x1, cy, th):
    """A horizontal bar from x0..x1 centred on cy, `th` braille units thick.

    Built from stacked 1px Braille scanlines (sub-character resolution), so dense
    text stays legible — block characters are 4x coarser vertically and would
    collapse a 7-row font into ~3 rows. Used by the text-bearing scenes."""
    half = th / 2.0
    yy = cy - half
    top = cy + half
    while yy <= top + 1e-9:
        canvas.line(x0, yy, x1, yy)
        yy += 1.0


def _vbar(canvas, cx, y0, y1, tw):
    """A vertical bar from y0..y1 centred on cx, `tw` braille units thick — the
    vertical companion to _hbar (stacked 1px Braille columns)."""
    half = tw / 2.0
    xx = cx - half
    right = cx + half
    while xx <= right + 1e-9:
        canvas.line(xx, y0, xx, y1)
        xx += 1.0


def _hbar_block(canvas, x0, x1, cy, th):
    """Block-character horizontal bar that grows UP from a fixed baseline (the
    scene-14 wave model): the bar's bottom snaps to a character-row boundary and
    it fills upward — whole covered rows █, the top edge a lower block. Crisp,
    bottom-anchored. The thin trough is a single ▁."""
    c0 = int(min(x0, x1) // 2)
    c1 = int(max(x0, x1) // 2)
    if c1 < c0:
        return
    h = max(th, 1.0)
    base = int(round((cy + h / 2.0) / 4.0))          # baseline row boundary
    full = int(h // 4)
    rem = h - full * 4.0
    cells = [(base - 1 - k, "█") for k in range(full)]
    if rem >= 1.0:
        cells.append((base - 1 - full, _down_char(_clamp(rem / 4.0, 0.13, 1.0))))
    elif full == 0:
        cells.append((base - 1, "▁"))
    for r, ch in cells:
        if 0 <= r < canvas.rows:
            for c in range(max(0, c0), min(canvas.cols, c1 + 1)):
                canvas.set_char(c, r, ch)


def _vbar_block(canvas, cx, y0, y1, tw):
    """Block-character vertical bar that grows RIGHTWARD from a fixed left edge —
    the vertical companion to _hbar_block (whole columns █, right edge a left
    block, thin bar a single ▏)."""
    r0 = int(min(y0, y1) // 4)
    r1 = int(max(y0, y1) // 4)
    if r1 < r0:
        return
    w = max(tw, 1.0)
    base = int(round((cx - w / 2.0) / 2.0))          # left-edge column boundary
    full = int(w // 2)
    rem = w - full * 2.0
    cells = [(base + k, "█") for k in range(full)]
    if rem >= 0.5:
        cells.append((base + full, _left_char(_clamp(rem / 2.0, 0.13, 1.0))))
    elif full == 0:
        cells.append((base, "▏"))
    for c, ch in cells:
        if 0 <= c < canvas.cols:
            for r in range(max(0, r0), min(canvas.rows, r1 + 1)):
                canvas.set_char(c, r, ch)


def _block_snapped(canvas, cx, cy, w, h):
    """A solid block whose height snaps to a whole number of character rows and
    whose top lands on a character-row boundary, so it renders as clean full-cell
    █ (no ▀▄ partial-cell edges) — seamless via reverse video, like the static
    wordmark. Use this instead of rect_fill wherever a solid block must read as
    the wordmark, even while it scales/moves."""
    bh = max(4, int(round(h / 4.0)) * 4)             # whole char rows, >= 1
    top = round((cy - bh / 2.0) / 4.0) * 4           # top on a char boundary
    canvas.rect_fill(cx, top + bh / 2.0, w, bh)


def _m2m_cells(text, gap=_M2M_GAP, space=_M2M_SPACE):
    """Lit (col, row) glyph pixels for `text` plus its width, in FONT cells. The
    scene spaces each pixel onto its own block of terminal cells when drawing."""
    cells = []
    col = 0
    for ch in text:
        if ch == " ":
            col += space
            continue
        glyph = _M2M_FONT[ch]
        for r in range(_M2M_FH):
            line = glyph[r]
            for c in range(_M2M_FW):
                if line[c] == "#":
                    cells.append((col + c, r))
        col += _M2M_FW + gap
    width = max(col - gap, 1)
    return cells, width


# A single braille cell holds 8 dots. The wave fills a cell from one dot up to a
# full block as its activation rises — middle rows first, then top and bottom, so
# it reads as a bar thickening in place. `_RAMP_BITS` is that fill order. This
# variant adds one extra step ABOVE full braille: a solid white block, so the very
# crest of the wave pops to a fully-filled cell (a stronger ramp top).
_RAMP_BITS = (0x02, 0x10, 0x04, 0x20, 0x01, 0x08, 0x40, 0x80)


def _ramp_glyph(n):
    """1..8 -> braille dots (the ramp fill order); 9+ -> a solid white block, the
    brightest step past full braille."""
    if n >= 9:
        return "█"        # █ — solid white block, the top of the ramp
    bits = 0
    for i in range(max(1, min(8, n))):
        bits |= _RAMP_BITS[i]
    return chr(0x2800 | bits)


class MachineScene(Scene):
    name = "open-source"

    # -- tunables ----------------------------------------------------------
    # Each glyph pixel renders as its OWN block of CELL_W x CELL_H terminal cells,
    # separated from its neighbours by GAP_X / GAP_Y empty cells — so at the crest
    # the solid blocks stay distinct squares instead of merging into one mass.
    TEXT = "OPEN-SOURCE"  # the phrase (used when WORDS is None)
    WORDS = None          # tuple of words cycled per stacked line; None -> TEXT
    ALIGN = "center"      # "center" each line, or "left" (share a left edge)
    LETTER_SPACING = 1    # blank glyph-columns between letters
    CELL_W = 2            # block width: terminal cells per glyph pixel (horizontal)
    CELL_H = 1            # block height: terminal rows per glyph pixel (vertical)
    GAP_X = 1             # empty cells between pixel blocks (horizontal)
    GAP_Y = 1             # empty rows between pixel blocks (vertical)
    N_ROWS = 1            # stacked copies of the phrase
    ROW_GAP = 1           # blank glyph-rows between stacked phrases
    WAVE_TIME = 3.5       # seconds for the brightness wave to travel one loop
    WAVES = 1             # bright crests spanning the phrase at once
    SHARP = 4.0           # crest sharpness (higher -> tighter, more single-dot rest)
    LINE_STAGGER = 0.9    # wave phase offset per stacked line (radians) — the wave
    #                       cascades down the lines instead of hitting them together
    WAVE_WOBBLE = 0.8     # warps the wavefront so the highlight's width fluctuates
    #                       (more wave-like / less linear); 0 = constant-speed sweep
    BLANK_A = 0.0         # below this wave value a block is blank (nothing drawn).
    #                       0 keeps the whole resting phrase as single dots; raise it
    #                       to hide the dim bulk and let only the wave show.

    def _cycle(self):
        return self.WAVE_TIME

    def _layouts(self):
        """Per-line (pixels, width) in FONT cells, at the current LETTER_SPACING.
        With WORDS set, each stacked line cycles through the words; otherwise every
        line is TEXT. Cached until words/spacing change."""
        words = tuple(self.WORDS) if self.WORDS else (self.TEXT,)
        key = (words, self.LETTER_SPACING)
        if getattr(self, "_layouts_key", None) != key:
            self._layouts_data = [_m2m_cells(w, self.LETTER_SPACING) for w in words]
            self._layouts_key = key
        return self._layouts_data

    def _fill_block(self, canvas, col0, row0, glyph):
        """Paint one glyph pixel's CELL_W x CELL_H block with `glyph`."""
        for dy in range(self.CELL_H):
            cr = row0 + dy
            if not (0 <= cr < canvas.rows):
                continue
            for dx in range(self.CELL_W):
                cc = col0 + dx
                if 0 <= cc < canvas.cols:
                    canvas.set_char(cc, cr, glyph)

    def draw(self, canvas):
        # Each glyph pixel is a separated block: a CELL_W x CELL_H square of cells
        # with GAP_X / GAP_Y empty cells around it, so crest blocks never touch.
        cols, rows = canvas.cols, canvas.rows
        pxw = self.CELL_W + self.GAP_X            # macro pitch x (cells per glyph col)
        pyh = self.CELL_H + self.GAP_Y            # macro pitch y (rows per glyph row)
        layouts = self._layouts()
        maxw = max(w for _, w in layouts)         # widest line, glyph cols
        region_w = maxw * pxw - self.GAP_X        # total width in cells
        region_left = (cols - region_w) // 2
        block_glyph_rows = self.N_ROWS * _M2M_FH + (self.N_ROWS - 1) * self.ROW_GAP
        top = (rows - (block_glyph_rows * pyh - self.GAP_Y)) // 2
        wave_t = (self.t / self.WAVE_TIME) * 2.0 * math.pi
        k = self.WAVES * 2.0 * math.pi

        for ri in range(self.N_ROWS):
            cells, w = layouts[ri % len(layouts)]          # cycle the words
            line_w = w * pxw - self.GAP_X
            x0 = region_left if self.ALIGN == "left" else (cols - line_w) // 2
            row_top = top + ri * (_M2M_FH + self.ROW_GAP) * pyh
            for fc, fr in cells:
                col0 = x0 + fc * pxw
                row0 = row_top + fr * pyh
                center = col0 + (self.CELL_W - 1) / 2.0
                # Normalise by the whole shared region so one wavefront sweeps the
                # entire sketch cohesively (short words pass quickly, long ones slow).
                fx = (center + 0.5 - region_left) / region_w
                a = _wave_a(fx, k, wave_t, self.SHARP, self.WAVE_WOBBLE,
                            ri * self.LINE_STAGGER)
                if a < self.BLANK_A:
                    continue                       # below the threshold: blank
                # Rest -> single dot; crest -> solid block. One glyph per pixel block.
                self._fill_block(canvas, col0, row0, _ramp_glyph(int(a * 9.0 + 0.5)))

    def status(self):
        return "WAVE"


# ---------------------------------------------------------------------------
# Scene 1b — MACHINE, wave-only (no resting text)
# ---------------------------------------------------------------------------
#
# Same wash engine as the open-source sketch, retuned: MACHINE / PAYMENT /
# PROTOCOL cycle down the stacked lines. BLANK_A hides the dim resting bulk so the
# page is mostly empty, but the wave's leading edge still eases in — a single
# braille dot ramping up to a dense bright bar. A strong per-line stagger sweeps
# that band down the lines one after another (sequential), revealing each in turn.
class MachineWaveScene(MachineScene):
    name = "machine"

    WORDS = ("MACHINE", "PAYMENT", "PROTOCOL")  # cycled down the lines
    N_ROWS = 5            # stacked lines (the 3 words repeat to fill them)
    WAVE_TIME = 5.0       # a touch slower so the sequential reveal reads
    WAVES = 1.0           # one crest sweeps each line, revealing it left->right
    SHARP = 2.0           # a readable band of the word lit at once
    LINE_STAGGER = 2.5    # strong offset per line -> the wave cascades down the
    #                       stack, lighting the lines in sequence
    BLANK_A = 0.10        # hide the dim bulk; only the wave (+ its dot->block ramp) show


# ---------------------------------------------------------------------------
# Scene 1c — OPEN / PROTOCOL / MACHINE / TO MACHINE / PAYMENTS, left-aligned
# ---------------------------------------------------------------------------
#
# Same wave engine, but the five phrases each get their own line, left-aligned
# (they share a left edge instead of centring). The resting single-dot stipple
# stays visible (so the left set reads), with the wave washing down the stack.
class MachineListScene(MachineScene):
    name = "open protocol"

    WORDS = ("OPEN", "PROTOCOL", "MACHINE", "TO MACHINE", "PAYMENTS")
    N_ROWS = 5            # one line per phrase (no repeat)
    ALIGN = "left"        # share a left edge instead of centring each line
    LINE_STAGGER = 0.5    # gentle cascade of the wave down the five lines


# ---------------------------------------------------------------------------
# Scene 1d — MACHINE TO MACHINE scrolling banner
# ---------------------------------------------------------------------------
#
# A single row of MACHINE TO MACHINE tiled across the width and scrolling
# rightward forever — a seamless marquee in the separated-block grid. The text
# rests as single braille dots and a brightness wave travels across the screen
# (independent of the scroll), filling each pixel's block up to a solid square as
# it passes through. Scrolls in whole cells.
class MachineBannerScene(MachineScene):
    name = "machine banner"

    TEXT = "MACHINE TO MACHINE"
    SEP = 3               # blank glyph-columns between repeats of the phrase
    SPEED = 11.0          # scroll speed, character cells / second (moving right)
    WAVES = 6.0           # bright wave crests across the screen
    WAVE_TIME = 4.5       # the wave's travel period (independent of the scroll)
    # Inherits BLANK_A = 0 (resting single-dot text) and the dot->block ramp.

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        pxw = self.CELL_W + self.GAP_X
        pyh = self.CELL_H + self.GAP_Y
        cells, w = self._layouts()[0]              # glyph pixels + width, font cols
        tile_w = (w + self.SEP) * pxw              # one repeat, in cells
        top = (rows - (_M2M_FH * pyh - self.GAP_Y)) // 2
        off = int(self.t * self.SPEED) % tile_w    # whole-cell scroll, rightward
        wave_t = (self.t / self.WAVE_TIME) * 2.0 * math.pi
        k = self.WAVES * 2.0 * math.pi
        # Tile the phrase across the width with one extra copy each side so the
        # wrap is seamless; every copy shifts right by `off`, looping forever.
        n = cols // tile_w + 2
        for i in range(n):
            base = off - tile_w + i * tile_w
            for fc, fr in cells:
                col0 = base + fc * pxw
                row0 = top + fr * pyh
                center = col0 + (self.CELL_W - 1) / 2.0
                fx = (center + 0.5) / cols         # absolute screen position
                a = _wave_a(fx, k, wave_t, self.SHARP, self.WAVE_WOBBLE)
                if a < self.BLANK_A:
                    continue
                self._fill_block(canvas, col0, row0, _ramp_glyph(int(a * 9.0 + 0.5)))

    def status(self):
        return "BANNER"


# ---------------------------------------------------------------------------
# Scene 2 — Machine payment protocol (stretch wave)
# ---------------------------------------------------------------------------
#
# A faithful port of the "Shape Type Studio" HTML tool the original effect was
# designed in. Unlike scene 16 (a stylized build/hold/wipe), this is the tool's
# actual algorithm: the phrase is ALWAYS fully present in a standard 5x7 font,
# and a continuous sine wave travels left->right modulating every cell. Each lit
# cell is its own square that, in phase, stretches horizontally (so a run of
# near-crest cells merges into a continuous line) and grows in thickness; at a
# trough it collapses to a near-invisible dot. ~1.8 wavelengths span the phrase,
# so a couple of bright bands sweep across forever on a seamless ~6.5s loop.
#
# All distances are expressed as fractions of the cell width, exactly as the
# tool computes them (baseR = cell*wt/200, half-extents = finalR*cos45*stretch),
# so the proportions match; only the absolute cell size is fit to the terminal.

# The tool's standard 5x7 glyphs (only the letters the phrase needs).
_STS_FONT = {
    "M": ("#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"),
    "A": (".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    "C": (".###.", "#....", "#....", "#....", "#....", "#....", ".###."),
    "H": ("#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    "I": ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"),
    "N": ("#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"),
    "E": ("#####", "#....", "#....", "###..", "#....", "#....", "#####"),
    "T": ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
    "O": (".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
    "P": ("####.", "#...#", "#...#", "####.", "#....", "#....", "#...."),
    "Y": ("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."),
    "R": ("####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"),
    "L": ("#....", "#....", "#....", "#....", "#....", "#....", "#####"),
    "S": (".####", "#....", "#....", ".###.", "....#", "....#", "####."),
    "U": ("#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
    "-": (".....", ".....", ".....", ".###.", ".....", ".....", "....."),
}
_STS_SPACE = ("....." ,) * 7
_STS_TEXT = "MACHINE TO MACHINE"


_STS_GAP = 2     # blank columns between letters so they stay distinct at a crest


def _sts_cells(text):
    """Lit (col, row) cells across the phrase and its total column count. Each
    glyph is 5 wide with a small inter-letter gap so neighbouring letters don't
    bleed together when the wave stretches them. Cells are drawn individually —
    never merged — so the stretch wave can pull them together and apart."""
    cells = []
    col = 0
    for ch in text:
        glyph = _STS_FONT.get(ch, _STS_SPACE)
        for ri in range(7):
            line = glyph[ri]
            for cc in range(5):
                if line[cc] == "#":
                    cells.append((col + cc, ri))
        col += 5 + _STS_GAP
    return cells, col


_STS_CELLS, _STS_COLS = _sts_cells(_STS_TEXT)
_COS45 = 0.7071067811865476


class MachineStretchScene(Scene):
    name = "machine to machine (stretch wave)"

    # -- tunables (the tool's defaults) ------------------------------------
    N_LINES = 3           # stacked copies of the phrase
    RS = 1.0              # row spacing (cell height = cell width * RS); raised
    #                       from the tool's 0.65 so a braille terminal has room
    #                       for a whole half-block cell between rows — i.e. the
    #                       crest can go crisp solid white even when narrow
    LINE_HEIGHT = 1.05    # gap between stacked lines, in line-heights
    LINE_DELAY = 0.0      # per-line phase offset (0 = all lines in sync)
    WIDTH_FRAC = 0.96     # text-block width as a fraction of wu
    HEIGHT_FRAC = 0.9     # text-block height as a fraction of hu
    WAVE_SPREAD = 16.0     # sine wavelength in columns (bigger = longer waves)
    SP = 0.30             # wave speed (tool's slider)
    TIME_K = 3.2          # tool's fixed time constant; loop = 2*pi/(TIME_K*SP)
    SX_MIN = 1.6          # horizontal stretch at a trough
    SX_MAX = 7.0         # horizontal stretch at a crest; the inter-letter gap
    #                      keeps neighbours apart, so strokes fill but letters read
    TH_MIN = 0.05         # thickness factor at a trough (near-invisible dot)
    TH_MAX = 0.4          # thickness factor at a crest
    WT = 75.0             # base weight: baseR = cell * WT / 200
    FLOOR_FRAC = 0.0167   # min radius as a fraction of the cell (the tool's 0.4px)
    # The horizontal stretch ports 1:1, but a braille cell is far coarser
    # vertically than the tool's 1080px canvas, so the literal thickness lands
    # below one sub-pixel and never reads. TH_GAIN lifts only the vertical
    # extent (the stretch axis stays exact) so the thin->thick pulse — and the
    # solid invert at a crest — shows; the cap keeps stacked rows from merging.
    TH_GAIN = 4.5
    TH_CAP_FRAC = 0.55    # max bar thickness as a fraction of the row pitch
    DOT_NP = 0.12         # below this wave activation a cell is a single braille
    #                       dot (the smallest mark) — the exaggerated default

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        ncols = _STS_COLS
        n = self.N_LINES
        # Block height in cell-width units: 7 rows tall, RS spacing, N lines.
        hfac = 7.0 * self.RS * (1.0 + (n - 1) * self.LINE_HEIGHT)
        cw = min(self.WIDTH_FRAC * wu / ncols, self.HEIGHT_FRAC * hu / hfac)
        ch = cw * self.RS
        line_h = 7.0 * ch
        block_w = ncols * cw
        block_h = hfac * cw
        x0 = (wu - block_w) / 2.0
        y0 = (hu - block_h) / 2.0

        t = self.t
        speed = self.SP * self.TIME_K
        base_r = cw * self.WT / 200.0
        floor = cw * self.FLOOR_FRAC
        th_cap = ch * self.TH_CAP_FRAC

        for li in range(n):
            line_off_y = y0 + li * (line_h * self.LINE_HEIGHT)
            delay = li * self.LINE_DELAY
            for ci, ri in _STS_CELLS:
                px = x0 + ci * cw + cw * 0.5
                py = line_off_y + ri * ch + ch * 0.5
                phase = ci / self.WAVE_SPREAD - t * speed - delay
                np = _WAVE_EASE((math.sin(phase) + 1.0) * 0.5)
                stretch = self.SX_MIN + np * (self.SX_MAX - self.SX_MIN)
                thick = self.TH_MIN + np * (self.TH_MAX - self.TH_MIN)
                final_r = base_r * thick
                if final_r < floor:
                    final_r = floor
                hw = final_r * _COS45 * stretch          # horizontal half-extent
                bar_th = 2.0 * final_r * _COS45 * self.TH_GAIN
                if bar_th > th_cap:
                    bar_th = th_cap
                # Default trough: the smallest braille mark — a single dot. As the
                # wave rises it stretches and thickens into a bright, dense braille
                # bar (capped thickness + inter-letter gap keep the letters legible).
                if np < self.DOT_NP:
                    canvas.set_dot(px, py)
                else:
                    _hbar(canvas, px - hw, px + hw, py, bar_th)


# ---------------------------------------------------------------------------
# Shared mpp wordmark geometry (used by sketch 4, the relay)
# ---------------------------------------------------------------------------
#
# A 1:1 reproduction of the static mpp wordmark: a grid of wide, short cells
# where a filled cell is a solid white rectangle that spans the full cell width
# (so horizontal neighbours merge into seamless bars) but is shorter than the
# row pitch (so vertical neighbours stay separated blocks). Rendered with solid
# half-block fills — crisp white, no Braille. Static: it just shows the mark.
#
# This is its own glyph design (the p's bars are wider than the m), distinct
# from the canonical word_elements mark, matching the supplied reference. The
# glyphs live in mpp.py (its grid-reveal scene uses them too), imported here so
# there is a single source of truth for the mark.
from mpp import _WM_M, _WM_P  # noqa: E402


_WM_SEQ = (_WM_M, _WM_P, _WM_P)   # the three glyphs of the word
_WM_GH = len(_WM_M)               # glyph height in cells
_WM_GAP = 1                       # blank cells between glyphs
def _wm_word_cols():
    """Total column count of the laid-out word."""
    return (sum(len(g[0]) for g in _WM_SEQ) + _WM_GAP * (len(_WM_SEQ) - 1))


def _wm_glyph_elements(px, row_ratio, block_h_frac):
    """Per-glyph block elements for scenes that move the letters independently.

    Mirrors word_glyph_elements but for the block-wordmark: each horizontal run
    of cells becomes one bar element. Returns one dict per glyph with `center_x`
    (its centre offset from the word centre), `elems` (bars relative to the
    glyph's own centre: x, y, w, h) and `half` (the glyph's half-width)."""
    py = px * row_ratio
    block_h = py * block_h_frac
    total = _wm_word_cols()
    cxw = (total - 1) / 2.0
    cyw = (_WM_GH - 1) / 2.0
    glyphs = []
    col0 = 0
    for bm in _WM_SEQ:
        gw = len(bm[0])
        gcw = (gw - 1) / 2.0                       # glyph centre column (local)
        elems = []
        for r in range(_WM_GH):
            line = bm[r]
            c = 0
            while c < gw:
                if line[c] == "#":
                    c1 = c
                    while c1 + 1 < gw and line[c1 + 1] == "#":
                        c1 += 1
                    run = c1 - c + 1
                    mid = (c + c1) / 2.0
                    elems.append({"x": (mid - gcw) * px, "y": (r - cyw) * py,
                                  "w": run * px, "h": block_h})
                    c = c1 + 1
                else:
                    c += 1
        half = max((abs(e["x"]) + e["w"] / 2.0) for e in elems) if elems else 0.0
        glyphs.append({"center_x": (col0 + gcw - cxw) * px, "elems": elems,
                       "half": half})
        col0 += gw + _WM_GAP
    return glyphs
# An extreme cubic ease-in-out for the wordmark fan-out and return: it holds
# almost dead-still at both ends, then whips through the middle near-instantly.
# No overshoot / spring — just a very hard, fast snap.
_XSNAP = _cubic_bezier(0.985, 0.0, 0.015, 1.0)


def _ease_out_in(t, power=3.0):
    """Fast -> slow -> fast: ease-OUT over the first half (quick start that
    decelerates) then ease-IN over the second (accelerates to a quick finish),
    so velocity is high at the ends and ~zero through the middle. Higher `power`
    makes the mid-point slowdown more extreme."""
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    if t < 0.5:
        return 0.5 * (1.0 - (1.0 - 2.0 * t) ** power)
    return 0.5 + 0.5 * (2.0 * t - 1.0) ** power


# ---------------------------------------------------------------------------
# Scene 4 — mpp wordmark relay
# ---------------------------------------------------------------------------
#
# The mpp wordmark (always present) springs apart and shoots a baton across:
# from the tight MPP lockup the letters fan wide from the centre (very strong,
# fast cubic ease-in-out, no spring), then a baton travels from the M to the END p
# (passing over the middle p) on a fast->slow->fast curve. The baton is a train
# of four short lines: at the quick ends their speed fans them apart so you read
# four lines, through the slow middle they converge into one continuous line.
# Then the letters spring back to the lockup, stretching slightly as they settle.
class WordmarkRelayBlocksScene(Scene):
    name = "mpp wordmark relay"

    CYCLE = 6.5
    WIDTH_FRAC = 0.42      # tight-lockup width as a fraction of wu
    HEIGHT_FRAC = 0.55     # cap so the word fits tall/short terminals
    ROW_RATIO = 0.83       # cell aspect, matching the wordmark scene
    BLOCK_H_FRAC = 0.6     # block height as a fraction of the row pitch
    SPREAD_MULT = 1.7      # how far the letters fan out from centre
    LINE_H_FRAC = 1.0      # baton-line thickness as a fraction of block_h
    LINE_LEN_FRAC = 3.4    # each baton line's length, in cell pitches
    N_LINES = 4            # lines in the baton train
    LINE_STAG = 0.085      # time gap between them (fraction of the travel)
    BATON_POW = 3.0        # fast->slow->fast strength of the baton travel
    STRETCH_AMP = 0.14     # outro horizontal stretch on the settle-back

    # Phase windows (fractions of the cycle). The word is always present: it
    # rests, the letters fan apart one after another (M first, then the middle p,
    # then the end p), the baton shoots M -> end p, then they snap back in that
    # same sequence. Each letter runs its own staggered cubic ease-in-out.
    SPREAD_START = 0.08    # when the M begins to fan out
    SPREAD_DUR = 0.13      # each letter's fan-out duration
    SPREAD_STAG = 0.008     # delay between letters (M -> mid p -> end p)
    RELAY = (0.34, 0.74)   # baton travels the full M -> end p (after the fan-out)
    UNSPREAD_START = 0.78  # when the M begins to snap back
    UNSPREAD_DUR = 0.10    # each letter's snap-back duration
    UNSPREAD_STAG = 0.012  # delay between letters on the way in (same order)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = (self.t % self.CYCLE) / self.CYCLE
        px = min(self.WIDTH_FRAC * wu / _wm_word_cols(),
                 self.HEIGHT_FRAC * hu / (_WM_GH * self.ROW_RATIO))
        px = _clamp(px, 3.0, 16.0)
        glyphs = _wm_glyph_elements(px, self.ROW_RATIO, self.BLOCK_H_FRAC)
        block_h = px * self.ROW_RATIO * self.BLOCK_H_FRAC
        line_h = block_h * self.LINE_H_FRAC
        line_len = px * self.LINE_LEN_FRAC

        def seg(win):
            a, b = win
            return _clamp((u - a) / (b - a), 0.0, 1.0)

        # Each letter fans out and snaps back on its own staggered cubic ease-in-out
        # (no spring), in sequence M -> middle p -> end p, both directions. The word
        # is always present — it never wipes to nothing.
        def glyph_spread(i):
            out = _XSNAP(_clamp(
                (u - (self.SPREAD_START + i * self.SPREAD_STAG)) / self.SPREAD_DUR,
                0.0, 1.0))
            rb = _clamp(
                (u - (self.UNSPREAD_START + i * self.UNSPREAD_STAG)) / self.UNSPREAD_DUR,
                0.0, 1.0)
            sp = out * (1.0 - _XSNAP(rb))
            # Outro: each letter stretches slightly wider as it lands, then relaxes.
            stretch = 1.0 + self.STRETCH_AMP * math.sin(math.pi * rb * rb)
            return sp, stretch

        centers = []
        for i, g in enumerate(glyphs):
            sp, stretch_x = glyph_spread(i)
            cxg = cx + g["center_x"] * (1.0 + sp * (self.SPREAD_MULT - 1.0))
            centers.append(cxg)
            for e in g["elems"]:
                _block_snapped(canvas, cxg + e["x"] * stretch_x, cy + e["y"],
                               e["w"] * stretch_x, e["h"])

        # Relay baton: a train of N short lines shot from the M's right edge all
        # the way to the END p's left edge (over the middle p), on a fast->slow->
        # fast curve. Each line lags the one ahead by a fixed TIME gap, so the
        # spatial gap between them tracks the speed: wide (four lines) at the quick
        # ends, ~zero (one continuous line) through the slow middle.
        tau = seg(self.RELAY)
        if 0.0 < tau < 1.0:
            # The lines travel from inside the M to inside the end p, but are
            # clipped to the gap between the M's right stem and the end p's left
            # stem. So each line grows out of the right stem and is swallowed by
            # the end p's stem — no instant pop in or out. The fixed TIME stagger
            # fans them into four at the quick ends and merges them into one
            # continuous line through the slow middle.
            xs = centers[0]                            # behind the M's right stem
            xd = centers[2]                            # behind the end p's left stem
            clip_lo = centers[0] + glyphs[0]["half"]   # M right stem (emit edge)
            clip_hi = centers[2] - glyphs[2]["half"]   # end p left stem (absorb edge)
            span = 1.0 - (self.N_LINES - 1) * self.LINE_STAG
            for k in range(self.N_LINES):
                local = (tau - k * self.LINE_STAG) / span
                if local <= 0.0 or local >= 1.0:
                    continue
                xk = xs + (xd - xs) * _ease_out_in(local, self.BATON_POW)
                lo = max(xk - line_len / 2.0, clip_lo)
                hi = min(xk + line_len / 2.0, clip_hi)
                if hi - lo > 1.0:
                    _block_snapped(canvas, (lo + hi) / 2.0, cy, hi - lo, line_h)

    def status(self):
        u = (self.t % self.CYCLE) / self.CYCLE
        if u < 0.08:
            return "REST"
        if u < 0.34:
            return "SPREAD"
        if u < 0.78:
            return "RELAY M-P"
        if u < 0.97:
            return "RETURN"
        return "REST"
# ===========================================================================
# Reusable stretch-wave engine
# ===========================================================================
#
# The Shape Type Studio mechanic from the machine-to-machine scenes, factored
# out so ANY cell content can ride it. A subclass supplies a field of (col, row)
# cells via field(wu, hu); the engine lays the cells on a grid and, per cell,
# reads a travelling sine wave to stretch it along one axis (a run of near-crest
# cells merging into a line/bar) and pulse its thickness (collapsing to a dot at
# a trough). PHASE_AXIS picks which way the wave travels; STRETCH_AXIS which way
# cells stretch. The loop is seamless (pure sine of t).
class StretchWaveScene(Scene):
    PHASE_AXIS = "col"     # "col" / "row": the index the wave travels along
    STRETCH_AXIS = "x"     # "x" / "y": which way cells stretch
    WIDTH_FRAC = 0.92
    HEIGHT_FRAC = 0.85
    CELL_ASPECT = 1.0      # cell height / width
    WAVE_SPREAD = 8.0      # wavelength in cells along the wave axis
    SP = 0.30              # wave speed (loop = 2*pi / (TIME_K * SP))
    TIME_K = 3.2
    SX_MIN = 1.6           # stretch at a trough
    SX_MAX = 6.0           # stretch at a crest (cells merge into a line)
    TH_MIN = 0.05          # thickness factor at a trough (a dot)
    TH_MAX = 0.4           # thickness factor at a crest
    WT = 75.0
    FLOOR_FRAC = 0.0167    # min radius as a fraction of the cell
    TH_GAIN = 4.5          # lifts the cross-axis thickness so it reads in braille
    TH_CAP_FRAC = 0.78     # max bar thickness as a fraction of the cross-axis pitch
    USE_BLOCKS = False     # abstract scenes flip this on; text waves stay Braille
    CREST_SOLID = True     # invert the crest to a solid bar; text scenes set False
                           # (at small text pitch the invert reads as glitchy
                           # half-blocks among the Braille)

    def field(self, wu, hu):
        """Return (cells, ncols, nrows); cells is an iterable of (col, row)."""
        raise NotImplementedError

    @staticmethod
    def _wave_ease(x):
        # A very strong ease-in-out: holds at the trough/crest and snaps through
        # the middle, so the ripple reads as a punchy, crisp wave.
        return _WAVE_EASE(x)

    def _activation(self, ci, ri, ncols, nrows):
        """The wave's value in [0, 1] at cell (ci, ri). The default is a sine
        travelling along PHASE_AXIS; scenes can override with any field (e.g. a
        sweeping gaussian wavefront)."""
        idx = ci if self.PHASE_AXIS == "col" else ri
        phase = idx / self.WAVE_SPREAD - self.t * self.SP * self.TIME_K
        return self._wave_ease((math.sin(phase) + 1.0) * 0.5)

    def _blit(self, canvas, px, py, np, cw, ch):
        """Render one cell at activation `np`: stretch along STRETCH_AXIS, pulse
        thickness on the other, going crisp solid white at the crest."""
        vertical = self.STRETCH_AXIS == "y"
        base_r = cw * self.WT / 200.0
        final_r = max(base_r * (self.TH_MIN + np * (self.TH_MAX - self.TH_MIN)),
                      cw * self.FLOOR_FRAC)
        along = final_r * _COS45 * (self.SX_MIN + np * (self.SX_MAX - self.SX_MIN))
        cap = (cw if vertical else ch) * self.TH_CAP_FRAC
        tw = min(2.0 * final_r * _COS45 * self.TH_GAIN, cap)
        if self.USE_BLOCKS:
            # Block bars carry the thickness themselves (whole rows go solid █).
            if vertical:
                _vbar_block(canvas, px, py - along, py + along, tw)
            else:
                _hbar_block(canvas, px - along, px + along, py, tw)
            return
        if vertical:
            _vbar(canvas, px, py - along, py + along, tw)
            if self.CREST_SOLID and tw >= 2.0:
                _block_snapped(canvas, px, py, tw, along * 2.0)
        else:
            _hbar(canvas, px - along, px + along, py, tw)
            if self.CREST_SOLID and tw >= 2.0:
                _block_snapped(canvas, px, py, along * 2.0, tw)

    def _blit_along(self, canvas, px, py, np, cw, angle):
        """Like _blit but the cell stretches along an arbitrary `angle` — for
        content that isn't axis-aligned (e.g. a spiral ribbon)."""
        base_r = cw * self.WT / 200.0
        final_r = max(base_r * (self.TH_MIN + np * (self.TH_MAX - self.TH_MIN)),
                      cw * self.FLOOR_FRAC)
        along = final_r * _COS45 * (self.SX_MIN + np * (self.SX_MAX - self.SX_MIN))
        tw = min(2.0 * final_r * _COS45 * self.TH_GAIN, cw * self.TH_CAP_FRAC)
        if self.USE_BLOCKS:
            # Blocks can't rotate; approximate the ribbon with the nearest-axis
            # block bar (horizontal dashes for the sphere's angle-0 rings).
            a = angle % math.pi
            if a < math.pi / 4 or a > 3 * math.pi / 4:
                _hbar_block(canvas, px - along, px + along, py, tw)
            else:
                _vbar_block(canvas, px, py - along, py + along, tw)
            return
        if tw >= 2.0:
            # Bright (dense) braille bar at the crest — nearest axis, no solid
            # white block. The trough stays a thin braille line (the default).
            a = angle % math.pi
            if a < math.pi / 4 or a > 3 * math.pi / 4:
                _hbar(canvas, px - along, px + along, py, tw)
            else:
                _vbar(canvas, px, py - along, py + along, tw)
        else:
            ca, sa = math.cos(angle), math.sin(angle)
            canvas.line(px - along * ca, py - along * sa,
                        px + along * ca, py + along * sa)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cells, ncols, nrows = self.field(wu, hu)
        if ncols < 1 or nrows < 1:
            return
        cw = min(self.WIDTH_FRAC * wu / ncols,
                 self.HEIGHT_FRAC * hu / (nrows * self.CELL_ASPECT))
        ch = cw * self.CELL_ASPECT
        x0 = (wu - ncols * cw) / 2.0
        y0 = (hu - nrows * ch) / 2.0
        for ci, ri in cells:
            px = x0 + (ci + 0.5) * cw
            py = y0 + (ri + 0.5) * ch
            self._blit(canvas, px, py, self._activation(ci, ri, ncols, nrows),
                       cw, ch)
# ---------------------------------------------------------------------------
# Scene 11 — wave sphere
# ---------------------------------------------------------------------------
#
# A sphere sampled on a lat/long grid, each surface point drawn as a stretch
# cell oriented along its latitude ring. The wave runs by latitude, so crests
# form concentric rings rippling outward from the pole. The pole leans toward
# the camera and the sphere spins, so the surface flows toward you. Composed
# bottom-heavy — a big dome filling the lower frame with black above, exactly
# like the reference.
class SphereWaveScene(StretchWaveScene):
    name = "wave sphere"
    USE_BLOCKS = False     # earlier look: solid rect_fill crests + Braille dots

    N_LAT = 20             # latitude bands (few -> clearly separated rings)
    LON_MAX = 96           # longitude points at the widest band (dense within ring)
    LON_MIN = 8            # longitude points near the pole
    RADIUS_FRAC = 0.62     # sphere radius as a fraction of hu
    CY_FRAC = 0.9          # sphere centre y (fraction of hu): dome fills the bottom
    TILT = 0.5             # pole leans toward the camera (radians)
    SPIN_SPEED = 0.22      # gentle spin under the dominant ripple
    FOCAL_FRAC = 5.5       # perspective focal distance (bigger = flatter)
    EPS = 0.2              # cull the grazing limb -> a cleaner dome silhouette
    CELL = 4.4             # base cell size at the near plane, braille units
    WAVE_SPREAD = 2.6      # ring wavelength, in latitude bands
    RIPPLE_SPEED = 1.4     # how fast the concentric wave ripples outward
    # Strong contrast so the wave reads loud: troughs collapse to dots, crests
    # stretch into bold bars — the concentric ripple is the dominant motion.
    SX_MIN = 2.0
    SX_MAX = 6.5
    TH_MIN = 0.1
    TH_MAX = 0.46
    TH_CAP_FRAC = 0.55

    def _project(self, theta, phi, cx, cy, R, ct, st, focal):
        sx = math.sin(theta) * math.cos(phi)
        sy = math.cos(theta)
        sz = math.sin(theta) * math.sin(phi)
        py3 = sy * ct - sz * st               # tilt the pole toward the camera
        pz3 = sy * st + sz * ct
        f = focal / (focal - pz3 * R)         # nearer -> larger
        return cx + sx * R * f, cy - py3 * R * f, pz3, f

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx = wu / 2.0
        cy = self.CY_FRAC * hu
        R = self.RADIUS_FRAC * hu
        ct, st = math.cos(self.TILT), math.sin(self.TILT)
        focal = self.FOCAL_FRAC * R
        spin = self.t * self.SPIN_SPEED
        rip = self.t * self.RIPPLE_SPEED

        for li in range(1, self.N_LAT + 1):
            theta = (li / self.N_LAT) * math.pi
            nlon = max(self.LON_MIN, int(self.LON_MAX * math.sin(theta)))
            # concentric wave rippling outward from the pole — the dominant motion
            np = self._wave_ease(
                (math.sin(li / self.WAVE_SPREAD - rip) + 1.0) * 0.5)
            for j in range(nlon):
                phi = (j / nlon) * 2 * math.pi + spin     # gentle spin underneath
                px, py, pz, f = self._project(theta, phi, cx, cy, R, ct, st, focal)
                if pz <= self.EPS:
                    continue                  # back of the sphere
                # horizontal dashes read cleanly at terminal resolution
                self._blit_along(canvas, px, py, np, self.CELL * f, 0.0)
# ---------------------------------------------------------------------------
# Registry — appended to mpp's built-in scenes, in display order. The number in
# each comment is the scene number you see running `python scenes.py` (+15 when
# run via `python mpp.py`). Same order as the SCENE INDEX in the module docstring.
# ---------------------------------------------------------------------------
def make_scenes():
    return [
        MachineScene(),               # 1  — open-source wash
        MachineWaveScene(),           # 1b — MACHINE/PAYMENT/PROTOCOL cycled, wave-only
        MachineListScene(),           # 1c — OPEN/PROTOCOL/MACHINE/TO MACHINE/PAYMENTS, left
        MachineBannerScene(),         # 1d — MACHINE TO MACHINE scrolling banner (marquee)
        MachineStretchScene(),        # 2  — machine payment protocol (stretch wave)
        WordmarkRelayBlocksScene(),   # 4  — mpp wordmark relay
        SphereWaveScene(),            # 11 — wave sphere
    ]


if __name__ == "__main__":
    # Run the explorer showing only these scenes. Reuses mpp's runner, so all
    # the usual flags work (--no-motion, --banner, --export, --scene, ...).
    import mpp

    mpp.main(make_scenes())
