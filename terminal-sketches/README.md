# mpp-terminal

Animated, monochrome terminal scenes built from a single primitive: the square.
Squares scale, connect with lines, and invert to solid white. No colour, no other
shape.

## Run

```sh
pip install blessed && python mpp.py
```

(If stdout is piped or redirected, it prints one static frame and exits instead of
emitting control codes: `python mpp.py > frame.txt`.)

## Modes & flags

With no arguments you get the interactive explorer above. Other modes wrap the **same
renderer** for accessibility and for handing the identity off to another team. The mark
is a graphic made of characters, not text — see the rules below — so these modes exist
so it never relies on the glyphs to carry meaning.

| invocation | what it does |
|------------|--------------|
| `python3 mpp.py` | interactive explorer (default) |
| `--screen-reader` | prints a plain-text alternative (`mpp` + a one-line description) and exits — no alternate screen, no cursor control, no decorative glyphs, no animation |
| `--no-motion` | renders a single settled static frame of the scene and exits (no loop) |
| `--banner [scene]` | plays a scene for ≤ `BANNER_MAX_SECONDS` (3.0s), then restores the terminal and hands off to the prompt |
| `--export <scene> --out <dir> [--frames N] [--fps F] [--png]` | writes plain-text frames + `manifest.json` (the handoff format) |
| `--play <dir>` | replays an exported frame directory from its manifest (proves the export round-trips) |

`--scene <id>` selects the scene for the screen-reader / no-motion / banner modes by
number (`1`–`29`) or name substring; it defaults to a wordmark scene.

Environment overrides (so the modes work without changing how a host invokes the tool):

- `MPP_SCREEN_READER=1`, or `TERM=dumb`, imply `--screen-reader`.
- `MPP_REDUCED_MOTION=1` implies `--no-motion`.
- `MPP_BANNER_SEEN=1` makes `--banner` show a single static frame instead of animating
  (models "animate on first run only").

Accessibility flags take precedence: `--banner --no-motion` renders a static frame;
`--screen-reader` always wins and emits only text.

### Export & handoff format

The exports are the **intended, language-agnostic handoff artifact** (the real downstream
app is Rust/Ratatui). Each `frame_NNN.txt` is exactly the glyph grid — no colour, no
control codes — and `manifest.json` carries the per-frame shape the consumer replays:

```json
{
  "scene_id": 6, "scene_name": "wordmark typewriter", "fps": 30,
  "cols": 96, "rows": 28, "mark_alt": "mpp",
  "description": "the mpp mark typed in left to right",
  "frames": [ {"file": "frame_000.txt", "duration_ms": 33}, ... ]
}
```

Replay (round-trip) with the bundled player, which reconstructs the animation from the
frames + durations:

```sh
python3 mpp.py --export "wordmark typewriter" --out frames/
python3 mpp.py --play frames/        # plays it back from the files
```

`--png` additionally emits per-frame PNGs and a contact-sheet strip for slides **if
Pillow is installed** (still monochrome — white glyphs on black); it is never a hard
dependency and skips with a friendly message otherwise.

## Live log viewer

`mpp.py` writes a timestamped event log while it runs. Open a **second terminal** and
follow it:

```sh
python3 logview.py
```

You'll see a live stream of what the animation is doing — session start, scene
switches, pause / restart / resize, the grid scene's phase transitions, and a ~1s
heartbeat carrying the measured frame rate. Example:

```
11:51:22.413  +    0.5s  SCENE   5 grid reveal
11:51:23.418  +    1.5s  PHASE   grid reveal: REVEAL
11:51:23.954  +    2.0s  STATUS  scene=grid reveal fps=29.8 phase=REVEAL
11:51:24.917  +    3.0s  PAUSE   on
```

Both programs use the same log file: `$MPP_LOG` if set, otherwise `mpp.log` next to
the scripts. To use a custom path, set it for both: `MPP_LOG=/tmp/mpp.log python3 mpp.py`
and `MPP_LOG=/tmp/mpp.log python3 logview.py` (or just pass the path: `python3 logview.py /tmp/mpp.log`).
The viewer streams to stdout (no alternate screen), so your normal scrollback keeps the
full history. Ctrl-C quits it.

## Keys

| key       | action                |
|-----------|-----------------------|
| `1`…`9`   | jump to scene 1–9     |
| `[` / `]` | previous / next scene (cycles through all) |
| `space`   | pause / resume        |
| `r`       | restart current scene |
| `q` / `Ctrl-C` | quit (restores the terminal cleanly) |

## Scenes

Most scenes feature the `mpp` wordmark — either as the whole subject, or as a centred
mark that periodically animates in (pop / wipe), holds, animates out, and leaves a gap
before repeating, so the underlying motion also gets to breathe.

1. **Field & connections** — a 3D point cloud of square nodes joined by a branching
   graph, slowly rotating (yaw + a pitch wobble) under perspective so nearer nodes are
   larger; lines draw in and a few nodes shimmer. The wordmark pops in at the centre.
2. **Travelling wave** — a 16×8 grid; a soft gaussian wavefront sweeps left→right,
   scaling squares up and inverting them to solid (rotating toward a diamond at the
   peak), then shrinking them back.
3. **Pseudo-3D spiral** — a 3D helix rotating about a vertical axis, projected with
   simple perspective; nearer points are larger and invert to solid, connected as a
   continuous receding ribbon, with the wordmark popping in at the eye of the spiral.
4. **Wordmark galaxy** — the `mpp` wordmark sits centred and still while a slow spiral
   of small hollow squares orbits it, each dragging a curved trailing line.
5. **Grid reveal** — a grid of squares loops: plain grid → a scan bar sweeps left→right
   revealing the `mpp` wordmark → a scan bar sweeps right→left wiping it away.
6. **Wordmark typewriter** — the `mpp` dots pop in one at a time, left to right, hold,
   then shrink back out.
7. **Wordmark 3D spin** — the flat wordmark turns in space (yaw + pitch wobble) under
   perspective, like a spinning card.
8. **Wordmark assemble** — squares scattered across the frame fly in and lock into the
   wordmark, hold, then scatter back out.
9. **Wordmark zoom** — the wordmark rushes in from a far point, settles, then bursts
   through the camera with a slight twist.
10. **Rotating cube** — a wireframe cube (the square, extruded) tumbling on two axes,
    with solid near-vertices for depth; the wordmark pops in at the centre as it turns.
11. **Starfield** — squares stream out of a vanishing point, growing and dragging
    streaks, the nearest inverting to solid; the wordmark zooms in at the vanishing point.
12. **Noise field** — a grid driven by drifting fractal noise; activity originates at
    the left edge and washes rightward as a soft crest sweeps across, blooming squares
    to solid where it passes; the wordmark wipes in on the same wash.
13. **Orbiting rings** — concentric rings of squares tilted into ellipses (3D discs),
    counter-rotating around a clear centre where the wordmark pops in as the hub.
14. **Spiral bloom** — a seamless loop built on phyllotaxis (the sunflower / golden-angle
    pattern): nodes emit one-by-one from a single centre seed, each taking the golden
    angle and drifting outward with a √age radius so the live field packs into a
    sunflower with Fibonacci spiral arms. It grows from the seed, fills, the centre
    empties into negative space, and the wordmark wipes in left→right as the last seeds
    trail off — then it rejoins the single seed with no seam.
15. **Wordmark relay** — a punchy typographic loop with springy (overshoot) easing: the
    wordmark animates in left→right, the letters fan apart from the centre, then a short
    train of nodes travels (eased) from the middle p to the end p and the baton continues
    from the end p across to the m, the nodes animate out, and the letters spring back to
    the tight lockup.
16. **Machine payment protocol** — the phrase `MACHINE PAYMENT PROTOCOL` built entirely from
    horizontal lines (a 5×7 matrix font where every lit row is a bar, so vertical
    strokes read as stacked dashes), stacked on three rows. A bright crest washes
    left→right over and over at a steady, gentle cadence, thickening bars from a thin
    Braille line to a solid white invert as it passes; the reveal frontier eases
    smoothly outward so the phrase fills in left-to-right and the wash reaches a little
    further each pass — one continuous flow, not discrete stages. It fills, holds,
    dissolves, and loops. The only scene with no `mpp` mark — the phrase is the subject.
17. **Machine payment protocol (stretch wave)** — a faithful port of the "Shape Type Studio"
    tool the original effect was designed in. The phrase is always fully present in a
    standard 5×7 font (three stacked rows); a continuous sine wave travels left→right,
    and every lit cell is its own square that, in phase, stretches horizontally — so a
    run of near-crest cells merges into a continuous line — and grows in thickness,
    collapsing to a near-invisible dot at a trough. About two bright bands sweep across
    forever on a seamless ~6.5s loop. Where scene 16 is a stylized build/hold/wipe, this
    is the tool's actual algorithm.
18. **mpp wordmark** — a static 1:1 reproduction of the wordmark: a grid of wide, short
    cells where each filled cell is a solid white rectangle spanning the full cell width
    (so horizontal neighbours merge into seamless bars) but shorter than the row pitch
    (so vertical neighbours stay separated blocks). Crisp solid half-block fills, no
    Braille; its own glyph design (the p's bars are wider than the m).
19. **mpp wordmark relay** — scene 15's springy relay choreography driving the block
    wordmark from scene 18: the mark wipes in left→right (per-glyph staggered scale-pop),
    the letters fan apart from the centre with overshoot, a short train of nodes relays
    from the middle p to the end p and the baton continues from the end p across to the m,
    the nodes animate out, and the letters spring back to the tight lockup.
20. **Machine payment protocol (stretch wave, vertical)** — the Shape Type Studio tool's
    vertical wave mode, the companion to scene 17: the sine is driven by each cell's
    vertical position across the whole block (so the wave travels top→bottom through all
    three lines as one motion) and the stretch is applied to the Y axis — cells stretch
    *tall*, a run of near-crest cells merges into a continuous vertical bar (crisp solid
    white at the crest), collapsing to a dot at a trough.
21. **Wave lines** — the stretch-wave engine on a plain stack of horizontal lines: the
    wave runs down the stack so each line materialises into a solid bar and dissolves back
    to dotted, in a top-to-bottom sequence.
22. **Wave field** — a full-screen grid of cells rippling under a travelling crest; the
    stretch stays just under the merge threshold so the cells read as pulsing dashes with
    a bright band sweeping across, rather than a solid block.
23. **mpp wave** — the stretch-wave applied to the canonical `mpp` wordmark (the same
    block glyphs as the static wordmark / relay): a crest sweeps left→right, the mark's
    cells stretching into solid bars where it passes and collapsing to dots in the troughs.
24. **mpp wave (vertical)** — the same `mpp` mark with the wave running top→bottom and the
    cells stretching vertically into bars.

25. **Travelling wave (stretch)** — scene 2's grid reimagined on the stretch-wave engine:
    a single gaussian wavefront sweeps left→right and, where it passes, the cells stretch
    into solid bars, trailing back to dots — the original's sweeping wavefront with the
    stretch look.
26. **Pseudo-3D spiral (stretch)** — scene 3's rotating helix reimagined: the receding
    ribbon stays, but a wave travels *along* the spiral, each point stretching along the
    ribbon's tangent into a solid segment at the crest and a dot at the trough — a pulse
    of fill spiralling down as it turns, near turns scaled up by perspective.
27. **Wave sphere** — the stretch-wave mapped onto a sphere: a lat/long grid of horizontal
    dashes projected as a big dome filling the lower frame (black above). A concentric wave
    ripples outward from the pole — the dome pulsing between a near-solid surface and
    sparse rings — over a gentle spin about the polar axis.
28. **Machine payment** — `MACHINE / PAYMENT` in the horizontal-line font. A solid white
    cover wipes in row by row (each row whips left→right, then the next row down), covering
    the text; it holds, then the cover wipes out the same way top→bottom, fading from white
    back to black so the text is revealed underneath. Loops.
29. **Line ramp** — a stack of horizontal lines drawn from a dedicated thin→solid character
    ramp (` ▁ ▂ ▃ ▄ ▅ ▆ ▇ █` — the lower block elements, eight evenly spaced thickness steps
    with no gap, so the line thickens smoothly from a hairline to a solid bar). Each line reads
    thin on the left and large on the right, with a slow travelling shimmer and a per-line
    stagger that curves the leading edge into a wave across the stack. The glyphs are placed
    directly via the canvas char layer (`set_char`), so they're crisp characters rather than
    sub-pixel Braille.

Scenes 21–27 share a small reusable **stretch-wave engine** (`StretchWaveScene` in
`scenes.py`): a subclass supplies a field of cells (or its own geometry), picks the
wave/stretch axes, and optionally overrides `_activation` (the wave value per cell) — the
engine does the stretch-and-thickness rendering, so the effect drops onto any content. The
grid scenes use the default travelling sine; scene 25 overrides it with a sweeping
gaussian; scene 26 drives it along a spiral and scene 27 over a sphere, both with the
angled blit.

## How it draws

Two sub-pixel layers, both hand-implemented (no drawing library, no colour):

- **Braille layer** (2×4 sub-pixels/cell) holds all lines and hollow square outlines.
- **Half-block layer** (1×2 sub-pixels/cell) holds solid white fills, so they read as
  crisp solids rather than dotted Braille.

Per cell: if the half-block layer has any fill, render `▀ ▄ █`; otherwise render the
Braille glyph from that cell's dots; otherwise a space. Sub-pixels are ~square on both
layers (the ~1:2 character-cell ratio is accounted for), so squares look square. The
runner uses the alternate screen buffer, hides the cursor, repaints only changed cells
each frame (~30 fps, fixed sim timestep), re-reads the terminal size every frame, and
restores the screen + cursor on any exit.

**The wordmark** has one canonical letterform (a single dot-matrix in `_GLYPHS`) and one
canonical rendering: `word_elements()` merges each horizontal run of cells into a single
continuous **bar**, leaving vertical strokes as separate **dotted squares**. Every scene
that shows `mpp` — the static logo, the periodic `draw_word_intro` overlay, and the
typewriter / 3D-spin / assemble / zoom animations — renders these same elements, so the
mark looks identical everywhere.

## Accessibility & embedding rules

This program is the source of truth for how the identity looks and moves; these rules are
the spec any implementation (this one or a downstream port) must follow. The colour-role
guidance you may have seen elsewhere does **not** apply — the system is monochrome by
design; the only expressive moves are scale, line, and invert.

- **The wordmark is a graphic made of characters, not text.** Always provide a text
  alternative (`mpp`) and never rely on the glyphs to carry meaning. The decorative
  Braille / half-block characters are noise to assistive tech.
- **Motion is opt-in.** In a shipped product the animation should be **off by default
  after first run** (a launch banner animates once, then is static). Here, `MPP_BANNER_SEEN=1`
  models the "already seen" case.
- **Screen-reader contexts skip the art entirely.** `--screen-reader` (and
  `MPP_SCREEN_READER=1` / `TERM=dumb`) emit only the text alternative plus a short
  description — no alternate screen, cursor control, repaint, or decorative glyph.
- **Launch animations stay short and non-blocking** (≤ 3s) and must never delay the user;
  `--banner` is bounded and always restores the terminal on the way out.
- **Degrade in order:** animated → a single static frame (`--no-motion`) → plain squares →
  the `mpp` text alternative (`--screen-reader`). Each step still conveys the identity.
- **Exports are the handoff format** and are language-agnostic: plain-text glyph grids plus
  a `manifest.json` of `{file, duration_ms}` and the mark's text alternative. No colour,
  no control codes in any exported file.

## Adding a scene

Copy any `Scene` subclass, set its `name`, fill in `reset` / `update(dt)` / `draw(canvas)`
using `canvas.square_outline`, `square_fill`, and `line` (coordinates are in Braille
sub-pixel units; read `canvas.wu` / `canvas.hu` for the canvas extent), then register it.
Put tunable numbers as class constants at the top of the scene.

The built-in scenes (1–15) live in `mpp.py` and are listed in `_make_scenes()`. The
MACHINE PAYMENT PROTOCOL family and the block-wordmark scenes (16–20) live in `scenes.py`,
which builds on `mpp`'s core and exposes `make_scenes()`; `_make_scenes()` appends those.
So add a new scene to whichever file fits — `mpp.py`'s registry list, or
`scenes.py`'s `make_scenes()` — and add a one-line entry to `SCENE_BLURBS` in
`mpp.py` for the screen-reader / export description.
