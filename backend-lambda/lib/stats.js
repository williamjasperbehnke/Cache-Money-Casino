const emptyStats = () => ({
  totals: { bets: 0, wins: 0, losses: 0, net: 0 },
  games: {},
  recent: [],
});

const ensureGameStats = (stats, game) => {
  if (!stats.games[game]) {
    stats.games[game] = { bets: 0, wins: 0, losses: 0, net: 0 };
  }
};

const updateStats = (stats, { game, bet, net, result }) => {
  const next = stats || emptyStats();
  ensureGameStats(next, game);
  next.totals.bets += bet;
  if (net > 0) next.totals.wins += 1;
  if (net < 0) next.totals.losses += 1;
  next.totals.net += net;

  const gameStats = next.games[game];
  gameStats.bets += bet;
  if (net > 0) gameStats.wins += 1;
  if (net < 0) gameStats.losses += 1;
  gameStats.net += net;

  next.recent.unshift({
    game,
    bet,
    net,
    result,
    ts: new Date().toISOString(),
  });
  next.recent = next.recent.slice(0, 20);
  return next;
};

const computeHighlights = (stats) => {
  if (!stats) return { favorite: "—", bestWinRate: "—" };
  let favorite = "—";
  let favoritePlays = -1;
  let bestWinRate = 0;
  let bestGame = "—";
  Object.entries(stats.games || {}).forEach(([game, value]) => {
    const plays = (value.wins || 0) + (value.losses || 0);
    if (plays > favoritePlays) {
      favoritePlays = plays;
      favorite = game;
    }
    const totalRounds = value.wins + value.losses;
    const rate = totalRounds ? value.wins / totalRounds : 0;
    if (rate > bestWinRate) {
      bestWinRate = rate;
      bestGame = game;
    }
  });
  return {
    favorite,
    bestWinRate: bestGame === "—" ? "—" : `${bestGame} ${(bestWinRate * 100).toFixed(0)}%`,
  };
};

module.exports = { emptyStats, updateStats, computeHighlights };
