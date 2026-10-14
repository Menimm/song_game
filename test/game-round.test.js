import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

function setup(over = {}) {
  const timers = new FakeTimers();
  const game = new Game({ config: { ...config, ...over }, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const host = [];
  game.on('host', (m) => host.push(m));
  const a = game.join('אורי').player;
  const b = game.join('דנה').player;
  return { game, timers, host, a, b };
}
const correct = (g) => g.snapshot('host').round.correctIndex;
const wrong = (g) => (correct(g) + 1) % 4;

function toStep(ctx, step = 0, over = {}) {
  const { game, timers } = ctx;
  if (game.phase === 'idle' || game.phase === 'revealed') assert.equal(game.startRound({ songId: 's0', ...over }).ok, true);
  game.hostReady();
  timers.advance(config.preRoundMs);
  game.stepStarted();
  while (game.round.step < step) { game.nextStep(); game.stepStarted(); }
}

test('wrong answer: -10, locked for this step only, may answer again next step', () => {
  const ctx = setup(); const { game, timers, a } = ctx;
  game.adjust(a.id, 50);
  toStep(ctx, 0);
  assert.deepEqual(game.answer(a.id, wrong(game)), { ok: true, correct: false });
  assert.equal(a.score, 40);
  assert.equal(game.answer(a.id, correct(game)).error, 'locked');
  timers.advance(config.ladderMs[0] + config.answerMs);          // step 0 window ends
  assert.equal(game.phase, 'awaiting_audio');
  game.stepStarted();
  assert.equal(game.snapshot('player', a.id).you.locked, false);
  assert.equal(game.answer(a.id, correct(game)).correct, true);   // allowed again at step 1
  assert.equal(a.score, 40 + 80);
});

test('correct answer pays by step and ends the round with a reveal', () => {
  const ctx = setup(); const { game, host, a } = ctx;
  toStep(ctx, 2);
  const r = game.answer(a.id, correct(game));
  assert.deepEqual(r, { ok: true, correct: true, points: 60 });
  assert.equal(game.phase, 'revealed');
  assert.equal(game.snapshot('tv').reveal.winnerName, 'אורי');
  assert.deepEqual(host.at(-1), { t: 'full', offsetMs: 500 });
});

test('startRound sends preload, then countdown, then plays step 0 with the first ladder length', () => {
  const ctx = setup(); const { game, timers, host } = ctx;
  game.startRound({ songId: 's0' });
  assert.equal(game.phase, 'preloading');
  assert.deepEqual(host[0], { t: 'preload', song: { id: 's0', file: 's0.mp3', offsetMs: 500 } });
  game.hostReady();
  assert.equal(game.phase, 'countdown');
  assert.equal(game.snapshot('tv').timer.remainingMs, config.preRoundMs);
  timers.advance(config.preRoundMs);
  assert.equal(game.phase, 'awaiting_audio');
  assert.deepEqual(host.at(-1), { t: 'play_step', step: 0, lengthMs: 1000, offsetMs: 500 });
});

test('answer window opens only when the host acks; ack timeout opens it anyway', () => {
  const ctx = setup(); const { game, timers, a } = ctx;
  game.startRound({ songId: 's0' }); game.hostReady(); timers.advance(config.preRoundMs);
  assert.equal(game.answer(a.id, 0).error, 'closed');
  timers.advance(config.ackTimeoutMs);
  assert.equal(game.phase, 'open');
  assert.equal(game.snapshot('tv').timer.remainingMs, config.ladderMs[0] + config.answerMs);
});

test('step expiry lengthens the intro; after maxSteps the round is revealed with no winner', () => {
  const ctx = setup({ maxSteps: 2 }); const { game, timers, host } = ctx;
  toStep(ctx, 0);
  timers.advance(config.ladderMs[0] + config.answerMs);
  assert.equal(host.at(-1).lengthMs, 2000);
  game.stepStarted();
  timers.advance(config.ladderMs[1] + config.answerMs);
  assert.equal(game.phase, 'revealed');
  assert.equal(game.snapshot('tv').reveal.winnerId, null);
});

test('per-round maxSteps override beats the game default', () => {
  const ctx = setup(); const { game, timers } = ctx;
  toStep(ctx, 0, { maxSteps: 1 });
  timers.advance(config.ladderMs[0] + config.answerMs);
  assert.equal(game.phase, 'revealed');
});

test('when every connected player is locked the step ends early', () => {
  const ctx = setup(); const { game, a, b, host } = ctx;
  toStep(ctx, 0);
  game.answer(a.id, wrong(game));
  game.answer(b.id, wrong(game));
  assert.equal(game.phase, 'awaiting_audio');
  assert.equal(host.at(-1).step, 1);
});

test('options: 4 distinct, include the right title, hide correctness from players', () => {
  const ctx = setup(); const { game, a } = ctx;
  toStep(ctx, 0);
  const s = game.snapshot('player', a.id);
  assert.equal(s.options.length, 4);
  assert.equal(new Set(s.options.map((o) => o.title)).size, 4);
  assert.equal(s.options[correct(game)].title, 'Song A');
  assert.equal(JSON.stringify(s).includes('correctIndex'), false);
});

test('bad option index and answers outside the open window are rejected', () => {
  const ctx = setup(); const { game, a } = ctx;
  assert.equal(game.answer(a.id, 0).error, 'closed');
  toStep(ctx, 0);
  assert.equal(game.answer(a.id, 9).error, 'bad_option');
  assert.equal(game.answer(a.id, 1.5).error, 'bad_option');
});

test('random pick avoids repeats until the pool is used up', () => {
  const ctx = setup(); const { game } = ctx;
  const seen = new Set();
  for (let i = 0; i < SONGS.length; i++) {
    assert.equal(game.startRound({}).ok, true);
    seen.add(game.round.song.id);
    game.skip();
  }
  assert.equal(seen.size, SONGS.length);
});

test('preload timeout returns to idle with a notice and a song_unavailable event', () => {
  const ctx = setup(); const { game, timers } = ctx;
  const events = []; game.on('song_unavailable', (e) => events.push(e));
  game.startRound({ songId: 's0' });
  timers.advance(config.preloadTimeoutMs);
  assert.equal(game.phase, 'idle');
  assert.deepEqual(events, [{ songId: 's0', reason: 'timeout' }]);
  assert.equal(game.snapshot('host').notices.at(-1).songId, 's0');
});

test('not enough distinct options refuses to start', () => {
  const game = new Game({ config, getSongs: () => SONGS.slice(5), timers: new FakeTimers() });
  assert.deepEqual(game.startRound({ songId: 's5' }), { ok: false, error: 'not_enough_options' });
});
