import { realTimers } from './game.js';

const NAMES = ['בוט אורי', 'בוט דנה', 'בוט נועה', 'בוט גל', 'בוט שירה', 'בוט יעל', 'בוט תמר', 'בוט רוני', 'בוט ליה', 'בוט מיה', 'בוט ענבר', 'בוט הילה', 'בוט אלה', 'בוט נטע'];
const CHANCE = [0.1, 0.25, 0.5, 0.7, 0.85];

export class BotRunner {
  constructor(game, { timers = realTimers, rng = Math.random } = {}) {
    this.game = game; this.timers = timers; this.rng = rng;
    this.ids = new Set(); this.pending = new Set(); this.count = 0;
    game.on('step_open', ({ step }) => this.onStep(step));
  }

  spawn(n) {
    for (let i = 0; i < n; i++) {
      const r = this.game.join(NAMES[this.count++ % NAMES.length]);
      if (!r.ok) break;
      r.player.bot = true;
      this.ids.add(r.player.id);
    }
    this.game.changed();
  }

  clear() {
    for (const h of this.pending) this.timers.clear(h);
    this.pending.clear();
    for (const id of this.ids) this.game.kick(id);
    this.ids.clear();
  }

  onStep(step) {
    for (const id of this.ids) {
      if (this.rng() > (CHANCE[step] ?? 0.9)) continue;
      const delay = 500 + this.rng() * 5000;
      const h = this.timers.set(() => {
        this.pending.delete(h);
        const g = this.game; const r = g.round;
        if (!r || g.phase !== 'open' || r.step !== step) return;
        const right = this.rng() < 0.6;
        g.answer(id, right ? r.correctIndex : (r.correctIndex + 1 + Math.floor(this.rng() * 3)) % 4);
      }, delay);
      this.pending.add(h);
    }
  }
}
