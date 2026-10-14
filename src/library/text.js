export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-֑ͯ-ׇ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export const hasHebrew = (s) => /[֐-׿]/.test(String(s ?? ''));

export function parseRel(rel) {
  const parts = rel.split('/');
  const file = parts.pop();
  const folder = parts[parts.length - 1] || '';
  let name = file.replace(/\.[^.]+$/, '').trim();
  name = name.replace(/^\d+(\s*[-._)]\s*|\s+)/, '').trim();
  let artist = ''; let title = name;
  const bits = name.split(/\s+-\s+/);
  if (bits.length >= 2) { artist = bits[0].trim(); title = bits.slice(1).join(' - ').trim(); }
  else {
    const f = folder.split(/\s+-\s+/)[0].replace(/\[.*?\]/g, '').trim();
    if (f && f.length < 40) artist = f;
  }
  return { artist, title, album: folder };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function expandQuery(query, groups = []) {
  const q = normalize(query);
  const out = new Set([q]);
  for (const group of groups) {
    const g = group.map(normalize);
    for (const m of g) {
      if (!m) continue;
      const re = new RegExp(`(^| )${escapeRe(m)}( |$)`, 'u');
      if (!re.test(q)) continue;
      for (const other of g) if (other !== m) out.add(q.replace(re, (_, a, b) => `${a}${other}${b}`));
    }
  }
  return [...out];
}

export function within1(a, b) {
  if (a === b) return true;
  const d = a.length - b.length;
  if (Math.abs(d) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (d > 0) i++; else if (d < 0) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
