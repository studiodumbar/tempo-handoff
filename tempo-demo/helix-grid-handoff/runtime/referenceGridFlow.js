import { SiteHelixSource } from './siteHelixSource.js';
import { ParticleEngine, sortLayout } from './particles.js';
import { hash, clamp01 } from './helixGridMath.js';

export function createReferenceGridFlow(source) {
  const project = structuredClone(source.project);
  const flow = new ReferenceGridFlow(project, project.clips.find(clip => clip.key === 'helix-train'));
  flow.referenceProjection = project.comp.height / project.scene.cellH * 4 / (2 * Math.tan(project.scene.fov * Math.PI / 360));
  flow.settings = source.settings;
  flow.mode._values = flow.settings;
  return flow;
}

/** The original particle and terminal passes, with flat targets measured from the DOM. */
class ReferenceGridFlow extends SiteHelixSource {
  prepare(records, width, height, options, ranks, timing) {
    this.options = options;
    this.project.scene.cellW = options.cellWidth;
    this.project.scene.cellH = options.cellWidth * options.cellAspect;
    // Keep samples per glyph stable when one reference image becomes a whole grid.
    const occupied = records.reduce((n, r) => n + r.cells.filter(c => c.frontMask).length, 0);
    const count = Math.max(16384, Math.min(131072, Math.ceil(occupied * 10 * options.flowDensity / 16384) * 16384));
    if (count !== this.engine.N) {
      this.scene.remove(this.engine.points);
      this.engine.points.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      this.engine.printMat.dispose();
      this.engine = new ParticleEngine(count);
      this.engine.camera = this.camera;
      this.scene.add(this.engine.points);
    }
    this.resize(width, height);
    const { engine, camera, terminal } = this;
    const halfH = 3.55 * Math.tan(camera.fov * Math.PI / 360);
    const halfW = halfH * camera.aspect;
    const samples = [], cumulative = [];
    let total = 0;
    records.forEach((record, product) => {
      const { image, rect, fit } = record;
      const raster = document.createElement('canvas');
      raster.width = Math.max(2, Math.round(rect.width));
      raster.height = Math.max(2, Math.round(rect.height));
      const ctx = raster.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
      const pixels = ctx.getImageData(0, 0, raster.width, raster.height).data;
      let top = raster.height, bottom = 0, toneSum = 0, toneCount = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 127) {
        const y = Math.floor(i / 4 / raster.width); top = Math.min(top, y); bottom = Math.max(bottom, y);
        toneSum += (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255; toneCount++;
      }
      record.inkTop = top; record.inkBottom = bottom;
      const lightInk = toneSum / Math.max(1, toneCount) > .5;
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
        const i = (y * raster.width + x) * 4, alpha = pixels[i + 3] / 255;
        if (alpha < .5) continue;
        const luma = (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255;
        const weight = (lightInk ? luma : 1 - luma) * alpha;
        if (weight < .5) continue;
        total += Math.pow(weight, 1.4);
        samples.push({ x: rect.x + (x + .5) * rect.width / raster.width,
          y: rect.y + (y + .5) * rect.height / raster.height,
          product, weight });
        cumulative.push(total);
      }
    });
    const N = engine.N, pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3), aux = new Float32Array(N), bri = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const pick = (i + .5) / N * total;
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (cumulative[mid] < pick) lo = mid + 1; else hi = mid; }
      const sample = samples[lo] || { x: width / 2, y: height / 2, product: 0 };
      pos[i * 3] = ((sample.x + hash(i * 3 + 1 + options.seed * 67) - .5) / width * 2 - 1) * halfW;
      pos[i * 3 + 1] = (1 - (sample.y + hash(i * 7 + 3 + options.seed * 67) - .5) / height * 2) * halfH;
      aux[i] = sample.product;
      const r = records[sample.product];
      const col = Math.max(0, Math.min(r.cols - 1, Math.floor((sample.x - r.rect.x) / options.cellWidth)));
      const row = Math.max(0, Math.min(r.rows - 1, Math.floor((sample.y - r.rect.y) / (options.cellWidth * options.cellAspect))));
      // Short runs change each glyph row, rather than filling whole photo tiles.
      const span = Math.max(2, Math.round(options.flowBarWidth));
      const offset = Math.floor(hash(row * 71 + r.imageSeed) * span);
      const lane = col + offset, run = Math.floor(lane / span);
      nrm[i * 3] = lane % span < span - 1 && hash(run * 131 + row * 977 + r.imageSeed + options.seed * 313) < options.flowBlockCoverage ? 1 : 0;
      bri[i] = samples.length ? (.8 + .24 * hash(i * 11 + 5 + options.seed * 67)) * (.55 + .45 * sample.weight) : 0;
    }
    const target = sortLayout({ pos, nrm, aux, bri }, N);
    this.target = target; this.halfW = halfW; this.halfH = halfH;
    const original = sortLayout(this.mode.gen(16384, this.settings), 16384);
    const source = { pos: new Float32Array(N * 3), nrm: new Float32Array(N * 3), aux: new Float32Array(N), bri: new Float32Array(N) };
    const copies = N / 16384;
    for (let i = 0; i < N; i++) {
      const j = Math.floor(i / copies);
      source.pos.set(original.pos.subarray(j * 3, j * 3 + 3), i * 3);
      source.nrm.set(original.nrm.subarray(j * 3, j * 3 + 3), i * 3);
      source.aux[i] = original.aux[j]; source.bri[i] = original.bri[j];
      // Preserve the source population before extra samples join the flight.
      target.nrm[i * 3 + 1] = i % copies === 0 ? 1 : 0;
    }
    const mode = this.mode, flow = this;
    const sourceMode = Object.create(mode);
    sourceMode.update = function(slot, params, time) {
      mode.update(slot, params, time);
      const angle = flow.pose?.rotation || 0, c = Math.cos(angle), s = Math.sin(angle);
      for (let k = 0; k < 4; k++) for (let col = 0; col < 3; col++) {
        const i = k * 9 + col * 3, x = slot.grp[i], z = slot.grp[i + 2];
        slot.grp[i] = c * x + s * z; slot.grp[i + 2] = -s * x + c * z;
      }
    };
    const targetMode = { id: 18, params: {}, update(slot) {
      slot.grp.fill(0);
      for (let k = 0; k < 4; k++) { slot.grp[k * 9] = 1; slot.grp[k * 9 + 4] = 1; slot.grp[k * 9 + 8] = 1; }
      slot.gbri.fill(options.flowBrightness);
      slot.prm.set([options.flowBlocks, 0, 0, 0]); slot.prm2.fill(0);
    }};
    engine.setPairDirect(sourceMode, source, targetMode, target);
    const stagger = Math.max(0, ...ranks) * options.itemStagger;
    this.releaseDuration = options.release + stagger;
    this.duration = this.releaseDuration + options.morph;
    engine.spread = this.releaseDuration / this.duration;
    engine.easeIndex = 0; engine.scatter = options.scatter; engine.rotExtra = 0;
    engine.pathMode = { tangent: 0, arc: 1, vortex: 2, turbulent: 3 }[options.motion];
    engine.pathAmp = options.pathAmount; engine.swirl = 0;
    for (let i = 0; i < N; i++) {
      const product = Math.round(target.aux[i]), record = records[product];
      const screenY = (1 - target.pos[i * 3 + 1] / halfH) * height / 2 - record.rect.y;
      const row = clamp01((screenY - record.inkTop) / Math.max(1, record.inkBottom - record.inkTop));
      const jittered = clamp01(row * .96 + .04 * ((i * .7548776662) % 1));
      engine.aKey.array[i] = (ranks[product] * options.itemStagger + timing.timeAt(jittered) * options.release) / this.releaseDuration;
      engine.aAux.array[i * 2 + 1] = 0;
    }
    engine.aKey.needsUpdate = true; engine.aAux.needsUpdate = true;
    const u = engine.material.uniforms;
    u.uPhotoB.value = 0;
    u.uPhotoFlip.value = 0;
    u.uBaseSize.value = this.project.scene.baseSize;
    u.uGain.value = this.project.scene.gain;
    u.uSampleRosterB.value = 1;
    u.uGatherStart.value = clamp01(1 - options.gatherTime / options.morph);
    u.uFlightSize.value = options.flowFlightSize;
    u.uGatherRadius.value = options.flowGatherRows * options.cellWidth * options.cellAspect * 2 * halfH / height;
    // Keep target ink measured in glyph cells when the page or export grows.
    u.uTargetPointScale.value = this.referenceProjection / u.uProjScale.value;
    u.uBlockMapB.value = 1;
    const c = terminal.cellify.mat.uniforms;
    c.uBlockLo.value = options.flowThreshold;
    c.uBlockHi.value = options.flowThreshold + .3;
    this.glyph = { gapX: 0, gapY: options.flowRowGap, gapFill: options.flowGapFill,
      dotRadius: options.dotSize / 2 };
  }

  render(time, sourceTime, pose) {
    this.pose = pose;
    this.engine.renderState(sourceTime + time, clamp01(time / this.duration));
    return this.readGlyphs();
  }
}
