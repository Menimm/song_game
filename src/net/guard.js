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

// The operator page runs on this computer; a phone on the LAN must not be able to open it (it shows the answers).
export function isLoopbackRequest(req) {
  if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
  return isLoopback(req.socket.remoteAddress);
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
    const given = req.headers['x-pin'] ?? req.query?.pin ?? '';
    if (timingSafeEqual(digest(given), digest(config.pin))) return next();
    f.n++;
    res.status(401).json({ error: 'bad_pin' });
  };
}
