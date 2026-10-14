import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ingestFile } from '../library/ingest.js';
import { AUDIO_EXT } from '../library/indexer.js';
import { suggestDistractors } from '../library/distractors.js';
import { loadPool } from '../library/pool.js';
import { fetchPlaylist, parsePastedList, matchTrack } from '../library/spotify.js';
import { hasHebrew } from '../library/text.js';
import { hebrewizeSong } from '../library/hebrew.js';

export function manageRouter({ config, store, index }) {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));
  const bad = (res) => res.status(400).json({ error: 'bad_request' });
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });

  r.get('/library', (req, res) => res.json({ songs: store.list(), index: index.status() }));

  r.get('/search', (req, res) => {
    const q = String(req.query.q ?? '').slice(0, 100);
    if (!q.trim()) return res.json({ results: [] });
    const added = new Set(store.list().map((s) => s.srcRel).filter(Boolean));
    res.json({ results: index.search(q, 30).map((x) => ({ ...x, added: added.has(x.rel) })) });
  });

  r.post('/index/refresh', (req, res) => { index.refresh(); res.status(202).json(index.status()); });
  r.get('/index/status', (req, res) => res.json(index.status()));

  r.get('/preview', (req, res) => {
    const abs = index.resolve(req.query.rel);
    if (!abs) return bad(res);
    res.sendFile(abs, { dotfiles: 'allow' }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  r.post('/add', wrap(async (req, res) => {
    const rel = req.body?.rel;
    const abs = index.resolve(rel);
    if (!abs) return bad(res);
    const existing = store.list().find((s) => s.srcRel === rel);
    if (existing) return res.json(existing);
    try { await fs.access(abs); } catch { return res.status(404).json({ error: 'not_found' }); }
    res.status(201).json(await ingestFile({ abs, srcRel: rel, config, store, aliases: index.aliases }));
  }));

  r.post('/upload', express.raw({ type: '*/*', limit: '200mb' }), wrap(async (req, res) => {
    const name = path.basename(String(req.query.name ?? ''));
    const ext = path.extname(name).toLowerCase();
    if (!AUDIO_EXT.has(ext) || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res);
    await fs.mkdir(config.songsDir, { recursive: true });
    const tmp = path.join(config.songsDir, `.upload-${randomBytes(4).toString('hex')}${ext}`);
    await fs.writeFile(tmp, req.body);
    let song;
    try { song = await ingestFile({ abs: tmp, nameHint: name, config, store, aliases: index.aliases }); }
    finally { await fs.rm(tmp, { force: true }); }
    res.status(201).json(song);
  }));

  r.patch('/song/:id', wrap(async (req, res) => {
    const song = await store.update(req.params.id, req.body || {});
    if (!song) return res.status(404).json({ error: 'not_found' });
    res.json(song);
  }));

  r.delete('/song/:id', wrap(async (req, res) => {
    const song = store.get(req.params.id);
    if (!song) return res.status(404).json({ error: 'not_found' });
    await fs.rm(path.join(config.songsDir, path.basename(song.file)), { force: true });
    if (song.art) await fs.rm(path.join(config.songsDir, 'art', `${song.id}.${song.art}`), { force: true });
    await store.remove(song.id);
    res.json({ ok: true });
  }));

  r.post('/reorder', wrap(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return bad(res);
    await store.reorder(ids);
    res.json({ ok: true });
  }));

  r.get('/song/:id/suggest', wrap(async (req, res) => {
    const song = store.get(req.params.id);
    if (!song) return res.status(404).json({ error: 'not_found' });
    res.json({ distractors: suggestDistractors(song, await loadPool(config, store)) });
  }));

  r.post('/suggest-all', wrap(async (req, res) => {
    const pool = await loadPool(config, store);
    let updated = 0;
    for (const s of store.list()) {
      if (s.distractors.length >= 3) continue;
      const have = new Set(s.distractors.map((d) => d.title));
      const extra = suggestDistractors(s, pool.filter((c) => !have.has(c.title)), { count: 3 - s.distractors.length });
      await store.update(s.id, { distractors: [...s.distractors, ...extra] });
      updated++;
    }
    res.json({ updated });
  }));

  // Show Hebrew songs (and their wrong answers) with Hebrew letters where the name is known
  r.post('/hebrewize', wrap(async (req, res) => {
    let updated = 0;
    for (const s of store.list()) {
      const patch = hebrewizeSong(s, index.aliases);
      if (patch) { await store.update(s.id, patch); updated++; }
    }
    res.json({ updated });
  }));

  async function rowsFor(tracks) {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(path.join(config.dataDir, 'playlist.json'),
      JSON.stringify(tracks.map((t) => ({ title: t.title, artist: t.artist, lang: hasHebrew(t.title) ? 'he' : 'en' }))));
    return tracks.map((t) => ({ ...t, match: matchTrack(index, t) }));
  }

  r.post('/spotify', wrap(async (req, res) => {
    let tracks;
    try { tracks = await fetchPlaylist(String(req.body?.url ?? '')); }
    catch (e) { return res.status(502).json({ error: String(e.message) }); }
    res.json({ rows: await rowsFor(tracks) });
  }));

  r.post('/spotify/paste', wrap(async (req, res) => {
    const tracks = parsePastedList(req.body?.text);
    if (!tracks.length) return bad(res);
    res.json({ rows: await rowsFor(tracks) });
  }));

  return r;
}
