import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanMusic, IndexService } from '../src/library/indexer.js';

async function tree(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'music-'));
  for (const f of files) { const p = path.join(root, f); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, 'x'); }
  return root;
}
const FILES = ['גזוז/01 - חללית.flac', 'a/b/c.mp3', 'a/notes.txt', '@eaDir/x/thumb.mp3', 'a/._c.mp3', 'd/e.dsf', 'Z.M4A'];

test('scanMusic returns audio files only, relative with forward slashes, junk skipped', async () => {
  const root = await tree(FILES);
  assert.deepEqual(await scanMusic(root), ['Z.M4A', 'a/b/c.mp3', 'גזוז/01 - חללית.flac']);
});

test('scanMusic rejects when the root is missing (NAS not mounted)', async () => {
  await assert.rejects(scanMusic(path.join(os.tmpdir(), 'definitely-not-here-xyz')));
});

test('IndexService refreshes, caches to disk, reloads, and searches', async () => {
  const root = await tree(FILES);
  const cacheFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cache-')), 'index.json');
  const a = new IndexService({ root, cacheFile });
  await a.refresh();
  assert.equal(a.status().count, 3);
  assert.equal(a.status().building, false);
  const b = new IndexService({ root, cacheFile });
  await b.load();
  assert.equal(b.status().count, 3);
  assert.equal(b.search('חללית')[0].rel, 'גזוז/01 - חללית.flac');
});

test('a failed refresh keeps the old index and reports the error', async () => {
  const root = await tree(FILES);
  const cacheFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cache-')), 'index.json');
  const svc = new IndexService({ root, cacheFile });
  await svc.refresh();
  await fs.rm(root, { recursive: true });
  await svc.refresh();
  assert.equal(svc.status().count, 3);
  assert.ok(svc.status().error);
});

test('resolve works when the music root is a filesystem/share root that ends in a separator', () => {
  const root = path.parse(process.cwd()).root;                     // 'C:\\' on Windows, '/' elsewhere (same shape as \\\\NAS\\share)
  const svc = new IndexService({ root, cacheFile: path.join(os.tmpdir(), 'unused.json') });
  assert.equal(svc.resolve('some/dir/file.mp3'), path.join(root, 'some', 'dir', 'file.mp3'));
});

test('resolve refuses traversal, absolute escapes, wrong extensions and non-strings', async () => {
  const root = await tree(FILES);
  const svc = new IndexService({ root, cacheFile: path.join(root, 'index.json') });
  assert.equal(svc.resolve('../../etc/passwd.mp3'), null);
  assert.equal(svc.resolve('a/../../x.mp3'), null);
  assert.equal(svc.resolve('a/notes.txt'), null);
  assert.equal(svc.resolve(''), null);
  assert.equal(svc.resolve(42), null);
  if (process.platform === 'win32') assert.equal(svc.resolve('C:\\Windows\\win.mp3'), null);   // drive paths only escape on Windows
  assert.equal(svc.resolve('a/b/c.mp3'), path.join(root, 'a', 'b', 'c.mp3'));
});
