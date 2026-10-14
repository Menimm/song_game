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
