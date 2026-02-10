const {
  createPokerState,
  applyPokerBet,
  applyPokerDraw,
  applyPokerCall,
  applyPokerFold,
  applyPokerReveal,
} = require("../../game/poker");

describe("poker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createPokerState sets up hands", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    expect(state.player.length).toBe(5);
    expect(state.dealer.length).toBe(5);
  });

  it("applyPokerFold ends round", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    const res = applyPokerFold(state, 50);
    expect(res.state.inRound).toBe(false);
    expect(res.net).toBeLessThan(0);
  });

  it("applyPokerCall validates balance", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    state.currentBet = 20;
    state.playerBet = 0;
    const res = applyPokerCall(state, 5);
    expect(res.error).toBe("Not enough credits.");
  });

  it("applyPokerBet can trigger dealer raise", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    state.dealer = [
      { rank: "A", suit: "S" },
      { rank: "K", suit: "S" },
      { rank: "Q", suit: "S" },
      { rank: "J", suit: "S" },
      { rank: "10", suit: "S" },
    ];
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const res = applyPokerBet(state, 0, 100);
    expect(res.state.awaitingRaise).toBe(true);
  });

  it("applyPokerBet handles calling to match bet", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    state.currentBet = 20;
    state.playerBet = 5;
    const res = applyPokerBet(state, 0, 100);
    expect(res.balance).toBeLessThan(100);
  });

  it("applyPokerBet can trigger dealer fold", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet2",
    });
    state.dealer = [
      { rank: "2", suit: "S" },
      { rank: "5", suit: "H" },
      { rank: "7", suit: "D" },
      { rank: "9", suit: "C" },
      { rank: "J", suit: "S" },
    ];
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const res = applyPokerBet(state, 5, 100);
    expect(res.result).toBe("win");
    expect(res.state.inRound).toBe(false);
  });

  it("applyPokerDraw rejects when not in discard phase", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    const res = applyPokerDraw(state, [0], 100);
    expect(res.error).toBe("Not in discard phase.");
  });

  it("applyPokerDraw advances and can reveal", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "discard2",
    });
    const res = applyPokerDraw(state, [0, 1], 100);
    expect(res.dealerDiscarded).toBeGreaterThanOrEqual(0);
  });

  it("applyPokerDraw keeps pair for dealer", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "discard1",
    });
    state.dealer = [
      { rank: "9", suit: "S" },
      { rank: "9", suit: "H" },
      { rank: "2", suit: "D" },
      { rank: "4", suit: "C" },
      { rank: "6", suit: "S" },
    ];
    const res = applyPokerDraw(state, [0], 100);
    expect(res.dealerDiscarded).toBeGreaterThanOrEqual(0);
  });
  it("applyPokerReveal compares hands", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "reveal",
    });
    state.player = [
      { rank: "10", suit: "S" },
      { rank: "J", suit: "S" },
      { rank: "Q", suit: "S" },
      { rank: "K", suit: "S" },
      { rank: "A", suit: "S" },
    ];
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "7", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "J", suit: "H" },
    ];
    const res = applyPokerReveal(state, 100);
    expect(res.net).toBeGreaterThan(0);
    expect(res.result).toBe(1);
  });

  it("applyPokerReveal prefers higher pair over kickers", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "reveal",
    });
    state.playerPaid = 10;
    state.pot = 20;
    state.player = [
      { rank: "2", suit: "S" },
      { rank: "2", suit: "H" },
      { rank: "A", suit: "D" },
      { rank: "K", suit: "C" },
      { rank: "Q", suit: "S" },
    ];
    state.dealer = [
      { rank: "K", suit: "S" },
      { rank: "K", suit: "H" },
      { rank: "3", suit: "D" },
      { rank: "4", suit: "C" },
      { rank: "5", suit: "S" },
    ];
    const res = applyPokerReveal(state, 100);
    expect(res.result).toBe(-1);
  });

  it("applyPokerReveal exposes winning indexes for quads", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "reveal",
    });
    state.player = [
      { rank: "9", suit: "S" },
      { rank: "9", suit: "H" },
      { rank: "9", suit: "D" },
      { rank: "9", suit: "C" },
      { rank: "2", suit: "S" },
    ];
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "7", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "J", suit: "H" },
    ];
    const res = applyPokerReveal(state, 100);
    expect(res.playerIndexes.length).toBe(4);
  });

  it("applyPokerReveal exposes winning indexes for trips", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "reveal",
    });
    state.player = [
      { rank: "4", suit: "S" },
      { rank: "4", suit: "H" },
      { rank: "4", suit: "D" },
      { rank: "9", suit: "C" },
      { rank: "2", suit: "S" },
    ];
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "7", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "J", suit: "H" },
    ];
    const res = applyPokerReveal(state, 100);
    expect(res.playerIndexes.length).toBe(3);
  });

  it("applyPokerReveal exposes winning indexes for two pair", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "reveal",
    });
    state.player = [
      { rank: "8", suit: "S" },
      { rank: "8", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "5", suit: "C" },
      { rank: "K", suit: "S" },
    ];
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "7", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "J", suit: "H" },
    ];
    const res = applyPokerReveal(state, 100);
    expect(res.playerIndexes.length).toBe(4);
  });

  it("applyPokerCall can advance to reveal", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet3",
    });
    const res = applyPokerCall(state, 100);
    expect(res.result).toBeDefined();
  });

  it("applyPokerReveal ties on equal hands", () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "reveal",
    });
    state.playerPaid = 10;
    state.pot = 20;
    const hand = [
      { rank: "A", suit: "S" },
      { rank: "K", suit: "H" },
      { rank: "Q", suit: "D" },
      { rank: "J", suit: "C" },
      { rank: "9", suit: "S" },
    ];
    state.player = hand;
    state.dealer = hand;
    const res = applyPokerReveal(state, 100);
    expect(res.result).toBe(0);
  });
});
