import { parseFile } from 'music-metadata';
import { parseRel, hasHebrew } from './text.js';

// Old Hebrew MP3s store cp1255 bytes that readers decode as latin1 ("öáé÷ä"). When the file name has Hebrew
// but the tag is accented-latin gibberish, trust the file name instead.
export function pickText(tag, guess) {
  const t = String(tag ?? '').trim();
  if (!t) return guess;
  if (hasHebrew(guess) && !hasHebrew(t) && /[À-ÿ]{2,}/.test(t)) return guess;
  return t;
}

export async function readTags(abs, hint) {
  const guess = parseRel(hint || abs.split(/[\\/]/).slice(-3).join('/'));
  try {
    const m = await parseFile(abs, { duration: false });
    const pic = m.common.picture?.[0];
    return {
      title: pickText(m.common.title, guess.title),
      artist: pickText(m.common.artist, guess.artist),
      album: pickText(m.common.album, guess.album),
      picture: pic ? { data: Buffer.from(pic.data), ext: /png/i.test(pic.format) ? 'png' : 'jpg' } : null,
    };
  } catch {
    return { ...guess, picture: null };
  }
}
