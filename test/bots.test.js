import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { BotRunner } from '../src/game/bots.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

function mk(botRng) {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const bots = new BotRunner(game, { timers, rng: botRng });
  return { timers, game, bots };
}
function openStep0({ game, timers }) {
  game.startRound({ songId: 's0' }); game.hostReady(); timers.advance(config.preRoundMs); game.stepStarted();
}

test('spawn adds flagged bots; clear removes them', () => {
  const { game, bots } = mk(() => 0);
  bots.spawn(3);
  assert.equal(game.snapshot('host').players.filter((p) => p.bot).length, 3);
  assert.ok(game.snapshot('tv').leaderboard.every((p) => p.name.startsWith('בוט')));
  bots.clear();
  assert.equal(game.snapshot('host').players.length, 0);
});

test('an eager bot answers correctly and wins the round', () => {
  const ctx = mk(() => 0);
  ctx.bots.spawn(2);
  openStep0(ctx);
  ctx.timers.advance(500);
  assert.equal(ctx.game.phase, 'revealed');
  assert.ok(ctx.game.snapshot('tv').reveal.winnerName.startsWith('בוט'));
});

test('a shy bot never answers', () => {
  const ctx = mk(() => 0.99);
  ctx.bots.spawn(2);
  openStep0(ctx);
  ctx.timers.advance(6000);
  assert.equal(ctx.game.phase, 'open');
  assert.ok(ctx.game.snapshot('host').players.every((p) => p.score === 0));
});

test('a pending bot answer is dropped when the round was skipped', () => {
  const ctx = mk(() => 0);
  ctx.bots.spawn(1);
  openStep0(ctx);
  ctx.game.skip();
  ctx.timers.advance(10000);
  assert.equal(ctx.game.phase, 'idle');
});
