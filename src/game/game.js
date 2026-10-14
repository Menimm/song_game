import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { pointsForStep, applyWrong, rankPlayers } from './scoring.js';

export const realTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
  now: () => Date.now(),
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function makeCode(rng = Math.random, n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

export function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>&"]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 16).join('').trim();
}

export class PausableTimer {
  constructor(timers) {
    this.timers = timers; this.id = null; this.fn = null;
    this.deadline = 0; this.total = 0; this.left = 0; this.running = false;
  }
  start(ms, fn) { this.clear(); this.fn = fn; this.total = ms; this.left = ms; this._arm(); }
  _arm() {
    this.running = true;
    this.deadline = this.timers.now() + this.left;
    this.id = this.timers.set(() => {
      this.running = false; this.id = null; this.left = 0;
      const f = this.fn; this.fn = null; f();
    }, this.left);
  }
  pause() {
    if (!this.running) return;
    this.left = Math.max(0, this.deadline - this.timers.now());
    this.timers.clear(this.id); this.id = null; this.running = false;
  }
  resume() { if (!this.running && this.fn) this._arm(); }
  clear() {
    if (this.id != null) this.timers.clear(this.id);
    this.id = null; this.fn = null; this.running = false; this.left = 0; this.total = 0;
  }
  remaining() { return this.running ? Math.max(0, this.deadline - this.timers.now()) : this.left; }
  active() { return this.fn !== null; }
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const keyOf = (t) => String(t?.title ?? '').trim().toLowerCase();

function buildOptions(song, songs, rng) {
  const wrong = [];
  const seen = new Set([keyOf(song)]);
  const add = (t) => {
    const k = keyOf(t);
    if (t && k && !seen.has(k)) { seen.add(k); wrong.push({ title: t.title, artist: t.artist || '' }); }
  };
  for (const d of song.distractors || []) add(d);
  for (const o of shuffle(songs.filter((s) => s.id !== song.id), rng)) { if (wrong.length >= 3) break; add(o); }
  if (wrong.length < 3) return null;
  const all = shuffle([
    { title: song.title, artist: song.artist || '', right: true },
    ...wrong.slice(0, 3).map((w) => ({ ...w, right: false })),
  ], rng);
  return {
    options: all.map(({ title, artist }) => ({ title, artist })),
    correctIndex: all.findIndex((o) => o.right),
  };
}

export class Game extends EventEmitter {
  constructor({ config, getSongs, timers = realTimers, rng = Math.random, code } = {}) {
    super();
    this.config = { ...config };
    this.getSongs = getSongs;
    this.timers = timers;
    this.rng = rng;
    this.code = code ?? makeCode(rng);
    this.players = new Map();
    this.nextPlayerNum = 1;
    this.phase = 'idle';
    this.round = null;
    this.played = new Set();
    this.notices = [];
    this.maxSteps = config.maxSteps;
    this.pausedFrom = null;
    this.timer = new PausableTimer(timers);
    this.ackTimer = new PausableTimer(timers);
  }

  changed() { this.emit('change'); }

  // ---- players -----------------------------------------------------------
  join(rawName, token) {
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) { existing.connected = true; this.changed(); return { ok: true, player: existing, resumed: true }; }
    }
    const base = cleanName(rawName);
    if (!base) return { ok: false, error: 'bad_name' };
    if (this.players.size >= this.config.maxPlayers) return { ok: false, error: 'full' };
    const taken = new Set([...this.players.values()].map((p) => p.name));
    let name = base; let n = 2;
    while (taken.has(name)) name = `${base} ${n++}`;
    const player = {
      id: `p${this.nextPlayerNum++}`, token: randomBytes(8).toString('hex'),
      name, score: 0, connected: true, bot: false,
    };
    this.players.set(player.id, player);
    this.changed();
    return { ok: true, player, resumed: false };
  }

  disconnect(id) { const p = this.players.get(id); if (p) { p.connected = false; this.changed(); } }
  kick(id) { if (this.players.delete(id)) { this.round?.locked.delete(id); this.changed(); } }
  adjust(id, delta) {
    const p = this.players.get(id);
    if (p) { p.score = Math.max(0, p.score + delta); this.changed(); }
  }

  // ---- snapshots ---------------------------------------------------------
  snapshot(role = 'tv', playerId = null) {
    const r = this.round;
    const ranked = rankPlayers([...this.players.values()]);
    const showOptions = r && (this.phase === 'revealed' || (r.step >= 0 && ['awaiting_audio', 'open', 'paused'].includes(this.phase)));
    const s = {
      phase: this.phase,
      code: this.code,
      maxSteps: r ? r.maxSteps : this.maxSteps,
      step: r && r.step >= 0 ? r.step : null,
      ladderMs: this.config.ladderMs,
      timer: this.timer.active()
        ? { remainingMs: Math.round(this.timer.remaining()), totalMs: this.timer.total, running: this.timer.running }
        : null,
      options: showOptions ? r.options.map((o) => ({ title: o.title, artist: o.artist })) : null,
      leaderboard: ranked.map((p) => ({ id: p.id, name: p.name, score: p.score, rank: p.rank, connected: p.connected })),
      reveal: r && this.phase === 'revealed' ? this.revealInfo(r) : null,
    };
    if (role === 'player') {
      const me = ranked.find((p) => p.id === playerId);
      s.you = me ? { id: me.id, name: me.name, score: me.score, rank: me.rank, locked: r ? r.locked.has(me.id) : false } : null;
    }
    if (role === 'host') {
      s.round = r ? {
        songId: r.song.id, title: r.song.title, artist: r.song.artist, correctIndex: r.correctIndex,
        locked: [...r.locked],
      } : null;
      s.notices = this.notices.slice(-5);
      s.songs = this.getSongs().map((x) => ({ id: x.id, title: x.title, artist: x.artist, played: this.played.has(x.id) }));
      s.players = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, bot: p.bot }));
    }
    return s;
  }

  revealInfo(r) {
    return {
      correctIndex: r.correctIndex, title: r.song.title, artist: r.song.artist, hook: r.song.hook || '',
      art: r.song.art ? `/art/${r.song.id}.${r.song.art}` : null,
      winnerId: r.winner?.id ?? null, winnerName: r.winner?.name ?? null, points: r.winner?.points ?? 0,
    };
  }

  // ---- round flow ----------------------------------------------------------
  startRound({ songId, maxSteps } = {}) {
    if (!['idle', 'revealed'].includes(this.phase)) return { ok: false, error: 'busy' };
    const songs = this.getSongs();
    let song;
    if (songId) song = songs.find((s) => s.id === songId);
    else {
      let pool = songs.filter((s) => !this.played.has(s.id));
      if (!pool.length) { this.played.clear(); pool = songs; }
      song = pool[Math.floor(this.rng() * pool.length)];
    }
    if (!song) return { ok: false, error: 'no_song' };
    const built = buildOptions(song, songs, this.rng);
    if (!built) return { ok: false, error: 'not_enough_options' };
    if (this.phase === 'revealed') this.emit('host', { t: 'stop' });
    const cap = this.config.ladderMs.length;
    this.round = {
      song, options: built.options, correctIndex: built.correctIndex, step: -1,
      maxSteps: Math.min(cap, Math.max(1, Math.floor(maxSteps ?? this.maxSteps))),
      locked: new Set(), winner: null,
    };
    this.played.add(song.id);
    this.phase = 'preloading';
    this.emit('host', { t: 'preload', song: { id: song.id, file: song.file, offsetMs: song.offsetMs || 0 } });
    this.timer.start(this.config.preloadTimeoutMs, () => this.preloadFailed('timeout'));
    this.changed();
    return { ok: true };
  }

  hostReady() {
    if (this.phase !== 'preloading') return;
    this.phase = 'countdown';
    this.timer.start(this.config.preRoundMs, () => this.beginStep(0));
    this.emit('sfx', 'countdown');
    this.changed();
  }

  preloadFailed(reason = 'error') {
    if (this.phase !== 'preloading') return;
    const songId = this.round.song.id;
    this.timer.clear();
    this.notices.push({ t: 'missing', songId, reason, at: this.timers.now() });
    this.emit('host', { t: 'stop' });
    this.emit('song_unavailable', { songId, reason });
    this.phase = 'idle';
    this.round = null;
    this.changed();
  }

  beginStep(i, keepLocks = false) {
    const r = this.round;
    r.step = i;
    if (!keepLocks) r.locked.clear();
    this.timer.clear();
    this.phase = 'awaiting_audio';
    this.emit('host', { t: 'play_step', step: i, lengthMs: this.config.ladderMs[i], offsetMs: r.song.offsetMs || 0 });
    this.ackTimer.start(this.config.ackTimeoutMs, () => this.stepStarted());
    this.changed();
  }

  stepStarted() {
    if (this.phase !== 'awaiting_audio') return;
    this.ackTimer.clear();
    const r = this.round;
    this.phase = 'open';
    this.timer.start(this.config.ladderMs[r.step] + this.config.answerMs, () => this.stepEnded());
    this.emit('step_open', { step: r.step });
    this.emit('sfx', 'step');
    this.changed();
  }

  stepEnded() {
    if (this.phase !== 'open') return;
    const r = this.round;
    if (r.step + 1 < r.maxSteps) { this.emit('sfx', 'next'); this.beginStep(r.step + 1); }
    else this.reveal(null);
  }

  answer(playerId, index) {
    const r = this.round;
    const p = this.players.get(playerId);
    if (!p || !r || this.phase !== 'open') return { ok: false, error: 'closed' };
    if (!Number.isInteger(index) || index < 0 || index >= r.options.length) return { ok: false, error: 'bad_option' };
    if (r.locked.has(playerId)) return { ok: false, error: 'locked' };
    if (index === r.correctIndex) {
      const points = pointsForStep(r.step, this.config.points);
      p.score += points;
      this.reveal({ id: p.id, name: p.name, points });
      return { ok: true, correct: true, points };
    }
    p.score = applyWrong(p.score, this.config.wrongPenalty);
    r.locked.add(playerId);
    this.emit('sfx', 'wrong');
    const live = [...this.players.values()].filter((x) => x.connected);
    if (live.length && live.every((x) => r.locked.has(x.id))) this.stepEnded();
    else this.changed();
    return { ok: true, correct: false };
  }

  reveal(winner = null) {
    const r = this.round;
    if (!r || this.phase === 'revealed' || this.phase === 'idle') return;
    this.timer.clear();
    this.ackTimer.clear();
    r.winner = winner;
    this.phase = 'revealed';
    this.emit('host', { t: 'full', offsetMs: r.song.offsetMs || 0 });
    this.emit('sfx', winner ? 'win' : 'nobody');
    this.changed();
  }

  skip() {
    if (!this.round) return;
    this.timer.clear();
    this.ackTimer.clear();
    this.emit('host', { t: 'stop' });
    this.phase = 'idle';
    this.round = null;
    this.changed();
  }

  // ---- operator controls ---------------------------------------------------
  pause() {
    if (this.phase !== 'open' && this.phase !== 'countdown') return;
    this.timer.pause();
    this.pausedFrom = this.phase;
    this.phase = 'paused';
    this.emit('host', { t: 'pause' });
    this.changed();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = this.pausedFrom;
    this.timer.resume();
    this.emit('host', { t: 'resume' });
    this.changed();
  }

  _unpauseAudio() {
    if (this.phase === 'paused') { this.phase = this.pausedFrom; this.emit('host', { t: 'resume' }); }
  }

  replay() {
    if (this.phase !== 'open' && this.phase !== 'paused') return;
    if (this.pausedFrom === 'countdown' && this.phase === 'paused') return;
    this._unpauseAudio();
    this.timer.clear();
    this.beginStep(this.round.step, true);
  }

  nextStep() {
    if (this.phase !== 'open' && this.phase !== 'paused') return;
    if (this.pausedFrom === 'countdown' && this.phase === 'paused') return;
    this._unpauseAudio();
    this.timer.clear();
    const r = this.round;
    if (r.step + 1 < r.maxSteps) this.beginStep(r.step + 1);
    else this.reveal(null);
  }

  revealNow() {
    if (!this.round || ['idle', 'revealed', 'preloading'].includes(this.phase)) return;
    this._unpauseAudio();
    this.reveal(null);
  }

  next() {
    if (this.phase !== 'revealed') return;
    this.emit('host', { t: 'stop' });
    this.phase = 'idle';
    this.round = null;
    this.changed();
  }

  setMaxSteps(n) {
    this.maxSteps = Math.min(this.config.ladderMs.length, Math.max(1, Math.floor(Number(n) || 1)));
    this.changed();
  }
}
