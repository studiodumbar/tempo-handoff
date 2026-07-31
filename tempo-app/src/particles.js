// The particle engine — ONE pool of particles shared by every mode AND every
// asset. One pool, shared: a procedural animation and a sampled model
// are the same thing here, a target layout for the pool. So "sphere becomes
// hoodie" is not a special case — it is the ordinary transition.
//
// Slot A holds the layout we are leaving, slot B the one we are flying to.
// Each particle carries a position + normal + aux + brightness for both slots
// and a stagger key; the vertex shader animates both layouts (rigid motion via
// group matrices, fields via a small per-mode switch, surface lighting for
// assets) and mixes them with a strongly eased, per-particle-staggered
// progress. No cross-fades, no cuts — the marks of one state physically travel
// to their places in the next.
//
// Matching is rank-order: every generated layout is sorted into the same
// scanline order (y desc, then x), so rank i of the old layout flies to rank i
// of the new one — top edges map to top edges, left to left. Coherent, cheap,
// and it scales to any pair of layouts, procedural or sampled off a mesh.

import * as THREE from "three";
import { MODES, paramValues } from "./modes.js";
import { EASE_FNS } from "./easing.js";

export const ASSET_MODE_ID = 9;

const VERT = /* glsl */ `
  attribute vec3 aPosB;
  attribute vec3 aNrmA;    // surface normal for slot A (zero for procedural)
  attribute vec3 aNrmB;    // surface normal for slot B
  attribute vec2 aAux;     // aux for slot A / slot B
  attribute vec2 aBri;     // brightness for slot A / slot B
  attribute float aKey;    // stagger key (0 first, 1 last)
  attribute float aSeed;

  uniform float uTime;
  uniform float uProg;     // transition progress 0..1 (linear; eased per-particle)
  uniform float uSpread;   // 0 = all together, ->1 = strictly sequential
  uniform int   uEase;
  uniform float uScatter;  // mid-flight scatter flourish (world units)
  uniform float uSwirl;    // mid-flight coherent swirl about Y (radians at peak)
  uniform int   uPath;     // flight path: 0 linear, 1 arc, 2 vortex, 3 turbulent
  uniform float uPathAmp;  // how far the path bends (0 = straight)
  uniform float uRotExtra; // the whip: extra Y rotation this frame (rad)
  uniform int   uModeA, uModeB;
  uniform mat3  uGrpA[4], uGrpB[4];
  uniform vec4  uGBriA, uGBriB;
  uniform vec4  uPrmA, uPrmB;
  uniform vec4  uPrm2A, uPrm2B;
  uniform float uBaseSize, uProjScale, uMinPt, uMaxPt;
  uniform vec2  uSnapGrid;              // terminal grid lock: sub-cell columns
                                        // and rows to snap to (0 = free)
  uniform sampler2D tDepthA, tDepthB;   // asset view-depth maps (occlusion.js)
  uniform float uOccA, uOccB;           // occlusion strength per slot
  uniform float uOccBias;               // world-units slack before a dot hides
  uniform float uFade;                  // global dissolve: dots wink out one by
                                        // one in seed order
  uniform float uPhotoFlip;             // 1: the photo clip is the A side (exit)
  uniform float uPhotoB;                // slot B is a photographed image at
                                        // this visibility: a dot hides as it
                                        // ARRIVES (e), so under a mosaic each
                                        // tile's dots vanish exactly when the
                                        // photo tile prints over them — no
                                        // stipple halo rings the picture

  varying float vBri;
  varying float vHot;

  float easeSel(float x) {
    x = clamp(x, 0.0, 1.0);
    if (uEase == 4) return x <= 0.0 ? 0.0 : 1.0;   // print: pop, no glide
    if (uEase == 5) return step(0.5, x);           // vanish: cut mid-window
    if (uEase == 0) {                       // expoInOut
      if (x <= 0.0) return 0.0;
      if (x >= 1.0) return 1.0;
      return x < 0.5 ? 0.5 * pow(2.0, 20.0 * x - 10.0)
                     : 1.0 - 0.5 * pow(2.0, -20.0 * x + 10.0);
    } else if (uEase == 1) {                // expoOut
      return x >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * x);
    } else if (uEase == 2) {                // backOut
      float c1 = 1.70158; float c3 = c1 + 1.0; float t = x - 1.0;
      return 1.0 + c3 * t * t * t + c1 * t * t;
    }
    if (x <= 0.0) return 0.0;               // elasticOut
    if (x >= 1.0) return 1.0;
    float p = 0.34;
    return pow(2.0, -10.0 * x) * sin((x - p / 4.0) * 6.2831853 / p) + 1.0;
  }

  // scenes.py's quadInOut — the wave shaper scene 10 inherits. Plain
  // quadratic, not a bezier, so the wave matches the source exactly.
  float quadInOut10(float x) {
    return x < 0.5 ? 2.0 * x * x : 1.0 - pow(-2.0 * x + 2.0, 2.0) / 2.0;
  }

  // Scene 10's own perspective: the source projects the helix BY HAND rather
  // than through a camera — f = focal / (focal + z), nearer points larger —
  // and then draws in 2D. Reproducing the divide here (and landing everything
  // on z = 0) is what makes the projection match 1:1. Returns (x, y, f).
  vec3 spiral10(float k, float n, float angStep, float rot,
                float radius, float vext, float focal) {
    float frac = k / max(n - 1.0, 1.0);
    float ang = k * angStep + rot;
    float z3 = radius * sin(ang);
    float f = focal / (focal + z3);
    // the source's canvas runs y DOWN; ours runs y up, hence the negation
    return vec3(radius * cos(ang) * f, -(frac - 0.5) * vext * f, f);
  }

  // The house gesture, in-shader: ease-in-out-expo.
  float expoIO(float x) {
    x = clamp(x, 0.0, 1.0);
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    return x < 0.5 ? 0.5 * exp2(20.0 * x - 10.0)
                   : 1.0 - 0.5 * exp2(10.0 - 20.0 * x);
  }

  // The solved window stagger (seamStag/stagW, GPU side): element at order
  // o (0..1) runs its expo window of width w so the last lands exactly at
  // phase end.
  float stag37(float p, float o, float w) {
    return expoIO(clamp((p - o * (1.0 - w)) / w, 0.0, 1.0));
  }

  // Evaluate one slot: rigid group transform + the mode's non-rigid field.
  // modeId: 0 generic  1 table-scan  2 pole-pulse  ...  9 lit asset surface
  // hotOut: how deliberately this mode is SPOTLIGHTING the particle right
  // now (a crest, a band, a printing head). Block glyphs render only from
  // hot-weighted energy — crowding alone can never bloom a block.
  vec3 evalSlot(int modeId, vec3 p0, vec3 nrm, float aux, float briIn,
                mat3 g0, mat3 g1, mat3 g2, mat3 g3,
                vec4 gbri, vec4 prm, vec4 prm2,
                out float briOut, out float hotOut) {
    int gi = int(clamp(floor(aux), 0.0, 3.0));
    float b = briIn * (gi == 0 ? gbri.x : gi == 1 ? gbri.y : gi == 2 ? gbri.z : gbri.w);
    vec3 p = p0;
    float hot = 0.0;

    if (modeId == 2) {                      // pole pulse: band by |latitude|
      float ny = clamp(abs(p0.y) / max(length(p0), 1e-5), 0.0, 1.0);
      float d = acos(ny) - prm.x;           // distance from the travelling band
      float band = exp(-d * d * prm.z);
      float eq = acos(ny) - 1.5707963;      // convergence flash at the equator
      float conv = exp(-eq * eq * prm.z);
      b = b * 0.55 + prm.y * band + prm.w * conv;
      hot = clamp(band + conv, 0.0, 1.0);
      p *= 1.0 + prm2.x * band;
    } else if (modeId == 1) {               // table: a scan bar crossing
      float dx = p0.x - prm.x;
      float bar = exp(-dx * dx * prm.y);
      b *= prm.w + prm.z * bar;
      hot = bar;
    } else if (modeId == 5) {               // stack: columns tally up & down
      float col = floor(aux);                // aux packs column + height here,
      gi = 0;                                // NOT a group id — force group 0
      float hf = fract(aux) / 0.9;
      float h = prm.z + prm.w * sin(prm.x + col * prm.y);
      b *= 1.0 - smoothstep(h - 0.02, h + 0.02, hf);
    } else if (modeId == 3) {               // matrix rain: falling block trails
      float col = floor(aux);                // aux packs column + row fraction
      gi = 0;
      float rf = fract(aux) / 0.9;
      float h1 = fract(sin(col * 12.9898) * 43758.5453);
      float h2 = fract(sin(col * 78.2330) * 24634.6300);
      float h3 = fract(sin(col * 39.4250) * 11369.7000);
      float speed = prm.x * (0.55 + 0.9 * h1);
      float len = prm.y * (0.6 + 0.8 * h2);
      float head = fract(uTime * speed + h3);
      float d = fract(head - rf);
      float inten = d < len ? 1.0 - d / len : 0.0;
      b *= inten * inten * prm.z;
    } else if (modeId == 4) {               // sonar: a ping band pole -> pole
      float lenp = max(length(p0), 1e-5);
      float th = acos(clamp(p0.y / lenp, -1.0, 1.0));
      float d = th - prm.x;
      float band = exp(-d * d * prm.z);
      b *= prm.w + prm.y * band;            // multiplicative: wire brightens a
      hot = band;
      p *= 1.0 + prm2.x * band;             // little, vertices BLOOM to blocks
    } else if (modeId == 6) {               // helix: a wave along the strand
      float w = pow(0.5 + 0.5 * sin(aux * prm.x - prm.y), prm.z);
      b *= prm.w + w * prm2.x;
      // prm2.y = block license: crest bloom is opt-in per mode, because a
      // dot-line's crowding would otherwise sum to blocks wherever geometry
      // stacks (spark's rays cross at the centre AND in projection)
      hot = w * prm2.y;
    } else if (modeId == 7) {               // scribes: rules ink themselves in
      float rule = floor(aux);               // aux packs rule + along-fraction
      gi = 0;
      float sf = fract(aux) / 0.9;
      float t0 = 0.03 + prm.y * rule / 12.0;
      float e = clamp((prm.x - t0) / prm.z, 0.0, 1.0);
      float head = e * e * (3.0 - 2.0 * e);
      float tl = clamp((prm.x - prm.w - 0.02 * rule / 12.0) / prm2.x, 0.0, 1.0);
      tl = tl * tl * (3.0 - 2.0 * tl);
      float vis = step(sf, head) * step(tl, sf);
      float glow = (e > 0.001 && e < 0.999) ? exp(-abs(sf - head) * prm2.z) : 0.0;
      b = b * vis + glow * prm2.y;
    } else if (modeId == 8) {               // storm: dots fly in on a diagonal
      float e = clamp(prm.x * 2.4 - aux * 1.02, 0.0, 1.0);
      e = e * e * (3.0 - 2.0 * e);
      float blow = clamp((prm.x - 0.82 - aux * 0.10) / 0.12, 0.0, 1.0);
      p += vec3(-prm.y * (1.0 - e) + prm.z * blow,
                prm.y * 0.7 * (1.0 - e) + prm.z * 0.5 * blow, 0.0);
      b *= mix(prm.w, 1.0, step(0.999, e)) * (1.0 - blow);
    } else if (modeId == 10) {              // wall: a grid of rotating needles
      // p0.xy = grid site, p0.z = position along the needle [-1, 1]
      float th = prm.x - (prm.y * p0.x + prm.z * p0.y);
      vec2 dir = vec2(cos(th), sin(th));
      float L = prm2.x * (1.0 - prm2.y + prm2.y * dir.x);
      p = vec3(p0.xy + dir * (p0.z * L), 0.0);
      float cr = max(dir.x, 0.0);
      b *= prm2.z + prm2.w * cr * cr * cr;  // the crest blooms to blocks
    } else if (modeId == 11) {              // lissa: the phase-rolling table
      float cell = floor(aux);              // aux packs cell + along-fraction
      gi = 0;
      float cx = (floor(cell / 5.0) - 1.0) * prm2.x;
      // (x - cx, z) is the curve's phase plane: rolling delta = rotating it
      vec2 q = vec2(p0.x - cx, p0.z);
      float cd = cos(prm.x), sd = sin(prm.x);
      p = vec3(cx + q.x * cd + q.y * sd, p0.y, (q.y * cd - q.x * sd) * prm2.y);
      float sf = fract(aux) / 0.9;
      float w = pow(0.5 + 0.5 * cos(6.2831853 * (sf - prm.y)), prm.z);
      b *= prm.w + prm2.w * w;              // a head glow laps the figure
    } else if (modeId == 12) {              // ripple: two-source interference
      float d1 = distance(p0.xy, vec2(prm.x, prm.y));
      float d2 = distance(p0.xy, vec2(prm.x, -prm.y));
      float a = 0.5 * (sin(prm.z - prm.w * d1) + sin(prm.z - prm.w * d2));
      float crest = pow(max(a, 0.0), prm2.z);
      b *= prm2.x + prm2.y * crest;
      hot = clamp(crest, 0.0, 1.0);
      p.z += a * prm2.w;                    // gentle relief on the crests
    } else if (modeId == 13) {              // moire: coincidence beat pattern
      if (aux >= 0.5) {                     // the twisting copy (group 1) only
        vec3 rp = g1 * p0;                  // shows where it lands on the still
        vec2 w2 = mod(rp.xy + 0.5 * prm.x, prm.x) - 0.5 * prm.x;
        float near = 1.0 - length(w2) / (0.5 * prm.x);
        float m = smoothstep(prm.y, prm.y + 0.22, near);
        b *= prm.z + prm.w * m * max(near, 0.0);
      }
    } else if (modeId == 14) {              // munch: XOR sawtooth pops
      gi = 0;                               // aux is the cell's XOR value 0..15
      float age = fract(prm.x - aux / 16.0);
      b *= prm.z + prm.w * pow(1.0 - age, prm.y);
    } else if (modeId == 16) {              // globe: dashed rings reveal from
      gi = 0;                               // the poles — aux is the reveal key
      vec3 pr16 = g0 * p0;                  // depth: the far hemisphere recedes
      float e16 = smoothstep(aux, aux + prm.y, prm.x);
      float head = exp(-abs(prm.x - aux) * prm.z) * prm.w
                 * (1.0 - smoothstep(0.92, 1.0, prm.x));
      b = (b * e16 + head * 0.3) * mix(0.28, 1.0, smoothstep(-0.9, 0.5, pr16.z));
      hot = clamp(head, 0.0, 1.0);
    } else if (modeId == 21) {              // spiral trail: one comet on an
      // invisible Archimedean spiral — aux packs 0.9 * trail fraction
      float sf21 = fract(aux) / 0.9;
      float th21 = mix(prm.y, prm.x, sf21);  // t0 .. phi, constant window
      float r21 = prm.z + prm.w * th21;
      p = vec3(cos(th21) * r21, sin(th21) * r21, 0.0);
      float vis21 = step(0.0, th21) * step(th21, prm2.x);
      b *= vis21;
      hot = smoothstep(0.93, 1.0, sf21) * vis21;
    } else if (modeId == 22) {              // path chips: a train of block
      gi = 0;                                // seeds gliding along a dot line —
      // aux packs line + 0.9*along; prm = [phase, chipHalf, halo, rest];
      // prm2 = [count, stagger, ramp, boost]. Each 1/count slot carries one
      // chip; ramp > 0 swells chips mid-line and tapers them at the ends.
      float ln22 = floor(aux);
      float f22 = fract(aux) / 0.9;
      float K22 = max(prm2.x, 1.0);
      float ph22 = prm.x + ln22 * prm2.y;
      float x22 = f22 * K22 - ph22;
      float sl22 = floor(x22);
      float xf22 = x22 - sl22;
      float fc22 = clamp((sl22 + 0.5 + ph22) / K22, 0.0, 1.0);
      float tri22 = 1.0 - abs(2.0 * fc22 - 1.0);
      float hasR = step(0.001, prm2.z);
      float m22 = mix(1.0, mix(1.0 - prm2.z, 1.0, tri22), hasR);
      float in22 = step(abs(xf22 - 0.5), prm.y * m22 * K22);
      b *= prm.w + prm2.w * in22;
      // staggered multi-line bursts cross at the origin, where every line's
      // dots stack — gate the block channel until the chip clears the knot
      hot = prm.z * in22 * mix(1.0, 0.55 + 0.45 * tri22, hasR)
                        * mix(1.0, smoothstep(0.03, 0.12, f22), step(1e-4, prm2.y));
    } else if (modeId == 26) {              // helix glide: ONE tapered streak —
      gi = 0;                               // a lens — riding the whole strand
      // aux packs family + 0.9*along: family 0 is the quiet dotted strand,
      // family 1 the ribbon that inflates into the lens, its cross-section
      // offset carried in nrm. prm = [head, span, thick, rest];
      // prm2 = [boost, halo, bulge, taper].
      float fam26 = floor(aux);
      float u26 = fract(aux) / 0.9;
      float sp26 = max(prm.y, 1e-4);
      float q26 = (u26 - (prm.x - sp26)) / sp26;   // 0 at the tail, 1 at the head
      // the taper: a point at both tips, fattest through the middle
      float w26 = sin(3.14159265 * clamp(q26, 0.0, 1.0))
                * step(0.0, q26) * step(q26, 1.0);
      w26 = pow(max(w26, 0.0), max(prm2.z, 0.05));
      // taper draws BOTH ends out to finer points without thinning the body:
      // it rides the distance from the nearer tip, so it is 1 through the
      // middle and bites hardest where the lens is already closing. 0 = off.
      float tip26 = clamp(min(q26, 1.0 - q26) * 2.0, 0.0, 1.0);
      w26 *= pow(max(tip26, 1e-4), max(prm2.w, 0.0));
      if (fam26 < 0.5) {
        b *= prm.w;                         // the strand stays a dotted line
      } else {
        p = p0 + nrm * (prm.z * w26);       // inflate this slice into the lens
        b *= prm2.x * w26;
        hot = prm2.y * w26;
      }
    } else if (modeId == 28) {              // scene 10 — pseudo-3D spiral
      gi = 0;                               // (stretch), ported 1:1
      // aux packs point index + 0.9*along-parameter; nrm = (family, cross,
      // angStep) where family 0 is the receding ribbon and 1 a stretch cell.
      // angStep (turns*TAU/(n-1)) is baked per particle because turns and
      // points are regen params — that keeps prm.w free for the halo.
      // prm  = [rot, radius, vext, halo]
      // prm2 = [cell, waveSpread, wavePhase, points]
      float n28 = max(prm2.w, 2.0);
      float i28 = floor(aux);
      float u28 = fract(aux) / 0.9;
      float focal28 = prm.y * 1.6;          // FOCAL_FRAC — scene 10's own
      vec3 Pi = spiral10(i28, n28, nrm.z, prm.x, prm.y, prm.z, focal28);
      if (nrm.x < 0.5) {                    // the receding ribbon
        vec3 Pn = spiral10(min(i28 + 1.0, n28 - 1.0), n28, nrm.z, prm.x,
                           prm.y, prm.z, focal28);
        p = vec3(mix(Pi.xy, Pn.xy, u28), 0.0);
      } else {                              // one PLACED block, on the line
        // CELL scaled by the perspective divide: near the camera the marks
        // are big, far away they shrink — that depth read is the whole point
        float cw28 = prm2.x * Pi.z;
        float np28 = quadInOut10((sin(i28 / max(prm2.y, 1e-3) - prm2.z) + 1.0) * 0.5);
        // the source's own size chain: WT 75, thickness 0.05..0.4, gain 4.5,
        // cap 0.78, floor 0.0167 — so the wave still pulses each mark
        float baseR = cw28 * 0.375;
        float finalR = max(baseR * (0.05 + np28 * 0.35), cw28 * 0.0167);
        float side = min(2.0 * finalR * 0.70710678 * 4.5, cw28 * 0.78);
        // Axis-aligned and packed SOLID, exactly as the source's block bars
        // are: every mark in the patch sits inside the square at full weight,
        // so the glyph pass prints a deliberate block. Weighting marks by area
        // (or rotating the patch to the tangent) is what made blocks emerge
        // organically out of scattered dots instead of being placed.
        p = vec3(Pi.xy + vec2(u28 * 2.0 - 1.0, nrm.y) * side * 0.5, 0.0);
        hot = prm.w;                        // uniform across the block
      }
    } else if (modeId == 29) {              // helix blocks: a dotted strand
      gi = 0;                               // with blocks PLACED along it
      // A real 3D helix, so depth is the camera's job, not a hand projection:
      // each block is a screen-facing square of fixed WORLD size, and ordinary
      // perspective makes the near ones big and the far ones small. prm2.y
      // then exaggerates that read beyond what the lens alone gives.
      // aux = 0.9 * fraction along the path; nrm = (family, patch x, patch y)
      // with family 0 the strand and 1 a block.
      // prm  = [rot, radius, height, halo]
      // prm2 = [size, depth, camZ, turns]
      float f29 = fract(aux) / 0.9;
      float a29 = f29 * prm2.w * 6.2831853 + prm.x;
      vec3 st29 = vec3(cos(a29) * prm.y,
                       prm.z * 0.5 - prm.z * f29,
                       sin(a29) * prm.y);
      if (nrm.x < 0.5) {
        p = st29;                           // the strand: a plain dotted line
      } else {
        // Blockness ARRIVES with closeness. On the far side of the turn a mark
        // is not a block at all — it collapses onto the strand and reads as
        // one more dot of the line — and as the station swings toward the
        // camera it both grows and earns its block license, until the nearest
        // stretch prints as solid slabs. c29 is 0 at the far side of the
        // helix's own depth span and 1 at the near; prm2.y sets how late the
        // blocks arrive (higher = they hold off longer, then bloom).
        float c29 = clamp(0.5 + st29.z / (2.0 * max(prm.y, 1e-4)), 0.0, 1.0);
        // prm2.z is the ONSET: nothing behind it is a block at all, it is just
        // more of the dotted line. Past it the ramp is re-based over what is
        // left, so the first block still starts from nothing and grows.
        float on29 = clamp(prm2.z, 0.0, 0.99);
        float g29 = pow(clamp((c29 - on29) / max(1.0 - on29, 1e-4), 0.0, 1.0),
                        max(prm2.y, 0.01));
        // the offset stays in world XY, which is the screen plane, so every
        // block prints as an axis-aligned square rather than a foreshortened
        // patch — the helix's own spin rides in a29, not in a group matrix
        p = st29 + vec3(nrm.y, nrm.z, 0.0) * (prm2.x * g29) * 0.5;
        // collapsed marks stack on one point, so fade them to about one
        // line-dot's worth (1/patch^2 at the default 5x5) instead of a hot spot
        b *= max(g29, 0.04);
        hot = prm.w * g29;
      }
    } else if (modeId == 32) {              // helix train: the blocks TRAVEL
      gi = 0;
      // helix blocks pins blockness to depth, so the blocks live in whichever
      // screen regions happen to be near the camera and never leave them. Here
      // a window travels along the PATH instead, and depth only shapes what is
      // already inside it — so a train of blocks runs the helix end to end and
      // swells as it comes forward. p0 is the un-spun station; the spin is
      // applied here so each block patch stays square in the screen plane.
      // nrm = (family, patch x, patch y); aux = 0.9 * fraction along the path.
      // prm  = [rot, trains*8 + span, train head, halo]
      // prm2 = [size, depth, taper*20 + train length, nose*50 + variance/2]
      //        the last two channels each double up — an exact integer plus a
      //        fraction, the same idiom aux uses — because the field is out of
      //        uniform slots and both halves are needed every frame.
      float f32 = fract(aux) / 0.9;
      float cr32 = cos(prm.x), sr32 = sin(prm.x);
      vec3 st32 = vec3(p0.x * cr32 + p0.z * sr32, p0.y,
                       -p0.x * sr32 + p0.z * cr32);
      if (nrm.x < 0.5) {
        p = st32;                           // the strand: a plain dotted line
      } else {
        // distance BEHIND the head, wrapping — so the train runs off one end
        // of the path and back on at the other without a seam
        float len32 = max(fract(prm2.z), 1e-3);
        float tap32 = max(floor(prm2.z) / 20.0, 0.05);
        float n32 = min(floor(prm2.w) / 50.0, 0.9) * len32;
        float cnt32 = max(floor(prm.y / 8.0), 1.0);
        // Several trains ride the same helix, evenly spaced and moving
        // together. Each is the same profile at its own offset and we keep the
        // STRONGEST — max, not a sum, so where two overlap the carriages stay
        // the size they should be instead of doubling up into a slab.
        float w32 = 0.0;
        for (int t32 = 0; t32 < 8; t32++) {
          if (float(t32) >= cnt32) break;
          // distance BEHIND this train's head. fract(head - f), not
          // fract(f - head): the latter puts the window AHEAD of the head,
          // leaving the weight at the rear and tapering forwards — backwards.
          float d32 = fract(prm.z - f32 - float(t32) / cnt32);
          // a point at BOTH ends: nose in over the leading stretch, reach FULL
          // weight, then taper away behind. Two segments rather than a product
          // — multiplying a lead-in into the falloff drags the peak down with
          // it and shrinks the train instead of just shaping its nose.
          float wi32;
          if (d32 < n32) {
            wi32 = smoothstep(0.0, max(n32, 1e-4), d32);
          } else {
            wi32 = pow(1.0 - smoothstep(0.0, max(len32 - n32, 1e-4), d32 - n32), tap32);
          }
          w32 = max(w32, wi32);
        }
        // depth still shapes it: the carriages swell as they come at you
        float span32 = max(prm.y - cnt32 * 8.0, 1e-4);
        float c32 = clamp(0.5 + st32.z / (2.0 * span32), 0.0, 1.0);
        float g32 = pow(c32, max(prm2.y, 0.01));
        // per-station jitter, so the train reads as carriages of different
        // weights rather than one smooth ramp
        float var32 = fract(prm2.w) * 2.0;
        float j32 = 1.0 + var32 * (fract(sin(f32 * 311.7) * 43758.5453) - 0.5) * 2.0;
        float amt32 = w32 * (0.35 + 0.65 * g32) * max(j32, 0.05);
        p = st32 + vec3(nrm.y, nrm.z, 0.0) * (prm2.x * amt32) * 0.5;
        b *= max(w32, 0.04);                // outside the train it is line again
        hot = prm.w * w32;
      }
    } else if (modeId == 35) {              // depth blocks: how big a mark is
      gi = 0;                               // IS how near it is
      // p0.xy is the station's cross-section and p0.z is unused — the field
      // places depth itself from aux (0.9 * the station's slot through the
      // run) plus the travel offset, wrapped, so the run never ends.
      // A block of fixed WORLD size already shrinks as 1/dist through the
      // lens. The boost scales the world side by (ref/dist)^boost on top of
      // that, so on screen the taper runs as 1/dist^(1+boost). ref is the
      // distance to the NEAR plane, which is the closest any station gets, so
      // the ratio can never exceed 1 — size is exactly the near-plane size
      // and no clamp is needed to stop a block swallowing the frame.
      // prm  = [travel, near z, z range, halo]
      // prm2 = [size, boost, roll, edge]
      float q35 = fract(fract(aux) / 0.9 + prm.x);
      float cr35 = cos(prm2.z), sr35 = sin(prm2.z);
      vec3 st35 = vec3(p0.x * cr35 - p0.y * sr35, p0.x * sr35 + p0.y * cr35,
                       prm.y - prm.z + q35 * prm.z);
      float d35 = max(length(cameraPosition - st35), 1e-3);
      float r35 = max(length(cameraPosition - vec3(0.0, 0.0, prm.y)), 1e-3);
      float k35 = pow(min(r35 / d35, 1.0), max(prm2.y, 0.0));   // 1 near, ->0 far
      float side35 = prm2.x * k35;
      // the wrap has to be invisible: fade in at the far plane and out again
      // as a station reaches the near one, where it is largest and would
      // otherwise vanish mid-frame at full size
      float e35 = max(prm2.w, 1e-3);
      float f35 = smoothstep(0.0, e35, q35) * (1.0 - smoothstep(1.0 - e35, 1.0, q35));
      p = st35 + vec3(nrm.y, nrm.z, 0.0) * side35 * 0.5;
      // Once a patch is under a pixel wide its marks all stack on one point,
      // so a far station would print 25x too bright (5x5 patch) and the depth
      // read would invert — the distance would look HOTTER. Fade a collapsing
      // patch to about one dot's worth, exactly as the helix/spark block
      // fields do. hot follows it too, so the near marks earn solid blocks and
      // the far ones fall back to being plain dots.
      b *= f35 * max(k35, 0.04);
      hot = prm.w * f35 * k35;
    } else if (modeId == 36) {              // star blocks: how big a block is
      gi = 0;                               // IS how near it REALLY is
      // The star's rays and stations, baked un-spun; the spin angle rides
      // prm.x so patches can stay square to the screen while the star turns.
      // nrm = (station flag, patch x, patch y); aux = 0.9 * fraction out from
      // the crossing. prm = [spin, size, boost, halo].
      float c36 = cos(prm.x), s36 = sin(prm.x);
      vec3 st36 = vec3(p0.x * c36 + p0.z * s36, p0.y,
                       -p0.x * s36 + p0.z * c36);
      if (nrm.x < 0.5) {
        p = st36;                           // the rays: plain dotted lines
      } else {
        // TRUE nearness, remeasured every frame: eye-to-station against
        // eye-to-crossing, both LIVE, so the gradient re-aims itself under
        // any spin or orbit and the crossing block is always exactly size.
        // The response is in octaves — size doubles every len/boost of
        // approach — so the dial bites the same from any camera distance;
        // the raw lens ratio r/d would flatten to nothing as the eye backs
        // off. prm2 = [len, curve, grow, floor]: curve bends WHERE along
        // the line the change concentrates (<1 fast off the crossing then
        // level, >1 hold the middle then dive/bloom at the tips), grow caps
        // the near multiple, floor props up the far one.
        float d36 = max(length(cameraPosition - st36), 1e-3);
        float r36 = max(length(cameraPosition), 1e-3);
        float u36 = clamp((r36 - d36) / max(prm2.x, 1e-3), -1.2, 1.2);
        u36 = sign(u36) * pow(abs(u36), max(prm2.y, 0.05));
        float k36 = clamp(exp2(u36 * max(prm.z, 0.0)),
                          min(prm2.w, prm2.z), prm2.z);
        // patch offsets ride the CAMERA frame, not the world — the eye
        // orbits, and a block must stay a screen square from anywhere
        vec3 rt36 = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up36 = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        p = st36 + (rt36 * nrm.y + up36 * nrm.z) * (prm.y * k36 * 0.5);
        // a collapsing far patch stacks its marks on one point — fade it to
        // a dot's worth or distance would read HOTTER (field 35's rule).
        // A GROWING patch has the opposite problem: the same marks spread
        // over more cells and the slab goes gappy, so brightness rides k a
        // touch above 1 to keep the near blocks filled.
        b *= clamp(k36, 0.05, 1.6);
        hot = prm.w * min(k36, 1.0);
      }
    } else if (modeId == 37) {              // star life: the block star as a
      gi = 0;                               // self-contained loop
      // One cycle: the rays draw OUT of the crossing (staggered per line),
      // the blocks choreograph in sequence, then everything withdraws —
      // every gesture the house expo, empty at the wrap so any spin loops
      // clean. Block size stays TRUE eye-distance octaves (field 36's rule)
      // live through all of it.
      // aux: rays pack line + 0.9*fr; stations pack 0.9*firing-order.
      // nrm = (station flag, patch x, patch y).
      // prm  = [spin, size, boost, halo]
      // prm2 = [len, clock u, pattern*100 + rays, loops + window]
      //        pattern 0 bloom-slide, 1 steps + travelling pulse, 2 relay
      float u37 = fract(prm2.y);
      float pat37 = floor(prm2.z / 100.0);
      float R37 = max(mod(prm2.z, 100.0), 1.0);
      float W37 = max(fract(prm2.w), 0.04);
      float L37 = max(floor(prm2.w), 1.0);
      float c37 = cos(prm.x), s37 = sin(prm.x);
      if (nrm.x < 0.5) {                    // a ray dot: draw out, retract
        float fr37 = fract(aux) / 0.9;
        float o37 = R37 <= 1.0 ? 0.0 : floor(aux) / (R37 - 1.0);
        float reach = min(
          stag37(clamp(u37 / 0.16, 0.0, 1.0), o37, 0.55),
          1.0 - stag37(clamp((u37 - 0.88) / 0.12, 0.0, 1.0), o37, 0.55));
        // the undrawn stretch is dark; the frontier carries a small head
        b *= (1.0 - smoothstep(reach - 0.03, reach, fr37))
           * (1.0 + 2.2 * exp(-abs(reach - fr37) * 26.0));
        p = vec3(p0.x * c37 + p0.z * s37, p0.y, -p0.x * s37 + p0.z * c37);
      } else {                              // a station dot
        float ord37 = fract(aux) / 0.9;
        float env37 = min(
          stag37(clamp((u37 - 0.15) / 0.21, 0.0, 1.0), ord37, W37),
          1.0 - stag37(clamp((u37 - 0.74) / 0.16, 0.0, 1.0), ord37, W37));
        float uC37 = clamp((u37 - 0.36) / 0.38, 0.0, 1.0);
        float scl37 = env37;
        vec3 q37 = p0;
        if (pat37 < 0.5) {                  // BLOOM: stations slide out of
          q37 = p0 * env37;                 // the crossing and back, growing
        } else if (pat37 < 1.5) {           // STEPS: parked; a pulse laps the
          // chain (circular distance, so the run wraps station 1 -> N -> 1)
          float dd37 = abs(fract(fract(uC37 * L37) - ord37 + 0.5) - 0.5);
          scl37 = env37 * (1.0 + 0.45 *
            expoIO(clamp(1.0 - dd37 / 0.12, 0.0, 1.0))
            * smoothstep(0.0, 0.06, uC37)
            * (1.0 - smoothstep(0.94, 1.0, uC37)));
        } else {                            // RELAY: ONE window bounces the
          float tri37 = 1.0 - abs(2.0 * fract(uC37 * L37) - 1.0);   // chain
          float v37 = expoIO(clamp(
            1.0 - abs(tri37 - ord37) / (0.05 + 0.30 * W37), 0.0, 1.0));
          scl37 = expoIO(clamp((u37 - 0.15) / 0.21, 0.0, 1.0))
                * (1.0 - expoIO(clamp((u37 - 0.85) / 0.15, 0.0, 1.0))) * v37;
        }
        vec3 sq37 = vec3(q37.x * c37 + q37.z * s37, q37.y,
                         -q37.x * s37 + q37.z * c37);
        // TRUE nearness on the LIVE (slid, spun) station — field 36's rule
        float d37 = max(length(cameraPosition - sq37), 1e-3);
        float r37 = max(length(cameraPosition), 1e-3);
        float w37 = clamp((r37 - d37) / max(prm2.x, 1e-3), -1.2, 1.2);
        float k37 = clamp(exp2(w37 * max(prm.z, 0.0)), 0.05, 2.5);
        vec3 rt37 = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up37 = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        p = sq37 + (rt37 * nrm.y + up37 * nrm.z)
                 * (prm.y * k37 * scl37 * 0.5);
        b *= clamp(k37, 0.05, 1.6) * (scl37 <= 0.001 ? 0.0 : pow(scl37, 0.6));
        hot = prm.w * min(k37, 1.0) * scl37;
      }
    } else if (modeId == 38) {              // star life x: the EXTREME set —
      gi = 0;                               // hard depth contrast, phases
      // that interlock instead of queueing. Field 37's packing, pushed:
      // near cap 3.6, far floor 0.04, brightness rides k to 1.9 so the big
      // slabs stay filled. Stations may pack line + 0.9*frac (per-line
      // patterns) or 0.9*chain (global patterns).
      // patterns: 0 weave (blocks born at the draw frontier), 1 rings
      // (strict centre-out slides), 2 runners (one block per line, tip to
      // tip in unison), 3 round (one baton around the star), 4 vortex
      // (the star folds flat / unfolds deep while offset runners lap it).
      float u38 = fract(prm2.y);
      float pat38 = floor(prm2.z / 100.0);
      float R38 = max(mod(prm2.z, 100.0), 1.0);
      float W38 = max(fract(prm2.w), 0.04);
      float L38 = max(floor(prm2.w), 1.0);
      float c38 = cos(prm.x), s38 = sin(prm.x);
      // the vortex fold: born nearly flat, opens PAST its baked depth
      // mid-cycle, folds home for the wrap
      float br38 = pat38 > 3.5
        ? 0.18 + 1.55 * expoIO(clamp(u38 / 0.30, 0.0, 1.0))
                      * (1.0 - expoIO(clamp((u38 - 0.72) / 0.26, 0.0, 1.0)))
        : 1.0;
      // weave draws slow (the dressing rides the frontier); the others
      // draw quick and hand off to the blocks
      float ai38 = pat38 < 0.5 ? 0.42 : 0.15;
      float ao38 = pat38 < 0.5 ? 0.42 : 0.12;
      float ln38 = floor(aux);
      float fx38 = fract(aux) / 0.9;
      float o38 = R38 <= 1.0 ? 0.0 : ln38 / (R38 - 1.0);
      float rin38 = stag37(clamp(u38 / ai38, 0.0, 1.0), o38, 0.55);
      float rout38 = 1.0 - stag37(clamp((u38 - (1.0 - ao38)) / ao38, 0.0, 1.0),
                                  o38, 0.55);
      float reach38 = min(rin38, rout38);
      if (nrm.x < 0.5) {                    // a ray dot
        b *= (1.0 - smoothstep(reach38 - 0.03, reach38, fx38))
           * (1.0 + 2.2 * exp(-abs(reach38 - fx38) * 26.0));
        vec3 rp38 = vec3(p0.x, p0.y, p0.z * br38);
        p = vec3(rp38.x * c38 + rp38.z * s38, rp38.y,
                 -rp38.x * s38 + rp38.z * c38);
      } else {                              // a station dot
        float scl38 = 0.0;
        vec3 q38 = p0;
        if (pat38 < 0.5) {                  // WEAVE: born at the frontier
          scl38 = expoIO(clamp((reach38 - fx38) / (0.04 + 0.12 * W38),
                               0.0, 1.0));
        } else if (pat38 < 1.5) {           // RINGS: strict centre-out
          scl38 = min(
            stag37(clamp((u38 - 0.14) / 0.36, 0.0, 1.0), fx38, W38),
            1.0 - stag37(clamp((u38 - 0.60) / 0.28, 0.0, 1.0), fx38, W38));
          q38 = p0 * scl38;
        } else if (pat38 < 2.5) {           // RUNNERS: all lines in unison
          float tri38 = 1.0 - abs(2.0 * fract(
            clamp((u38 - 0.18) / 0.66, 0.0, 1.0) * L38) - 1.0);
          scl38 = expoIO(clamp((u38 - 0.13) / 0.14, 0.0, 1.0))
                * (1.0 - expoIO(clamp((u38 - 0.86) / 0.12, 0.0, 1.0)))
                * expoIO(clamp(1.0 - abs(tri38 - fx38)
                               / (0.04 + 0.22 * W38), 0.0, 1.0));
        } else if (pat38 < 3.5) {           // ROUND: one baton, line to line
          float ck38 = fract(clamp((u38 - 0.16) / 0.70, 0.0, 1.0)
                             * L38 * 0.999);
          scl38 = expoIO(clamp((u38 - 0.12) / 0.12, 0.0, 1.0))
                * (1.0 - expoIO(clamp((u38 - 0.87) / 0.11, 0.0, 1.0)))
                * expoIO(clamp(1.0 - abs(ck38 - fx38)
                               / (0.03 + 0.20 * W38), 0.0, 1.0));
        } else {                            // VORTEX: offset runners lap the
          float ph38 = clamp((u38 - 0.12) / 0.80, 0.0, 1.0) * L38 + o38;
          float tri38 = 1.0 - abs(2.0 * fract(ph38) - 1.0);
          scl38 = expoIO(clamp((u38 - 0.10) / 0.14, 0.0, 1.0))
                * (1.0 - expoIO(clamp((u38 - 0.88) / 0.11, 0.0, 1.0)))
                * expoIO(clamp(1.0 - abs(tri38 - fx38)
                               / (0.05 + 0.22 * W38), 0.0, 1.0));
        }
        q38.z *= br38;
        vec3 sq38 = vec3(q38.x * c38 + q38.z * s38, q38.y,
                         -q38.x * s38 + q38.z * c38);
        float d38 = max(length(cameraPosition - sq38), 1e-3);
        float r38 = max(length(cameraPosition), 1e-3);
        float w38 = clamp((r38 - d38) / max(prm2.x, 1e-3), -1.2, 1.2);
        // the vortex keeps a higher far floor: its runners must stay
        // readable as chips at the deep end or the peak moment goes empty
        float k38 = clamp(exp2(w38 * max(prm.z, 0.0)),
                          pat38 > 3.5 ? 0.14 : 0.04, 3.6);
        vec3 rt38 = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up38 = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        p = sq38 + (rt38 * nrm.y + up38 * nrm.z)
                 * (prm.y * k38 * scl38 * 0.5);
        b *= clamp(k38, 0.05, 1.9) * (scl38 <= 0.001 ? 0.0 : pow(scl38, 0.6));
        hot = prm.w * min(k38, 1.2) * scl38;
      }
    } else if (modeId == 39) {              // star flow: endless constant-
      gi = 0;                               // glide block motion — the rays
      // stay put, the BLOCKS move; every loop is seamless at any spin.
      // prm  = [spin, size, boost, halo]
      // prm2 = [len, clock, trains*1000 + pattern*100 + rays, loops+window]
      // patterns: 0 tide (trains of chips flow out of the crossing and die
      // at the tips), 1 echo (a pulse arrives along ONE arm, flashes the
      // crossing, radiates out every arm), 2 pendulum (the whole star
      // swings through flat to INVERTED on a cosine; window = amplitude).
      float u39 = fract(prm2.y);
      float R39 = max(mod(prm2.z, 100.0), 1.0);
      float pat39 = mod(floor(prm2.z / 100.0), 100.0);
      float cnt39 = max(floor(prm2.z / 10000.0), 1.0);
      float W39 = max(fract(prm2.w), 0.04);
      float L39 = max(floor(prm2.w), 1.0);
      float c39 = cos(prm.x), s39 = sin(prm.x);
      float zs39 = pat39 > 1.5 && pat39 < 2.5
        ? (1.0 - W39) + W39 * cos(6.2831853 * u39) : 1.0;
      // the spiral sways the whole star in-plane, a sine so it loops
      float sy39 = pat39 > 2.5 && pat39 < 3.5
        ? 0.35 * sin(6.2831853 * u39) : 0.0;
      float cy39 = cos(sy39), sn39 = sin(sy39);
      if (nrm.x < 0.5) {                    // rays: parked (z swings with
        vec3 rp39 = vec3(p0.x * cy39 - p0.y * sn39,     // the pendulum,
                         p0.x * sn39 + p0.y * cy39,     // xy with the sway)
                         p0.z * zs39);
        p = vec3(rp39.x * c39 + rp39.z * s39, rp39.y,
                 -rp39.x * s39 + rp39.z * c39);
        if (pat39 > 5.5 && pat39 < 6.5) {   // canon: this line's own life
          float pl39 = fract(u39 + floor(aux) / max(R39, 1.0));
          float re39 = min(expoIO(clamp(pl39 / 0.14, 0.0, 1.0)),
                           1.0 - expoIO(clamp((pl39 - 0.86) / 0.14, 0.0, 1.0)));
          float fq39 = fract(aux) / 0.9;
          b *= (1.0 - smoothstep(re39 - 0.03, re39, fq39))
             * (1.0 + 2.2 * exp(-abs(re39 - fq39) * 26.0));
        }
        b *= pat39 > 1.5 && pat39 < 2.5 ? 1.0 : 0.85;
      } else {
        float ln39 = floor(aux);
        float fx39 = fract(aux) / 0.9;
        float scl39 = 0.0;
        if (pat39 < 0.5) {                  // TIDE: fx is radial 0..1; cnt
          // moving fronts per line, L laps a cycle, born softly off the
          // crossing, gone at the tips
          float d39 = abs(fract(fx39 * cnt39 - u39 * L39 + 0.5) - 0.5) * 2.0;
          scl39 = expoIO(clamp(1.0 - d39 / max(W39, 1e-3), 0.0, 1.0))
                * smoothstep(0.02, 0.16, fx39)
                * (1.0 - smoothstep(0.86, 0.995, fx39));
        } else if (pat39 < 1.5) {           // ECHO: fx is tip-to-tip
          float r39 = abs(fx39 - 0.5) * 2.0;
          float pw39 = 0.06 + 0.22 * W39;
          float eIn39 = 0.0;
          if (ln39 < 0.5 && fx39 > 0.5 && u39 > 0.04 && u39 < 0.46) {
            float pos39 = 1.0 - expoIO(clamp((u39 - 0.04) / 0.38, 0.0, 1.0));
            eIn39 = expoIO(clamp(1.0 - abs(r39 - pos39) / pw39, 0.0, 1.0));
          }
          float eOut39 = 0.0;
          if (u39 > 0.44) {
            float ro39 = expoIO(clamp((u39 - 0.44) / 0.44, 0.0, 1.0));
            eOut39 = expoIO(clamp(1.0 - abs(r39 - ro39) / pw39, 0.0, 1.0))
                   * (1.0 - smoothstep(0.90, 0.995, ro39));
          }
          float fl39 = exp(-abs(u39 - 0.44) * 30.0)
                     * (1.0 - smoothstep(0.0, 0.35, r39));
          scl39 = max(max(eIn39, eOut39), min(fl39 * 1.2, 1.0));
        } else if (pat39 < 2.5) {           // PENDULUM: parked through the
          scl39 = 1.0;                      // swing — depth does the work
        } else if (pat39 < 3.5) {           // SPIRAL: the tide, phase-offset
          // per line so the outward flow corkscrews around the star
          float ph39 = fx39 * cnt39 - u39 * L39 + ln39 / max(R39, 1.0);
          float d39 = abs(fract(ph39 + 0.5) - 0.5) * 2.0;
          scl39 = expoIO(clamp(1.0 - d39 / max(W39, 1e-3), 0.0, 1.0))
                * smoothstep(0.02, 0.16, fx39)
                * (1.0 - smoothstep(0.86, 0.995, fx39));
        } else if (pat39 < 4.5) {           // COMET: a sharp head bouncing
          // tip to tip, a long wake decaying behind its travel
          float tp39 = fract(u39 * L39);
          float tri39 = 1.0 - abs(2.0 * tp39 - 1.0);
          float dir39 = tp39 < 0.5 ? 1.0 : -1.0;
          float dd39 = (fx39 - tri39) * dir39;
          float head39 = expoIO(clamp(1.0 - abs(dd39) / 0.05, 0.0, 1.0));
          float tail39 = dd39 < 0.0
            ? exp(dd39 / (0.06 + 0.25 * W39)) * 0.7 : 0.0;
          scl39 = max(head39, tail39);
        } else if (pat39 < 5.5) {           // GATHER: the tide reversed —
          // born at the tips, absorbed at the crossing, which swallows
          // with a pulse as each front lands
          float d39 = abs(fract(fx39 * cnt39 + u39 * L39 + 0.5) - 0.5) * 2.0;
          scl39 = expoIO(clamp(1.0 - d39 / max(W39, 1e-3), 0.0, 1.0))
                * smoothstep(0.02, 0.10, fx39)
                * (1.0 - smoothstep(0.90, 0.995, fx39));
          float sw39 = exp(-fract(u39 * L39) * 5.0);
          scl39 = max(scl39, sw39 * (1.0 - smoothstep(0.0, 0.12, fx39)));
        } else if (pat39 < 6.5) {           // CANON: each line lives its
          // OWN full cycle, offset line by line — somewhere a line is
          // always being born while another dies
          float pl39 = fract(u39 + ln39 / max(R39, 1.0));
          float re39 = min(expoIO(clamp(pl39 / 0.14, 0.0, 1.0)),
                           1.0 - expoIO(clamp((pl39 - 0.86) / 0.14, 0.0, 1.0)));
          scl39 = expoIO(clamp((re39 - fx39) / 0.10, 0.0, 1.0));
        } else if (pat39 < 7.5) {           // MORSE: coded dashes and dots
          // marching outward — symbol identities have period loops so
          // the wrap is seamless
          float v39 = fx39 * cnt39 - u39 * L39;
          float sid39 = mod(floor(v39), L39);
          float h39 = fract(sin((sid39 + ln39 * 7.0) * 127.1) * 43758.5453);
          float du39 = h39 < 0.55 ? 0.16 : 0.42;
          float pq39 = fract(v39);
          scl39 = pq39 < du39
            ? expoIO(clamp(min(pq39, du39 - pq39) / 0.05, 0.0, 1.0)) : 0.0;
          scl39 *= smoothstep(0.02, 0.10, fx39);
        } else if (pat39 < 8.5) {           // DRIZZLE: every station
          // twinkles on its own hash clock, loops blinks a cycle
          float h139 = fract(sin(fx39 * 917.0 + ln39 * 31.0) * 43758.5453);
          float pq39 = fract(u39 * L39 + h139);
          float wd39 = 0.10 + 0.25 * W39;
          scl39 = pq39 < wd39
            ? expoIO(clamp(min(pq39, wd39 - pq39) / (wd39 * 0.4), 0.0, 1.0))
            : 0.0;
        } else if (pat39 < 9.5) {           // HOLD: the dressed star parked
          scl39 = 1.0;                      // — spin and TRUE depth are the
        } else if (pat39 < 10.5) {          // COURIER: ONE super-eased expo
          // crossing per line — dead stop at the tip — then the comet
          // switches to the NEXT line around the star. Never retraces; its
          // wake evaporates as it lands so each crossing is a clean stroke.
          float legs39 = u39 * R39 * L39;
          float lg39 = floor(legs39);
          float legU39 = fract(legs39);
          float cur39 = mod(lg39, R39);
          if (abs(ln39 - cur39) > 0.5) {
            scl39 = 0.0;
          } else {
            float e39 = expoIO(legU39);
            float dir39 = mod(lg39, 2.0) < 0.5 ? 1.0 : -1.0;
            float pos39 = dir39 > 0.0 ? e39 : 1.0 - e39;
            float dd39 = (fx39 - pos39) * dir39;
            float hd39 = expoIO(clamp(1.0 - abs(dd39) / 0.045, 0.0, 1.0));
            float tl39 = dd39 < 0.0
              ? exp(dd39 / (0.05 + 0.22 * W39)) * 0.65
                * (1.0 - smoothstep(0.82, 0.98, legU39)) : 0.0;
            // the head is born and settled, never popped: a quick grow at
            // the launch tip, a sink at the landing one — the expo ease
            // holds it still there, so both read as pure materialise
            float born39 = expoIO(clamp(legU39 / 0.08, 0.0, 1.0));
            float gone39 = 1.0 - expoIO(clamp((legU39 - 0.94) / 0.06, 0.0, 1.0));
            scl39 = max(hd39, tl39) * born39 * gone39;
          }
        } else {                            // EMIT: one block per arm, born
          // at the crossing, riding its line outward on the house
          // ease-in-out-expo, dying at the tip; then the next emission.
          // cycle / loops = the period. The high prm2.z digit carries
          // stagger 0..99: a per-line hash desync of the emission clock —
          // 0 fires all arms in perfect unison.
          float stg39 = floor(prm2.z / 10000.0) / 99.0;
          float hl39 = fract(sin(ln39 * 127.1) * 43758.5453);
          float ep39 = fract(u39 * L39 + hl39 * stg39);
          float pos39 = expoIO(ep39);
          float hd39 = expoIO(clamp(1.0 - abs(fx39 - pos39)
                                          / (0.04 + 0.14 * W39), 0.0, 1.0));
          scl39 = hd39 * expoIO(clamp(ep39 / 0.05, 0.0, 1.0))
                * (1.0 - smoothstep(0.90, 0.995, pos39));
        }
        vec3 q39 = vec3(p0.x * cy39 - p0.y * sn39,
                        p0.x * sn39 + p0.y * cy39, p0.z * zs39);
        vec3 sq39 = vec3(q39.x * c39 + q39.z * s39, q39.y,
                         -q39.x * s39 + q39.z * c39);
        float d39b = max(length(cameraPosition - sq39), 1e-3);
        float r39b = max(length(cameraPosition), 1e-3);
        float w39 = clamp((r39b - d39b) / max(prm2.x, 1e-3), -1.2, 1.2);
        float k39 = clamp(exp2(w39 * max(prm.z, 0.0)), 0.08, 2.8);
        vec3 rt39 = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up39 = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        p = sq39 + (rt39 * nrm.y + up39 * nrm.z)
                 * (prm.y * k39 * scl39 * 0.5);
        b *= clamp(k39, 0.05, 1.7) * (scl39 <= 0.001 ? 0.0 : pow(scl39, 0.6));
        hot = prm.w * min(k39, 1.0) * scl39;
      }
    } else if (modeId == 25) {              // octave dive with BLOCK anchors:
      // identical to the generic dive (groups = levels, windows in gbri) —
      // but anchors flagged at gen time (aux frac >= 0.5) may print blocks.
      // hot rides the level brightness, so blocks fade through the octaves
      // exactly like the dots they sit among. prm.x = halo.
      hot = prm.x * step(0.5, fract(aux) / 0.9);
    } else if (modeId == 24) {              // square tunnel: self-similar
      gi = 0;                                // squares flying at the camera
      // aux packs level + 0.9*perimeter. prm = [prog, ln(ratio), twist/level,
      // alt]; prm2 = [levels, z-step (0 = flat), 3d half-size, -]. A level's
      // continuous coordinate q = lv + prog: flat squares grow exp(q*lnr),
      // 3d squares hold their size and slide along z; both fade in at birth
      // and out as they pass the viewer, so the wrap is seamless.
      float lv24 = floor(aux);
      float K24 = max(prm2.x, 1.0);
      float q24 = lv24 + prm.x;
      float tw24 = prm.z * q24 * mix(1.0, -1.0, prm.w * mod(lv24, 2.0));
      float c24 = cos(tw24), sn24 = sin(tw24);
      vec2 xy24 = vec2(p0.x * c24 - p0.y * sn24, p0.x * sn24 + p0.y * c24);
      if (prm2.y > 0.0) p = vec3(xy24 * prm2.z, (q24 - K24 + 1.0) * prm2.y);
      else p = vec3(xy24 * exp(q24 * prm.y) * prm2.z, 0.0);
      b *= smoothstep(0.0, 0.9, q24)
         * (1.0 - smoothstep(K24 - 1.4, K24 - 0.15, q24));
    } else if (modeId == 23) {              // crystal chips: a FEW block sites
      gi = 0;                                // on a lattice, blooming in
      // sequence — aux packs site index + 0.9*frac (plain dots carry a site
      // >= count so they never light). prm = [clock, -, halo, rest];
      // prm2 = [count, halfWindow, -, boost]. Each site owns a window of
      // the cycle centred at (si+0.5)/count; the bloom is expo in AND out.
      float si23 = floor(aux);
      float n23 = max(prm2.x, 1.0);
      float d23 = abs(fract(prm.x - (si23 + 0.5) / n23 + 0.5) - 0.5);
      float p23 = clamp(1.0 - d23 / max(prm2.y, 1e-3), 0.0, 1.0);
      float e23 = p23 <= 0.0 ? 0.0 : p23 >= 1.0 ? 1.0 :
                  (p23 < 0.5 ? 0.5 * exp2(20.0 * p23 - 10.0)
                             : 1.0 - 0.5 * exp2(10.0 - 20.0 * p23));
      e23 *= step(si23, n23 - 0.5);
      b *= prm.w + prm2.w * e23;
      // prm2.z = 1 licenses only ANCHOR dots (aux frac >= 0.5) to print
      // blocks, so a blooming grid slice stays dots with block anchors
      hot = prm.z * e23 * mix(1.0, step(0.5, fract(aux) / 0.9), prm2.z);
    } else if (modeId == 19) {              // burst: a block explodes into
      gi = 0;                                // arms — aux packs arm + 0.9*along
      float arm19 = floor(aux);
      float f19 = fract(aux) / 0.9;
      float w19 = max(prm2.y, 1e-3);         // per-arm stagger window
      float n19 = max(prm2.x, 1.0);
      float s19 = n19 <= 1.0 ? 0.0 : (arm19 / (n19 - 1.0)) * (1.0 - w19);
      float x19 = clamp((prm.x - s19) / w19, 0.0, 1.0);
      float e19 = x19 <= 0.0 ? 0.0 : x19 >= 1.0 ? 1.0 :
                  (x19 < 0.5 ? 0.5 * exp2(20.0 * x19 - 10.0)
                             : 1.0 - 0.5 * exp2(10.0 - 20.0 * x19));
      p = p0 * mix(prm.y, 1.0, e19);         // rest block -> full extension
      float tip19 = smoothstep(0.86, 0.98, f19);
      hot = max(tip19 * e19 * prm.z,         // chips ride the arm tips...
                prm.w * (1.0 - e19));        // ...and the resting core is a chip
      b *= mix(0.6, 1.0, e19);
    } else if (modeId == 20) {              // migrate: arrangement A <-> B —
      gi = 0;                                // nrm carries B; aux packs unit
      float un20 = floor(aux);
      float w20 = max(prm.y, 1e-3);
      float n20 = max(prm.z, 1.0);
      float s20 = n20 <= 1.0 ? 0.0 : (un20 / (n20 - 1.0)) * (1.0 - w20);
      float x20 = clamp((prm.x - s20) / w20, 0.0, 1.0);
      float e20 = x20 <= 0.0 ? 0.0 : x20 >= 1.0 ? 1.0 :
                  (x20 < 0.5 ? 0.5 * exp2(20.0 * x20 - 10.0)
                             : 1.0 - 0.5 * exp2(10.0 - 20.0 * x20));
      p = mix(p0, nrm, e20);
      hot = prm.w * 4.0 * e20 * (1.0 - e20); // movers glow; parked dots rest
    } else if (modeId == 18) {              // imported image: block license
      hot = prm.x * clamp(b * 0.5, 0.0, 1.0);   // rides the "blocks" knob
    } else if (modeId == 17) {              // seam runners: comet trails on
      // great circles — aux packs seam + 0.9 * trail fraction; the group
      // matrix holds the seam plane, so the particle just rides its slice of
      // the [t0, phi] window (gbri already carries the seam's envelope)
      float sfrac = fract(aux) / 0.9;
      float sphi = gi == 0 ? prm.x : gi == 1 ? prm.y : gi == 2 ? prm.z : prm.w;
      float st0 = gi == 0 ? prm2.x : gi == 1 ? prm2.y : gi == 2 ? prm2.z : prm2.w;
      float sth = mix(st0, sphi, sfrac);
      p = vec3(cos(sth), sin(sth), 0.0);
      hot = smoothstep(0.93, 1.0, sfrac);   // the runner head is the chip
    } else if (modeId == 9) {               // asset: point-sampled GLB surface,
      vec3 n = g0 * nrm;                    // lit live so shading tracks the spin
      float nl = length(n);
      if (nl > 1e-4) {
        n /= nl;
        vec3 wp0 = g0 * p0;
        vec3 V = normalize(cameraPosition - wp0);
        float ndv = dot(n, V);
        float lam = prm.w + prm2.x * max(dot(n, prm.xyz), 0.0);
        float rim = prm2.y * pow(1.0 - min(abs(ndv), 1.0), prm2.z);
        // fade marks whose surface faces away — the cloud reads as a solid
        // volume; xray (prm2.w) lets the far side ghost back in
        float face = mix(smoothstep(-0.35, 0.10, ndv), 1.0, prm2.w);
        b = (b * lam + rim) * face;
        // rim is lighting only — 3D assets never author blocks
      }
    }

    p = (gi == 0 ? g0 : gi == 1 ? g1 : gi == 2 ? g2 : g3) * p;
    if (modeId == 4) {                      // opaque globe: cull the far side
      b *= smoothstep(-0.06, 0.16, dot(normalize(p), normalize(cameraPosition)));
    }
    briOut = b;
    hotOut = hot;
    return p;
  }

  vec3 seedDir(float s) {
    float a = s * 78.233 + 11.0, c = s * 12.9898 + 4.0;
    return normalize(vec3(fract(sin(a) * 43758.5) - 0.5,
                          fract(sin(c) * 24634.6) - 0.5,
                          fract(sin(a + c) * 36718.9) - 0.5) + 1e-4);
  }

  // How a dot bends between its endpoints. Every path is zero at e=0 and e=1
  // (landings stay exact) and scales with travel distance (near-stationary
  // dots barely wander). Mirrored in JS by the engine's bake.
  vec3 pathDisplace(vec3 pa, vec3 pb, float e, float seed) {
    if (uPath == 0 || uPathAmp < 1e-4) return vec3(0.0);
    vec3 d = pb - pa;
    float ld = length(d);
    if (ld < 1e-5) return vec3(0.0);
    float ls = min(ld, 2.0);
    if (uPath == 1) {                   // arc: a bezier bow, radially outward
      vec3 mid = 0.5 * (pa + pb);
      vec3 dir = normalize(mid + 1e-3 * seedDir(seed));
      float k = uPathAmp * ls * 0.55 * (0.7 + 0.6 * seed);
      return dir * (2.0 * e * (1.0 - e) * k);
    } else if (uPath == 2) {            // vortex: corkscrew around the flight line
      vec3 axis = d / ld;
      vec3 ref = abs(axis.y) < 0.94 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 p1 = normalize(cross(axis, ref));
      vec3 p2 = cross(axis, p1);
      float th = e * 12.566371 + seed * 6.2831853;
      float r = uPathAmp * ls * 0.22 * sin(3.14159265 * e);
      return (p1 * cos(th) + p2 * sin(th)) * r;
    }
    // turbulent: cheap trig curl drifting over time, decohered per particle
    vec3 wp = mix(pa, pb, e);
    vec3 q = wp * 2.3 + seedDir(seed) * 1.7 + vec3(0.0, uTime * 0.35, 0.0);
    vec3 n = vec3(sin(q.y * 1.7 + q.z * 2.3),
                  sin(q.z * 1.9 + q.x * 2.1),
                  sin(q.x * 1.3 + q.y * 2.7));
    return n * (uPathAmp * ls * 0.30 * sin(3.14159265 * e));
  }

  void main() {
    float bA, bB, hA, hB;
    vec3 pa = evalSlot(uModeA, position, aNrmA, aAux.x, aBri.x,
                       uGrpA[0], uGrpA[1], uGrpA[2], uGrpA[3],
                       uGBriA, uPrmA, uPrm2A, bA, hA);
    vec3 pb = evalSlot(uModeB, aPosB, aNrmB, aAux.y, aBri.y,
                       uGrpB[0], uGrpB[1], uGrpB[2], uGrpB[3],
                       uGBriB, uPrmB, uPrm2B, bB, hB);

    float local = clamp((uProg - aKey * uSpread) / max(1e-4, 1.0 - uSpread), 0.0, 1.0);
    float e = easeSel(local);
    vec3 wp = mix(pa, pb, e) + pathDisplace(pa, pb, e, aSeed);
    float sw = uSwirl * sin(3.14159265 * e);
    if (abs(sw) > 1e-5) {                  // the whole flight corkscrews about Y
      float cs = cos(sw), sn = sin(sw);
      wp = vec3(cs * wp.x + sn * wp.z, wp.y, -sn * wp.x + cs * wp.z);
    }
    if (abs(uRotExtra) > 1e-5) {           // the transition WHIP: spin-up
      float cw = cos(uRotExtra), sn2 = sin(uRotExtra);   // into the cut,
      wp = vec3(cw * wp.x + sn2 * wp.z, wp.y,            // spin-down after
                -sn2 * wp.x + cw * wp.z);
    }
    wp += seedDir(aSeed) * (uScatter * sin(3.14159 * e));
    float br = mix(bA, bB, e);
    if (uEase == 5) {
      // vanish: no flight at all — the old dot winks OUT at its window's
      // MIDDLE (where the position also cuts — nothing pops on the boundary
      // frame, and departures span the flight instead of rushing its start)
      // and the new prints when the window closes. The stagger sequences the
      // braille out, spread sets how empty the frame gets mid-cut.
      br *= 1.0 - step(0.5, local) * (1.0 - step(0.9999, local));
    }

    vec4 mv = modelViewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;

    // grid lock: a terminal dot can't sit BETWEEN character sub-cells — snap
    // the projected position to sub-cell centres so travel staggers cell to
    // cell instead of gliding
    if (uSnapGrid.x > 0.5) {
      vec2 ndc = gl_Position.xy / gl_Position.w;
      vec2 g = (ndc * 0.5 + 0.5) * uSnapGrid;
      g = floor(g) + 0.5;
      gl_Position.xy = ((g / uSnapGrid) * 2.0 - 1.0) * gl_Position.w;
    }

    // solidity: a dot sitting behind an asset's actual surface goes dark. The
    // depth maps hold the nearest surface per screen position; anything deeper
    // than it (minus a little same-surface slack) is occluded.
    if (uOccA > 0.001 || uOccB > 0.001) {
      vec2 suv = gl_Position.xy / max(gl_Position.w, 1e-4) * 0.5 + 0.5;
      if (all(greaterThanEqual(suv, vec2(0.0))) &&
          all(lessThanEqual(suv, vec2(1.0)))) {
        float own = -mv.z;
        float occ = 0.0;
        if (uOccA > 0.001) {
          float d = textureLod(tDepthA, suv, 0.0).r;
          occ = max(occ, uOccA * smoothstep(uOccBias, uOccBias * 2.0, own - d));
        }
        if (uOccB > 0.001) {
          float d = textureLod(tDepthB, suv, 0.0).r;
          occ = max(occ, uOccB * smoothstep(uOccBias, uOccBias * 2.0, own - d));
        }
        br *= 1.0 - occ;
      }
    }

    if (uFade > 0.0) {
      // every dot owns a slice of the dissolve; ~random order, quick each
      float h = fract(aSeed * 61.8033989 + 0.37) * 0.85;
      br *= 1.0 - smoothstep(h, h + 0.15, uFade);
    }
    // the photo hand-off. NOT mirrored in the bake on purpose: a retarget
    // pops the photo off and the dots back on together — the image bursts
    // into particles. uPhotoFlip: the photo clip is EXITING (it is the A
    // side), so undeparted dots are the hidden ones instead.
    br *= 1.0 - uPhotoB * (uPhotoFlip > 0.5 ? 1.0 - e : e);

    gl_PointSize = clamp(uBaseSize * uProjScale / max(0.1, -mv.z)
                         * (0.55 + 0.75 * clamp(br, 0.0, 2.5)), uMinPt, uMaxPt);
    vBri = br;
    vHot = mix(hA, hB, e);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying float vBri;
  varying float vHot;
  uniform float uGain;
  uniform float uSplit;   // 1: R = energy, G = authored energy (terminal
                          // pass); 0: plain monochrome (direct view)

  void main() {
    // a shading dash: near-round when dim, widening horizontally as it brightens
    vec2 pc = gl_PointCoord - 0.5;
    float hw = mix(0.16, 0.46, clamp(vBri * 0.45, 0.0, 1.0));
    float ax = 1.0 - smoothstep(hw, hw + 0.18, abs(pc.x));
    float ay = 1.0 - smoothstep(0.16, 0.34, abs(pc.y));
    float a = ax * ay;
    if (a <= 0.004) discard;
    float e = vBri * a * uGain;
    gl_FragColor = uSplit > 0.5 ? vec4(e, e * vHot, 0.0, 1.0)
                                : vec4(vec3(e), 1.0);
  }
`;

// ---------------------------------------------------------------------------
// The mosaic PRINT OVERLAY — the blocks themselves, made visible. A separate
// dot cloud draws each reveal tile as a filled braille block (fill) or an
// outlined frame (stroke). A dot is born with a ragged stochastic lead just
// before its tile pops, and dies by hash over the trail window after — so at
// any instant the front carries dense fresh blocks and leaves a thinning
// braille taper behind it. Renders through the same glyph pass as the pool
// and goes fully dark at phase 1, so settled frames are untouched.

const PRINT_VERT = /* glsl */ `
  attribute float aKeyT;   // the tile's pop key
  attribute float aH1;     // birth hash — leading raggedness
  attribute float aH2;     // death hash — the dissolve taper
  uniform float uProgP;
  uniform float uSpreadP;
  uniform float uTrail;
  uniform float uLead;
  uniform float uBaseSize;
  uniform float uProjScale;
  uniform float uMinPt;
  uniform float uMaxPt;
  uniform vec2 uSnapGrid;
  varying float vBriP;

  void main() {
    float popT = aKeyT * uSpreadP;
    float birth = popT - aH1 * uLead;
    float death = min(popT + uTrail * (0.25 + 0.75 * aH2), 0.998);
    float alive = step(birth, uProgP) * (1.0 - step(death, uProgP));
    if (alive < 0.5 || uProgP >= 0.9995) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // clipped away
      gl_PointSize = 1.0;
      vBriP = 0.0;
      return;
    }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    if (uSnapGrid.x > 0.5) {                     // grid lock, same as the pool
      vec2 ndc = gl_Position.xy / gl_Position.w;
      vec2 g = (ndc * 0.5 + 0.5) * uSnapGrid;
      g = floor(g) + 0.5;
      gl_Position.xy = ((g / uSnapGrid) * 2.0 - 1.0) * gl_Position.w;
    }
    float b = 1.35;
    gl_PointSize = clamp(uBaseSize * uProjScale / max(0.1, -mv.z)
                         * (0.55 + 0.75 * clamp(b, 0.0, 2.5)), uMinPt, uMaxPt);
    vBriP = b;
  }
`;

const PRINT_FRAG = /* glsl */ `
  precision highp float;
  varying float vBriP;
  uniform float uGain;
  uniform float uSplit;

  void main() {
    vec2 pc = gl_PointCoord - 0.5;
    float hw = mix(0.16, 0.46, clamp(vBriP * 0.45, 0.0, 1.0));
    float ax = 1.0 - smoothstep(hw, hw + 0.18, abs(pc.x));
    float ay = 1.0 - smoothstep(0.16, 0.34, abs(pc.y));
    float a = ax * ay;
    if (a <= 0.004 || vBriP <= 0.001) discard;
    float e = vBriP * a * uGain;
    gl_FragColor = uSplit > 0.5 ? vec4(e, 0.0, 0.0, 1.0) : vec4(vec3(e), 1.0);
  }
`;

// ---------------------------------------------------------------------------
function makeSlot() {
  return {
    grp: new Float32Array(36),   // 4 column-major mat3s
    gbri: new Float32Array(4),
    prm: new Float32Array(4),
    prm2: new Float32Array(4),
  };
}

function scanlineOrder(pos, n) {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => {
    const dy = pos[3 * b + 1] - pos[3 * a + 1];       // y desc (top first)
    return dy !== 0 ? dy : pos[3 * a] - pos[3 * b];   // then x asc
  });
  return idx;
}

export function sortLayout(layout, n) {
  const order = scanlineOrder(layout.pos, n);
  const pos = new Float32Array(3 * n), aux = new Float32Array(n),
        bri = new Float32Array(n), nrm = new Float32Array(3 * n);
  const hasN = !!layout.nrm;
  for (let r = 0; r < n; r++) {
    const i = order[r];
    pos[3 * r] = layout.pos[3 * i];
    pos[3 * r + 1] = layout.pos[3 * i + 1];
    pos[3 * r + 2] = layout.pos[3 * i + 2];
    if (hasN) {
      nrm[3 * r] = layout.nrm[3 * i];
      nrm[3 * r + 1] = layout.nrm[3 * i + 1];
      nrm[3 * r + 2] = layout.nrm[3 * i + 2];
    }
    aux[r] = layout.aux[i];
    bri[r] = layout.bri[i];
  }
  return { pos, aux, bri, nrm };
}

/** JS mirror of the shader's seedDir — the bake has to land where the eye was. */
function seedDirJS(s, out) {
  const fract = (x) => x - Math.floor(x);
  const a = s * 78.233 + 11.0, c = s * 12.9898 + 4.0;
  let x = fract(Math.sin(a) * 43758.5) - 0.5 + 1e-4;
  let y = fract(Math.sin(c) * 24634.6) - 0.5 + 1e-4;
  let z = fract(Math.sin(a + c) * 36718.9) - 0.5 + 1e-4;
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
}

export const STAGGER_AXES = ["sweep x", "sweep y", "radial", "random", "blocks", "blocks out"];
export const BLOCK_ORDERS = [
  "staircase", "type", "serpent", "spiral", "scatter",
  "rows", "interlace", "cascade", "unfold", "curtain",
];
export const PATH_MODES = ["linear", "arc", "vortex", "turbulent"];

/** One reveal time per tile — the mosaic schedule (see BLOCK_ORDERS).
    Shared by the engine's stagger keys and the photo lane's print reveal.
    SEED arrives pre-scaled (raw seed * 74.7). */
export function mosaicTileKeys(ORDER, COLS, ROWS, LAG, SEED) {
  // one reveal time per tile — the schedule (BLOCK_ORDERS) lives here:
  //   staircase  rows advance with a per-tile hash lag (vary/seed apply)
  //   type     strict cell by cell along the row, then the next row
  //   serpent    type, but alternate rows run right-to-left
  //   spiral     centre-out ring walk, clockwise from the top
  //   scatter    a hashed permutation — seed re-rolls it
  //   rows     a whole row at a time, top to bottom
  //   interlace  even rows top to bottom, then the odd rows — CRT fields
  //   cascade    cell by cell DOWN each column, then the next column
  //   unfold     whole rows from the centre outward
  //   curtain    whole columns from both edges, meeting in the middle
  const n = COLS * ROWS;
  const tileKey = new Float32Array(n);
  ORDER = Math.min(9, Math.max(0, Math.round(ORDER) || 0));
  if (ORDER === 0) {
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
      const s = Math.sin(cx * 127.1 + cy * 311.7 + SEED) * 43758.5453;
        tileKey[cy * COLS + cx] =
        Math.min(1, Math.max(0, (cy + (s - Math.floor(s)) * LAG) / (ROWS - 1 + LAG)));
    }
    }
  } else if (ORDER === 5 || ORDER === 6 || ORDER === 8 || ORDER === 9) {
    // the unit schedules: every tile in a row (or column) shares ONE key
    const rowRank = (cy) => {
    if (ORDER === 5) return cy;                      // rows
    if (ORDER === 6) {                             // interlace
      const evens = Math.ceil(ROWS / 2);
        return cy % 2 === 0 ? cy / 2 : evens + (cy - 1) / 2;
    }
    // unfold: centre row first, then alternating outward, top-side first
    const c = (ROWS - 1) / 2;
    const d = Math.abs(cy - c);
      return Math.round(2 * d) - (cy < c ? 1 : 0);
    };
    const colRank = (cx) => {                        // curtain
    const c = (COLS - 1) / 2;
    const d = Math.abs(cx - c);
      return (COLS - 1) - (Math.round(2 * d) - (cx < c ? 1 : 0));
    };
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
      const k = ORDER === 9
        ? colRank(cx) / Math.max(1, COLS - 1)
        : rowRank(cy) / Math.max(1, ROWS - 1);
        tileKey[cy * COLS + cx] = Math.min(1, Math.max(0, k));
    }
    }
  } else {
  let seq;
    if (ORDER === 1) {             // type
      seq = Array.from({ length: n }, (_, i) => i);
    } else if (ORDER === 7) {        // cascade: down each column
      seq = [];
      for (let cx = 0; cx < COLS; cx++) {
        for (let cy = 0; cy < ROWS; cy++) seq.push(cy * COLS + cx);
    }
    } else if (ORDER === 2) {        // serpent
      seq = [];
      for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) {
        seq.push(cy * COLS + (cy % 2 ? COLS - 1 - cx : cx));
      }
    }
    } else if (ORDER === 3) {        // spiral
    const ccx = (COLS - 1) / 2, ccy = (ROWS - 1) / 2;
      seq = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const ax = (a % COLS) - ccx, ay = Math.floor(a / COLS) - ccy;
      const bx = (b % COLS) - ccx, by = Math.floor(b / COLS) - ccy;
      const ra = Math.max(Math.abs(ax), Math.abs(ay));
      const rb = Math.max(Math.abs(bx), Math.abs(by));
      if (ra !== rb) return ra - rb;
      const aa = Math.atan2(ax, -ay), ab = Math.atan2(bx, -by);
        return aa !== ab ? aa - ab : a - b;
    });
    } else {                     // scatter
    const h = (i) => {
      const s = Math.sin((i % COLS) * 127.1 + Math.floor(i / COLS) * 311.7 + SEED) * 43758.5453;
        return s - Math.floor(s);
    };
      seq = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
      const d = h(a) - h(b);
        return d !== 0 ? d : a - b;
    });
    }
  for (let r = 0; r < n; r++) tileKey[seq[r]] = n <= 1 ? 0 : r / (n - 1);
  }
  return tileKey;
}

export class ParticleEngine {
  constructor(N = 16384) {
    this.N = N;
    this.slotA = makeSlot();
    this.slotB = makeSlot();
    this.modeA = MODES[0];               // definitions animating each slot
    this.modeB = MODES[0];
    this.frozenA = false;                // A is a baked snapshot (mid-switch)
    this.prog = 1;                       // 1 = settled on B
    this.duration = 0.7;
    this.spread = 0.53;
    this.easeIndex = 0;
    this.scatter = 0;
    this.swirl = 0;                      // radians; main drives it from swirlTurns
    this.pathMode = 3;                   // 0 linear · 1 arc · 2 vortex · 3 turbulent
    this.pathAmp = 1.0;
    this.rotExtra = 0;                   // the whip angle (main drives it)
    this.fade = 0;                       // 0 = all dots, 1 = fully dissolved
    this.staggerAxis = 1;                // sweep y
    this.blockOrder = 0;                 // mosaic schedule (see BLOCK_ORDERS)
    this.blocksX = 6;                    // mosaic columns (stagger blocks / blocks out)
    this.blocksY = 0;                    // mosaic rows — 0 follows the shape
    this.blockLag = 1.7;                 // staircase randomness, in rows
    this.blockSeed = 0;                  // re-rolls the tile pattern
    this.blockDebug = null;              // {cols, rows, bounds, keys} — last mosaic
    this.keysFromA = false;              // exits: stagger keys read the DEPARTING layout
    this.frameFov = 40;                  // the comp's camera fov (main mirrors it)
    this.frameAspect = 1;                // comp width / height — the mosaic frame
    this.printStyle = 0;                 // mosaic print: 0 none · 1 fill · 2 stroke
    this.printTrail = 0.35;              // phase a printed block lingers before dissolving
    this.printLead = 0.07;               // ragged stochastic lead ahead of a tile's pop
    this.printPts = null;                // the overlay cloud (child of this.points)
    this.camera = null;                  // set by main; the bake needs the eye
    this._lastT = 0;                     // shader time at the last update (bake)

    const first = sortLayout(MODES[0].gen(N, paramValues(MODES[0])), N);

    const g = new THREE.BufferGeometry();
    const attr = (arr, sz) => {
      const a = new THREE.BufferAttribute(arr, sz);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPosA = attr(first.pos.slice(), 3);
    this.aPosB = attr(first.pos.slice(), 3);
    this.aNrmA = attr(first.nrm.slice(), 3);
    this.aNrmB = attr(first.nrm.slice(), 3);
    const aux = new Float32Array(2 * N), bri = new Float32Array(2 * N);
    for (let i = 0; i < N; i++) {
      aux[2 * i] = aux[2 * i + 1] = first.aux[i];
      bri[2 * i] = bri[2 * i + 1] = first.bri[i];
    }
    this.aAux = attr(aux, 2);
    this.aBri = attr(bri, 2);
    const key = new Float32Array(N), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = (i * 0.6180339887) % 1;
    this.aKey = attr(key, 1);
    this.aSeed = attr(seed, 1);

    g.setAttribute("position", this.aPosA);
    g.setAttribute("aPosB", this.aPosB);
    g.setAttribute("aNrmA", this.aNrmA);
    g.setAttribute("aNrmB", this.aNrmB);
    g.setAttribute("aAux", this.aAux);
    g.setAttribute("aBri", this.aBri);
    g.setAttribute("aKey", this.aKey);
    g.setAttribute("aSeed", this.aSeed);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uProg: { value: 1 },
        uSpread: { value: this.spread },
        uEase: { value: 0 },
        uScatter: { value: this.scatter },
        uSwirl: { value: 0 },
        uPath: { value: 0 },
        uPathAmp: { value: this.pathAmp },
        uRotExtra: { value: 0 },
        uModeA: { value: MODES[0].id },
        uModeB: { value: MODES[0].id },
        uGrpA: { value: this._mats(this.slotA) },
        uGrpB: { value: this._mats(this.slotB) },
        uGBriA: { value: new THREE.Vector4(1, 1, 1, 1) },
        uGBriB: { value: new THREE.Vector4(1, 1, 1, 1) },
        uPrmA: { value: new THREE.Vector4() },
        uPrmB: { value: new THREE.Vector4() },
        uPrm2A: { value: new THREE.Vector4() },
        uPrm2B: { value: new THREE.Vector4() },
        uBaseSize: { value: 0.02 },
        uProjScale: { value: 300 },
        uMinPt: { value: 1.0 },
        uMaxPt: { value: 7.0 },
        uSnapGrid: { value: new THREE.Vector2(0, 0) },
        uGain: { value: 0.42 },
        uSplit: { value: 1 },
        tDepthA: { value: null },
        tDepthB: { value: null },
        uOccA: { value: 0 },
        uOccB: { value: 0 },
        uOccBias: { value: 0.05 },
        uFade: { value: 0 },
        uPhotoB: { value: 0 },
        uPhotoFlip: { value: 0 },
      },
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;

    // the print overlay's material shares the pool's render uniforms, so the
    // scene's gain / size / grid-lock / split settings apply automatically
    const su = this.material.uniforms;
    this.printMat = new THREE.ShaderMaterial({
      vertexShader: PRINT_VERT,
      fragmentShader: PRINT_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgP: { value: 1 },
        uSpreadP: { value: 0.7 },
        uTrail: { value: 0.35 },
        uLead: { value: 0.07 },
        uBaseSize: su.uBaseSize,
        uProjScale: su.uProjScale,
        uMinPt: su.uMinPt,
        uMaxPt: su.uMaxPt,
        uSnapGrid: su.uSnapGrid,
        uGain: su.uGain,
        uSplit: su.uSplit,
      },
    });
  }

  /** (Re)build the mosaic print overlay for the current pair — one dot cloud
      covering every tile, fill lattice or stroke outline. Removed when the
      pair isn't a mosaic or the print style is off. */
  _buildPrintOverlay() {
    if (this.printPts) {
      this.points.remove(this.printPts);
      this.printPts.geometry.dispose();
      this.printPts = null;
    }
    const dbg = this.blockDebug;
    const style = this.printStyle | 0;
    if (!dbg || style <= 0 || this.staggerAxis < 4) return;
    const { cols, rows, mnx, mxx, mny, mxy, keys, occupancy } = dbg;
    // print blocks only where the figure is — an empty frame tile gets none
    const minDots = Math.max(6, Math.round(this.N / (cols * rows * 24)));
    const tw = (mxx - mnx) / cols, th = (mxy - mny) / rows;
    let pitch = Math.max(0.016, Math.min(tw, th) / 15);
    // budget: keep the overlay under ~40k dots on huge grids
    const per = style === 1
      ? Math.ceil(tw / pitch + 1) * Math.ceil(th / pitch + 1)
      : 2 * (Math.ceil(tw / pitch) + Math.ceil(th / pitch));
    const over = Math.sqrt((cols * rows * per) / 40000);
    if (over > 1) pitch *= over;
    const h01 = (a, b) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const pos = [], keyT = [], h1 = [], h2 = [];
    const push = (x, y, k) => {
      pos.push(x, y, 0);
      keyT.push(k);
      h1.push(h01(x, y));
      h2.push(h01(y + 7.7, x));
    };
    const inset = pitch * 0.45;              // adjacent strokes stay two lines
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (occupancy && occupancy[cy * cols + cx] < minDots) continue;
        const k = keys[cy * cols + cx];
        const x0 = mnx + cx * tw + inset, x1 = mnx + (cx + 1) * tw - inset;
        const yT = mxy - cy * th - inset, yB = mxy - (cy + 1) * th + inset;
        const nx = Math.max(1, Math.round((x1 - x0) / pitch));
        const ny = Math.max(1, Math.round((yT - yB) / pitch));
        if (style === 1) {                   // fill: a solid dot lattice
          for (let i = 0; i <= nx; i++) {
            for (let j = 0; j <= ny; j++) {
              push(x0 + ((x1 - x0) * i) / nx, yB + ((yT - yB) * j) / ny, k);
            }
          }
        } else {                             // stroke: the tile's outline
          for (let i = 0; i <= nx; i++) {
            const x = x0 + ((x1 - x0) * i) / nx;
            push(x, yT, k);
            push(x, yB, k);
          }
          for (let j = 1; j < ny; j++) {
            const y = yB + ((yT - yB) * j) / ny;
            push(x0, y, k);
            push(x1, y, k);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("aKeyT", new THREE.BufferAttribute(new Float32Array(keyT), 1));
    g.setAttribute("aH1", new THREE.BufferAttribute(new Float32Array(h1), 1));
    g.setAttribute("aH2", new THREE.BufferAttribute(new Float32Array(h2), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    this.printPts = new THREE.Points(g, this.printMat);
    this.printPts.frustumCulled = false;
    this.points.add(this.printPts);
  }

  _mats(slot) {
    const out = [];
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Matrix3();
      m.fromArray(slot.grp, k * 9);
      out.push(m);
    }
    return out;
  }

  _pushSlot(slot, uGrp, gbriU, prmU, prm2U) {
    for (let k = 0; k < 4; k++) uGrp[k].fromArray(slot.grp, k * 9);
    gbriU.fromArray(slot.gbri);
    prmU.fromArray(slot.prm);
    prm2U.fromArray(slot.prm2);
  }

  get transitioning() {
    return this.prog < 1;
  }

  /** Fly the pool to `mode`'s layout — mode is any object with the mode shape
      (gen / update / params / id), procedural or sampled off a GLB.
      Retargeting mid-flight bakes the current blend into slot A first so the
      redirect is seamless. */
  setTarget(mode, { snap = false } = {}) {
    if (!mode) return;
    const N = this.N;

    if (this.transitioning) this._bakeCurrentIntoA();
    else {
      this.aPosA.array.set(this.aPosB.array);
      this.aNrmA.array.set(this.aNrmB.array);
      const aux = this.aAux.array, bri = this.aBri.array;
      for (let i = 0; i < N; i++) { aux[2 * i] = aux[2 * i + 1]; bri[2 * i] = bri[2 * i + 1]; }
      this.modeA = this.modeB;
      this.frozenA = false;
      // slot A keeps animating as the old mode while the flight happens
      for (let k = 0; k < 36; k++) this.slotA.grp[k] = this.slotB.grp[k];
      this.slotA.gbri.set(this.slotB.gbri);
      this.slotA.prm.set(this.slotB.prm);
      this.slotA.prm2.set(this.slotB.prm2);
    }

    const layout = sortLayout(mode.gen(N, paramValues(mode)), N);
    this.aPosB.array.set(layout.pos);
    this.aNrmB.array.set(layout.nrm);
    const aux = this.aAux.array, bri = this.aBri.array;
    for (let i = 0; i < N; i++) {
      aux[2 * i + 1] = layout.aux[i];
      bri[2 * i + 1] = layout.bri[i];
    }
    this._computeKeys(layout.pos, this.aPosA.array);
    this.aPosA.needsUpdate = true;
    this.aPosB.needsUpdate = true;
    this.aNrmA.needsUpdate = true;
    this.aNrmB.needsUpdate = true;
    this.aAux.needsUpdate = true;
    this.aBri.needsUpdate = true;
    this.aKey.needsUpdate = true;

    this.modeB = mode;
    this.prog = snap ? 1 : 0;
    this.material.uniforms.uModeA.value = this.frozenA ? 0 : this.modeA.id;
    this.material.uniforms.uModeB.value = mode.id;
  }

  /** Regenerate the CURRENT layout (a geometry param changed) — a soft morph. */
  refreshCurrent() {
    if (this.transitioning) return;
    this.setTarget(this.modeB);
  }

  /** Timeline drive: load a fully-known A → B pair from pre-sorted layouts.
      No baking, no snapshotting — both slots stay live procedural modes, so
      any progress in [0, 1] renders deterministically (scrub-safe). */
  setPairDirect(modeA, layoutA, modeB, layoutB) {
    const N = this.N;
    this.aPosA.array.set(layoutA.pos);
    this.aNrmA.array.set(layoutA.nrm);
    this.aPosB.array.set(layoutB.pos);
    this.aNrmB.array.set(layoutB.nrm);
    const aux = this.aAux.array, bri = this.aBri.array;
    for (let i = 0; i < N; i++) {
      aux[2 * i] = layoutA.aux[i];
      aux[2 * i + 1] = layoutB.aux[i];
      bri[2 * i] = layoutA.bri[i];
      bri[2 * i + 1] = layoutB.bri[i];
    }
    this._computeKeys(layoutB.pos, layoutA.pos);
    this.aPosA.needsUpdate = true;
    this.aPosB.needsUpdate = true;
    this.aNrmA.needsUpdate = true;
    this.aNrmB.needsUpdate = true;
    this.aAux.needsUpdate = true;
    this.aBri.needsUpdate = true;
    this.aKey.needsUpdate = true;
    this.modeA = modeA;
    this.modeB = modeB;
    this.frozenA = false;
    this.material.uniforms.uModeA.value = modeA.id;
    this.material.uniforms.uModeB.value = modeB.id;
    this._buildPrintOverlay();
  }

  /** Timeline drive: render the pair at an exact progress and scene time.
      Pure — pushes uniforms only, never mutates attributes, so calling it
      with any (t, prog) in any order yields identical frames. */
  renderState(t, prog) {
    this.prog = Math.min(1, Math.max(0, prog));
    this.modeA.update(this.slotA, paramValues(this.modeA), t);
    this.modeB.update(this.slotB, paramValues(this.modeB), t);
    this._lastT = t;
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uProg.value = this.prog;
    u.uSpread.value = this.spread;
    u.uEase.value = this.easeIndex;
    u.uScatter.value = this.scatter;
    u.uSwirl.value = this.swirl;
    u.uPath.value = this.pathMode;
    u.uPathAmp.value = this.pathAmp;
    u.uRotExtra.value = this.rotExtra;
    u.uFade.value = this.fade;
    this._pushSlot(this.slotA, u.uGrpA.value, u.uGBriA.value, u.uPrmA.value, u.uPrm2A.value);
    this._pushSlot(this.slotB, u.uGrpB.value, u.uGBriB.value, u.uPrmB.value, u.uPrm2B.value);
    if (this.printPts) {
      const pu = this.printMat.uniforms;
      pu.uProgP.value = this.prog;
      pu.uSpreadP.value = this.spread;
      pu.uTrail.value = this.printTrail;
      pu.uLead.value = this.printLead;
    }
  }

  /** posA is the OUTGOING layout's positions — "blocks out" cuts its mosaic
      there, so a dense state exits in chunks even when the incoming target is
      sparse line-work that has nothing to reveal. With keysFromA (exit
      flights) EVERY axis reads the departing layout — the target may be a
      collapsed synthetic cloud with no usable geometry. */
  _computeKeys(pos, posA = pos) {
    if (this.keysFromA) pos = posA;
    if (this.staggerAxis === 4) { this._blockKeys(pos); return; }
    if (this.staggerAxis === 5) { this._blockKeys(posA); return; }
    const N = this.N, key = this.aKey.array;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mxr = 1e-9;
    for (let i = 0; i < N; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      const r = Math.hypot(x, y, pos[3 * i + 2]);
      if (r > mxr) mxr = r;
    }
    const spanX = Math.max(1e-6, mxx - mnx), spanY = Math.max(1e-6, mxy - mny);
    for (let i = 0; i < N; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1];
      let k;
      if (this.staggerAxis === 0) k = (x - mnx) / spanX;
      else if (this.staggerAxis === 1) k = (mxy - y) / spanY;
      else if (this.staggerAxis === 2)
        k = Math.hypot(x, y, pos[3 * i + 2]) / mxr;
      else k = (i * 0.6180339887) % 1;
      // a whisper of jitter so equal-key fronts don't band
      key[i] = Math.min(1, Math.max(0, k * 0.96 + 0.04 * ((i * 0.7548776662) % 1)));
    }
  }

  /** blocks (axis 4): a coarse mosaic of tiles — every dot in a tile shares
      ONE key so whole chunks print together; rows advance top to bottom and a
      per-tile hash lag bends the front into an imperfect staircase. Pair with
      the "print" ease for the hard mosaic reveal.
      Tiles partition the COMPOSITION: the camera frame at the z = 0 plane,
      derived from the project's fov and comp aspect with the house camera
      distance — so the grid maps 1:1 onto the frame (auto rows keep tiles
      screen-square) and stays deterministic, no live-camera dependence. Dots
      are placed by their canonically projected position (the perspective
      divide keeps a deep target's cut edges clean screen rectangles); content
      outside the frame clamps to the edge tiles. */
  _blockKeys(pos) {
    const N = this.N, key = this.aKey.array;
    const D = 3.55;                          // the house camera distance
    const aspect = this.frameAspect > 0 ? this.frameAspect : 1;
    const hh = Math.tan(((this.frameFov || 40) * Math.PI) / 360) * D;
    const hw = hh * aspect;                  // the frame's half-extents at z=0
    const COLS = Math.max(2, Math.round(this.blocksX) || 6);
    const ROWS = this.blocksY > 0
      ? Math.max(2, Math.round(this.blocksY))
      : Math.max(2, Math.round(COLS / aspect));   // screen-square tiles
    const LAG = Math.max(0, this.blockLag ?? 1.7);
    const SEED = (this.blockSeed || 0) * 74.7;
    const ORDER = Math.min(9, Math.max(0, Math.round(this.blockOrder) || 0));
    const tileKey = mosaicTileKeys(ORDER, COLS, ROWS, LAG, SEED);
    const occupancy = new Uint32Array(COLS * ROWS);
    for (let i = 0; i < N; i++) {
      const w = D / Math.max(0.5, D - pos[3 * i + 2]);
      const sx = pos[3 * i] * w, sy = pos[3 * i + 1] * w;
      const cx = Math.min(COLS - 1, Math.max(0, Math.floor(((sx + hw) / (2 * hw)) * COLS)));
      const cy = Math.min(ROWS - 1, Math.max(0, Math.floor(((hh - sy) / (2 * hh)) * ROWS)));
      key[i] = tileKey[cy * COLS + cx];
      occupancy[cy * COLS + cx]++;
    }
    this.blockDebug = {
      cols: COLS, rows: ROWS,
      mnx: -hw, mxx: hw, mny: -hh, mxy: hh,
      keys: tileKey, occupancy,
    };
  }

  /** The flight-path bend, mirrored off the shader (see pathDisplace in the
      vertex source) — the bake must land dots where the eye last saw them. */
  _pathDisplace(pa, pb, e, seed, out) {
    out[0] = out[1] = out[2] = 0;
    const mode = this.pathMode, amp = this.pathAmp;
    if (!mode || amp < 1e-4) return;
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
    const ld = Math.hypot(dx, dy, dz);
    if (ld < 1e-5) return;
    const ls = Math.min(ld, 2);
    const sd = [0, 0, 0];
    if (mode === 1) {                    // arc
      seedDirJS(seed, sd);
      let ox = 0.5 * (pa[0] + pb[0]) + 1e-3 * sd[0];
      let oy = 0.5 * (pa[1] + pb[1]) + 1e-3 * sd[1];
      let oz = 0.5 * (pa[2] + pb[2]) + 1e-3 * sd[2];
      const ol = Math.hypot(ox, oy, oz) || 1;
      const k = amp * ls * 0.55 * (0.7 + 0.6 * seed) * 2 * e * (1 - e);
      out[0] = (ox / ol) * k; out[1] = (oy / ol) * k; out[2] = (oz / ol) * k;
    } else if (mode === 2) {             // vortex
      const ax = dx / ld, ay = dy / ld, az = dz / ld;
      const [rx, ry, rz] = Math.abs(ay) < 0.94 ? [0, 1, 0] : [1, 0, 0];
      let p1x = ay * rz - az * ry, p1y = az * rx - ax * rz, p1z = ax * ry - ay * rx;
      const p1l = Math.hypot(p1x, p1y, p1z) || 1;
      p1x /= p1l; p1y /= p1l; p1z /= p1l;
      const p2x = ay * p1z - az * p1y, p2y = az * p1x - ax * p1z,
            p2z = ax * p1y - ay * p1x;
      const th = e * 12.566371 + seed * 6.2831853;
      const r = amp * ls * 0.22 * Math.sin(Math.PI * e);
      const ct = Math.cos(th), st = Math.sin(th);
      out[0] = (p1x * ct + p2x * st) * r;
      out[1] = (p1y * ct + p2y * st) * r;
      out[2] = (p1z * ct + p2z * st) * r;
    } else {                             // turbulent
      seedDirJS(seed, sd);
      const wx = pa[0] + dx * e, wy = pa[1] + dy * e, wz = pa[2] + dz * e;
      const qx = wx * 2.3 + sd[0] * 1.7;
      const qy = wy * 2.3 + sd[1] * 1.7 + this._lastT * 0.35;
      const qz = wz * 2.3 + sd[2] * 1.7;
      const r = amp * ls * 0.30 * Math.sin(Math.PI * e);
      out[0] = Math.sin(qy * 1.7 + qz * 2.3) * r;
      out[1] = Math.sin(qz * 1.9 + qx * 2.1) * r;
      out[2] = Math.sin(qx * 1.3 + qy * 2.7) * r;
    }
  }

  /** The asset lighting, mirrored off the shader — the bake must reproduce the
      brightness the eye saw or a mid-flight retarget pops. */
  _assetShade(bri, nx, ny, nz, wx, wy, wz, prm, prm2) {
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) return bri;
    nx /= nl; ny /= nl; nz /= nl;
    const cp = this.camera ? this.camera.position : { x: 0, y: 0, z: 3.55 };
    let vx = cp.x - wx, vy = cp.y - wy, vz = cp.z - wz;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const ndv = nx * vx + ny * vy + nz * vz;
    const lam = prm[3] + prm2[0] * Math.max(0, nx * prm[0] + ny * prm[1] + nz * prm[2]);
    const rim = prm2[1] * Math.pow(1 - Math.min(1, Math.abs(ndv)), prm2[2]);
    const t = Math.min(1, Math.max(0, (ndv + 0.35) / 0.45));
    const face = (1 - prm2[3]) * (t * t * (3 - 2 * t)) + prm2[3];
    return (bri * lam + rim) * face;
  }

  /** JS mirror of the grid-field shader branches (ids 10, 11, 12, 14, 17) —
      the bake must land a departing mode where the eye last saw it. Writes
      the field-displaced LOCAL position into `out` and returns the brightness
      multiplier. Moire (13) rides the group rotation — see _moireBeat. */
  _gridField(id, x, y, z, nx, ny, nz, aux, slot, out) {
    const prm = slot.prm, prm2 = slot.prm2;
    out[0] = x; out[1] = y; out[2] = z;
    if (id === 19) {                        // burst: staggered radial scale
      const arm = Math.floor(aux);
      const w = Math.max(prm2[1], 1e-3), n = Math.max(prm2[0], 1);
      const s = n <= 1 ? 0 : (arm / (n - 1)) * (1 - w);
      const e = EASE_FNS[0](Math.min(1, Math.max(0, (prm[0] - s) / w)));
      const k = prm[1] + (1 - prm[1]) * e;
      out[0] = x * k; out[1] = y * k; out[2] = z * k;
      return 0.6 + 0.4 * e;
    }
    if (id === 21) {                        // spiral trail
      const frac = (aux - Math.floor(aux)) / 0.9;
      const th = prm[1] + (prm[0] - prm[1]) * frac;
      const r = prm[2] + prm[3] * th;
      out[0] = Math.cos(th) * r; out[1] = Math.sin(th) * r; out[2] = 0;
      return (th >= 0 && th <= prm2[0]) ? 1 : 0;
    }
    if (id === 20) {                        // migrate: mix toward nrm's pose
      const un = Math.floor(aux);
      const w = Math.max(prm[1], 1e-3), n = Math.max(prm[2], 1);
      const s = n <= 1 ? 0 : (un / (n - 1)) * (1 - w);
      const e = EASE_FNS[0](Math.min(1, Math.max(0, (prm[0] - s) / w)));
      out[0] = x + (nx - x) * e;
      out[1] = y + (ny - y) * e;
      out[2] = z + (nz - z) * e;
      return 1;
    }
    if (id === 10) {
      const th = prm[0] - (prm[1] * x + prm[2] * y);
      const c = Math.cos(th), s = Math.sin(th);
      const L = prm2[0] * (1 - prm2[1] + prm2[1] * c);
      out[0] = x + c * z * L; out[1] = y + s * z * L; out[2] = 0;
      const cr = Math.max(c, 0);
      return prm2[2] + prm2[3] * cr * cr * cr;
    }
    if (id === 11) {
      const cell = Math.floor(aux);
      const cx = (Math.floor(cell / 5) - 1) * prm2[0];
      const qx = x - cx, qy = z;
      const cd = Math.cos(prm[0]), sd = Math.sin(prm[0]);
      out[0] = cx + qx * cd + qy * sd; out[2] = (qy * cd - qx * sd) * prm2[1];
      const sf = (aux - cell) / 0.9;
      const w = Math.pow(0.5 + 0.5 * Math.cos(6.2831853 * (sf - prm[1])), prm[2]);
      return prm[3] + prm2[3] * w;
    }
    if (id === 12) {
      const d1 = Math.hypot(x - prm[0], y - prm[1]);
      const d2 = Math.hypot(x - prm[0], y + prm[1]);
      const a = 0.5 * (Math.sin(prm[2] - prm[3] * d1) +
                       Math.sin(prm[2] - prm[3] * d2));
      out[2] = z + a * prm2[3];
      return prm2[0] + prm2[1] * Math.pow(Math.max(a, 0), prm2[2]);
    }
    if (id === 14) {
      let age = (prm[0] - aux / 16) % 1;
      if (age < 0) age += 1;
      return prm[2] + prm[3] * Math.pow(1 - age, prm[1]);
    }
    if (id === 17) {                        // seam runners: theta from the
      const g = Math.min(3, Math.floor(aux));   // seam's [t0, phi] window
      const frac = (aux - g) / 0.9;
      const th = prm2[g] + (prm[g] - prm2[g]) * frac;
      out[0] = Math.cos(th); out[1] = Math.sin(th); out[2] = 0;
      return 1;
    }
    if (id === 22) {                        // path chips: brightness only
      const ln = Math.floor(aux);
      const f = (aux - ln) / 0.9;
      const K = Math.max(prm2[0], 1);
      const ph = prm[0] + ln * prm2[1];
      const x = f * K - ph;
      const sl = Math.floor(x);
      const fc = Math.min(1, Math.max(0, (sl + 0.5 + ph) / K));
      const tri = 1 - Math.abs(2 * fc - 1);
      const m = prm2[2] > 0.001 ? 1 - prm2[2] + prm2[2] * tri : 1;
      const inc = Math.abs(x - sl - 0.5) <= prm[1] * m * K ? 1 : 0;
      return prm[3] + prm2[3] * inc;
    }
    if (id === 24) {                        // square tunnel: scale/twist/z
      const lv = Math.floor(aux);
      const K = Math.max(prm2[0], 1);
      const q = lv + prm[0];
      const tw = prm[2] * q * (prm[3] > 0.5 && lv % 2 ? -1 : 1);
      const c = Math.cos(tw), s = Math.sin(tw);
      const rx = x * c - y * s, ry = x * s + y * c;
      if (prm2[1] > 0) {
        out[0] = rx * prm2[2]; out[1] = ry * prm2[2];
        out[2] = (q - K + 1) * prm2[1];
      } else {
        const sc = Math.exp(q * prm[1]) * prm2[2];
        out[0] = rx * sc; out[1] = ry * sc; out[2] = 0;
      }
      const fi = Math.min(1, Math.max(0, q / 0.9));
      const fo = Math.min(1, Math.max(0, (q - (K - 1.4)) / 1.25));
      return fi * fi * (3 - 2 * fi) * (1 - fo * fo * (3 - 2 * fo));
    }
    if (id === 26) {                        // helix glide: the travelling lens
      const fam = Math.floor(aux);
      const u = (aux - fam) / 0.9;
      const sp = Math.max(prm[1], 1e-4);
      const q = (u - (prm[0] - sp)) / sp;
      const w = Math.pow(q >= 0 && q <= 1 ? Math.sin(Math.PI * q) : 0,
                         Math.max(prm2[2], 0.05))
              * Math.pow(Math.max(Math.min(q, 1 - q) * 2, 1e-4), Math.max(prm2[3], 0));
      if (fam < 0.5) return prm[3];
      out[0] = x + nx * prm[2] * w;
      out[1] = y + ny * prm[2] * w;
      out[2] = z + nz * prm[2] * w;
      return prm2[0] * w;
    }
    if (id === 35) {                        // depth blocks — JS mirror
      // the same eye the shader uses, so a frozen bake lands where it looked
      const cp = this.camera ? this.camera.position : { x: 0, y: 0, z: 3.55 };
      let q = ((aux - Math.floor(aux)) / 0.9 + prm[0]) % 1; if (q < 0) q += 1;
      const cr = Math.cos(prm2[2]), sr = Math.sin(prm2[2]);
      const sx = x * cr - y * sr, sy = x * sr + y * cr;
      const sz = prm[1] - prm[2] + q * prm[2];
      const d = Math.max(Math.hypot(cp.x - sx, cp.y - sy, cp.z - sz), 1e-3);
      const r = Math.max(Math.hypot(cp.x, cp.y, cp.z - prm[1]), 1e-3);
      const k = Math.pow(Math.min(r / d, 1), Math.max(prm2[1], 0));
      const side = prm2[0] * k;
      const e = Math.max(prm2[3], 1e-3);
      const ss = (v) => { const u = Math.min(1, Math.max(0, v)); return u * u * (3 - 2 * u); };
      out[0] = sx + ny * side * 0.5;
      out[1] = sy + nz * side * 0.5;
      out[2] = sz;
      return ss(q / e) * (1 - ss((q - (1 - e)) / e)) * Math.max(k, 0.04);
    }
    if (id === 36) {                        // star blocks — JS mirror, same
      // eye and same camera frame the shader billboards against
      const cr = Math.cos(prm[0]), sr = Math.sin(prm[0]);
      const sx = x * cr + z * sr, sy = y, sz = -x * sr + z * cr;
      if (nx < 0.5) { out[0] = sx; out[1] = sy; out[2] = sz; return 1; }
      const cam = this.camera;
      const cp = cam ? cam.position : { x: 0, y: 0, z: 3.55 };
      const d = Math.max(Math.hypot(cp.x - sx, cp.y - sy, cp.z - sz), 1e-3);
      const r = Math.max(Math.hypot(cp.x, cp.y, cp.z), 1e-3);
      let u = Math.min(1.2, Math.max(-1.2, (r - d) / Math.max(prm2[0], 1e-3)));
      u = Math.sign(u) * Math.pow(Math.abs(u), Math.max(prm2[1], 0.05));
      const k = Math.min(Math.max(Math.pow(2, u * Math.max(prm[2], 0)),
                                  Math.min(prm2[3], prm2[2])), prm2[2]);
      let rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0;
      if (cam) {
        const e = cam.matrixWorldInverse.elements;
        rx = e[0]; ry = e[4]; rz = e[8];
        ux = e[1]; uy = e[5]; uz = e[9];
      }
      const side = prm[1] * k * 0.5;
      out[0] = sx + (rx * ny + ux * nz) * side;
      out[1] = sy + (ry * ny + uy * nz) * side;
      out[2] = sz + (rz * ny + uz * nz) * side;
      return Math.min(Math.max(k, 0.05), 1.6);
    }
    if (id === 37) {                        // star life — JS mirror of the
      // whole cycle: same clock, same staggers, same eye
      const eio = EASE_FNS[0];
      const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const stag = (p_, o, w) => eio(cl((p_ - o * (1 - w)) / w, 0, 1));
      const sstep = (a, b2, x2) => {
        const q = cl((x2 - a) / (b2 - a), 0, 1); return q * q * (3 - 2 * q);
      };
      const u_ = prm2[1] - Math.floor(prm2[1]);
      const pat = Math.floor(prm2[2] / 100);
      const R = Math.max(prm2[2] % 100, 1);
      const W = Math.max(prm2[3] - Math.floor(prm2[3]), 0.04);
      const L = Math.max(Math.floor(prm2[3]), 1);
      const cr = Math.cos(prm[0]), sr = Math.sin(prm[0]);
      if (nx < 0.5) {
        const fr = (aux - Math.floor(aux)) / 0.9;
        const o = R <= 1 ? 0 : Math.floor(aux) / (R - 1);
        const reach = Math.min(
          stag(cl(u_ / 0.16, 0, 1), o, 0.55),
          1 - stag(cl((u_ - 0.88) / 0.12, 0, 1), o, 0.55));
        out[0] = x * cr + z * sr; out[1] = y; out[2] = -x * sr + z * cr;
        return (1 - sstep(reach - 0.03, reach, fr))
             * (1 + 2.2 * Math.exp(-Math.abs(reach - fr) * 26));
      }
      const ord = (aux - Math.floor(aux)) / 0.9;
      const env = Math.min(
        stag(cl((u_ - 0.15) / 0.21, 0, 1), ord, W),
        1 - stag(cl((u_ - 0.74) / 0.16, 0, 1), ord, W));
      const uC = cl((u_ - 0.36) / 0.38, 0, 1);
      let scl = env;
      let qx = x, qy = y, qz = z;
      if (pat === 0) {
        qx = x * env; qy = y * env; qz = z * env;
      } else if (pat === 1) {
        const f2 = (v) => v - Math.floor(v);
        const dd = Math.abs(f2(f2(uC * L) - ord + 0.5) - 0.5);
        scl = env * (1 + 0.45 * eio(cl(1 - dd / 0.12, 0, 1))
          * sstep(0, 0.06, uC) * (1 - sstep(0.94, 1, uC)));
      } else {
        const tri = 1 - Math.abs(2 * (uC * L - Math.floor(uC * L)) - 1);
        const v = eio(cl(1 - Math.abs(tri - ord) / (0.05 + 0.3 * W), 0, 1));
        scl = eio(cl((u_ - 0.15) / 0.21, 0, 1))
            * (1 - eio(cl((u_ - 0.85) / 0.15, 0, 1))) * v;
      }
      const sx = qx * cr + qz * sr, sy = qy, sz = -qx * sr + qz * cr;
      const cam = this.camera;
      const cp = cam ? cam.position : { x: 0, y: 0, z: 3.55 };
      const d = Math.max(Math.hypot(cp.x - sx, cp.y - sy, cp.z - sz), 1e-3);
      const r = Math.max(Math.hypot(cp.x, cp.y, cp.z), 1e-3);
      const w2 = cl((r - d) / Math.max(prm2[0], 1e-3), -1.2, 1.2);
      const k = cl(Math.pow(2, w2 * Math.max(prm[2], 0)), 0.05, 2.5);
      let rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0;
      if (cam) {
        const e = cam.matrixWorldInverse.elements;
        rx = e[0]; ry = e[4]; rz = e[8];
        ux = e[1]; uy = e[5]; uz = e[9];
      }
      const side = prm[1] * k * scl * 0.5;
      out[0] = sx + (rx * ny + ux * nz) * side;
      out[1] = sy + (ry * ny + uy * nz) * side;
      out[2] = sz + (rz * ny + uz * nz) * side;
      return cl(k, 0.05, 1.6) * (scl <= 0.001 ? 0 : Math.pow(scl, 0.6));
    }
    if (id === 38) {                        // star life x — JS mirror
      const eio = EASE_FNS[0];
      const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const stag = (p_, o, w) => eio(cl((p_ - o * (1 - w)) / w, 0, 1));
      const sstep = (a, b2, x2) => {
        const q = cl((x2 - a) / (b2 - a), 0, 1); return q * q * (3 - 2 * q);
      };
      const fr2 = (v) => v - Math.floor(v);
      const u_ = fr2(prm2[1]);
      const pat = Math.floor(prm2[2] / 100);
      const R = Math.max(prm2[2] % 100, 1);
      const W = Math.max(fr2(prm2[3]), 0.04);
      const L = Math.max(Math.floor(prm2[3]), 1);
      const cr = Math.cos(prm[0]), sr = Math.sin(prm[0]);
      const br = pat === 4
        ? 0.18 + 1.55 * eio(cl(u_ / 0.30, 0, 1))
                      * (1 - eio(cl((u_ - 0.72) / 0.26, 0, 1)))
        : 1;
      const ai = pat === 0 ? 0.42 : 0.15;
      const ao = pat === 0 ? 0.42 : 0.12;
      const line = Math.floor(aux);
      const fx = fr2(aux) / 0.9;
      const o = R <= 1 ? 0 : line / (R - 1);
      const reach = Math.min(
        stag(cl(u_ / ai, 0, 1), o, 0.55),
        1 - stag(cl((u_ - (1 - ao)) / ao, 0, 1), o, 0.55));
      if (nx < 0.5) {
        const zz = z * br;
        out[0] = x * cr + zz * sr; out[1] = y; out[2] = -x * sr + zz * cr;
        return (1 - sstep(reach - 0.03, reach, fx))
             * (1 + 2.2 * Math.exp(-Math.abs(reach - fx) * 26));
      }
      let scl = 0;
      let qx = x, qy = y, qz = z;
      if (pat === 0) {
        scl = eio(cl((reach - fx) / (0.04 + 0.12 * W), 0, 1));
      } else if (pat === 1) {
        scl = Math.min(
          stag(cl((u_ - 0.14) / 0.36, 0, 1), fx, W),
          1 - stag(cl((u_ - 0.60) / 0.28, 0, 1), fx, W));
        qx = x * scl; qy = y * scl; qz = z * scl;
      } else if (pat === 2) {
        const tri = 1 - Math.abs(2 * fr2(cl((u_ - 0.18) / 0.66, 0, 1) * L) - 1);
        scl = eio(cl((u_ - 0.13) / 0.14, 0, 1))
            * (1 - eio(cl((u_ - 0.86) / 0.12, 0, 1)))
            * eio(cl(1 - Math.abs(tri - fx) / (0.04 + 0.22 * W), 0, 1));
      } else if (pat === 3) {
        const ck = fr2(cl((u_ - 0.16) / 0.70, 0, 1) * L * 0.999);
        scl = eio(cl((u_ - 0.12) / 0.12, 0, 1))
            * (1 - eio(cl((u_ - 0.87) / 0.11, 0, 1)))
            * eio(cl(1 - Math.abs(ck - fx) / (0.03 + 0.20 * W), 0, 1));
      } else {
        const ph = cl((u_ - 0.12) / 0.80, 0, 1) * L + o;
        const tri = 1 - Math.abs(2 * fr2(ph) - 1);
        scl = eio(cl((u_ - 0.10) / 0.14, 0, 1))
            * (1 - eio(cl((u_ - 0.88) / 0.11, 0, 1)))
            * eio(cl(1 - Math.abs(tri - fx) / (0.05 + 0.22 * W), 0, 1));
      }
      qz *= br;
      const sx = qx * cr + qz * sr, sy = qy, sz = -qx * sr + qz * cr;
      const cam = this.camera;
      const cp = cam ? cam.position : { x: 0, y: 0, z: 3.55 };
      const d = Math.max(Math.hypot(cp.x - sx, cp.y - sy, cp.z - sz), 1e-3);
      const r = Math.max(Math.hypot(cp.x, cp.y, cp.z), 1e-3);
      const w2 = cl((r - d) / Math.max(prm2[0], 1e-3), -1.2, 1.2);
      const k = cl(Math.pow(2, w2 * Math.max(prm[2], 0)),
                   pat === 4 ? 0.14 : 0.04, 3.6);
      let rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0;
      if (cam) {
        const e = cam.matrixWorldInverse.elements;
        rx = e[0]; ry = e[4]; rz = e[8];
        ux = e[1]; uy = e[5]; uz = e[9];
      }
      const side = prm[1] * k * scl * 0.5;
      out[0] = sx + (rx * ny + ux * nz) * side;
      out[1] = sy + (ry * ny + uy * nz) * side;
      out[2] = sz + (rz * ny + uz * nz) * side;
      return cl(k, 0.05, 1.9) * (scl <= 0.001 ? 0 : Math.pow(scl, 0.6));
    }
    if (id === 39) {                        // star flow — JS mirror
      const eio = EASE_FNS[0];
      const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const fr2 = (v) => v - Math.floor(v);
      const sstep = (a, b2, x2) => {
        const q = cl((x2 - a) / (b2 - a), 0, 1); return q * q * (3 - 2 * q);
      };
      const u_ = fr2(prm2[1]);
      const R = Math.max(prm2[2] % 100, 1);
      const pat = Math.floor(prm2[2] / 100) % 100;
      const cnt = Math.max(Math.floor(prm2[2] / 10000), 1);
      const W = Math.max(fr2(prm2[3]), 0.04);
      const L = Math.max(Math.floor(prm2[3]), 1);
      const cr = Math.cos(prm[0]), sr = Math.sin(prm[0]);
      const zs = pat === 2 ? (1 - W) + W * Math.cos(2 * Math.PI * u_) : 1;
      const sy = pat === 3 ? 0.35 * Math.sin(2 * Math.PI * u_) : 0;
      const cy = Math.cos(sy), sn = Math.sin(sy);
      if (nx < 0.5) {
        const xx = x * cy - y * sn, yy = x * sn + y * cy, zz = z * zs;
        out[0] = xx * cr + zz * sr; out[1] = yy; out[2] = -xx * sr + zz * cr;
        let rb = pat === 2 ? 1 : 0.85;
        if (pat === 6) {
          const pl = fr2(u_ + Math.floor(aux) / Math.max(R, 1));
          const re = Math.min(eio(cl(pl / 0.14, 0, 1)),
                              1 - eio(cl((pl - 0.86) / 0.14, 0, 1)));
          const fq = fr2(aux) / 0.9;
          rb *= (1 - sstep(re - 0.03, re, fq))
              * (1 + 2.2 * Math.exp(-Math.abs(re - fq) * 26));
        }
        return rb;
      }
      const line = Math.floor(aux);
      const fx = fr2(aux) / 0.9;
      let scl = 0;
      if (pat === 0) {
        const d = Math.abs(fr2(fx * cnt - u_ * L + 0.5) - 0.5) * 2;
        scl = eio(cl(1 - d / Math.max(W, 1e-3), 0, 1))
            * sstep(0.02, 0.16, fx) * (1 - sstep(0.86, 0.995, fx));
      } else if (pat === 1) {
        const r = Math.abs(fx - 0.5) * 2;
        const pw = 0.06 + 0.22 * W;
        let eIn = 0;
        if (line < 0.5 && fx > 0.5 && u_ > 0.04 && u_ < 0.46) {
          const pos = 1 - eio(cl((u_ - 0.04) / 0.38, 0, 1));
          eIn = eio(cl(1 - Math.abs(r - pos) / pw, 0, 1));
        }
        let eOut = 0;
        if (u_ > 0.44) {
          const ro = eio(cl((u_ - 0.44) / 0.44, 0, 1));
          eOut = eio(cl(1 - Math.abs(r - ro) / pw, 0, 1))
               * (1 - sstep(0.90, 0.995, ro));
        }
        const fl = Math.exp(-Math.abs(u_ - 0.44) * 30) * (1 - sstep(0, 0.35, r));
        scl = Math.max(Math.max(eIn, eOut), Math.min(fl * 1.2, 1));
      } else if (pat === 2) {
        scl = 1;
      } else if (pat === 3) {
        const R2 = Math.max(R, 1);
        const d = Math.abs(fr2(fx * cnt - u_ * L + line / R2 + 0.5) - 0.5) * 2;
        scl = eio(cl(1 - d / Math.max(W, 1e-3), 0, 1))
            * sstep(0.02, 0.16, fx) * (1 - sstep(0.86, 0.995, fx));
      } else if (pat === 4) {
        const tp = fr2(u_ * L);
        const tri = 1 - Math.abs(2 * tp - 1);
        const dir = tp < 0.5 ? 1 : -1;
        const dd = (fx - tri) * dir;
        const head = eio(cl(1 - Math.abs(dd) / 0.05, 0, 1));
        const tail = dd < 0 ? Math.exp(dd / (0.06 + 0.25 * W)) * 0.7 : 0;
        scl = Math.max(head, tail);
      } else if (pat === 5) {
        const d = Math.abs(fr2(fx * cnt + u_ * L + 0.5) - 0.5) * 2;
        scl = eio(cl(1 - d / Math.max(W, 1e-3), 0, 1))
            * sstep(0.02, 0.10, fx) * (1 - sstep(0.90, 0.995, fx));
        const sw = Math.exp(-fr2(u_ * L) * 5);
        scl = Math.max(scl, sw * (1 - sstep(0, 0.12, fx)));
      } else if (pat === 6) {
        const pl = fr2(u_ + line / Math.max(R, 1));
        const re = Math.min(eio(cl(pl / 0.14, 0, 1)),
                            1 - eio(cl((pl - 0.86) / 0.14, 0, 1)));
        scl = eio(cl((re - fx) / 0.10, 0, 1));
      } else if (pat === 7) {
        const v = fx * cnt - u_ * L;
        const sid = ((Math.floor(v) % L) + L) % L;
        const h = fr2(Math.sin((sid + line * 7) * 127.1) * 43758.5453);
        const du = h < 0.55 ? 0.16 : 0.42;
        const pq = fr2(v);
        scl = pq < du ? eio(cl(Math.min(pq, du - pq) / 0.05, 0, 1)) : 0;
        scl *= sstep(0.02, 0.10, fx);
      } else if (pat === 8) {
        const h1 = fr2(Math.sin(fx * 917 + line * 31) * 43758.5453);
        const pq = fr2(u_ * L + h1);
        const wd = 0.10 + 0.25 * W;
        scl = pq < wd ? eio(cl(Math.min(pq, wd - pq) / (wd * 0.4), 0, 1)) : 0;
      } else if (pat === 9) {
        scl = 1;
      } else if (pat === 10) {
        const legs = u_ * R * L;
        const lg = Math.floor(legs);
        const legU = fr2(legs);
        const cur = ((lg % R) + R) % R;
        if (Math.abs(line - cur) > 0.5) {
          scl = 0;
        } else {
          const e = eio(legU);
          const dir = lg % 2 === 0 ? 1 : -1;
          const pos = dir > 0 ? e : 1 - e;
          const dd = (fx - pos) * dir;
          const hd = eio(cl(1 - Math.abs(dd) / 0.045, 0, 1));
          const tl = dd < 0
            ? Math.exp(dd / (0.05 + 0.22 * W)) * 0.65
              * (1 - sstep(0.82, 0.98, legU)) : 0;
          const born = eio(cl(legU / 0.08, 0, 1));
          const gone = 1 - eio(cl((legU - 0.94) / 0.06, 0, 1));
          scl = Math.max(hd, tl) * born * gone;
        }
      } else {                              // EMIT — JS mirror
        const stg = Math.floor(prm2[2] / 10000) / 99;
        const hl = fr2(Math.sin(line * 127.1) * 43758.5453);
        const ep = fr2(u_ * L + hl * stg);
        const pos = eio(ep);
        const hd = eio(cl(1 - Math.abs(fx - pos) / (0.04 + 0.14 * W), 0, 1));
        scl = hd * eio(cl(ep / 0.05, 0, 1)) * (1 - sstep(0.90, 0.995, pos));
      }
      const qx0 = x * cy - y * sn, qy0 = x * sn + y * cy;
      const qz = z * zs;
      const sx = qx0 * cr + qz * sr, sy2 = qy0, sz = -qx0 * sr + qz * cr;
      const cam = this.camera;
      const cp = cam ? cam.position : { x: 0, y: 0, z: 3.55 };
      const d2 = Math.max(Math.hypot(cp.x - sx, cp.y - sy2, cp.z - sz), 1e-3);
      const r2 = Math.max(Math.hypot(cp.x, cp.y, cp.z), 1e-3);
      const w2 = cl((r2 - d2) / Math.max(prm2[0], 1e-3), -1.2, 1.2);
      const k = cl(Math.pow(2, w2 * Math.max(prm[2], 0)), 0.08, 2.8);
      let rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0;
      if (cam) {
        const e = cam.matrixWorldInverse.elements;
        rx = e[0]; ry = e[4]; rz = e[8];
        ux = e[1]; uy = e[5]; uz = e[9];
      }
      const side = prm[1] * k * scl * 0.5;
      out[0] = sx + (rx * ny + ux * nz) * side;
      out[1] = sy2 + (ry * ny + uy * nz) * side;
      out[2] = sz + (rz * ny + uz * nz) * side;
      return cl(k, 0.05, 1.7) * (scl <= 0.001 ? 0 : Math.pow(scl, 0.6));
    }
    if (id === 32) {                        // helix train — JS mirror
      const f = (aux - Math.floor(aux)) / 0.9;
      const cr = Math.cos(prm[0]), sr = Math.sin(prm[0]);
      const sx = x * cr + z * sr, sy = y, sz = -x * sr + z * cr;
      if (nx < 0.5) { out[0] = sx; out[1] = sy; out[2] = sz; return 1; }
      const len = Math.max(prm2[2] - Math.floor(prm2[2]), 1e-3);
      const tap = Math.max(Math.floor(prm2[2]) / 20, 0.05);
      const n = Math.min(Math.floor(prm2[3]) / 50, 0.9) * len;
      const cnt = Math.max(Math.floor(prm[1] / 8), 1);
      const ss = (v) => { const q = Math.min(1, Math.max(0, v)); return q * q * (3 - 2 * q); };
      let w = 0;
      for (let ti = 0; ti < cnt; ti++) {
        let d = (prm[2] - f - ti / cnt) % 1; if (d < 0) d += 1;   // behind this head
        const wi = d < n
          ? ss(d / Math.max(n, 1e-4))
          : Math.pow(1 - ss((d - n) / Math.max(len - n, 1e-4)), tap);
        w = Math.max(w, wi);
      }
      const span = Math.max(prm[1] - cnt * 8, 1e-4);
      const c = Math.min(1, Math.max(0, 0.5 + sz / (2 * span)));
      const g = Math.pow(c, Math.max(prm2[1], 0.01));
      const vari = (prm2[3] - Math.floor(prm2[3])) * 2;
      const jit = 1 + vari * (((Math.sin(f * 311.7) * 43758.5453) % 1 + 1) % 1 - 0.5) * 2;
      const amt = w * (0.35 + 0.65 * g) * Math.max(jit, 0.05);
      out[0] = sx + ny * prm2[0] * amt * 0.5;
      out[1] = sy + nz * prm2[0] * amt * 0.5;
      out[2] = sz;
      return Math.max(w, 0.04);
    }
    if (id === 29) {                        // helix blocks — JS mirror
      const f = (aux - Math.floor(aux)) / 0.9;
      const a29 = f * prm2[3] * 6.2831853 + prm[0];
      const sx = Math.cos(a29) * prm[1], sy = prm[2] * 0.5 - prm[2] * f,
            sz = Math.sin(a29) * prm[1];
      if (nx < 0.5) { out[0] = sx; out[1] = sy; out[2] = sz; return 1; }
      const c = Math.min(1, Math.max(0, 0.5 + sz / (2 * Math.max(prm[1], 1e-4))));
      const on = Math.min(0.99, Math.max(0, prm2[2]));
      const g = Math.pow(Math.min(1, Math.max(0, (c - on) / Math.max(1 - on, 1e-4))),
                         Math.max(prm2[1], 0.01));
      out[0] = sx + ny * prm2[0] * g * 0.5;
      out[1] = sy + nz * prm2[0] * g * 0.5;
      out[2] = sz;
      return Math.max(g, 0.04);
    }
    if (id === 28) {                        // scene 10 spiral — JS mirror of
      const n = Math.max(prm2[3], 2);       // the hand projection above
      const i = Math.floor(aux);
      const u = (aux - i) / 0.9;
      const focal = prm[1] * 1.6;
      const at = (k) => {
        const frac = k / Math.max(n - 1, 1);
        const ang = k * nz + prm[0];
        const f = focal / (focal + prm[1] * Math.sin(ang));
        return [prm[1] * Math.cos(ang) * f, -(frac - 0.5) * prm[2] * f, f];
      };
      const Pi = at(i);
      if (nx < 0.5) {
        const Pn = at(Math.min(i + 1, n - 1));
        out[0] = Pi[0] + (Pn[0] - Pi[0]) * u;
        out[1] = Pi[1] + (Pn[1] - Pi[1]) * u;
        out[2] = 0;
        return 1;
      }
      const cw = prm2[0] * Pi[2];
      const x = (Math.sin(i / Math.max(prm2[1], 1e-3) - prm2[2]) + 1) * 0.5;
      const np = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      const finalR = Math.max(cw * 0.375 * (0.05 + np * 0.35), cw * 0.0167);
      const side = Math.min(2 * finalR * 0.70710678 * 4.5, cw * 0.78);
      out[0] = Pi[0] + (2 * u - 1) * side * 0.5;
      out[1] = Pi[1] + ny * side * 0.5;
      out[2] = 0;
      return 1;
    }
    if (id === 23) {                        // crystal chips: brightness only
      const si = Math.floor(aux);
      const n = Math.max(prm2[0], 1);
      const dd = Math.abs((((prm[0] - (si + 0.5) / n + 0.5) % 1) + 1) % 1 - 0.5);
      const p = Math.min(1, Math.max(0, 1 - dd / Math.max(prm2[1], 1e-3)));
      const e = (p <= 0 ? 0 : p >= 1 ? 1 :
        (p < 0.5 ? 0.5 * Math.pow(2, 20 * p - 10)
                 : 1 - 0.5 * Math.pow(2, 10 - 20 * p))) * (si <= n - 0.5 ? 1 : 0);
      return prm[3] + prm2[3] * e;
    }
    return 1;
  }

  /** The moire coincidence brightness, from the GROUP-ROTATED position. */
  _moireBeat(p, slot) {
    const sp = slot.prm[0];
    const wrap = (v) => (((v + sp / 2) % sp) + sp) % sp - sp / 2;
    const near = 1 - Math.hypot(wrap(p[0]), wrap(p[1])) / (sp / 2);
    let m = Math.min(1, Math.max(0, (near - slot.prm[1]) / 0.22));
    m = m * m * (3 - 2 * m);
    return slot.prm[2] + slot.prm[3] * m * Math.max(near, 0);
  }

  /** Freeze the in-flight blend into slot A (positions through their group
      matrices, brightness through the group multipliers / asset lighting,
      swirl + scatter included) so a new target can take over mid-transition
      without a jump. */
  _bakeCurrentIntoA() {
    const N = this.N, ease = EASE_FNS[this.easeIndex];
    const pa = this.aPosA.array, pb = this.aPosB.array;
    const na = this.aNrmA.array, nb = this.aNrmB.array;
    const aux = this.aAux.array, bri = this.aBri.array, keys = this.aKey.array;
    const seeds = this.aSeed.array;
    const gA = this.slotA.grp, gB = this.slotB.grp;
    const bgA = this.slotA.gbri, bgB = this.slotB.gbri;
    const frozen = this.frozenA;
    const aIsAsset = !frozen && this.modeA.id === ASSET_MODE_ID;
    const bIsAsset = this.modeB.id === ASSET_MODE_ID;
    const swirl = this.swirl, scatter = this.scatter;
    const rot = (g, k, x, y, z, o) => {
      const b = k * 9;
      o[0] = g[b] * x + g[b + 3] * y + g[b + 6] * z;
      o[1] = g[b + 1] * x + g[b + 4] * y + g[b + 7] * z;
      o[2] = g[b + 2] * x + g[b + 5] * y + g[b + 8] * z;
    };
    const tmpA = [0, 0, 0], tmpB = [0, 0, 0], tmpN = [0, 0, 0], sd = [0, 0, 0];
    const pd = [0, 0, 0], tmpF = [0, 0, 0];
    const hasPath = this.pathMode !== 0 && this.pathAmp > 1e-4;
    const idA = frozen ? 0 : this.modeA.id;
    const idB = this.modeB.id;
    const isGrid = (id) => (id >= 10 && id <= 14) || id === 17 ||
                           (id >= 19 && id <= 24) || id === 26 ||
                           id === 28 || id === 29 || id === 32 || id === 35 ||
                           id === 36 || id === 37 || id === 38 || id === 39;
    const gridA = isGrid(idA), gridB = isGrid(idB);
    // fields whose aux packs an index (line, cell, ray, family) rather than a
    // group id — they force group 0, exactly as the shader branches do
    const flat = (id) => id === 11 || id === 14 || id === 19 || id === 20 ||
                         id === 22 || id === 23 || id === 24 || id === 26 ||
                         id === 28 || id === 29 || id === 32 || id === 35 ||
                         id === 36 || id === 37 || id === 38 || id === 39;
    for (let i = 0; i < N; i++) {
      const local = Math.min(1, Math.max(0,
        (this.prog - keys[i] * this.spread) / Math.max(1e-4, 1 - this.spread)));
      const e = ease(local);
      let kA = Math.min(3, Math.floor(aux[2 * i]));
      let kB = Math.min(3, Math.floor(aux[2 * i + 1]));
      if (flat(idA)) kA = 0;
      if (flat(idB)) kB = 0;
      let fA = 1, fB = 1;
      if (frozen) { tmpA[0] = pa[3 * i]; tmpA[1] = pa[3 * i + 1]; tmpA[2] = pa[3 * i + 2]; }
      else if (gridA) {
        fA = this._gridField(idA, pa[3 * i], pa[3 * i + 1], pa[3 * i + 2],
                             na[3 * i], na[3 * i + 1], na[3 * i + 2],
                             aux[2 * i], this.slotA, tmpF);
        rot(gA, kA, tmpF[0], tmpF[1], tmpF[2], tmpA);
        if (idA === 13 && kA === 1) fA = this._moireBeat(tmpA, this.slotA);
      }
      else rot(gA, kA, pa[3 * i], pa[3 * i + 1], pa[3 * i + 2], tmpA);
      if (gridB) {
        fB = this._gridField(idB, pb[3 * i], pb[3 * i + 1], pb[3 * i + 2],
                             nb[3 * i], nb[3 * i + 1], nb[3 * i + 2],
                             aux[2 * i + 1], this.slotB, tmpF);
        rot(gB, kB, tmpF[0], tmpF[1], tmpF[2], tmpB);
        if (idB === 13 && kB === 1) fB = this._moireBeat(tmpB, this.slotB);
      }
      else rot(gB, kB, pb[3 * i], pb[3 * i + 1], pb[3 * i + 2], tmpB);

      let bA = bri[2 * i] * (frozen ? 1 : bgA[kA]) * fA;
      if (aIsAsset) {
        rot(gA, 0, na[3 * i], na[3 * i + 1], na[3 * i + 2], tmpN);
        bA = this._assetShade(bA, tmpN[0], tmpN[1], tmpN[2],
                              tmpA[0], tmpA[1], tmpA[2],
                              this.slotA.prm, this.slotA.prm2);
      }
      let bB = bri[2 * i + 1] * bgB[kB] * fB;
      if (bIsAsset) {
        rot(gB, 0, nb[3 * i], nb[3 * i + 1], nb[3 * i + 2], tmpN);
        bB = this._assetShade(bB, tmpN[0], tmpN[1], tmpN[2],
                              tmpB[0], tmpB[1], tmpB[2],
                              this.slotB.prm, this.slotB.prm2);
      }

      let px = tmpA[0] + (tmpB[0] - tmpA[0]) * e;
      let py = tmpA[1] + (tmpB[1] - tmpA[1]) * e;
      let pz = tmpA[2] + (tmpB[2] - tmpA[2]) * e;
      if (hasPath) {
        this._pathDisplace(tmpA, tmpB, e, seeds[i], pd);
        px += pd[0]; py += pd[1]; pz += pd[2];
      }
      const sw = swirl * Math.sin(Math.PI * e);
      if (Math.abs(sw) > 1e-5) {
        const cs = Math.cos(sw), sn = Math.sin(sw);
        const rx = cs * px + sn * pz, rz = -sn * px + cs * pz;
        px = rx; pz = rz;
      }
      if (Math.abs(this.rotExtra) > 1e-5) {
        const cs = Math.cos(this.rotExtra), sn = Math.sin(this.rotExtra);
        const rx = cs * px + sn * pz, rz = -sn * px + cs * pz;
        px = rx; pz = rz;
      }
      if (scatter > 0) {
        seedDirJS(seeds[i], sd);
        const amp = scatter * Math.sin(Math.PI * e);
        px += sd[0] * amp; py += sd[1] * amp; pz += sd[2] * amp;
      }
      pa[3 * i] = px;
      pa[3 * i + 1] = py;
      pa[3 * i + 2] = pz;
      bri[2 * i] = (bA + (bB - bA) * e)
        // the vanish gate, mirrored — a mid-cut bake stays dark where the eye
        // saw dark
        * (this.easeIndex === 5 && local > 0.5 && local < 0.9999 ? 0 : 1);
      aux[2 * i] = 0;
    }
    // slot A becomes a static generic snapshot: identity groups, unit bri
    this.slotA.grp.fill(0);
    for (let k = 0; k < 4; k++) { this.slotA.grp[k * 9] = 1; this.slotA.grp[k * 9 + 4] = 1; this.slotA.grp[k * 9 + 8] = 1; }
    this.slotA.gbri.set([1, 1, 1, 1]);
    this.frozenA = true;
  }

  update(t, dt) {
    const u = this.material.uniforms;
    if (this.prog < 1) {
      this.prog = Math.min(1, this.prog + dt / this.duration);
      if (this.prog >= 1) {
        // settle: B becomes the resident layout; A mirrors it
        this.aPosA.array.set(this.aPosB.array);
        this.aNrmA.array.set(this.aNrmB.array);
        const aux = this.aAux.array, bri = this.aBri.array;
        for (let i = 0; i < this.N; i++) { aux[2 * i] = aux[2 * i + 1]; bri[2 * i] = bri[2 * i + 1]; }
        this.aPosA.needsUpdate = true;
        this.aNrmA.needsUpdate = true;
        this.aAux.needsUpdate = true;
        this.aBri.needsUpdate = true;
        this.modeA = this.modeB;
        this.frozenA = false;
        u.uModeA.value = this.modeB.id;
      }
    }

    if (!this.frozenA) this.modeA.update(this.slotA, paramValues(this.modeA), t);
    this.modeB.update(this.slotB, paramValues(this.modeB), t);

    this._lastT = t;
    u.uTime.value = t;
    u.uProg.value = this.prog;
    u.uSpread.value = this.spread;
    u.uEase.value = this.easeIndex;
    u.uScatter.value = this.scatter;
    u.uSwirl.value = this.swirl;
    u.uPath.value = this.pathMode;
    u.uPathAmp.value = this.pathAmp;
    u.uRotExtra.value = this.rotExtra;
    u.uFade.value = this.fade;
    this._pushSlot(this.slotA, u.uGrpA.value, u.uGBriA.value, u.uPrmA.value, u.uPrm2A.value);
    this._pushSlot(this.slotB, u.uGrpB.value, u.uGBriB.value, u.uPrmB.value, u.uPrm2B.value);
  }
}
