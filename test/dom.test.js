import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalTimer, secs } from '../public/js/dom.js';

test('LocalTimer counts down locally from the last server value', () => {
  let t = 0;
  const lt = new LocalTimer(() => t);
  assert.equal(lt.value(), null);
  lt.update({ remainingMs: 9000, totalMs: 9000, running: true });
  t = 2500;
  assert.equal(lt.value().remainingMs, 6500);
  t = 99999;
  assert.equal(lt.value().remainingMs, 0);
});

test('a paused timer does not move; secs rounds up', () => {
  let t = 0;
  const lt = new LocalTimer(() => t);
  lt.update({ remainingMs: 6000, totalMs: 9000, running: false });
  t = 5000;
  assert.equal(lt.value().remainingMs, 6000);
  assert.equal(secs(6001), 7);
  assert.equal(secs(0), 0);
});
