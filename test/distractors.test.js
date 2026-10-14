import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestDistractors } from '../src/library/distractors.js';

const song = { title: 'Flowers', artist: 'Miley Cyrus', lang: 'en', bpm: 118 };
const pool = [
  { title: 'Flowers', artist: 'Someone Else', lang: 'en' },                 // same title: excluded
  { title: 'Roar', artist: 'Katy Perry', lang: 'en', bpm: 90 },
  { title: 'As It Was', artist: 'Harry Styles', lang: 'en', bpm: 174 },
  { title: 'Firework', artist: 'Katy Perry', lang: 'en', bpm: 124 },
  { title: 'Shape of You', artist: 'Ed Sheeran', lang: 'en', bpm: 96 },
  { title: 'חללית', artist: 'גזוז', lang: 'he', bpm: 118 },
  { title: 'firework', artist: 'dup', lang: 'en' },                          // duplicate title: ignored
];

test('prefers same language, never repeats the answer, de-duplicates, returns three', () => {
  const d = suggestDistractors(song, pool, { rng: () => 0 });
  assert.equal(d.length, 3);
  assert.ok(d.every((x) => x.title !== 'Flowers' && x.title !== 'חללית'));
  assert.equal(new Set(d.map((x) => x.title.toLowerCase())).size, 3);
});

test('closer BPM ranks first when language is equal', () => {
  const d = suggestDistractors(song, pool, { rng: () => 0, count: 2 });
  assert.deepEqual(d.map((x) => x.title), ['Firework', 'Shape of You']);        // 124 and 96 are nearer 118 than 90 or 174
});

test('Hebrew songs get Hebrew wrong answers first', () => {
  const he = { title: 'תשע בכיכר', artist: 'גזוז', lang: 'he' };
  const d = suggestDistractors(he, [...pool, { title: 'רוני', artist: 'גזוז', lang: 'he' }], { rng: () => 0, count: 2 });
  assert.deepEqual(d.map((x) => x.title).sort(), ['חללית', 'רוני'].sort());
});

test('a version of the same song (extra text in brackets) is never offered as a wrong answer', () => {
  const s = { title: "Hips Don't Lie (feat. Wyclef Jean)", artist: 'Shakira', lang: 'en' };
  const d = suggestDistractors(s, [
    { title: "Hips Don't Lie", artist: 'Shakira', lang: 'en' }, { title: 'Roar', artist: 'K', lang: 'en' },
    { title: 'Firework', artist: 'K', lang: 'en' }, { title: 'Perfect', artist: 'E', lang: 'en' },
  ], { rng: () => 0 });
  assert.deepEqual(d.map((x) => x.title).sort(), ['Firework', 'Perfect', 'Roar']);
});

test('small pools return what exists', () => {
  assert.equal(suggestDistractors(song, [{ title: 'Roar', artist: 'K', lang: 'en' }]).length, 1);
  assert.deepEqual(suggestDistractors(song, []), []);
});
