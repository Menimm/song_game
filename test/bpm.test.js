import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBpm } from '../public/js/bpm.js';

function clicks(bpm, secs = 20, sr = 8000) {
  const x = new Float32Array(secs * sr);
  const step = (60 / bpm) * sr;
  for (let t = 0; t < (secs * bpm) / 60; t++) {
    const start = Math.round(t * step);
    for (let i = 0; i < 200 && start + i < x.length; i++) x[start + i] = Math.exp(-i / 40) * Math.sin(i * 0.8);
  }
  return x;
}

for (const bpm of [90, 100, 120, 128, 140, 160]) {
  test(`click track at ${bpm} BPM is estimated within 3 BPM`, () => {
    const got = estimateBpm(clicks(bpm), 8000);
    assert.ok(Math.abs(got - bpm) <= 3, `expected ~${bpm}, got ${got}`);
  });
}

test('silence and tiny inputs give null', () => {
  assert.equal(estimateBpm(new Float32Array(8000 * 20), 8000), null);
  assert.equal(estimateBpm(new Float32Array(100), 8000), null);
});
