const {
  createHoldemState,
  applyHoldemAction,
  applyHoldemFold,
  resolveHoldemShowdown,
  holdemPhaseCommunityCount,
} = require("../../game/holdem");

describe("holdem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holdemPhaseCommunityCount maps phases", () => {
    expect(holdemPhaseCommunityCount("flop")).toBe(3);
    expect(holdemPhaseCommunityCount("river")).toBe(5);
  });

  it("createHoldemState initializes", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    expect(state.player.length).toBe(2);
    expect(state.community.length).toBe(5);
  });

  it("applyHoldemFold ends round", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    const res = applyHoldemFold(state, 80);
    expect(res.state.inRound).toBe(false);
    expect(res.net).toBeLessThan(0);
  });

  it("applyHoldemAction validates betting", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.inRound = false;
    const res = applyHoldemAction(state, 0, 50);
    expect(res.error).toBe("Round not running.");
  });

  it("applyHoldemAction rejects betting when closed", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.phase = "showdown";
    const res = applyHoldemAction(state, 0, 50);
    expect(res.error).toBe("Betting is closed.");
  });

  it("applyHoldemAction rejects raise when short", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.playerBet = 0;
    state.currentBet = 20;
    const res = applyHoldemAction(state, 20, 5);
    expect(res.error).toBe("Not enough credits to raise.");
  });

  it("applyHoldemAction triggers dealer raise when strong", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.dealer = [
      { rank: "A", suit: "S" },
      { rank: "A", suit: "H" },
    ];
    state.playerBet = state.currentBet;
    state.dealerBet = state.currentBet;
    const res = applyHoldemAction(state, 0, 100, () => 0.99);
    expect(res.state.awaitingRaise).toBe(true);
  });

  it("applyHoldemAction handles all-in call", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.currentBet = 50;
    state.playerBet = 0;
    const res = applyHoldemAction(state, 0, 10, () => 0.0);
    expect(res.messages.some((msg) => msg.text.includes("All-in"))).toBe(true);
  });

  it("applyHoldemAction resolves showdown when broke", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    const res = applyHoldemAction(state, 0, 0, () => 0.0);
    expect(res.showdown).toBeTruthy();
  });

  it("applyHoldemAction can trigger dealer fold", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "3", suit: "D" },
    ];
    state.community = [
      { rank: "4", suit: "S" },
      { rank: "7", suit: "C" },
      { rank: "9", suit: "D" },
      { rank: "J", suit: "H" },
      { rank: "Q", suit: "S" },
    ];
    state.playerBet = state.currentBet;
    state.dealerBet = 0;
    const res = applyHoldemAction(state, 0, 50, () => 0.99);
    expect(res.folded).toBe(true);
  });

  it("resolveHoldemShowdown compares hands", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.player = [
      { rank: "A", suit: "S" },
      { rank: "K", suit: "S" },
    ];
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "3", suit: "D" },
    ];
    state.community = [
      { rank: "Q", suit: "S" },
      { rank: "J", suit: "S" },
      { rank: "10", suit: "S" },
      { rank: "5", suit: "C" },
      { rank: "7", suit: "D" },
    ];
    const res = resolveHoldemShowdown(state, 100, []);
    expect(res.net).toBeGreaterThan(0);
    expect(res.showdown.playerLabel).toMatch(/Straight/);
  });

  it("resolveHoldemShowdown handles push", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.player = [
      { rank: "A", suit: "S" },
      { rank: "K", suit: "S" },
    ];
    state.dealer = [
      { rank: "A", suit: "H" },
      { rank: "K", suit: "H" },
    ];
    state.community = [
      { rank: "Q", suit: "D" },
      { rank: "J", suit: "C" },
      { rank: "10", suit: "S" },
      { rank: "2", suit: "C" },
      { rank: "3", suit: "D" },
    ];
    const res = resolveHoldemShowdown(state, 100, []);
    expect(res.net).toBe(0);
  });

  it("applyHoldemAction raises when player raises to call", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.currentBet = 20;
    state.playerBet = 5;
    const res = applyHoldemAction(state, 10, 100, () => 0.0);
    expect(res.balance).toBeLessThan(100);
  });

  it("applyHoldemAction handles awaiting raise with no balance", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.currentBet = 10;
    state.playerBet = 0;
    state.awaitingRaise = true;
    const res = applyHoldemAction(state, 0, 0, () => 0.0);
    expect(res.state.phase).not.toBe("preflop");
  });

  it("applyHoldemAction handles awaiting raise with partial call", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.currentBet = 20;
    state.playerBet = 0;
    state.awaitingRaise = true;
    const res = applyHoldemAction(state, 0, 5, () => 0.0);
    expect(res.messages.some((msg) => msg.text.includes("All-in"))).toBe(true);
  });

  it("applyHoldemAction handles bet with no toCall", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.currentBet = 0;
    state.playerBet = 0;
    const res = applyHoldemAction(state, 10, 100, () => 0.0);
    expect(res.balance).toBeLessThan(100);
  });

  it("applyHoldemAction uses community strength in flop", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.phase = "flop";
    state.dealer = [
      { rank: "A", suit: "S" },
      { rank: "A", suit: "H" },
    ];
    state.community = [
      { rank: "A", suit: "D" },
      { rank: "K", suit: "C" },
      { rank: "Q", suit: "S" },
      { rank: "2", suit: "C" },
      { rank: "3", suit: "D" },
    ];
    state.currentBet = 10;
    state.playerBet = 10;
    state.dealerBet = 0;
    const res = applyHoldemAction(state, 0, 100, () => 0.99);
    expect(res.state).toBeDefined();
  });
  it("applyHoldemAction can proceed with no raise", () => {
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const res = applyHoldemAction(state, 0, 50);
    expect(res.state).toBeDefined();
    expect(res.balance).toBeGreaterThanOrEqual(0);
  });
});
