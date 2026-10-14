import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

function setup() {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const host = []; game.on('host', (m) => host.push(m));
  const a = game.join('אורי').player;
  const b = game.join('דנה').player;       // a second player, so one wrong answer does not lock "everyone" and end the step
  game.startRound({ songId: 's0' }); game.hostReady(); timers.advance(config.preRoundMs); game.stepStarted();
  return { game, timers, host, a, b };
}
const correct = (g) => g.snapshot('host').round.correctIndex;

test('pause freezes the countdown; resume continues from the same remaining time', () => {
  const { game, timers, host, a } = setup();
  timers.advance(3000);
  const before = game.snapshot('tv').timer.remainingMs;            // 1000 + 8000 - 3000
  assert.equal(before, 6000);
  game.pause();
  assert.equal(game.phase, 'paused');
  assert.deepEqual(host.at(-1), { t: 'pause' });
  timers.advance(60000);
  assert.equal(game.snapshot('tv').timer.remainingMs, 6000);
  assert.equal(game.snapshot('tv').timer.running, false);
  assert.equal(game.answer(a.id, correct(game)).error, 'closed');
  game.resume();
  assert.equal(game.phase, 'open');
  assert.deepEqual(host.at(-1), { t: 'resume' });
  timers.advance(2000);
  assert.equal(game.snapshot('tv').timer.remainingMs, 4000);
});

test('pausing the pre-round countdown also freezes it', () => {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  game.startRound({ songId: 's0' }); game.hostReady();
  timers.advance(2000); game.pause(); timers.advance(99999);
  assert.equal(game.snapshot('tv').timer.remainingMs, config.preRoundMs - 2000);
  assert.equal(game.snapshot('tv').options, null);                   // choices must not appear before any audio has played
  game.resume();
  assert.equal(game.phase, 'countdown');
});

test('replay restarts the same step, keeps lock-outs, and resumes audio first if paused', () => {
  const { game, host, a } = setup();
  game.answer(a.id, (correct(game) + 1) % 4);
  game.pause();
  game.replay();
  assert.deepEqual(host.slice(-2), [{ t: 'resume' }, { t: 'play_step', step: 0, lengthMs: 1000, offsetMs: 500 }]);
  assert.equal(game.phase, 'awaiting_audio');
  game.stepStarted();
  assert.equal(game.snapshot('player', a.id).you.locked, true);
});

test('nextStep lengthens the intro; on the last step it reveals', () => {
  const { game, host } = setup();
  game.nextStep();
  assert.equal(host.at(-1).step, 1);
  game.stepStarted(); game.nextStep(); game.stepStarted(); game.nextStep(); game.stepStarted(); game.nextStep();
  assert.equal(host.at(-1).step, 4);
  game.stepStarted(); game.nextStep();
  assert.equal(game.phase, 'revealed');
});

test('revealNow shows the answer without a winner; next returns to idle and stops audio', () => {
  const { game, host } = setup();
  game.revealNow();
  assert.equal(game.phase, 'revealed');
  assert.equal(game.snapshot('tv').reveal.title, 'Song A');
  game.next();
  assert.equal(game.phase, 'idle');
  assert.deepEqual(host.at(-1), { t: 'stop' });
  assert.equal(game.snapshot('tv').reveal, null);
});

test('skip abandons the round with no scoring', () => {
  const { game, host, a } = setup();
  game.skip();
  assert.equal(game.phase, 'idle');
  assert.equal(a.score, 0);
  assert.deepEqual(host.at(-1), { t: 'stop' });
});

test('starting a round straight from a reveal stops the previous audio first', () => {
  const { game, host } = setup();
  game.revealNow();
  game.startRound({ songId: 's1' });
  assert.deepEqual(host.slice(-2).map((m) => m.t), ['stop', 'preload']);
});

test('a phone that dropped and rejoined sees the same lock state and remaining time', () => {
  const { game, timers, a } = setup();
  game.answer(a.id, (correct(game) + 1) % 4);
  timers.advance(1500);
  game.disconnect(a.id);
  timers.advance(1000);
  game.join('ignored', a.token);
  const s = game.snapshot('player', a.id);
  assert.equal(s.you.locked, true);
  assert.equal(s.phase, 'open');
  assert.equal(s.timer.remainingMs, 9000 - 2500);
  assert.equal(s.options.length, 4);
});

test('setMaxSteps clamps to the ladder', () => {
  const { game } = setup();
  game.setMaxSteps(99); assert.equal(game.maxSteps, 5);
  game.setMaxSteps(0); assert.equal(game.maxSteps, 1);
});

test('countdown length defaults to 3s, is settable (1-10s) and drives the next round', () => {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const sfx = []; game.on('sfx', (...a) => sfx.push(a));
  assert.equal(config.preRoundMs, 3000);
  assert.equal(game.snapshot('host').preRoundSecs, 3);
  game.setPreRoundSecs(99); assert.equal(game.snapshot('host').preRoundSecs, 10);
  game.setPreRoundSecs(0); assert.equal(game.snapshot('host').preRoundSecs, 1);
  game.setPreRoundSecs(2);
  game.startRound({ songId: 's0' }); game.hostReady();
  assert.equal(game.snapshot('tv').timer.remainingMs, 2000);
  assert.deepEqual(sfx.at(-1), ['countdown', 2]);
  timers.advance(2000);
  assert.equal(game.phase, 'awaiting_audio');
});
