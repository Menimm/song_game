export function connect({ role, getHello, onState, onMessage, onStatus, reconnectOnWake = false }) {
  let ws; let closed = false; let delay = 500; let hiddenAt = 0;
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const hello = () => { const h = getHello(); if (h) send({ t: 'hello', role, ...h }); };
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { delay = 500; hello(); onStatus?.('open'); };      // role first, then anything that needs it
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') onState?.(m.s); else onMessage?.(m); };
    ws.onclose = () => { onStatus?.('closed'); if (!closed) setTimeout(open, (delay = Math.min(delay * 1.6, 3000))); };
  };
  open();
  if (reconnectOnWake) {
    // A phone that was locked / switched network can hold a dead socket that still says "open": rebuild it on wake.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 3000 && ws) { delay = 300; try { ws.close(); } catch { /* already closed */ } }
      hiddenAt = 0;
    });
  }
  return { send, hello, close() { closed = true; ws.close(); } };
}
