const {
  createHoldemMultiState,
  addPlayer,
  startRound,
  applyCheck,
  applyCall,
  applyRaise,
  clearCompletedRound,
} = require("../../game/holdem_multi");

describe("holdem_multi", () => {
  it("rotates button and blinds each round", () => {
    const state = createHoldemMultiState({ roomId: "r1", host: "Host", hostId: "p1" });
    addPlayer(state, { id: "p1", username: "A" });
    addPlayer(state, { id: "p2", username: "B" });
    addPlayer(state, { id: "p3", username: "C" });
    state.players.forEach((p) => {
      p.betAmount = 100;
    });

    const first = startRound(state);
    expect(first.error).toBeUndefined();
    expect(state.buttonIndex).toBe(0);
    expect(state.smallBlindIndex).toBe(1);
    expect(state.bigBlindIndex).toBe(2);

    state.phase = "showdown";
    clearCompletedRound(state);

    const second = startRound(state);
    expect(second.error).toBeUndefined();
    expect(state.buttonIndex).toBe(1);
    expect(state.smallBlindIndex).toBe(2);
    expect(state.bigBlindIndex).toBe(0);
  });

  it("settles side pots when short stack wins only main pot", () => {
    const state = createHoldemMultiState({ roomId: "r2", host: "Host", hostId: "p1" });
    state.phase = "river";
    state.inRound = true;
    state.settled = false;
    state.currentBet = 0;
    state.pot = 250;

    state.community = [
      { rank: "2", suit: "H" },
      { rank: "3", suit: "D" },
      { rank: "4", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "K", suit: "D" },
    ];

    state.players = [
      {
        id: "p1",
        username: "Short",
        status: "playing",
        cards: [
          { rank: "5", suit: "H" },
          { rank: "6", suit: "C" },
        ],
        folded: false,
        allIn: true,
        acted: true,
        stack: 0,
        roundBet: 0,
        committed: 50,
        betAmount: 50,
      },
      {
        id: "p2",
        username: "Deep1",
        status: "playing",
        cards: [
          { rank: "K", suit: "H" },
          { rank: "K", suit: "S" },
        ],
        folded: false,
        allIn: true,
        acted: true,
        stack: 0,
        roundBet: 0,
        committed: 100,
        betAmount: 100,
      },
      {
        id: "p3",
        username: "Deep2",
        status: "playing",
        cards: [
          { rank: "Q", suit: "H" },
          { rank: "Q", suit: "S" },
        ],
        folded: false,
        allIn: false,
        acted: false,
        stack: 1,
        roundBet: 0,
        committed: 100,
        betAmount: 101,
      },
    ];

    state.turnIndex = 2;

    const result = applyCheck(state, "p3");
    expect(result.error).toBeUndefined();
    expect(state.phase).toBe("showdown");
    expect(state.settled).toBe(true);
    expect(Array.isArray(state.potBreakdown)).toBe(true);
    expect(state.potBreakdown.length).toBe(2);
    expect(state.potBreakdown[0]?.label).toBe("Main Pot");
    expect(state.potBreakdown[1]?.label).toBe("Side Pot 1");

    const p1 = state.players[0];
    const p2 = state.players[1];
    const p3 = state.players[2];

    expect(p1.lastPayout).toBe(150);
    expect(p2.lastPayout).toBe(100);
    expect(p3.lastPayout).toBe(1);
    expect(Array.isArray(p1.bestIndexes)).toBe(true);
    expect(p1.bestIndexes.length).toBeGreaterThan(0);
  });

  it("advances turn after each action", () => {
    const state = createHoldemMultiState({ roomId: "r3", host: "Host", hostId: "p1" });
    addPlayer(state, { id: "p1", username: "A" });
    addPlayer(state, { id: "p2", username: "B" });
    addPlayer(state, { id: "p3", username: "C" });

    const started = startRound(state, { p1: 100, p2: 100, p3: 100 });
    expect(started.error).toBeUndefined();
    expect(state.turnIndex).toBe(0);

    const acted = applyCall(state, "p1");
    expect(acted.error).toBeUndefined();
    expect(state.turnIndex).toBe(1);
  });

  it("allows raise when call portion already satisfies most of minimum", () => {
    const state = createHoldemMultiState({ roomId: "r4", host: "Host", hostId: "p1" });
    addPlayer(state, { id: "p1", username: "A" });
    addPlayer(state, { id: "p2", username: "B" });
    addPlayer(state, { id: "p3", username: "C" });
    const started = startRound(state, { p1: 100, p2: 100, p3: 100 });
    expect(started.error).toBeUndefined();
    expect(state.currentBet).toBe(10);
    expect(state.turnIndex).toBe(0);

    const invalid = applyRaise(state, "p1", 5);
    expect(invalid.error).toBe("Minimum raise is $20.");

    const raised = applyRaise(state, "p1", 10);
    expect(raised.error).toBeUndefined();
    expect(state.currentBet).toBe(20);
  });

  it("enforces minimum raise correctly after prior raises", () => {
    const state = createHoldemMultiState({ roomId: "r5", host: "Host", hostId: "p1" });
    addPlayer(state, { id: "p1", username: "A" });
    addPlayer(state, { id: "p2", username: "B" });
    addPlayer(state, { id: "p3", username: "C" });
    const started = startRound(state, { p1: 200, p2: 200, p3: 200 });
    expect(started.error).toBeUndefined();

    const firstRaise = applyRaise(state, "p1", 10);
    expect(firstRaise.error).toBeUndefined();
    expect(state.currentBet).toBe(20);

    expect(state.turnIndex).toBe(1);
    const badReRaise = applyRaise(state, "p2", 5);
    expect(badReRaise.error).toBe("Minimum raise is $25.");

    const goodReRaise = applyRaise(state, "p2", 10);
    expect(goodReRaise.error).toBeUndefined();
    expect(state.currentBet).toBe(30);
  });

  it("marks loser as loss even when they have uncommitted stack refunded", () => {
    const state = createHoldemMultiState({ roomId: "r6", host: "Host", hostId: "p1" });
    state.phase = "river";
    state.inRound = true;
    state.settled = false;
    state.currentBet = 0;
    state.pot = 100;
    state.community = [
      { rank: "2", suit: "H" },
      { rank: "3", suit: "D" },
      { rank: "7", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "K", suit: "D" },
    ];
    state.players = [
      {
        id: "p1",
        username: "Winner",
        status: "playing",
        cards: [
          { rank: "A", suit: "H" },
          { rank: "A", suit: "C" },
        ],
        folded: false,
        allIn: false,
        acted: false,
        stack: 50,
        roundBet: 0,
        committed: 50,
        betAmount: 100,
      },
      {
        id: "p2",
        username: "Loser",
        status: "playing",
        cards: [
          { rank: "Q", suit: "H" },
          { rank: "J", suit: "C" },
        ],
        folded: false,
        allIn: true,
        acted: true,
        stack: 0,
        roundBet: 0,
        committed: 50,
        betAmount: 50,
      },
    ];
    state.turnIndex = 0;

    const result = applyCheck(state, "p1");
    expect(result.error).toBeUndefined();
    expect(state.phase).toBe("showdown");
    expect(state.players[0].lastResult).toBe("win");
    expect(state.players[1].lastResult).toBe("loss");
  });
});
