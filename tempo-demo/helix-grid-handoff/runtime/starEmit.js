// Measured from the reference recording: azimuth, depth angle, relative reach,
// launch offset and rate. These are editable preset values, not sampled animation.
const LINES = [
  [137.6364, 55.5256, 1.02764, 0.04724, 1],
  [109.5595, -50.8735, 0.95945, 0.34938, 1],
  [69.8293, -68.7609, 0.99522, 0.20073, 1],
  [103.1975, 73.4427, 0.9942, 0.11967, 1],
  [15.2711, -64.647, 1.07706, 0.28436, 1],
  [179.0685, 37.3727, 1.2375, 0.9885, 1],
];

const scalar = (value, min, max, step) => ({ value, min, max, step });
const lineParams = Object.fromEntries(LINES.flatMap(([tilt, turn, reach, offset, rate], i) => [
  [`tilt ${i + 1}`, scalar(tilt, -180, 180, 0.1)],
  [`turn ${i + 1}`, scalar(turn, -89, 89, 0.1)],
  [`reach ${i + 1}`, scalar(reach, 0.1, 1.5, 0.01)],
  [`offset ${i + 1}`, scalar(offset, 0, 1, 0.001)],
  [`rate ${i + 1}`, scalar(rate, 0.25, 2, 0.001)],
]));

function hash01(i) {
  let h = (i * 2654435761) >>> 0;
  h ^= h >> 13;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

export const starEmit = {
  key: "star-emit", label: "star emit", statusName: "SPARKING", id: 40,
  regen: ["rays", "len", "angle", "patch", "line", "seed", "ink", "trail", "wire", ...Object.keys(lineParams)],
  params: {
    rays: scalar(6, 2, 6, 1),
    len: scalar(1.6, 0.4, 2.6, 0.01),
    spin: scalar(0.170072, -1, 1, 0.001),
    cycle: scalar(2.272, 0.25, 20, 0.001),
    phase: scalar(0, 0, 1, 0.001),
    stagger: scalar(1, 0, 1, 0.001),
    size: scalar(0.012, 0.005, 0.3, 0.001),
    trail: scalar(0.14, 0, 0.5, 0.005),
    boost: scalar(0.3, 0, 4, 0.05),
    ink: scalar(0.45, 0.05, 2, 0.05),
    halo: scalar(10, 0, 20, 0.5),
    fade: scalar(0.18, 0.001, 0.4, 0.001),
    angle: scalar(0, -180, 180, 1),
    line: scalar(150, 24, 400, 1),
    wire: scalar(0.55, 0.1, 2, 0.05),
    patch: scalar(5, 3, 15, 2),
    seed: scalar(1, 0, 99, 1),
    ...lineParams,
  },
  gen(N, P) {
    const R = Math.min(LINES.length, Math.max(2, Math.round(P.rays)));
    // Reserve every arm before increasing its sampling density. The old
    // station layout exhausted the pool and silently dropped later rays.
    const budget = Math.floor(N / (R * 2));
    const G = Math.max(3, Math.min(Math.round(P.patch) | 1,
      (Math.floor(Math.sqrt(budget * 0.55)) - 1) | 1));
    const count = Math.max(2, Math.min(Math.round(P.line), budget - G * G));
    const pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3);
    const aux = new Float32Array(N), bri = new Float32Array(N);
    let at = 0;
    const put = (p, normal, id, light) => {
      pos.set(p, at * 3); nrm.set(normal, at * 3);
      aux[at] = id; bri[at++] = light;
    };
    for (let k = 0; k < R; k++) {
      const az = (P[`tilt ${k + 1}`] + P.angle) * Math.PI / 180;
      const el = P[`turn ${k + 1}`] * Math.PI / 180;
      const len = P.len * P[`reach ${k + 1}`];
      const d = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
      for (const side of [1, -1]) {
        const tip = d.map(v => v * len * side);
        for (let j = 0; j < count; j++) {
          const f = (j + 1) / count;
          put(tip.map(v => v * f), [0, 0, 0], k,
            P.wire * (0.3 + 0.7 * Math.min(1, f / 0.14)));
        }
        for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
          const seed = P.seed * 977 + k * 193 + (side + 1) * 419 + y * 31 + x * 7;
          const jitter = 0.45 * 2 / (G - 1);
          put(tip, [1 + Math.min(P[`offset ${k + 1}`], 0.9999),
            (x / (G - 1) * 2 - 1 + (hash01(seed + 5) - 0.5) * jitter) * P.trail * 0.5,
            y / (G - 1) * 2 - 1 + (hash01(seed + 11) - 0.5) * jitter], P[`rate ${k + 1}`], P.ink);
        }
      }
    }
    // Unused slots stay dark so changing the pool cannot amplify the ink.
    return { pos, nrm, aux, bri };
  },
  update(S, P, t) {
    for (let k = 0; k < 4; k++) S.grp.set([1, 0, 0, 0, 1, 0, 0, 0, 1], k * 9);
    S.gbri.set([1, 1, 1, 1]);
    S.prm.set([t * P.spin, P.size, P.boost, P.halo]);
    const clock = t / Math.max(0.01, P.cycle) + P.phase;
    S.prm2.set([P.len, clock, P.stagger, P.fade]);
  },
};
