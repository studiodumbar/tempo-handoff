#!/usr/bin/env python3
"""
mpp-terminal — scenes rendered with only periods and keyboard dashes ( . _ - ~ =).

THE CHARACTER SET (periods & dashes). One density ramp (_RAMP) renders every block,
  wave, swell and solid fill; _SOLID is its densest cell. Dense-text scenes still
  use Braille for legibility. The original two-set notes follow:

  • Braille (the DEFAULT) — 2x4 sub-pixel dots, the finest grain. Everything uses
    it unless stated otherwise, and dense text REQUIRES it: the matrix font's 7
    rows need sub-character precision, and blocks (4x coarser vertically) collapse
    a glyph into ~3 rows.

  • Block elements (▁▂▃▄▅▆▇█ and the left-block companions ▏▎▍▌▋▊▉█) — the DEFAULT
    for WAVE MOVEMENT. Any scene whose identity is a travelling wave renders its
    bars as crisp block characters: thickness maps to the block fill level (lower
    blocks grow a horizontal bar upward from a baseline; left blocks grow a
    vertical bar rightward). Coarser, but reads as clean solid bars.

A scene opts into blocks with `USE_BLOCKS = True` (on StretchWaveScene and its
wave subclasses). The rule: wave movement -> blocks, UNLESS the content is dense
text, which stays Braille for legibility. `_hbar`/`_vbar` are the Braille bars;
`_hbar_block`/`_vbar_block` the block bars; `_blit` dispatches on `USE_BLOCKS`.
Solid fills (rect_fill -> █, seamless via reverse video) are shared by both, and
the spiral's truly-angled ribbons fall back to nearest-axis block bars (blocks
can't rotate). Run standalone: `python scenes1.py`.

SCENE INDEX (the order in make_scenes() at the bottom; these are the numbers you
see running `python scenes.py`. Run via `python mpp.py` instead and they're
offset by +15, after mpp's own 15 built-in scenes). Classes appear below in this
same order, each under a `# Scene N — ...` header:

   1  MachineScene              — MACHINE PAYMENT PROTOCOL (horizontal-line wash)
   2  MachineStretchScene       — the phrase on the Shape-Type-Studio stretch wave
   3  WordmarkScene             — the static mpp wordmark (the reference logo)
   4  WordmarkRelayBlocksScene  — the wordmark with the springy relay choreography
   5  MachineStretchVScene      — scene 2, vertical stretch wave
   6  FieldWaveScene            — full-frame block wave (the scene-6 swell)
   7  MPPWaveScene              — the stretch wave on the mpp wordmark
   8  MPPWaveVScene             — scene 7, vertical
   9  TravellingWaveStretchScene— a gaussian wavefront sweeping a block grid
  10  SpiralStretchScene        — wave travelling along a pseudo-3D spiral
  11  SphereWaveScene           — wave rippling over a spinning sphere
  12  MachinePaymentScene       — MACHINE / PAYMENT cover-then-reveal wipe
  13  LineRampScene             — the short->large line ramp (wave reference)
  14  MPPSwellScene             — the block swell masked to the mpp wordmark
  15  M2MSwellScene             — the swell masked to "MACHINE TO MACHINE"
  16  MPPRevealScene            — full-frame wave that locks the wordmark to solid

StretchWaveScene (the reusable wave engine) and the `_*` helpers are infrastructure,
not numbered scenes.
"""

import math

from mpp import (Scene, _clamp, EASE, EASE_BACK, GENTLE, _WM_M, _WM_P,
                 _fbm, _GOLDEN_ANGLE)

# Short->large thickness ramps: lower blocks grow a horizontal bar upward from a
# baseline; left blocks grow a vertical bar rightward from a left edge.
# Periods + every dash on the keyboard, ramped light -> heavy:
#   .  period (faintest)   _  low dash      -  mid dash
#   ~  wavy dash           =  double dash (densest; used as the solid fill)
_RAMP = (" ", ".", ".", "_", "-", "-", "~", "=", "=")
_SOLID = _RAMP[-1]
_BLOCK_DOWN = _RAMP
_BLOCK_LEFT = _RAMP


def _down_char(level):
    return _BLOCK_DOWN[int(_clamp(level, 0.0, 1.0) * 8 + 0.5)]


def _left_char(level):
    return _BLOCK_LEFT[int(_clamp(level, 0.0, 1.0) * 8 + 0.5)]


def _quad_in_out(x):
    """Quadratic ease-in-out (the 'quadInOut' option in the Shape Type Studio
    tool): slow at both ends, quick through the middle. Plain quadratic, not the
    bezier above, so the wave matches the tool exactly."""
    return 2.0 * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 2) / 2.0


# ---------------------------------------------------------------------------
# Scene 1 — Machine payment protocol
# ---------------------------------------------------------------------------
#
# The phrase "MACHINE PAYMENT PROTOCOL" built entirely from horizontal lines: a 5x7
# matrix font where every filled row of a letter is drawn as a horizontal bar,
# so vertical strokes read as stacked dashes (a venetian-blind letterform). The
# phrase is stacked on three rows. A bright crest washes left->right over and
# over at a steady, gentle cadence; where it passes, bars thicken from a thin
# Braille line to a solid half-block bar (the brand's outline->invert move). The
# reveal frontier eases smoothly outward so the phrase fills in left-to-right
# and the wash reaches a little further each pass — one continuous flow, not
# discrete stages. It fills, holds, dissolves, and loops.

# 5-wide x 7-tall horizontal-stroke font; only the letters in the phrase.
_M2M_FW = 5
_M2M_FH = 7
_M2M_FONT = {
    "M": ("#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"),
    "A": (".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    "C": (".####", "#....", "#....", "#....", "#....", "#....", ".####"),
    "H": ("#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    "I": ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"),
    "N": ("#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"),
    "E": ("#####", "#....", "#....", "####.", "#....", "#....", "#####"),
    "T": ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
    "O": (".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
    "P": ("####.", "#...#", "#...#", "####.", "#....", "#....", "#...."),
    "Y": ("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."),
    "R": ("####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"),
    "L": ("#....", "#....", "#....", "#....", "#....", "#....", "#####"),
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
    cells = [(base - 1 - k, _SOLID) for k in range(full)]
    if rem >= 1.0:
        cells.append((base - 1 - full, _down_char(_clamp(rem / 4.0, 0.13, 1.0))))
    elif full == 0:
        cells.append((base - 1, _RAMP[1]))
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
    cells = [(base + k, _SOLID) for k in range(full)]
    if rem >= 0.5:
        cells.append((base + full, _left_char(_clamp(rem / 2.0, 0.13, 1.0))))
    elif full == 0:
        cells.append((base, _RAMP[1]))
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
    r0 = int(round(top / 4.0))
    nr = max(1, int(round(bh / 4.0)))
    c0 = int(round((cx - w / 2.0) / 2.0))
    c1 = int(round((cx + w / 2.0) / 2.0))
    if c1 <= c0:
        c1 = c0 + 1
    for r in range(r0, r0 + nr):
        for c in range(c0, c1):
            canvas.set_char(c, r, _SOLID)


def _fill(canvas, cx, cy, w, h):
    """Solid fill stamped in the variant character set: cover the cells the
    rect spans with _SOLID. Replaces canvas.rect_fill so solids match the set."""
    c0 = int(round((cx - w / 2.0) / 2.0))
    c1 = int(round((cx + w / 2.0) / 2.0))
    r0 = int(round((cy - h / 2.0) / 4.0))
    r1 = int(round((cy + h / 2.0) / 4.0))
    if c1 <= c0:
        c1 = c0 + 1
    if r1 <= r0:
        r1 = r0 + 1
    for r in range(r0, r1):
        for c in range(c0, c1):
            canvas.set_char(c, r, _SOLID)


def _m2m_runs(text):
    """Horizontal runs for `text` as (col0, col1, row) in absolute dot columns,
    plus the laid-out width. Each run is a maximal stretch of lit cells in one
    matrix row — the horizontal bars the scene draws."""
    bars = []
    col = 0
    for ch in text:
        if ch == " ":
            col += _M2M_SPACE
            continue
        glyph = _M2M_FONT[ch]
        for r in range(_M2M_FH):
            line = glyph[r]
            c = 0
            while c < _M2M_FW:
                if line[c] == "#":
                    c1 = c
                    while c1 + 1 < _M2M_FW and line[c1 + 1] == "#":
                        c1 += 1
                    bars.append((col + c, col + c1, r))
                    c = c1 + 1
                else:
                    c += 1
        col += _M2M_FW + _M2M_GAP
    width = max(col - _M2M_GAP, 1)   # drop the trailing inter-letter gap
    return bars, width


# Built once: the phrase is static, so its bars never change.
_M2M_BARS, _M2M_WIDTH = _m2m_runs("MACHINE PAYMENT PROTOCOL")


class MachineScene(Scene):
    name = "machine payment protocol"

    # -- tunables ----------------------------------------------------------
    N_ROWS = 3            # stacked copies of the phrase
    ROW_GAP = 1           # blank dot-rows between stacked phrases
    WIDTH_FRAC = 0.94     # text-block width as a fraction of wu
    HEIGHT_FRAC = 0.82    # text-block height as a fraction of hu
    BUILD = 6.4           # seconds for the wash to fill the whole phrase
    PASS_TIME = 1.75      # seconds for one crest sweep (sets the wash cadence)
    HOLD = 2.35           # full-phrase hold; BUILD+HOLD = 5 passes, so the free                    wash is dark at the hand-off to OUT (no crest pop)
    OUT = 1.6             # seconds for the wipe-out wave to sweep it away
    GAP = 0.7             # quiet beat before the loop repeats
    HI = 2.0              # reveal-window high edge, parked off the right margin
    MARGIN = 0.06         # crest over-travel past each end (fx), hides the wrap
    BAND = 0.11           # crest half-width, in normalised x (0..1)
    REVEAL_SOFT = 0    # soft reveal band so letters fade in (no pop)
    BASE_TH = 1.0         # resting bar thickness, braille units (-> thin line)
    MAX_TH_FRAC = 0.82    # crest bar thickness as a fraction of the dot pitch
    MIN_RANGE = 2.2       # guaranteed thin->thick swing, braille units
    SOLID_A = 0.55        # crest activation above which a bar inverts to solid
    SOLID_MIN_PITCH = 2.4  # only invert when the pitch leaves room for a cell

    def _cycle(self):
        return self.BUILD + self.HOLD + self.OUT + self.GAP

    def _phase(self):
        """Continuous (lo, hi, crest_x, crest_amp) for the loop time.

        Bars are lit inside a soft-edged window [lo, hi]. BUILD grows `hi` so the
        phrase fills in left->right; OUT grows `lo` so a wipe-out wave eats it
        away left->right. Through BUILD/HOLD a free crest washes over the lit
        region with its brightness waxing/waning (so its wrap is invisible); in
        OUT the crest rides the erase edge. Every term is a smooth function of
        time, so the motion never starts, stops, or jumps abruptly."""
        tt = self.t % self._cycle()
        s = (tt / self.PASS_TIME) % 1.0
        wash_amp = math.sin(math.pi * s)           # 0 at the wrap, smooth swell
        if tt < self.BUILD:
            # Overshoot past 1 so the soft edge fully clears the rightmost bars
            # by the hand-off; the crest's sweep extent caps at 1 so it stays
            # continuous into HOLD.
            fhi = GENTLE(tt / self.BUILD) * (1.0 + 2 * self.REVEAL_SOFT)
            lit = min(fhi, 1.0)
            cx = -self.MARGIN + GENTLE(s) * (lit + 2 * self.MARGIN)
            return -1.0, fhi, cx, wash_amp
        tt -= self.BUILD
        if tt < self.HOLD:
            cx = -self.MARGIN + GENTLE(s) * (1.0 + 2 * self.MARGIN)
            return -1.0, self.HI, cx, wash_amp
        tt -= self.HOLD
        if tt < self.OUT:
            outp = tt / self.OUT
            # Erase edge starts off the left margin (nothing erased yet, so it
            # matches HOLD) and sweeps just past the right edge.
            edge = -2 * self.REVEAL_SOFT + GENTLE(outp) * (1.0 + 2 * self.REVEAL_SOFT)
            return edge, self.HI, edge, math.sin(math.pi * outp)
        return self.HI, self.HI, 0.0, 0.0           # GAP: fully wiped, quiet

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        tw = _M2M_WIDTH
        block_rows = self.N_ROWS * _M2M_FH + (self.N_ROWS - 1) * self.ROW_GAP
        pitch = min(self.WIDTH_FRAC * wu / tw,
                    self.HEIGHT_FRAC * hu / block_rows)
        block_w = tw * pitch
        block_h = block_rows * pitch
        x0 = (wu - block_w) / 2.0
        y0 = (hu - block_h) / 2.0

        lo, hi, crest_x, crest_amp = self._phase()
        room = pitch * 0.92                        # keep stacked rows from merging
        # Thin->thick swing: a fraction of the pitch, but always a real swing
        # even when the pitch is small (a narrow terminal squashes the text).
        max_th = max(self.MAX_TH_FRAC * pitch, self.BASE_TH + self.MIN_RANGE)

        for ri in range(self.N_ROWS):
            ry0 = y0 + ri * (_M2M_FH + self.ROW_GAP) * pitch
            for c0, c1, r in _M2M_BARS:
                left = x0 + c0 * pitch
                right = x0 + (c1 + 1) * pitch
                cx = (left + right) / 2.0
                fx = (cx - x0) / block_w
                # Soft-edged reveal window: filled at the right as it builds,
                # eaten at the left as it wipes out. REVEAL_SOFT == 0 -> a hard
                # edge (no soft fade), avoiding a divide-by-zero.
                if self.REVEAL_SOFT > 0.0:
                    rev = min((fx - lo) / self.REVEAL_SOFT,
                              (hi - fx) / self.REVEAL_SOFT, 1.0)
                else:
                    rev = 1.0 if lo <= fx <= hi else 0.0
                if rev <= 0.0:
                    continue
                a = crest_amp * math.exp(-((fx - crest_x) / self.BAND) ** 2)
                th = (self.BASE_TH + a * (max_th - self.BASE_TH)) * rev
                th = min(th, room)
                if th < 0.5:
                    continue
                cy = ry0 + (r + 0.5) * pitch
                _hbar(canvas, left, right - 1, cy, th)
                # (No solid-block invert: at this small pitch it rendered as
                # ragged half-blocks among the Braille — glitchy. The wave now
                # reads purely as the Braille bars thickening at the crest.)

    def status(self):
        tt = self.t % self._cycle()
        if tt < self.BUILD:
            return "BUILD"
        if tt < self.BUILD + self.HOLD:
            return "HOLD"
        if tt < self.BUILD + self.HOLD + self.OUT:
            return "OUT"
        return "GAP"


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
}
_STS_SPACE = ("....." ,) * 7
_STS_TEXT = "MACHINE PAYMENT PROTOCOL"


def _sts_cells(text):
    """Lit (col, row) cells across the phrase and its total column count, with
    each glyph 5 wide and no inter-letter gap (the tool's lg = 0). Cells are
    drawn individually — never merged — so the stretch wave can pull them
    together and apart."""
    cells = []
    col = 0
    for ch in text:
        glyph = _STS_FONT.get(ch, _STS_SPACE)
        for ri in range(7):
            line = glyph[ri]
            for cc in range(5):
                if line[cc] == "#":
                    cells.append((col + cc, ri))
        col += 5
    return cells, col


_STS_CELLS, _STS_COLS = _sts_cells(_STS_TEXT)
_COS45 = 0.7071067811865476


class MachineStretchScene(Scene):
    name = "machine payment protocol (stretch wave)"

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
    SX_MAX = 6.0         # horizontal stretch at a crest (cells merge into lines)
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
    TH_CAP_FRAC = 0.95    # max bar thickness as a fraction of the row pitch

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
                np = _quad_in_out((math.sin(phase) + 1.0) * 0.5)
                stretch = self.SX_MIN + np * (self.SX_MAX - self.SX_MIN)
                thick = self.TH_MIN + np * (self.TH_MAX - self.TH_MIN)
                final_r = base_r * thick
                if final_r < floor:
                    final_r = floor
                hw = final_r * _COS45 * stretch          # horizontal half-extent
                bar_th = 2.0 * final_r * _COS45 * self.TH_GAIN
                if bar_th > th_cap:
                    bar_th = th_cap
                # Pure Braille thin->thick bar. (No solid half-block invert at
                # the crest: at this text pitch it read as ragged blocks among
                # the Braille — the glitchy highlight. The wave is the Braille
                # bars stretching and thickening.)
                _hbar(canvas, px - hw, px + hw, py, bar_th)


# ---------------------------------------------------------------------------
# Scene 3 — mpp wordmark
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


def _wm_rows():
    """The full 'mpp' bitmap: m, p, p, each 5x5, with a one-cell gap between."""
    return [m + "." + p + "." + q
            for m, p, q in zip(_WM_M, _WM_P, _WM_P)]


_WM_ROWS = _wm_rows()


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


class WordmarkScene(Scene):
    name = "mpp wordmark"

    WIDTH_FRAC = 0.62     # mark width as a fraction of wu
    HEIGHT_FRAC = 0.8     # height cap (only bites on very short canvases)
    GAP_ROWS = 1          # blank character rows between the bars

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        ncols = len(_WM_ROWS[0])
        nrows = len(_WM_ROWS)
        # Each bar is exactly ONE character row tall. A lone `█` row is a clean
        # solid block; stacking `█` rows shows the font's hairline cell seam, so
        # we never stack — the venetian gaps come from blank rows between bars.
        # Everything is char-aligned (x even braille, y a multiple of 4).
        ch = 4                                       # braille units per char row
        block_h = ch                                 # 1-row bar -> seamless
        pyb = ch * (1 + self.GAP_ROWS)               # bar + gap
        total_h = (nrows - 1) * pyb + block_h
        if total_h > self.HEIGHT_FRAC * hu:          # tiny canvas: drop the gaps
            pyb, total_h = ch, nrows * ch
        px = max(2, round(self.WIDTH_FRAC * wu / ncols / 2) * 2)
        total_w = ncols * px
        x0 = round((wu - total_w) / 4) * 2           # centred, whole-char columns
        y0 = round((hu - total_h) / 8) * 4           # centred, whole-char rows

        for r, row in enumerate(_WM_ROWS):
            cy = y0 + r * pyb + block_h / 2.0
            c = 0
            while c < ncols:
                if row[c] == "#":
                    c1 = c
                    while c1 + 1 < ncols and row[c1 + 1] == "#":
                        c1 += 1
                    run = c1 - c + 1
                    cx = x0 + (c + run / 2.0) * px
                    _fill(canvas, cx, cy, run * px, block_h)
                    c = c1 + 1
                else:
                    c += 1


# ---------------------------------------------------------------------------
# Scene 4 — mpp wordmark relay
# ---------------------------------------------------------------------------
#
# mpp.py's RelayScene springy relay choreography driving the block-wordmark: mark
# wipes in left->right (per-glyph staggered scale-pop), the letters fan apart
# from the centre with overshoot, a short train of nodes relays from the middle
# p to the end p and the baton continues from the end p across to the m, the
# nodes animate out, and the letters spring back to the tight lockup. Same
# easing/phase structure as RelayScene; the letters and nodes are solid blocks.
class WordmarkRelayBlocksScene(Scene):
    name = "mpp wordmark relay"

    CYCLE = 8.0
    WIDTH_FRAC = 0.42      # tight-lockup width as a fraction of wu
    HEIGHT_FRAC = 0.55     # cap so the word fits tall/short terminals
    ROW_RATIO = 0.83       # cell aspect, matching the wordmark scene
    BLOCK_H_FRAC = 0.6     # block height as a fraction of the row pitch
    SPREAD_MULT = 1.9      # how far the letters fan out from centre
    GLYPH_STAGGER = 0.22   # left-to-right delay between letters on wipe in/out
    RELAY_NODES = 4        # nodes that travel each path
    RELAY_STAGGER = 0.18   # launch delay between nodes (fraction of the travel)
    NODE_W_FRAC = 1.0      # relay node width as a fraction of the cell pitch

    # Phase windows (fractions of the cycle) — same as scene 15.
    WIPE_IN = (0.00, 0.12)
    SPREAD = (0.15, 0.28)
    PP_IN = (0.31, 0.46)   # relay: nodes travel middle p -> right p
    PP_OUT = (0.48, 0.55)  # those nodes shrink away
    PM_IN = (0.55, 0.70)   # relay: nodes travel right p -> m
    PM_OUT = (0.72, 0.80)  # animate the nodes out
    UNSPREAD = (0.82, 0.92)
    WIPE_OUT = (0.93, 1.00)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        u = (self.t % self.CYCLE) / self.CYCLE
        px = min(self.WIDTH_FRAC * wu / _wm_word_cols(),
                 self.HEIGHT_FRAC * hu / (_WM_GH * self.ROW_RATIO))
        px = _clamp(px, 3.0, 16.0)
        glyphs = _wm_glyph_elements(px, self.ROW_RATIO, self.BLOCK_H_FRAC)
        block_h = px * self.ROW_RATIO * self.BLOCK_H_FRAC
        node_w = px * self.NODE_W_FRAC

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
                    if e["h"] * gscale > 0.6:
                        _block_snapped(canvas, cxg + e["x"], cy + e["y"],
                                       e["w"] * gscale, e["h"] * gscale)

        # Relay: a short train of nodes that travels from the source glyph's edge
        # to the target's with a strong ease, arrives, then shrinks out.
        def relay(i_src, i_dst, win_in, win_out):
            sgn = 1.0 if i_dst > i_src else -1.0
            xs = centers[i_src] + glyphs[i_src]["half"] * sgn
            xd = centers[i_dst] - glyphs[i_dst]["half"] * sgn
            tin = seg(win_in)
            shrink = EASE(seg(win_out))          # 0 while travelling, 1 = gone
            if tin <= 0.0 and shrink <= 0.0:
                return
            travel = max(1.0 - self.RELAY_STAGGER * (self.RELAY_NODES - 1), 0.1)
            for k in range(self.RELAY_NODES):
                launch = k * self.RELAY_STAGGER
                if tin < launch and shrink <= 0.0:
                    continue                     # this node hasn't launched yet
                p = EASE(_clamp((tin - launch) / travel, 0.0, 1.0))
                x = xs + (xd - xs) * p           # actual A -> B travel
                s = 1.0 - shrink
                if block_h * s > 0.6:
                    _block_snapped(canvas, x, cy, node_w * s, block_h * s)

        relay(1, 2, self.PP_IN, self.PP_OUT)   # middle p -> end p
        relay(2, 0, self.PM_IN, self.PM_OUT)   # end p -> m (baton continues)

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
# Scene 5 — Machine payment protocol (stretch wave, vertical)
# ---------------------------------------------------------------------------
#
# The tool's vertical wave mode: same stretch-wave as scene 17, but the sine is
# driven by each cell's vertical position across the whole block (so the wave
# travels top->bottom through all three lines as one continuous motion) and the
# stretch is applied to the Y axis — cells stretch *tall* and a run of near-crest
# cells merges into a continuous vertical bar, collapsing to a dot at a trough.
# Inherits scene 17's tuned look; only the wave axis and wavelength differ (the
# block is far shorter than it is wide, so the wavelength scales down to match).
class MachineStretchVScene(MachineStretchScene):
    name = "machine payment protocol (stretch wave, vertical)"

    # The block is ~22 cells tall vs ~90 wide, so a comparable wave needs a much
    # shorter wavelength than the horizontal scene's WAVE_SPREAD.
    WAVE_SPREAD = 4.0
    RS = 0.7              # tighter rows than the horizontal scene so the vertical
    #                       stretch reads as continuous bars (the half-block solid
    #                       here is gated by the column pitch, not the row pitch)
    TW_CAP_FRAC = 0.72    # max bar width as a fraction of the column pitch

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        ncols = _STS_COLS
        n = self.N_LINES
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
        tw_cap = cw * self.TW_CAP_FRAC

        for li in range(n):
            line_off_y = y0 + li * (line_h * self.LINE_HEIGHT)
            for ci, ri in _STS_CELLS:
                px = x0 + ci * cw + cw * 0.5
                py = line_off_y + ri * ch + ch * 0.5
                vcell = (py - y0) / ch            # vertical cell index (all lines)
                phase = vcell / self.WAVE_SPREAD - t * speed
                np = _quad_in_out((math.sin(phase) + 1.0) * 0.5)
                stretch = self.SX_MIN + np * (self.SX_MAX - self.SX_MIN)
                thick = self.TH_MIN + np * (self.TH_MAX - self.TH_MIN)
                final_r = base_r * thick
                if final_r < floor:
                    final_r = floor
                vh = final_r * _COS45 * stretch           # vertical half-extent
                bar_tw = 2.0 * final_r * _COS45 * self.TH_GAIN
                if bar_tw > tw_cap:
                    bar_tw = tw_cap
                # Thin->thick Braille bar at any size; a crisp solid fill once
                # the crest is wide enough to host a whole half-block cell.
                _vbar(canvas, px, py - vh, py + vh, bar_tw)
                if bar_tw >= 2.0:
                    _fill(canvas, px, py, bar_tw, vh * 2.0)


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
        # quadInOut (the tool's default) holds the crest near its peak; a scene
        # can override with `x` (pure sine) for a narrower travelling band.
        return _quad_in_out(x)

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
            canvas.rect_fill(px, py, along * 2.0, tw, angle)
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


def _block_grid(wu, hu, width_frac, height_frac, pitch):
    """A full rectangular grid of cells sized to ~`pitch` braille units."""
    ncols = max(4, int(width_frac * wu / pitch))
    nrows = max(3, int(height_frac * hu / pitch))
    return [(c, r) for r in range(nrows) for c in range(ncols)], ncols, nrows


# ---------------------------------------------------------------------------
# Scene 6 — wave field
# ---------------------------------------------------------------------------
#
# The scene-14 block aesthetic as a moving wave: a stack of horizontal lines,
# each a clean single row of the block ramp ▁..█, with a thickness crest
# travelling left->right and staggered per line so the wave descends the stack
# sequentially. Each line is confined to one character row (no overlap / mush).
class FieldWaveScene(Scene):
    name = "wave field"

    N_LINES = 24
    WIDTH_FRAC = 0.8
    GAP_ROWS = 0          # blank character rows between lines
    SWEEP_TIME = 4    # seconds for one eased crest to whip across a line
    STUTTER = 0.01       # very short delay between consecutive line starts
    HOLD = 0             # quiet beat after the last line before the loop
    BAND = 0.5        # crest half-width (fraction of the line)
    BASE = 0.07          # resting thin line, always present
    MARGIN = 0.76          # crest enters/exits this far off each edge (seamless)

    def _cycle(self):
        return (self.N_LINES - 1) * self.STUTTER + self.SWEEP_TIME + self.HOLD

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        w = max(8, int(self.WIDTH_FRAC * cols))
        x0 = (cols - w) // 2
        n = self.N_LINES
        total = n + (n - 1) * self.GAP_ROWS
        y0 = max(0, (rows - total) // 2)
        tt = self.t % self._cycle()
        span = 1.0 + 2.0 * self.MARGIN
        for li in range(n):
            ry = y0 + li * (1 + self.GAP_ROWS)
            if ry >= rows:
                break
            # Each line starts its sweep a short stutter after the one above; the
            # crest position eases hard in and out as it whips across (EASE is
            # cubic-bezier(0.85, 0, 0.15, 1)). Off-window the line rests thin.
            local = tt - li * self.STUTTER
            front = None
            if 0.0 <= local <= self.SWEEP_TIME:
                front = -self.MARGIN + EASE(local / self.SWEEP_TIME) * span
            for i in range(w):
                fx = i / (w - 1)
                level = self.BASE
                if front is not None:
                    d = (fx - front) / self.BAND
                    level = self.BASE + (1.0 - self.BASE) * math.exp(-d * d)
                ch = _down_char(level)
                if ch != " ":
                    canvas.set_char(x0 + i, ry, ch)


# ---------------------------------------------------------------------------
# Scene 7 — mpp wave
# ---------------------------------------------------------------------------
def _wm_cells():
    """Lit (col, row) cells of the canonical mpp wordmark — the same _WM glyph
    design the static wordmark and the relay use — laid out as a wave field."""
    cells = [(c, r) for r, row in enumerate(_WM_ROWS)
             for c, ch in enumerate(row) if ch == "#"]
    return cells, len(_WM_ROWS[0]), len(_WM_ROWS)


_WM_WAVE_CELLS, _WM_WAVE_COLS, _WM_WAVE_ROWS = _wm_cells()


class MPPWaveScene(StretchWaveScene):
    name = "mpp wave"

    WIDTH_FRAC = 0.74
    HEIGHT_FRAC = 0.5
    CELL_ASPECT = 1.0
    WAVE_SPREAD = 6.0

    def field(self, wu, hu):
        return _WM_WAVE_CELLS, _WM_WAVE_COLS, _WM_WAVE_ROWS


# Scene 8 — mpp wave (vertical)
class MPPWaveVScene(MPPWaveScene):
    name = "mpp wave (vertical)"

    PHASE_AXIS = "row"
    STRETCH_AXIS = "y"
    CELL_ASPECT = 0.82     # wide, short cells -> reads like the true wordmark
    WIDTH_FRAC = 0.62      # match the static wordmark's width
    HEIGHT_FRAC = 0.42     # keep it short, not tall
    WAVE_SPREAD = 2.4      # only 5 cells tall
    SP = 0.6               # animate noticeably faster (loop ~3.3s)

    @staticmethod
    def _wave_ease(x):
        # way stronger easing: a hard cubic-bezier S, so cells snap thin->thick
        return EASE(x)


# ---------------------------------------------------------------------------
# Scene 9 — travelling wave (stretch)
# ---------------------------------------------------------------------------
#
# mpp's scene 2 is a grid swept by a single gaussian wavefront; here the cells
# ride that same sweeping wavefront but render with the stretch effect — a band
# of cells stretches into horizontal bars as the front passes, left to right.
class TravellingWaveStretchScene(StretchWaveScene):
    name = "travelling wave (stretch)"
    USE_BLOCKS = True      # abstract scene -> block character set

    COLS = 16
    ROWS = 8
    WIDTH_FRAC = 0.9
    HEIGHT_FRAC = 0.8
    SWEEP_TIME = 3.0       # seconds for one left->right sweep
    BAND_FRAC = 0.14       # gaussian half-width, as a fraction of the columns
    SX_MAX = 5.0           # distinct bars that grow, not a chain-merged block
    TH_CAP_FRAC = 0.5      # keep the rows distinct

    def field(self, wu, hu):
        cells = [(c, r) for r in range(self.ROWS) for c in range(self.COLS)]
        return cells, self.COLS, self.ROWS

    def _activation(self, ci, ri, ncols, nrows):
        fx = ci / max(ncols - 1, 1)
        span = 1.0 + 2.0 * self.BAND_FRAC
        cyc = (self.t % self.SWEEP_TIME) / self.SWEEP_TIME
        wf = EASE(cyc) * span - self.BAND_FRAC          # off-left -> off-right
        d = (fx - wf) / self.BAND_FRAC
        return math.exp(-(d * d))


# ---------------------------------------------------------------------------
# Scene 10 — pseudo-3D spiral (stretch)
# ---------------------------------------------------------------------------
#
# mpp's scene 3 is a rotating 3D helix drawn as a ribbon with squares at the
# points; here the ribbon stays but a wave travels ALONG the spiral, each point
# stretching along the ribbon's tangent into a solid segment at the crest and
# collapsing to a dot at a trough — a pulse of "fill" spiralling down as it
# turns. Perspective still scales the near points up.
class SpiralStretchScene(StretchWaveScene):
    name = "pseudo-3D spiral (stretch)"
    USE_BLOCKS = True      # abstract scene -> block character set

    NUM_POINTS = 96
    TURNS = 2.6
    ROT_SPEED = 0.5        # radians / second the helix spins
    RADIUS_FRAC = 0.42
    VEXT_FRAC = 0.95       # vertical extent as a fraction of hu
    FOCAL_FRAC = 1.6       # perspective focal distance, in radius units
    CELL = 6.0             # base cell size at the near plane, braille units
    WAVE_SPREAD = 11.0     # wavelength in points along the spiral
    SX_MAX = 5.0

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        radius = min(wu, hu) * self.RADIUS_FRAC
        vext = hu * self.VEXT_FRAC
        focal = radius * self.FOCAL_FRAC
        n = self.NUM_POINTS

        pts = []
        for i in range(n):
            frac = i / (n - 1)
            ang = frac * self.TURNS * 2 * math.pi + self.t * self.ROT_SPEED
            x3 = radius * math.cos(ang)
            z3 = radius * math.sin(ang)
            y3 = (frac - 0.5) * vext
            f = focal / (focal + z3)              # nearer -> larger
            pts.append((cx + x3 * f, cy + y3 * f, f))

        for i in range(n - 1):                    # the receding ribbon
            canvas.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])

        speed = self.SP * self.TIME_K
        for i in range(n):
            px, py, f = pts[i]
            np = self._wave_ease((math.sin(i / self.WAVE_SPREAD - self.t * speed)
                                  + 1.0) * 0.5)
            j = i + 1 if i + 1 < n else i - 1     # tangent toward the neighbour
            ang = math.atan2(pts[j][1] - py, pts[j][0] - px)
            self._blit_along(canvas, px, py, np, self.CELL * f, ang)


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
    USE_BLOCKS = True      # abstract scene -> block character set

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
# Scene 12 — machine payment
# ---------------------------------------------------------------------------
#
# "MACHINE / PAYMENT" in the horizontal-line font. A solid white cover wipes in
# row by row (each row whips left->right, then the next row down), covering the
# text. It holds, then the cover wipes out the same way (top->bottom) but fades
# from white back to black, so the text is revealed underneath. Loops.
_COVER_FONT = dict(_STS_FONT)
_COVER_FONT["P"] = ("####.", "#...#", "#...#", "####.", "#....", "#....", "#....")
_COVER_FONT["Y"] = ("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..")
_MP_LINES = ("MACHINE", "PAYMENT")
_MP_GW, _MP_GH, _MP_GAP, _MP_LINE_GAP = 5, 7, 1, 2


def _mp_grid():
    """Set of lit (col, row) text cells and the grid dimensions for both lines."""
    ncols = max(len(l) * _MP_GW + (len(l) - 1) * _MP_GAP for l in _MP_LINES)
    nrows = len(_MP_LINES) * _MP_GH + (len(_MP_LINES) - 1) * _MP_LINE_GAP
    text = set()
    for li, line in enumerate(_MP_LINES):
        row0 = li * (_MP_GH + _MP_LINE_GAP)
        col = 0
        for ch in line:
            glyph = _COVER_FONT[ch]
            for r in range(_MP_GH):
                for c in range(_MP_GW):
                    if glyph[r][c] == "#":
                        text.add((col + c, row0 + r))
            col += _MP_GW + _MP_GAP
    return text, ncols, nrows


_MP_TEXT, _MP_COLS, _MP_ROWS = _mp_grid()


class MachinePaymentScene(Scene):
    name = "machine payment"

    WIDTH_FRAC = 0.82
    HEIGHT_FRAC = 0.5
    ROW_RATIO = 1       # cell height / width
    BAR_FRAC = 0.55        # text bar height as a fraction of the cell height
    COVER_ROWS = 2         # cover-bar height in whole character rows (clean █)
    COVER_W = 2.2          # cover-bar width as a multiple of the cell (so the
                           # text never peeks past the edges of the cover)
    COVER_TIME = 2.0       # seconds for the cover wipe
    HOLD = 0.5             # held fully covered
    REVEAL_TIME = 2.0      # seconds for the reveal wipe
    GAP_TIME = 0.7         # held revealed before looping
    SOFT = 0.0001           # wipe-front softness, in progress units (a gradient edge)

    def _fronts(self):
        """(cover_front, reveal_front) — each sweeps 0->1 row by row, L->R.

        EASE is cubic-bezier(0.85, 0, 0.15, 1): a very strong slow->fast->slow,
        so each wipe eases in, whips through the middle, and eases out."""
        cycle = self.COVER_TIME + self.HOLD + self.REVEAL_TIME + self.GAP_TIME
        tt = self.t % cycle
        if tt < self.COVER_TIME:
            return EASE(tt / self.COVER_TIME), 0.0
        tt -= self.COVER_TIME
        if tt < self.HOLD:
            return 1.0, 0.0
        tt -= self.HOLD
        if tt < self.REVEAL_TIME:
            return 1.0, EASE(tt / self.REVEAL_TIME)
        return 1.0, 1.0

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        ncols, nrows = _MP_COLS, _MP_ROWS
        cw = min(self.WIDTH_FRAC * wu / ncols,
                 self.HEIGHT_FRAC * hu / (nrows * self.ROW_RATIO))
        ch = cw * self.ROW_RATIO
        x0 = (wu - ncols * cw) / 2.0
        y0 = (hu - nrows * ch) / 2.0
        bar_h = ch * self.BAR_FRAC
        cover_front, reveal_front = self._fronts()
        soft = self.SOFT

        for row in range(nrows):
            cy = y0 + (row + 0.5) * ch
            for col in range(ncols):
                cx = x0 + (col + 0.5) * cw
                # the text bar underneath (always present) — Braille, so it has
                # no half-block seam/gaps; the solid cover is the contrast.
                if (col, row) in _MP_TEXT:
                    _hbar(canvas, cx - cw / 2.0, cx + cw / 2.0, cy, bar_h)
                # the cover: a clean solid bar, snapped to whole character rows
                # (COVER_ROWS tall, no ragged half-block edges) and widened so the
                # text underneath never peeks past it.
                pos = (row + col / ncols) / nrows
                cover = (_clamp((cover_front - pos) / soft, 0.0, 1.0)
                         - _clamp((reveal_front - pos) / soft, 0.0, 1.0))
                if cover > 0.04:
                    _block_snapped(canvas, cx, cy, cw * self.COVER_W,
                                   cover * self.COVER_ROWS * 4.0)

    def status(self):
        cycle = self.COVER_TIME + self.HOLD + self.REVEAL_TIME + self.GAP_TIME
        tt = self.t % cycle
        if tt < self.COVER_TIME:
            return "COVER"
        if tt < self.COVER_TIME + self.HOLD:
            return "HOLD"
        if tt < self.COVER_TIME + self.HOLD + self.REVEAL_TIME:
            return "REVEAL"
        return "SHOW"


# ---------------------------------------------------------------------------
# Scene 13 — line ramp
# ---------------------------------------------------------------------------
#
# A dedicated character ramp for clean horizontal lines. The centred dashes
# (· – — ─ ━) only give three thicknesses before a hard jump to a solid bar, so
# the thickening half uses the lower block elements ▁..█ instead: eight evenly
# spaced steps with no gap, for a smooth thin->solid growth (bottom-anchored,
# so the line sits low and thickens upward). Placed as literal glyphs via
# canvas.set_char — crisp characters, not sub-pixel Braille.
_LINE_RAMP = _RAMP


def _line_char(level):
    """Map an intensity in [0, 1] to the short->large horizontal-line ramp."""
    return _LINE_RAMP[int(_clamp(level, 0.0, 1.0) * (len(_LINE_RAMP) - 1) + 0.5)]


class LineRampScene(Scene):
    name = "line ramp"

    N_LINES = 7
    WIDTH_FRAC = 0.78
    GAP_ROWS = 2          # blank character rows between lines
    SPEED = 1.1           # shimmer travel speed (rad / s)
    WAVES = 1.3           # gentle ripples along each line
    SHIMMER = 0.16        # how far the shimmer nudges the clean ramp
    STAGGER = 0.7         # per-line phase offset (a wave across the stack)

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        w = max(8, int(self.WIDTH_FRAC * cols))
        x0 = (cols - w) // 2
        n = self.N_LINES
        total = n + (n - 1) * self.GAP_ROWS
        y0 = max(0, (rows - total) // 2)
        t = self.t
        for li in range(n):
            ry = y0 + li * (1 + self.GAP_ROWS)
            if ry >= rows:
                break
            ph = li * self.STAGGER
            for i in range(w):
                fx = i / (w - 1)
                # a clean short->large ramp, nudged by a slow travelling shimmer
                shimmer = math.sin(self.WAVES * 2 * math.pi * fx
                                   - t * self.SPEED + ph)
                level = _clamp(fx * 1.12 - 0.06 + self.SHIMMER * shimmer,
                               0.0, 1.0)
                ch = _line_char(level)
                if ch != " ":
                    canvas.set_char(x0 + i, ry, ch)


# ---------------------------------------------------------------------------
# Scene 14 — mpp swell
# ---------------------------------------------------------------------------
#
# Exactly the wave-field scene's motion — an eased crest whipping across, the
# rows kicking off a short stutter apart — but the block cells are masked to a
# word's letterforms. The text swells up out of nothing as the crest passes over
# it and sinks back as the crest moves on: it appears and disappears through the
# swell. Subclasses set ROWS (the mask, as "#"/"." row-strings) and the tunables.
def _phrase_rows(text, font, fh, gap=1, space=3):
    """Lay `text` out as `fh` row-strings of '#'/'.', one separator column
    between letters and `space` columns for a word space — the mask a swell
    scene reads."""
    rows = ["" for _ in range(fh)]
    first = True
    for chx in text:
        if chx == " ":
            for r in range(fh):
                rows[r] += "." * space
            first = True
            continue
        glyph = font[chx]
        sep = "" if first else "." * gap
        for r in range(fh):
            rows[r] += sep + glyph[r]
        first = False
    return rows


_M2M_SWELL_ROWS = _phrase_rows("MACHINE", _M2M_FONT, _M2M_FH)


class MPPSwellScene(Scene):
    name = "mpp swell"

    ROWS = _WM_ROWS         # the masked text, as "#"/"." row-strings
    WIDTH_FRAC = 0.66
    CELL_W = 4           # char columns per font column = LETTER WIDTH. None
                            # auto-fits to WIDTH_FRAC; set an int (2, 3, ...) to
                            # force wider letters (overrides the auto-fit).
    GAP_ROWS = 1            # blank char rows between text rows (venetian)
    SWEEP_TIME = 1.9        # eased crest sweep across the text
    STUTTER = 0.06          # very short stutter between rows (keep letters whole)
    HOLD = 0             # quiet beat (text gone) before the loop
    BAND = 0.42             # crest half-width; wider -> more reads at once
    MARGIN = 0.78           # crest fully off-screen at the loop wrap
    GAIN = 1.0              # >1 saturates the crest into a wide solid plateau
                            # (a legible run of solid █, not just a sharp peak)

    def _cycle(self):
        return (len(self.ROWS) - 1) * self.STUTTER + self.SWEEP_TIME + self.HOLD

    def draw(self, canvas):
        text = self.ROWS
        cols, rows = canvas.cols, canvas.rows
        ncols = len(text[0])
        nrows = len(text)
        px = self.CELL_W or max(1, int(self.WIDTH_FRAC * cols) // ncols)
        total_w = ncols * px
        x0 = (cols - total_w) // 2
        total_h = nrows + (nrows - 1) * self.GAP_ROWS
        y0 = max(0, (rows - total_h) // 2)
        tt = self.t % self._cycle()
        span = 1.0 + 2.0 * self.MARGIN
        for r in range(nrows):
            ry = y0 + r * (1 + self.GAP_ROWS)
            if ry >= rows:
                break
            local = tt - r * self.STUTTER
            if not (0.0 <= local <= self.SWEEP_TIME):
                continue                        # text absent between sweeps
            front = -self.MARGIN + EASE(local / self.SWEEP_TIME) * span
            line = text[r]
            for cc in range(total_w):
                if line[cc // px] != "#":
                    continue                    # not part of a letter -> nothing
                fx = cc / (total_w - 1)
                d = (fx - front) / self.BAND
                ch = _down_char(self.GAIN * math.exp(-d * d))  # plateau crest
                if ch != " ":
                    canvas.set_char(x0 + cc, ry, ch)


# A longer phrase: a wider crest and a slower sweep hold the readable span on
# screen a beat longer, so more of the line is legible at once.
# Scene 15 — machine swell
class M2MSwellScene(MPPSwellScene):
    name = "machine swell"

    ROWS = _M2M_SWELL_ROWS
    WIDTH_FRAC = 0.94
    SWEEP_TIME = 4.2        # slower sweep -> the readable span lingers
    STUTTER = 0.04          # tight cascade keeps the 7-row letters coherent
    HOLD = 1.1
    BAND = 0.6              # wide crest -> a long legible run of the phrase
    MARGIN = 1.18
    GAIN = 1.7              # saturate to a wide solid plateau (legible letters)


# ---------------------------------------------------------------------------
# Scene 16 — mpp reveal
# ---------------------------------------------------------------------------
#
# Scene-6's soft eased crest sweep, full frame (the same ▁▂▃▄▅▆▇█ swell spread),
# but as the crest crosses the canonical mpp wordmark its cells lock into solid
# █ blocks — the exact look of the static wordmark (scene 3), seamless via
# reverse video. The word draws itself in cell by cell behind the crest, holds,
# and a second identical sweep erases it the same way, then loops.
class MPPRevealScene(Scene):
    name = "mpp reveal"

    ROWS = _WM_ROWS          # the canonical wordmark mask (intended, not a font)
    WORD_WIDTH_FRAC = 0.58   # the wordmark's width
    CELL_W = None            # char columns per font column (letter width)
    WAVE_WIDTH_FRAC = 0.8   # the FULL-FRAME wave's width
    N_LINES = 13             # full-frame wave lines; wordmark centred within them
    GAP_ROWS = 1             # blank char rows between lines (venetian)
    SWEEP_TIME = 1.5         # one eased crest sweep (reveal, then hide)
    STUTTER = 0.025           # per-line cascade
    HOLD = 0.1               # wordmark fully shown (Braille) between sweeps
    GAP = 0.8                # empty beat after the hide sweep
    BAND = 0.4               # crest half-width — same soft swell as scene 6
    MARGIN = 0.6             # crest off-screen at the sweep ends
    BASE = 0.0            # wave baseline: a thin line across the whole frame

    def _sweep(self):
        return (self.N_LINES - 1) * self.STUTTER + self.SWEEP_TIME

    def _cycle(self):
        return 2 * self._sweep() + self.HOLD + self.GAP

    def draw(self, canvas):
        cols, rows = canvas.cols, canvas.rows
        text = self.ROWS
        ncw, nrw = len(text[0]), len(text)
        px = self.CELL_W or max(1, int(self.WORD_WIDTH_FRAC * cols) // ncw)
        wm_w = ncw * px
        wm_x0 = (cols - wm_w) // 2
        wave_w = max(8, int(self.WAVE_WIDTH_FRAC * cols))
        wave_x0 = (cols - wave_w) // 2
        n = self.N_LINES
        total_h = n + (n - 1) * self.GAP_ROWS
        y0 = max(0, (rows - total_h) // 2)
        wm_l0 = (n - nrw) // 2                # first wave line that is a wm row
        sweep = self._sweep()
        tt = self.t % self._cycle()
        if tt < sweep:
            phase, pbase = "reveal", 0.0
        elif tt < sweep + self.HOLD:
            phase, pbase = "hold", 0.0
        elif tt < 2 * sweep + self.HOLD:
            phase, pbase = "hide", sweep + self.HOLD
        else:
            phase, pbase = "gap", 0.0
        span = 1.0 + 2.0 * self.MARGIN
        for li in range(n):
            ry = y0 + li * (1 + self.GAP_ROWS)
            if ry >= rows:
                break
            local = front = None
            if phase in ("reveal", "hide"):
                local = (tt - pbase) - li * self.STUTTER
                if 0.0 <= local <= self.SWEEP_TIME:
                    front = -self.MARGIN + EASE(local / self.SWEEP_TIME) * span
            wm_r = li - wm_l0
            wm_row = text[wm_r] if 0 <= wm_r < nrw else None
            for cc in range(wave_w):
                col = wave_x0 + cc
                if not (0 <= col < cols):
                    continue
                fx = cc / (wave_w - 1)
                # The wave: scene-6's soft swell — a thin baseline plus a gaussian
                # crest, mapped through the same block ramp (▁▂▃▄▅▆▇█ spread).
                level = self.BASE
                if front is not None:
                    d = (fx - front) / self.BAND
                    level = self.BASE + (1.0 - self.BASE) * math.exp(-d * d)
                # A wordmark cell the crest has reached locks into a solid block
                # (scene 3); until then it just rides the swell like the wave.
                if wm_row is not None and wm_x0 <= col < wm_x0 + wm_w \
                        and wm_row[(col - wm_x0) // px] == "#":
                    if phase == "hold":
                        revealed = True
                    elif phase == "gap":
                        revealed = False
                    elif phase == "reveal":
                        revealed = (local > self.SWEEP_TIME) if front is None \
                            else (fx <= front)
                    else:  # hide
                        revealed = (local <= self.SWEEP_TIME) if front is None \
                            else (fx > front)
                    if revealed:
                        # Solid block, exactly like the static wordmark (scene 3)
                        # — seamless via reverse video. The cell rides the swell
                        # until the crest reaches it, then locks to the logo.
                        canvas.set_char(col, ry, _SOLID)
                        continue
                ch = _down_char(level)
                if ch != " ":
                    canvas.set_char(col, ry, ch)


# ===========================================================================
# Reference-still 3D scenes (17-22) — rendered in this file's character set
# ===========================================================================
#
# Same forms as scenes.py, but the scanline primitives stamp this variant's
# glyphs (via _SOLID) into character cells instead of drawing sub-pixel Braille,
# so the solids read in the file's chosen character set.
# A mid-ramp glyph for the hatch fill, so dense scanlines read as texture rather
# than a solid mass; edges, staves and dots stay _SOLID for a crisp bold frame.
_HATCH = _RAMP[len(_RAMP) // 2 + 1]


def _dash(canvas, px, py, half):
    """Horizontal scanline tick stamped as the hatch glyph across its cells."""
    r = int(py // 4)
    c0 = int((px - half) // 2)
    c1 = int((px + half) // 2)
    for c in range(c0, c1 + 1):
        canvas.set_char(c, r, _HATCH)


def _stroke(canvas, x0, y0, x1, y1):
    """A straight stroke walked over character cells, each set to _SOLID."""
    c0, r0 = x0 / 2.0, y0 / 4.0
    c1, r1 = x1 / 2.0, y1 / 4.0
    n = int(max(abs(c1 - c0), abs(r1 - r0)))
    if n == 0:
        canvas.set_char(int(c0), int(r0), _SOLID)
        return
    for i in range(n + 1):
        t = i / n
        canvas.set_char(int(c0 + (c1 - c0) * t),
                        int(r0 + (r1 - r0) * t), _SOLID)


def _dot(canvas, x, y):
    """A single point stamped as one _SOLID cell."""
    canvas.set_char(int(x // 2), int(y // 4), _SOLID)


# Cube geometry shared by the hatched cube: 8 corners, 12 edges, and 6 oriented
# faces (unit normal + two in-plane axes), so faces can be hatched and culled.
_CB_VERTS = [((i >> 2 & 1) * 2 - 1, (i >> 1 & 1) * 2 - 1, (i & 1) * 2 - 1)
             for i in range(8)]
_CB_EDGES = [(i, i ^ b) for i in range(8) for b in (4, 2, 1) if not (i & b)]
_CB_FACES = (
    ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    ((0, 0, -1), (1, 0, 0), (0, 1, 0)),
    ((1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
)


# ---------------------------------------------------------------------------
# Scene 17 — hatched sphere
# ---------------------------------------------------------------------------
#
# A globe sampled on a latitude/longitude grid; every front-facing sample is one
# horizontal scanline tick, so the surface reads as dense hatching. The pole is
# leaned toward the camera, so its latitude rings stack into a concentric vortex.
# It spins on the vertical axis with a gentle nod.
class HatchSphereScene(Scene):
    name = "hatched sphere"

    N_LAT = 48            # latitude scanline bands
    LON_MAX = 150         # longitude samples at the equator
    RADIUS_FRAC = 0.42    # sphere radius as a fraction of the short axis
    SPIN_SPEED = 0.32     # yaw, radians / second
    TILT = 0.46           # pole leaned toward the camera (radians)
    TILT_WOBBLE = 0.16    # gentle nod amplitude
    TILT_RATE = 0.5
    FOCAL_FRAC = 3.0      # perspective focal distance, in radius units
    DASH = 1.7            # scanline half-length at the near plane
    EPS = 0.05            # cull the grazing limb for a crisp silhouette

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R = min(wu, hu) * self.RADIUS_FRAC
        yaw = self.t * self.SPIN_SPEED
        tilt = self.TILT + self.TILT_WOBBLE * math.sin(self.t * self.TILT_RATE)
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        ct, st = math.cos(tilt), math.sin(tilt)
        focal = self.FOCAL_FRAC * R
        for li in range(1, self.N_LAT):
            theta = math.pi * li / self.N_LAT
            sint, cost = math.sin(theta), math.cos(theta)
            nlon = max(6, int(self.LON_MAX * sint))
            for j in range(nlon):
                phi = 2.0 * math.pi * j / nlon
                ux = sint * math.cos(phi)
                uz = sint * math.sin(phi)
                uy = cost
                x1 = ux * cyaw + uz * syaw           # yaw about Y
                z1 = -ux * syaw + uz * cyaw
                y2 = uy * ct - z1 * st                # lean the pole forward
                z2 = uy * st + z1 * ct
                if z2 <= self.EPS:                    # front hemisphere only
                    continue
                f = focal / (focal - z2 * R)
                px = cx + x1 * R * f
                py = cy - y2 * R * f
                _dash(canvas, px, py, self.DASH * f * (0.45 + 0.55 * z2))


# ---------------------------------------------------------------------------
# Scene 18 — vertical strands
# ---------------------------------------------------------------------------
#
# A cylinder of vertical strands spinning on its axis: front strands are drawn,
# the back half is hidden, and the grazing silhouette bunches strands together
# so the edges read bright and the centre dark. Each strand is broken into
# downward-scrolling dashes (rain), and a few become long solid motion streaks.
class StrandCurtainScene(Scene):
    name = "vertical strands"

    N_STRANDS = 128       # strands around the cylinder
    RADIUS_FRAC = 0.40    # cylinder radius as a fraction of the short axis
    HEIGHT_FRAC = 0.84    # strand height as a fraction of hu
    SPIN_SPEED = 0.55     # radians / second
    FOCAL_FRAC = 2.4      # perspective focal distance (smaller -> stronger)
    LEAN = 0.12           # sideways skew of the falling strands
    SEGS = 13             # dashes per strand (the rain breaks)
    DUTY = 0.55           # on-fraction of each rain segment
    RAIN_SPEED = 0.5      # downward scroll, screens / second
    STREAK_EVERY = 17     # 1-in-N strands draws a long solid streak
    EPS = 0.05

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R = min(wu, hu) * self.RADIUS_FRAC
        H = hu * self.HEIGHT_FRAC
        spin = self.t * self.SPIN_SPEED
        focal = self.FOCAL_FRAC * R
        scroll = (self.t * self.RAIN_SPEED) % 1.0
        streak_shift = int(self.t * 7.0)
        for i in range(self.N_STRANDS):
            phi = 2.0 * math.pi * i / self.N_STRANDS + spin
            z = math.cos(phi)                         # +1 = toward the camera
            if z <= self.EPS:
                continue                              # back half hidden
            f = focal / (focal - z * R)
            px = cx + math.sin(phi) * R * f
            h = H * 0.5 * f
            top, bot = cy - h, cy + h
            if (i + streak_shift) % self.STREAK_EVERY == 0:
                _stroke(canvas, px + self.LEAN * h, top - h * 0.3,  # long streak
                        px - self.LEAN * h, bot + h * 0.3)
                continue
            span = bot - top
            seg_h = span / self.SEGS
            for s in range(self.SEGS):
                fr = ((s / self.SEGS) + scroll + i * 0.013) % 1.0
                yy = top + fr * span
                yb = yy + seg_h * self.DUTY
                _stroke(canvas, px + self.LEAN * (yy - cy), yy,  # leaning rain
                        px + self.LEAN * (yb - cy), yb)


# ---------------------------------------------------------------------------
# Scene 19 — hatched cube
# ---------------------------------------------------------------------------
#
# A wireframe cube tumbling on two axes: its 12 edges draw the strong
# perspective frame, and every camera-facing face is flooded with horizontal
# scanline dashes so the solid reads hatched, corner-on.
class HatchCubeScene(Scene):
    name = "hatched cube"

    SIZE_FRAC = 0.34      # cube half-extent as a fraction of the short axis
    YAW_SPEED = 0.33
    PITCH_SPEED = 0.21
    PERSP = 3.6           # camera distance in cube-radius units
    HATCH = 14            # scanline rows per face
    SAMP = 26             # dash samples along each row
    DASH = 1.3

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        r = min(wu, hu) * self.SIZE_FRAC
        cam = self.PERSP * r
        yaw = self.t * self.YAW_SPEED
        pit = self.t * self.PITCH_SPEED
        cyaw, syaw = math.cos(yaw), math.sin(yaw)
        cpit, spit = math.cos(pit), math.sin(pit)

        def rot(x, y, z):
            x1 = x * cyaw + z * syaw
            z1 = -x * syaw + z * cyaw
            y2 = y * cpit - z1 * spit
            z2 = y * spit + z1 * cpit
            return x1, y2, z2

        def proj(x, y, z):
            x1, y2, z2 = rot(x, y, z)
            f = cam / (cam - z2 * r)
            return cx + x1 * r * f, cy - y2 * r * f

        pe = [proj(*v) for v in _CB_VERTS]            # the edge frame
        for a, b in _CB_EDGES:
            _stroke(canvas, pe[a][0], pe[a][1], pe[b][0], pe[b][1])

        for nrm, ua, va in _CB_FACES:                 # hatch front faces
            if rot(*nrm)[2] <= 0.02:
                continue
            for hrow in range(self.HATCH):
                v = -1.0 + 2.0 * hrow / (self.HATCH - 1)
                for s in range(self.SAMP):
                    u = -1.0 + 2.0 * s / (self.SAMP - 1)
                    x = nrm[0] + ua[0] * u + va[0] * v
                    y = nrm[1] + ua[1] * u + va[1] * v
                    z = nrm[2] + ua[2] * u + va[2] * v
                    x1, y2, z2 = rot(x, y, z)
                    f = cam / (cam - z2 * r)
                    _dash(canvas, cx + x1 * r * f, cy - y2 * r * f, self.DASH * f)


# ---------------------------------------------------------------------------
# Scene 20 — hatched cylinder
# ---------------------------------------------------------------------------
#
# A tapered bucket: horizontal rings stacked up the body give the scanline
# hatching, a few vertical staves rib the front, and a soft highlight band
# slides up and down so the surface shimmers as it spins.
class HatchCylinderScene(Scene):
    name = "hatched cylinder"

    N_RINGS = 44          # horizontal scanline rings up the body
    LON = 132             # samples around each ring
    RADIUS_FRAC = 0.32    # top radius as a fraction of the short axis
    TAPER = 0.66          # bottom radius / top radius (the bucket taper)
    HEIGHT_FRAC = 0.80
    SPIN_SPEED = 0.5
    FOCAL_FRAC = 3.2
    TILT = 0.13           # slight forward tilt so the rings read as ellipses
    DASH = 1.3
    STAVES = 18           # vertical staves down the front
    BAND_AMP = 0.32       # highlight-band dash lengthening (subtle shimmer)
    BAND_W = 0.16         # band half-width as a fraction of hu
    BAND_RATE = 0.7       # band slide rate
    EPS = 0.04

    def _radius(self, fr, R):
        return R * (1.0 + (self.TAPER - 1.0) * fr)

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R = min(wu, hu) * self.RADIUS_FRAC
        Ht = hu * self.HEIGHT_FRAC
        spin = self.t * self.SPIN_SPEED
        focal = self.FOCAL_FRAC * R
        ct, st = math.cos(self.TILT), math.sin(self.TILT)
        band_y = cy + math.sin(self.t * self.BAND_RATE) * 0.5 * Ht
        band_w = self.BAND_W * hu

        def project(rad, yy, phi):
            x = rad * math.cos(phi)
            z = rad * math.sin(phi)
            y2 = yy * ct - z * st
            z2 = yy * st + z * ct
            f = focal / (focal - z2)
            return cx + x * f, cy - y2 * f, f

        for k in range(self.N_RINGS + 1):             # horizontal rings
            fr = k / self.N_RINGS
            rad = self._radius(fr, R)
            yy = (0.5 - fr) * Ht
            for j in range(self.LON):
                phi = 2.0 * math.pi * j / self.LON + spin
                if math.sin(phi) <= self.EPS:         # front arc only
                    continue
                px, py, f = project(rad, yy, phi)
                glow = 1.0 + self.BAND_AMP * math.exp(
                    -((py - band_y) / band_w) ** 2)
                _dash(canvas, px, py, self.DASH * f * glow)

        for sidx in range(self.STAVES):               # vertical staves
            phi0 = 2.0 * math.pi * sidx / self.STAVES + spin
            if math.sin(phi0) <= self.EPS:
                continue
            prev = None
            for k in range(self.N_RINGS + 1):
                fr = k / self.N_RINGS
                px, py, f = project(self._radius(fr, R), (0.5 - fr) * Ht, phi0)
                if prev is not None:
                    _stroke(canvas, prev[0], prev[1], px, py)
                prev = (px, py)


# ---------------------------------------------------------------------------
# Scene 21 — scanline field
# ---------------------------------------------------------------------------
#
# A full-frame ocean of horizontal dashes whose presence and length follow
# drifting fractal noise (flowing sideways, churning vertically). A ripple
# expands in concentric rings from a source near the bottom, modulating the
# field so a target pulses through the streaks.
class ScanFieldScene(Scene):
    name = "scanline field"

    ROW_STEP = 2          # braille rows between scanlines
    STEP_X = 2            # x advance when a cell is empty
    GAP_X = 2             # gap after a drawn dash
    NSCALE = 0.045        # noise features per braille unit (fine -> streaky)
    FLOW = 30.0           # horizontal drift, braille units / second
    BOIL = 8.0            # vertical churn, braille units / second
    THR = 0.44            # noise threshold to draw a dash (low -> dense)
    DASH_MIN = 2.0
    DASH_GAIN = 13.0      # dash half-length growth above threshold
    SRC_X = 0.5           # ripple source x (fraction of wu)
    SRC_Y = 0.84          # ripple source y (fraction of hu)
    RIP_K = 0.13          # ripple spatial frequency
    RIP_SPEED = 3.0       # ripple expansion rate
    RIP_FALL = 0.013      # ripple radial falloff
    RIP_AMP = 0.30

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        t = self.t
        sxs, sys = self.SRC_X * wu, self.SRC_Y * hu
        flow = t * self.NSCALE * self.FLOW
        boil = t * self.NSCALE * self.BOIL
        y = 2.0
        while y < hu:
            ny = y * self.NSCALE + boil
            x = 0.0
            while x < wu:
                val = _fbm(x * self.NSCALE - flow, ny)
                d = math.hypot(x - sxs, y - sys)
                rip = (math.sin(d * self.RIP_K - t * self.RIP_SPEED)
                       * math.exp(-d * self.RIP_FALL))
                v = val + self.RIP_AMP * rip
                if v > self.THR:
                    half = self.DASH_MIN + (v - self.THR) * self.DASH_GAIN
                    _dash(canvas, x, y, half)
                    x += 2.0 * half + self.GAP_X
                else:
                    x += self.STEP_X
            y += self.ROW_STEP


# ---------------------------------------------------------------------------
# Scene 22 — dot sphere
# ---------------------------------------------------------------------------
#
# A phyllotaxis dome: points placed by the golden angle (Vogel's sunflower)
# wrapped onto a hemisphere with its pole facing the camera. The spiral arms
# wind out of a dense magnified centre into concentric rings that thin toward
# the rim; the field turns like a pinwheel, nods slowly, and breathes.
class DotSphereScene(Scene):
    name = "dot sphere"

    N = 1500              # phyllotaxis points on the dome
    RADIUS_FRAC = 0.48
    THETA_MAX = 1.7       # polar angle at the rim (radians; >pi/2 = past equator)
    SPIN_SPEED = 0.3      # pinwheel rotation about the polar axis
    TILT = 0.16           # nod amplitude so it reads as a 3D dome
    TILT_RATE = 0.4
    FOCAL_FRAC = 2.2      # perspective (smaller -> centre magnified more)
    PULSE_AMP = 0.03      # radius breathing
    PULSE_RATE = 0.9

    def draw(self, canvas):
        wu, hu = canvas.wu, canvas.hu
        cx, cy = wu / 2.0, hu / 2.0
        R = (min(wu, hu) * self.RADIUS_FRAC
             * (1.0 + self.PULSE_AMP * math.sin(self.t * self.PULSE_RATE)))
        spin = self.t * self.SPIN_SPEED
        tilt = self.TILT * math.sin(self.t * self.TILT_RATE)
        ct, st = math.cos(tilt), math.sin(tilt)
        focal = self.FOCAL_FRAC * R
        for k in range(self.N):
            rho = math.sqrt((k + 0.5) / self.N)       # 0 at pole -> 1 at rim
            theta = self.THETA_MAX * rho
            ang = k * _GOLDEN_ANGLE + spin            # sunflower arm + spin
            sint = math.sin(theta)
            ux = sint * math.cos(ang)
            uy = sint * math.sin(ang)
            uz = math.cos(theta)                      # +1 at the camera-facing pole
            y2 = uy * ct - uz * st                    # nod about X
            z2 = uy * st + uz * ct
            f = focal / (focal - z2 * R)
            _dot(canvas, cx + ux * R * f, cy - y2 * R * f)


# ---------------------------------------------------------------------------
# Registry — appended to mpp's built-in scenes, in display order. The number in
# each comment is the scene number you see running `python scenes.py` (+15 when
# run via `python mpp.py`). Same order as the SCENE INDEX in the module docstring.
# ---------------------------------------------------------------------------
def make_scenes():
    return [
        MachineScene(),               #  1
        MachineStretchScene(),        #  2
        WordmarkScene(),              #  3
        WordmarkRelayBlocksScene(),   #  4
        MachineStretchVScene(),       #  5
        FieldWaveScene(),             #  6
        MPPWaveScene(),               #  7
        MPPWaveVScene(),              #  8
        TravellingWaveStretchScene(), #  9
        SpiralStretchScene(),         # 10
        SphereWaveScene(),            # 11
        MachinePaymentScene(),        # 12
        LineRampScene(),              # 13
        MPPSwellScene(),              # 14
        M2MSwellScene(),              # 15
        MPPRevealScene(),             # 16
        HatchSphereScene(),           # 17
        StrandCurtainScene(),         # 18
        HatchCubeScene(),             # 19
        HatchCylinderScene(),         # 20
        ScanFieldScene(),             # 21
        DotSphereScene(),             # 22
    ]


if __name__ == "__main__":
    # Run the explorer showing only these scenes. Reuses mpp's runner, so all
    # the usual flags work (--no-motion, --banner, --export, --scene, ...).
    import mpp

    mpp.main(make_scenes())
