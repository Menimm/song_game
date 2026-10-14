import { el, LocalTimer, secs } from './dom.js';
import { connect } from './ws.js';
import { HostAudio } from './host-audio.js';
import { sfx } from './sfx.js';

const app = document.getElementById('app');
const audio = new HostAudio();
const timer = new LocalTimer();
let state = null; let unlocked = false; let toast = ''; let joinInfo = { code: '', url: '' };

const cmd = (c, args = {}) => conn.send({ t: 'cmd', c, args });
const conn = connect({
  role: 'host', getHello: () => ({}),
  onState(s) { state = s; timer.update(s.timer); render(); },
  onMessage: handle,
  onStatus: (st) => {
    if (st !== 'open') return;
    if (unlocked) cmd('audioReady');                       // after a reconnect/reload: claim the audio role again
    fetch('/api/join').then((r) => r.json()).then((j) => { joinInfo = j; render(); }).catch(() => {});
  },
});

let preloadId = null;
async function handle(m) {
  switch (m.t) {
    case 'preload': {
      const id = m.song.id; preloadId = id;
      try {
        await audio.load(`/songs/${encodeURIComponent(m.song.file)}`);
        if (preloadId !== id) return;                      // a newer round already started
        if (m.resync) { if (state?.phase === 'revealed') audio.playFull(m.song.offsetMs); }
        else cmd('hostReady', { songId: id });
      } catch (e) {
        if (String(e.message) === 'superseded' || preloadId !== id || m.resync) return;
        cmd('preloadFailed', { reason: String(e.message || e), songId: id });
      }
      break;
    }
    case 'play_step': audio.playClip(m.offsetMs, m.lengthMs, () => cmd('stepStarted')); break;
    case 'pause': audio.pause(); break;
    case 'resume': audio.resume(); break;
    case 'full': audio.playFull(m.offsetMs); break;
    case 'stop': audio.release(); break;
    case 'sfx': sfx(audio.ctx, m.name); break;
    case 'error': toast = ({ busy: 'יש סיבוב פעיל', no_song: 'אין שיר', not_enough_options: 'חסרות תשובות שגויות לשיר הזה' })[m.e] || m.e; render(); break;
    default: break;
  }
}

const btn = (text, onclick, cls = '', disabled = false) => el('button', { class: `btn ${cls}`, onclick, disabled }, text);
const PHASE = { idle: 'ממתין', preloading: 'טוען שיר', countdown: 'ספירה לאחור', awaiting_audio: 'מנגן…', open: 'שלב פעיל', paused: 'בהפסקה', revealed: 'חשיפה' };

function controls(s) {
  const inRound = s.phase !== 'idle';
  const playing = ['open', 'paused', 'awaiting_audio'].includes(s.phase);
  const last = s.notices.at(-1);
  return el('div', { class: 'card' },
    el('div', { class: 'row' }, el('b', { text: PHASE[s.phase] }), s.step != null ? el('span', { class: 'tag', text: `שלב ${s.step + 1}/${s.maxSteps}` }) : null,
      el('span', { class: 'big', style: 'font-size:34px', 'data-secs': '' })),
    s.round ? el('div', { dir: 'auto', text: `🎵 ${s.round.title} — ${s.round.artist}` }) : null,
    el('div', { class: 'row', style: 'flex-wrap:wrap' },
      s.phase === 'paused' ? btn('▶ המשך', () => cmd('resume'), 'sun') : btn('⏸ הפסק', () => cmd('pause'), 'alt', !['open', 'countdown'].includes(s.phase)),
      btn('🔁 שוב', () => cmd('replay'), 'alt', !playing), btn('➕ ארוך יותר', () => cmd('nextStep'), 'alt', !playing),
      btn('👀 חשוף', () => cmd('reveal'), 'sun', !playing), btn('⏭ דלג', () => cmd('skip'), 'warn', !inRound || s.phase === 'revealed'),
      btn('➡ הבא', () => cmd('next'), '', s.phase !== 'revealed')),
    el('div', { class: 'row' }, el('span', { text: 'ניסיונות (שלבים):' }),
      el('select', { onchange: (e) => cmd('setMaxSteps', { n: Number(e.target.value) }) },
        [1, 2, 3, 4, 5].map((n) => el('option', { value: n, selected: n === s.maxSteps, text: n }))),
      toast ? el('span', { class: 'err', text: toast }) : null),
    s.phase !== 'idle' && s.phase !== 'preloading' && !audio.buffer ? el('div', { class: 'err', text: '⚠ אין שמע טעון במסך הזה — לחצו "דלג" והתחילו שיר מחדש' }) : null,
    last ? el('div', { class: 'err', text: last.reason === 'timeout' || last.reason === 'locked'
      ? '⚠ השיר לא נטען בזמן — בדקו שלחצתם "הפעלת סאונד" במסך המנחה הזה (השיר נשאר ברשימה)'
      : `⚠ השיר ${last.songId} לא נטען (${last.reason}) — הוסר מהמשחק. אפשר להחזיר אותו ב"ניהול שירים"` }) : null);
}

function songList(s) {
  const idle = s.phase === 'idle' || s.phase === 'revealed';
  return el('div', { class: 'card' }, el('div', { class: 'row' }, el('h3', { class: 'grow', text: 'שירים' }), btn('🎲 אקראי', () => { toast = ''; cmd('startRound'); }, 'sun', !idle)),
    s.songs.map((x) => el('div', { class: 'row' }, btn('▶', () => { toast = ''; cmd('startRound', { songId: x.id }); }, '', !idle),
      el('span', { class: 'grow', dir: 'auto', text: `${x.title} — ${x.artist}`, style: x.played ? 'opacity:.5' : '' }), x.played ? el('span', { class: 'tag', text: 'שוחק' }) : null)));
}

function players(s) {
  return el('div', { class: 'card' }, el('h3', { text: `שחקניות (${s.players.length})` }),
    el('div', { class: 'row' }, btn('🤖 +3 בוטים', () => cmd('spawnBots', { n: 3 }), 'alt'), btn('הסר בוטים', () => cmd('clearBots'), 'alt')),
    s.players.map((p) => el('div', { class: 'row' }, el('span', { class: 'grow', dir: 'auto', text: `${p.name}${p.bot ? ' 🤖' : ''}${p.connected ? '' : ' (מנותקת)'}` }),
      el('b', { text: p.score }), btn('+10', () => cmd('adjust', { id: p.id, delta: 10 }), 'alt'), btn('−10', () => cmd('adjust', { id: p.id, delta: -10 }), 'alt'),
      btn('✖', () => { if (confirm(`להוציא את ${p.name}?`)) cmd('kick', { id: p.id }); }, 'warn'))));
}

function render() {
  if (!state) return;
  const s = state;
  app.replaceChildren(...[
    unlocked ? null : el('div', { class: 'overlay' }, btn('🔊 הפעלת סאונד (חובה לפני שמתחילים)', async () => { await audio.unlock(); unlocked = true; cmd('audioReady'); sfx(audio.ctx, 'test'); render(); }, 'sun')),
    el('div', { class: 'top' }, el('span', { text: 'מסך מנחה' }), el('span', { dir: 'ltr', text: `קוד: ${joinInfo.code || s.code}` }), el('span', { dir: 'ltr', text: joinInfo.url }),
      el('a', { href: '/tv', target: '_blank', text: 'פתח טלוויזיה' }), el('a', { href: '/manage', target: '_blank', text: 'ניהול שירים' })),
    el('div', { class: 'host-grid' }, el('div', {}, controls(s), el('div', { style: 'height:14px' }), players(s)), songList(s)),
  ].filter(Boolean));
  tick();
}
// ---- transport bar: play / pause / drag-to-seek for the full song (after the reveal) ----
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let dragging = false;
const playBtn = el('button', { class: 'btn sun', onclick: () => { audio.togglePlay(); tick(); } }, '▶');
const seek = el('input', { type: 'range', min: 0, max: 1, step: 0.1, value: 0 });
const time = el('span', { class: 'time', text: '0:00 / 0:00' });
const note = el('span', { class: 'note', text: 'הנגן נפתח אחרי החשיפה (במהלך הסיבוב המשחק שולט בקטעים)' });
seek.addEventListener('pointerdown', () => { dragging = true; });
seek.addEventListener('input', () => { time.textContent = `${mmss(Number(seek.value))} / ${mmss(audio.duration)}`; });
seek.addEventListener('change', () => { audio.seek(Number(seek.value)); dragging = false; tick(); });
seek.addEventListener('pointerup', () => { dragging = false; });
document.getElementById('transport').append(playBtn, seek, time, note);

function tick() {
  const v = timer.value(); const e = app.querySelector('[data-secs]'); if (v && e) e.textContent = secs(v.remainingMs);
  const full = audio.mode === 'full';
  playBtn.disabled = !full; seek.disabled = !full; note.hidden = full;
  playBtn.textContent = audio.playingFull ? '⏸' : '▶';
  if (!full) { seek.value = 0; time.textContent = '0:00 / 0:00'; return; }
  seek.max = audio.duration;
  if (!dragging) { seek.value = audio.position(); time.textContent = `${mmss(audio.position())} / ${mmss(audio.duration)}`; }
}
setInterval(tick, 200);
