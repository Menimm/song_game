import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { config as base } from '../config.js';

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'man-'));
  const music = path.join(dir, 'music');
  for (const f of ['Gazoz/01 - Gazoz - Nine.mp3', 'Gazoz/02 - Gazoz - Spaceship.mp3', 'Pop/Taylor Swift - Shake It Off.flac', 'Pop/Katy Perry - Roar.flac']) {
    const p = path.join(music, f); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, 'audio-bytes');
  }
  const config = { ...base, musicDir: music, dataDir: path.join(dir, 'data'), songsDir: path.join(dir, 'songs') };
  const app = await createApp({ config });
  await app.index.refresh();
  const port = await app.listen(0);
  const call = (p, opts = {}) => fetch(`http://127.0.0.1:${port}/api/manage${p}`, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  return { app, port, call, config };
}

test('search, add (copies the file), edit, reorder and delete', async () => {
  const { app, call, config } = await boot();
  const found = (await (await call('/search?q=gazoz+nine')).json()).results;
  assert.equal(found.length, 1);
  assert.equal(found[0].added, false);

  const add = await call('/add', { method: 'POST', body: JSON.stringify({ rel: found[0].rel }) });
  assert.equal(add.status, 201);
  const song = await add.json();
  assert.equal(song.title, 'Nine'); assert.equal(song.artist, 'גזוז'); assert.equal(song.lang, 'he');   // Israeli artist -> Hebrew name
  assert.equal(await fs.readFile(path.join(config.songsDir, song.file), 'utf8'), 'audio-bytes');

  const again = await (await call('/add', { method: 'POST', body: JSON.stringify({ rel: found[0].rel }) })).json();
  assert.equal(again.id, song.id);                                              // not duplicated
  assert.equal(app.store.list().length, 1);
  assert.equal((await (await call('/search?q=gazoz+nine')).json()).results[0].added, true);

  const patched = await (await call(`/song/${song.id}`, { method: 'PATCH', body: JSON.stringify({ hook: 'לה לה', offsetMs: 1500, file: 'evil' }) })).json();
  assert.equal(patched.hook, 'לה לה'); assert.equal(patched.offsetMs, 1500); assert.equal(patched.file, song.file);
  assert.equal((await call('/song/nope', { method: 'PATCH', body: '{}' })).status, 404);

  const second = await (await call('/add', { method: 'POST', body: JSON.stringify({ rel: 'Pop/Katy Perry - Roar.flac' }) })).json();
  await call('/reorder', { method: 'POST', body: JSON.stringify({ ids: [second.id, song.id] }) });
  assert.deepEqual((await (await call('/library')).json()).songs.map((s) => s.title), ['Roar', 'Nine']);

  assert.equal((await call(`/song/${song.id}`, { method: 'DELETE' })).status, 200);
  await assert.rejects(fs.access(path.join(config.songsDir, song.file)));
  await app.close();
});

test('paths outside the music root and non-audio files are refused everywhere', async () => {
  const { app, call } = await boot();
  const bads = ['../outside.mp3', 'Pop/../../x.mp3', 'notes.txt', '', null, 5];
  if (process.platform === 'win32') bads.push('C:\\Windows\\a.mp3');
  for (const rel of bads) {
    const r = await call('/add', { method: 'POST', body: JSON.stringify({ rel }) });
    assert.equal(r.status, 400, String(rel));
  }
  assert.equal((await call(`/preview?rel=${encodeURIComponent('../../etc/passwd.mp3')}`)).status, 400);
  assert.equal((await call(`/preview?rel=${encodeURIComponent('Pop/missing.mp3')}`)).status, 404);
  assert.equal((await call('/add', { method: 'POST', body: JSON.stringify({ rel: 'Pop/ghost.mp3' }) })).status, 404);
  assert.equal(app.store.list().length, 0);
  await app.close();
});

test('preview streams a real NAS file; upload accepts audio only', async () => {
  const { app, call, config } = await boot();
  const prev = await call(`/preview?rel=${encodeURIComponent('Pop/Katy Perry - Roar.flac')}`);
  assert.equal(prev.status, 200);
  assert.equal(await prev.text(), 'audio-bytes');

  const bad = await call('/upload?name=evil.exe', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'MZ' });
  assert.equal(bad.status, 400);
  const traversal = await call('/upload?name=' + encodeURIComponent('../../x.mp3'), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'abc' });
  assert.equal(traversal.status, 201);                                          // name is reduced to its basename, stored under songs/
  const up = await traversal.json();
  assert.ok((await fs.readdir(config.songsDir)).includes(up.file));
  assert.equal((await fs.readdir(config.songsDir)).some((n) => n.startsWith('.upload-')), false);
  await app.close();
});

test('tunnelled requests cannot reach the manage API', async () => {
  const { app, port } = await boot();
  const r = await fetch(`http://127.0.0.1:${port}/api/manage/library`, { headers: { 'cf-connecting-ip': '9.9.9.9' } });
  assert.equal(r.status, 404);
  await app.close();
});

test('suggest returns three wrong answers that are not the song itself; suggest-all fills gaps only', async () => {
  const { app, call } = await boot();
  const a = await app.store.add({ title: 'Roar', artist: 'Katy Perry', file: 'x.mp3', distractors: [{ title: 'Keep Me', artist: '' }] });
  await app.store.add({ title: 'Shake It Off', artist: 'Taylor Swift', file: 'y.mp3' });
  const s = await (await call(`/song/${a.id}/suggest`)).json();
  assert.equal(s.distractors.length, 3);
  assert.ok(s.distractors.every((d) => d.title !== 'Roar'));
  const r = await (await call('/suggest-all', { method: 'POST', body: '{}' })).json();
  assert.equal(r.updated, 2);
  const lib = (await (await call('/library')).json()).songs;
  assert.equal(lib[0].distractors[0].title, 'Keep Me');
  assert.ok(lib.every((x) => x.distractors.length === 3));
  await app.close();
});

test('hebrewize shows Hebrew songs with Hebrew letters (incl. wrong answers); English songs stay Latin', async () => {
  const { app, call } = await boot();
  const he = await app.store.add({ title: 'Tikitas', artist: 'Noa Kirel, Stephane Legar, Arisa', file: 'a.mp3', lang: 'en', distractors: [{ title: 'Unicorn', artist: 'Noa Kirel' }] });
  const en = await app.store.add({ title: 'Roar', artist: 'Katy Perry', file: 'b.mp3' });
  const r = await (await call('/hebrewize', { method: 'POST', body: '{}' })).json();
  assert.equal(r.updated, 1);
  const lib = (await (await call('/library')).json()).songs;
  const h = lib.find((s) => s.id === he.id);
  assert.deepEqual([h.title, h.artist, h.lang], ['טיקיטאס', 'נועה קירל, סטפן לגר, אריסה', 'he']);
  assert.deepEqual(h.distractors, [{ title: 'יוניקורן', artist: 'נועה קירל' }]);
  assert.deepEqual([lib.find((s) => s.id === en.id).title, lib.find((s) => s.id === en.id).artist], ['Roar', 'Katy Perry']);
  const s = await (await call(`/song/${he.id}/suggest`)).json();           // wrong answers for a Hebrew song are Hebrew-named
  assert.equal(s.distractors.length, 3);
  assert.ok(s.distractors.every((d) => /[֐-׿]/.test(d.title) && /[֐-׿]/.test(d.artist)), JSON.stringify(s.distractors));
  await app.close();
});

test('pasted lists are matched against the index and saved as the decoy pool', async () => {
  const { call, config, app } = await boot();
  const r = await (await call('/spotify/paste', { method: 'POST', body: JSON.stringify({ text: 'Roar - Katy Perry\nNo Such Song - Nobody' }) })).json();
  assert.equal(r.rows.length, 2);
  assert.match(r.rows[0].match.rel, /Roar/);
  assert.equal(r.rows[1].match, null);
  const saved = JSON.parse(await fs.readFile(path.join(config.dataDir, 'playlist.json'), 'utf8'));
  assert.equal(saved.length, 2);
  assert.equal((await call('/spotify/paste', { method: 'POST', body: JSON.stringify({ text: '   ' }) })).status, 400);
  await app.close();
});
