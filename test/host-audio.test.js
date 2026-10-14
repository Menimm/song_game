import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Web Audio stub: enough to exercise HostAudio's resume/suspend and stale-load logic in Node.
function installStubs({ decode }) {
  class Ctx {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; this.log = []; }
    resume() { this.state = 'running'; this.log.push('resume'); return Promise.resolve(); }
    suspend() { this.state = 'suspended'; this.log.push('suspend'); return Promise.resolve(); }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect(x) { return x; } }; }
    createBufferSource() { const s = { connect: (x) => x, start: (...a) => { s.started = a; }, stop() { s.stopped = true; } }; return s; }
    decodeAudioData(ab) { return decode(ab); }
  }
  globalThis.AudioContext = Ctx;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
}

test('release() resumes a context the operator had paused (skip after pause must not leave later rounds silent)', async () => {
  installStubs({ decode: async () => ({ duration: 100 }) });
  const { HostAudio } = await import('../public/js/host-audio.js');
  const a = new HostAudio();
  await a.unlock();
  await a.load('/x');
  a.pause();
  assert.equal(a.ctx.state, 'suspended');
  a.release();
  assert.equal(a.ctx.state, 'running');
});

test('a clip is acknowledged only after the context is running', async () => {
  installStubs({ decode: async () => ({ duration: 100 }) });
  const { HostAudio } = await import('../public/js/host-audio.js');
  const a = new HostAudio();
  await a.unlock(); await a.load('/x');
  a.pause();                                                   // context suspended, as after a pause + skip
  let acked = false;
  a.playClip(0, 1000, () => { acked = true; });
  assert.equal(a.ctx.state, 'running');                        // playClip wakes the context itself
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(acked, true);
});

test('a decode that finishes after the round was abandoned does not attach its audio', async () => {
  let finish;
  installStubs({ decode: () => new Promise((r) => { finish = () => r({ duration: 50 }); }) });
  const { HostAudio } = await import('../public/js/host-audio.js');
  const a = new HostAudio();
  await a.unlock();
  const pending = a.load('/slow');
  await new Promise((r) => setTimeout(r, 10));
  a.release();                                                 // operator skipped / next round began
  finish();
  await assert.rejects(pending, /superseded/);
  assert.equal(a.buffer, null);
});
