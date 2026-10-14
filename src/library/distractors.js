import { normalize, hasHebrew } from './text.js';

const langOf = (x) => x.lang || (hasHebrew(x.title) ? 'he' : 'en');

// "Hips Don't Lie (feat. X)" and "Hips Don't Lie" are the same song for the purpose of wrong answers
const keyOf = (title) => normalize(String(title ?? '').replace(/\(.*?\)|\[.*?\]/g, ' '));

export function suggestDistractors(song, pool, { rng = Math.random, count = 3 } = {}) {
  const seen = new Set([keyOf(song.title)]);
  const myLang = langOf(song);
  const scored = [];
  for (const c of pool) {
    const k = keyOf(c.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    let s = langOf(c) === myLang ? 50 : 0;
    if (Number.isFinite(song.bpm) && Number.isFinite(c.bpm)) s += 30 - Math.min(30, Math.abs(song.bpm - c.bpm));
    s += rng() * 20;
    scored.push({ s, c });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, count).map(({ c }) => ({ title: c.title, artist: c.artist || '' }));
}
