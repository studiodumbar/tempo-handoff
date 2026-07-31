#!/usr/bin/env python3
"""
scene14_tempo — play scene 14 (the line-ramp), then reveal the tempo CLI.

A short showpiece: the LineRampScene shimmer animates for a few seconds (press
`q` to skip), the screen clears, and the tempo command-line menu types itself in
one line at a time. The CLI is decorative only — nothing is selectable; it just
renders the captured menu, line by line, with the original colouring.

Run:  python scene14_tempo.py [scene_seconds]
Keys: q / Ctrl-C — skip the scene, or quit once the menu is shown. Any other key
      during the reveal shows the rest of the menu instantly.

Imports the renderer from mpp (Canvas + the live-paint helpers) and the scene
from scenes; it never modifies either module.
"""

import signal
import sys
import time

from blessed import Terminal

from mpp import Canvas, SIM_DT, FRAME_DT, _paint
from scenes import LineRampScene

# -- timing -----------------------------------------------------------------
SCENE_SECONDS = 6.0       # how long the line-ramp shimmer plays before the CLI
LINE_DELAY = 0.24         # pause between menu lines as they reveal
MARGIN_X = 3              # left inset of the menu (matches the screenshot)
MARGIN_Y = 2              # top inset of the menu

# -- palette (256-colour SGR; balanced with RESET per segment) --------------
RESET = "\033[0m"
GREY = "\033[38;5;245m"   # header + footer (medium grey)
DIM = "\033[38;5;240m"    # the (Tempo)/(Stripe) provider tags
GREEN = "\033[38;5;77m"   # the shell prompt + command
WHITE = "\033[1;38;5;253m"  # the question (bold, bright)
OPT = "\033[38;5;252m"    # unselected option text
PINK = "\033[38;5;211m"   # the selected option + its arrow

# The captured menu, as lines of (text, sgr) segments. An empty list is a blank
# spacer row (advances a line, no reveal delay). Plain text is the concatenation
# of the segment texts, so the off-TTY path drops the colour cleanly.
MENU = [
    [("mpp.dev@4eeccb7 (released 7h ago)", GREY)],
    [],
    [("$ ", GREEN), ("./mpp.sh", GREEN)],
    [],
    [("What would you like to do?", WHITE)],
    [],
    [("▶ Chat with OpenAI", PINK), (" (Tempo)", DIM)],
    [("Summarize an article using Parallel", OPT), (" (Stripe)", DIM)],
    [("Generate an image using fal.ai", OPT), (" (Tempo)", DIM)],
    [("Search the web using Parallel", OPT), (" (Tempo)", DIM)],
    [],
    [("Use ↑↓ or ⇥ to select, and ⏎ to confirm.", GREY)],
]


def _coloured(segs):
    return "".join(sgr + text + RESET for text, sgr in segs)


def _plain(segs):
    return "".join(text for text, _ in segs)


def _play_scene(term, scene, seconds, stop):
    """Animate `scene` for `seconds` (or until `q`), live-diffed to the screen.

    Mirrors mpp's interactive loop: a fixed SIM_DT sim step, FRAME_DT pacing,
    and `_paint` writing only the changed runs."""
    scene.reset()
    canvas = None
    prev_grid = None
    prev_dims = None
    force = True
    start = time.monotonic()
    last = start
    acc = 0.0
    while not stop["flag"] and time.monotonic() - start < seconds:
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
        key = term.inkey(timeout=FRAME_DT)
        if key and str(key).lower() == "q":
            break


def _reveal_menu(term, stop):
    """Clear the scene, then reveal the menu one content line at a time.

    A blank spacer row advances without a delay; any keypress during the reveal
    drops the remaining delays (shows the rest at once); `q` quits."""
    sys.stdout.write(term.home + term.clear)
    sys.stdout.flush()
    instant = False
    row = MARGIN_Y
    for segs in MENU:
        if segs:
            sys.stdout.write(term.move_xy(MARGIN_X, row) + _coloured(segs))
            sys.stdout.flush()
            if not instant:
                key = term.inkey(timeout=LINE_DELAY)
                if key:
                    if str(key).lower() == "q":
                        stop["flag"] = True
                        return
                    instant = True       # skip the rest of the pauses
        row += 1
    # Hold the finished menu until a key (or Ctrl-C) dismisses it.
    while not stop["flag"]:
        key = term.inkey(timeout=FRAME_DT)
        if key:
            break


def _run_plain():
    """No TTY: print one settled scene frame, then the menu as plain text."""
    scene = LineRampScene()
    scene.reset()
    scene.update(1.0)
    canvas = Canvas(80, 24)
    scene.draw(canvas)
    sys.stdout.write("\n".join("".join(r) for r in canvas.compose()) + "\n\n")
    for segs in MENU:
        sys.stdout.write(_plain(segs) + "\n")


def main():
    seconds = SCENE_SECONDS
    if len(sys.argv) > 1:
        try:
            seconds = float(sys.argv[1])
        except ValueError:
            sys.stderr.write("usage: python scene14_tempo.py [scene_seconds]\n")
            sys.exit(2)

    term = Terminal()
    if not sys.stdout.isatty():
        _run_plain()
        return

    stop = {"flag": False}

    def _on_sigint(_signum, _frame):
        stop["flag"] = True

    prev_sigint = signal.signal(signal.SIGINT, _on_sigint)
    try:
        with term.fullscreen(), term.hidden_cursor(), term.cbreak():
            _play_scene(term, LineRampScene(), seconds, stop)
            if not stop["flag"]:
                _reveal_menu(term, stop)
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGINT, prev_sigint)


if __name__ == "__main__":
    main()
