import { el, LocalTimer, secs } from './dom.js';
import { connect } from './ws.js';

const app = document.getElementById('app');
let state = null; let joinInfo = { code: '', url: '' };
const timer = new LocalTimer();

async function loadJoin() {
  try { joinInfo = await (await fetch('/api/join')).json(); render(); } catch { /* retried on reconnect */ }
}
connect({
  role: 'tv', getHello: () => ({}),
  onState(s) { state = s; timer.update(s.timer); render(); },
  onStatus: (st) => { if (st === 'open') loadJoin(); },
});

const board = (s) => el('div', { class: 'card', style: 'margin:0;overflow:auto' },
  el('h2', { text: '🏆 הטבלה' }),
  el('table', { class: 'board' }, s.leaderboard.slice(0, 14).map((p) => el('tr', {},
    el('td', { text: p.rank }), el('td', { dir: 'auto', text: p.name, style: p.connected ? '' : 'opacity:.4' }), el('td', { text: p.score })))));

const dots = (s) => el('div', { class: 'dots' }, Array.from({ length: s.maxSteps }, (_, i) => el('i', { class: i < s.step ? 'on' : i === s.step ? 'cur' : '' })));

function stage(s) {
  if (s.phase === 'idle') {
    return el('div', { class: 'stage' }, el('img', { src: '/img/capybara.svg', width: 220, alt: '' }),
      el('h1', { text: 'המסיבה של מאי 🎶' }),
      el('img', { src: `/api/join-qr.svg?${s.code}`, width: 240, alt: 'QR' }),
      el('div', { class: 'huge', dir: 'ltr', text: s.code }), el('div', { dir: 'ltr', class: 'muted', text: joinInfo.url }));
  }
  if (s.phase === 'preloading') return el('div', { class: 'stage' }, el('h1', { text: 'מתכוננים… 🎧' }));
  if (s.phase === 'countdown' || (s.phase === 'paused' && !s.options)) {
    return el('div', { class: 'stage' }, el('h1', { text: s.phase === 'paused' ? '⏸ הפסקה' : 'השיר מתחיל בעוד…' }), el('div', { class: 'huge', 'data-secs': '' }));
  }
  if (s.phase === 'revealed') {
    const r = s.reveal;
    return el('div', { class: 'stage' },
      r.art ? el('img', { src: r.art, style: 'height:32vh;border-radius:20px', alt: '' }) : el('img', { src: '/img/capybara.svg', width: 200, alt: '' }),
      el('h1', { dir: 'auto', text: r.title }), el('h2', { dir: 'auto', text: r.artist }),
      r.hook ? el('div', { class: 'muted', dir: 'auto', text: r.hook }) : null,
      el('h2', { text: r.winnerName ? `🎉 ${r.winnerName} ניחשה! +${r.points}` : 'אף אחת לא ניחשה 🙈' }));
  }
  return el('div', { class: 'stage' }, dots(s),
    s.phase === 'paused' ? el('h1', { text: '⏸ הפסקה' }) : el('div', { class: 'huge', 'data-secs': '' }),
    el('div', { class: 'bar', style: 'width:80%' }, el('i', { 'data-bar': '' })),
    el('div', { class: 'opts' }, s.options.map((o) => el('div', { class: 'opt' }, el('b', { dir: 'auto', text: o.title }), el('small', { dir: 'auto', text: o.artist })))));
}

function render() {
  if (state) app.replaceChildren(el('div', { class: 'tv-grid' }, stage(state), board(state)));
  tick();
}
function tick() {
  const v = timer.value(); if (!v) return;
  const s = app.querySelector('[data-secs]'); const b = app.querySelector('[data-bar]');
  if (s) s.textContent = secs(v.remainingMs);
  if (b) b.style.width = `${v.totalMs ? (v.remainingMs / v.totalMs) * 100 : 0}%`;
}
setInterval(tick, 100);
