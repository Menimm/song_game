import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsForStep, applyWrong, rankPlayers } from '../src/game/scoring.js';

const POINTS = [100, 80, 60, 40, 20];

test('points drop with every step', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => pointsForStep(i, POINTS)), POINTS);
});

test('steps beyond the table use the last value', () => {
  assert.equal(pointsForStep(9, POINTS), 20);
});

test('bad step throws', () => {
  assert.throws(() => pointsForStep(-1, POINTS));
  assert.throws(() => pointsForStep(1.5, POINTS));
});

test('wrong answer costs the penalty but never goes below zero', () => {
  assert.equal(applyWrong(100, 10), 90);
  assert.equal(applyWrong(5, 10), 0);
});

test('ranking: score desc, then name, ties share a rank', () => {
  const r = rankPlayers([
    { name: 'דנה', score: 50 },
    { name: 'אבי', score: 80 },
    { name: 'גל', score: 50 },
    { name: 'נועה', score: 10 },
  ]);
  assert.deepEqual(r.map((p) => [p.name, p.rank]), [['אבי', 1], ['גל', 2], ['דנה', 2], ['נועה', 4]]);
});
