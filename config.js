import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const defaultMusic =
  process.platform === 'darwin' ? '/Volumes/music'
  : process.platform === 'win32' ? '\\\\BIGBOX2\\music'
  : '/mnt/music';

export const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  musicDir: process.env.MUSIC_DIR || defaultMusic,
  songsDir: path.join(rootDir, 'songs'),
  dataDir: path.join(rootDir, 'data'),
  pin: process.env.MANAGE_PIN || String(1000 + Math.floor(Math.random() * 9000)),
  ladderMs: [1000, 2000, 4000, 8000, 15000],
  points: [100, 80, 60, 40, 20],
  wrongPenalty: 10,
  maxSteps: 5,
  preRoundMs: 5000,
  answerMs: 8000,
  preloadTimeoutMs: 20000,
  ackTimeoutMs: 3000,
  maxPlayers: 40,
};
