// Pure playback-position maths for the host's full-song player (seconds; `now` is the audio clock in seconds).
export class Transport {
  constructor(duration = 0) { this.duration = duration; this.playing = false; this.pos = 0; this.at = 0; }

  _clamp(p) { return Math.max(0, Math.min(this.duration, p)); }

  start(pos, now) { this.pos = this._clamp(pos); this.at = now; this.playing = true; }

  position(now) {
    if (!this.playing) return this.pos;
    return Math.min(this.duration, this.pos + (now - this.at));
  }

  pause(now) {
    if (!this.playing) return;
    this.pos = this.position(now);
    this.playing = false;
  }

  toggle(now) {
    if (this.playing) this.pause(now);
    else this.start(this.pos >= this.duration ? 0 : this.pos, now);
    return this.playing;
  }

  seek(pos, now) {
    const p = this._clamp(pos);
    if (this.playing) this.start(p, now); else this.pos = p;
  }
}
