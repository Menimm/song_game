import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, cleanName, makeCode } from '../src/game/game.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

const mk = () => new Game({ config, getSongs: () => SONGS, timers: new FakeTimers(), rng: () => 0.3 });

test('join creates a player with a token', () => {
  const g = mk();
  const r = g.join('מאי');
  assert.equal(r.ok, true);
  assert.equal(r.player.name, 'מאי');
  assert.equal(r.player.score, 0);
  assert.ok(r.player.token.length >= 8);
});

test('two players with the same nickname stay distinct', () => {
  const g = mk();
  const a = g.join('דנה').player;
  const b = g.join('דנה').player;
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.name, b.name);
  assert.equal(b.name, 'דנה 2');
});

test('markup characters are stripped and names are capped at 16 characters', () => {
  assert.equal(cleanName('<script>alert(1)</script>'), 'script alert(1)');       // markup removed, capped at 16, trimmed
  assert.equal(Array.from(cleanName('א'.repeat(40))).length, 16);
  assert.equal(cleanName('   '), '');
});

test('empty names are refused', () => {
  assert.deepEqual(mk().join('  <> '), { ok: false, error: 'bad_name' });
});

test('rejoining with the token resumes the same player and keeps the score', () => {
  const g = mk();
  const p = g.join('גל').player;
  g.adjust(p.id, 40);
  g.disconnect(p.id);
  const r = g.join('whatever', p.token);
  assert.equal(r.resumed, true);
  assert.equal(r.player.id, p.id);
  assert.equal(r.player.score, 40);
  assert.equal(r.player.connected, true);
});

test('room is capped', () => {
  const g = new Game({ config: { ...config, maxPlayers: 2 }, getSongs: () => SONGS, timers: new FakeTimers() });
  g.join('a'); g.join('b');
  assert.deepEqual(g.join('c'), { ok: false, error: 'full' });
});

test('adjust never drops below zero; kick removes the player', () => {
  const g = mk();
  const p = g.join('נועה').player;
  g.adjust(p.id, -50);
  assert.equal(p.score, 0);
  g.kick(p.id);
  assert.equal(g.snapshot('tv').leaderboard.length, 0);
});

test('room codes are 4 digits, never starting with 0', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode(), /^[1-9]\d{3}$/);
  assert.equal(makeCode(() => 0), '1000');
  assert.equal(makeCode(() => 0.999999), '9999');
});

test('player snapshot has `you` and never leaks answers; tv snapshot has no `you`', () => {
  const g = mk();
  const p = g.join('מאי').player;
  const s = g.snapshot('player', p.id);
  assert.equal(s.phase, 'idle');
  assert.equal(s.you.name, 'מאי');
  assert.equal(s.you.rank, 1);
  assert.equal(g.snapshot('tv').you, undefined);
  assert.equal(JSON.stringify(s).includes('correctIndex'), false);
});
