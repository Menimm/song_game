import { normalize } from './text.js';

export function parsePlaylistId(input) {
  const m = String(input ?? '').match(/playlist[/:]([A-Za-z0-9]{10,})/);
  return m ? m[1] : null;
}

function findKey(o, k) {
  if (o && typeof o === 'object') {
    if (Array.isArray(o[k])) return o[k];
    for (const v of Object.values(o)) { const r = findKey(v, k); if (r) return r; }
  }
  return null;
}

function balanced(text, start) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function listFrom(text) {
  try { const l = findKey(JSON.parse(text), 'trackList'); if (l) return l; } catch { /* not JSON */ }
  const i = text.indexOf('"trackList":');
  if (i < 0) return null;
  const s = text.indexOf('[', i);
  const raw = s >= 0 ? balanced(text, s) : null;
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => { const k = `${normalize(t.title)}|${normalize(t.artist)}`; if (!t.title || seen.has(k)) return false; seen.add(k); return true; });
}

export function extractTracks(html) {
  const bodies = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const decoded = bodies.map((b) => { try { return decodeURIComponent(b); } catch { return ''; } });
  for (const text of [...bodies, ...decoded, html]) {
    const list = listFrom(text);
    if (Array.isArray(list) && list.length) {
      return dedupe(list.map((t) => ({ title: String(t.title ?? '').trim(), artist: String(t.subtitle ?? t.artist ?? '').replace(/ /g, ' ').trim() })));
    }
  }
  throw new Error('no_tracklist');
}

export async function fetchPlaylist(urlOrId, fetchImpl = fetch) {
  const id = parsePlaylistId(urlOrId);
  if (!id) throw new Error('bad_url');
  const r = await fetchImpl(`https://open.spotify.com/embed/playlist/${id}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`spotify_http_${r.status}`);
  return extractTracks(await r.text());
}

export function parsePastedList(text) {
  const out = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const tab = line.split('\t');
    if (tab.length >= 2) return { title: tab[0].trim(), artist: tab[1].trim() };
    const i = line.search(/\s[-–—]\s/);
    return i < 0 ? { title: line, artist: '' } : { title: line.slice(0, i).trim(), artist: line.slice(i).replace(/^\s[-–—]\s/, '').trim() };
  });
  return dedupe(out);
}

export function cleanTitle(t) {
  return String(t ?? '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s+-\s+.*$/, '').replace(/\s+/g, ' ').trim();
}

export function matchTrack(index, track) {
  const title = cleanTitle(track.title);
  const artist = String(track.artist ?? '').split(',')[0].trim();
  const attempts = artist ? [[`${title} ${artist}`, 'artist'], [title, 'title']] : [[title, 'title']];
  for (const [q, confidence] of attempts) {
    const hit = index.search(q, 3)[0];
    if (hit) return { rel: hit.rel, artist: hit.artist, title: hit.title, confidence };
  }
  return null;
}
