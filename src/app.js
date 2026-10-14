import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import express from 'express';
import QRCode from 'qrcode';
import { Game, realTimers } from './game/game.js';
import { LibraryStore } from './library/store.js';
import { attachHub } from './net/hub.js';
import { isLocalRequest, requireLocal } from './net/guard.js';

export function lanUrl(port) {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${port}`;
  }
  return `http://localhost:${port}`;
}

const PRIVATE_FILES = /^\/(host|tv|manage)(\.html)?$|^\/js\/(host|manage|host-audio|bpm)\.js$/;

export async function createApp({ config, timers = realTimers, rng = Math.random } = {}) {
  await fsp.mkdir(path.join(config.songsDir, 'art'), { recursive: true });
  await fsp.mkdir(config.dataDir, { recursive: true });
  const store = new LibraryStore(path.join(config.dataDir, 'songs.json'));
  await store.load();
  const game = new Game({ config, getSongs: () => store.enabled(), timers, rng });
  game.on('song_unavailable', ({ songId }) => { store.update(songId, { unavailable: true }).catch(() => {}); });

  const pub = path.join(config.rootDir, 'public');
  const app = express();
  app.disable('x-powered-by');

  let publicUrl = null;
  const server = http.createServer(app);
  const joinBase = () => publicUrl || lanUrl(server.address()?.port ?? config.port);
  const joinUrl = () => `${joinBase()}/play?c=${game.code}`;

  app.use((req, res, next) => (PRIVATE_FILES.test(req.path) && !isLocalRequest(req) ? res.status(404).end() : next()));
  app.get('/healthz', (req, res) => res.send('ok'));
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.get('/api/join', (req, res) => res.json({ code: game.code, url: joinUrl() }));
  app.get('/api/join-qr.svg', async (req, res) => {
    res.type('image/svg+xml').send(await QRCode.toString(joinUrl(), { type: 'svg', margin: 1 }));
  });
  app.get('/', (req, res) => res.redirect('/play'));
  for (const p of ['play', 'host', 'tv', 'manage']) app.get(`/${p}`, (req, res) => res.sendFile(path.join(pub, `${p}.html`)));
  app.use('/songs', requireLocal, express.static(config.songsDir, { index: false }));
  app.use('/art', express.static(path.join(config.songsDir, 'art'), { index: false }));
  app.use(express.static(pub, { index: false }));

  const hub = attachHub({ server, game });

  return {
    app, server, game, store, hub, config, timers,
    setPublicUrl(u) { publicUrl = u ? u.replace(/\/$/, '') : null; },
    joinUrl,
    listen(port = config.port) {
      return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server.address().port)));
    },
    close() {
      hub.close();
      return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
    },
  };
}
