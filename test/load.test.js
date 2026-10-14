import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { config as base } from '../config.js';

const fast = { ladderMs: [50, 100, 150, 200, 250], preRoundMs: 30, answerMs: 300, ackTimeoutMs: 500, preloadTimeoutMs: 1000 };

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  return { ws, msgs, open: new Promise((r) => ws.on('open', r)), send: (m) => ws.send(JSON.stringify(m)) };
}
async function waitFor(msgs, pred, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = msgs.findLast(pred);
    if (m) return m;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('14 phones: everyone joins, 13 answer wrong, 1 answers right, all see the reveal and the right scores', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-'));
  const songsDir = path.join(dir, 'songs'); await fs.mkdir(songsDir, { recursive: true });
  const decoys = [{ title: 'X1' }, { title: 'X2' }, { title: 'X3' }];
  await fs.writeFile(path.join(dir, 'songs.json'), JSON.stringify({ songs: [{ id: 's0', title: 'Song A', artist: 'A', file: 's0.mp3', distractors: decoys }] }));
  const app = await createApp({ config: { ...base, ...fast, dataDir: dir, songsDir } });
  const port = await app.listen(0);

  const host = client(port); await host.open; host.send({ t: 'hello', role: 'host' }); host.send({ t: 'cmd', c: 'audioReady', args: {} });
  const phones = Array.from({ length: 14 }, () => client(port));
  await Promise.all(phones.map((p) => p.open));
  phones.forEach((p, i) => p.send({ t: 'hello', role: 'player', code: app.game.code, name: `בת ${i + 1}` }));
  await Promise.all(phones.map((p) => waitFor(p.msgs, (m) => m.t === 'joined')));

  host.send({ t: 'cmd', c: 'startRound', args: { songId: 's0' } });
  await waitFor(host.msgs, (m) => m.t === 'preload'); host.send({ t: 'cmd', c: 'hostReady', args: {} });
  await waitFor(host.msgs, (m) => m.t === 'play_step'); host.send({ t: 'cmd', c: 'stepStarted', args: {} });
  const open = await waitFor(host.msgs, (m) => m.t === 'state' && m.s.phase === 'open');
  const right = open.s.round.correctIndex;
  await Promise.all(phones.map((p) => waitFor(p.msgs, (m) => m.t === 'state' && m.s.phase === 'open')));

  phones.slice(0, 13).forEach((p) => p.send({ t: 'answer', i: (right + 1) % 4 }));
  await new Promise((r) => setTimeout(r, 30));
  phones[13].send({ t: 'answer', i: right });
  const finals = await Promise.all(phones.map((p) => waitFor(p.msgs, (m) => m.t === 'state' && m.s.phase === 'revealed')));
  assert.ok(finals.every((m) => m.s.leaderboard.length === 14));
  assert.equal(finals[13].s.you.score, 100);
  assert.equal(finals[0].s.you.score, 0);
  assert.equal(finals[0].s.reveal.winnerName, 'בת 14');
  await app.close();
});
