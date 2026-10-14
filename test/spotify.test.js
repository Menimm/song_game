import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePlaylistId, extractTracks, parsePastedList, cleanTitle, matchTrack, fetchPlaylist } from '../src/library/spotify.js';

test('playlist id from URL, URI and junk', () => {
  assert.equal(parsePlaylistId('https://open.spotify.com/playlist/7lxboJrwOwS2ridfuKSBXG?si=abc'), '7lxboJrwOwS2ridfuKSBXG');
  assert.equal(parsePlaylistId('spotify:playlist:7lxboJrwOwS2ridfuKSBXG'), '7lxboJrwOwS2ridfuKSBXG');
  assert.equal(parsePlaylistId('hello'), null);
  assert.equal(parsePlaylistId(null), null);
});

const TRACKS = [{ title: 'Levitating', subtitle: 'Dua Lipa' }, { title: 'פנתרה', subtitle: 'Noa Kirel' }, { title: 'Levitating', subtitle: 'Dua Lipa' }];

test('extractTracks: __NEXT_DATA__, url-encoded JSON script and raw inline array', () => {
  const data = JSON.stringify({ props: { pageProps: { state: { data: { entity: { trackList: TRACKS } } } } } });
  const a = `<html><script id="__NEXT_DATA__" type="application/json">${data}</script></html>`;
  const b = `<script id="resource" type="application/json">${encodeURIComponent(data)}</script>`;
  const c = `<script>window.x = {"a":1,"trackList":${JSON.stringify(TRACKS)},"b":"]"}</script>`;
  for (const html of [a, b, c]) assert.deepEqual(extractTracks(html), [{ title: 'Levitating', artist: 'Dua Lipa' }, { title: 'פנתרה', artist: 'Noa Kirel' }]);
  assert.throws(() => extractTracks('<html>nothing</html>'), /no_tracklist/);
});

const FIXTURE = new URL('./fixtures/spotify-embed.html', import.meta.url);
test('the real captured embed page parses (skipped when the fixture is absent)', { skip: !fs.existsSync(FIXTURE) }, () => {
  const tracks = extractTracks(fs.readFileSync(FIXTURE, 'utf8'));
  assert.ok(tracks.length >= 50, `got ${tracks.length}`);
  assert.ok(tracks.some((t) => /Levitating/i.test(t.title)));
});

test('fetchPlaylist uses the embed URL and surfaces HTTP errors', async () => {
  const seen = [];
  const ok = async (url) => { seen.push(url); return { ok: true, text: async () => `<script>{"trackList":${JSON.stringify(TRACKS)}}</script>` }; };
  assert.equal((await fetchPlaylist('https://open.spotify.com/playlist/7lxboJrwOwS2ridfuKSBXG', ok)).length, 2);
  assert.equal(seen[0], 'https://open.spotify.com/embed/playlist/7lxboJrwOwS2ridfuKSBXG');
  await assert.rejects(fetchPlaylist('https://open.spotify.com/playlist/7lxboJrwOwS2ridfuKSBXG', async () => ({ ok: false, status: 404 })), /404/);
  await assert.rejects(fetchPlaylist('nope', ok), /bad_url/);
});

test('pasted lists: "Title - Artist", tabs, blank lines, duplicates', () => {
  const out = parsePastedList('Shake It Off - Taylor Swift\n\nרוני\tגזוז\nShake It Off - Taylor Swift\nJust A Title');
  assert.deepEqual(out, [
    { title: 'Shake It Off', artist: 'Taylor Swift' }, { title: 'רוני', artist: 'גזוז' }, { title: 'Just A Title', artist: '' },
  ]);
});

test('cleanTitle strips decorations', () => {
  assert.equal(cleanTitle("Can't Stop the Feeling! (from DreamWorks Animation's \"TROLLS\")"), "Can't Stop the Feeling!");
  assert.equal(cleanTitle('Cold Heart - PNAU Remix'), 'Cold Heart');
  assert.equal(cleanTitle("Hips Don't Lie (feat. Wyclef Jean)"), "Hips Don't Lie");
});

test('matchTrack prefers a title+artist hit and falls back to title only', () => {
  const calls = [];
  const index = { search: (q) => { calls.push(q); return q === 'Roar' ? [{ rel: 'x/Roar.flac', artist: '', title: 'Roar' }] : []; } };
  const m = matchTrack(index, { title: 'Roar (feat. X)', artist: 'Katy Perry, Someone' });
  assert.deepEqual(calls, ['Roar Katy Perry', 'Roar']);
  assert.equal(m.confidence, 'title');
  assert.equal(matchTrack({ search: () => [] }, { title: 'Zzz', artist: 'Q' }), null);
});
