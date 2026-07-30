// The 3D export.
//
// A braille/block visual is already a grid of discrete marks, so the honest
// solid is a relief: every mark that prints becomes a raised solid on a flat
// tile. Blocks extrude as boxes — quadrant by quadrant, exactly the shapes the
// SVG writes as <rect> — and dots as short prisms, which read round at any
// size an eight-sided section can be printed at.
//
// It reads the SAME cell list as the SVG export (rasterToGlyphs), so the PNG,
// the SVG and the mesh are three renderings of one picture rather than three
// approximations of it.
//
// Output is binary STL or OBJ. Both are plain-text-or-bytes formats any tool
// opens, and neither needs a dependency: a GLB writer would mean vendoring a
// glTF exporter to say the same thing.

import { rasterToGlyphs } from "./exportStill.js";

/** The tile is this wide in object units. Millimetres if you print it. */
const TILE_W = 100;

/** Sides on a dot's prism. Eight reads as round from any angle a relief is
    looked at, and costs 28 triangles against a cylinder's hundreds. */
const DOT_SIDES = 8;

/** A triangle sink that can spill to either format. */
function meshBuilder() {
  const tris = [];   // flat [ax,ay,az, bx,by,bz, cx,cy,cz] per triangle

  const tri = (a, b, c) => tris.push(
    a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);

  /** Axis-aligned box. Wound counter-clockwise seen from outside. */
  const box = (x0, y0, z0, x1, y1, z1) => {
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const quad = (a, b, c, d) => { tri(v[a], v[b], v[c]); tri(v[a], v[c], v[d]); };
    quad(0, 3, 2, 1);   // back  (-z)
    quad(4, 5, 6, 7);   // front (+z)
    quad(0, 1, 5, 4);   // bottom
    quad(2, 3, 7, 6);   // top
    quad(0, 4, 7, 3);   // left
    quad(1, 2, 6, 5);   // right
  };

  /** Regular prism about (cx, cy), radius r, from z0 to z1. */
  const prism = (cx, cy, r, z0, z1, sides = DOT_SIDES) => {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    for (let i = 0; i < sides; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % sides];
      tri([x0, y0, z0], [x1, y1, z0], [x1, y1, z1]);
      tri([x0, y0, z0], [x1, y1, z1], [x0, y0, z1]);
    }
    for (let i = 1; i < sides - 1; i++) {       // caps, as fans
      tri([ring[0][0], ring[0][1], z1], [ring[i][0], ring[i][1], z1],
        [ring[i + 1][0], ring[i + 1][1], z1]);
      tri([ring[0][0], ring[0][1], z0], [ring[i + 1][0], ring[i + 1][1], z0],
        [ring[i][0], ring[i][1], z0]);
    }
  };

  return { tris, box, prism, count: () => tris.length / 9 };
}

/**
 * Build the relief.
 *
 * opts: { renderer, terminal, scene, comp, depth, base, baseDepth }
 *   depth      how far a mark stands off the tile, in object units
 *   base       include the flat backing tile (off = marks only, floating)
 *   baseDepth  thickness of that tile
 */
export function buildRelief({ renderer, terminal, scene: scn, comp,
  depth = 2, base = true, baseDepth = 1.2 }) {
  const { cols, rows, cells } = rasterToGlyphs(renderer, terminal, scn);
  const m = meshBuilder();

  const unit = TILE_W / comp.width;             // comp px -> object units
  const W = comp.width * unit;
  const H = comp.height * unit;
  const cw = W / cols, ch = H / rows;
  const gx = scn.gapX || 0, gy = scn.gapY || 0;
  const spanX = 1 - 2 * gx, spanY = 1 - 2 * gy;
  const rDot = scn.dotR * 0.5 * Math.min(cw * spanX * 0.5, ch * spanY * 0.25);

  const z0 = base ? baseDepth : 0;
  const z1 = z0 + depth;

  if (base) m.box(0, 0, 0, W, H, baseDepth);

  for (const c of cells) {
    // rasterToGlyphs reports rows top-down like the SVG; 3D is y-up, so the
    // row index counts from the top and the tile is measured from the bottom
    const x0 = c.col * cw;
    const yTop = H - c.row * ch;

    if (c.kind === "block") {
      const bx = x0 + gx * cw;
      const by = yTop - ch + gy * ch;
      const bw = cw * spanX, bh = ch * spanY;
      if (c.qbits === 15) {
        m.box(bx, by, z0, bx + bw, by + bh, z1);
      } else {
        for (let q = 0; q < 4; q++) {
          if (!((c.qbits >> q) & 1)) continue;
          const sx = q & 1, syUp = q >> 1;      // bit order: BL BR TL TR, y-up
          m.box(bx + sx * bw / 2, by + syUp * bh / 2, z0,
            bx + (sx + 1) * bw / 2, by + (syUp + 1) * bh / 2, z1);
        }
      }
    } else {
      for (let bit = 0; bit < 8; bit++) {
        if (!((c.bits >> bit) & 1)) continue;
        const sx = bit % 2, sy = bit >> 1;      // sy 0 = bottom of the ink box
        const cx = x0 + (gx + spanX * (sx + 0.5) / 2) * cw;
        const cy = yTop - ch + (gy + spanY * (sy + 0.5) / 4) * ch;
        m.prism(cx, cy, rDot, z0, z1);
      }
    }
  }

  return { tris: m.tris, triangles: m.count(), size: { x: W, y: H, z: z1 } };
}

function normalOf(t, i) {
  const ax = t[i], ay = t[i + 1], az = t[i + 2];
  const ux = t[i + 3] - ax, uy = t[i + 4] - ay, uz = t[i + 5] - az;
  const vx = t[i + 6] - ax, vy = t[i + 7] - ay, vz = t[i + 8] - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Binary STL. 80-byte header, triangle count, then 50 bytes per triangle. */
export function toSTL(relief, title = "TEMPO relief") {
  const n = relief.triangles;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = new Uint8Array(buf, 0, 80);
  // "TEMPO " first so the file identifies itself in a hex dump or a viewer
  const text = new TextEncoder().encode(`TEMPO ${title}`.slice(0, 79));
  head.set(text);
  dv.setUint32(80, n, true);

  const t = relief.tris;
  let o = 84;
  for (let i = 0; i < t.length; i += 9) {
    const [nx, ny, nz] = normalOf(t, i);
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, t[i + k], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return new Blob([buf], { type: "model/stl" });
}

/** Wavefront OBJ. Vertices are shared within a triangle run, not globally —
    welding across the whole mesh would cost a hash of every position for a
    file that every tool re-welds on import anyway. */
export function toOBJ(relief, title = "TEMPO relief") {
  const t = relief.tris;
  const out = [`# ${title}`, `# ${relief.triangles} triangles`, "o tempo_relief"];
  const f = (n) => (Math.round(n * 1000) / 1000);
  for (let i = 0; i < t.length; i += 3) {
    out.push(`v ${f(t[i])} ${f(t[i + 1])} ${f(t[i + 2])}`);
  }
  for (let i = 0; i < relief.triangles; i++) {
    const a = i * 3 + 1;
    out.push(`f ${a} ${a + 1} ${a + 2}`);
  }
  return new Blob([out.join("\n") + "\n"], { type: "model/obj" });
}

export const MESH_FORMATS = [
  { value: "stl", label: "STL", ext: "stl" },
  { value: "obj", label: "OBJ", ext: "obj" },
];

/** One call from the UI: geometry in, downloadable blob out. */
export function exportMesh(opts, format = "stl") {
  const relief = buildRelief(opts);
  const blob = format === "obj" ? toOBJ(relief) : toSTL(relief);
  return { blob, relief };
}
