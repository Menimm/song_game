import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, isLoopback, isLocalRequest, isLoopbackRequest, requireLocal, requirePin } from '../src/net/guard.js';

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

test('the operator page is for this computer only: a phone on the LAN is not loopback', () => {
  assert.equal(isLoopbackRequest(req('127.0.0.1')), true);
  assert.equal(isLoopbackRequest(req('::1')), true);
  assert.equal(isLoopbackRequest(req('192.168.1.50')), false);
  assert.equal(isLoopbackRequest(req('127.0.0.1', { 'cf-connecting-ip': '5.5.5.5' })), false);
});

test('requireLocal 404s non-local requests', () => {
  let called = false; const r = res();
  requireLocal(req('8.8.8.8'), r, () => { called = true; });
  assert.equal(called, false); assert.equal(r.code, 404);
  requireLocal(req('192.168.1.7'), res(), () => { called = true; });
  assert.equal(called, true);
});

test('PIN: loopback bypasses, LAN needs it (header or ?pin=), wrong PIN is rate limited', () => {
  const mw = requirePin({ pin: '4321' });
  let ok = 0; const next = () => { ok++; };
  mw(req('127.0.0.1'), res(), next);
  mw(req('192.168.1.7', { 'x-pin': '4321' }), res(), next);
  assert.equal(ok, 2);
  mw(Object.assign(req('192.168.1.7'), { query: { pin: '4321' } }), res(), next);
  assert.equal(ok, 3);
  const bad = res(); mw(req('192.168.1.7', { 'x-pin': '0000' }), bad, next);
  assert.equal(bad.code, 401);
  for (let i = 0; i < 12; i++) mw(req('192.168.1.9', { 'x-pin': 'nope' }), res(), next);
  const limited = res(); mw(req('192.168.1.9', { 'x-pin': '4321' }), limited, next);
  assert.equal(limited.code, 429);
  assert.equal(ok, 3);
});
