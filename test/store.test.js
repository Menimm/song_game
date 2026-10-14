import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LibraryStore } from '../src/library/store.js';

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
  const file = path.join(dir, 'songs.json');
  const s = new LibraryStore(file);
  await s.load();
  return { s, file };
}

test('missing file loads as empty; add persists with defaults and language', async () => {
  const { s, file } = await tmpStore();
  assert.deepEqual(s.list(), []);
  const a = await s.add({ title: 'תשע בכיכר', artist: 'גזוז', file: 'a.flac' });
  assert.match(a.id, /^s_[0-9a-f]{8}$/);
  assert.equal(a.lang, 'he'); assert.equal(a.enabled, true); assert.equal(a.offsetMs, 0); assert.deepEqual(a.distractors, []);
  const again = new LibraryStore(file); await again.load();
  assert.equal(again.list()[0].title, 'תשע בכיכר');
});

test('update whitelists fields and validates values', async () => {
  const { s } = await tmpStore();
  const a = await s.add({ title: 'Flowers', artist: 'Miley', file: 'f.flac' });
  const u = await s.update(a.id, {
    hook: 'x'.repeat(500), offsetMs: -5, bpm: 118, id: 'hack', file: '../../etc/passwd',
    distractors: [{ title: 'A', artist: 'a' }, { title: '', artist: 'b' }, { title: 'B' }, { title: 'C' }, { title: 'D' }],
  });
  assert.equal(u.id, a.id); assert.equal(u.file, 'f.flac');
  assert.equal(u.hook.length, 200); assert.equal(u.offsetMs, 0); assert.equal(u.bpm, 118);
  assert.deepEqual(u.distractors.map((d) => d.title), ['A', 'B', 'C']);
  assert.equal(await s.update('nope', { title: 'x' }), null);
});

test('enabled() hides disabled and unavailable songs; remove and reorder work', async () => {
  const { s } = await tmpStore();
  const [a, b, c] = [await s.add({ title: 'a', file: 'a' }), await s.add({ title: 'b', file: 'b' }), await s.add({ title: 'c', file: 'c' })];
  await s.update(b.id, { enabled: false });
  await s.update(c.id, { unavailable: true });
  assert.deepEqual(s.enabled().map((x) => x.title), ['a']);
  await s.reorder([c.id, a.id]);                         // ids not listed keep their relative order at the end
  assert.deepEqual(s.list().map((x) => x.title), ['c', 'a', 'b']);
  assert.equal(await s.remove(a.id), true);
  assert.equal(await s.remove(a.id), false);
});
