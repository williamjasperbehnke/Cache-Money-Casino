const {
  isRoundClearPending,
  clearCompletedRound,
} = require("../../game/blackjack");

describe("blackjack round clear", () => {
  it("reports pending clear window based on roundClearAt", () => {
    const state = {
      phase: "complete",
      roundClearAt: new Date(Date.now() + 2500).toISOString(),
    };
    expect(isRoundClearPending(state)).toBe(true);
    expect(isRoundClearPending(state, Date.now() + 3000)).toBe(false);
  });

  it("clears completed hand data but preserves standing bet amount", () => {
    const state = {
      phase: "complete",
      roundClearAt: new Date(Date.now() + 2500).toISOString(),
      revealDealer: true,
      settled: true,
      dealer: [{ rank: "K", suit: "S" }, { rank: "7", suit: "D" }],
      players: [
        {
          id: "p1",
          status: "done",
          betAmount: 25,
          hands: [[{ rank: "K", suit: "H" }, { rank: "9", suit: "C" }]],
          bets: [25],
          doubled: [false],
          busted: [false],
          activeHand: 0,
          splitUsed: false,
          total: 19,
          lastResult: "win",
          lastOutcomes: [{ index: 0, result: "win", net: 25 }],
          lastPayout: 50,
        },
      ],
    };

    const changed = clearCompletedRound(state);
    expect(changed).toBe(true);
    expect(state.phase).toBe("lobby");
    expect(state.roundClearAt).toBeNull();
    expect(state.revealDealer).toBe(false);
    expect(state.settled).toBe(false);
    expect(state.dealer).toEqual([]);
    expect(state.players[0].betAmount).toBe(25);
    expect(state.players[0].status).toBe("waiting");
    expect(state.players[0].hands).toEqual([]);
    expect(state.players[0].bets).toEqual([]);
    expect(state.players[0].lastOutcomes).toEqual([]);
  });
});
