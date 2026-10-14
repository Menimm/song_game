export class FakeTimers {
  constructor() { this.t = 0; this.q = []; this.n = 1; }
  now = () => this.t;
  set = (fn, ms) => { const id = this.n++; this.q.push({ id, at: this.t + ms, fn }); return id; };
  clear = (id) => { this.q = this.q.filter((x) => x.id !== id); };
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.q[0];
      if (!next || next.at > end) break;
      this.q.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

export const SONGS = ['A', 'B', 'C', 'D', 'E', 'F'].map((x, i) => ({
  id: `s${i}`, title: `Song ${x}`, artist: `Artist ${x}`, file: `s${i}.mp3`, offsetMs: 500,
  hook: '', art: null, distractors: [],
}));
SONGS[0].distractors = [
  { title: 'Decoy 1', artist: 'X' }, { title: 'Decoy 2', artist: 'Y' }, { title: 'Decoy 3', artist: 'Z' },
];
