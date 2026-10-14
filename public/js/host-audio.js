import { Transport } from './transport.js';

export class HostAudio {
  constructor() {
    this.ctx = null; this.buffer = null; this.src = null;
    this.mode = null;                 // 'clip' (game-driven intro) | 'full' (operator-controlled full song) | null
    this.transport = new Transport(0);
    this.gen = 0;
    this.loadGen = 0;
  }

  get duration() { return this.buffer?.duration ?? 0; }

  async unlock() {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.resume();
  }

  async load(url) {
    this.release();
    const mine = this.loadGen;                       // release() (skip / next round) bumps this and abandons the load
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());   // one song at a time (~40 MB of PCM)
    if (mine !== this.loadGen) throw new Error('superseded');
    this.buffer = buf;
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
    this.mode = 'clip';
    const { src, gain } = this._source();
    const when = this.ctx.currentTime + 0.06; const len = lengthMs / 1000;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + 0.004);
    gain.gain.setValueAtTime(1, when + Math.max(0.005, len - 0.03));
    gain.gain.linearRampToValueAtTime(0, when + len);
    src.start(when, offsetMs / 1000, len);
    // wake a context the operator paused earlier, then ack once the scheduled start has arrived
    this.ctx.resume().then(() => setTimeout(onStarted, 60), () => setTimeout(onStarted, 60));
  }

  // ---- full song, operator-controlled (play / pause / seek) ----
  playFull(offsetMs) {
    this.ctx.resume();
    this.mode = 'full';
    this.transport = new Transport(this.duration);
    this._startFull(offsetMs / 1000);
  }

  _startFull(pos) {
    const { src, gain } = this._source();
    const gen = ++this.gen;
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.08);
    src.onended = () => { if (gen === this.gen && this.mode === 'full') this.transport.pause(this.ctx.currentTime); };
    src.start(0, Math.min(pos, Math.max(0, this.duration - 0.01)));
    this.transport.start(pos, this.ctx.currentTime);
  }

  togglePlay() {
    if (this.mode !== 'full') return;
    const now = this.ctx.currentTime;
    if (this.transport.playing) { this.transport.pause(now); this.gen++; this.stop(); }
    else this._startFull(this.transport.pos >= this.duration ? 0 : this.transport.pos);
  }

  seek(sec) {
    if (this.mode !== 'full') return;
    if (this.transport.playing) this._startFull(Math.max(0, Math.min(this.duration, sec)));
    else this.transport.seek(sec, this.ctx.currentTime);
  }

  position() { return this.mode === 'full' ? this.transport.position(this.ctx.currentTime) : 0; }
  get playingFull() { return this.mode === 'full' && this.transport.playing; }

  pause() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  stop() { try { this.src?.stop(); } catch { /* already stopped */ } this.src = null; }
  release() {
    this.gen++; this.loadGen++;
    this.stop(); this.buffer = null; this.mode = null; this.transport = new Transport(0);
    this.ctx?.resume();                           // never leave a paused (suspended) context behind for the next round
  }
}
