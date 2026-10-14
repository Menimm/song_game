import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from '../public/js/transport.js';

test('position advances with the clock while playing and holds while paused', () => {
  const t = new Transport(100);
  t.start(10, 1000);
  assert.equal(t.position(1005), 15);
  t.pause(1005);
  assert.equal(t.playing, false);
  assert.equal(t.position(2000), 15);
});

test('toggle resumes from where it paused; at the end it restarts from 0', () => {
  const t = new Transport(100);
  t.start(10, 0); t.pause(5);
  assert.equal(t.toggle(50), true);
  assert.equal(t.position(52), 17);
  t.pause(200);                                   // ran past the end -> clamped to duration
  assert.equal(t.pos, 100);
  assert.equal(t.toggle(300), true);
  assert.equal(t.position(300), 0);
});

test('seek while playing keeps playing from the new spot; while paused it only moves the marker', () => {
  const t = new Transport(100);
  t.start(0, 0);
  t.seek(60, 10);
  assert.equal(t.playing, true);
  assert.equal(t.position(12), 62);
  t.pause(12); t.seek(5, 20);
  assert.equal(t.playing, false);
  assert.equal(t.position(99), 5);
});

test('seek is clamped to the track and position never exceeds the duration', () => {
  const t = new Transport(30);
  t.seek(-5, 0); assert.equal(t.pos, 0);
  t.seek(999, 0); assert.equal(t.pos, 30);
  t.start(25, 0); assert.equal(t.position(100), 30);
});
