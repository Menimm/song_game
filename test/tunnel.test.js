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
