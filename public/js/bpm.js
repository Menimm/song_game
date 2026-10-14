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

  // widen the onset peaks (3 frames) so beats that fall between frame boundaries still line up
  const sm = new Float32Array(frames);
  for (let f = 1; f < frames - 1; f++) sm[f] = flux[f - 1] + flux[f] + flux[f + 1];

  const corr = (lag) => { let s = 0; for (let f = lag; f < frames; f++) s += sm[f] * sm[f - lag]; return s / (frames - lag); };
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
