import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTags } from '../src/library/tags.js';
import { ingestFile } from '../src/library/ingest.js';
import { LibraryStore } from '../src/library/store.js';

async function env() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ing-'));
  const config = { songsDir: path.join(dir, 'songs') };
  const store = new LibraryStore(path.join(dir, 'songs.json')); await store.load();
  const src = path.join(dir, 'src.flac'); await fs.writeFile(src, 'not really audio');
  return { dir, config, store, src };
}

test('readTags falls back to the file/folder name when the file cannot be parsed', async () => {
  const t = await readTags('/does/not/exist.mp3', "CD_RIPs/Gazoz - The 20 Hits/01 - Gazoz - Nine O'Clock.flac");
  assert.equal(t.artist, 'Gazoz'); assert.equal(t.title, "Nine O'Clock"); assert.equal(t.picture, null);
});

test('ingest copies the file, stores the entry and writes cover art', async () => {
  const { config, store, src } = await env();
  const fake = async () => ({ title: 'חללית', artist: 'גזוז', album: '20 הלהיטים', picture: { data: Buffer.from([1, 2, 3]), ext: 'jpg' } });
  const song = await ingestFile({ abs: src, srcRel: 'a/b.flac', config, store, readTags: fake });
  assert.match(song.file, /^s_[0-9a-f]{8}\.flac$/);
  assert.equal(await fs.readFile(path.join(config.songsDir, song.file), 'utf8'), 'not really audio');
  assert.equal(song.art, 'jpg');
  assert.deepEqual([...await fs.readFile(path.join(config.songsDir, 'art', `${song.id}.jpg`))], [1, 2, 3]);
  assert.equal(song.srcRel, 'a/b.flac');
  assert.equal(store.get(song.id).title, 'חללית');
  assert.equal(song.lang, 'he');
});

test('ingest without art leaves art null', async () => {
  const { config, store, src } = await env();
  const song = await ingestFile({ abs: src, srcRel: 'x.flac', config, store, readTags: async () => ({ title: 'T', artist: 'A', album: '', picture: null }) });
  assert.equal(song.art, null);
});
