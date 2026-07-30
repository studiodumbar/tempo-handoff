// Still exports for the Visual mode.
//
// PNG — re-render the comp at exact pixel size (× scale), read the canvas.
// SVG — a TRUE vector export: the braille sub-pixel buffer is read back and
//       the cellify + glyph passes are replayed in JS (same Bayer, same
//       thresholds, same ink-box gaps), emitting one <rect> per block and
//       one <circle> per dot. What the raster shows is what the vector says.

import * as THREE from "three";

// byte-readback packing. R (dot energy) rarely exceeds 4; G (authored block
// energy) is a RAW additive sum over stacked hot particles and reaches 10+,
// so it gets far more headroom — clamping it at 4 used to land crest cells
// exactly ON blockLo and kill every block in the replay.
const PACK = 0.25;        // R: max 4, fine precision for dot thresholds
const PACK_HOT = 0.0625;  // G: max 16, coarse but blocks only need the ramp

const COPY_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  void main() {
    vec2 v = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0).rg;
    gl_FragColor = vec4(v.r * ${PACK}, v.g * ${PACK_HOT}, 0.0, 1.0);
  }
`;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)] / 16;

let copyQuad = null;
function ensureCopy() {
  if (copyQuad) return copyQuad;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: COPY_FRAG,
    uniforms: { tSrc: { value: null } },
    depthTest: false, depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  copyQuad = { scene, cam, mat };
  return copyQuad;
}

/** Read the terminal's braille sub-pixel buffer (post-phosphor source). */
function readSubpixels(renderer, terminal) {
  const W = terminal.cols * 2, H = terminal.rows * 4;
  const rt = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const q = ensureCopy();
  q.mat.uniforms.tSrc.value = terminal.cellify.mat.uniforms.tScene.value;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(q.scene, q.cam);
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(prev);
  rt.dispose();
  const v = new Float32Array(W * H);
  const hot = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    v[i] = (px[4 * i] / 255) / PACK;
    hot[i] = (px[4 * i + 1] / 255) / PACK_HOT;
  }
  return { v, hot, W, H };
}

/**
 * The glyph pass, replayed in JS over the read-back sub-pixels.
 * Returns { cols, rows, cells: [{col, row(SVG y-down), kind, ...}] }.
 */
function rasterToGlyphs(renderer, terminal, scn) {
  const { v, hot, W, H } = readSubpixels(renderer, terminal);
  const cols = terminal.cols, rows = terminal.rows;
  // peak-preserving falloff dilation of the hot channel — must stay in
  // lockstep with cellify's hotSpread (edge-clamped, one-cell reach)
  const hotAt = (x, y) => hot[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  const SPREAD_W = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.hypot(dx * 0.5, dy * 0.25);
      const w = Math.pow(Math.max(0, 1 - d), 1.5);
      if (w > 0) SPREAD_W.push([dx, dy, w]);
    }
  }
  const hotB = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let g = 0;
      for (const [dx, dy, w] of SPREAD_W) {
        const gv = w * hotAt(x + dx, y + dy);
        if (gv > g) g = gv;
      }
      hotB[y * W + x] = g;
    }
  }
  const cells = [];
  for (let cy = 0; cy < rows; cy++) {          // cy: 0 = BOTTOM (GL order)
    for (let cx = 0; cx < cols; cx++) {
      let bits = 0, lum = 0, hotSum = 0, hotMx = 0;
      const qs = [0, 0, 0, 0];                 // 2x2 quadrant energy
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = cx * 2 + dx, sy = cy * 4 + dy;
          const idx = sy * W + sx;
          const val = v[idx], hv = hotB[idx];
          lum += val;
          hotSum += hv;
          if (hv > hotMx) hotMx = hv;
          qs[(dy >> 1) * 2 + dx] += hv;
          if (val > scn.dotThresh + scn.dither * bayer(sx, sy)) bits |= 1 << (dy * 2 + dx);
        }
      }
      lum *= 0.125;
      // blocks replay from the AUTHORED channel, matching the glyph pass
      const eff = Math.max(hotSum * 0.125, hotMx * 0.5);
      let qbits = 0;
      for (let q = 0; q < 4; q++) if (qs[q] * 0.5 > scn.blockLo) qbits |= 1 << q;
      if (hotSum * 0.125 >= scn.blockHi) qbits = 15;   // average only — see cellify
      // ink tint — shade + quantized levels, flicker skipped (frame noise)
      let tint = 1 * (1 - scn.shade) + (0.8 + 0.45 * Math.min(Math.max(lum, 0), 1.2)) * scn.shade;
      if (scn.inkLevels > 0.5) {
        tint = Math.min(Math.max(tint, 0), 1.25);
        tint = (Math.floor(tint * scn.inkLevels) + 0.5) / scn.inkLevels * 1.25;
      }
      const opacity = Math.min(1, tint);
      if (scn.blocks && qbits) {
        cells.push({ kind: "block", col: cx, row: rows - 1 - cy, qbits, opacity });
      } else if (bits) {
        cells.push({ kind: "dots", col: cx, row: rows - 1 - cy, bits, opacity });
      }
    }
  }
  return { cols, rows, cells };
}

/** Compose the SVG document string. */
export function exportSVG({ renderer, terminal, scene: scn, comp, transparent }) {
  const { cols, rows, cells } = rasterToGlyphs(renderer, terminal, scn);
  const cw = comp.width / cols, ch = comp.height / rows;
  const gx = scn.gapX || 0, gy = scn.gapY || 0;
  const spanX = 1 - 2 * gx, spanY = 1 - 2 * gy;
  const rDot = scn.dotR * 0.5 * Math.min(cw * spanX * 0.5, ch * spanY * 0.25);
  const ink = scn.ink;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${comp.width}" height="${comp.height}" viewBox="0 0 ${comp.width} ${comp.height}">`);
  if (!transparent) parts.push(`<rect width="100%" height="100%" fill="${scn.bg}"/>`);
  const fmt = (n) => Math.round(n * 100) / 100;

  for (const c of cells) {
    const x0 = c.col * cw, yTop = c.row * ch;   // SVG y-down cell origin
    const op = c.opacity < 0.995 ? ` fill-opacity="${fmt(c.opacity)}"` : "";
    if (c.kind === "block") {
      // quadrant mosaic: the ink box splits 2x2; solid cells emit one rect,
      // partial cells one per lit quadrant (bit order: BL BR TL TR, y-up)
      if (c.qbits === 15) {
        parts.push(`<rect x="${fmt(x0 + gx * cw)}" y="${fmt(yTop + gy * ch)}" width="${fmt(cw * spanX)}" height="${fmt(ch * spanY)}" fill="${ink}"${op}/>`);
      } else {
        for (let q = 0; q < 4; q++) {
          if (!((c.qbits >> q) & 1)) continue;
          const sx = q & 1, syUp = q >> 1;     // syUp: 0 = bottom half
          const qx = x0 + gx * cw + sx * (cw * spanX) / 2;
          const qy = yTop + gy * ch + (syUp ? 0 : (ch * spanY) / 2);
          parts.push(`<rect x="${fmt(qx)}" y="${fmt(qy)}" width="${fmt((cw * spanX) / 2)}" height="${fmt((ch * spanY) / 2)}" fill="${ink}"${op}/>`);
        }
      }
    } else {
      for (let bit = 0; bit < 8; bit++) {
        if (!((c.bits >> bit) & 1)) continue;
        const sx = bit % 2, sy = bit >> 1;      // sy: 0 = bottom of the box
        const cxp = x0 + (gx + spanX * (sx + 0.5) / 2) * cw;
        const cyp = yTop + ch - (gy + spanY * (sy + 0.5) / 4) * ch;
        parts.push(`<circle cx="${fmt(cxp)}" cy="${fmt(cyp)}" r="${fmt(rDot)}" fill="${ink}"${op}/>`);
      }
    }
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

/** Download helper. */
export function download(blob, filename) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
