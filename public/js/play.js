import { el, LocalTimer, secs } from './dom.js';
import { connect } from './ws.js';

const mem = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const ERR = { bad_code: 'הקוד לא נכון', bad_name: 'צריך להקליד כינוי', full: 'החדר מלא' };
const app = document.getElementById('app');
const q = new URLSearchParams(location.search);

const digits = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 4);
const urlCode = digits(q.get('c'));
const savedCode = digits(mem.get('may.code'));

// The code in the link wins. A saved token only belongs to the room it was saved in.
let code = urlCode || savedCode;
let name = mem.get('may.name') || '';
let token = (!urlCode || urlCode === savedCode) ? (mem.get('may.token') || '') : '';
let joined = false; let state = null; let error = '';
const draft = { code: urlCode, name };                 // what is typed in the form; survives re-renders
const timer = new LocalTimer();

function forgetRoom() { code = ''; token = ''; mem.set('may.code', ''); mem.set('may.token', ''); }

const conn = connect({
  role: 'player', reconnectOnWake: true,
  getHello: () => (code && (token || name) ? { code, name, token } : null),
  onState(s) { state = s; timer.update(s.timer); render(); },
  onMessage(m) {
    if (m.t === 'joined') {
      token = m.token; name = m.name; joined = true; error = '';
      mem.set('may.token', token); mem.set('may.name', name); mem.set('may.code', code);
      keepAwake();
    } else if (m.t === 'error') {
      joined = false;
      if (m.e === 'bad_code') { forgetRoom(); draft.code = urlCode; }   // a stale remembered code must not come back
      else token = '';
      error = ERR[m.e] || 'משהו השתבש';
      const msg = document.getElementById('formErr');          // update in place so the keyboard/typing is not disturbed
      if (msg) msg.textContent = error; else render();
    }
  },
});

async function keepAwake() { try { await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) keepAwake(); });

function formView() {
  const codeIn = el('input', { value: draft.code, maxlength: 4, placeholder: 'קוד החדר (4 ספרות)', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', dir: 'ltr' });
  const nameIn = el('input', { value: draft.name, maxlength: 16, placeholder: 'הכינוי שלך', autocomplete: 'off' });
  codeIn.addEventListener('input', () => { draft.code = digits(codeIn.value); if (codeIn.value !== draft.code) codeIn.value = draft.code; });
  nameIn.addEventListener('input', () => { draft.name = nameIn.value; });
  const go = () => {
    code = digits(draft.code); name = draft.name.trim(); token = '';
    if (code.length !== 4) { error = ERR.bad_code; return render(); }
    if (!name) { error = ERR.bad_name; return render(); }
    error = '';
    conn.hello();
  };
  return el('div', {},
    el('div', { class: 'card' }, el('img', { src: '/img/capybara.svg', width: 160, alt: '' }), el('h2', { text: 'המסיבה של מאי 🎶' }), el('p', { text: 'מזהים שיר מההתחלה!' })),
    el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); go(); } }, codeIn, nameIn,
      el('div', { class: 'err', id: 'formErr', text: error }), el('button', { class: 'btn', type: 'submit', text: 'יאללה, נכנסים!' })));
}

function timerBlock() {
  return el('div', {}, el('div', { class: 'big', 'data-secs': '' }), el('div', { class: 'bar' }, el('i', { 'data-bar': '' })));
}

function dots(s) {
  return el('div', { class: 'dots' }, Array.from({ length: s.maxSteps }, (_, i) => el('i', { class: i < s.step ? 'on' : i === s.step ? 'cur' : '' })));
}

function optionsView(s, me, right) {
  const live = s.phase === 'open' && !me.locked;
  return el('div', { class: 'opts' }, s.options.map((o, i) =>
    el('button', {
      class: `opt${right === i ? ' right' : ''}${live || right !== null ? '' : ' off'}`, disabled: !live,
      onclick: () => { conn.send({ t: 'answer', i }); navigator.vibrate?.(25); },
    }, el('b', { dir: 'auto', text: o.title }), el('small', { dir: 'auto', text: o.artist }))));
}

function gameView() {
  const s = state; const me = s.you;
  const head = el('div', { class: 'top' }, el('span', { dir: 'auto', text: me.name }), el('span', { text: `${me.score} נק׳` }), el('span', { text: `מקום ${me.rank}` }));
  let body;
  if (s.phase === 'idle') {
    body = el('div', { class: 'card' }, el('img', { src: '/img/capybara.svg', width: 140, alt: '' }), el('h3', { text: 'מחכים לשיר הבא…' }));
  } else if (s.phase === 'preloading' || s.phase === 'countdown') {
    body = el('div', { class: 'card' }, el('h3', { text: 'מתכוננים! 🎧' }), s.phase === 'countdown' ? timerBlock() : el('p', { text: 'טוענים את השיר…' }));
  } else if (s.phase === 'paused' && !s.options) {
    body = el('div', { class: 'card' }, el('h3', { text: '⏸ הפסקה קצרה' }));
  } else if (s.phase === 'revealed') {
    const r = s.reveal;
    const verdict = r.winnerId === me.id ? `🎉 ניחשת! (${r.points} נק׳)` : r.winnerName ? `${r.winnerName} ניחשה (${r.points} נק׳)` : 'אף אחת לא ניחשה 🙈';
    body = el('div', {}, el('div', { class: 'card' }, r.art ? el('img', { src: r.art, width: 160, alt: '' }) : null,
      el('h2', { dir: 'auto', text: r.title }), el('div', { dir: 'auto', text: r.artist }),
      r.hook ? el('div', { class: 'muted', dir: 'auto', text: r.hook }) : null, el('h3', { text: verdict })),
      optionsView(s, me, r.correctIndex));
  } else {
    body = el('div', {}, el('div', { class: 'card' }, s.phase === 'paused' ? el('h3', { text: '⏸ הפסקה קצרה' }) : null, dots(s), timerBlock(),
      me.locked ? el('div', { class: 'err', text: 'טעית — מחכים לשלב הבא' }) : null), optionsView(s, me, null));
  }
  return el('div', {}, head, body);
}

function render() {
  app.replaceChildren(joined && state?.you ? gameView() : formView());
  tick();
}

function tick() {
  const v = timer.value();
  if (!v) return;
  const secsEl = app.querySelector('[data-secs]'); const bar = app.querySelector('[data-bar]');
  if (secsEl) secsEl.textContent = secs(v.remainingMs);
  if (bar) bar.style.width = `${v.totalMs ? (v.remainingMs / v.totalMs) * 100 : 0}%`;
}
setInterval(tick, 100);
render();
