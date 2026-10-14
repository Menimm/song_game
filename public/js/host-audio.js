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
