const {
  createBlackjackState,
  applyBlackjackStats,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
  resolveBlackjack,
} = require("../../game/blackjack");

describe("blackjack", () => {
  it("createBlackjackState initializes", () => {
    const state = createBlackjackState(10);
    expect(state.hands.length).toBe(1);
    expect(state.dealer.length).toBe(2);
  });

  it("applySplit validates hand", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "8", suit: "S" }, { rank: "8", suit: "H" }]];
    state.deck = [{ rank: "2", suit: "S" }, { rank: "3", suit: "D" }];
    const res = applySplit(state);
    expect(res.state.hands.length).toBe(2);
  });

  it("applySplit errors when invalid", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "8", suit: "S" }, { rank: "9", suit: "H" }]];
    const res = applySplit(state);
    expect(res.error).toBe("Cannot split now.");
  });

  it("applyHit can bust and finish", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "K", suit: "S" }, { rank: "9", suit: "H" }]];
    state.deck = [{ rank: "5", suit: "D" }];
    const res = applyHit(state);
    expect(res.finished).toBe(true);
  });

  it("applyHit continues when not bust", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "5", suit: "S" }, { rank: "6", suit: "H" }]];
    state.deck = [{ rank: "2", suit: "D" }];
    const res = applyHit(state);
    expect(res.finished).toBe(false);
  });

  it("applyStand resolves round", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "10", suit: "S" }, { rank: "7", suit: "H" }]];
    state.dealer = [{ rank: "6", suit: "S" }, { rank: "9", suit: "D" }];
    state.deck = [{ rank: "2", suit: "C" }, { rank: "3", suit: "H" }];
    const res = applyStand(state);
    expect(res.finished).toBe(true);
  });

  it("applyStand advances when multiple hands", () => {
    const state = createBlackjackState(10);
    state.hands = [
      [{ rank: "10", suit: "S" }, { rank: "7", suit: "H" }],
      [{ rank: "9", suit: "D" }, { rank: "8", suit: "C" }],
    ];
    const res = applyStand(state);
    expect(res.finished).toBe(false);
    expect(res.state.activeHand).toBe(1);
  });

  it("applyDouble doubles bet", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "5", suit: "S" }, { rank: "6", suit: "H" }]];
    state.deck = [
      { rank: "2", suit: "D" },
      { rank: "3", suit: "C" },
      { rank: "4", suit: "S" },
      { rank: "5", suit: "H" },
    ];
    const res = applyDouble(state);
    expect(res.state.bets[0]).toBe(20);
  });

  it("handles ace totals during stand", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "A", suit: "S" }, { rank: "9", suit: "H" }]];
    state.dealer = [{ rank: "9", suit: "D" }, { rank: "7", suit: "C" }];
    state.deck = [{ rank: "2", suit: "C" }, { rank: "3", suit: "H" }];
    const res = applyStand(state);
    expect(res.finished).toBe(true);
  });

  it("handles multiple aces without bust", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "A", suit: "S" }, { rank: "A", suit: "H" }]];
    state.dealer = [{ rank: "9", suit: "D" }, { rank: "7", suit: "C" }];
    state.deck = [{ rank: "9", suit: "S" }];
    const res = applyHit(state);
    expect(res.finished).toBe(false);
  });

  it("applyDouble busts and returns messages", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "K", suit: "S" }, { rank: "9", suit: "H" }]];
    state.deck = [
      { rank: "5", suit: "D" },
      { rank: "2", suit: "C" },
      { rank: "3", suit: "H" },
    ];
    const res = applyDouble(state);
    expect(res.finished).toBe(true);
    expect(res.messages.length).toBeGreaterThan(0);
  });

  it("applyDouble continues when multiple hands", () => {
    const state = createBlackjackState(10);
    state.hands = [
      [{ rank: "5", suit: "S" }, { rank: "6", suit: "H" }],
      [{ rank: "9", suit: "D" }, { rank: "8", suit: "C" }],
    ];
    state.bets = [10, 10];
    state.doubled = [false, false];
    state.busted = [false, false];
    state.activeHand = 0;
    state.deck = [{ rank: "2", suit: "D" }];
    const res = applyDouble(state);
    expect(res.finished).toBe(false);
  });

  it("resolveBlackjack marks busted losses", () => {
    const state = createBlackjackState(10);
    state.hands = [[{ rank: "K", suit: "S" }, { rank: "9", suit: "H" }, { rank: "5", suit: "D" }]];
    state.bets = [10];
    state.busted = [true];
    const result = resolveBlackjack(state, { omitBusted: false });
    expect(result.outcomes[0].result).toBe("loss");
  });

  it("applyBlackjackStats updates user", () => {
    const user = { stats: null };
    const state = createBlackjackState(10);
    const outcomes = [{ index: 0, net: 10 }];
    applyBlackjackStats(user, state, outcomes);
    expect(user.stats).toBeTruthy();
  });

  it("applySplit rejects when split already used", () => {
    const state = createBlackjackState(10);
    state.splitUsed = true;
    const res = applySplit(state);
    expect(res.error).toBe("Cannot split now.");
  });
});
