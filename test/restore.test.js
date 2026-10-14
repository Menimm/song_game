import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LibraryStore } from '../src/library/store.js';
import { restoreMissing } from '../src/library/restore.js';

test('restore copies missing song files from the music share, keeps existing ones, reports what it cannot find', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rest-'));
  const music = path.join(dir, 'music'); await fs.mkdir(music, { recursive: true });
  await fs.writeFile(path.join(music, 'a.mp3'), 'AUDIO-A');
  const config = { songsDir: path.join(dir, 'songs') };
  await fs.mkdir(config.songsDir, { recursive: true });
  await fs.writeFile(path.join(config.songsDir, 'have.mp3'), 'KEEP');
  const store = new LibraryStore(path.join(dir, 'songs.json')); await store.load();
  const missing = await store.add({ title: 'Missing', file: 's_1.mp3', srcRel: 'a.mp3', unavailable: true });
  await store.add({ title: 'Present', file: 'have.mp3', srcRel: 'zzz.mp3' });
  await store.add({ title: 'Gone', file: 's_3.mp3', srcRel: 'nope.mp3' });
  await store.add({ title: 'Uploaded', file: 's_4.mp3', srcRel: '' });          // came from a drag-and-drop: no source to restore from

  const resolve = (rel) => (rel ? path.join(music, rel) : null);
  const r = await restoreMissing({ config, store, resolve, readTags: async () => ({ picture: null }) });

  assert.deepEqual(r.restored, ['Missing']);
  assert.deepEqual(r.missing.sort(), ['Gone', 'Uploaded']);
  assert.equal(await fs.readFile(path.join(config.songsDir, 's_1.mp3'), 'utf8'), 'AUDIO-A');
  assert.equal(await fs.readFile(path.join(config.songsDir, 'have.mp3'), 'utf8'), 'KEEP');
  assert.equal(store.get(missing.id).unavailable, false);                           // a restored song is playable again
});

test('restore also brings back missing cover art', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rest-'));
  const music = path.join(dir, 'music'); await fs.mkdir(music, { recursive: true });
  await fs.writeFile(path.join(music, 'a.mp3'), 'AUDIO');
  const config = { songsDir: path.join(dir, 'songs') };
  const store = new LibraryStore(path.join(dir, 'songs.json')); await store.load();
  const s = await store.add({ id: 's_9', title: 'T', file: 's_9.mp3', srcRel: 'a.mp3', art: 'jpg' });
  await restoreMissing({ config, store, resolve: (rel) => path.join(music, rel), readTags: async () => ({ picture: { data: Buffer.from([7, 8]), ext: 'jpg' } }) });
  assert.deepEqual([...await fs.readFile(path.join(config.songsDir, 'art', `${s.id}.jpg`))], [7, 8]);
});
