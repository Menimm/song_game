export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}

export const secs = (ms) => Math.ceil(ms / 1000);

export class LocalTimer {
  constructor(now = () => performance.now()) { this.now = now; this.t = null; this.at = 0; }
  update(t) { this.t = t; this.at = this.now(); }
  value() {
    if (!this.t) return null;
    const gone = this.t.running ? this.now() - this.at : 0;
    return { remainingMs: Math.max(0, this.t.remainingMs - gone), totalMs: this.t.totalMs, running: this.t.running };
  }
}
