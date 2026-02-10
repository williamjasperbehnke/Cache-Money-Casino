const { emptyStats, updateStats, computeHighlights } = require("../../lib/stats");

describe("stats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emptyStats returns base structure", () => {
    const stats = emptyStats();
    expect(stats.totals).toEqual({ bets: 0, wins: 0, losses: 0, net: 0 });
    expect(stats.games).toEqual({});
    expect(stats.recent).toEqual([]);
  });

  it("updateStats tracks totals, games, and recent", () => {
    const stats = emptyStats();
    const updated = updateStats(stats, { game: "slots", bet: 50, net: 25, result: "win" });
    expect(updated.totals.bets).toBe(50);
    expect(updated.totals.wins).toBe(1);
    expect(updated.games.slots.net).toBe(25);
    expect(updated.recent[0].game).toBe("slots");
  });

  it("updateStats caps recent to 20", () => {
    let stats = emptyStats();
    for (let i = 0; i < 25; i += 1) {
      stats = updateStats(stats, { game: "roulette", bet: 1, net: -1, result: "loss" });
    }
    expect(stats.recent.length).toBe(20);
  });

  it("computeHighlights selects favorite and best win rate", () => {
    const stats = emptyStats();
    updateStats(stats, { game: "poker", bet: 10, net: 10, result: "win" });
    updateStats(stats, { game: "poker", bet: 10, net: -10, result: "loss" });
    updateStats(stats, { game: "slots", bet: 5, net: 5, result: "win" });
    const highlights = computeHighlights(stats);
    expect(highlights.favorite).toBe("poker");
    expect(highlights.bestWinRate).toMatch(/slots/);
  });

  it("computeHighlights handles empty", () => {
    expect(computeHighlights(null)).toEqual({ favorite: "—", bestWinRate: "—" });
  });
});
