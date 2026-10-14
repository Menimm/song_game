import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hasHebrew, parseRel, expandQuery, within1 } from '../src/library/text.js';
import { buildEntries, search } from '../src/library/search.js';

const FILES = [
  'TIDAL DL/Album/Taylor Swift/[M] 1989 (Deluxe Edition) [121444594] [2014]/06 - Taylor Swift - Shake It Off.flac',
  'TIDAL DL/Playlist/Female Icons - TIDAL Masters/95 - Miley Cyrus - Flowers.flac',
  "TIDAL DL/Playlist/Female Icons - TIDAL Masters/42 - Shakira, Wyclef Jean - Hips Don't Lie (feat. Wyclef Jean).flac",
  "TIDAL DL/Album/Madonna/[E] MDNA (Deluxe Version) [14238013] [2012]/CD2/05 - Madonna, LMFAO, Nicki Minaj - Give Me All Your Luvin' (Party Rock Remix).flac",
  'Pop/LMFAO - Party Rock Anthem.mp3',
  'Israeli.Music.Mega.Pack.HeBits/גזוז - 1990 - 20 הלהיטים/11 - חללית .flac',
  'TIDAL DL/Album/Gazoz/ גזוז - 20 הלהיטים [185069340] [1990]/CD1/11 - Gazoz - חללית.flac',
  'CD_RIPs/Gazoz - The 20 Hits/11 - Gazoz - Spaceship.flac',
  'Osef_Shirim_Yisraelim/אוסף שירים ישראליים/צביקה פיק - הרקדן האוטומטי.mp3',
  'TIDAL DL/Album/Booskills, Svika Pick/ הרקדן האוטומטי [185107625] [2019]/02 - Booskills, Svika Pick - הרקדן האוטומטי (Instrumental).flac',
  'Pop/Dua Lipa/Future Nostalgia/03 - Levitating.flac',
];
const E = buildEntries(FILES);
const ALIASES = [['gazoz', 'גזוז']];

test('normalize folds case, accents, niqqud and punctuation', () => {
  assert.equal(normalize("Don't Start Now!"), 'dont start now');
  assert.equal(normalize('Beyoncé'), 'beyonce');
  assert.equal(normalize('שָׁלום'), 'שלום');
  assert.equal(normalize('  A  -  B  '), 'a b');
  assert.equal(hasHebrew('abc'), false);
  assert.equal(hasHebrew('abc ג'), true);
});

test('parseRel guesses artist and title from file and folder names', () => {
  assert.deepEqual(parseRel(FILES[6]), { artist: 'Gazoz', title: 'חללית', album: 'CD1' });
  assert.deepEqual(parseRel(FILES[5]), { artist: 'גזוז', title: 'חללית', album: 'גזוז - 1990 - 20 הלהיטים' });
  assert.equal(parseRel(FILES[8]).artist, 'צביקה פיק');
  assert.equal(parseRel(FILES[8]).title, 'הרקדן האוטומטי');
});

test('expandQuery adds alias spellings', () => {
  const out = expandQuery('Gazoz חללית', ALIASES);
  assert.ok(out.includes('gazoz חללית') && out.includes('גזוז חללית'));
});

test('within1', () => {
  assert.equal(within1('levitating', 'levitatin'), true);
  assert.equal(within1('shakira', 'shakera'), true);
  assert.equal(within1('roar', 'rawr'), false);
  assert.equal(within1('abc', 'abc'), true);
});

test('finds a song by title and returns a clean artist/title', () => {
  const r = search(E, 'shake it off');
  assert.equal(r[0].title, 'Shake It Off');
  assert.equal(r[0].artist, 'Taylor Swift');
});

test('apostrophes do not break matching', () => {
  assert.match(search(E, 'hips dont lie')[0].rel, /Hips Don't Lie/);
});

test('latin alias finds the Hebrew-named folder', () => {
  const r = search(E, 'gazoz', { aliases: ALIASES });
  assert.ok(r.some((x) => x.rel.includes('Mega.Pack')));
});

test('originals beat remixes, instrumentals and live takes', () => {
  assert.match(search(E, 'party rock')[0].rel, /Party Rock Anthem/);
  assert.match(search(E, 'הרקדן האוטומטי')[0].rel, /צביקה פיק - הרקדן/);
});

test('one result per distinct track name', () => {
  assert.equal(search(E, 'חללית').length, 2);
});

test('single-typo queries still find the song; nonsense finds nothing', () => {
  assert.match(search(E, 'levitatin')[0].rel, /Levitating/);
  assert.deepEqual(search(E, 'zzzzqqqq'), []);
  assert.deepEqual(search(E, '   '), []);
});
