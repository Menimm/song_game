import { parseFile } from 'music-metadata';
import { parseRel } from './text.js';

export async function readTags(abs, hint) {
  const guess = parseRel(hint || abs.split(/[\\/]/).slice(-3).join('/'));
  try {
    const m = await parseFile(abs, { duration: false });
    const pic = m.common.picture?.[0];
    return {
      title: m.common.title?.trim() || guess.title,
      artist: m.common.artist?.trim() || guess.artist,
      album: m.common.album?.trim() || guess.album,
      picture: pic ? { data: Buffer.from(pic.data), ext: /png/i.test(pic.format) ? 'png' : 'jpg' } : null,
    };
  } catch {
    return { ...guess, picture: null };
  }
}
