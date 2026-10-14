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
