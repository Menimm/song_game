export function pointsForStep(step, points) {
  if (!Number.isInteger(step) || step < 0) throw new RangeError(`bad step ${step}`);
  return points[Math.min(step, points.length - 1)];
}

export function applyWrong(score, penalty) {
  return Math.max(0, score - penalty);
}

export function rankPlayers(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'he'));
  let lastScore = null;
  let lastRank = 0;
  return sorted.map((p, i) => {
    if (p.score !== lastScore) {
      lastRank = i + 1;
      lastScore = p.score;
    }
    return { ...p, rank: lastRank };
  });
}
