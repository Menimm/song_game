import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEntries, search } from './search.js';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.opus']);
const SKIP_DIRS = new Set(['@eaDir', '$RECYCLE.BIN', 'System Volume Information', '.AppleDouble']);

export async function scanMusic(root, { onProgress = () => {}, concurrency = 8 } = {}) {
  await fs.access(root);
  const files = [];
  const queue = [''];
  let active = 0;
  await new Promise((resolve) => {
    const walk = async (rel) => {
      const dir = await fs.opendir(path.join(root, rel));
      for await (const d of dir) {
        if (d.name.startsWith('._')) continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) queue.push(r); }
        else if (AUDIO_EXT.has(path.extname(d.name).toLowerCase())) files.push(r);
      }
      onProgress(files.length);
    };
    const pump = () => {
      while (active < concurrency && queue.length) {
        const rel = queue.pop();
        active++;
        walk(rel).catch(() => {}).finally(() => { active--; pump(); });
      }
      if (!queue.length && !active) resolve();
    };
    pump();
  });
  return files.sort();
}

export class IndexService {
  constructor({ root, cacheFile, aliases = [] }) {
    this.root = root; this.cacheFile = cacheFile; this.aliases = aliases;
    this.entries = []; this.builtAt = null;
    this.state = { building: false, scanned: 0, error: null };
  }

  async load() {
    try {
      const j = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'));
      this.entries = buildEntries(j.files || []); this.builtAt = j.builtAt || null;
    } catch { /* no cache yet */ }
  }

  async refresh() {
    if (this.state.building) return;
    this.state = { building: true, scanned: 0, error: null };
    try {
      const files = await scanMusic(this.root, { onProgress: (n) => { this.state.scanned = n; } });
      this.entries = buildEntries(files);
      this.builtAt = new Date().toISOString();
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify({ builtAt: this.builtAt, files }));
    } catch (e) {
      this.state.error = String(e.message || e);                // keep the previous index
    } finally {
      this.state.building = false;
    }
  }

  search(q, limit = 30) { return search(this.entries, q, { limit, aliases: this.aliases }); }

  resolve(rel) {
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
    const root = path.resolve(this.root);
    const abs = path.resolve(root, ...rel.split('/'));
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;     // share/drive roots already end with a separator
    if (abs !== root && !abs.startsWith(prefix)) return null;
    if (!AUDIO_EXT.has(path.extname(abs).toLowerCase())) return null;
    return abs;
  }

  status() {
    return { count: this.entries.length, builtAt: this.builtAt, building: this.state.building, scanned: this.state.scanned, error: this.state.error };
  }
}
