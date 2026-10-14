# Song Intro Game (מאי's Capybara Party) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Hebrew, phone-based "name that tune" party game: a short intro plays through the operator's Mac, up to 14 girls answer on their phones, the game steps the intro up through a ladder, scores answers, and a song manager lets the host (and the birthday girl) build the song list by searching the NAS.

**Architecture:** One Node.js server (Express + `ws`) holds a pure, timer-injected `Game` state machine. Four vanilla-JS pages talk to it over one WebSocket: `/play` (phones), `/tv` (big screen), `/host` (operator; also plays the audio with Web Audio), `/manage` (song library). Songs are local files copied into `songs/`; the NAS is only searched through a cached filename index. A Cloudflare tunnel exposes only `/play`, the QR, and the WebSocket; `/host`, `/tv`, `/manage`, `/songs` and `/api/manage` are refused for tunnelled requests.

**Tech Stack:** Node.js 22 (ESM), `express`, `ws`, `music-metadata`, `qrcode`, `node:test`, vanilla HTML/CSS/JS (no bundler), Web Audio API, `cloudflared` (optional, on the Mac).

**Spec:** `docs/superpowers/specs/2026-10-14-song-intro-game-design.md`

## Global Constraints

- Node.js 22, ESM (`"type": "module"`), no build step, no TypeScript.
- UI is Hebrew only, right-to-left (`<html lang="he" dir="rtl">`); song titles/artists use `dir="auto"`.
- Theme: "מאי" and capybaras; sound effects are synthesized with Web Audio (no audio assets).
- Intro ladder `[1000, 2000, 4000, 8000, 15000]` ms; points per step `[100, 80, 60, 40, 20]`; wrong answer `−10` (score never below 0); 4 choices per round; solo play (no teams).
- Join = QR code + 4-letter code + nickname only; no accounts. 12–14 players on Saturday (hard cap 40).
- Songs are local files in `songs/`; music root is `\\BIGBOX2\music` on Windows and `/Volumes/music` on the Mac, configurable via `MUSIC_DIR`. All stored paths are **relative** to the root.
- The host machine on Saturday is the **Mac**, running the host page in **Chrome** (Safari suspends AudioContext aggressively).
- `/host`, `/tv`, `/manage`, `/songs`, `/api/manage` must never be reachable through the public tunnel; `/manage` API requires a PIN unless the request is from loopback.
- "Attempts" = `maxSteps`: how many ladder steps run before reveal (1–5, default 5, per-round override). A wrong answer locks that player out for the **current step only**.
- Server is the single clock. Phones receive *remaining durations*, never absolute timestamps. The answer window opens when the host page acks that audio actually started.
- Never write lyrics; the hook line is a free-text field the user types.

## Review Focus

Failure modes the spec implies but no task's happy path exercises; each has a pinning test in the owning task.

1. A phone locks/reconnects mid-step: the player must keep score, lock-out state and see the same remaining time (Task 5, Task 8).
2. Two girls pick the same nickname, or a nickname contains `<script>`/HTML/very long text: names stay distinct, are stripped of markup characters and capped (Task 3); pages render with `textContent` only (Tasks 10–12).
3. A song file is missing or undecodable when its round starts: the song is flagged unavailable, the host sees a notice, the game returns to idle and continues (Task 5, Task 12).
4. The tunnel is absent or fails, or someone on the public URL requests `/host`, `/manage`, `/songs/...`: start script falls back to the LAN URL/QR; tunnelled requests get 404 (Task 7, Task 8, Task 21).
5. A path outside the music root (`..\..\Windows\...`, absolute paths, wrong extension) is sent to add/preview/upload: it is refused (Task 17).

## File Structure

```
package.json  .gitignore  config.js
src/game/scoring.js          pure scoring + ranking
src/game/game.js             Game state machine (EventEmitter, injected timers/rng)
src/game/bots.js             practice-mode fake players
src/library/store.js         data/songs.json CRUD (atomic writes)
src/library/text.js          normalize / hasHebrew / parseRel / expandQuery
src/library/search.js        in-memory search over the filename index
src/library/indexer.js       scanMusic() + IndexService (cache, refresh, resolve)
src/library/tags.js          music-metadata wrapper with filename fallback
src/library/ingest.js        copy file into songs/, build song entry, extract art
src/library/distractors.js   pick 3 wrong answers (same language, similar BPM)
src/library/spotify.js       playlist import (pasted list + embed-page scrape)
src/net/guard.js             isLocalRequest, requireLocal, requirePin
src/net/hub.js               WebSocket hub (roles: player/tv/host)
src/net/manage-routes.js     Express router for /api/manage
src/app.js                   createApp() wires everything; used by start + tests
public/css/theme.css  public/img/capybara.svg
public/js/dom.js ws.js sfx.js host-audio.js bpm.js
public/play.html play.js  tv.html tv.js  host.html host.js  manage.html manage.js
data/aliases.json  data/decoys.json  data/songs.json
scripts/start.js  scripts/seed.js
test/helpers.js + one test file per module
docs/RUNBOOK-mac.md
```

**Milestone (end of Task 13):** operator picks a song, phones join, a full ladder round plays with scoring, TV shows the leaderboard, using a hand-edited `songs.json`. Everything after is enhancement.

---

### Task 1: Scaffold, config, test harness

**Files:**
- Create: `package.json`, `.gitignore`, `config.js`, `data/songs.json`, `test/config.test.js`

**Interfaces:**
- Produces: `config` object (default export name `config` from `config.js`) with fields `rootDir, port, musicDir, songsDir, dataDir, pin, ladderMs, points, wrongPenalty, maxSteps, preRoundMs, answerMs, preloadTimeoutMs, ackTimeoutMs, maxPlayers`.

- [ ] **Step 1: Initialise git (the folder is not a repository yet) and the project**

```bash
cd C:/Users/Meni/workspace/identifySongs
git init
```

Create `package.json`:

```json
{
  "name": "identify-songs",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "start": "node scripts/start.js",
    "seed": "node scripts/seed.js",
    "test": "node --test \"test/**/*.test.js\""
  },
  "dependencies": {
    "express": "^4.21.0",
    "music-metadata": "^10.0.0",
    "qrcode": "^1.5.4",
    "ws": "^8.18.0"
  }
}
```

Create `.gitignore`:

```
node_modules/
songs/
data/index.json
.remember/
*.log
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `added N packages`, no errors.

- [ ] **Step 3: Write the failing test** — `test/config.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.js';

test('ladder and points line up and match the spec', () => {
  assert.deepEqual(config.ladderMs, [1000, 2000, 4000, 8000, 15000]);
  assert.deepEqual(config.points, [100, 80, 60, 40, 20]);
  assert.equal(config.ladderMs.length, config.points.length);
  assert.equal(config.wrongPenalty, 10);
  assert.equal(config.maxSteps, 5);
});

test('music dir and pin have sane defaults', () => {
  assert.ok(config.musicDir.length > 0);
  assert.match(config.pin, /^\d{4}$/);
});
```

- [ ] **Step 4: Run it, expect failure**

Run: `npm test`
Expected: FAIL — cannot find `../config.js`.

- [ ] **Step 5: Implement** — `config.js`

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMusic =
  process.platform === 'darwin' ? '/Volumes/music'
  : process.platform === 'win32' ? '\\\\BIGBOX2\\music'
  : '/mnt/music';

export const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  musicDir: process.env.MUSIC_DIR || defaultMusic,
  songsDir: path.join(rootDir, 'songs'),
  dataDir: path.join(rootDir, 'data'),
  pin: process.env.MANAGE_PIN || String(1000 + Math.floor(Math.random() * 9000)),
  ladderMs: [1000, 2000, 4000, 8000, 15000],
  points: [100, 80, 60, 40, 20],
  wrongPenalty: 10,
  maxSteps: 5,
  preRoundMs: 5000,
  answerMs: 8000,
  preloadTimeoutMs: 20000,
  ackTimeoutMs: 3000,
  maxPlayers: 40,
};
```

Create `data/songs.json` containing exactly: `{ "songs": [] }`

- [ ] **Step 6: Run, expect pass**

Run: `npm test`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold project, config and test harness"
```

---

### Task 2: Scoring and ranking

**Files:**
- Create: `src/game/scoring.js`, `test/scoring.test.js`

**Interfaces:**
- Produces:
  - `pointsForStep(step: number, points: number[]): number`
  - `applyWrong(score: number, penalty: number): number` (never below 0)
  - `rankPlayers(players: {name:string, score:number}[]): Array<player & {rank:number}>` sorted by score desc then name; equal scores share a rank (1,1,3).

- [ ] **Step 1: Write the failing test** — `test/scoring.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsForStep, applyWrong, rankPlayers } from '../src/game/scoring.js';

const POINTS = [100, 80, 60, 40, 20];

test('points drop with every step', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => pointsForStep(i, POINTS)), POINTS);
});

test('steps beyond the table use the last value', () => {
  assert.equal(pointsForStep(9, POINTS), 20);
});

test('bad step throws', () => {
  assert.throws(() => pointsForStep(-1, POINTS));
  assert.throws(() => pointsForStep(1.5, POINTS));
});

test('wrong answer costs the penalty but never goes below zero', () => {
  assert.equal(applyWrong(100, 10), 90);
  assert.equal(applyWrong(5, 10), 0);
});

test('ranking: score desc, then name, ties share a rank', () => {
  const r = rankPlayers([
    { name: 'דנה', score: 50 },
    { name: 'אבי', score: 80 },
    { name: 'גל', score: 50 },
    { name: 'נועה', score: 10 },
  ]);
  assert.deepEqual(r.map((p) => [p.name, p.rank]), [['אבי', 1], ['גל', 2], ['דנה', 2], ['נועה', 4]]);
});
```

Note on the ranking assertion: with Hebrew `localeCompare`, `'גל'` sorts before `'דנה'`; both have 50, so both rank 2 and the next rank is 4.

- [ ] **Step 2: Run, expect failure** — `npm test` → cannot find module.

- [ ] **Step 3: Implement** — `src/game/scoring.js`

```js
export function pointsForStep(step, points) {
  if (!Number.isInteger(step) || step < 0) throw new RangeError(`bad step ${step}`);
  return points[Math.min(step, points.length - 1)];
}

export function applyWrong(score, penalty) {
  return Math.max(0, score - penalty);
}

export function rankPlayers(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'he'));
  let lastScore = null;
  let lastRank = 0;
  return sorted.map((p, i) => {
    if (p.score !== lastScore) {
      lastRank = i + 1;
      lastScore = p.score;
    }
    return { ...p, rank: lastRank };
  });
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scoring and ranking"
```

---

### Task 3: Game engine — players, join, reconnect, snapshots

**Files:**
- Create: `src/game/game.js`, `test/helpers.js`, `test/game-players.test.js`

**Interfaces:**
- Produces (class `Game extends EventEmitter`, plus helpers):
  - `new Game({ config, getSongs, timers?, rng?, code? })` — `getSongs(): Song[]` returns the *enabled* songs; `timers = { set(fn, ms)→id, clear(id), now()→ms }` defaults to real timers.
  - `game.code: string` (4 letters, no I/O/0/1 ambiguity)
  - `game.join(rawName, token?) → { ok, player, resumed } | { ok:false, error:'bad_name'|'full' }`
  - `game.disconnect(id)`, `game.kick(id)`, `game.adjust(id, delta)`
  - `game.snapshot(role: 'player'|'tv'|'host', playerId?) → Snapshot` (shape in Step 3)
  - Events: `'change'` (state changed), `'host'` (message for host page), `'sfx'` (name), `'step_open'` ({step}), `'song_unavailable'` ({songId, reason})
  - exports `makeCode`, `cleanName`, `realTimers`, `PausableTimer`
- `Song` = `{ id, title, artist, file, offsetMs, hook, art: 'jpg'|'png'|null, distractors: {title,artist}[] }`

- [ ] **Step 1: Test helpers** — `test/helpers.js`

```js
export class FakeTimers {
  constructor() { this.t = 0; this.q = []; this.n = 1; }
  now = () => this.t;
  set = (fn, ms) => { const id = this.n++; this.q.push({ id, at: this.t + ms, fn }); return id; };
  clear = (id) => { this.q = this.q.filter((x) => x.id !== id); };
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

export const SONGS = ['A', 'B', 'C', 'D', 'E', 'F'].map((x, i) => ({
  id: `s${i}`, title: `Song ${x}`, artist: `Artist ${x}`, file: `s${i}.mp3`, offsetMs: 500,
  hook: '', art: null, distractors: [],
}));
SONGS[0].distractors = [
  { title: 'Decoy 1', artist: 'X' }, { title: 'Decoy 2', artist: 'Y' }, { title: 'Decoy 3', artist: 'Z' },
];
```

- [ ] **Step 2: Write the failing tests** — `test/game-players.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, cleanName, makeCode } from '../src/game/game.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

const mk = () => new Game({ config, getSongs: () => SONGS, timers: new FakeTimers(), rng: () => 0.3 });

test('join creates a player with a token', () => {
  const g = mk();
  const r = g.join('מאי');
  assert.equal(r.ok, true);
  assert.equal(r.player.name, 'מאי');
  assert.equal(r.player.score, 0);
  assert.ok(r.player.token.length >= 8);
});

test('two players with the same nickname stay distinct', () => {
  const g = mk();
  const a = g.join('דנה').player;
  const b = g.join('דנה').player;
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.name, b.name);
  assert.equal(b.name, 'דנה 2');
});

test('markup characters are stripped and names are capped at 16 characters', () => {
  assert.equal(cleanName('<script>alert(1)</script>'), 'script alert(1) /script');
  assert.equal(Array.from(cleanName('א'.repeat(40))).length, 16);
  assert.equal(cleanName('   '), '');
});

test('empty names are refused', () => {
  assert.deepEqual(mk().join('  <> '), { ok: false, error: 'bad_name' });
});

test('rejoining with the token resumes the same player and keeps the score', () => {
  const g = mk();
  const p = g.join('גל').player;
  g.adjust(p.id, 40);
  g.disconnect(p.id);
  const r = g.join('whatever', p.token);
  assert.equal(r.resumed, true);
  assert.equal(r.player.id, p.id);
  assert.equal(r.player.score, 40);
  assert.equal(r.player.connected, true);
});

test('room is capped', () => {
  const g = new Game({ config: { ...config, maxPlayers: 2 }, getSongs: () => SONGS, timers: new FakeTimers() });
  g.join('a'); g.join('b');
  assert.deepEqual(g.join('c'), { ok: false, error: 'full' });
});

test('adjust never drops below zero; kick removes the player', () => {
  const g = mk();
  const p = g.join('נועה').player;
  g.adjust(p.id, -50);
  assert.equal(p.score, 0);
  g.kick(p.id);
  assert.equal(g.snapshot('tv').leaderboard.length, 0);
});

test('codes are 4 letters without ambiguous characters', () => {
  for (let i = 0; i < 50; i++) assert.match(makeCode(), /^[A-HJ-NP-Z]{4}$/);
});

test('player snapshot has `you` and never leaks answers; tv snapshot has no `you`', () => {
  const g = mk();
  const p = g.join('מאי').player;
  const s = g.snapshot('player', p.id);
  assert.equal(s.phase, 'idle');
  assert.equal(s.you.name, 'מאי');
  assert.equal(s.you.rank, 1);
  assert.equal(g.snapshot('tv').you, undefined);
  assert.equal(JSON.stringify(s).includes('correctIndex'), false);
});
```

- [ ] **Step 3: Run, expect failure** — `npm test` → cannot find `game.js`.

- [ ] **Step 4: Implement the skeleton** — `src/game/game.js`

```js
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
  return Array.from(s).slice(0, 16).join('');
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
}
```

- [ ] **Step 5: Run, expect pass** — `npm test`. Expected: all Game player tests pass (`cleanName` turns `<`, `>` into spaces and collapses whitespace, so the markup test yields `script alert(1) /script`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(game): players, join/reconnect, snapshots"
```

---

### Task 4: Game engine — round flow, steps, answers, scoring

**Files:**
- Modify: `src/game/game.js` (add methods inside `class Game`; add helper functions at file end)
- Test: `test/game-round.test.js`

**Interfaces:**
- Consumes: Task 3 `Game`, `PausableTimer`, `pointsForStep`, `applyWrong`.
- Produces on `Game`:
  - `startRound({ songId?, maxSteps? }) → { ok:true } | { ok:false, error:'busy'|'no_song'|'not_enough_options' }`
  - `hostReady()`, `preloadFailed(reason)`, `stepStarted()` (host acks)
  - `answer(playerId, index) → { ok, correct?, points?, error?:'closed'|'bad_option'|'locked' }`
  - `reveal(winner|null)` internal; `stepEnded()` internal; `beginStep(i, keepLocks?)`
  - `host` events: `{t:'preload', song:{id,file,offsetMs}}`, `{t:'play_step', step, lengthMs, offsetMs}`, `{t:'full', offsetMs}`, `{t:'stop'}`
  - phases: `idle → preloading → countdown → awaiting_audio → open → (next step | revealed)`

- [ ] **Step 1: Write the failing tests** — `test/game-round.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

function setup(over = {}) {
  const timers = new FakeTimers();
  const game = new Game({ config: { ...config, ...over }, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const host = [];
  game.on('host', (m) => host.push(m));
  const a = game.join('אורי').player;
  const b = game.join('דנה').player;
  return { game, timers, host, a, b };
}
const correct = (g) => g.snapshot('host').round.correctIndex;
const wrong = (g) => (correct(g) + 1) % 4;

function toStep(ctx, step = 0, over = {}) {
  const { game, timers } = ctx;
  if (game.phase === 'idle' || game.phase === 'revealed') assert.equal(game.startRound({ songId: 's0', ...over }).ok, true);
  game.hostReady();
  timers.advance(config.preRoundMs);
  game.stepStarted();
  while (game.round.step < step) { game.nextStep(); game.stepStarted(); }
}

test('wrong answer: -10, locked for this step only, may answer again next step', () => {
  const ctx = setup(); const { game, timers, a } = ctx;
  game.adjust(a.id, 50);
  toStep(ctx, 0);
  assert.deepEqual(game.answer(a.id, wrong(game)), { ok: true, correct: false });
  assert.equal(a.score, 40);
  assert.equal(game.answer(a.id, correct(game)).error, 'locked');
  timers.advance(config.ladderMs[0] + config.answerMs);          // step 0 window ends
  assert.equal(game.phase, 'awaiting_audio');
  game.stepStarted();
  assert.equal(game.snapshot('player', a.id).you.locked, false);
  assert.equal(game.answer(a.id, correct(game)).correct, true);   // allowed again at step 1
  assert.equal(a.score, 40 + 80);
});

test('correct answer pays by step and ends the round with a reveal', () => {
  const ctx = setup(); const { game, host, a } = ctx;
  toStep(ctx, 2);
  const r = game.answer(a.id, correct(game));
  assert.deepEqual(r, { ok: true, correct: true, points: 60 });
  assert.equal(game.phase, 'revealed');
  assert.equal(game.snapshot('tv').reveal.winnerName, 'אורי');
  assert.deepEqual(host.at(-1), { t: 'full', offsetMs: 500 });
});

test('startRound sends preload, then countdown, then plays step 0 with the first ladder length', () => {
  const ctx = setup(); const { game, timers, host } = ctx;
  game.startRound({ songId: 's0' });
  assert.equal(game.phase, 'preloading');
  assert.deepEqual(host[0], { t: 'preload', song: { id: 's0', file: 's0.mp3', offsetMs: 500 } });
  game.hostReady();
  assert.equal(game.phase, 'countdown');
  assert.equal(game.snapshot('tv').timer.remainingMs, config.preRoundMs);
  timers.advance(config.preRoundMs);
  assert.equal(game.phase, 'awaiting_audio');
  assert.deepEqual(host.at(-1), { t: 'play_step', step: 0, lengthMs: 1000, offsetMs: 500 });
});

test('answer window opens only when the host acks; ack timeout opens it anyway', () => {
  const ctx = setup(); const { game, timers, a } = ctx;
  game.startRound({ songId: 's0' }); game.hostReady(); timers.advance(config.preRoundMs);
  assert.equal(game.answer(a.id, 0).error, 'closed');
  timers.advance(config.ackTimeoutMs);
  assert.equal(game.phase, 'open');
  assert.equal(game.snapshot('tv').timer.remainingMs, config.ladderMs[0] + config.answerMs);
});

test('step expiry lengthens the intro; after maxSteps the round is revealed with no winner', () => {
  const ctx = setup({ maxSteps: 2 }); const { game, timers, host } = ctx;
  toStep(ctx, 0);
  timers.advance(config.ladderMs[0] + config.answerMs);
  assert.equal(host.at(-1).lengthMs, 2000);
  game.stepStarted();
  timers.advance(config.ladderMs[1] + config.answerMs);
  assert.equal(game.phase, 'revealed');
  assert.equal(game.snapshot('tv').reveal.winnerId, null);
});

test('per-round maxSteps override beats the game default', () => {
  const ctx = setup(); const { game, timers } = ctx;
  toStep(ctx, 0, { maxSteps: 1 });
  timers.advance(config.ladderMs[0] + config.answerMs);
  assert.equal(game.phase, 'revealed');
});

test('when every connected player is locked the step ends early', () => {
  const ctx = setup(); const { game, a, b, host } = ctx;
  toStep(ctx, 0);
  game.answer(a.id, wrong(game));
  game.answer(b.id, wrong(game));
  assert.equal(game.phase, 'awaiting_audio');
  assert.equal(host.at(-1).step, 1);
});

test('options: 4 distinct, include the right title, hide correctness from players', () => {
  const ctx = setup(); const { game, a } = ctx;
  toStep(ctx, 0);
  const s = game.snapshot('player', a.id);
  assert.equal(s.options.length, 4);
  assert.equal(new Set(s.options.map((o) => o.title)).size, 4);
  assert.equal(s.options[correct(game)].title, 'Song A');
  assert.equal(JSON.stringify(s).includes('correctIndex'), false);
});

test('bad option index and answers outside the open window are rejected', () => {
  const ctx = setup(); const { game, a } = ctx;
  assert.equal(game.answer(a.id, 0).error, 'closed');
  toStep(ctx, 0);
  assert.equal(game.answer(a.id, 9).error, 'bad_option');
  assert.equal(game.answer(a.id, 1.5).error, 'bad_option');
});

test('random pick avoids repeats until the pool is used up', () => {
  const ctx = setup(); const { game } = ctx;
  const seen = new Set();
  for (let i = 0; i < SONGS.length; i++) {
    assert.equal(game.startRound({}).ok, true);
    seen.add(game.round.song.id);
    game.skip();
  }
  assert.equal(seen.size, SONGS.length);
});

test('preload timeout returns to idle with a notice and a song_unavailable event', () => {
  const ctx = setup(); const { game, timers } = ctx;
  const events = []; game.on('song_unavailable', (e) => events.push(e));
  game.startRound({ songId: 's0' });
  timers.advance(config.preloadTimeoutMs);
  assert.equal(game.phase, 'idle');
  assert.deepEqual(events, [{ songId: 's0', reason: 'timeout' }]);
  assert.equal(game.snapshot('host').notices.at(-1).songId, 's0');
});

test('not enough distinct options refuses to start', () => {
  const game = new Game({ config, getSongs: () => SONGS.slice(5), timers: new FakeTimers() });
  assert.deepEqual(game.startRound({ songId: 's5' }), { ok: false, error: 'not_enough_options' });
});
```

- [ ] **Step 2: Run, expect failure** — `npm test` → `game.startRound is not a function`.

- [ ] **Step 3: Implement** — add inside `class Game` (before the closing brace) in `src/game/game.js`:

```js
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

  // basic versions of two operator actions; Task 5 makes nextStep pause-aware
  nextStep() {
    if (this.phase !== 'open') return;
    this.timer.clear();
    const r = this.round;
    if (r.step + 1 < r.maxSteps) this.beginStep(r.step + 1);
    else this.reveal(null);
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
```

and append these helpers at the end of the file (outside the class):

```js
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
```

- [ ] **Step 4: Run, expect pass** — `npm test`. All Task 4 tests pass (they use `nextStep()` and `skip()`, which Step 3 defines in their basic form).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(game): round flow, steps, answers, reveal"
```

---

### Task 5: Game engine — operator controls, pause/resume, reconnect restore

**Files:**
- Modify: `src/game/game.js` (methods inside `class Game`)
- Test: `test/game-controls.test.js`

**Interfaces:**
- Consumes: Task 4 methods.
- Produces on `Game`: `pause()`, `resume()`, `replay()`, `nextStep()`, `revealNow()`, `skip()`, `next()`, `setMaxSteps(n)`; `host` events `{t:'pause'}`, `{t:'resume'}`, `{t:'stop'}`.

- [ ] **Step 1: Write the failing tests** — `test/game-controls.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

function setup() {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const host = []; game.on('host', (m) => host.push(m));
  const a = game.join('אורי').player;
  const b = game.join('דנה').player;       // a second player, so one wrong answer does not lock "everyone" and end the step
  game.startRound({ songId: 's0' }); game.hostReady(); timers.advance(config.preRoundMs); game.stepStarted();
  return { game, timers, host, a, b };
}
const correct = (g) => g.snapshot('host').round.correctIndex;

test('pause freezes the countdown; resume continues from the same remaining time', () => {
  const { game, timers, host, a } = setup();
  timers.advance(3000);
  const before = game.snapshot('tv').timer.remainingMs;            // 1000 + 8000 - 3000
  assert.equal(before, 6000);
  game.pause();
  assert.equal(game.phase, 'paused');
  assert.deepEqual(host.at(-1), { t: 'pause' });
  timers.advance(60000);
  assert.equal(game.snapshot('tv').timer.remainingMs, 6000);
  assert.equal(game.snapshot('tv').timer.running, false);
  assert.equal(game.answer(a.id, correct(game)).error, 'closed');
  game.resume();
  assert.equal(game.phase, 'open');
  assert.deepEqual(host.at(-1), { t: 'resume' });
  timers.advance(2000);
  assert.equal(game.snapshot('tv').timer.remainingMs, 4000);
});

test('pausing the pre-round countdown also freezes it', () => {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  game.startRound({ songId: 's0' }); game.hostReady();
  timers.advance(2000); game.pause(); timers.advance(99999);
  assert.equal(game.snapshot('tv').timer.remainingMs, 3000);
  assert.equal(game.snapshot('tv').options, null);                   // choices must not appear before any audio has played
  game.resume();
  assert.equal(game.phase, 'countdown');
});

test('replay restarts the same step, keeps lock-outs, and resumes audio first if paused', () => {
  const { game, host, a } = setup();
  game.answer(a.id, (correct(game) + 1) % 4);
  game.pause();
  game.replay();
  assert.deepEqual(host.slice(-2), [{ t: 'resume' }, { t: 'play_step', step: 0, lengthMs: 1000, offsetMs: 500 }]);
  assert.equal(game.phase, 'awaiting_audio');
  game.stepStarted();
  assert.equal(game.snapshot('player', a.id).you.locked, true);
});

test('nextStep lengthens the intro; on the last step it reveals', () => {
  const { game, host } = setup();
  game.nextStep();
  assert.equal(host.at(-1).step, 1);
  game.stepStarted(); game.nextStep(); game.stepStarted(); game.nextStep(); game.stepStarted(); game.nextStep();
  assert.equal(host.at(-1).step, 4);
  game.stepStarted(); game.nextStep();
  assert.equal(game.phase, 'revealed');
});

test('revealNow shows the answer without a winner; next returns to idle and stops audio', () => {
  const { game, host } = setup();
  game.revealNow();
  assert.equal(game.phase, 'revealed');
  assert.equal(game.snapshot('tv').reveal.title, 'Song A');
  game.next();
  assert.equal(game.phase, 'idle');
  assert.deepEqual(host.at(-1), { t: 'stop' });
  assert.equal(game.snapshot('tv').reveal, null);
});

test('skip abandons the round with no scoring', () => {
  const { game, host, a } = setup();
  game.skip();
  assert.equal(game.phase, 'idle');
  assert.equal(a.score, 0);
  assert.deepEqual(host.at(-1), { t: 'stop' });
});

test('starting a round straight from a reveal stops the previous audio first', () => {
  const { game, host } = setup();
  game.revealNow();
  game.startRound({ songId: 's1' });
  assert.deepEqual(host.slice(-2).map((m) => m.t), ['stop', 'preload']);
});

test('a phone that dropped and rejoined sees the same lock state and remaining time', () => {
  const { game, timers, a } = setup();
  game.answer(a.id, (correct(game) + 1) % 4);
  timers.advance(1500);
  game.disconnect(a.id);
  timers.advance(1000);
  game.join('ignored', a.token);
  const s = game.snapshot('player', a.id);
  assert.equal(s.you.locked, true);
  assert.equal(s.phase, 'open');
  assert.equal(s.timer.remainingMs, 9000 - 2500);
  assert.equal(s.options.length, 4);
});

test('setMaxSteps clamps to the ladder', () => {
  const { game } = setup();
  game.setMaxSteps(99); assert.equal(game.maxSteps, 5);
  game.setMaxSteps(0); assert.equal(game.maxSteps, 1);
});
```

- [ ] **Step 2: Run, expect failure** — `game.pause is not a function`.

- [ ] **Step 3: Implement** — **replace** the basic `nextStep()` from Task 4 with the pause-aware version below, **keep** Task 4's `skip()`, and add the rest inside `class Game`:

```js
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
```

- [ ] **Step 4: Run the whole suite, expect all green** — `npm test`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(game): operator controls, pause/resume, reconnect restore"
```


---

### Task 6: Song library store

**Files:**
- Create: `src/library/store.js`, `test/store.test.js`

**Interfaces:**
- Produces `class LibraryStore(file)`:
  - `await load()`, `list(): Song[]`, `enabled(): Song[]` (excludes `enabled === false` and `unavailable`), `get(id)`, `await add(partial) → Song`, `await update(id, patch) → Song|null`, `await remove(id) → boolean`, `await reorder(ids: string[])`
  - Song fields: `id, title, artist, album, file, srcRel, art ('jpg'|'png'|null), offsetMs, hook, lang ('he'|'en'), bpm (number|null), enabled, unavailable, distractors ({title,artist}[≤3])`
  - `update` accepts only: `title, artist, album, offsetMs, hook, bpm, enabled, unavailable, distractors, lang`.

- [ ] **Step 1: Write the failing test** — `test/store.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LibraryStore } from '../src/library/store.js';

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'));
  const file = path.join(dir, 'songs.json');
  const s = new LibraryStore(file);
  await s.load();
  return { s, file };
}

test('missing file loads as empty; add persists with defaults and language', async () => {
  const { s, file } = await tmpStore();
  assert.deepEqual(s.list(), []);
  const a = await s.add({ title: 'תשע בכיכר', artist: 'גזוז', file: 'a.flac' });
  assert.match(a.id, /^s_[0-9a-f]{8}$/);
  assert.equal(a.lang, 'he'); assert.equal(a.enabled, true); assert.equal(a.offsetMs, 0); assert.deepEqual(a.distractors, []);
  const again = new LibraryStore(file); await again.load();
  assert.equal(again.list()[0].title, 'תשע בכיכר');
});

test('update whitelists fields and validates values', async () => {
  const { s } = await tmpStore();
  const a = await s.add({ title: 'Flowers', artist: 'Miley', file: 'f.flac' });
  const u = await s.update(a.id, {
    hook: 'x'.repeat(500), offsetMs: -5, bpm: 118, id: 'hack', file: '../../etc/passwd',
    distractors: [{ title: 'A', artist: 'a' }, { title: '', artist: 'b' }, { title: 'B' }, { title: 'C' }, { title: 'D' }],
  });
  assert.equal(u.id, a.id); assert.equal(u.file, 'f.flac');
  assert.equal(u.hook.length, 200); assert.equal(u.offsetMs, 0); assert.equal(u.bpm, 118);
  assert.deepEqual(u.distractors.map((d) => d.title), ['A', 'B', 'C']);
  assert.equal(await s.update('nope', { title: 'x' }), null);
});

test('enabled() hides disabled and unavailable songs; remove and reorder work', async () => {
  const { s } = await tmpStore();
  const [a, b, c] = [await s.add({ title: 'a', file: 'a' }), await s.add({ title: 'b', file: 'b' }), await s.add({ title: 'c', file: 'c' })];
  await s.update(b.id, { enabled: false });
  await s.update(c.id, { unavailable: true });
  assert.deepEqual(s.enabled().map((x) => x.title), ['a']);
  await s.reorder([c.id, a.id]);                         // ids not listed keep their relative order at the end
  assert.deepEqual(s.list().map((x) => x.title), ['c', 'a', 'b']);
  assert.equal(await s.remove(a.id), true);
  assert.equal(await s.remove(a.id), false);
});
```

- [ ] **Step 2: Run, expect failure** — `npm test` → cannot find `store.js`.

- [ ] **Step 3: Implement** — `src/library/store.js`

```js
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const HEB = /[֐-׿]/;
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanDistractors(list) {
  return (Array.isArray(list) ? list : [])
    .map((d) => ({ title: str(d?.title, 120).trim(), artist: str(d?.artist, 120).trim() }))
    .filter((d) => d.title)
    .slice(0, 3);
}

function normalizeSong(p) {
  const title = str(p.title, 120).trim();
  return {
    id: p.id || `s_${randomBytes(4).toString('hex')}`,
    title,
    artist: str(p.artist, 120).trim(),
    album: str(p.album, 120).trim(),
    file: str(p.file, 300),
    srcRel: str(p.srcRel, 600),
    art: p.art === 'jpg' || p.art === 'png' ? p.art : null,
    offsetMs: Number.isFinite(p.offsetMs) && p.offsetMs >= 0 ? Math.round(p.offsetMs) : 0,
    hook: str(p.hook, 200),
    lang: p.lang === 'en' || p.lang === 'he' ? p.lang : HEB.test(title) ? 'he' : 'en',
    bpm: Number.isFinite(p.bpm) ? Math.round(p.bpm) : null,
    enabled: p.enabled !== false,
    unavailable: p.unavailable === true,
    distractors: cleanDistractors(p.distractors),
  };
}

const ALLOWED = ['title', 'artist', 'album', 'offsetMs', 'hook', 'bpm', 'enabled', 'unavailable', 'distractors', 'lang'];
function pick(patch) {
  const out = {};
  for (const k of ALLOWED) if (k in patch) out[k] = patch[k];
  return out;
}

export class LibraryStore {
  constructor(file) { this.file = file; this.songs = []; }

  async load() {
    try {
      const j = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.songs = (Array.isArray(j.songs) ? j.songs : []).map(normalizeSong);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.songs = [];
    }
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ songs: this.songs }, null, 2));
    await fs.rename(tmp, this.file);
  }

  list() { return this.songs; }
  enabled() { return this.songs.filter((s) => s.enabled !== false && !s.unavailable); }
  get(id) { return this.songs.find((s) => s.id === id) ?? null; }

  async add(partial) {
    const s = normalizeSong(partial);
    this.songs.push(s);
    await this.save();
    return s;
  }

  async update(id, patch) {
    const s = this.get(id);
    if (!s) return null;
    const next = normalizeSong({ ...s, ...pick(patch) });
    Object.assign(s, next, { id: s.id, file: s.file, srcRel: s.srcRel, art: s.art });   // mutates synchronously, then persists
    await this.save();
    return s;
  }

  async remove(id) {
    const n = this.songs.length;
    this.songs = this.songs.filter((s) => s.id !== id);
    if (this.songs.length === n) return false;
    await this.save();
    return true;
  }

  async reorder(ids) {
    const rank = new Map(ids.map((id, i) => [id, i]));
    const known = this.songs.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    const rest = this.songs.filter((s) => !rank.has(s.id));
    this.songs = [...known, ...rest];
    await this.save();
  }
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(library): songs.json store"`

---

### Task 7: Network guard (local-only pages, PIN)

**Files:**
- Create: `src/net/guard.js`, `test/guard.test.js`

**Interfaces:**
- Produces:
  - `isPrivateAddress(addr)`, `isLoopback(addr)`
  - `isLocalRequest(req)` — false if any proxy/tunnel header is present, else true only for private/loopback addresses (reads `req.headers`, `req.socket.remoteAddress`; works for HTTP requests and WS upgrade requests)
  - `requireLocal(req,res,next)` — 404 otherwise
  - `requirePin(config)` → middleware: loopback bypasses; others need header `x-pin`; 10 failures per minute per IP → 429

- [ ] **Step 1: Write the failing test** — `test/guard.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, isLoopback, isLocalRequest, requireLocal, requirePin } from '../src/net/guard.js';

const req = (addr, headers = {}) => ({ headers, socket: { remoteAddress: addr } });
const res = () => { const r = { code: 200, status(c) { r.code = c; return r; }, end() { r.ended = true; }, json() { r.ended = true; } }; return r; };

test('private and loopback ranges', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '192.168.1.20', '172.16.0.5', '172.31.9.9', 'fe80::1']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1']) assert.equal(isPrivateAddress(a), false, a);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('192.168.1.5'), false);
});

test('a tunnelled request from loopback is NOT local (cloudflared connects from localhost)', () => {
  assert.equal(isLocalRequest(req('127.0.0.1')), true);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'cf-connecting-ip': '5.5.5.5' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '5.5.5.5' })), false);
  assert.equal(isLocalRequest(req('8.8.8.8')), false);
});

test('requireLocal 404s non-local requests', () => {
  let called = false; const r = res();
  requireLocal(req('8.8.8.8'), r, () => { called = true; });
  assert.equal(called, false); assert.equal(r.code, 404);
  requireLocal(req('192.168.1.7'), res(), () => { called = true; });
  assert.equal(called, true);
});

test('PIN: loopback bypasses, LAN needs it, wrong PIN is rate limited', () => {
  const mw = requirePin({ pin: '4321' });
  let ok = 0; const next = () => { ok++; };
  mw(req('127.0.0.1'), res(), next);
  mw(req('192.168.1.7', { 'x-pin': '4321' }), res(), next);
  assert.equal(ok, 2);
  const bad = res(); mw(req('192.168.1.7', { 'x-pin': '0000' }), bad, next);
  assert.equal(bad.code, 401);
  for (let i = 0; i < 12; i++) mw(req('192.168.1.9', { 'x-pin': 'nope' }), res(), next);
  const limited = res(); mw(req('192.168.1.9', { 'x-pin': '4321' }), limited, next);
  assert.equal(limited.code, 429);
  assert.equal(ok, 2);
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `src/net/guard.js`

```js
import { createHash, timingSafeEqual } from 'node:crypto';

const PROXY_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'];
const strip = (a = '') => a.replace(/^::ffff:/, '');

export function isLoopback(addr) {
  const a = strip(addr);
  return a === '::1' || a.startsWith('127.');
}

export function isPrivateAddress(addr) {
  const a = strip(addr);
  return isLoopback(a) || a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || /^f[cd]/i.test(a) || /^fe80:/i.test(a);
}

export function isLocalRequest(req) {
  if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
  return isPrivateAddress(req.socket.remoteAddress);
}

export function requireLocal(req, res, next) {
  if (isLocalRequest(req)) return next();
  res.status(404).end();
}

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function requirePin(config) {
  const fails = new Map();                       // ip -> { n, resetAt }
  return (req, res, next) => {
    const ip = strip(req.socket.remoteAddress);
    if (isLoopback(ip)) return next();
    const now = Date.now();
    let f = fails.get(ip);
    if (!f || f.resetAt < now) f = { n: 0, resetAt: now + 60_000 };
    fails.set(ip, f);
    if (f.n >= 10) return res.status(429).json({ error: 'too_many_attempts' });
    if (timingSafeEqual(digest(req.headers['x-pin'] ?? ''), digest(config.pin))) return next();
    f.n++;
    res.status(401).json({ error: 'bad_pin' });
  };
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(net): local-only and PIN guards"`

---

### Task 8: App wiring, HTTP routes and WebSocket hub

**Files:**
- Create: `src/net/hub.js`, `src/app.js`, `test/app.test.js`

**Interfaces:**
- Consumes: `Game`, `LibraryStore`, `isLocalRequest`, `requireLocal`, `config`.
- Produces:
  - `attachHub({ server, game }) → hub` with `hub.close()` and a settable `hub.extra(client, msg, send)` fallback for unknown host commands (Task 20)
  - `createApp({ config, timers?, rng? }) → Promise<{ app, server, game, store, hub, config, timers, setPublicUrl(url), joinUrl(), listen(port?) → Promise<number>, close() }>`
  - `lanUrl(port) → string`
  - HTTP: `GET /healthz`, `GET /api/join → {code,url}`, `GET /api/join-qr.svg`, pages `/play` (public), `/host /tv /manage` (local only), `/songs/*` (local only), `/art/*` (public), static `public/`
  - WS at `/ws`. Client→server: `{t:'hello', role:'player'|'tv'|'host', code?, name?, token?}`, `{t:'answer', i}`, `{t:'cmd', c, args}` (host only). Server→client: `{t:'joined', token,id,name}`, `{t:'state', s}`, `{t:'error', e}` (`bad_code|bad_name|full|forbidden|busy|no_song|not_enough_options`), and, for hosts only, the `host` events of Tasks 4–5 plus `{t:'sfx', name}`.
  - Host `cmd` names: `startRound{songId?,maxSteps?}, pause, resume, replay, nextStep, reveal, skip, next, setMaxSteps{n}, adjust{id,delta}, kick{id}, hostReady, stepStarted, preloadFailed{reason}`.

- [ ] **Step 1: Write the failing integration test** — `test/app.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { config as base } from '../config.js';

const fast = { ladderMs: [50, 100, 150, 200, 250], preRoundMs: 30, answerMs: 150, ackTimeoutMs: 500, preloadTimeoutMs: 1000 };

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-'));
  const songsDir = path.join(dir, 'songs'); await fs.mkdir(songsDir, { recursive: true });
  const decoys = [{ title: 'X1' }, { title: 'X2' }, { title: 'X3' }];
  const songs = ['A', 'B', 'C', 'D'].map((x, i) => ({ id: `s${i}`, title: `Song ${x}`, artist: `Art ${x}`, file: `s${i}.mp3`, distractors: decoys }));
  await fs.writeFile(path.join(dir, 'songs.json'), JSON.stringify({ songs }));
  const app = await createApp({ config: { ...base, ...fast, dataDir: dir, songsDir } });
  const port = await app.listen(0);
  return { app, port };
}

function client(port, headers = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  const open = new Promise((r) => ws.on('open', r));
  const send = (m) => ws.send(JSON.stringify(m));
  return { ws, msgs, open, send, cmd: (c, args = {}) => send({ t: 'cmd', c, args }) };
}
async function waitFor(msgs, pred, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = msgs.findLast(pred);
    if (m) return m;
    if (Date.now() > end) throw new Error('timeout waiting for message');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('a full round over WebSocket: join, play, answer, reveal, score', async () => {
  const { app, port } = await boot();
  const host = client(port); await host.open; host.send({ t: 'hello', role: 'host' });
  const phone = client(port); await phone.open;
  phone.send({ t: 'hello', role: 'player', code: app.game.code.toLowerCase(), name: 'מאי' });
  const joined = await waitFor(phone.msgs, (m) => m.t === 'joined');
  assert.equal(joined.name, 'מאי');

  host.cmd('startRound', { songId: 's0' });
  await waitFor(host.msgs, (m) => m.t === 'preload'); host.cmd('hostReady');
  await waitFor(host.msgs, (m) => m.t === 'play_step'); host.cmd('stepStarted');
  const open = await waitFor(host.msgs, (m) => m.t === 'state' && m.s.phase === 'open');
  const phoneOpen = await waitFor(phone.msgs, (m) => m.t === 'state' && m.s.phase === 'open');
  assert.equal(JSON.stringify(phoneOpen.s).includes('correctIndex'), false);   // never leaked mid-round
  phone.send({ t: 'answer', i: open.s.round.correctIndex });
  const done = await waitFor(phone.msgs, (m) => m.t === 'state' && m.s.phase === 'revealed');
  assert.equal(done.s.you.score, 100);
  assert.equal(done.s.reveal.title, 'Song A');
  await app.close();
});

test('wrong code is refused; a dropped phone resumes by token', async () => {
  const { app, port } = await boot();
  const bad = client(port); await bad.open;
  bad.send({ t: 'hello', role: 'player', code: 'ZZZZ', name: 'x' });
  assert.equal((await waitFor(bad.msgs, (m) => m.t === 'error')).e, 'bad_code');

  const p1 = client(port); await p1.open;
  p1.send({ t: 'hello', role: 'player', code: app.game.code, name: 'דנה' });
  const { token } = await waitFor(p1.msgs, (m) => m.t === 'joined');
  p1.ws.close();
  const p2 = client(port); await p2.open;
  p2.send({ t: 'hello', role: 'player', code: app.game.code, token });
  const again = await waitFor(p2.msgs, (m) => m.t === 'joined');
  assert.equal(again.name, 'דנה');
  await app.close();
});

test('a tunnelled client cannot act as host or tv; tunnelled HTTP gets 404 for private pages', async () => {
  const { app, port } = await boot();
  const spoof = { 'cf-connecting-ip': '5.5.5.5' };
  const h = client(port, spoof); await h.open;
  h.send({ t: 'hello', role: 'host' });
  assert.equal((await waitFor(h.msgs, (m) => m.t === 'error')).e, 'forbidden');

  for (const p of ['/host', '/tv', '/manage', '/songs/s0.mp3', '/api/manage/library', '/js/host.js']) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers: spoof });
    assert.equal(r.status, 404, p);
  }
  const join = await fetch(`http://127.0.0.1:${port}/api/join`, { headers: spoof });
  assert.equal(join.status, 200);
  assert.equal((await join.json()).code, app.game.code);
  await app.close();
});

test('missing song file at preload flags the song unavailable and the game continues', async () => {
  const { app, port } = await boot();
  const host = client(port); await host.open; host.send({ t: 'hello', role: 'host' });
  host.cmd('startRound', { songId: 's1' });
  await waitFor(host.msgs, (m) => m.t === 'preload');
  host.cmd('preloadFailed', { reason: '404' });
  await waitFor(host.msgs, (m) => m.t === 'state' && m.s.phase === 'idle' && m.s.notices.length === 1);
  assert.equal(app.store.get('s1').unavailable, true);
  host.cmd('startRound', { songId: 's2' });
  await waitFor(host.msgs, (m) => m.t === 'preload');
  await app.close();
});
```

- [ ] **Step 2: Run, expect failure** — cannot find `app.js`.

- [ ] **Step 3: Implement the hub** — `src/net/hub.js`

```js
import { WebSocketServer } from 'ws';
import { isLocalRequest } from './guard.js';

export function attachHub({ server, game }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
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
```

- [ ] **Step 4: Implement the app** — `src/app.js`

```js
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
```

`/songs/s0.mp3` is 404 for tunnelled requests via `requireLocal`; `/api/manage/library` is 404 today because no route exists (Task 17 mounts it behind `requireLocal`); `/js/host.js` is covered by `PRIVATE_FILES`.

- [ ] **Step 5: Run, expect pass** — `npm test`. Expected: the four app tests pass and the whole suite is green.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(net): express app, websocket hub, local-only pages"`

---

### Task 9: Front-end foundation (theme, capybara, helpers, sound effects)

**Files:**
- Create: `public/css/theme.css`, `public/img/capybara.svg`, `public/js/dom.js`, `public/js/ws.js`, `public/js/sfx.js`, `test/dom.test.js`

**Interfaces:**
- Produces:
  - `dom.js`: `el(tag, props, ...kids)`, `LocalTimer` (`update(t)`, `value() → {remainingMs,totalMs,running}|null`; constructor takes an optional `now` function), `secs(ms) → ceil seconds`
  - `ws.js`: `connect({ role, getHello, onState, onMessage, onStatus }) → { send(m), hello(), close() }`; auto-reconnects with backoff; on every (re)connect sends `{t:'hello', role, ...getHello()}` unless `getHello()` returns `null`
  - `sfx.js`: `sfx(ctx, name)` for `countdown | step | wrong | next | win | nobody | test`
  - CSS classes: `.btn .btn.alt .btn.warn .btn.sun .card .top .bar>i .opt .opt.off .opts .dots .form .err .board .tv-grid .host-grid .tag .overlay .big .muted`

- [ ] **Step 1: Failing test for the timer helper** — `test/dom.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalTimer, secs } from '../public/js/dom.js';

test('LocalTimer counts down locally from the last server value', () => {
  let t = 0;
  const lt = new LocalTimer(() => t);
  assert.equal(lt.value(), null);
  lt.update({ remainingMs: 9000, totalMs: 9000, running: true });
  t = 2500;
  assert.equal(lt.value().remainingMs, 6500);
  t = 99999;
  assert.equal(lt.value().remainingMs, 0);
});

test('a paused timer does not move; secs rounds up', () => {
  let t = 0;
  const lt = new LocalTimer(() => t);
  lt.update({ remainingMs: 6000, totalMs: 9000, running: false });
  t = 5000;
  assert.equal(lt.value().remainingMs, 6000);
  assert.equal(secs(6001), 7);
  assert.equal(secs(0), 0);
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `public/js/dom.js`

```js
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}

export const secs = (ms) => Math.ceil(ms / 1000);

export class LocalTimer {
  constructor(now = () => performance.now()) { this.now = now; this.t = null; this.at = 0; }
  update(t) { this.t = t; this.at = this.now(); }
  value() {
    if (!this.t) return null;
    const gone = this.t.running ? this.now() - this.at : 0;
    return { remainingMs: Math.max(0, this.t.remainingMs - gone), totalMs: this.t.totalMs, running: this.t.running };
  }
}
```

`public/js/ws.js`:

```js
export function connect({ role, getHello, onState, onMessage, onStatus }) {
  let ws; let closed = false; let delay = 500;
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const hello = () => { const h = getHello(); if (h) send({ t: 'hello', role, ...h }); };
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { delay = 500; onStatus?.('open'); hello(); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') onState?.(m.s); else onMessage?.(m); };
    ws.onclose = () => { onStatus?.('closed'); if (!closed) setTimeout(open, (delay = Math.min(delay * 1.6, 3000))); };
  };
  open();
  return { send, hello, close() { closed = true; ws.close(); } };
}
```

`public/js/sfx.js`:

```js
export function sfx(ctx, name) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const tone = (f, at, dur, type = 'sine', vol = 0.22) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at);
    g.gain.linearRampToValueAtTime(vol, t0 + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + at); o.stop(t0 + at + dur + 0.03);
  };
  switch (name) {
    case 'countdown': [0, 1, 2, 3].forEach((i) => tone(520, i, 0.18, 'square', 0.1)); tone(1040, 4, 0.35, 'square', 0.12); break;
    case 'step': tone(880, 0, 0.08, 'sine', 0.18); break;
    case 'wrong': tone(140, 0, 0.35, 'sawtooth', 0.2); break;
    case 'next': tone(440, 0, 0.12); tone(660, 0.12, 0.16); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.28, 'triangle', 0.25)); break;
    case 'nobody': [440, 370, 311].forEach((f, i) => tone(f, i * 0.2, 0.3, 'triangle', 0.2)); break;
    case 'test': tone(660, 0, 0.15); tone(880, 0.15, 0.2); break;
    default: break;
  }
}
```

`public/img/capybara.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" role="img" aria-label="קפיברה">
  <ellipse cx="100" cy="95" rx="78" ry="38" fill="#a9754a"/>
  <rect x="48" y="110" width="14" height="22" rx="6" fill="#8a5c38"/>
  <rect x="132" y="110" width="14" height="22" rx="6" fill="#8a5c38"/>
  <ellipse cx="150" cy="62" rx="40" ry="32" fill="#b98355"/>
  <ellipse cx="176" cy="70" rx="20" ry="17" fill="#c99a6c"/>
  <ellipse cx="190" cy="66" rx="5" ry="4" fill="#3a2518"/>
  <circle cx="155" cy="52" r="4.5" fill="#2b1a10"/><circle cx="156.5" cy="50.5" r="1.4" fill="#fff"/>
  <ellipse cx="128" cy="36" rx="7" ry="9" fill="#8a5c38"/>
  <path d="M168 80 q8 6 16 0" stroke="#3a2518" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>
```

`public/css/theme.css`:

```css
:root { --brown:#8a5c38; --cream:#fff3dc; --leaf:#4f9f55; --sun:#ffc93c; --pink:#ff6fa5; --ink:#2b1a10; --bad:#d9483b; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { font-family: "Segoe UI", "Heebo", Arial, sans-serif; background: var(--cream); color: var(--ink); -webkit-tap-highlight-color: transparent; }
a { color: inherit; }
.btn { font: inherit; border: 0; border-radius: 14px; padding: 12px 18px; background: var(--leaf); color: #fff; font-weight: 700; cursor: pointer; }
.btn.alt { background: var(--brown); } .btn.warn { background: var(--bad); } .btn.sun { background: var(--sun); color: var(--ink); }
.btn:disabled { opacity: .45; cursor: default; }
.card { background: #fff; border-radius: 22px; padding: 18px; margin: 12px; box-shadow: 0 4px 0 rgba(138,92,56,.25); text-align: center; }
.big { font-size: 64px; font-weight: 800; line-height: 1; } .muted { opacity: .65; font-size: .85em; }
.top { display: flex; justify-content: space-between; gap: 8px; padding: 10px 14px; background: var(--brown); color: #fff; font-weight: 700; flex-wrap: wrap; }
.bar { height: 14px; background: #ead8b8; border-radius: 9px; overflow: hidden; margin: 10px 0; } .bar > i { display: block; height: 100%; width: 100%; background: var(--leaf); transition: width .1s linear; }
.opts { display: grid; gap: 10px; margin: 12px; }
.opt { font: inherit; text-align: start; border: 3px solid var(--brown); background: #fff; border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 2px; min-height: 64px; cursor: pointer; color: var(--ink); }
.opt b { font-size: 1.15em; } .opt small { opacity: .65; } .opt:active { background: var(--sun); }
.opt.off, .opt:disabled { opacity: .4; }
.opt.right { background: #cdf0cf; border-color: var(--leaf); opacity: 1; }
.dots { display: flex; gap: 6px; justify-content: center; margin: 6px 0; } .dots i { width: 14px; height: 14px; border-radius: 50%; background: #ead8b8; } .dots i.on { background: var(--sun); } .dots i.cur { background: var(--leaf); }
.form { display: grid; gap: 10px; margin: 12px; } .form input { font: inherit; font-size: 20px; padding: 12px; border-radius: 12px; border: 3px solid var(--brown); text-align: center; }
.err { color: var(--bad); font-weight: 700; min-height: 1.2em; }
.board { width: 100%; border-collapse: collapse; } .board td { padding: 5px 8px; } .board tr:nth-child(odd) { background: rgba(138,92,56,.07); }
.tv-grid { display: grid; grid-template-columns: 1fr 380px; gap: 20px; height: 100vh; padding: 20px; background: linear-gradient(#fff3dc, #ffe2a8); }
.tv-grid .stage { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 16px; }
.tv-grid .huge { font-size: 14vh; font-weight: 800; } .tv-grid h1 { font-size: 7vh; margin: 0; }
.tv-grid .opts { grid-template-columns: 1fr 1fr; width: 100%; } .tv-grid .opt { font-size: 3.4vh; min-height: 11vh; cursor: default; }
.host-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; padding: 12px; } .host-grid .card { text-align: start; margin: 0; }
.row { display: flex; gap: 6px; align-items: center; padding: 4px 0; } .row .grow, .grow { flex: 1; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 10px; background: var(--sun); font-size: .8em; font-weight: 700; }
.overlay { position: fixed; inset: 0; background: rgba(43,26,16,.85); display: flex; align-items: center; justify-content: center; z-index: 10; }
@media (max-width: 800px) { .host-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): theme, capybara, dom/ws/sfx helpers"`

---

### Task 10: Phone page (`/play`)

**Files:**
- Create: `public/play.html`, `public/js/play.js`

**Interfaces:**
- Consumes: Task 8 protocol (`hello`, `joined`, `error`, `state`, `answer`), `dom.js`, `ws.js`.
- Produces: the phone UI. No exports.

- [ ] **Step 1: Create `public/play.html`**

```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>המסיבה של מאי</title>
  <link rel="stylesheet" href="/css/theme.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/play.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/js/play.js`**

```js
import { el, LocalTimer, secs } from './dom.js';
import { connect } from './ws.js';

const mem = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const ERR = { bad_code: 'הקוד לא נכון', bad_name: 'צריך להקליד כינוי', full: 'החדר מלא' };
const app = document.getElementById('app');
const q = new URLSearchParams(location.search);

let code = (q.get('c') || mem.get('may.code') || '').toUpperCase();
let name = mem.get('may.name') || '';
let token = mem.get('may.token') || '';
let joined = false; let state = null; let error = '';
const timer = new LocalTimer();

const conn = connect({
  role: 'player',
  getHello: () => (code && (token || name) ? { code, name, token } : null),
  onState(s) { state = s; timer.update(s.timer); render(); },
  onMessage(m) {
    if (m.t === 'joined') {
      token = m.token; name = m.name; joined = true; error = '';
      mem.set('may.token', token); mem.set('may.name', name); mem.set('may.code', code);
      keepAwake();
    } else if (m.t === 'error') {
      joined = false; token = ''; error = ERR[m.e] || 'משהו השתבש'; render();
    }
  },
});

async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) keepAwake(); });

function formView() {
  const codeIn = el('input', { value: code, maxlength: 4, placeholder: 'קוד', autocapitalize: 'characters', autocomplete: 'off', dir: 'ltr' });
  const nameIn = el('input', { value: name, maxlength: 16, placeholder: 'הכינוי שלך', autocomplete: 'off' });
  const go = () => {
    code = codeIn.value.trim().toUpperCase(); name = nameIn.value.trim(); token = '';
    if (!code || !name) { error = ERR.bad_name; return render(); }
    conn.hello();
  };
  return el('div', {},
    el('div', { class: 'card' }, el('img', { src: '/img/capybara.svg', width: 160, alt: '' }), el('h2', { text: 'המסיבה של מאי 🎶' }), el('p', { text: 'מזהים שיר מההתחלה!' })),
    el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); go(); } }, codeIn, nameIn,
      el('div', { class: 'err', text: error }), el('button', { class: 'btn', type: 'submit', text: 'יאללה, נכנסים!' })));
}

function timerBlock() {
  return el('div', {}, el('div', { class: 'big', 'data-secs': '' }), el('div', { class: 'bar' }, el('i', { 'data-bar': '' })));
}

function dots(s) {
  return el('div', { class: 'dots' }, Array.from({ length: s.maxSteps }, (_, i) => el('i', { class: i < s.step ? 'on' : i === s.step ? 'cur' : '' })));
}

function optionsView(s, me, right) {
  const live = s.phase === 'open' && !me.locked;
  return el('div', { class: 'opts' }, s.options.map((o, i) =>
    el('button', {
      class: `opt${right === i ? ' right' : ''}${live || right !== null ? '' : ' off'}`, disabled: !live,
      onclick: () => { conn.send({ t: 'answer', i }); navigator.vibrate?.(25); },
    }, el('b', { dir: 'auto', text: o.title }), el('small', { dir: 'auto', text: o.artist }))));
}

function gameView() {
  const s = state; const me = s.you;
  const head = el('div', { class: 'top' }, el('span', { dir: 'auto', text: me.name }), el('span', { text: `${me.score} נק׳` }), el('span', { text: `מקום ${me.rank}` }));
  let body;
  if (s.phase === 'idle') {
    body = el('div', { class: 'card' }, el('img', { src: '/img/capybara.svg', width: 140, alt: '' }), el('h3', { text: 'מחכים לשיר הבא…' }));
  } else if (s.phase === 'preloading' || s.phase === 'countdown') {
    body = el('div', { class: 'card' }, el('h3', { text: 'מתכוננים! 🎧' }), s.phase === 'countdown' ? timerBlock() : el('p', { text: 'טוענים את השיר…' }));
  } else if (s.phase === 'paused' && !s.options) {
    body = el('div', { class: 'card' }, el('h3', { text: '⏸ הפסקה קצרה' }));
  } else if (s.phase === 'revealed') {
    const r = s.reveal;
    const verdict = r.winnerId === me.id ? `🎉 ניחשת! +${r.points}` : r.winnerName ? `${r.winnerName} ניחשה (+${r.points})` : 'אף אחת לא ניחשה 🙈';
    body = el('div', {}, el('div', { class: 'card' }, r.art ? el('img', { src: r.art, width: 160, alt: '' }) : null,
      el('h2', { dir: 'auto', text: r.title }), el('div', { dir: 'auto', text: r.artist }),
      r.hook ? el('div', { class: 'muted', dir: 'auto', text: r.hook }) : null, el('h3', { text: verdict })),
      optionsView(s, me, r.correctIndex));
  } else {
    body = el('div', {}, el('div', { class: 'card' }, s.phase === 'paused' ? el('h3', { text: '⏸ הפסקה קצרה' }) : null, dots(s), timerBlock(),
      me.locked ? el('div', { class: 'err', text: 'טעית — מחכים לשלב הבא' }) : null), optionsView(s, me, null));
  }
  return el('div', {}, head, body);
}

function render() {
  app.replaceChildren(joined && state?.you ? gameView() : formView());
  tick();
}

function tick() {
  const v = timer.value();
  if (!v) return;
  const secsEl = app.querySelector('[data-secs]'); const bar = app.querySelector('[data-bar]');
  if (secsEl) secsEl.textContent = secs(v.remainingMs);
  if (bar) bar.style.width = `${v.totalMs ? (v.remainingMs / v.totalMs) * 100 : 0}%`;
}
setInterval(tick, 100);
render();
```

- [ ] **Step 3: Quick smoke check (the full walkthrough is Task 13)**

Run: `node -e "import('./src/app.js').then(async m=>{const {config}=await import('./config.js');const a=await m.createApp({config});console.log('http://localhost:'+await a.listen(0)+'/play?c='+a.game.code)})"`
Open the printed URL. Expected: Hebrew join card with the capybara; typing a nickname and pressing the button shows "מחכים לשיר הבא…" with the name and 0 points. Stop with Ctrl+C.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(ui): phone page"`

---

### Task 11: TV page (`/tv`)

**Files:**
- Create: `public/tv.html`, `public/js/tv.js`

**Interfaces:**
- Consumes: protocol `hello{role:'tv'}`, `state`, `GET /api/join`, `GET /api/join-qr.svg`.

- [ ] **Step 1: Create `public/tv.html`**

```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>המסיבה של מאי — טלוויזיה</title>
  <link rel="stylesheet" href="/css/theme.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/tv.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/js/tv.js`**

```js
import { el, LocalTimer, secs } from './dom.js';
import { connect } from './ws.js';

const app = document.getElementById('app');
let state = null; let joinInfo = { code: '', url: '' };
const timer = new LocalTimer();

async function loadJoin() {
  try { joinInfo = await (await fetch('/api/join')).json(); render(); } catch { /* retried on reconnect */ }
}
connect({
  role: 'tv', getHello: () => ({}),
  onState(s) { state = s; timer.update(s.timer); render(); },
  onStatus: (st) => { if (st === 'open') loadJoin(); },
});

const board = (s) => el('div', { class: 'card', style: 'margin:0;overflow:auto' },
  el('h2', { text: '🏆 הטבלה' }),
  el('table', { class: 'board' }, s.leaderboard.slice(0, 14).map((p) => el('tr', {},
    el('td', { text: p.rank }), el('td', { dir: 'auto', text: p.name, style: p.connected ? '' : 'opacity:.4' }), el('td', { text: p.score })))));

const dots = (s) => el('div', { class: 'dots' }, Array.from({ length: s.maxSteps }, (_, i) => el('i', { class: i < s.step ? 'on' : i === s.step ? 'cur' : '' })));

function stage(s) {
  if (s.phase === 'idle') {
    return el('div', { class: 'stage' }, el('img', { src: '/img/capybara.svg', width: 220, alt: '' }),
      el('h1', { text: 'המסיבה של מאי 🎶' }),
      el('img', { src: `/api/join-qr.svg?${s.code}`, width: 240, alt: 'QR' }),
      el('div', { class: 'huge', dir: 'ltr', text: s.code }), el('div', { dir: 'ltr', class: 'muted', text: joinInfo.url }));
  }
  if (s.phase === 'preloading') return el('div', { class: 'stage' }, el('h1', { text: 'מתכוננים… 🎧' }));
  if (s.phase === 'countdown' || (s.phase === 'paused' && !s.options)) {
    return el('div', { class: 'stage' }, el('h1', { text: s.phase === 'paused' ? '⏸ הפסקה' : 'השיר מתחיל בעוד…' }), el('div', { class: 'huge', 'data-secs': '' }));
  }
  if (s.phase === 'revealed') {
    const r = s.reveal;
    return el('div', { class: 'stage' },
      r.art ? el('img', { src: r.art, style: 'height:32vh;border-radius:20px', alt: '' }) : el('img', { src: '/img/capybara.svg', width: 200, alt: '' }),
      el('h1', { dir: 'auto', text: r.title }), el('h2', { dir: 'auto', text: r.artist }),
      r.hook ? el('div', { class: 'muted', dir: 'auto', text: r.hook }) : null,
      el('h2', { text: r.winnerName ? `🎉 ${r.winnerName} ניחשה! +${r.points}` : 'אף אחת לא ניחשה 🙈' }));
  }
  return el('div', { class: 'stage' }, dots(s),
    s.phase === 'paused' ? el('h1', { text: '⏸ הפסקה' }) : el('div', { class: 'huge', 'data-secs': '' }),
    el('div', { class: 'bar', style: 'width:80%' }, el('i', { 'data-bar': '' })),
    el('div', { class: 'opts' }, s.options.map((o) => el('div', { class: 'opt' }, el('b', { dir: 'auto', text: o.title }), el('small', { dir: 'auto', text: o.artist })))));
}

function render() {
  if (state) app.replaceChildren(el('div', { class: 'tv-grid' }, stage(state), board(state)));
  tick();
}
function tick() {
  const v = timer.value(); if (!v) return;
  const s = app.querySelector('[data-secs]'); const b = app.querySelector('[data-bar]');
  if (s) s.textContent = secs(v.remainingMs);
  if (b) b.style.width = `${v.totalMs ? (v.remainingMs / v.totalMs) * 100 : 0}%`;
}
setInterval(tick, 100);
```

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(ui): TV page"` (the visual check happens in Task 13).

---

### Task 12: Host page (`/host`) and audio engine

**Files:**
- Create: `public/js/host-audio.js`, `public/host.html`, `public/js/host.js`

**Interfaces:**
- Consumes: host `cmd` names (Task 8), host events `preload | play_step | pause | resume | full | stop | sfx | error`, snapshot `state.songs / players / notices / round`.
- Produces `class HostAudio`: `await unlock()`, `await load(url)` (fetch + decode, releases the previous buffer; throws on non-2xx), `playClip(offsetMs, lengthMs, onStarted)`, `playFull(offsetMs)`, `pause()`, `resume()`, `stop()` (stops the source), `release()` (stop + drop the buffer), property `ctx`.

- [ ] **Step 1: Create `public/js/host-audio.js`**

```js
export class HostAudio {
  constructor() { this.ctx = null; this.buffer = null; this.src = null; }

  async unlock() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.resume();
  }

  async load(url) {
    this.release();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    this.buffer = await this.ctx.decodeAudioData(await r.arrayBuffer());   // one song at a time (~40 MB of PCM)
  }

  _source() {
    this.stop();
    const src = this.ctx.createBufferSource(); src.buffer = this.buffer;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.ctx.destination);
    this.src = src;
    return { src, gain };
  }

  playClip(offsetMs, lengthMs, onStarted) {
    const { src, gain } = this._source();
    const when = this.ctx.currentTime + 0.06; const len = lengthMs / 1000;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + 0.004);
    gain.gain.setValueAtTime(1, when + Math.max(0.005, len - 0.03));
    gain.gain.linearRampToValueAtTime(0, when + len);
    src.start(when, offsetMs / 1000, len);
    setTimeout(onStarted, 60);                    // ack once the scheduled start time has arrived
  }

  playFull(offsetMs) {
    const { src, gain } = this._source();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.15);
    src.start(0, offsetMs / 1000);
  }

  pause() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  stop() { try { this.src?.stop(); } catch { /* already stopped */ } this.src = null; }
  release() { this.stop(); this.buffer = null; }
}
```

- [ ] **Step 2: Create `public/host.html`**

```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>המנחה — המסיבה של מאי</title>
  <link rel="stylesheet" href="/css/theme.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/js/host.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `public/js/host.js`**

```js
import { el, LocalTimer, secs } from './dom.js';
import { connect } from './ws.js';
import { HostAudio } from './host-audio.js';
import { sfx } from './sfx.js';

const app = document.getElementById('app');
const audio = new HostAudio();
const timer = new LocalTimer();
let state = null; let unlocked = false; let toast = ''; let joinInfo = { code: '', url: '' };

const cmd = (c, args = {}) => conn.send({ t: 'cmd', c, args });
const conn = connect({
  role: 'host', getHello: () => ({}),
  onState(s) { state = s; timer.update(s.timer); render(); },
  onMessage: handle,
  onStatus: (st) => { if (st === 'open') fetch('/api/join').then((r) => r.json()).then((j) => { joinInfo = j; render(); }).catch(() => {}); },
});

async function handle(m) {
  switch (m.t) {
    case 'preload':
      try {
        if (!unlocked) throw new Error('הסאונד לא הופעל');
        await audio.load(`/songs/${encodeURIComponent(m.song.file)}`);
        cmd('hostReady');
      } catch (e) { cmd('preloadFailed', { reason: String(e.message || e) }); }
      break;
    case 'play_step': audio.playClip(m.offsetMs, m.lengthMs, () => cmd('stepStarted')); break;
    case 'pause': audio.pause(); break;
    case 'resume': audio.resume(); break;
    case 'full': audio.playFull(m.offsetMs); break;
    case 'stop': audio.release(); break;
    case 'sfx': sfx(audio.ctx, m.name); break;
    case 'error': toast = ({ busy: 'יש סיבוב פעיל', no_song: 'אין שיר', not_enough_options: 'חסרות תשובות שגויות לשיר הזה' })[m.e] || m.e; render(); break;
    default: break;
  }
}

const btn = (text, onclick, cls = '', disabled = false) => el('button', { class: `btn ${cls}`, onclick, disabled }, text);
const PHASE = { idle: 'ממתין', preloading: 'טוען שיר', countdown: 'ספירה לאחור', awaiting_audio: 'מנגן…', open: 'שלב פעיל', paused: 'בהפסקה', revealed: 'חשיפה' };

function controls(s) {
  const inRound = s.phase !== 'idle';
  const playing = ['open', 'paused', 'awaiting_audio'].includes(s.phase);
  const last = s.notices.at(-1);
  return el('div', { class: 'card' },
    el('div', { class: 'row' }, el('b', { text: PHASE[s.phase] }), s.step != null ? el('span', { class: 'tag', text: `שלב ${s.step + 1}/${s.maxSteps}` }) : null,
      el('span', { class: 'big', style: 'font-size:34px', 'data-secs': '' })),
    s.round ? el('div', { dir: 'auto', text: `🎵 ${s.round.title} — ${s.round.artist}` }) : null,
    el('div', { class: 'row', style: 'flex-wrap:wrap' },
      s.phase === 'paused' ? btn('▶ המשך', () => cmd('resume'), 'sun') : btn('⏸ הפסק', () => cmd('pause'), 'alt', !['open', 'countdown'].includes(s.phase)),
      btn('🔁 שוב', () => cmd('replay'), 'alt', !playing), btn('➕ ארוך יותר', () => cmd('nextStep'), 'alt', !playing),
      btn('👀 חשוף', () => cmd('reveal'), 'sun', !playing), btn('⏭ דלג', () => cmd('skip'), 'warn', !inRound || s.phase === 'revealed'),
      btn('➡ הבא', () => cmd('next'), '', s.phase !== 'revealed')),
    el('div', { class: 'row' }, el('span', { text: 'ניסיונות (שלבים):' }),
      el('select', { onchange: (e) => cmd('setMaxSteps', { n: Number(e.target.value) }) },
        [1, 2, 3, 4, 5].map((n) => el('option', { value: n, selected: n === s.maxSteps, text: n }))),
      toast ? el('span', { class: 'err', text: toast }) : null),
    last ? el('div', { class: 'err', text: `⚠ השיר ${last.songId} לא נטען (${last.reason}) — הוסר מהרשימה` }) : null);
}

function songList(s) {
  const idle = s.phase === 'idle' || s.phase === 'revealed';
  return el('div', { class: 'card' }, el('div', { class: 'row' }, el('h3', { class: 'grow', text: 'שירים' }), btn('🎲 אקראי', () => { toast = ''; cmd('startRound'); }, 'sun', !idle)),
    s.songs.map((x) => el('div', { class: 'row' }, btn('▶', () => { toast = ''; cmd('startRound', { songId: x.id }); }, '', !idle),
      el('span', { class: 'grow', dir: 'auto', text: `${x.title} — ${x.artist}`, style: x.played ? 'opacity:.5' : '' }), x.played ? el('span', { class: 'tag', text: 'שוחק' }) : null)));
}

function players(s) {
  return el('div', { class: 'card' }, el('h3', { text: `שחקניות (${s.players.length})` }),
    s.players.map((p) => el('div', { class: 'row' }, el('span', { class: 'grow', dir: 'auto', text: `${p.name}${p.bot ? ' 🤖' : ''}${p.connected ? '' : ' (מנותקת)'}` }),
      el('b', { text: p.score }), btn('+10', () => cmd('adjust', { id: p.id, delta: 10 }), 'alt'), btn('−10', () => cmd('adjust', { id: p.id, delta: -10 }), 'alt'),
      btn('✖', () => { if (confirm(`להוציא את ${p.name}?`)) cmd('kick', { id: p.id }); }, 'warn'))));
}

function render() {
  if (!state) return;
  const s = state;
  app.replaceChildren(
    unlocked ? null : el('div', { class: 'overlay' }, btn('🔊 הפעלת סאונד (חובה לפני שמתחילים)', async () => { await audio.unlock(); unlocked = true; sfx(audio.ctx, 'test'); render(); }, 'sun')),
    el('div', { class: 'top' }, el('span', { text: 'מסך מנחה' }), el('span', { dir: 'ltr', text: `קוד: ${joinInfo.code || s.code}` }), el('span', { dir: 'ltr', text: joinInfo.url }),
      el('a', { href: '/tv', target: '_blank', text: 'פתח טלוויזיה' }), el('a', { href: '/manage', target: '_blank', text: 'ניהול שירים' })),
    el('div', { class: 'host-grid' }, el('div', {}, controls(s), el('div', { style: 'height:14px' }), players(s)), songList(s)));
  tick();
}
function tick() { const v = timer.value(); const e = app.querySelector('[data-secs]'); if (v && e) e.textContent = secs(v.remainingMs); }
setInterval(tick, 200);
```

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(ui): host page and Web Audio engine"`

---

### Task 13: MILESTONE — playable game with a hand-edited song list

**Files:**
- Create: `scripts/dev.js`
- Modify: `package.json` (add script `"dev": "node scripts/dev.js"`), `data/songs.json`

- [ ] **Step 1: Dev runner** — `scripts/dev.js`

```js
import { createApp } from '../src/app.js';
import { config } from '../config.js';

const app = await createApp({ config });
const port = await app.listen();
console.log(`Host   : http://localhost:${port}/host   (open in Chrome)`);
console.log(`TV     : http://localhost:${port}/tv`);
console.log(`Phones : ${app.joinUrl()}`);
console.log(`Manage PIN (for other devices): ${config.pin}`);
```

- [ ] **Step 2: Put 5 songs in place by hand**

Copy any five MP3/FLAC files from the music share into `songs/` named `t1 … t5` with their real extension (the JSON below assumes `.flac`; change it to match). Write `data/songs.json`:

```json
{ "songs": [
  { "id": "t1", "title": "תשע בכיכר", "artist": "גזוז", "file": "t1.flac", "offsetMs": 0, "distractors": [{"title":"חללית","artist":"גזוז"},{"title":"רוני","artist":"גזוז"},{"title":"לב דפוק","artist":"גזוז"}] },
  { "id": "t2", "title": "Shake It Off", "artist": "Taylor Swift", "file": "t2.flac", "offsetMs": 0 },
  { "id": "t3", "title": "Roar", "artist": "Katy Perry", "file": "t3.flac", "offsetMs": 0 },
  { "id": "t4", "title": "Flowers", "artist": "Miley Cyrus", "file": "t4.flac", "offsetMs": 0 },
  { "id": "t5", "title": "Watermelon Sugar", "artist": "Harry Styles", "file": "t5.flac", "offsetMs": 0 }
] }
```

(Songs without `distractors` borrow wrong answers from the other songs in the list.)

- [ ] **Step 3: Run the whole test suite** — `npm test`. Expected: all green.

- [ ] **Step 4: Walk through a full round in real browsers** (Chrome; use the Playwright browser tools if running unattended)

Run: `npm run dev`. Then:
1. Open `/host` → click the sound button (a two-note test beep plays).
2. Open `/tv` in a second window → capybara, QR and a 4-letter code.
3. Open the printed phone URL in two more windows (narrow viewport); join as "מאי" and "דנה".
4. In `/host` click ▶ on a song. Expected: phones show "מתכוננים", a ~5s countdown with beeps; the 1-second clip plays through the host speakers; phones show 4 options and a shrinking bar.
5. On one phone tap a wrong option: the buttons grey out with "טעית — מחכים לשלב הבא". Wait ~9s: a 2-second clip plays (step 2).
6. Tap the right option on the other phone: phones and TV show the reveal, the winner and points; the full song plays.
7. In `/host` press ⏸ during a step, wait, press ▶: the TV timer freezes and then resumes.
8. Click ➡ הבא: the music stops and the TV returns to the QR. Reload one phone mid-round: it rejoins with the same name and score.

Expected: all eight observations hold. Fix anything that doesn't before moving on.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "milestone: playable game with manual song list"`

---

## Block B — Song manager (after the milestone)

### Task 14: Text normalisation and in-memory search

**Files:**
- Create: `src/library/text.js`, `src/library/search.js`, `data/aliases.json`, `test/search.test.js`

**Interfaces:**
- Produces (`text.js`): `normalize(s) → string`, `hasHebrew(s) → boolean`, `parseRel(rel) → {artist,title,album}` (display guess from a `/`-separated relative path), `expandQuery(query, groups) → string[]`, `within1(a, b) → boolean` (edit distance ≤ 1).
- Produces (`search.js`): `buildEntries(files: string[]) → Entry[]`, `search(entries, query, { limit?, aliases? }) → Array<{ rel, score, copies, artist, title, album }>`.
- `aliases` = array of groups of equivalent spellings, e.g. `[["gazoz","גזוז"]]`.

- [ ] **Step 1: Alias data** — `data/aliases.json`

```json
[
  ["gazoz", "גזוז"],
  ["noa kirel", "נועה קירל"],
  ["svika pick", "צביקה פיק"],
  ["igal bashan", "יגאל בשן"],
  ["tikitas", "טיקיטאס"],
  ["haradkan haotomati", "הרקדן האוטומטי"]
]
```

- [ ] **Step 2: Write the failing tests** — `test/search.test.js`

```js
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
  assert.equal(normalize('ש\u05B8\u05C1לום'), 'שלום');
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
```

- [ ] **Step 3: Run, expect failure** — missing modules.

- [ ] **Step 4: Implement** — `src/library/text.js`

```js
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u0591-\u05c7]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export const hasHebrew = (s) => /[\u0590-\u05FF]/.test(String(s ?? ''));

export function parseRel(rel) {
  const parts = rel.split('/');
  const file = parts.pop();
  const folder = parts[parts.length - 1] || '';
  let name = file.replace(/\.[^.]+$/, '').trim();
  name = name.replace(/^\d+(\s*[-._)]\s*|\s+)/, '').trim();
  let artist = ''; let title = name;
  const bits = name.split(/\s+-\s+/);
  if (bits.length >= 2) { artist = bits[0].trim(); title = bits.slice(1).join(' - ').trim(); }
  else {
    const f = folder.split(/\s+-\s+/)[0].replace(/\[.*?\]/g, '').trim();
    if (f && f.length < 40) artist = f;
  }
  return { artist, title, album: folder };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function expandQuery(query, groups = []) {
  const q = normalize(query);
  const out = new Set([q]);
  for (const group of groups) {
    const g = group.map(normalize);
    for (const m of g) {
      if (!m) continue;
      const re = new RegExp(`(^| )${escapeRe(m)}( |$)`, 'u');
      if (!re.test(q)) continue;
      for (const other of g) if (other !== m) out.add(q.replace(re, (_, a, b) => `${a}${other}${b}`));
    }
  }
  return [...out];
}

export function within1(a, b) {
  if (a === b) return true;
  const d = a.length - b.length;
  if (Math.abs(d) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (d > 0) i++; else if (d < 0) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
```

`src/library/search.js`:

```js
import { normalize, parseRel, expandQuery, within1 } from './text.js';

const BAD_LATIN = /\b(remix|live|instrumental|accapella|acapella|karaoke|sped up|slowed|acoustic|demo|cover|radio edit|extended)\b/;
const BAD_HE = ['רמיקס', 'הופעה', 'פלייבק', 'אקפלה'];
const penalty = (norm) => (BAD_LATIN.test(norm) ? 40 : 0) + BAD_HE.filter((w) => norm.includes(w)).length * 40;

export function buildEntries(files) {
  return files.map((rel) => {
    const base = rel.split('/').pop().replace(/\.[^.]+$/, '');
    return { rel, norm: normalize(rel), base: normalize(base), words: null };
  });
}

function score(e, toks) {
  let s = 100;
  if (toks.every((t) => e.base.includes(t))) s += 50;
  if (e.base.replace(/^\d+ /, '') === toks.join(' ')) s += 40;
  s -= penalty(e.base) + penalty(e.norm) / 4;
  s -= e.rel.length / 50;
  return s;
}

export function search(entries, query, { limit = 30, aliases = [] } = {}) {
  const alts = expandQuery(query, aliases).filter(Boolean);
  const best = new Map();
  const seen = new Set();
  const consider = (e, toks) => {
    if (seen.has(e.rel)) return;
    seen.add(e.rel);
    const s = score(e, toks);
    const key = e.base.replace(/^\d+ /, '');
    const cur = best.get(key);
    if (!cur) best.set(key, { e, s, copies: 1 });
    else { cur.copies++; if (s > cur.s) { cur.e = e; cur.s = s; } }
  };
  for (const alt of alts) {
    const toks = alt.split(' ');
    for (const e of entries) if (toks.every((t) => e.norm.includes(t))) consider(e, toks);
  }
  if (best.size < 3) {                              // typo-tolerant second pass
    for (const alt of alts) {
      const toks = alt.split(' ');
      for (const e of entries) {
        e.words ??= e.norm.split(' ');
        if (toks.every((t) => e.norm.includes(t) || (t.length >= 4 && e.words.some((w) => within1(w, t))))) consider(e, toks);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.s - a.s).slice(0, limit)
    .map(({ e, s, copies }) => ({ rel: e.rel, score: Math.round(s), copies, ...parseRel(e.rel) }));
}
```

- [ ] **Step 5: Run, expect pass** — `npm test`. If `parseRel(FILES[5])` differs only in whitespace of `album`, adjust the test to the actual folder string (it is the folder name verbatim).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(library): normalisation and fuzzy filename search"`

---

### Task 15: NAS filename indexer and index service

**Files:**
- Create: `src/library/indexer.js`, `test/indexer.test.js`

**Interfaces:**
- Consumes: `buildEntries`, `search` (Task 14).
- Produces:
  - `AUDIO_EXT: Set<string>` (`.mp3 .flac .m4a .wav .ogg .aac .opus` — formats Chrome can decode; DSD/APE/WMA excluded)
  - `scanMusic(root, { onProgress?, concurrency? }) → Promise<string[]>` sorted, `/`-separated paths relative to `root`; skips `@eaDir`, `$RECYCLE.BIN`, `System Volume Information`, `.AppleDouble`, files starting `._`; throws if `root` is unreadable
  - `class IndexService({ root, cacheFile, aliases? })`: `await load()`, `await refresh()`, `search(q, limit?)`, `resolve(rel) → absPath|null` (null for traversal, wrong extension, non-string), `status() → { count, builtAt, building, scanned, error }`

- [ ] **Step 1: Write the failing tests** — `test/indexer.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanMusic, IndexService } from '../src/library/indexer.js';

async function tree(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'music-'));
  for (const f of files) { const p = path.join(root, f); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, 'x'); }
  return root;
}
const FILES = ['גזוז/01 - חללית.flac', 'a/b/c.mp3', 'a/notes.txt', '@eaDir/x/thumb.mp3', 'a/._c.mp3', 'd/e.dsf', 'Z.M4A'];

test('scanMusic returns audio files only, relative with forward slashes, junk skipped', async () => {
  const root = await tree(FILES);
  assert.deepEqual(await scanMusic(root), ['Z.M4A', 'a/b/c.mp3', 'גזוז/01 - חללית.flac']);
});

test('scanMusic rejects when the root is missing (NAS not mounted)', async () => {
  await assert.rejects(scanMusic(path.join(os.tmpdir(), 'definitely-not-here-xyz')));
});

test('IndexService refreshes, caches to disk, reloads, and searches', async () => {
  const root = await tree(FILES);
  const cacheFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cache-')), 'index.json');
  const a = new IndexService({ root, cacheFile });
  await a.refresh();
  assert.equal(a.status().count, 3);
  assert.equal(a.status().building, false);
  const b = new IndexService({ root, cacheFile });
  await b.load();
  assert.equal(b.status().count, 3);
  assert.equal(b.search('חללית')[0].rel, 'גזוז/01 - חללית.flac');
});

test('a failed refresh keeps the old index and reports the error', async () => {
  const root = await tree(FILES);
  const cacheFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cache-')), 'index.json');
  const svc = new IndexService({ root, cacheFile });
  await svc.refresh();
  await fs.rm(root, { recursive: true });
  await svc.refresh();
  assert.equal(svc.status().count, 3);
  assert.ok(svc.status().error);
});

test('resolve refuses traversal, absolute escapes, wrong extensions and non-strings', async () => {
  const root = await tree(FILES);
  const svc = new IndexService({ root, cacheFile: path.join(root, 'index.json') });
  assert.equal(svc.resolve('../../etc/passwd.mp3'), null);
  assert.equal(svc.resolve('a/../../x.mp3'), null);
  assert.equal(svc.resolve('a/notes.txt'), null);
  assert.equal(svc.resolve(''), null);
  assert.equal(svc.resolve(42), null);
  if (process.platform === 'win32') assert.equal(svc.resolve('C:\\Windows\\win.mp3'), null);   // drive paths only escape on Windows
  assert.equal(svc.resolve('a/b/c.mp3'), path.join(root, 'a', 'b', 'c.mp3'));
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `src/library/indexer.js`

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEntries, search } from './search.js';

export const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg', '.aac', '.opus']);
const SKIP_DIRS = new Set(['@eaDir', '$RECYCLE.BIN', 'System Volume Information', '.AppleDouble']);

export async function scanMusic(root, { onProgress = () => {}, concurrency = 8 } = {}) {
  await fs.access(root);
  const files = [];
  const queue = [''];
  let active = 0;
  await new Promise((resolve) => {
    const walk = async (rel) => {
      const dir = await fs.opendir(path.join(root, rel));
      for await (const d of dir) {
        if (d.name.startsWith('._')) continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) queue.push(r); }
        else if (AUDIO_EXT.has(path.extname(d.name).toLowerCase())) files.push(r);
      }
      onProgress(files.length);
    };
    const pump = () => {
      while (active < concurrency && queue.length) {
        const rel = queue.pop();
        active++;
        walk(rel).catch(() => {}).finally(() => { active--; pump(); });
      }
      if (!queue.length && !active) resolve();
    };
    pump();
  });
  return files.sort();
}

export class IndexService {
  constructor({ root, cacheFile, aliases = [] }) {
    this.root = root; this.cacheFile = cacheFile; this.aliases = aliases;
    this.entries = []; this.builtAt = null;
    this.state = { building: false, scanned: 0, error: null };
  }

  async load() {
    try {
      const j = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'));
      this.entries = buildEntries(j.files || []); this.builtAt = j.builtAt || null;
    } catch { /* no cache yet */ }
  }

  async refresh() {
    if (this.state.building) return;
    this.state = { building: true, scanned: 0, error: null };
    try {
      const files = await scanMusic(this.root, { onProgress: (n) => { this.state.scanned = n; } });
      this.entries = buildEntries(files);
      this.builtAt = new Date().toISOString();
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify({ builtAt: this.builtAt, files }));
    } catch (e) {
      this.state.error = String(e.message || e);                // keep the previous index
    } finally {
      this.state.building = false;
    }
  }

  search(q, limit = 30) { return search(this.entries, q, { limit, aliases: this.aliases }); }

  resolve(rel) {
    if (typeof rel !== 'string' || !rel || rel.includes('\0')) return null;
    const root = path.resolve(this.root);
    const abs = path.resolve(root, ...rel.split('/'));
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    if (!AUDIO_EXT.has(path.extname(abs).toLowerCase())) return null;
    return abs;
  }

  status() {
    return { count: this.entries.length, builtAt: this.builtAt, building: this.state.building, scanned: this.state.scanned, error: this.state.error };
  }
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Time the real share (not part of the unit tests)**

Run: `node -e "import('./src/library/indexer.js').then(async m=>{const t=Date.now();const f=await m.scanMusic('\\\\\\\\BIGBOX2\\\\music');console.log(f.length,'files',(Date.now()-t)/1000,'s')})"`
Expected: about 41,000 files; at most ~2 minutes (the earlier single-threaded scan took 105s).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(library): NAS filename indexer"`

---

### Task 16: Tag reader and ingest (copy a song into `songs/`)

**Files:**
- Create: `src/library/tags.js`, `src/library/ingest.js`, `test/ingest.test.js`

**Interfaces:**
- Consumes: `parseRel` (Task 14), `LibraryStore` (Task 6).
- Produces:
  - `readTags(abs, hint?) → Promise<{title, artist, album, picture: {data: Buffer, ext:'jpg'|'png'}|null}>` — uses `music-metadata`, falls back to `parseRel(hint)` for any missing field or on parse failure
  - `ingestFile({ abs, srcRel?, nameHint?, config, store, readTags? }) → Promise<Song>` — copies `abs` to `config.songsDir/<id><ext>`, writes cover art to `config.songsDir/art/<id>.<ext>`, adds the song to the store

- [ ] **Step 1: Write the failing tests** — `test/ingest.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readTags } from '../src/library/tags.js';
import { ingestFile } from '../src/library/ingest.js';
import { LibraryStore } from '../src/library/store.js';

async function env() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ing-'));
  const config = { songsDir: path.join(dir, 'songs') };
  const store = new LibraryStore(path.join(dir, 'songs.json')); await store.load();
  const src = path.join(dir, 'src.flac'); await fs.writeFile(src, 'not really audio');
  return { dir, config, store, src };
}

test('readTags falls back to the file/folder name when the file cannot be parsed', async () => {
  const t = await readTags('/does/not/exist.mp3', 'CD_RIPs/Gazoz - The 20 Hits/01 - Gazoz - Nine O\'Clock.flac');
  assert.equal(t.artist, 'Gazoz'); assert.equal(t.title, "Nine O'Clock"); assert.equal(t.picture, null);
});

test('ingest copies the file, stores the entry and writes cover art', async () => {
  const { config, store, src } = await env();
  const fake = async () => ({ title: 'חללית', artist: 'גזוז', album: '20 הלהיטים', picture: { data: Buffer.from([1, 2, 3]), ext: 'jpg' } });
  const song = await ingestFile({ abs: src, srcRel: 'a/b.flac', config, store, readTags: fake });
  assert.match(song.file, /^s_[0-9a-f]{8}\.flac$/);
  assert.equal(await fs.readFile(path.join(config.songsDir, song.file), 'utf8'), 'not really audio');
  assert.equal(song.art, 'jpg');
  assert.deepEqual([...await fs.readFile(path.join(config.songsDir, 'art', `${song.id}.jpg`))], [1, 2, 3]);
  assert.equal(song.srcRel, 'a/b.flac');
  assert.equal(store.get(song.id).title, 'חללית');
  assert.equal(song.lang, 'he');
});

test('ingest without art leaves art null', async () => {
  const { config, store, src } = await env();
  const song = await ingestFile({ abs: src, srcRel: 'x.flac', config, store, readTags: async () => ({ title: 'T', artist: 'A', album: '', picture: null }) });
  assert.equal(song.art, null);
});
```

- [ ] **Step 2: Run, expect failure** — missing modules.

- [ ] **Step 3: Implement** — `src/library/tags.js`

```js
import { parseFile } from 'music-metadata';
import { parseRel } from './text.js';

export async function readTags(abs, hint) {
  const guess = parseRel(hint || abs.split(/[\\/]/).slice(-3).join('/'));
  try {
    const m = await parseFile(abs, { duration: false });
    const pic = m.common.picture?.[0];
    return {
      title: m.common.title?.trim() || guess.title,
      artist: m.common.artist?.trim() || guess.artist,
      album: m.common.album?.trim() || guess.album,
      picture: pic ? { data: Buffer.from(pic.data), ext: /png/i.test(pic.format) ? 'png' : 'jpg' } : null,
    };
  } catch {
    return { ...guess, picture: null };
  }
}
```

`src/library/ingest.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readTags as defaultReadTags } from './tags.js';

export async function ingestFile({ abs, srcRel = '', nameHint, config, store, readTags = defaultReadTags }) {
  const ext = path.extname(abs).toLowerCase();
  const tags = await readTags(abs, srcRel || nameHint);
  const id = `s_${randomBytes(4).toString('hex')}`;
  const file = `${id}${ext}`;
  await fs.mkdir(path.join(config.songsDir, 'art'), { recursive: true });
  await fs.copyFile(abs, path.join(config.songsDir, file));
  let art = null;
  if (tags.picture) {
    await fs.writeFile(path.join(config.songsDir, 'art', `${id}.${tags.picture.ext}`), tags.picture.data);
    art = tags.picture.ext;
  }
  return store.add({ id, title: tags.title, artist: tags.artist, album: tags.album, file, srcRel, art });
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(library): tag reader and ingest"`

---

### Task 17: Manage API (search, add, preview, upload, edit) mounted behind the guards

**Files:**
- Create: `src/net/manage-routes.js`, `test/manage.test.js`
- Modify: `src/net/guard.js` (accept `?pin=` for `<audio>` previews), `src/app.js` (mount the router, create the `IndexService`, create `dataDir`), `test/guard.test.js` (one more assertion)

**Interfaces:**
- Consumes: `IndexService`, `ingestFile`, `readTags`, `LibraryStore`, `requireLocal`, `requirePin`.
- Produces `manageRouter({ config, store, index }) → express.Router` mounted at `/api/manage` with:
  - `GET /library → {songs, index: status}`
  - `GET /search?q= → {results: [{rel,score,copies,artist,title,album,added}]}`
  - `POST /index/refresh → 202 status`, `GET /index/status → status`
  - `GET /preview?rel= ` streams the NAS file (Range supported); `400` for anything `index.resolve` refuses
  - `POST /add {rel} → 201 song` (returns the existing song if `srcRel` is already in the library)
  - `POST /upload?name=<file>` raw body → `201 song`; `400` unless the extension is in `AUDIO_EXT`
  - `PATCH /song/:id` (whitelisted fields, see Task 6) → song | 404
  - `DELETE /song/:id` → `{ok:true}` (also deletes the copied file and cover art)
  - `POST /reorder {ids}` → `{ok:true}`
- `createApp(...)` now also returns `index`.

- [ ] **Step 1: Guard accepts `?pin=`** — in `src/net/guard.js` change the comparison line to read the PIN from the header or the query string:

```js
    const given = req.headers['x-pin'] ?? req.query?.pin ?? '';
    if (timingSafeEqual(digest(given), digest(config.pin))) return next();
```

and add to the PIN test in `test/guard.test.js`, right after the `ok === 2` assertion:

```js
  mw(Object.assign(req('192.168.1.7'), { query: { pin: '4321' } }), res(), next);
  assert.equal(ok, 3);
```
then change the final `assert.equal(ok, 2);` of that test to `assert.equal(ok, 3);`.

- [ ] **Step 2: Write the failing API tests** — `test/manage.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { config as base } from '../config.js';

async function boot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'man-'));
  const music = path.join(dir, 'music');
  for (const f of ['Gazoz/01 - Gazoz - Nine.mp3', 'Gazoz/02 - Gazoz - Spaceship.mp3', 'Pop/Taylor Swift - Shake It Off.flac', 'Pop/Katy Perry - Roar.flac']) {
    const p = path.join(music, f); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, 'audio-bytes');
  }
  const config = { ...base, musicDir: music, dataDir: path.join(dir, 'data'), songsDir: path.join(dir, 'songs') };
  const app = await createApp({ config });
  await app.index.refresh();
  const port = await app.listen(0);
  const call = (p, opts = {}) => fetch(`http://127.0.0.1:${port}/api/manage${p}`, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  return { app, port, call, config };
}

test('search, add (copies the file), edit, reorder and delete', async () => {
  const { app, call, config } = await boot();
  const found = (await (await call('/search?q=gazoz+nine')).json()).results;
  assert.equal(found.length, 1);
  assert.equal(found[0].added, false);

  const add = await call('/add', { method: 'POST', body: JSON.stringify({ rel: found[0].rel }) });
  assert.equal(add.status, 201);
  const song = await add.json();
  assert.equal(song.title, 'Nine'); assert.equal(song.artist, 'Gazoz');
  assert.equal(await fs.readFile(path.join(config.songsDir, song.file), 'utf8'), 'audio-bytes');

  const again = await (await call('/add', { method: 'POST', body: JSON.stringify({ rel: found[0].rel }) })).json();
  assert.equal(again.id, song.id);                                              // not duplicated
  assert.equal(app.store.list().length, 1);
  assert.equal((await (await call('/search?q=gazoz+nine')).json()).results[0].added, true);

  const patched = await (await call(`/song/${song.id}`, { method: 'PATCH', body: JSON.stringify({ hook: 'לה לה', offsetMs: 1500, file: 'evil' }) })).json();
  assert.equal(patched.hook, 'לה לה'); assert.equal(patched.offsetMs, 1500); assert.equal(patched.file, song.file);
  assert.equal((await call('/song/nope', { method: 'PATCH', body: '{}' })).status, 404);

  const second = await (await call('/add', { method: 'POST', body: JSON.stringify({ rel: 'Pop/Katy Perry - Roar.flac' }) })).json();
  await call('/reorder', { method: 'POST', body: JSON.stringify({ ids: [second.id, song.id] }) });
  assert.deepEqual((await (await call('/library')).json()).songs.map((s) => s.title), ['Roar', 'Nine']);

  assert.equal((await call(`/song/${song.id}`, { method: 'DELETE' })).status, 200);
  await assert.rejects(fs.access(path.join(config.songsDir, song.file)));
  await app.close();
});

test('paths outside the music root and non-audio files are refused everywhere', async () => {
  const { app, call } = await boot();
  const bads = ['../outside.mp3', 'Pop/../../x.mp3', 'notes.txt', '', null, 5];
  if (process.platform === 'win32') bads.push('C:\\Windows\\a.mp3');
  for (const rel of bads) {
    const r = await call('/add', { method: 'POST', body: JSON.stringify({ rel }) });
    assert.equal(r.status, 400, String(rel));
  }
  assert.equal((await call(`/preview?rel=${encodeURIComponent('../../etc/passwd.mp3')}`)).status, 400);
  assert.equal((await call(`/preview?rel=${encodeURIComponent('Pop/missing.mp3')}`)).status, 404);
  assert.equal((await call('/add', { method: 'POST', body: JSON.stringify({ rel: 'Pop/ghost.mp3' }) })).status, 404);
  assert.equal(app.store.list().length, 0);
  await app.close();
});

test('preview streams a real NAS file; upload accepts audio only', async () => {
  const { app, call, config } = await boot();
  const prev = await call(`/preview?rel=${encodeURIComponent('Pop/Katy Perry - Roar.flac')}`);
  assert.equal(prev.status, 200);
  assert.equal(await prev.text(), 'audio-bytes');

  const bad = await call('/upload?name=evil.exe', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'MZ' });
  assert.equal(bad.status, 400);
  const traversal = await call('/upload?name=' + encodeURIComponent('../../x.mp3'), { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'abc' });
  assert.equal(traversal.status, 201);                                          // name is reduced to its basename, stored under songs/
  const up = await traversal.json();
  assert.ok((await fs.readdir(config.songsDir)).includes(up.file));
  assert.equal((await fs.readdir(config.songsDir)).some((n) => n.startsWith('.upload-')), false);
  await app.close();
});

test('tunnelled requests cannot reach the manage API', async () => {
  const { app, port } = await boot();
  const r = await fetch(`http://127.0.0.1:${port}/api/manage/library`, { headers: { 'cf-connecting-ip': '9.9.9.9' } });
  assert.equal(r.status, 404);
  await app.close();
});
```

- [ ] **Step 3: Run, expect failure** — `app.index` undefined / router missing.

- [ ] **Step 4: Implement the router** — `src/net/manage-routes.js`

```js
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { ingestFile } from '../library/ingest.js';
import { AUDIO_EXT } from '../library/indexer.js';

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
    res.status(201).json(await ingestFile({ abs, srcRel: rel, config, store }));
  }));

  r.post('/upload', express.raw({ type: '*/*', limit: '200mb' }), wrap(async (req, res) => {
    const name = path.basename(String(req.query.name ?? ''));
    const ext = path.extname(name).toLowerCase();
    if (!AUDIO_EXT.has(ext) || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res);
    await fs.mkdir(config.songsDir, { recursive: true });
    const tmp = path.join(config.songsDir, `.upload-${randomBytes(4).toString('hex')}${ext}`);
    await fs.writeFile(tmp, req.body);
    try { res.status(201).json(await ingestFile({ abs: tmp, nameHint: name, config, store })); }
    finally { await fs.rm(tmp, { force: true }); }
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

  return r;
}
```

- [ ] **Step 5: Wire it into `src/app.js`**

Add imports at the top:

```js
import { IndexService } from './library/indexer.js';
import { manageRouter } from './net/manage-routes.js';
import { requirePin } from './net/guard.js';
```
(merge `requirePin` into the existing `import { isLocalRequest, requireLocal } from './net/guard.js';` line instead of a second import.)

Directly after `await fsp.mkdir(path.join(config.songsDir, 'art'), { recursive: true });` add:

```js
  await fsp.mkdir(config.dataDir, { recursive: true });
```

After `await store.load();` add:

```js
  let aliases = [];
  try { aliases = JSON.parse(await fsp.readFile(path.join(config.rootDir, 'data', 'aliases.json'), 'utf8')); } catch { /* optional */ }
  const index = new IndexService({ root: config.musicDir, cacheFile: path.join(config.dataDir, 'index.json'), aliases });
  await index.load();
```

After the `app.get('/api/join-qr.svg', ...)` route add:

```js
  app.use('/api/manage', requireLocal, requirePin(config), manageRouter({ config, store, index }));
```

and add `index` to the returned object (`app, server, game, store, index, hub, config, timers,`).

- [ ] **Step 6: Run, expect pass** — `npm test`. Expected: manage tests pass; earlier app test (`/api/manage/library` → 404 when tunnelled) still passes.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(library): manage API with path-safe add/preview/upload"`

---

### Task 18: Song manager page (`/manage`)

**Files:**
- Create: `public/manage.html`, `public/js/manage.js`

**Interfaces:**
- Consumes: Task 17 endpoints; `/songs/<file>` for playback of already-copied songs; `dom.js`.
- Produces: the manager UI (no exports). Later tasks add: "suggest answers" (Task 19), Spotify import (Task 22), BPM calculation (Task 23) by extending `manage.js` where marked.

- [ ] **Step 1: Create `public/manage.html`**

```html
<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ניהול שירים — המסיבה של מאי</title>
  <link rel="stylesheet" href="/css/theme.css">
  <style>
    .wrap { max-width: 980px; margin: 0 auto; padding: 12px; }
    .wrap .card { text-align: start; margin: 12px 0; }
    .res { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid #eee; }
    .song { display: grid; grid-template-columns: auto 1fr 1fr 90px; gap: 6px; padding: 10px 0; border-bottom: 2px solid #eee; align-items: center; }
    .song input[type=text], .song input[type=number] { font: inherit; padding: 6px; border: 2px solid #d9c3a0; border-radius: 8px; width: 100%; }
    .song .full { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .drop { border: 3px dashed var(--brown); border-radius: 18px; padding: 18px; text-align: center; }
    .drop.over { background: var(--sun); }
  </style>
</head>
<body>
  <div id="app"></div>
  <audio id="player" preload="none"></audio>
  <script type="module" src="/js/manage.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/js/manage.js`**

```js
import { el } from './dom.js';

const app = document.getElementById('app');
const player = document.getElementById('player');
let pin = '';
try { pin = sessionStorage.getItem('may.pin') || ''; } catch { /* no storage */ }
let songs = []; let indexStatus = {}; let busyMsg = '';

async function api(path, { method = 'GET', body, raw, retried } = {}) {
  const headers = { 'x-pin': pin };
  if (body !== undefined && raw === undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`/api/manage${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (r.status === 401 && !retried) {
    pin = prompt('קוד ה-PIN של המנהל (מוצג במסוף של השרת):') || '';
    try { sessionStorage.setItem('may.pin', pin); } catch { /* ignore */ }
    return api(path, { method, body, raw, retried: true });
  }
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
const previewUrl = (rel) => `/api/manage/preview?rel=${encodeURIComponent(rel)}&pin=${encodeURIComponent(pin)}`;

// ---- skeleton (built once, so typing in the search box is never interrupted) ----
const idxLabel = el('span');
const searchBox = el('input', { placeholder: 'חיפוש שיר או אמן בעברית או באנגלית…', style: 'flex:1;font-size:20px;padding:10px;border-radius:12px;border:3px solid var(--brown)' });
const resultsBox = el('div');
const libraryBox = el('div');
const extraBox = el('div');                                // Task 22 mounts the Spotify panel here
const dropBox = el('div', { class: 'drop', text: 'גררו לכאן קובץ שיר (mp3 / flac / m4a…) אם הוא לא ב-BIGBOX' });

app.append(
  el('div', { class: 'top' }, el('b', { text: 'ניהול שירים' }), idxLabel,
    el('button', { class: 'btn sun', onclick: refreshIndex, text: 'רענון אינדקס' }), el('a', { href: '/host', text: 'למסך המנחה' })),
  el('div', { class: 'wrap' },
    el('div', { class: 'card' }, el('h3', { text: '🔎 חיפוש ב-BIGBOX' }), el('div', { class: 'row' }, searchBox), resultsBox),
    extraBox, el('div', { class: 'card' }, dropBox),
    el('div', { class: 'card' }, el('h3', { id: 'libTitle' }), libraryBox)));

// ---- search ----
let timer = null;
searchBox.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 250); });

async function doSearch() {
  const q = searchBox.value.trim();
  if (!q) return resultsBox.replaceChildren();
  try {
    const { results } = await api(`/search?q=${encodeURIComponent(q)}`);
    resultsBox.replaceChildren(results.length ? results.map(resultRow) : el('p', { class: 'muted', text: 'לא נמצא. אפשר לרענן את האינדקס או לגרור קובץ.' }));
  } catch (e) { resultsBox.replaceChildren(el('p', { class: 'err', text: `שגיאה: ${e.message}` })); }
}

function resultRow(x) {
  const add = el('button', { class: 'btn', disabled: x.added, text: x.added ? '✔ ברשימה' : '➕ הוסף' });
  add.addEventListener('click', async () => {
    add.disabled = true; add.textContent = 'מעתיק…';
    try { const song = await api('/add', { method: 'POST', body: { rel: x.rel } }); await afterAdd(song); await load(); await doSearch(); }
    catch (e) { add.textContent = `שגיאה ${e.message}`; }
  });
  return el('div', { class: 'res' },
    el('button', { class: 'btn alt', onclick: () => { player.src = previewUrl(x.rel); player.play(); }, text: '▶' }),
    el('div', { class: 'grow' }, el('b', { dir: 'auto', text: `${x.artist || '?'} — ${x.title}` }), el('div', { class: 'muted', dir: 'auto', text: x.album }),
      x.copies > 1 ? el('span', { class: 'tag', text: `+${x.copies - 1} עותקים` }) : null), add);
}

async function afterAdd() { /* Task 23 computes BPM here */ }

// ---- library ----
async function load() {
  const j = await api('/library');
  songs = j.songs; indexStatus = j.index;
  idxLabel.textContent = `אינדקס: ${indexStatus.count.toLocaleString('he-IL')} קבצים${indexStatus.building ? ' (נסרק…)' : ''}${indexStatus.error ? ' ⚠ ' + indexStatus.error : ''}`;
  document.getElementById('libTitle').textContent = `🎵 השירים במשחק (${songs.filter((s) => s.enabled && !s.unavailable).length}/${songs.length})`;
  renderLibrary();
}

async function save(song, patch) {
  Object.assign(song, await api(`/song/${song.id}`, { method: 'PATCH', body: patch }));
}

function songRow(s, i) {
  const field = (key, type = 'text', props = {}) => {
    const input = el('input', { type, value: s[key] ?? '', ...props });
    input.addEventListener('change', () => save(s, { [key]: type === 'number' ? Number(input.value) : input.value }).catch(() => {}));
    return input;
  };
  const offset = el('input', { type: 'number', step: '0.1', min: '0', value: (s.offsetMs / 1000).toString(), title: 'התחלה בשניות' });
  offset.addEventListener('change', () => save(s, { offsetMs: Math.round(Number(offset.value) * 1000) }).catch(() => {}));
  const test = el('button', { class: 'btn alt', text: '▶ 1ש׳', onclick: () => {
    player.src = `/songs/${encodeURIComponent(s.file)}`;
    player.currentTime = 0;
    player.addEventListener('loadedmetadata', () => { player.currentTime = s.offsetMs / 1000; player.play(); setTimeout(() => player.pause(), 1000); }, { once: true });
    player.load();
  } });
  const enabled = el('input', { type: 'checkbox', checked: s.enabled });
  enabled.addEventListener('change', () => save(s, { enabled: enabled.checked }).then(load).catch(() => {}));
  const dis = [0, 1, 2].map((k) => {
    const input = el('input', { type: 'text', placeholder: `תשובה שגויה ${k + 1}`, value: s.distractors[k]?.title ?? '', dir: 'auto' });
    input.addEventListener('change', () => {
      const list = [0, 1, 2].map((j) => ({ title: dis[j].value.trim(), artist: s.distractors[j]?.artist ?? '' }));
      save(s, { distractors: list }).catch(() => {});
    });
    return input;
  });
  const move = (d) => async () => {
    const ids = songs.map((x) => x.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('/reorder', { method: 'POST', body: { ids } }); await load();
  };
  return el('div', { class: 'song', style: s.unavailable ? 'background:#ffe3e0' : '' },
    enabled, el('div', {}, field('title', 'text', { dir: 'auto' }), s.unavailable ? el('div', { class: 'err', text: '⚠ הקובץ לא נטען — הוסר מהמשחק' }) : null),
    field('artist', 'text', { dir: 'auto' }),
    el('div', { class: 'row' }, el('button', { class: 'btn alt', onclick: move(-1), text: '↑' }), el('button', { class: 'btn alt', onclick: move(1), text: '↓' }),
      el('button', { class: 'btn warn', text: '🗑', onclick: async () => { if (confirm(`למחוק את "${s.title}"?`)) { await api(`/song/${s.id}`, { method: 'DELETE' }); await load(); } } })),
    el('div', { class: 'full' }, field('hook', 'text', { placeholder: 'שורת מילים קטנה (אופציונלי)', dir: 'auto' }),
      el('div', { class: 'row' }, el('span', { text: 'התחלה (ש׳)' }), offset, test),
      el('div', { class: 'muted', text: s.bpm ? `${s.bpm} BPM` : 'BPM לא חושב' })),
    el('div', { class: 'full' }, dis));
}

function renderLibrary() {
  libraryBox.replaceChildren(songs.length ? songs.map(songRow) : el('p', { class: 'muted', text: 'עוד אין שירים. חפשו למעלה והוסיפו.' }));
}

// ---- index refresh ----
async function refreshIndex() {
  await api('/index/refresh', { method: 'POST' });
  const poll = setInterval(async () => {
    const st = await api('/index/status');
    idxLabel.textContent = `סורק… ${st.scanned.toLocaleString('he-IL')} קבצים`;
    if (!st.building) { clearInterval(poll); await load(); }
  }, 1500);
}

// ---- drag & drop upload ----
dropBox.addEventListener('dragover', (e) => { e.preventDefault(); dropBox.classList.add('over'); });
dropBox.addEventListener('dragleave', () => dropBox.classList.remove('over'));
dropBox.addEventListener('drop', async (e) => {
  e.preventDefault(); dropBox.classList.remove('over');
  for (const f of e.dataTransfer.files) {
    dropBox.textContent = `מעלה ${f.name}…`;
    try { const song = await api(`/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f }); await afterAdd(song); }
    catch (err) { dropBox.textContent = `שגיאה בהעלאת ${f.name}: ${err.message}`; return; }
  }
  dropBox.textContent = 'נוסף! אפשר לגרור עוד קובץ.'; await load();
});

load().catch((e) => { libraryBox.replaceChildren(el('p', { class: 'err', text: `לא ניתן לטעון: ${e.message}` })); });
```

Note the `/api/manage/upload` call in `api()` sends `raw` bodies without a JSON content-type, matching the server's `express.raw({ type: '*/*' })`.

- [ ] **Step 3: Manual check**

Run: `npm run dev`, open `http://localhost:3000/manage`. Expected: header shows the index count (0 until you press **רענון אינדקס**; it takes ~1–2 min on the real share, then shows ~41k). Search "shake it off" → results with a ▶ preview that plays through the page's `<audio>`; **➕ הוסף** copies it and it appears in the library list; edit the hook/offset, press **▶ 1ש׳** to hear the first second, reorder with ↑↓. Open `http://<mac-or-pc-lan-ip>:3000/manage` from a phone: a PIN prompt appears (PIN printed by the server).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(ui): song manager page"`

---

### Task 19: Smart wrong answers (same language, similar BPM) and suggestions API

**Files:**
- Create: `src/library/distractors.js`, `src/library/pool.js`, `data/decoys.json`, `test/distractors.test.js`
- Modify: `src/net/manage-routes.js` (add `GET /song/:id/suggest`, `POST /suggest-all`), `public/js/manage.js` (a "הצע תשובות" button)

**Interfaces:**
- Produces:
  - `suggestDistractors(song, pool, { rng?, count? }) → {title, artist}[]` — excludes the song's own title, de-duplicates titles, prefers the same language (+50), then closer BPM when both are known (up to +30), plus random jitter (≤ +20)
  - `loadPool(config, store) → Promise<Array<{title, artist, lang, bpm?}>>` — library songs + `data/decoys.json` + `<dataDir>/playlist.json` (written by Task 22; optional)
  - `GET /api/manage/song/:id/suggest → {distractors}`; `POST /api/manage/suggest-all → {updated: n}` (fills missing slots, never overwrites existing answers)

- [ ] **Step 1: Write the failing tests** — `test/distractors.test.js`

```js
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

test('small pools return what exists', () => {
  assert.equal(suggestDistractors(song, [{ title: 'Roar', artist: 'K', lang: 'en' }]).length, 1);
  assert.deepEqual(suggestDistractors(song, []), []);
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `src/library/distractors.js`

```js
import { normalize, hasHebrew } from './text.js';

const langOf = (x) => x.lang || (hasHebrew(x.title) ? 'he' : 'en');

export function suggestDistractors(song, pool, { rng = Math.random, count = 3 } = {}) {
  const seen = new Set([normalize(song.title)]);
  const myLang = langOf(song);
  const scored = [];
  for (const c of pool) {
    const k = normalize(c.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    let s = langOf(c) === myLang ? 50 : 0;
    if (Number.isFinite(song.bpm) && Number.isFinite(c.bpm)) s += 30 - Math.min(30, Math.abs(song.bpm - c.bpm));
    s += rng() * 20;
    scored.push({ s, c });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, count).map(({ c }) => ({ title: c.title, artist: c.artist || '' }));
}
```

`src/library/pool.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

export async function loadPool(config, store) {
  const decoys = await readJson(path.join(config.rootDir, 'data', 'decoys.json'), []);
  const playlist = await readJson(path.join(config.dataDir, 'playlist.json'), []);
  const lib = store.list().map((s) => ({ title: s.title, artist: s.artist, lang: s.lang, bpm: s.bpm ?? undefined }));
  return [...lib, ...playlist, ...decoys];
}
```

`data/decoys.json` (well-known songs the girls are likely to recognise; used only as wrong answers):

```json
[
  {"title":"Levitating","artist":"Dua Lipa","lang":"en"},
  {"title":"Cold Heart","artist":"Elton John, Dua Lipa","lang":"en"},
  {"title":"About Damn Time","artist":"Lizzo","lang":"en"},
  {"title":"Beggin'","artist":"Måneskin","lang":"en"},
  {"title":"A Sky Full of Stars","artist":"Coldplay","lang":"en"},
  {"title":"Calm Down","artist":"Rema, Selena Gomez","lang":"en"},
  {"title":"I'm Good (Blue)","artist":"David Guetta, Bebe Rexha","lang":"en"},
  {"title":"On The Floor","artist":"Jennifer Lopez","lang":"en"},
  {"title":"Blue (Da Ba Dee)","artist":"Eiffel 65","lang":"en"},
  {"title":"Can't Stop the Feeling!","artist":"Justin Timberlake","lang":"en"},
  {"title":"As It Was","artist":"Harry Styles","lang":"en"},
  {"title":"Wrecking Ball","artist":"Miley Cyrus","lang":"en"},
  {"title":"We Found Love","artist":"Rihanna","lang":"en"},
  {"title":"I Gotta Feeling","artist":"Black Eyed Peas","lang":"en"},
  {"title":"Shallow","artist":"Lady Gaga","lang":"en"},
  {"title":"Blinding Lights","artist":"The Weeknd","lang":"en"},
  {"title":"Uptown Funk","artist":"Mark Ronson","lang":"en"},
  {"title":"Cake By The Ocean","artist":"DNCE","lang":"en"},
  {"title":"Perfect","artist":"Ed Sheeran","lang":"en"},
  {"title":"Señorita","artist":"Shawn Mendes, Camila Cabello","lang":"en"},
  {"title":"Party Rock Anthem","artist":"LMFAO","lang":"en"},
  {"title":"Shape of You","artist":"Ed Sheeran","lang":"en"},
  {"title":"Fight Song","artist":"Rachel Platten","lang":"en"},
  {"title":"Single Ladies","artist":"Beyoncé","lang":"en"},
  {"title":"Born This Way","artist":"Lady Gaga","lang":"en"},
  {"title":"Beat It","artist":"Michael Jackson","lang":"en"},
  {"title":"Thunder","artist":"Imagine Dragons","lang":"en"},
  {"title":"Firework","artist":"Katy Perry","lang":"en"},
  {"title":"Just Dance","artist":"Lady Gaga","lang":"en"},
  {"title":"TiK ToK","artist":"Kesha","lang":"en"},
  {"title":"Blank Space","artist":"Taylor Swift","lang":"en"},
  {"title":"Bad Romance","artist":"Lady Gaga","lang":"en"},
  {"title":"Waka Waka","artist":"Shakira","lang":"en"},
  {"title":"Love Again","artist":"Dua Lipa","lang":"en"},
  {"title":"Don't Start Now","artist":"Dua Lipa","lang":"en"},
  {"title":"Hips Don't Lie","artist":"Shakira","lang":"en"},
  {"title":"Roar","artist":"Katy Perry","lang":"en"},
  {"title":"Shake It Off","artist":"Taylor Swift","lang":"en"},
  {"title":"Flowers","artist":"Miley Cyrus","lang":"en"},
  {"title":"Watermelon Sugar","artist":"Harry Styles","lang":"en"},
  {"title":"Unicorn","artist":"Noa Kirel","lang":"he"},
  {"title":"פנתרה","artist":"נועה קירל","lang":"he"},
  {"title":"פעמון","artist":"נועה קירל","lang":"he"},
  {"title":"הרקדן האוטומטי","artist":"צביקה פיק","lang":"he"},
  {"title":"יש לי ציפור קטנה בלב","artist":"יגאל בשן","lang":"he"},
  {"title":"מיליון דולר","artist":"נועה קירל","lang":"he"},
  {"title":"אמבולנס","artist":"נועה קירל","lang":"he"},
  {"title":"אם אתה גבר","artist":"נועה קירל","lang":"he"},
  {"title":"טיקיטאס","artist":"נועה קירל","lang":"he"},
  {"title":"מי זאת","artist":"אנה זק","lang":"he"},
  {"title":"חללית","artist":"גזוז","lang":"he"},
  {"title":"תשע בכיכר","artist":"גזוז","lang":"he"},
  {"title":"רוני","artist":"גזוז","lang":"he"},
  {"title":"לב דפוק","artist":"גזוז","lang":"he"},
  {"title":"ציפי פרימו","artist":"גזוז","lang":"he"},
  {"title":"אמא ודני","artist":"גזוז","lang":"he"},
  {"title":"כחול ים תיכון","artist":"גזוז","lang":"he"},
  {"title":"אה או","artist":"גזוז","lang":"he"}
]
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Add the API** — in `src/net/manage-routes.js` add the imports

```js
import { suggestDistractors } from '../library/distractors.js';
import { loadPool } from '../library/pool.js';
```

and, before `return r;`, these routes:

```js
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
```

Add a test to `test/manage.test.js`:

```js
test('suggest returns three wrong answers that are not the song itself; suggest-all fills gaps only', async () => {
  const { app, call } = await boot();
  const a = await app.store.add({ title: 'Roar', artist: 'Katy Perry', file: 'x.mp3', distractors: [{ title: 'Keep Me', artist: '' }] });
  await app.store.add({ title: 'Shake It Off', artist: 'Taylor Swift', file: 'y.mp3' });
  const s = await (await call(`/song/${a.id}/suggest`)).json();
  assert.equal(s.distractors.length, 3);
  assert.ok(s.distractors.every((d) => d.title !== 'Roar'));
  const r = await (await call('/suggest-all', { method: 'POST', body: '{}' })).json();
  assert.equal(r.updated, 2);
  const lib = (await (await call('/library')).json()).songs;
  assert.equal(lib[0].distractors[0].title, 'Keep Me');
  assert.ok(lib.every((x) => x.distractors.length === 3));
  await app.close();
});
```

- [ ] **Step 6: Manager button** — in `public/js/manage.js`, inside `songRow`, add to the `dis` row a button, replacing the last element of the returned tree `el('div', { class: 'full' }, dis)` with:

```js
    el('div', { class: 'full' }, dis),
    el('div', { class: 'full' }, el('button', { class: 'btn alt', text: '✨ הצע תשובות שגויות', onclick: async () => {
      const { distractors } = await api(`/song/${s.id}/suggest`);
      await save(s, { distractors }); renderLibrary();
    } }))
```
and add next to the drop box (in the skeleton `app.append(...)` card list) a global button:

```js
el('div', { class: 'card' }, el('button', { class: 'btn sun', text: '✨ השלם תשובות שגויות לכל השירים', onclick: async () => { await api('/suggest-all', { method: 'POST', body: {} }); await load(); } }))
```
(place it just before the library card).

- [ ] **Step 7: Run all tests; commit** — `npm test` then `git add -A && git commit -m "feat(library): smart wrong answers and suggestions API"`


---

## Block C — Rehearsal tools, launch, imports

### Task 20: Practice bots and a 14-phone load test

**Files:**
- Create: `src/game/bots.js`, `test/bots.test.js`, `test/load.test.js`
- Modify: `src/app.js` (create `BotRunner`, wire `hub.extra`, return `bots`), `public/js/host.js` (bot buttons)

**Interfaces:**
- Consumes: `Game` events `step_open`, `game.join/kick/answer/round/phase`.
- Produces `class BotRunner(game, { timers?, rng? })`: `spawn(n)` (adds `n` flagged bot players with Hebrew names), `clear()` (kicks all bots, cancels pending answers). Bots answer after 0.5–5.5 s with a chance that rises per step (`[0.1, 0.25, 0.5, 0.7, 0.85]`), correct 60 % of the time, and only if the same step is still open.
- WS host commands `spawnBots {n}` (1–14) and `clearBots` (via `hub.extra`).

- [ ] **Step 1: Write the failing bot tests** — `test/bots.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/game.js';
import { BotRunner } from '../src/game/bots.js';
import { config } from '../config.js';
import { FakeTimers, SONGS } from './helpers.js';

function mk(botRng) {
  const timers = new FakeTimers();
  const game = new Game({ config, getSongs: () => SONGS, timers, rng: () => 0.5 });
  const bots = new BotRunner(game, { timers, rng: botRng });
  return { timers, game, bots };
}
function openStep0({ game, timers }) {
  game.startRound({ songId: 's0' }); game.hostReady(); timers.advance(config.preRoundMs); game.stepStarted();
}

test('spawn adds flagged bots; clear removes them', () => {
  const { game, bots } = mk(() => 0);
  bots.spawn(3);
  assert.equal(game.snapshot('host').players.filter((p) => p.bot).length, 3);
  assert.ok(game.snapshot('tv').leaderboard.every((p) => p.name.startsWith('בוט')));
  bots.clear();
  assert.equal(game.snapshot('host').players.length, 0);
});

test('an eager bot answers correctly and wins the round', () => {
  const ctx = mk(() => 0);
  ctx.bots.spawn(2);
  openStep0(ctx);
  ctx.timers.advance(500);
  assert.equal(ctx.game.phase, 'revealed');
  assert.ok(ctx.game.snapshot('tv').reveal.winnerName.startsWith('בוט'));
});

test('a shy bot never answers', () => {
  const ctx = mk(() => 0.99);
  ctx.bots.spawn(2);
  openStep0(ctx);
  ctx.timers.advance(6000);
  assert.equal(ctx.game.phase, 'open');
  assert.ok(ctx.game.snapshot('host').players.every((p) => p.score === 0));
});

test('a pending bot answer is dropped when the round was skipped', () => {
  const ctx = mk(() => 0);
  ctx.bots.spawn(1);
  openStep0(ctx);
  ctx.game.skip();
  ctx.timers.advance(10000);
  assert.equal(ctx.game.phase, 'idle');
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `src/game/bots.js`

```js
import { realTimers } from './game.js';

const NAMES = ['בוט אורי', 'בוט דנה', 'בוט נועה', 'בוט גל', 'בוט שירה', 'בוט יעל', 'בוט תמר', 'בוט רוני', 'בוט ליה', 'בוט מיה', 'בוט ענבר', 'בוט הילה', 'בוט אלה', 'בוט נטע'];
const CHANCE = [0.1, 0.25, 0.5, 0.7, 0.85];

export class BotRunner {
  constructor(game, { timers = realTimers, rng = Math.random } = {}) {
    this.game = game; this.timers = timers; this.rng = rng;
    this.ids = new Set(); this.pending = new Set(); this.count = 0;
    game.on('step_open', ({ step }) => this.onStep(step));
  }

  spawn(n) {
    for (let i = 0; i < n; i++) {
      const r = this.game.join(NAMES[this.count++ % NAMES.length]);
      if (!r.ok) break;
      r.player.bot = true;
      this.ids.add(r.player.id);
    }
    this.game.changed();
  }

  clear() {
    for (const h of this.pending) this.timers.clear(h);
    this.pending.clear();
    for (const id of this.ids) this.game.kick(id);
    this.ids.clear();
  }

  onStep(step) {
    for (const id of this.ids) {
      if (this.rng() > (CHANCE[step] ?? 0.9)) continue;
      const delay = 500 + this.rng() * 5000;
      const h = this.timers.set(() => {
        this.pending.delete(h);
        const g = this.game; const r = g.round;
        if (!r || g.phase !== 'open' || r.step !== step) return;
        const right = this.rng() < 0.6;
        g.answer(id, right ? r.correctIndex : (r.correctIndex + 1 + Math.floor(this.rng() * 3)) % 4);
      }, delay);
      this.pending.add(h);
    }
  }
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Wire into the app and host UI**

In `src/app.js` add `import { BotRunner } from './game/bots.js';` and, right after `const hub = attachHub({ server, game });`:

```js
  const bots = new BotRunner(game, { timers, rng });
  hub.extra = (c, m) => {
    if (m.c === 'spawnBots') bots.spawn(Math.max(1, Math.min(14, Math.floor(Number(m.args?.n) || 1))));
    else if (m.c === 'clearBots') bots.clear();
  };
```
and add `bots` to the returned object. In `public/js/host.js`, inside `players(s)`, insert directly after the `el('h3', ...)` child:

```js
    el('div', { class: 'row' }, btn('🤖 +3 בוטים', () => cmd('spawnBots', { n: 3 }), 'alt'), btn('הסר בוטים', () => cmd('clearBots'), 'alt')),
```

- [ ] **Step 6: Load test with 14 real WebSocket phones** — `test/load.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import { config as base } from '../config.js';

const fast = { ladderMs: [50, 100, 150, 200, 250], preRoundMs: 30, answerMs: 300, ackTimeoutMs: 500, preloadTimeoutMs: 1000 };

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d)));
  return { ws, msgs, open: new Promise((r) => ws.on('open', r)), send: (m) => ws.send(JSON.stringify(m)) };
}
async function waitFor(msgs, pred, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const m = msgs.findLast(pred);
    if (m) return m;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('14 phones: everyone joins, 13 answer wrong, 1 answers right, all see the reveal and the right scores', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'load-'));
  const songsDir = path.join(dir, 'songs'); await fs.mkdir(songsDir, { recursive: true });
  const decoys = [{ title: 'X1' }, { title: 'X2' }, { title: 'X3' }];
  await fs.writeFile(path.join(dir, 'songs.json'), JSON.stringify({ songs: [{ id: 's0', title: 'Song A', artist: 'A', file: 's0.mp3', distractors: decoys }] }));
  const app = await createApp({ config: { ...base, ...fast, dataDir: dir, songsDir } });
  const port = await app.listen(0);

  const host = client(port); await host.open; host.send({ t: 'hello', role: 'host' });
  const phones = Array.from({ length: 14 }, () => client(port));
  await Promise.all(phones.map((p) => p.open));
  phones.forEach((p, i) => p.send({ t: 'hello', role: 'player', code: app.game.code, name: `בת ${i + 1}` }));
  await Promise.all(phones.map((p) => waitFor(p.msgs, (m) => m.t === 'joined')));

  host.send({ t: 'cmd', c: 'startRound', args: { songId: 's0' } });
  await waitFor(host.msgs, (m) => m.t === 'preload'); host.send({ t: 'cmd', c: 'hostReady', args: {} });
  await waitFor(host.msgs, (m) => m.t === 'play_step'); host.send({ t: 'cmd', c: 'stepStarted', args: {} });
  const open = await waitFor(host.msgs, (m) => m.t === 'state' && m.s.phase === 'open');
  const right = open.s.round.correctIndex;
  await Promise.all(phones.map((p) => waitFor(p.msgs, (m) => m.t === 'state' && m.s.phase === 'open')));

  phones.slice(0, 13).forEach((p) => p.send({ t: 'answer', i: (right + 1) % 4 }));
  await new Promise((r) => setTimeout(r, 30));
  phones[13].send({ t: 'answer', i: right });
  const finals = await Promise.all(phones.map((p) => waitFor(p.msgs, (m) => m.t === 'state' && m.s.phase === 'revealed')));
  assert.ok(finals.every((m) => m.s.leaderboard.length === 14));
  assert.equal(finals[13].s.you.score, 100);
  assert.equal(finals[0].s.you.score, 0);
  assert.equal(finals[0].s.reveal.winnerName, 'בת 14');
  await app.close();
});
```

- [ ] **Step 7: Run everything** — `npm test`. Expected: all green, the load test in well under 2 s.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: practice bots and 14-phone load test"`

---

### Task 21: Start script, Cloudflare tunnel with LAN fallback, and the starter song list

**Files:**
- Create: `src/tunnel.js`, `scripts/start.js`, `scripts/seed.js`, `test/tunnel.test.js`

**Interfaces:**
- Produces:
  - `parseTunnelUrl(text) → string|null`
  - `startTunnel(port, { spawnFn?, timeoutMs?, bin? }) → Promise<{ url, stop() }>` — rejects on a missing binary, early exit, or timeout (default 20 s); kills the child on timeout
  - `npm start` → server + tunnel (or LAN-only fallback) + terminal QR; `npm start -- --no-tunnel` forces LAN-only
  - `npm run seed` → searches the NAS for the 15 starter songs, copies them into `songs/`, fills wrong answers, prints a review table

- [ ] **Step 1: Write the failing tunnel tests** — `test/tunnel.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseTunnelUrl, startTunnel } from '../src/tunnel.js';

function fakeChild() {
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.kill = () => { c.killed = true; };
  return c;
}

test('parseTunnelUrl finds the trycloudflare URL in log noise', () => {
  assert.equal(parseTunnelUrl('2026 INF |  https://happy-cat-1234.trycloudflare.com  |'), 'https://happy-cat-1234.trycloudflare.com');
  assert.equal(parseTunnelUrl('nothing here'), null);
});

test('resolves with the URL printed on stderr', async () => {
  const child = fakeChild();
  const p = startTunnel(3000, { spawnFn: () => child });
  child.stderr.emit('data', Buffer.from('INF |  https://a-b-c.trycloudflare.com |'));
  const t = await p;
  assert.equal(t.url, 'https://a-b-c.trycloudflare.com');
  t.stop();
  assert.equal(child.killed, true);
});

test('rejects when cloudflared is not installed', async () => {
  const child = fakeChild();
  const p = startTunnel(3000, { spawnFn: () => child });
  process.nextTick(() => child.emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' })));
  await assert.rejects(p, /ENOENT/);
});

test('rejects (and kills the child) when no URL appears in time', async () => {
  const child = fakeChild();
  await assert.rejects(startTunnel(3000, { spawnFn: () => child, timeoutMs: 30 }), /tunnel_timeout/);
  assert.equal(child.killed, true);
});

test('rejects when the process exits early', async () => {
  const child = fakeChild();
  const p = startTunnel(3000, { spawnFn: () => child });
  process.nextTick(() => child.emit('exit', 1));
  await assert.rejects(p, /exited/);
});

test('rejects when spawning throws synchronously', async () => {
  await assert.rejects(startTunnel(3000, { spawnFn: () => { throw new Error('boom'); } }), /boom/);
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `src/tunnel.js`

```js
import { spawn as realSpawn } from 'node:child_process';

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
export const parseTunnelUrl = (text) => String(text).match(URL_RE)?.[0] ?? null;

export function startTunnel(port, { spawnFn = realSpawn, timeoutMs = 20000, bin = 'cloudflared' } = {}) {
  return new Promise((resolve, reject) => {
    let child = null; let done = false;
    const timer = setTimeout(() => { child?.kill(); finish(reject, new Error('tunnel_timeout')); }, timeoutMs);
    function finish(fn, value) { if (done) return; done = true; clearTimeout(timer); fn(value); }
    try {
      child = spawnFn(bin, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { return finish(reject, e); }
    const onData = (d) => { const url = parseTunnelUrl(d.toString()); if (url) finish(resolve, { url, stop: () => child.kill() }); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => finish(reject, e));
    child.on('exit', (code) => finish(reject, new Error(`cloudflared exited (${code})`)));
  });
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`.

- [ ] **Step 5: Start script** — `scripts/start.js`

```js
import QRCode from 'qrcode';
import { createApp, lanUrl } from '../src/app.js';
import { startTunnel } from '../src/tunnel.js';
import { config } from '../config.js';

const app = await createApp({ config });
const port = await app.listen();
const lan = lanUrl(port);

let tunnel = null;
if (!process.argv.includes('--no-tunnel')) {
  try { tunnel = await startTunnel(port); }
  catch (e) { console.warn(`\n! No public tunnel (${e.message}).\n! Falling back to the home network only: every phone must be on the same Wi-Fi as this computer.\n`); }
}
app.setPublicUrl(tunnel ? tunnel.url : lan);

const phones = app.joinUrl();
console.log(await QRCode.toString(phones, { type: 'terminal', small: true }));
console.log(`Room code     : ${app.game.code}`);
console.log(`Phones        : ${phones}${tunnel ? '   (public tunnel)' : '   (home network only)'}`);
console.log(`Host (Chrome) : http://localhost:${port}/host`);
console.log(`TV            : http://localhost:${port}/tv`);
console.log(`Song manager  : http://localhost:${port}/manage   (PIN from other devices: ${config.pin})`);
console.log(`Music folder  : ${config.musicDir}`);

const stop = async () => { tunnel?.stop(); await app.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
```

- [ ] **Step 6: Seed script** — `scripts/seed.js`

```js
import { createApp } from '../src/app.js';
import { config } from '../config.js';
import { ingestFile } from '../src/library/ingest.js';
import { suggestDistractors } from '../src/library/distractors.js';
import { loadPool } from '../src/library/pool.js';

const SEED = [
  "Taylor Swift Shake It Off", "Miley Cyrus Flowers", "Katy Perry Roar", "Harry Styles Watermelon Sugar",
  "Dua Lipa Don't Start Now", "Shakira Hips Don't Lie",
  'הרקדן האוטומטי', 'יש לי ציפור קטנה בלב', 'נועה קירל מיליון דולר', 'נועה קירל אם אתה גבר', 'נועה קירל אמבולנס', 'טיקיטאס',
  'גזוז חללית', 'גזוז תשע בכיכר', 'גזוז רוני',
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
  const song = await ingestFile({ abs: app.index.resolve(hit.rel), srcRel: hit.rel, config, store: app.store });
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
```

- [ ] **Step 7: Run it for real (Windows, against the share)**

Run: `npm run seed`
Expected: an index line (~41k files; takes 1–2 minutes the first time), then 15 lines starting with `ok`. Open the printed rows and sanity-check the picks (the Hebrew titles should come from the "גזוז – 20 הלהיטים" FLAC copies, not instrumentals/remixes). Any `x ... NOT FOUND` or wrong pick is fixed in `/manage` (search, add, delete).

- [ ] **Step 8: Start check without a tunnel** — `npm start -- --no-tunnel`; expect the terminal QR, the room code and the `home network only` line. Then `npm start` on a machine without `cloudflared`: expect the `! No public tunnel (spawn cloudflared ENOENT)` warning and the same LAN output (not a hang). Ctrl+C exits cleanly.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat: start script, tunnel with LAN fallback, starter song seed"`

---

### Task 22: Spotify playlist import (paste first, embed scrape second)

**Files:**
- Create: `src/library/spotify.js`, `test/spotify.test.js`, `test/fixtures/spotify-embed.html` (captured from the real page in Step 1)
- Modify: `src/net/manage-routes.js` (`POST /spotify`, `POST /spotify/paste`), `public/js/manage.js` (import panel)

**Interfaces:**
- Produces (`spotify.js`):
  - `parsePlaylistId(input) → string|null` (URL, `spotify:playlist:` URI or bare id with the `playlist/` prefix)
  - `extractTracks(html) → {title, artist}[]` — tolerant: looks in `__NEXT_DATA__`, any `application/json` script (also URL-decoded), then in the raw HTML for a `"trackList":[...]` array; de-duplicates
  - `fetchPlaylist(urlOrId, fetchImpl?) → Promise<{title, artist}[]>` (reads `https://open.spotify.com/embed/playlist/<id>`, first ~100 tracks)
  - `parsePastedList(text) → {title, artist}[]` — one `Title - Artist` (or tab-separated) per line
  - `cleanTitle(t)` — strips `(feat …)`, `[…]`, and ` - Remastered/Radio Edit/Sped Up…` suffixes
  - `matchTrack(index, track) → {rel, artist, title, confidence:'artist'|'title'}|null` — tries "title + first artist", then "title" alone
- API: `POST /api/manage/spotify {url}` and `POST /api/manage/spotify/paste {text}` → `{rows: [{title, artist, match}]}`; both also write `<dataDir>/playlist.json` (decoy pool for Task 19).

- [ ] **Step 1: Capture a real fixture and inspect it**

Run: `curl -s -A "Mozilla/5.0" "https://open.spotify.com/embed/playlist/7lxboJrwOwS2ridfuKSBXG" -o test/fixtures/spotify-embed.html` (create `test/fixtures/` first).
Run: `grep -o '"trackList"' test/fixtures/spotify-embed.html | head -1` and `grep -o '<script[^>]*>' test/fixtures/spotify-embed.html | head`.
Expected: the page contains a `trackList` array (in `__NEXT_DATA__` or another JSON script). If it only appears URL-encoded or under another key name, adjust `extractTracks` in Step 3 accordingly — the tests below are written against both a synthetic page and this real file.

- [ ] **Step 2: Write the failing tests** — `test/spotify.test.js`

```js
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

test('the real captured embed page parses (skipped when the fixture is absent)', { skip: !fs.existsSync(new URL('./fixtures/spotify-embed.html', import.meta.url)) }, () => {
  const tracks = extractTracks(fs.readFileSync(new URL('./fixtures/spotify-embed.html', import.meta.url), 'utf8'));
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
  assert.equal(cleanTitle('Hips Don\'t Lie (feat. Wyclef Jean)'), "Hips Don't Lie");
});

test('matchTrack prefers a title+artist hit and falls back to title only', () => {
  const calls = [];
  const index = { search: (q) => { calls.push(q); return q === 'Roar' ? [{ rel: 'x/Roar.flac', artist: '', title: 'Roar' }] : []; } };
  const m = matchTrack(index, { title: 'Roar (feat. X)', artist: 'Katy Perry, Someone' });
  assert.deepEqual(calls, ['Roar Katy Perry', 'Roar']);
  assert.equal(m.confidence, 'title');
  assert.equal(matchTrack({ search: () => [] }, { title: 'Zzz', artist: 'Q' }), null);
});
```

- [ ] **Step 3: Run, expect failure** — missing module.

- [ ] **Step 4: Implement** — `src/library/spotify.js`

```js
import { normalize } from './text.js';

export function parsePlaylistId(input) {
  const m = String(input ?? '').match(/playlist[/:]([A-Za-z0-9]{10,})/);
  return m ? m[1] : null;
}

function findKey(o, k) {
  if (o && typeof o === 'object') {
    if (Array.isArray(o[k])) return o[k];
    for (const v of Object.values(o)) { const r = findKey(v, k); if (r) return r; }
  }
  return null;
}

function balanced(text, start) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function listFrom(text) {
  try { const l = findKey(JSON.parse(text), 'trackList'); if (l) return l; } catch { /* not JSON */ }
  const i = text.indexOf('"trackList":');
  if (i < 0) return null;
  const s = text.indexOf('[', i);
  const raw = s >= 0 ? balanced(text, s) : null;
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function dedupe(tracks) {
  const seen = new Set();
  return tracks.filter((t) => { const k = `${normalize(t.title)}|${normalize(t.artist)}`; if (!t.title || seen.has(k)) return false; seen.add(k); return true; });
}

export function extractTracks(html) {
  const bodies = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const decoded = bodies.map((b) => { try { return decodeURIComponent(b); } catch { return ''; } });
  for (const text of [...bodies, ...decoded, html]) {
    const list = listFrom(text);
    if (Array.isArray(list) && list.length) {
      return dedupe(list.map((t) => ({ title: String(t.title ?? '').trim(), artist: String(t.subtitle ?? t.artist ?? '').replace(/ /g, ' ').trim() })));
    }
  }
  throw new Error('no_tracklist');
}

export async function fetchPlaylist(urlOrId, fetchImpl = fetch) {
  const id = parsePlaylistId(urlOrId);
  if (!id) throw new Error('bad_url');
  const r = await fetchImpl(`https://open.spotify.com/embed/playlist/${id}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`spotify_http_${r.status}`);
  return extractTracks(await r.text());
}

export function parsePastedList(text) {
  const out = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const tab = line.split('\t');
    if (tab.length >= 2) return { title: tab[0].trim(), artist: tab[1].trim() };
    const i = line.search(/\s[-–—]\s/);
    return i < 0 ? { title: line, artist: '' } : { title: line.slice(0, i).trim(), artist: line.slice(i).replace(/^\s[-–—]\s/, '').trim() };
  });
  return dedupe(out);
}

export function cleanTitle(t) {
  return String(t ?? '').replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s+-\s+.*$/, '').replace(/\s+/g, ' ').trim();
}

export function matchTrack(index, track) {
  const title = cleanTitle(track.title);
  const artist = String(track.artist ?? '').split(',')[0].trim();
  const attempts = artist ? [[`${title} ${artist}`, 'artist'], [title, 'title']] : [[title, 'title']];
  for (const [q, confidence] of attempts) {
    const hit = index.search(q, 3)[0];
    if (hit) return { rel: hit.rel, artist: hit.artist, title: hit.title, confidence };
  }
  return null;
}
```

- [ ] **Step 5: Run, expect pass** — `npm test`. If the real-fixture test fails, adjust `extractTracks` to the structure you saw in Step 1 (keep the synthetic tests green).

- [ ] **Step 6: API routes** — in `src/net/manage-routes.js` add imports

```js
import { fetchPlaylist, parsePastedList, matchTrack } from '../library/spotify.js';
import { hasHebrew } from '../library/text.js';
```
and before `return r;`:

```js
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
```

Add to `test/manage.test.js`:

```js
test('pasted lists are matched against the index and saved as the decoy pool', async () => {
  const { call, config, app } = await boot();
  const r = await (await call('/spotify/paste', { method: 'POST', body: JSON.stringify({ text: 'Roar - Katy Perry\nNo Such Song - Nobody' }) })).json();
  assert.equal(r.rows.length, 2);
  assert.match(r.rows[0].match.rel, /Roar/);
  assert.equal(r.rows[1].match, null);
  const saved = JSON.parse(await fs.readFile(path.join(config.dataDir, 'playlist.json'), 'utf8'));
  assert.equal(saved.length, 2);
  assert.equal((await call('/spotify/paste', { method: 'POST', body: JSON.stringify({ text: '   ' }) })).status, 400);
  await app.close();
});
```
Run `npm test` → pass.

- [ ] **Step 7: Manager panel** — in `public/js/manage.js` add (after the `afterAdd` stub) and mount it into `extraBox`:

```js
function spotifyPanel() {
  const box = el('textarea', { rows: 3, placeholder: 'קישור לפלייליסט בספוטיפיי — או רשימת שירים (שיר - אמן), שורה לכל שיר', style: 'width:100%;font:inherit;padding:8px;border-radius:10px;border:2px solid #d9c3a0' });
  const out = el('div');
  const go = el('button', { class: 'btn', text: 'בדיקה מול BIGBOX', onclick: async () => {
    out.textContent = 'בודק…';
    const text = box.value.trim();
    try {
      const isUrl = /spotify\.com|spotify:/.test(text);
      const { rows } = await api(isUrl ? '/spotify' : '/spotify/paste', { method: 'POST', body: isUrl ? { url: text } : { text } });
      out.replaceChildren(el('p', { text: `${rows.filter((r) => r.match).length} מתוך ${rows.length} נמצאו ב-BIGBOX` }), ...rows.map(importRow));
    } catch (e) { out.textContent = `שגיאה: ${e.message} (אפשר להדביק את הרשימה ידנית)`; }
  } });
  return el('div', { class: 'card' }, el('h3', { text: '🎧 ייבוא מפלייליסט' }), box, go, out);
}

function importRow(r) {
  const added = songs.some((s) => r.match && s.srcRel === r.match.rel);
  const add = el('button', { class: 'btn', text: added ? '✔ ברשימה' : '➕ הוסף', disabled: !r.match || added });
  add.addEventListener('click', async () => { add.disabled = true; const song = await api('/add', { method: 'POST', body: { rel: r.match.rel } }); await afterAdd(song); await load(); add.textContent = '✔ ברשימה'; });
  return el('div', { class: 'res' },
    el('div', { class: 'grow' }, el('b', { dir: 'auto', text: `${r.title} — ${r.artist}` }),
      r.match ? el('div', { class: 'muted', dir: 'auto', text: `${r.match.artist} — ${r.match.title}${r.match.confidence === 'title' ? '  (התאמה לפי שם בלבד — כדאי לבדוק)' : ''}` }) : el('div', { class: 'err', text: 'לא נמצא ב-BIGBOX — צריך קובץ' })),
    add);
}
extraBox.append(spotifyPanel());
```

- [ ] **Step 8: Manual check** — in `/manage` paste the playlist link `https://open.spotify.com/playlist/7lxboJrwOwS2ridfuKSBXG`; expect ~100 rows with ✔/✗ and "add" buttons for matches. If Spotify blocks the scrape, the error message suggests pasting the list.

- [ ] **Step 9: Commit** — `git add -A && git commit -m "feat(library): Spotify playlist import and NAS matching"`

---

### Task 23: Tempo (BPM) estimation for smarter wrong answers

**Files:**
- Create: `public/js/bpm.js`, `test/bpm.test.js`
- Modify: `public/js/manage.js` (compute BPM after adding; "compute all" button)

**Interfaces:**
- Produces `estimateBpm(samples: Float32Array, sampleRate: number, { min?: 70, max?: 170 }) → number|null` — mono samples in, rounded BPM out (`null` for silence/too short); pure, no DOM, so it is unit-testable in Node.
- The manager decodes audio in the browser (no ffmpeg), calls `estimateBpm` on a 60 s mono window, then `PATCH /song/:id {bpm}`.

- [ ] **Step 1: Write the failing test** — `test/bpm.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateBpm } from '../public/js/bpm.js';

function clicks(bpm, secs = 20, sr = 8000) {
  const x = new Float32Array(secs * sr);
  const step = (60 / bpm) * sr;
  for (let t = 0; t < (secs * bpm) / 60; t++) {
    const start = Math.round(t * step);
    for (let i = 0; i < 200 && start + i < x.length; i++) x[start + i] = Math.exp(-i / 40) * Math.sin(i * 0.8);
  }
  return x;
}

for (const bpm of [90, 100, 120, 128, 140, 160]) {
  test(`click track at ${bpm} BPM is estimated within 3 BPM`, () => {
    const got = estimateBpm(clicks(bpm), 8000);
    assert.ok(Math.abs(got - bpm) <= 3, `expected ~${bpm}, got ${got}`);
  });
}

test('silence and tiny inputs give null', () => {
  assert.equal(estimateBpm(new Float32Array(8000 * 20), 8000), null);
  assert.equal(estimateBpm(new Float32Array(100), 8000), null);
});
```

- [ ] **Step 2: Run, expect failure** — missing module.

- [ ] **Step 3: Implement** — `public/js/bpm.js`

```js
export function estimateBpm(samples, sampleRate, { min = 70, max = 170 } = {}) {
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const frames = Math.floor(samples.length / hop);
  if (frames < 200) return null;
  const fps = sampleRate / hop;

  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < hop; i++) { const v = samples[f * hop + i]; e += v * v; }
    env[f] = Math.sqrt(e / hop);
  }
  const flux = new Float32Array(frames);
  let energy = 0;
  for (let f = 1; f < frames; f++) { flux[f] = Math.max(0, env[f] - env[f - 1]); energy += flux[f]; }
  if (energy < 1e-6) return null;

  const corr = (lag) => { let s = 0; for (let f = lag; f < frames; f++) s += flux[f] * flux[f - lag]; return s / (frames - lag); };
  const minLag = Math.max(2, Math.floor((fps * 60) / max));
  const maxLag = Math.min(frames - 2, Math.ceil((fps * 60) / min));
  let best = 0; let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) { const c = corr(lag); if (c > best) { best = c; bestLag = lag; } }
  if (!bestLag) return null;

  // octave check: prefer the half-period lag when it is almost as strong
  const half = Math.round(bestLag / 2);
  if (half >= minLag) {
    let hb = 0; let hl = 0;
    for (let l = half - 1; l <= half + 1; l++) { const c = corr(l); if (c > hb) { hb = c; hl = l; } }
    if (hb >= 0.8 * best) bestLag = hl;
  }

  // parabolic interpolation around the peak
  const y0 = corr(bestLag - 1); const y1 = corr(bestLag); const y2 = corr(bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const lagF = denom !== 0 ? bestLag + (0.5 * (y0 - y2)) / denom : bestLag;
  return Math.round((60 * fps) / lagF);
}
```

- [ ] **Step 4: Run, expect pass** — `npm test`. If a tempo is off by exactly 2× (octave), tune the 0.8 threshold in the half-lag check and keep every parameterised case green.

- [ ] **Step 5: Wire into the manager** — in `public/js/manage.js` add `import { estimateBpm } from './bpm.js';` after the `dom.js` import, then replace the `afterAdd` stub with:

```js
async function computeBpm(song) {
  const ab = await (await fetch(`/songs/${encodeURIComponent(song.file)}`)).arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(ab);
    const sr = buf.sampleRate;
    const start = Math.floor(Math.min(10, buf.duration / 4) * sr);
    const n = Math.min(Math.floor(60 * sr), buf.length - start);
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[start + i] / buf.numberOfChannels;
    }
    const bpm = estimateBpm(mono, sr);
    if (bpm) await api(`/song/${song.id}`, { method: 'PATCH', body: { bpm } });
  } finally { ctx.close(); }
}
async function afterAdd(song) { try { await computeBpm(song); } catch { /* BPM is optional */ } }
```

and add to the skeleton (next to the "✨ complete all" button card):

```js
el('div', { class: 'card' }, el('button', { class: 'btn alt', text: '🥁 חשב BPM לשירים שחסר להם', onclick: async (e) => {
  e.target.disabled = true;
  for (const s of songs.filter((x) => !x.bpm)) { e.target.textContent = `מחשב ${s.title}…`; await afterAdd(s); }
  await load(); e.target.textContent = '🥁 חשב BPM לשירים שחסר להם'; e.target.disabled = false;
} }))
```

- [ ] **Step 6: Manual check** — in `/manage` press the BPM button with the seeded songs; each row's grey "N BPM" label fills in plausible values (Roar ≈ 90, Shake It Off ≈ 160/80, Flowers ≈ 118; half/double-time is acceptable). Then press "✨ השלם תשובות" and confirm same-language answers appear.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: BPM estimation for tempo-aware wrong answers"`

---

### Task 24: Mac runbook, rehearsal script and final verification

**Files:**
- Create: `docs/RUNBOOK-mac.md`

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Write `docs/RUNBOOK-mac.md`**

````markdown
# Running the song game on the Mac

## One-time setup (do this before Saturday, not on Saturday)
1. Install tools: `brew install node cloudflared` (and Google Chrome).
2. Mount the music share: Finder → Go → Connect to Server → `smb://BIGBOX2/music`. It appears as `/Volumes/music`.
3. Copy the whole project folder to the Mac **including `songs/` and `data/`** (they are not in git). In the folder: `npm install`.
4. First start: `npm start`. macOS asks "Allow node to accept incoming connections?" → **Allow**.
5. Keep the Mac awake during the party: run `caffeinate -d` in a second Terminal tab.

## Start the game
```
cd identifySongs
MANAGE_PIN=1234 npm start          # music folder defaults to /Volumes/music; override with MUSIC_DIR=...
```
The terminal prints a QR code, the room code, and the URLs. If it says "No public tunnel", phones must be on the home Wi-Fi.

1. Chrome → `http://localhost:3000/host` → press **הפעלת סאונד** (you should hear a two-note beep). This tab plays all audio; keep it open and visible.
2. Second window on the TV (HDMI, set as extended display) → `http://localhost:3000/tv` → full screen (Cmd+Ctrl+F).
3. System Settings → Sound → Output → the TV or speaker. Re-press the beep to check.
4. Girls scan the QR on the TV (or type the code at the phone URL) and enter a nickname.

## Managing songs
`http://localhost:3000/manage` (from a phone on the home Wi-Fi: `http://<mac-ip>:3000/manage`, PIN `1234`). Search the NAS, tap ➕, set start offset / hook / wrong answers, press the BPM and "complete wrong answers" buttons.

## Operator quick reference (host page)
▶ pick a song / 🎲 random · ⏸ pause–▶ continue · 🔁 replay the same clip · ➕ longer clip · 👀 reveal now · ⏭ skip song · ➡ next (stops the music) · "ניסיונות" = how many clip lengths before the answer is revealed · ±10 points and ✖ kick per player · 🤖 bots for practice.

## If something goes wrong
| Symptom | Fix |
|---|---|
| No sound | Host tab: press **הפעלת סאונד** again; check macOS output device; the host tab must be Chrome and not muted. |
| "השיר לא נטען" notice, song removed | The file is missing/corrupt. In `/manage` fix or re-add it (clear the red flag by re-adding). |
| Phones can't open the link | Check the `Phones:` line in the terminal. "home network only" → phone must be on the home Wi-Fi. Restart with `npm start` for a new tunnel URL; QR on the TV updates by itself after reload. |
| A girl is disconnected | She just reopens the link; her score and name come back. |
| Everything stuck | Ctrl+C in Terminal, `npm start`, reload `/host` and `/tv`. Scores reset on restart. |

## Rehearsal script (do it twice, with 4 players)
1. `npm start`; open host + TV; 4 phones join (use 2 on mobile data to test the tunnel).
2. Press 🤖 +3 for a fuller board. Play 5 rounds: one answered at step 1, one at step 3, one nobody answers, one wrong-then-right, one with ⏸ pause in the middle.
3. Lock a phone screen for 20 s mid-round; unlock: it returns with the same name/score.
4. Open `/manage` on a phone (PIN); add a song by search; play it.
5. Unplug Wi-Fi from the tunnel (`npm start -- --no-tunnel`) and confirm LAN-only still works.
````

- [ ] **Step 2: Full automated verification**

Run: `npm test`
Expected: every test file passes (scoring, game ×3, store, guard, app, dom, search, indexer, ingest, manage, bots, load, tunnel, spotify, bpm). Paste the pass/fail summary into the session before claiming completion (superpowers:verification-before-completion).

- [ ] **Step 3: Full manual verification on the Windows machine** (browser tools allowed)

Run `npm run seed` then `npm start -- --no-tunnel`, then repeat the eight observations of Task 13 with the real 15 songs and 1 s / 2 s / 4 s / 8 s / 15 s clips: confirm each clip is the right length by ear, the answer window only opens after the clip begins, points are 100/80/60/40/20, a wrong answer costs 10 (never below 0), `ניסיונות = 2` reveals after the second clip, the reveal shows the album art, and the full song plays until ➡ הבא.

- [ ] **Step 4: Verify on the Mac**, following the runbook once end-to-end, including a phone on mobile data via the tunnel and the lock-screen test.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: Mac runbook and rehearsal script"`

---

## Self-review against the spec

| Spec section | Where |
|---|---|
| Roles / screens (phone, TV, operator, manager) | Tasks 10, 11, 12, 18 |
| Node + WebSocket, one public URL via tunnel, LAN fallback, start script | Tasks 8, 21 |
| Songs from the playlist; local files; matcher; per-song config | Tasks 6, 14–17, 21 (seed), 22 |
| Distractors: same language, BPM, editable | Tasks 19, 23 |
| Round flow, ladder, attempts = steps, lock-out, audio-start ack, durations not timestamps | Tasks 3–5, 8, 12 |
| Scoring 100/80/60/40/20, −10 | Tasks 1, 2, 4 |
| Operator controls (pick/random, pause, replay, longer, skip, reveal, next, points, kick, attempts) | Tasks 5, 12 |
| Practice mode (bots) | Task 20 |
| Error handling: reconnect, late answers, missing file, tunnel failure, audio unlock | Tasks 4, 5, 8, 12, 21 |
| Song manager: index, search, copy, list editing, Spotify import, manual add | Tasks 14–18, 22 |
| Theme (מאי / capybara), RTL, sound effects | Tasks 9–12 |
| Testing: unit, scripted fake players, load, rehearsals, Saturday checklist | Tasks 2–8, 20, 24 |

Note on the per-round attempts override: the engine and WebSocket protocol accept `maxSteps` on `startRound` (tested in Task 4); the host page deliberately has no separate per-round control — changing the "ניסיונות" dropdown right before pressing ▶ is the per-round override.

Type/name consistency checked: `Game` methods (`startRound`, `hostReady`, `stepStarted`, `preloadFailed`, `answer`, `pause/resume/replay/nextStep/revealNow/skip/next/setMaxSteps`) match the hub's `cmd` names (`reveal` → `revealNow`); host events (`preload`, `play_step`, `pause`, `resume`, `full`, `stop`, `sfx`) match `host.js`; `Song` fields (`file, offsetMs, hook, art, distractors, lang, bpm, srcRel, unavailable`) are the same in the store, ingest, routes and manager; `AUDIO_EXT` is exported by `indexer.js` and imported by the routes.
