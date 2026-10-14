import { el } from './dom.js';
import { estimateBpm } from './bpm.js';

const app = document.getElementById('app');
const player = document.getElementById('player');
let pin = '';
try { pin = sessionStorage.getItem('may.pin') || ''; } catch { /* no storage */ }
let songs = []; let indexStatus = {};

async function api(path, { method = 'GET', body, raw, retried } = {}) {
  const headers = { 'x-pin': pin };
  if (body !== undefined && raw === undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`/api/manage${path}`, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (r.status === 401 && !retried) {
    pin = prompt('קוד ה-PIN של המנהל (מוצג במסוף של השרת):') || '';
    try { sessionStorage.setItem('may.pin', pin); } catch { /* ignore */ }
    return api(path, { method, body, raw, retried: true });
  }
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
const previewUrl = (rel) => `/api/manage/preview?rel=${encodeURIComponent(rel)}&pin=${encodeURIComponent(pin)}`;

// ---- skeleton (built once, so typing in the search box is never interrupted) ----
const idxLabel = el('span');
const searchBox = el('input', { placeholder: 'חיפוש שיר או אמן בעברית או באנגלית…', style: 'flex:1;font-size:20px;padding:10px;border-radius:12px;border:3px solid var(--brown)' });
const resultsBox = el('div');
const libraryBox = el('div');
const libTitle = el('h3');
const extraBox = el('div');
const dropBox = el('div', { class: 'drop', text: 'גררו לכאן קובץ שיר (mp3 / flac / m4a…) אם הוא לא ב-BIGBOX' });

// ---- BPM (decoded in the browser; no ffmpeg) ----
async function computeBpm(song) {
  const ab = await (await fetch(`/songs/${encodeURIComponent(song.file)}`)).arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(ab);
    const sr = buf.sampleRate;
    const start = Math.floor(Math.min(10, buf.duration / 4) * sr);
    const n = Math.min(Math.floor(60 * sr), buf.length - start);
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[start + i] / buf.numberOfChannels;
    }
    const bpm = estimateBpm(mono, sr);
    if (bpm) await api(`/song/${song.id}`, { method: 'PATCH', body: { bpm } });
  } finally { ctx.close(); }
}
async function afterAdd(song) { try { await computeBpm(song); } catch { /* BPM is optional */ } }

// ---- search ----
let timer = null;
searchBox.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(doSearch, 250); });

async function doSearch() {
  const q = searchBox.value.trim();
  if (!q) return resultsBox.replaceChildren();
  try {
    const { results } = await api(`/search?q=${encodeURIComponent(q)}`);
    resultsBox.replaceChildren(...(results.length ? results.map(resultRow) : [el('p', { class: 'muted', text: 'לא נמצא. אפשר לרענן את האינדקס או לגרור קובץ.' })]));
  } catch (e) { resultsBox.replaceChildren(el('p', { class: 'err', text: `שגיאה: ${e.message}` })); }
}

function resultRow(x) {
  const add = el('button', { class: 'btn', disabled: x.added, text: x.added ? '✔ ברשימה' : '➕ הוסף' });
  add.addEventListener('click', async () => {
    add.disabled = true; add.textContent = 'מעתיק…';
    try { const song = await api('/add', { method: 'POST', body: { rel: x.rel } }); await afterAdd(song); await load(); await doSearch(); }
    catch (e) { add.textContent = `שגיאה ${e.message}`; }
  });
  return el('div', { class: 'res' },
    el('button', { class: 'btn alt', onclick: () => { player.src = previewUrl(x.rel); player.play(); }, text: '▶' }),
    el('div', { class: 'grow' }, el('b', { dir: 'auto', text: `${x.artist || '?'} — ${x.title}` }), el('div', { class: 'muted', dir: 'auto', text: x.album }),
      x.copies > 1 ? el('span', { class: 'tag', text: `+${x.copies - 1} עותקים` }) : null), add);
}

// ---- library ----
async function load() {
  const j = await api('/library');
  songs = j.songs; indexStatus = j.index;
  idxLabel.textContent = `אינדקס: ${indexStatus.count.toLocaleString('he-IL')} קבצים${indexStatus.building ? ' (נסרק…)' : ''}${indexStatus.error ? ' ⚠ ' + indexStatus.error : ''}`;
  libTitle.textContent = `🎵 השירים במשחק (${songs.filter((s) => s.enabled && !s.unavailable).length}/${songs.length})`;
  renderLibrary();
}

async function save(song, patch) { Object.assign(song, await api(`/song/${song.id}`, { method: 'PATCH', body: patch })); }

function songRow(s, i) {
  const field = (key, props = {}) => {
    const input = el('input', { type: 'text', value: s[key] ?? '', ...props });
    input.addEventListener('change', () => save(s, { [key]: input.value }).catch(() => {}));
    return input;
  };
  const offset = el('input', { type: 'number', step: '0.1', min: '0', value: (s.offsetMs / 1000).toString(), title: 'התחלה בשניות' });
  offset.addEventListener('change', () => save(s, { offsetMs: Math.round(Number(offset.value) * 1000) }).catch(() => {}));
  const test = el('button', { class: 'btn alt', text: '▶ 1ש׳', onclick: () => {
    player.src = `/songs/${encodeURIComponent(s.file)}`;
    player.addEventListener('loadedmetadata', () => { player.currentTime = s.offsetMs / 1000; player.play(); setTimeout(() => player.pause(), 1000); }, { once: true });
    player.load();
  } });
  const enabled = el('input', { type: 'checkbox', checked: s.enabled });
  enabled.addEventListener('change', () => save(s, { enabled: enabled.checked }).then(load).catch(() => {}));
  const dis = [0, 1, 2].map((k) => {
    const input = el('input', { type: 'text', placeholder: `תשובה שגויה ${k + 1}`, value: s.distractors[k]?.title ?? '', dir: 'auto' });
    input.addEventListener('change', () => {
      const list = [0, 1, 2].map((j) => ({ title: dis[j].value.trim(), artist: s.distractors[j]?.artist ?? '' }));
      save(s, { distractors: list }).catch(() => {});
    });
    return input;
  });
  const move = (d) => async () => {
    const ids = songs.map((x) => x.id); const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('/reorder', { method: 'POST', body: { ids } }); await load();
  };
  return el('div', { class: 'song', style: s.unavailable ? 'background:#ffe3e0' : '' },
    enabled,
    el('div', {}, field('title', { dir: 'auto' }), s.unavailable ? el('div', { class: 'err', text: '⚠ הקובץ לא נטען — הוסר מהמשחק' }) : null),
    field('artist', { dir: 'auto' }),
    el('div', { class: 'row' }, el('button', { class: 'btn alt', onclick: move(-1), text: '↑' }), el('button', { class: 'btn alt', onclick: move(1), text: '↓' }),
      el('button', { class: 'btn warn', text: '🗑', onclick: async () => { if (confirm(`למחוק את "${s.title}"?`)) { await api(`/song/${s.id}`, { method: 'DELETE' }); await load(); } } })),
    el('div', { class: 'full' }, field('hook', { placeholder: 'שורת מילים קטנה (אופציונלי)', dir: 'auto' }),
      el('div', { class: 'row' }, el('span', { text: 'התחלה (ש׳)' }), offset, test),
      el('div', { class: 'muted', text: s.bpm ? `${s.bpm} BPM` : 'BPM לא חושב' })),
    el('div', { class: 'full' }, ...dis),
    el('div', { class: 'full' }, el('button', { class: 'btn alt', text: '✨ הצע תשובות שגויות', onclick: async () => {
      const { distractors } = await api(`/song/${s.id}/suggest`);
      await save(s, { distractors }); renderLibrary();
    } })));
}

function renderLibrary() {
  libraryBox.replaceChildren(...(songs.length ? songs.map(songRow) : [el('p', { class: 'muted', text: 'עוד אין שירים. חפשו למעלה והוסיפו.' })]));
}

// ---- index refresh ----
async function refreshIndex() {
  await api('/index/refresh', { method: 'POST' });
  const poll = setInterval(async () => {
    const st = await api('/index/status');
    idxLabel.textContent = `סורק… ${st.scanned.toLocaleString('he-IL')} קבצים`;
    if (!st.building) { clearInterval(poll); await load(); }
  }, 1500);
}

// ---- drag & drop upload ----
dropBox.addEventListener('dragover', (e) => { e.preventDefault(); dropBox.classList.add('over'); });
dropBox.addEventListener('dragleave', () => dropBox.classList.remove('over'));
dropBox.addEventListener('drop', async (e) => {
  e.preventDefault(); dropBox.classList.remove('over');
  for (const f of e.dataTransfer.files) {
    dropBox.textContent = `מעלה ${f.name}…`;
    try { const song = await api(`/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f }); await afterAdd(song); }
    catch (err) { dropBox.textContent = `שגיאה בהעלאת ${f.name}: ${err.message}`; return; }
  }
  dropBox.textContent = 'נוסף! אפשר לגרור עוד קובץ.'; await load();
});

// ---- Spotify / pasted playlist import ----
function importRow(r) {
  const added = songs.some((s) => r.match && s.srcRel === r.match.rel);
  const add = el('button', { class: 'btn', text: added ? '✔ ברשימה' : '➕ הוסף', disabled: !r.match || added });
  add.addEventListener('click', async () => {
    add.disabled = true;
    const song = await api('/add', { method: 'POST', body: { rel: r.match.rel } });
    await afterAdd(song); await load(); add.textContent = '✔ ברשימה';
  });
  return el('div', { class: 'res' },
    el('div', { class: 'grow' }, el('b', { dir: 'auto', text: `${r.title} — ${r.artist}` }),
      r.match ? el('div', { class: 'muted', dir: 'auto', text: `${r.match.artist} — ${r.match.title}${r.match.confidence === 'title' ? '  (התאמה לפי שם בלבד — כדאי לבדוק)' : ''}` })
        : el('div', { class: 'err', text: 'לא נמצא ב-BIGBOX — צריך קובץ' })),
    add);
}

function spotifyPanel() {
  const box = el('textarea', { rows: 3, placeholder: 'קישור לפלייליסט בספוטיפיי — או רשימת שירים (שיר - אמן), שורה לכל שיר', style: 'width:100%;font:inherit;padding:8px;border-radius:10px;border:2px solid #d9c3a0' });
  const out = el('div');
  const go = el('button', { class: 'btn', text: 'בדיקה מול BIGBOX', onclick: async () => {
    out.textContent = 'בודק…';
    const text = box.value.trim();
    try {
      const isUrl = /spotify\.com|spotify:/.test(text);
      const { rows } = await api(isUrl ? '/spotify' : '/spotify/paste', { method: 'POST', body: isUrl ? { url: text } : { text } });
      out.replaceChildren(el('p', { text: `${rows.filter((r) => r.match).length} מתוך ${rows.length} נמצאו ב-BIGBOX` }), ...rows.map(importRow));
    } catch (e) { out.textContent = `שגיאה: ${e.message} (אפשר להדביק את הרשימה ידנית)`; }
  } });
  return el('div', { class: 'card' }, el('h3', { text: '🎧 ייבוא מפלייליסט' }), box, go, out);
}

const toolsCard = el('div', { class: 'card' }, el('div', { class: 'row', style: 'flex-wrap:wrap' },
  el('button', { class: 'btn sun', text: '✨ השלם תשובות שגויות לכל השירים', onclick: async () => { await api('/suggest-all', { method: 'POST', body: {} }); await load(); } }),
  el('button', { class: 'btn alt', text: '🥁 חשב BPM לשירים שחסר להם', onclick: async (e) => {
    const b = e.target; b.disabled = true;
    for (const s of songs.filter((x) => !x.bpm)) { b.textContent = `מחשב ${s.title}…`; await afterAdd(s); }
    await load(); b.textContent = '🥁 חשב BPM לשירים שחסר להם'; b.disabled = false;
  } })));

extraBox.append(spotifyPanel());

app.append(
  el('div', { class: 'top' }, el('b', { text: 'ניהול שירים' }), idxLabel,
    el('button', { class: 'btn sun', onclick: refreshIndex, text: 'רענון אינדקס' }), el('a', { href: '/host', text: 'למסך המנחה' })),
  el('div', { class: 'wrap' },
    el('div', { class: 'card' }, el('h3', { text: '🔎 חיפוש ב-BIGBOX' }), el('div', { class: 'row' }, searchBox), resultsBox),
    extraBox, el('div', { class: 'card' }, dropBox), toolsCard,
    el('div', { class: 'card' }, libTitle, libraryBox)));

load().catch((e) => { libraryBox.replaceChildren(el('p', { class: 'err', text: `לא ניתן לטעון: ${e.message}` })); });
