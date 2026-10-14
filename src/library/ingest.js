import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readTags as defaultReadTags } from './tags.js';

export async function ingestFile({ abs, srcRel = '', nameHint, config, store, readTags = defaultReadTags }) {
  const ext = path.extname(abs).toLowerCase();
  const tags = await readTags(abs, srcRel || nameHint);
  const id = `s_${randomBytes(4).toString('hex')}`;
  const file = `${id}${ext}`;
  await fs.mkdir(path.join(config.songsDir, 'art'), { recursive: true });
  await fs.copyFile(abs, path.join(config.songsDir, file));
  let art = null;
  if (tags.picture) {
    await fs.writeFile(path.join(config.songsDir, 'art', `${id}.${tags.picture.ext}`), tags.picture.data);
    art = tags.picture.ext;
  }
  return store.add({ id, title: tags.title, artist: tags.artist, album: tags.album, file, srcRel, art });
}
