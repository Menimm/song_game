import test from 'node:test';
import assert from 'node:assert/strict';
import { hebrewize, hebrewizeNames, hebrewizeSong } from '../src/library/hebrew.js';

const G = [
  ['noa kirel', 'נועה קירל'], ['stephane legar', 'סטפן לגר'], ['arisa', 'אריסה'], ['mergui', 'מרגי'],
  ['tikitas', 'טיקיטאס'], ['gazoz', 'גזוז'],
];

test('known Latin names become Hebrew; everything else is left alone', () => {
  assert.equal(hebrewize('Noa Kirel', G), 'נועה קירל');
  assert.equal(hebrewize('Noa Kiral feat', G), 'Noa Kiral feat');            // misspelling is not guessed
  assert.equal(hebrewize('Taylor Swift', G), 'Taylor Swift');
  assert.equal(hebrewize('Tikitas', G), 'טיקיטאס');
  assert.equal(hebrewize('Gazoz - Live', G), 'גזוז - Live');
  assert.equal(hebrewize('Arisaki', G), 'Arisaki');                          // whole words only
});

test('artist lists are split, translated, de-duplicated and joined', () => {
  assert.equal(hebrewizeNames('Noa Kirel;נועה קירל', G), 'נועה קירל');
  assert.equal(hebrewizeNames('Noa Kirel, Stephane Legar, Arisa', G), 'נועה קירל, סטפן לגר, אריסה');
  assert.equal(hebrewizeNames('Noa Kirel, Mergui', G), 'נועה קירל, מרגי');
  assert.equal(hebrewizeNames('Taylor Swift', G), 'Taylor Swift');
});

test('broadcaster/label credits are dropped from artist lists', () => {
  assert.equal(hebrewizeNames('Noa Kirel, כאן - תאגיד השידור הישראלי', G), 'נועה קירל');
});

test('a Latin-titled song by an Israeli artist becomes a Hebrew song', () => {
  const p = hebrewizeSong({ title: 'Tikitas', artist: 'Noa Kirel, Stephane Legar, Arisa', lang: 'en', distractors: [] }, G);
  assert.deepEqual([p.title, p.artist, p.lang], ['טיקיטאס', 'נועה קירל, סטפן לגר, אריסה', 'he']);
});

test('English songs are untouched; Hebrew songs also get Hebrew wrong answers', () => {
  assert.equal(hebrewizeSong({ title: 'Roar', artist: 'Katy Perry', lang: 'en', distractors: [{ title: 'Tikitas', artist: 'Noa Kirel' }] }, G), null);
  const p = hebrewizeSong({ title: 'חללית', artist: 'Gazoz', lang: 'he', distractors: [{ title: 'Tikitas', artist: 'Noa Kirel' }, { title: 'Roar', artist: 'Katy Perry' }] }, G);
  assert.equal(p.artist, 'גזוז');
  assert.deepEqual(p.distractors, [{ title: 'טיקיטאס', artist: 'נועה קירל' }, { title: 'Roar', artist: 'Katy Perry' }]);
});

test('already-Hebrew songs need no change', () => {
  assert.equal(hebrewizeSong({ title: 'חללית', artist: 'גזוז', lang: 'he', distractors: [] }, G), null);
});
