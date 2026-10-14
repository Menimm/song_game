import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { config as base } from '../config.js';

const fast = { ladderMs: [50, 100, 150, 200, 250], preRoundMs: 30, answerMs: 150, ackTimeoutMs: 500, preloadTimeoutMs: 1000 };

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  const songsDir = path.join(dir, 'songs'); await fs.mkdir(songsDir, { recursive: true });
  const decoys = [{ title: 'X1' }, { title: 'X2' }, { title: 'X3' }];
  const songs = ['A', 'B', 'C', 'D'].map((x, i) => ({ id: `s${i}`, title: `Song ${x}`, artist: `Art ${x}`, file: `s${i}.mp3`, distractors: decoys }));
  await fs.writeFile(path.join(dir, 'songs.json'), JSON.stringify({ songs }));
  const app = await createApp({ config: { ...base, ...fast, dataDir: dir, songsDir } });
  const port = await app.listen(0);
  return { app, port };
}

function client(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  const open = new Promise((r) => ws.on('open', r));
  const send = (m) => ws.send(JSON.stringify(m));
  return { ws, msgs, open, send, cmd: (c, args = {}) => send({ t: 'cmd', c, args }) };
}
async function waitFor(msgs, pred, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = msgs.findLast(pred);
    if (m) return m;
    if (Date.now() > end) throw new Error('timeout waiting for message');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('a full round over WebSocket: join, play, answer, reveal, score', async () => {
  const { app, port } = await boot();
  const host = client(port); await host.open; host.send({ t: 'hello', role: 'host' });
  const phone = client(port); await phone.open;
  phone.send({ t: 'hello', role: 'player', code: app.game.code.toLowerCase(), name: 'מאי' });
  const joined = await waitFor(phone.msgs, (m) => m.t === 'joined');
  assert.equal(joined.name, 'מאי');

  host.cmd('startRound', { songId: 's0' });
  await waitFor(host.msgs, (m) => m.t === 'preload'); host.cmd('hostReady');
  await waitFor(host.msgs, (m) => m.t === 'play_step'); host.cmd('stepStarted');
  const open = await waitFor(host.msgs, (m) => m.t === 'state' && m.s.phase === 'open');
  const phoneOpen = await waitFor(phone.msgs, (m) => m.t === 'state' && m.s.phase === 'open');
  assert.equal(JSON.stringify(phoneOpen.s).includes('correctIndex'), false);   // never leaked mid-round
  phone.send({ t: 'answer', i: open.s.round.correctIndex });
  const done = await waitFor(phone.msgs, (m) => m.t === 'state' && m.s.phase === 'revealed');
  assert.equal(done.s.you.score, 100);
  assert.equal(done.s.reveal.title, 'Song A');
  await app.close();
});

test('wrong code is refused; a dropped phone resumes by token', async () => {
  const { app, port } = await boot();
  const bad = client(port); await bad.open;
  bad.send({ t: 'hello', role: 'player', code: 'ZZZZ', name: 'x' });
  assert.equal((await waitFor(bad.msgs, (m) => m.t === 'error')).e, 'bad_code');

  const p1 = client(port); await p1.open;
  p1.send({ t: 'hello', role: 'player', code: app.game.code, name: 'דנה' });
  const { token } = await waitFor(p1.msgs, (m) => m.t === 'joined');
  p1.ws.close();
  const p2 = client(port); await p2.open;
  p2.send({ t: 'hello', role: 'player', code: app.game.code, token });
  const again = await waitFor(p2.msgs, (m) => m.t === 'joined');
  assert.equal(again.name, 'דנה');
  await app.close();
});

test('a tunnelled client cannot act as host or tv; tunnelled HTTP gets 404 for private pages', async () => {
  const { app, port } = await boot();
  const spoof = { 'cf-connecting-ip': '5.5.5.5' };
  const h = client(port, spoof); await h.open;
  h.send({ t: 'hello', role: 'host' });
  assert.equal((await waitFor(h.msgs, (m) => m.t === 'error')).e, 'forbidden');

  for (const p of ['/host', '/tv', '/manage', '/songs/s0.mp3', '/api/manage/library', '/js/host.js']) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: spoof });
    assert.equal(r.status, 404, p);
  }
  const join = await fetch(`http://127.0.0.1:${port}/api/join`, { headers: spoof });
  assert.equal(join.status, 200);
  assert.equal((await join.json()).code, app.game.code);
  await app.close();
});

test('a WebSocket from a foreign web page (cross-site Origin) is refused; same-origin is accepted', async () => {
  const { app, port } = await boot();
  const refused = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: 'http://evil.example' } });
    ws.on('open', () => resolve('open'));
    ws.on('error', () => resolve('refused'));
    ws.on('close', () => resolve('refused'));
  });
  assert.equal(refused, 'refused');
  const ok = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { origin: `http://127.0.0.1:${port}` } });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('error', () => resolve('refused'));
  });
  assert.equal(ok, 'open');
  await app.close();
});

test('missing song file at preload flags the song unavailable and the game continues', async () => {
  const { app, port } = await boot();
  const host = client(port); await host.open; host.send({ t: 'hello', role: 'host' });
  host.cmd('startRound', { songId: 's1' });
  await waitFor(host.msgs, (m) => m.t === 'preload');
  host.cmd('preloadFailed', { reason: '404' });
  await waitFor(host.msgs, (m) => m.t === 'state' && m.s.phase === 'idle' && m.s.notices.length === 1);
  assert.equal(app.store.get('s1').unavailable, true);
  host.cmd('startRound', { songId: 's2' });
  await waitFor(host.msgs, (m) => m.t === 'preload');
  await app.close();
});
