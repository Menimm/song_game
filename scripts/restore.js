import { createApp } from '../src/app.js';
import { config } from '../config.js';
import { restoreMissing } from '../src/library/restore.js';

const app = await createApp({ config });
console.log(`Music folder: ${config.musicDir}`);
const r = await restoreMissing({ config, store: app.store, resolve: (rel) => app.index.resolve(rel) });
console.log(`Restored ${r.restored.length} song file(s)${r.restored.length ? ': ' + r.restored.join(', ') : ''}`);
if (r.missing.length) console.log(`Could not restore ${r.missing.length} (music share not mounted, or file moved/uploaded by hand): ${r.missing.join(', ')}`);
process.exit(r.missing.length ? 1 : 0);
