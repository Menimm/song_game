export function connect({ role, getHello, onState, onMessage, onStatus }) {
  let ws; let closed = false; let delay = 500;
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const hello = () => { const h = getHello(); if (h) send({ t: 'hello', role, ...h }); };
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { delay = 500; onStatus?.('open'); hello(); };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') onState?.(m.s); else onMessage?.(m); };
    ws.onclose = () => { onStatus?.('closed'); if (!closed) setTimeout(open, (delay = Math.min(delay * 1.6, 3000))); };
  };
  open();
  return { send, hello, close() { closed = true; ws.close(); } };
}
