import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readTags as defaultReadTags } from './tags.js';
import { hebrewizeSong } from './hebrew.js';

export async function ingestFile({ abs, srcRel = '', nameHint, config, store, aliases = [], readTags = defaultReadTags }) {
  const ext = path.extname(abs).toLowerCase();
  const tags = await readTags(abs, srcRel || nameHint);
  const he = hebrewizeSong({ title: tags.title, artist: tags.artist, distractors: [] }, aliases);   // Hebrew songs show Hebrew names
  const id = `s_${randomBytes(4).toString('hex')}`;
  const file = `${id}${ext}`;
  await fs.mkdir(path.join(config.songsDir, 'art'), { recursive: true });
  await fs.copyFile(abs, path.join(config.songsDir, file));
  let art = null;
  if (tags.picture) {
    await fs.writeFile(path.join(config.songsDir, 'art', `${id}.${tags.picture.ext}`), tags.picture.data);
    art = tags.picture.ext;
  }
  return store.add({
    id, title: he ? he.title : tags.title, artist: he ? he.artist : tags.artist, lang: he ? 'he' : undefined,
    album: tags.album, file, srcRel, art,
  });
}
