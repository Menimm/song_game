import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';

test('ladder and points line up and match the spec', () => {
  assert.deepEqual(config.ladderMs, [1000, 2000, 4000, 8000, 15000]);
  assert.deepEqual(config.points, [100, 80, 60, 40, 20]);
  assert.equal(config.ladderMs.length, config.points.length);
  assert.equal(config.wrongPenalty, 10);
  assert.equal(config.maxSteps, 5);
});

test('music dir and pin have sane defaults', () => {
  assert.ok(config.musicDir.length > 0);
  assert.match(config.pin, /^\d{4}$/);
});
