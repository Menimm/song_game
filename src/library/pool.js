import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

export async function loadPool(config, store) {
  const decoys = await readJson(path.join(config.rootDir, 'data', 'decoys.json'), []);
  const playlist = await readJson(path.join(config.dataDir, 'playlist.json'), []);
  const lib = store.list().map((s) => ({ title: s.title, artist: s.artist, lang: s.lang, bpm: s.bpm ?? undefined }));
  return [...lib, ...playlist, ...decoys];
}
