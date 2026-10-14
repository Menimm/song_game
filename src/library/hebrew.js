import { hasHebrew } from './text.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replace known Latin spellings of Hebrew names (from the alias groups) with their Hebrew form. Whole words only.
export function hebrewize(text, groups = []) {
  let out = String(text ?? '');
  for (const g of groups) {
    const heb = g.find((m) => hasHebrew(m));
    if (!heb) continue;
    for (const m of g) {
      if (hasHebrew(m)) continue;
      out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc(m)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_, pre) => pre + heb);
    }
  }
  return out;
}

// "Noa Kirel;נועה קירל" / "A, B & C" -> unique, translated, ", "-joined
export function hebrewizeNames(text, groups = []) {
  const CREDITS = /תאגיד השידור|צאן ברזל מוזיקה/;                  // broadcaster / label credits Spotify lists as "artists"
  const parts = String(text ?? '').split(/\s*[,;&]\s*/).map((p) => hebrewize(p.trim(), groups)).filter((p) => p && !CREDITS.test(p));
  return [...new Set(parts)].join(', ');
}

// Returns the changes to apply to a library song, or null when it is not a Hebrew song / already fine.
export function hebrewizeSong(song, groups = []) {
  const title = hebrewize(song.title, groups);
  const artist = hebrewizeNames(song.artist, groups);
  if (!(song.lang === 'he' || hasHebrew(title) || hasHebrew(artist))) return null;
  const distractors = (song.distractors || []).map((d) => ({ title: hebrewize(d.title, groups), artist: hebrewizeNames(d.artist, groups) }));
  const same = title === song.title && artist === song.artist && song.lang === 'he'
    && JSON.stringify(distractors) === JSON.stringify(song.distractors || []);
  return same ? null : { title, artist, lang: 'he', distractors };
}
