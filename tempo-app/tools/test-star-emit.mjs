import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const app = new URL('../', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'three'
      ? { url: new URL('vendor/three.module.js', app).href, shortCircuit: true }
      : next(specifier, context);
  },
});
const { MODE_BY_KEY, featuredModes } = await import('../src/modes.js');
const { ParticleEngine } = await import('../src/particles.js');
const { clipRuntime } = await import('../src/sequence.js');
const { makeClip, defaultProject, normalizeProject } = await import('../src/store.js');
const mode = MODE_BY_KEY['star-emit'];
const params = Object.fromEntries(Object.entries(mode.params).map(([key, spec]) => [key, spec.value]));
const slot = () => ({ grp: new Float32Array(36), gbri: new Float32Array(4), prm: new Float32Array(4), prm2: new Float32Array(4) });
assert.ok(featuredModes().includes(mode));

// Every emitter must survive the minimum pool and the largest patch setting.
for (const N of [1024, 16384, 65536]) for (const patch of [3, 5, 15]) {
  const p = { ...params, patch, line: 400 };
  const layout = mode.gen(N, p);
  assert.deepEqual(layout, mode.gen(N, p));
  for (const array of Object.values(layout)) assert.ok(array.every(Number.isFinite));
  for (let ray = 1; ray <= 6; ray++) {
    const heads = [];
    for (let i = 0; i < N; i++) {
      if (Math.abs(layout.nrm[i * 3] - 1 - p[`offset ${ray}`]) < 1e-5) heads.push(i);
    }
    assert.ok(heads.length >= 18, `ray ${ray} lost an emitter at ${N}/${patch}`);
    const a = heads[0], b = heads[heads.length / 2];
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(layout.pos[a * 3 + axis] + layout.pos[b * 3 + axis]) < 1e-6);
  }
}

// A non-unit rate must keep its own clock across global cycle boundaries.
const p = { ...params, spin: 0, fade: .01 };
const state = slot(), out = [0, 0, 0];
for (const t of [-2, 0, .5, 2.272, 19.5, 200]) {
  mode.update(state, p, t);
  const rate = .73, offset = .21;
  const phase = t / p.cycle * rate + offset;
  const expected = phase - Math.floor(phase);
  ParticleEngine.prototype._gridField.call({ camera: null }, mode.id, 1, 0, 0, 1 + offset, 0, 0, rate, state, out);
  assert.ok(Math.abs(out[0] - expected) < 2e-5);
  assert.ok(Math.abs(out[1]) < 1e-6 && Math.abs(out[2]) < 1e-6);
}

const clip = makeClip('mode', mode.key, mode.label);
clip.params.trail = .2;
const first = clipRuntime(clip, 1024);
clip.params.trail = .3;
assert.notEqual(first.layout, clipRuntime(clip, 1024).layout);
const project = defaultProject(); project.clips = [clip];
const loaded = normalizeProject(JSON.parse(JSON.stringify(project)));
assert.equal(loaded.clips[0].params.trail, .3);
assert.equal(clipRuntime(loaded.clips[0], 1024).inst._values.trail, .3);
console.log('PASS: featured registration, deterministic geometry, all six paired emitters, minimum pool, independent clocks, CPU motion, parameter regeneration and project round-trip.');
