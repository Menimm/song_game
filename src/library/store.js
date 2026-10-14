import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const HEB = /[֐-׿]/;
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanDistractors(list) {
  return (Array.isArray(list) ? list : [])
    .map((d) => ({ title: str(d?.title, 120).trim(), artist: str(d?.artist, 120).trim() }))
    .filter((d) => d.title)
    .slice(0, 3);
}

function normalizeSong(p) {
  const title = str(p.title, 120).trim();
  return {
    id: p.id || `s_${randomBytes(4).toString('hex')}`,
    title,
    artist: str(p.artist, 120).trim(),
    album: str(p.album, 120).trim(),
    file: str(p.file, 300),
    srcRel: str(p.srcRel, 600),
    art: p.art === 'jpg' || p.art === 'png' ? p.art : null,
    offsetMs: Number.isFinite(p.offsetMs) && p.offsetMs >= 0 ? Math.round(p.offsetMs) : 0,
    hook: str(p.hook, 200),
    lang: p.lang === 'en' || p.lang === 'he' ? p.lang : (HEB.test(title) || HEB.test(String(p.artist ?? ''))) ? 'he' : 'en',
    bpm: Number.isFinite(p.bpm) ? Math.round(p.bpm) : null,
    enabled: p.enabled !== false,
    unavailable: p.unavailable === true,
    distractors: cleanDistractors(p.distractors),
  };
}

const ALLOWED = ['title', 'artist', 'album', 'offsetMs', 'hook', 'bpm', 'enabled', 'unavailable', 'distractors', 'lang'];
function pick(patch) {
  const out = {};
  for (const k of ALLOWED) if (k in patch) out[k] = patch[k];
  return out;
}

export class LibraryStore {
  constructor(file) { this.file = file; this.songs = []; }

  async load() {
    try {
      const j = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.songs = (Array.isArray(j.songs) ? j.songs : []).map(normalizeSong);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.songs = [];
    }
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ songs: this.songs }, null, 2));
    await fs.rename(tmp, this.file);
  }

  list() { return this.songs; }
  enabled() { return this.songs.filter((s) => s.enabled !== false && !s.unavailable); }
  get(id) { return this.songs.find((s) => s.id === id) ?? null; }

  async add(partial) {
    const s = normalizeSong(partial);
    this.songs.push(s);
    await this.save();
    return s;
  }

  async update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    const next = normalizeSong({ ...s, ...pick(patch) });
    Object.assign(s, next, { id: s.id, file: s.file, srcRel: s.srcRel, art: s.art });   // mutates synchronously, then persists
    await this.save();
    return s;
  }

  async remove(id) {
    const n = this.songs.length;
    this.songs = this.songs.filter((s) => s.id !== id);
    if (this.songs.length === n) return false;
    await this.save();
    return true;
  }

  async reorder(ids) {
    const rank = new Map(ids.map((id, i) => [id, i]));
    const known = this.songs.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    const rest = this.songs.filter((s) => !rank.has(s.id));
    this.songs = [...known, ...rest];
    await this.save();
  }
}
