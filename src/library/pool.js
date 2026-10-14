import fs from 'node:fs/promises';
import path from 'node:path';
import { hasHebrew } from './text.js';
import { hebrewize, hebrewizeNames } from './hebrew.js';

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

export async function loadPool(config, store) {
  const decoys = await readJson(path.join(config.rootDir, 'data', 'decoys.json'), []);
  const playlist = await readJson(path.join(config.dataDir, 'playlist.json'), []);
  const aliases = await readJson(path.join(config.rootDir, 'data', 'aliases.json'), []);
  // The tail of the party playlist is Spanish/Shakira album tracks and filler: poor wrong answers for these players.
  // (The well-known hits by these artists live in decoys.json.)
  const OFF_LIMITS = /shakira|stidlmusic|reywil|norci|bizarrap|karol g|maluma|ozuna|alejandro sanz|el cata/i;
  const playlistOk = playlist.filter((x) => !OFF_LIMITS.test(x.artist || ''));
  const lib = store.list().map((s) => ({ title: s.title, artist: s.artist, lang: s.lang, bpm: s.bpm ?? undefined }));
  // Hebrew songs are offered with Hebrew names (so wrong answers look like the right one)
  const fix = (x) => {
    const title = hebrewize(x.title, aliases); const artist = hebrewizeNames(x.artist, aliases);
    return x.lang === 'he' || hasHebrew(title) || hasHebrew(artist) ? { ...x, title, artist, lang: 'he' } : x;
  };
  return [...lib, ...playlistOk, ...decoys].map(fix);
}
