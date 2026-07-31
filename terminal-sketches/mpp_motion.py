#!/usr/bin/env python3
"""
mpp_motion — MACHINE wave-text scenes (extracted from sketches_block.py).

A brightness wave sweeps a matrix-font phrase built from single braille dots,
filling each cell up to a full braille block (⣿) and, at the very crest, popping
to a solid white block (█) for a brighter ramp peak. See `_ramp_glyph`.

Five sketches. The first is the block-rendered wordmark relay; the rest ride the
shared horizontal-line wash engine:

   4  WordmarkRelayBlocksScene — the mpp wordmark with the springy block relay
   1  MachineScene             — OPEN-SOURCE (horizontal-line wash, bright braille crest)
  1b  MachineWaveScene         — MACHINE/PAYMENT/PROTOCOL cycled per line, wave-only
  1c  MachineListScene         — MACHINE / TO MACHINE / PAYMENTS, left-aligned
  2b  MachineWaveBrailleScene  — scene 1b but braille only (ramp caps at ⣿, no blocks)

Run standalone: `python mpp_motion.py`.
"""

import math

from mpp import Scene, _clamp, _cubic_bezier


def _quad_in_out(x):
    """Quadratic ease-in-out (the 'quadInOut' option in the Shape Type Studio
    tool): slow at both ends, quick through the middle. Plain quadratic, not the
    bezier above, so the wave matches the tool exactly."""
    return 2.0 * x * x if x < 0.5 else 1.0 - ((-2.0 * x + 2.0) ** 2) / 2.0


# A very strong ease-in-out shared by every wave sketch: it holds hard at the
# dim and bright ends and snaps through the middle, so the wave reads as a crisp,
# punchy sweep rather than a soft sinusoid.
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


def _m2m_cells(text, gap=_M2M_GAP, space=_M2M_SPACE, xw=1):
    """Lit (col, row) cells for `text` plus its width, in terminal cells — for the
    1-cell-per-character grid. `xw` widens each glyph column to `xw` cells (gaps
    and word spaces scale to match), so each character gets wider."""
    cells = []
    col = 0
    for ch in text:
        if ch == " ":
            col += space * xw
            continue
        glyph = _M2M_FONT[ch]
        for r in range(_M2M_FH):
            line = glyph[r]
            for c in range(_M2M_FW):
                if line[c] == "#":
                    base = col + c * xw
                    for k in range(xw):
                        cells.append((base + k, r))
        col += (_M2M_FW + gap) * xw
    width = max(col - gap * xw, 1)
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
    # One font cell == one terminal character cell (fixed 1:1 grid). Each glyph
    # pixel rests as a single braille dot and the wave fills it up to a full block.
    TEXT = "MACHINE"  # the phrase (used when WORDS is None)
    WORDS = None          # tuple of words cycled per stacked line; None -> TEXT
    ALIGN = "center"      # "center" each line, or "left" (share a left edge)
    CELL_W = 2            # terminal cells per glyph column (bigger = wider characters)
    LETTER_SPACING = 1    # blank glyph-columns between letters (scaled by CELL_W)
    N_ROWS = 1            # stacked copies of the phrase
    ROW_GAP = 1           # blank rows between stacked phrases
    WAVE_TIME = 3.5       # seconds for the brightness wave to travel one loop
    WAVES = 1             # bright crests spanning the phrase at once
    SHARP = 4.0           # crest sharpness (higher -> tighter, more single-dot rest)
    LINE_STAGGER = 0.1    # wave phase offset per stacked line (radians) — the wave
    #                       cascades down the lines instead of hitting them together
    WAVE_WOBBLE = 0.0    # warps the wavefront so the highlight's width fluctuates
    #                       (more wave-like / less linear); 0 = constant-speed sweep
    BLANK_A = 0.0         # below this wave value a cell is blank (nothing drawn).
    #                       0 keeps the whole resting phrase as single dots; raise it
    #                       to hide the dim bulk and let only the wave show.
    CREST_BLOCK = True    # crest pops past full braille to a solid white block █.
    #                       Set False for a braille-only ramp (caps at ⣿).

    def _cycle(self):
        return self.WAVE_TIME

    def _layouts(self):
        """Per-line (cells, width) in terminal cells, at the current LETTER_SPACING
        and CELL_W. With WORDS set, each stacked line cycles through the words;
        otherwise every line is TEXT. Cached until words/spacing/width change."""
        words = tuple(self.WORDS) if self.WORDS else (self.TEXT,)
        key = (words, self.LETTER_SPACING, self.CELL_W)
        if getattr(self, "_layouts_key", None) != key:
            self._layouts_data = [_m2m_cells(w, self.LETTER_SPACING, xw=self.CELL_W)
                                  for w in words]
            self._layouts_key = key
        return self._layouts_data

    def draw(self, canvas):
        # One font cell == one terminal character cell (a fixed 1:1 grid). At rest
        # each glyph pixel is a single braille dot; a brightness wave sweeps the
        # phrase and fills each cell up to a full braille block as it passes.
        cols, rows = canvas.cols, canvas.rows
        layouts = self._layouts()
        maxw = max(w for _, w in layouts)                  # widest line (char cols)
        block_rows = self.N_ROWS * _M2M_FH + (self.N_ROWS - 1) * self.ROW_GAP
        region_left = (cols - maxw) // 2                   # centred block, char cols
        top = (rows - block_rows) // 2
        wave_t = (self.t / self.WAVE_TIME) * 2.0 * math.pi
        k = self.WAVES * 2.0 * math.pi

        for ri in range(self.N_ROWS):
            cells, w = layouts[ri % len(layouts)]          # cycle the words
            x0 = region_left if self.ALIGN == "left" else (cols - w) // 2
            row_top = top + ri * (_M2M_FH + self.ROW_GAP)
            for fc, fr in cells:
                ccol = x0 + fc
                crow = row_top + fr
                if not (0 <= ccol < cols and 0 <= crow < rows):
                    continue
                # Normalise by the whole shared region (not the per-line width), so
                # one wavefront sweeps the entire sketch cohesively: a short word's
                # wave passes quickly, a long word's takes longer.
                fx = (ccol + 0.5 - region_left) / maxw
                a = _wave_a(fx, k, wave_t, self.SHARP, self.WAVE_WOBBLE,
                            ri * self.LINE_STAGGER)
                if a < self.BLANK_A:
                    continue                       # below the threshold: blank
                # Rest -> single dot; crest -> full braille (or a solid white
                # block past full braille when CREST_BLOCK is on). `a` already eased.
                n = int(a * 9.0 + 0.5)
                if not self.CREST_BLOCK:
                    n = min(n, 8)             # braille only: cap at full braille ⣿
                canvas.set_char(ccol, crow, _ramp_glyph(n))

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
    LINE_STAGGER = 1.5    # strong offset per line -> the wave cascades down the
    #                       stack, lighting the lines in sequence
    BLANK_A = 0.10        # hide the dim bulk; only the wave (+ its dot->block ramp) show
    WAVE_WOBBLE = 0


# ---------------------------------------------------------------------------
# Scene 1c — MACHINE / TO MACHINE / PAYMENTS, left-aligned
# ---------------------------------------------------------------------------
#
# Same wave engine, but the phrases each get their own line, left-aligned (they
# share a left edge instead of centring). The resting single-dot stipple stays
# visible (so the left set reads), with the wave washing down the stack.
class MachineListScene(MachineScene):
    name = "open protocol"

    WORDS = ("MACHINE", "TO MACHINE", "PAYMENTS")
    N_ROWS = 3           # one line per phrase (no repeat)
    ALIGN = "left"        # share a left edge instead of centring each line
    LINE_STAGGER = 0    # gentle cascade of the wave down the lines
    WAVE_WOBBLE = 0


# ---------------------------------------------------------------------------
# Scene 2b — MACHINE wave, braille only (no solid blocks)
# ---------------------------------------------------------------------------
#
# A version of the second scene (MachineWaveScene): same MACHINE / PAYMENT /
# PROTOCOL cascade on the same wash engine, but CREST_BLOCK is off so the ramp
# tops out at full braille (⣿) instead of popping to a solid white block. Every
# cell is braille, from a single resting dot up to a dense crest.
class MachineWaveBrailleScene(MachineWaveScene):
    name = "machine braille"

    CREST_BLOCK = False   # braille-only ramp; never reaches the solid block


def _block_snapped(canvas, cx, cy, w, h):
    """A solid block whose height snaps to a whole number of character rows and
    whose top lands on a character-row boundary, so it renders as clean full-cell
    █ (no ▀▄ partial-cell edges) — seamless via reverse video, like the static
    wordmark. Use this instead of rect_fill wherever a solid block must read as
    the wordmark, even while it scales/moves."""
    bh = max(4, int(round(h / 4.0)) * 4)             # whole char rows, >= 1
    top = round((cy - bh / 2.0) / 4.0) * 4           # top on a char boundary
    canvas.rect_fill(cx, top + bh / 2.0, w, bh)


# ---------------------------------------------------------------------------
# Shared mpp wordmark geometry (used by the relay)
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


# ---------------------------------------------------------------------------
# Registry — appended to mpp's built-in scenes, in display order.
# ---------------------------------------------------------------------------
def make_scenes():
    return [
        WordmarkRelayBlocksScene(),   # 4  — mpp wordmark relay (block baton)
        MachineScene(),               # 1  — open-source wash
        MachineWaveScene(),           # 1b — MACHINE/PAYMENT/PROTOCOL cycled, wave-only
        MachineListScene(),           # 1c — MACHINE/TO MACHINE/PAYMENTS, left-aligned
        MachineWaveBrailleScene(),    # 2b — scene 1b, braille only (no solid blocks)
    ]


if __name__ == "__main__":
    # Run the explorer showing only these scenes. Reuses mpp's runner, so all
    # the usual flags work (--no-motion, --banner, --export, --scene, ...).
    import mpp

    mpp.main(make_scenes())
