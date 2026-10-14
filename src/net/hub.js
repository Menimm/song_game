import { WebSocketServer } from 'ws';
import { isLocalRequest } from './guard.js';

export function attachHub({ server, game }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    // Block cross-site WebSocket hijacking: a web page the operator happens to visit must not drive the host.
    const origin = req.headers.origin;
    if (origin) {
      let same = false;
      try { same = new URL(origin).host === req.headers.host; } catch { /* malformed */ }
      if (!same) return socket.destroy();
    }
    const local = isLocalRequest(req);
    wss.handleUpgrade(req, socket, head, (ws) => { ws.local = local; wss.emit('connection', ws, req); });
  });

  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const push = (c) => { if (c.role) send(c.ws, { t: 'state', s: game.snapshot(c.role, c.playerId) }); };
  const onChange = () => clients.forEach(push);
  const onHost = (m) => clients.forEach((c) => c.role === 'host' && send(c.ws, m));
  const onSfx = (name) => clients.forEach((c) => c.role === 'host' && send(c.ws, { t: 'sfx', name }));
  game.on('change', onChange); game.on('host', onHost); game.on('sfx', onSfx);

  function hello(c, m) {
    if (!['player', 'tv', 'host'].includes(m.role)) return;
    if (m.role !== 'player') {
      if (!c.ws.local) { send(c.ws, { t: 'error', e: 'forbidden' }); return c.ws.close(); }
      c.role = m.role;
      return push(c);
    }
    if (String(m.code || '').toUpperCase() !== game.code) return send(c.ws, { t: 'error', e: 'bad_code' });
    const r = game.join(m.name, m.token);
    if (!r.ok) return send(c.ws, { t: 'error', e: r.error });
    c.role = 'player'; c.playerId = r.player.id;
    send(c.ws, { t: 'joined', token: r.player.token, id: r.player.id, name: r.player.name });
    push(c);
  }

  function command(c, m) {
    const a = m.args || {};
    switch (m.c) {
      case 'startRound': { const r = game.startRound({ songId: a.songId, maxSteps: a.maxSteps }); if (!r.ok) send(c.ws, { t: 'error', e: r.error }); break; }
      case 'pause': game.pause(); break;
      case 'resume': game.resume(); break;
      case 'replay': game.replay(); break;
      case 'nextStep': game.nextStep(); break;
      case 'reveal': game.revealNow(); break;
      case 'skip': game.skip(); break;
      case 'next': game.next(); break;
      case 'setMaxSteps': game.setMaxSteps(a.n); break;
      case 'adjust': game.adjust(String(a.id), Number(a.delta) || 0); break;
      case 'kick': game.kick(String(a.id)); break;
      case 'hostReady': game.hostReady(); break;
      case 'stepStarted': game.stepStarted(); break;
      case 'preloadFailed': game.preloadFailed(String(a.reason || 'error')); break;
      default: hub.extra?.(c, m, send);
    }
  }

  wss.on('connection', (ws) => {
    const c = { ws, role: null, playerId: null, alive: true };
    clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.t === 'hello') hello(c, m);
      else if (m.t === 'answer' && c.role === 'player') game.answer(c.playerId, m.i);
      else if (m.t === 'cmd' && c.role === 'host') command(c, m);
    });
    ws.on('close', () => {
      clients.delete(c);
      if (c.playerId && ![...clients].some((o) => o.playerId === c.playerId)) game.disconnect(c.playerId);
    });
  });

  const beat = setInterval(() => {
    for (const c of clients) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; c.ws.ping(); }
  }, 15000);
  beat.unref();

  const hub = {
    extra: null,
    close() {
      clearInterval(beat);
      game.off('change', onChange); game.off('host', onHost); game.off('sfx', onSfx);
      for (const c of clients) c.ws.terminate();
      wss.close();
    },
  };
  return hub;
}
