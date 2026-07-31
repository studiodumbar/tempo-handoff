#!/usr/bin/env python3
"""
tempo_dots — the TEMPO SHOP mark built from fewer dots, across a density range.

No new motion: this reuses tempo_shop's existing 'assemble' effect (the mark
flies together from a scatter, holds, then flies apart — the same ease-in-out
expo loop) completely unchanged. The ONLY thing that varies is dot density.

tempo_shop rasterises the glyphs by filling every Braille sub-pixel inside them
(a solid ~5k-dot mask). Here each sketch samples that fill on a coarser grid via
the `STEP` knob, so the mark is made of progressively fewer, more individually
visible dots — a clean stipple at the top, a bare constellation at the bottom
that still just reads. The dots sit on a quincunx (offset alternate rows) so thin
strokes keep catching dots instead of dropping out.

    1  tempo · dots · step 2   ~1/4 the dots   (~1250, a crisp stipple)
    2  tempo · dots · step 3   ~1/9            (~530)
    3  tempo · dots · step 4   ~1/16           (~310)
    4  tempo · dots · step 5   ~1/25           (~200, sparse)
    5  tempo · dots · step 6   ~1/36           (~130, the bare minimum that reads)

The STEP knob lives on tempo_shop's base scene, so any of its six motions can be
thinned the same way — e.g. `class X(TempoWipeScene): STEP = 3`.

Run: `python tempo_dots.py` (60fps explorer; flags delegate to mpp).
"""

from tempo_shop import TempoAssembleScene


class TempoDotsStep2Scene(TempoAssembleScene):
    name = "tempo · dots · step 2"
    STEP = 2


class TempoDotsStep3Scene(TempoAssembleScene):
    name = "tempo · dots · step 3"
    STEP = 3


class TempoDotsStep4Scene(TempoAssembleScene):
    name = "tempo · dots · step 4"
    STEP = 4


class TempoDotsStep5Scene(TempoAssembleScene):
    name = "tempo · dots · step 5"
    STEP = 5


class TempoDotsStep6Scene(TempoAssembleScene):
    name = "tempo · dots · step 6"
    STEP = 6


def make_scenes():
    return [
        TempoDotsStep2Scene(),     # 1  ~1/4 the dots
        TempoDotsStep3Scene(),     # 2  ~1/9
        TempoDotsStep4Scene(),     # 3  ~1/16
        TempoDotsStep5Scene(),     # 4  ~1/25
        TempoDotsStep6Scene(),     # 5  ~1/36 (fewest)
    ]


if __name__ == "__main__":
    import sys
    import mpp

    _scenes = make_scenes()
    if len(sys.argv) > 1 or not sys.stdout.isatty():
        mpp.main(_scenes)
    else:
        from hatch_grid import run
        run(_scenes)
