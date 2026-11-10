import { buildCellRevealSchedule } from "./cellReveal.js";
import { clamp01, smooth, hash, imageFit, createRevealTiming, REVEAL_EASINGS } from "./helixGridMath.js";
import { MOTION_DEFAULTS, MOTION_PATHS, ITEM_ORDERS, REVEAL_DIRECTIONS, RELEASE_MODES, SCATTER_MODES, BUILD_DIRECTIONS, HELIX_GRID_VARIATIONS, itemRanks, sourceRotation, downwardKey, releaseKey, flightPoint } from "./helixGridChoreography.js";
export { HELIX_GRID_VARIATIONS } from "./helixGridChoreography.js";

export const HELIX_GRID_DEFAULTS = Object.freeze({
  ...MOTION_DEFAULTS, ...HELIX_GRID_VARIATIONS[0].options, cellWidth: 6, cellAspect: 5 / 3, dotSize: 1.875,
  ink: "#eeeeee", maxDpr: 2, blockMix: .07, patchDensity: .36, blockLead: .04, frontWeight: 1.28, textureDensity: 1.12,
  gatherTime: .04, gatherSpread: .28, revealEase: "flow", revealEaseAmount: .85,
  renderStyle: "reference", flowBlockShape: "characters", flowTileLead: .12,
  flowCharacterScale: 1, flowCharacterGap: 1, flowEdgeRows: .75,
  flowBrightness: 2, flowBlocks: .8, flowBlockCoverage: .45, flowBarWidth: 5, flowDensity: 2.6, flowFlightSize: .4, flowGatherRows: 2, flowThreshold: 2.8, flowGapFill: 0, flowRowGap: .125,
  reveal: {
    cellReveal: .42, cellDelay: 0, cell1x1: 1, cell2x2: 1, cell3x3: 1,
    cell4x4: 1, cell5x5: 1, cellOverlap: .24, cellWobble: 0, cellStagger: .42, cellBlockScale: 1, cellTileAspect: 1,
    ...HELIX_GRID_VARIATIONS[0].options.reveal,
  },
});

function normaliseOptions(options) {
  const result = { ...HELIX_GRID_DEFAULTS, ...options, reveal: { ...HELIX_GRID_DEFAULTS.reveal, ...options.reveal } };
  const bound = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  for (const [key, min, max] of [["morph", .1, 10], ["hold", 0, 10], ["itemStagger", 0, 1],
    ["cellWidth", 4, 24], ["dotSize", .5, 8], ["maxDpr", 1, 3], ["blockMix", 0, 1], ["blockLead", 0, .8],
    ["frontWeight", .5, 2.5], ["textureDensity", .5, 2], ["cellAspect", 1, 2.5], ["patchDensity", 0, 1],
    ["revealEaseAmount", 0, 1], ["gatherTime", .015, .2], ["gatherSpread", 0, .6],
    ["flowEdgeRows", .5, 4], ["flowCharacterScale", .5, 2], ["flowCharacterGap", .5, 2], ["flowTileLead", .02, .4], ["flowGapFill", 0, 1], ["flowRowGap", 0, .2], ["flowGatherRows", .5, 8], ["flowFlightSize", .15, 1], ["flowBlockCoverage", 0, 1], ["flowBarWidth", 2, 12], ["flowBrightness", .2, 5], ["flowBlocks", 0, 4], ["flowDensity", .25, 3], ["flowThreshold", .5, 6],
    ["cellSpread", 0, .8], ["pathAmount", -1, 1],
    ["windup", 0, 1], ["release", .05, 2], ["whipTurns", -3, 3], ["whipSoft", 0, 1],
    ["whipDuration", .15, 3], ["whipPeak", .2, .8], ["whipSharpness", 2, 24],
    ["scatter", 0, 1.5], ["turbulence", 0, 1], ["inertia", 0, 1.5], ["drag", 1, 6],
    ["settle", 0, .2], ["cluster", 1, 16], ["seed", 0, 9999]])
    result[key] = bound(result[key], HELIX_GRID_DEFAULTS[key], min, max);
  for (const [key, min, max] of [["cellReveal", .1, 10], ["cellDelay", 0, 10],
    ["cellStagger", 0, 1], ["cellOverlap", 0, 1], ["cellWobble", 0, 1], ["cellBlockScale", .5, 4], ["cellTileAspect", 1, 5],
    ...[1, 2, 3, 4, 5].map((n) => [`cell${n}x${n}`, .001, 10])])
    result.reveal[key] = bound(result.reveal[key], HELIX_GRID_DEFAULTS.reveal[key], min, max);
  for (const [key, values] of [["revealEase", REVEAL_EASINGS], ["motion", MOTION_PATHS], ["order", ITEM_ORDERS], ["revealDirection", REVEAL_DIRECTIONS], ["releaseMode", RELEASE_MODES], ["scatterMode", SCATTER_MODES], ["buildDirection", BUILD_DIRECTIONS]])
    if (!values.includes(result[key])) result[key] = HELIX_GRID_DEFAULTS[key];
  result.cluster = Math.round(result.cluster); result.seed = Math.round(result.seed);
  if (!["reference", "patches"].includes(result.renderStyle)) result.renderStyle = "reference";
  if (!["characters", "tiles", "glyphs"].includes(result.flowBlockShape)) result.flowBlockShape = "characters";
  delete result.trail;
  return result;
}

/** Optional bridge from the site's current helix canvas, sampled just before play(). */
export function captureCanvasGlyphs(source, width, height, cellWidth = 6) {
  const raster = document.createElement("canvas");
  const cols = Math.ceil(width / cellWidth), rows = Math.ceil(height / (cellWidth * 2));
  raster.width = cols * 2; raster.height = rows * 4;
  const context = raster.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, raster.width, raster.height);
  const pixels = context.getImageData(0, 0, raster.width, raster.height).data;
  const glyphs = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let mask = 0, alpha = 0;
    for (let bit = 0; bit < 8; bit++) {
      const i = ((y * 4 + Math.floor(bit / 2)) * raster.width + x * 2 + bit % 2) * 4;
      const brightness = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) / 255 * pixels[i + 3] / 255;
      if (brightness > .12) { mask |= 1 << bit; alpha = Math.max(alpha, brightness); }
    }
    if (mask) glyphs.push({ x: x * cellWidth, y: y * cellWidth * 2, mask, alpha });
  }
  return glyphs;
}

/**
 * Attach only the animation to an existing, laid-out grid. Images must be decoded
 * and canvas-readable (same origin, or loaded with crossOrigin="anonymous").
 * @param {{root: HTMLElement, images?: string | Iterable<HTMLImageElement> | (() => Iterable<HTMLImageElement>),
 * options?: object, source?: (time: number, width: number, height: number, pose: {rotation:number,angularVelocity:number}) => Array<{x:number,y:number,mask:number,alpha:number}>,
 * onUpdate?: (state: object) => void, onComplete?: () => void, onError?: (error: Error, image: HTMLImageElement) => void}} input
 */
export async function createHelixGridTransition(input) {
  let helix, transition;
  try {
    if (!input.source) {
      const { createSiteHelixSource } = await import("./siteHelixSource.js");
      helix = await createSiteHelixSource();
    }
    transition = new HelixGridTransition({ ...input, source: input.source || helix.frame, emitterSource: input.emitterSource || helix?.emitters });
    transition.ownedSource = helix;
    const reference = (input.source || helix?.frame)?.referenceHelix;
    if (reference) {
      const { createReferenceGridFlow } = await import('./referenceGridFlow.js');
      transition.referenceFlow = createReferenceGridFlow(reference);
      transition.sourceCharacterStyle = { ...reference.glyph,
        cellWidth: reference.project.scene.cellW, cellHeight: reference.project.scene.cellH };
    }
    await transition.refresh(); transition.showHelix(); return transition;
  } catch (error) { transition?.destroy(); helix?.dispose(); throw error; }
}

export class HelixGridTransition {
  constructor({ root, images = "img", options = {}, source, emitterSource, onUpdate, onComplete, onError }) {
    if (!root) throw new Error("A grid container is required");
    if (!source) throw new Error("Use createHelixGridTransition() to prepare the original helix, or supply a source");
    this.root = root; this.images = images; this.source = source; this.emitterSource = emitterSource;
    this.onUpdate = onUpdate; this.onComplete = onComplete; this.onError = onError;
    this.options = normaliseOptions(options);
    this.records = []; this.saved = new Map(); this.links = [];
    this.time = 0; this.sourceTime = 0; this.clock = 0; this.mode = "paused";
    this.destroyed = false; this.generation = 0; this.frameId = 0;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this.rootPosition = root.style.position;
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "2",
    });
    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) throw new Error("Canvas2D is unavailable");
    root.append(this.canvas);
    this.resize = () => {
      if (!this.width || this.destroyed) return;
      cancelAnimationFrame(this.resizeId);
      this.resizeId = requestAnimationFrame(() => {
        this.refresh().catch((error) => { this.cancel(); this.onError?.(error, null); });
      });
    };
    this.observer = new ResizeObserver(() => {
      // The observer's initial notification must not supersede image preparation.
      if (this.width !== root.clientWidth || this.height !== root.clientHeight) this.resize();
    });
    this.observer.observe(root);
    window.addEventListener("resize", this.resize);
  }

  get releaseStart() {
    const o = this.options;
    // Longer or later whips must keep their cells until the accelerating flank.
    return Math.max(o.windup, o.whipDuration * o.whipPeak - o.release * .25);
  }

  get blockDelay() {
    return this.options.patchDensity > 0 ? this.options.blockLead : 0;
  }

  get duration() {
    if (this.referenceActive && this.referenceDuration) return this.referenceDuration;
    const o = this.options;
    return Math.max(o.whipDuration, this.releaseStart + o.release + o.morph + o.hold + o.reveal.cellDelay
      + o.reveal.cellReveal + this.blockDelay + Math.max(0, ...(this.ranks || [])) * o.itemStagger);
  }

  get referenceActive() { return this.options.renderStyle === "reference" && !!this.referenceFlow; }

  itemState(time, index) {
    const o = this.options, record = this.records[index];
    if (this.referenceActive) {
      const start = this.releaseStart + (this.ranks[index] || 0) * o.itemStagger;
      return { formation: clamp01((time - start) / (o.release + o.morph)),
        reveal: this.revealTiming.progressAt((time - start - o.morph - o.hold - o.blockLead - o.reveal.cellDelay) / o.reveal.cellReveal) };
    }
    const start = record?.firstArrival ?? this.releaseStart + o.morph;
    const end = record?.lastArrival ?? start + o.release;
    return { formation: clamp01((time - start + o.morph) / (end - start + o.morph)),
      reveal: clamp01((time - start - o.hold - o.reveal.cellDelay - this.blockDelay) / (end - start + o.reveal.cellReveal)) };
  }

  getImages() {
    return [...(typeof this.images === "string" ? this.root.querySelectorAll(this.images)
      : typeof this.images === "function" ? this.images() : this.images)];
  }

  async refresh() {
    const generation = ++this.generation;
    const images = this.getImages();
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    if (this.destroyed || generation !== this.generation) return;
    const rootRect = this.root.getBoundingClientRect();
    const width = this.root.clientWidth, height = this.root.clientHeight;
    if (!width || !height) throw new Error("The grid must be laid out before preparing the animation");
    this.width = width; this.height = height;
    this.dpr = Math.min(this.options.maxDpr, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const [image, style] of this.saved) if (!images.includes(image)) {
      image.style.opacity = style.opacity; image.style.transition = style.transition; this.saved.delete(image);
    }
    const records = [];
    for (const image of images) {
      if (!this.saved.has(image)) this.saved.set(image, { opacity: image.style.opacity, transition: image.style.transition });
      const r = image.getBoundingClientRect();
      if (!r.width || !r.height || !image.naturalWidth) continue;
      const rect = {
        x: (r.left - rootRect.left) * width / rootRect.width,
        y: (r.top - rootRect.top) * height / rootRect.height,
        width: r.width * width / rootRect.width, height: r.height * height / rootRect.height,
      };
      try { records.push(this.sample(image, rect)); }
      catch (error) {
        const saved = this.saved.get(image);
        image.style.opacity = saved.opacity; image.style.transition = saved.transition;
        this.onError?.(error, image);
      }
    }
    this.records = records.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    if (!records.length) throw new Error("No readable, laid-out product images are available");
    this.makeLinks();
    this.render(this.time);
  }

  sample(image, rect) {
    const cellW = this.options.cellWidth, cellH = cellW * this.options.cellAspect;
    const cols = Math.ceil(rect.width / cellW), rows = Math.ceil(rect.height / cellH);
    const raster = document.createElement("canvas");
    raster.width = cols * 2; raster.height = rows * 4;
    const ctx = raster.getContext("2d", { willReadFrequently: true });
    const style = getComputedStyle(image);
    const fit = imageFit(image.naturalWidth, image.naturalHeight, rect.width, rect.height, style.objectFit, style.objectPosition);
    ctx.drawImage(image, fit.x * 2 / cellW, fit.y * 4 / cellH,
      fit.width * 2 / cellW, fit.height * 4 / cellH);
    const pixels = ctx.getImageData(0, 0, raster.width, raster.height).data;
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let mask = 0, frontMask = 0, opaqueQuadrants = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = ((y * 4 + dy) * raster.width + x * 2 + dx) * 4;
        const alpha = pixels[i + 3] / 255;
        const luma = (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255;
        const bit = dy * 2 + dx;
        if (alpha > .5) frontMask |= 1 << bit;
        const density = alpha * (.28 + .42 * Math.sqrt(luma)) * this.options.textureDensity;
        if (alpha > .08 && hash(i + 37) < density) mask |= 1 << (dy * 2 + dx);
      }
      const index = y * cols + x;
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const a = Math.floor(quadrant / 2) * 4 + quadrant % 2, pair = (1 << a) | (1 << (a + 2));
        if ((frontMask & pair) === pair) opaqueQuadrants |= 1 << quadrant;
      }
      if (mask || frontMask) cells.push({ x: x * cellW, y: y * cellH, col: x, row: y, index, mask, frontMask, opaqueQuadrants });
    }
    const imageSeed = [...new URL(image.currentSrc || image.src).pathname.split('/').pop().slice(-128)]
      .reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
    const p = this.options.reveal;
    const { keys, tileIds } = buildCellRevealSchedule(cols, rows, {
      seed: imageSeed + this.options.seed, stagger: p.cellStagger, overlap: p.cellOverlap, wobble: p.cellWobble,
      cellAspect: this.options.cellAspect * p.cellTileAspect, blockScale: p.cellBlockScale,
      weights: [p.cell1x1, p.cell2x2, p.cell3x3, p.cell4x4, p.cell5x5],
    });
    const tileBounds = new Map();
    for (const cell of cells) {
      const id = tileIds[cell.index], bounds = tileBounds.get(id) || { left: cell.col, right: cell.col, top: cell.row, bottom: cell.row };
      bounds.left = Math.min(bounds.left, cell.col); bounds.right = Math.max(bounds.right, cell.col);
      bounds.top = Math.min(bounds.top, cell.row); bounds.bottom = Math.max(bounds.bottom, cell.row);
      tileBounds.set(id, bounds);
    }
    const patchTiles = new Set([...tileBounds.keys()].filter(tile =>
      hash(tile * 131 + imageSeed + this.options.seed * 313) < this.options.patchDensity));
    for (const cell of cells) {
      if (!cell.frontMask || !patchTiles.has(tileIds[cell.index])) continue;
      const tile = tileIds[cell.index], bounds = tileBounds.get(tile);
      const seed = tile * 47 + this.options.seed * 109 + imageSeed;
      const rowPattern = hash(seed + cell.row * 139 + 991);
      const notch = bounds.right - bounds.left > 2 ? Math.floor(rowPattern * 2) : 0;
      const solid = hash(seed + 713) < this.options.blockMix
        && cell.row === bounds.top + Math.floor(hash(seed + 419) * (bounds.bottom - bounds.top + 1))
        && cell.col >= bounds.left + notch && cell.col <= bounds.right - (1 - notch);
      // One tile chooses the material; a shared row mask joins neighbouring glyphs into bars.
      const qmask = solid ? cell.opaqueQuadrants & (rowPattern < .5 ? 3 : 12) : 0;
      cell.frontStyle = { qmask, cellWidth: cellW, cellHeight: cellH,
        gapX: 0, gapY: .14,
        dotRadius: Math.min(cellW * .21, this.options.dotSize * this.options.frontWeight / 2) };
    }
    if (this.options.revealDirection === "centre") {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const index = y * cols + x;
        keys[index] = clamp01(Math.hypot((x + .5) / cols - .5, (y + .5) / rows - .5) / Math.SQRT1_2 * .88 + keys[index] * .12);
      }
    }
    return { image, rect, fit, cols, rows, cells, keys, tileIds, patchTiles, imageSeed };
  }

  sourcePose(time) {
    return { rotation: sourceRotation(time, this.options),
      angularVelocity: (sourceRotation(time + .002, this.options) - sourceRotation(time - .002, this.options)) / .004 };
  }

  getSource(time, pose) {
    return this.source(time, this.width, this.height, pose);
  }

  makeLinks() {
    const o = this.options;
    this.frozen = this.getSource(this.sourceTime);
    this.revealTiming = createRevealTiming(o.revealEase, o.revealEaseAmount);
    this.ranks = itemRanks(this.records.map((record) => record.rect), o.order);
    if (this.referenceActive) {
      this.links = this.records.flatMap(record => record.cells);
      this.prepareReference(); return;
    }
    const samples = new Map();
    const sample = (time) => {
      // Nearby cells share an emission frame, preserving local blocks and bounding GPU readbacks.
      const bucket = Math.round(time * 60), stamp = bucket / 60;
      if (!samples.has(bucket)) samples.set(bucket, this.emitterSource
        ? this.emitterSource(this.sourceTime + stamp, this.width, this.height, this.sourcePose(stamp))
        : this.getSource(this.sourceTime + stamp, this.sourcePose(stamp)));
      return samples.get(bucket);
    };
    this.links = [];
    this.records.forEach((record, product) => {
      record.arrivals = new Float32Array(record.cols * record.rows);
      record.firstArrival = Infinity; record.lastArrival = 0;
      for (let row = 0; row < record.rows; row++) for (let col = 0; col < record.cols; col++) {
        const index = row * record.cols + col;
        const x = record.rect.x + col * o.cellWidth, y = record.rect.y + row * o.cellWidth * o.cellAspect;
        const key = o.buildDirection === "down" ? downwardKey(row, record.rows)
          : releaseKey(x, y, this.width, this.height, o, index + product * 1031);
        const arrival = this.releaseStart + this.revealTiming.timeAt(key) * o.release + this.ranks[product] * o.itemStagger + o.morph;
        record.arrivals[index] = arrival;
        record.firstArrival = Math.min(record.firstArrival, arrival); record.lastArrival = Math.max(record.lastArrival, arrival);
      }
      // Both fronts share each tile's schedule, so the blocks lead its photograph by a fixed interval.
      const revealStart = record.firstArrival + o.hold + o.reveal.cellDelay;
      const revealDuration = record.lastArrival - record.firstArrival + o.reveal.cellReveal * .98;
      record.blockTimes = Float64Array.from(record.keys, (key, index) => {
        const row = Math.floor(index / record.cols), tile = record.tileIds[index];
        const order = o.revealDirection === "down"
          ? clamp01((row + (hash(tile * 79 + record.imageSeed) - .5) * o.reveal.cellStagger * 5 * o.reveal.cellBlockScale) / record.rows) : key;
        return Math.max(record.arrivals[index] + o.hold + o.reveal.cellDelay, revealStart + this.revealTiming.timeAt(order) * revealDuration);
      });
      const tileTimes = new Map();
      record.blockTimes.forEach((time, index) => {
        const tile = record.tileIds[index];
        tileTimes.set(tile, Math.max(time, tileTimes.get(tile) || 0));
      });
      record.blockTimes = Float64Array.from(record.tileIds, (tile) => tileTimes.get(tile));
      // Sparse delayed tiles leave bright islands behind the advancing photograph edge.
      record.photoTimes = Float64Array.from(record.blockTimes, (time, index) =>
        time + (record.patchTiles.has(record.tileIds[index]) ? this.blockDelay : 0));
      for (const cell of record.cells) {
        const departure = record.arrivals[cell.index] - o.morph;
        const seed = o.scatterMode === "blocks"
          ? Math.floor(cell.col / o.cluster) + Math.floor(cell.row / o.cluster) * 211 + product * 1031
          : cell.index + product * 1031;
        const emitters = sample(departure);
        const target = { x: record.rect.x + cell.x, y: record.rect.y + cell.y };
        let band = emitters;
        if (o.releaseMode === "cross") band = emitters.filter((p) => (p.x < this.width / 2) !== (target.x < this.width / 2));
        else if (o.scatterMode === "directional") band = emitters.filter((p) => Math.abs(p.y - target.y) < this.height * .22);
        if (!band.length) band = emitters;
        const source = band[Math.floor(hash(seed + o.seed * 61) * band.length)]
          || { x: this.width / 2, y: this.height / 2, vx: this.width, vy: 0 };
        this.links.push({ record, product, cell, source, seed, departure,
          target, blockAt: record.blockTimes[cell.index],
          photoAt: record.photoTimes[cell.index] });
      }
    });
  }

  prepareReference() {
    const o = this.options;
    this.referenceFlow.prepare(this.records, this.width, this.height, o, this.ranks, this.revealTiming);
    let end = this.releaseStart + this.referenceFlow.duration, photoEnd = 0;
    for (const [product, record] of this.records.entries()) {
      const start = this.releaseStart + this.ranks[product] * o.itemStagger;
      record.coverage = new Uint8Array(record.cols * record.rows);
      for (const cell of record.cells) if (cell.frontMask) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = cell.col + dx, y = cell.row + dy;
          if (x >= 0 && y >= 0 && x < record.cols && y < record.rows) record.coverage[y * record.cols + x] = 255;
        }
      }
      record.photoTimes = Float64Array.from(record.keys, (key, index) => {
        // Fit the tile clock to visible ink, just like the particle sweep.
        const front = clamp01((key * record.rect.height - record.inkTop) / Math.max(1, record.inkBottom - record.inkTop));
        return start + o.morph + o.reveal.cellDelay + this.revealTiming.timeAt(front) * o.reveal.cellReveal + o.blockLead + o.hold;
      });
      const fullInk = new Uint8Array(record.cols * record.rows);
      for (const cell of record.cells) fullInk[cell.index] = Number(cell.frontMask === 255);
      const sourceStyle = this.sourceCharacterStyle;
      const characterCols = Math.max(1, Math.round(sourceStyle.cellWidth * o.flowCharacterScale / o.cellWidth));
      const characterRows = Math.max(1, Math.round(sourceStyle.cellHeight * o.flowCharacterScale / (o.cellWidth * o.cellAspect)));
      record.characterStyle = { cellWidth: characterCols * o.cellWidth,
        cellHeight: characterRows * o.cellWidth * o.cellAspect, qmask: 15,
        gapX: sourceStyle.gapX * o.flowCharacterGap, gapY: sourceStyle.gapY * o.flowCharacterGap };
      record.solidCharacters = [];
      for (let row = 0; row + characterRows <= record.rows; row += characterRows) {
        for (let col = 0; col + characterCols <= record.cols; col += characterCols) {
          const id = row / characterRows * Math.ceil(record.cols / characterCols) + col / characterCols;
          if (hash(id * 131 + record.imageSeed + o.seed * 313) >= o.flowBlockCoverage) continue;
          let opaque = true, photoAt = Infinity;
          for (let y = row; y < row + characterRows; y++) for (let x = col; x < col + characterCols; x++) {
            const index = y * record.cols + x;
            opaque &&= !!fullInk[index]; photoAt = Math.min(photoAt, record.photoTimes[index]);
          }
          // A character retires before any photo tile crosses it, keeping its ink box intact.
          if (!opaque) continue;
          const cellH = o.cellWidth * o.cellAspect;
          const reach = Math.max(1, Math.round(characterRows * o.flowEdgeRows));
          let edgeAt = row * cellH <= record.inkTop + cellH ? start : Infinity;
          const edgeTimes = [];
          for (let y = Math.max(0, row - reach); y < row; y++) {
            for (let x = Math.max(0, col - characterCols); x < Math.min(record.cols, col + characterCols * 2); x++) {
              const index = y * record.cols + x;
              if (fullInk[index]) edgeTimes.push(record.photoTimes[index]);
            }
          }
          edgeTimes.sort((a, b) => a - b);
          // Follow the local edge's majority, so one early photo cell cannot seed a low white island.
          if (edgeTimes.length) edgeAt = Math.min(edgeAt, edgeTimes[Math.floor(edgeTimes.length / 2)]);
          // Tie white ink to the visible photo edge, not the earlier particle front below it.
          const solidAt = Math.max(start, photoAt - o.flowTileLead, edgeAt);
          if (solidAt < photoAt) record.solidCharacters.push({ x: col * o.cellWidth, y: row * cellH,
            photoAt, solidAt, edgeAt });
        }
      }
      const tiles = new Map();
      record.tileIds.forEach((id, index) => {
        const x = index % record.cols, y = Math.floor(index / record.cols);
        const tile = tiles.get(id) || { id, left: x, right: x, top: y, bottom: y, count: 0, opaque: true,
          photoAt: record.photoTimes[index] };
        tile.left = Math.min(tile.left, x); tile.right = Math.max(tile.right, x);
        tile.top = Math.min(tile.top, y); tile.bottom = Math.max(tile.bottom, y);
        tile.count++; tile.opaque &&= !!fullInk[index]; tiles.set(id, tile);
      });
      // Only whole, opaque photo tiles qualify. Their material switches once,
      // on the same clock as the photograph, so no particle can chip a corner off.
      const candidates = [...tiles.values()].filter(tile => tile.opaque
        && tile.count === (tile.right - tile.left + 1) * (tile.bottom - tile.top + 1)
        && hash(tile.id * 131 + record.imageSeed + o.seed * 313) < o.flowBlockCoverage)
        .sort((a, b) => hash(a.id * 131 + record.imageSeed + o.seed * 313)
          - hash(b.id * 131 + record.imageSeed + o.seed * 313));
      const selected = [];
      for (const tile of candidates) {
        const joins = selected.some(other => Math.abs(tile.photoAt - other.photoAt) < o.flowTileLead
          && (((tile.left === other.right + 1 || other.left === tile.right + 1)
            && tile.top <= other.bottom && tile.bottom >= other.top)
          || ((tile.top === other.bottom + 1 || other.top === tile.bottom + 1)
            && tile.left <= other.right && tile.right >= other.left)));
        // Adjacent white cells must not fuse into a new stepped silhouette.
        if (!joins) selected.push(tile);
      }
      record.solidTiles = selected.map(tile => ({ x: tile.left * o.cellWidth, y: tile.top * o.cellWidth * o.cellAspect,
          width: (tile.right - tile.left + 1) * o.cellWidth,
          height: (tile.bottom - tile.top + 1) * o.cellWidth * o.cellAspect,
          photoAt: tile.photoAt, solidAt: Math.max(start, tile.photoAt - o.flowTileLead) }));
      for (const time of record.photoTimes) photoEnd = Math.max(photoEnd, time);
      end = Math.max(end, photoEnd);
    }
    this.lastPhotoAt = photoEnd;

    this.referenceDuration = Math.max(this.options.whipDuration, end + .025);
  }

  renderReference(time) {
    const ctx = this.ctx, o = this.options, local = time - this.releaseStart;
    if (time >= this.lastPhotoAt) {
      ctx.globalAlpha = 1;
      for (const { image, rect, fit } of this.records)
        ctx.drawImage(image, rect.x + fit.x, rect.y + fit.y, fit.width, fit.height);
      this.report(time, "photo"); return;
    }
    const glyphs = local < 0 ? this.getSource(this.sourceTime + time, this.sourcePose(time))
      : this.referenceFlow.render(local, this.sourceTime + this.releaseStart, this.sourcePose(time));
    const path = new Path2D();
    for (const glyph of glyphs) {
      if (local >= 0 && o.flowBlockShape !== "glyphs") glyph.qmask = 0;
      this.glyphPath(path, glyph.x, glyph.y, glyph.mask, glyph);
    }
    ctx.globalAlpha = 1; ctx.fillStyle = o.ink; ctx.fill(path);
    if (o.flowBlockShape === "characters" && local >= 0) {
      const characters = new Path2D();
      for (const record of this.records) for (const character of record.solidCharacters) {
        if (time < character.solidAt || time >= character.photoAt) continue;
        const x = record.rect.x + character.x, y = record.rect.y + character.y;
        const style = record.characterStyle;
        // Clear the character's advance box so braille cannot fill its letter spacing.
        ctx.clearRect(x, y, style.cellWidth, style.cellHeight);
        this.glyphPath(characters, x, y, 0, style);
      }
      ctx.fill(characters);
    }
    if (o.flowBlockShape === "tiles" && local >= 0) {
      const tiles = new Path2D();
      for (const record of this.records) for (const tile of record.solidTiles) {
        if (time >= tile.solidAt && time < tile.photoAt)
          tiles.rect(record.rect.x + tile.x, record.rect.y + tile.y, tile.width, tile.height);
      }
      ctx.fill(tiles);
    }
    let anyPhoto = false;
    for (const record of this.records) {
      const { rect, fit, image, cols, rows, photoTimes, coverage } = record;
      const w = o.cellWidth, h = w * o.cellAspect;
      ctx.save(); ctx.beginPath();
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (time < photoTimes[i]) continue;
        const px = rect.x + x * w, py = rect.y + y * h;
        const cw = Math.min(w, rect.width - x * w), ch = Math.min(h, rect.height - y * h);
        if (coverage[i]) ctx.clearRect(px, py, cw, ch);
        ctx.rect(px, py, cw, ch); anyPhoto = true;
      }
      ctx.clip(); ctx.drawImage(image, rect.x + fit.x, rect.y + fit.y, fit.width, fit.height); ctx.restore();
    }
    this.report(time, anyPhoto ? "photo" : local < 0 ? "whip" : "forming");
  }

  hideImages() {
    for (const record of this.records) {
      record.image.style.transition = "none"; record.image.style.opacity = "0";
    }
    this.canvas.style.display = "block";
  }

  restoreImages() {
    for (const [image, style] of this.saved) {
      image.style.opacity = style.opacity;
    }
    // Commit the final pixels before returning any website-owned opacity transition.
    void this.root.offsetWidth;
    for (const [image, style] of this.saved) image.style.transition = style.transition;
    this.canvas.style.display = "none";
  }

  glyphPath(path, x, y, mask, style) {
    if (style?.cellWidth) {
      const w = style.cellWidth, h = style.cellHeight;
      const gx = style.gapX || 0, gy = style.gapY || 0;
      const iw = w * (1 - 2 * gx), ih = h * (1 - 2 * gy);
      if (style.qmask) {
        for (let bit = 0; bit < 4; bit++) if (style.qmask & (1 << bit))
          path.rect(x + w * gx + bit % 2 * iw / 2, y + h * gy + Math.floor(bit / 2) * ih / 2, iw / 2, ih / 2);
      }
      if (!style.qmask || style.gapFill > 0) {
        const radius = (style.dotRadius ?? this.options.dotSize / 2) * (style.qmask ? Math.sqrt(style.gapFill) : 1);
        for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) {
          // Partial solid glyphs retain braille in their unfilled quadrants.
          const quadrant = Math.floor(bit / 4) * 2 + bit % 2;
          if (style.qmask & (1 << quadrant)) continue;
          const cx = x + w * gx + (bit % 2 + .5) * iw / 2;
          const cy = y + h * gy + (Math.floor(bit / 2) + .5) * ih / 4;
          path.moveTo(cx + radius, cy); path.arc(cx, cy, radius, 0, Math.PI * 2);
        }
      }
      return;
    }
    const { cellWidth: w, cellAspect, dotSize } = this.options;
    for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) {
      const dx = (bit % 2 + .5) * w / 2, dy = (Math.floor(bit / 2) + .5) * w * cellAspect / 4;
      path.rect(x + dx - dotSize / 2, y + dy - dotSize / 2, dotSize, dotSize);
    }
  }

  glyph(x, y, mask, alpha = 1, style) {
    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath(); this.glyphPath(this.ctx, x, y, mask, style); this.ctx.fill();
  }

  render(time) {
    if (this.destroyed || !this.width) return;
    const ctx = this.ctx, options = this.options;
    ctx.clearRect(0, 0, this.width, this.height);
    if (time >= this.duration || this.reducedMotion.matches) {
      this.restoreImages(); this.report(this.duration, "complete"); return;
    }
    this.hideImages(); ctx.fillStyle = options.ink;
    if (this.mode === "helix") {
      for (const glyph of this.getSource(this.clock)) this.glyph(glyph.x, glyph.y, glyph.mask, glyph.alpha, glyph);
      this.report(0, "helix"); return;
    }
    if (this.referenceActive) { this.renderReference(time); return; }
    const paths = Array.from({ length: 8 }, () => new Path2D());
    const extent = Math.min(this.width, this.height);
    if (time < this.releaseStart + options.release + .12) {
      const pose = this.sourcePose(time);
      const source = this.getSource(this.sourceTime + time, pose);
      for (let i = 0; i < source.length; i++) {
        const glyph = source[i];
        const key = releaseKey(glyph.x, glyph.y, this.width, this.height, options, Math.floor(glyph.x / 12) + Math.floor(glyph.y / 20) * 997);
        const fade = 1 - smooth((time - this.releaseStart - key * options.release * .62) / (options.release * .38 + .06));
        if (fade > .01) this.glyph(glyph.x, glyph.y, glyph.mask, glyph.alpha * fade, glyph);
      }
    }
    for (const link of this.links) {
      const { cell, source, target, seed, departure, blockAt, photoAt } = link;
      const p = (time - departure) / Math.max(.001, blockAt - departure);
      if (p < 0 || time >= photoAt) continue;
      const landing = smooth((time - blockAt + options.gatherTime) / options.gatherTime);
      if (time >= blockAt && cell.frontStyle) {
        this.glyphPath(paths[7], target.x, target.y, cell.frontMask, cell.frontStyle);
      } else if (landing > .01) {
        // Gather separate dots so the approach never becomes a rectangular image stencil.
        for (let bit = 0; bit < 8; bit++) if ((cell.mask & (1 << bit)) && hash(seed * 17 + bit * 41) < landing) {
          const spread = (1 - landing) * options.cellWidth * 5;
          const x = target.x + (hash(seed * 31 + bit * 73) - .5) * spread;
          const y = target.y + hash(seed * 43 + bit * 97) * spread;
          this.glyphPath(paths[7], x, y, 1 << bit);
        }
      }
      if (p >= 1) continue;
      const point = flightPoint(source, target, p, options, seed, extent);
      // The reference keeps the feed loose below the edge until the short gathering phase.
      const loose = (1 - landing) * smooth(p / .25) * clamp01((blockAt - time) / .3);
      const drift = link.record.fit.height * options.gatherSpread * loose;
      point.x += (hash(seed + options.seed * 71) - .5) * drift;
      point.y += drift;
      const alpha = Math.min(1, p / .045);
      if (alpha < .025) continue;
      const bucket = Math.min(7, Math.floor(alpha * 7));
      this.glyphPath(paths[bucket], point.x, point.y, 1 << (seed % 8));
    }
    paths.forEach((path, i) => { ctx.globalAlpha = (i + 1) / 8; ctx.fill(path); });
    ctx.globalAlpha = 1;
    let anyPhoto = false;
    this.records.forEach((record) => {
      if (time < record.firstArrival + options.hold + options.reveal.cellDelay) return;
      const { rect, fit, cols, rows, photoTimes, image } = record;
      const w = options.cellWidth, h = w * options.cellAspect;
      ctx.save(); ctx.beginPath();
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const index = y * cols + x;
        if (time >= photoTimes[index]) {
          ctx.rect(rect.x + x * w, rect.y + y * h, Math.min(w, rect.width - x * w), Math.min(h, rect.height - y * h));
          anyPhoto = true;
        }
      }
      ctx.clip();
      // The photograph always uses its final, axis-aligned DOM rectangle.
      ctx.drawImage(image, rect.x + fit.x, rect.y + fit.y, fit.width, fit.height);
      ctx.restore();
    });
    this.report(time, anyPhoto ? "photo" : time <= options.whipDuration * options.whipPeak ? "whip" : "forming");
  }

  report(time, phase) {
    this.onUpdate?.({ time, duration: this.duration, progress: time / this.duration, phase,
      imageCount: this.records.length, glyphCount: this.links.length,
      items: this.records.map((_, i) => this.itemState(time, i)) });
  }

  tick = (now) => {
    if (this.destroyed || this.mode === "paused") return;
    const dt = Math.min(.05, Math.max(0, (now - this.last) / 1000));
    this.last = now; this.clock += dt;
    if (this.mode === "playing") this.time = Math.min(this.duration, this.time + dt);
    this.render(this.time);
    if (this.mode === "playing" && (this.time >= this.duration || this.reducedMotion.matches)) {
      this.mode = "paused"; this.resolve?.({ cancelled: false }); this.resolve = null;
      this.onComplete?.(); return;
    }
    if (this.reducedMotion.matches) { this.mode = "paused"; return; }
    this.frameId = requestAnimationFrame(this.tick);
  };

  startLoop() {
    cancelAnimationFrame(this.frameId);
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  showHelix() {
    this.resolve?.({ cancelled: true }); this.resolve = null;
    this.mode = "helix"; this.time = 0;
    this.render(0); this.startLoop();
  }

  play() {
    if (this.destroyed) return Promise.resolve({ cancelled: true });
    if (this.mode === "playing") return this.playing;
    if (this.mode === "helix" || this.time >= this.duration) {
      this.time = 0; this.sourceTime = this.clock; this.makeLinks();
    }
    this.mode = "playing";
    if (!this.resolve) this.playing = new Promise((resolve) => { this.resolve = resolve; });
    this.startLoop(); return this.playing;
  }

  pause() {
    if (this.mode === "helix") { this.sourceTime = this.clock; this.makeLinks(); }
    this.mode = "paused"; cancelAnimationFrame(this.frameId);
  }

  seek(seconds) {
    this.pause();
    if (this.time === 0) { this.sourceTime = this.clock; this.makeLinks(); }
    this.time = Math.max(0, Math.min(this.duration, seconds));
    this.render(this.time);
  }

  async setOptions(options) {
    this.options = normaliseOptions({ ...this.options, ...options, reveal: { ...this.options.reveal, ...options.reveal } });
    await this.refresh();
  }

  cancel() {
    this.pause(); this.restoreImages(); this.time = this.duration;
    this.resolve?.({ cancelled: true }); this.resolve = null;
  }

  destroy() {
    this.cancel(); this.destroyed = true; this.generation++;
    cancelAnimationFrame(this.resizeId);
    this.observer.disconnect(); window.removeEventListener("resize", this.resize);
    this.canvas.remove(); this.root.style.position = this.rootPosition;
    this.referenceFlow?.dispose();
    this.ownedSource?.dispose();
  }
}
