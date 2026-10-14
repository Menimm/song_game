import fs from 'node:fs/promises';
import path from 'node:path';
import { readTags as defaultReadTags } from './tags.js';

const exists = (p) => fs.access(p).then(() => true, () => false);

// A fresh clone has data/songs.json but no audio (songs/ is not in git). Copy each missing file back from the music share.
export async function restoreMissing({ config, store, resolve, readTags = defaultReadTags }) {
  const out = { restored: [], missing: [] };
  for (const s of store.list()) {
    const dest = path.join(config.songsDir, path.basename(s.file));
    if (await exists(dest)) continue;
    try {
      const src = s.srcRel ? resolve(s.srcRel) : null;
      if (!src) throw new Error('no source');
      await fs.mkdir(path.join(config.songsDir, 'art'), { recursive: true });
      await fs.copyFile(src, dest);
      if (s.art) {
        const t = await readTags(src, s.srcRel);
        if (t.picture) await fs.writeFile(path.join(config.songsDir, 'art', `${s.id}.${s.art}`), t.picture.data);
      }
      if (s.unavailable) await store.update(s.id, { unavailable: false });
      out.restored.push(s.title);
    } catch {
      out.missing.push(s.title);
    }
  }
  return out;
}
