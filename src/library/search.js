import { normalize, parseRel, expandQuery, within1 } from './text.js';

const BAD_LATIN = /\b(remix|live|instrumental|accapella|acapella|karaoke|sped up|slowed|acoustic|demo|cover|radio edit|extended)\b/;
const BAD_HE = ['רמיקס', 'הופעה', 'פלייבק', 'אקפלה'];
const penalty = (norm) => (BAD_LATIN.test(norm) ? 40 : 0) + BAD_HE.filter((w) => norm.includes(w)).length * 40;

export function buildEntries(files) {
  return files.map((rel) => {
    const base = rel.split('/').pop().replace(/\.[^.]+$/, '');
    return { rel, norm: normalize(rel), base: normalize(base), words: null };
  });
}

function score(e, toks) {
  let s = 100;
  if (toks.every((t) => e.base.includes(t))) s += 50;
  if (e.base.replace(/^\d+ /, '') === toks.join(' ')) s += 40;
  s -= penalty(e.base) + penalty(e.norm) / 4;
  s -= e.rel.length / 50;
  return s;
}

export function search(entries, query, { limit = 30, aliases = [] } = {}) {
  const alts = expandQuery(query, aliases).filter(Boolean);
  const best = new Map();
  const seen = new Set();
  const consider = (e, toks) => {
    if (seen.has(e.rel)) return;
    seen.add(e.rel);
    const s = score(e, toks);
    const key = e.base.replace(/^\d+ /, '');
    const cur = best.get(key);
    if (!cur) best.set(key, { e, s, copies: 1 });
    else { cur.copies++; if (s > cur.s) { cur.e = e; cur.s = s; } }
  };
  for (const alt of alts) {
    const toks = alt.split(' ');
    for (const e of entries) if (toks.every((t) => e.norm.includes(t))) consider(e, toks);
  }
  if (best.size < 3) {                              // typo-tolerant second pass
    for (const alt of alts) {
      const toks = alt.split(' ');
      for (const e of entries) {
        e.words ??= e.norm.split(' ');
        if (toks.every((t) => e.norm.includes(t) || (t.length >= 4 && e.words.some((w) => within1(w, t))))) consider(e, toks);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.s - a.s).slice(0, limit)
    .map(({ e, s, copies }) => ({ rel: e.rel, score: Math.round(s), copies, ...parseRel(e.rel) }));
}
