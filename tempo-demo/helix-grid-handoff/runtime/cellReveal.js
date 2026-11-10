// Shared by the single-image reveal and the DOM-grid transition.
// Keep this schedule independent of either renderer so both print the same cells.
export function buildCellRevealKeys(cols, rows, options = {}) {
  return buildCellRevealSchedule(cols, rows, options).keys;
}

export function buildCellRevealSchedule(cols, rows, {
  stagger = 0.42, weights = [1, 1, 1, 1, 1], overlap = 0.24,
  cellAspect = 2, wobble = 0, blockScale = 1, seed = 0,
} = {}) {
  const w = weights;
  const ca = cellAspect > 0 ? cellAspect : 2;
  const keys = new Float32Array(cols * rows);
  const tileIds = new Uint32Array(cols * rows);
  let nextTile = 0;
    const STAGES = 5;
    const scale = Number.isFinite(blockScale) ? Math.max(.5, Math.min(4, blockScale)) : 1;
    const BLOCK_W = [1, 2, 3, 4, 5].map((width) => Math.max(1, Math.round(width * scale)));
    const BLOCK_H = BLOCK_W.map((wd) => Math.max(1, Math.round(wd / ca)));
    const total = w.reduce((s, x) => s + Math.max(0.001, x), 0);
    // the UN-jittered boundary rows/windows — boundary[b] is the line
    // between stage b-1 and stage b (boundary[0] = top edge, [STAGES] =
    // bottom edge, both left flat: only the 4 INTERNAL ones wiggle)
    const rowBoundary = [0],
      winBoundary = [0];
    for (let s = 0; s < STAGES; s++) {
      const share = Math.max(0.001, w[s]) / total;
      rowBoundary.push(rowBoundary[s] + rows * share);
      winBoundary.push(winBoundary[s] + share);
    }
    rowBoundary[STAGES] = rows; // exact edge, no rounding drift
    const STRIP_W = 4; // column granularity of the wobble
    const FEATHER = rows * 0.035 * wobble;
    const numStrips = Math.max(1, Math.ceil(cols / STRIP_W));
    // both sides of a shared boundary call this with the SAME (sx, b) — the
    // wobble lines up exactly, no gap or overlap between adjacent bands
    const wobbleAt = (sx, b) => Math.sin(sx * 0.9 + b * 2.1) * FEATHER;
    for (let stage = 0; stage < STAGES; stage++) {
      const Kw = BLOCK_W[stage],
        Kh = BLOCK_H[stage];
      const bandW = winBoundary[stage + 1] - winBoundary[stage];
      // clamped at 0/1: only the 4 internal boundaries stretch, the sweep
      // still starts at 0 and finishes at 1
      const winLo = Math.max(0, winBoundary[stage] - overlap * bandW);
      const winHi = Math.min(1, winBoundary[stage + 1] + overlap * bandW);
      // the GLOBAL block grid for this stage (nominal, un-wobbled rows) —
      // order rides THIS, one snake across the full width, rather than
      // numStrips separate ones each restarting their own local order
      const stageR0 = rowBoundary[stage];
      const blocksY = Math.max(
        1,
        Math.ceil((rowBoundary[stage + 1] - stageR0) / Kh),
      );
      const blocksX = Math.max(1, Math.ceil(cols / Kw));
      const tileOffset = nextTile;
      nextTile += blocksX * blocksY;
      const last = Math.max(1, blocksY * blocksX - 1);
      for (let sx = 0; sx < numStrips; sx++) {
        const cx0 = sx * STRIP_W,
          cx1 = Math.min(cols, cx0 + STRIP_W);
        const jTop = stage === 0 ? 0 : wobbleAt(sx, stage);
        const jBot = stage === STAGES - 1 ? 0 : wobbleAt(sx, stage + 1);
        const r0 = Math.max(0, Math.round(rowBoundary[stage] + jTop));
        const r1 = Math.min(rows, Math.round(rowBoundary[stage + 1] + jBot));
        if (r0 >= r1) continue; // this strip's band rounded to nothing
        for (let cy = r0; cy < r1; cy++) {
          const by = Math.max(
            0,
            Math.min(blocksY - 1, Math.floor((cy - stageR0) / Kh)),
          );
          // bidirectional print head: even block-rows sweep left->right,
          // odd ones right->left — the "gauche droite en bas" typewriter
          // feel, deterministic (no curve, no randomness of its own)
          const flip = by % 2 === 1;
          for (let cx = cx0; cx < cx1; cx++) {
            const bx = Math.min(blocksX - 1, Math.floor(cx / Kw));
            const bxOrdered = flip ? blocksX - 1 - bx : bx;
            const order = (by * blocksX + bxOrdered) / last;
            const rnd = hash01(by * 977 + bx * 131 + stage * 104729 + seed * 31);
            const local =
              stagger > 0 ? order * (1 - stagger) + rnd * stagger : order;
            keys[cy * cols + cx] = winLo + local * (winHi - winLo);
            tileIds[cy * cols + cx] = tileOffset + by * blocksX + bx;
          }
        }
      }
    }
  return { keys, tileIds };
}

function hash01(i) {
  let h = (i * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
