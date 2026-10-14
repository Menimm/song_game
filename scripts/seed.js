import { createApp } from '../src/app.js';
import { config } from '../config.js';
import { ingestFile } from '../src/library/ingest.js';
import { suggestDistractors } from '../src/library/distractors.js';
import { loadPool } from '../src/library/pool.js';

const SEED = [
  'Taylor Swift Shake It Off', 'Miley Cyrus Flowers', 'Katy Perry Roar', 'Harry Styles Watermelon Sugar',
  "Dua Lipa Don't Start Now", "Shakira Hips Don't Lie",
  'הרקדן האוטומטי', 'יש לי ציפור קטנה בלב', 'נועה קירל מיליון דולר', 'נועה קירל אם אתה גבר', 'נועה קירל אמבולנס', 'טיקיטאס',
  'גזוז 20 הלהיטים חללית', 'גזוז 20 הלהיטים תשע בכיכר', 'גזוז 20 הלהיטים רוני',      // the Gazoz "20 Hits" album, not covers
];

const app = await createApp({ config });
if (!app.index.status().count) {
  console.log('Building the index of the music share (1-2 minutes)...');
  await app.index.refresh();
  if (app.index.status().error) { console.error('Index failed:', app.index.status().error); process.exit(1); }
}
console.log(`Index: ${app.index.status().count} files\n`);

for (const q of SEED) {
  const hit = app.index.search(q, 3)[0];
  if (!hit) { console.log(`x  ${q}  ->  NOT FOUND`); continue; }
  if (app.store.list().some((s) => s.srcRel === hit.rel)) { console.log(`=  ${q}  ->  already in the library`); continue; }
  const song = await ingestFile({ abs: app.index.resolve(hit.rel), srcRel: hit.rel, config, store: app.store, aliases: app.index.aliases });
  console.log(`ok ${q}  ->  ${song.artist} - ${song.title}   [${hit.rel}]`);
}

const pool = await loadPool(config, app.store);
for (const s of app.store.list()) {
  if (s.distractors.length >= 3) continue;
  const have = new Set(s.distractors.map((d) => d.title));
  const extra = suggestDistractors(s, pool.filter((c) => !have.has(c.title)), { count: 3 - s.distractors.length });
  await app.store.update(s.id, { distractors: [...s.distractors, ...extra] });
}
console.log(`\nLibrary now has ${app.store.list().length} songs. Review titles, start offsets and wrong answers in /manage.`);
process.exit(0);
