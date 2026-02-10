const {
  createMemoryState,
  applyMemoryFlip,
  finalizeMemoryGame,
  computeMultiplier,
} = require("../../game/memory");

describe("memory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createMemoryState builds deck", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2 });
    expect(state.deck.length).toBe(4);
    expect(state.inRound).toBe(true);
  });

  it("applyMemoryFlip validates inputs", () => {
    const res = applyMemoryFlip(null, 0);
    expect(res.error).toBe("No active game.");
  });

  it("applyMemoryFlip errors on empty deck", () => {
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2, rng: () => 0 });
    state.deck = [];
    const res = applyMemoryFlip(state, 0);
    expect(res.error).toBe("No deck.");
  });

  it("applyMemoryFlip handles missing arrays", () => {
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2, rng: () => 0 });
    state.revealed = null;
    state.matched = null;
    state.flipped = null;
    const res = applyMemoryFlip(state, 0);
    expect(res.state.revealed.length).toBe(4);
  });
  it("applyMemoryFlip rejects invalid index", () => {
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2, rng: () => 0 });
    const res = applyMemoryFlip(state, 99);
    expect(res.error).toBe("Invalid card.");
  });

  it("applyMemoryFlip matches pairs", () => {
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2, rng: () => 0 });
    state.deck = ["A", "A", "B", "B"];
    let res = applyMemoryFlip(state, 0);
    res = applyMemoryFlip(res.state, 1);
    expect(res.matched).toBe(true);
    expect(res.state.matches).toBe(1);
  });

  it("applyMemoryFlip clears mismatched revealed cards", () => {
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2, rng: () => 0 });
    state.deck = ["A", "B", "A", "B"];
    let res = applyMemoryFlip(state, 0);
    res = applyMemoryFlip(res.state, 1);
    expect(res.state.flipped.length).toBe(2);
    res = applyMemoryFlip(res.state, 2);
    expect(res.state.revealed[0]).toBe(false);
    expect(res.state.revealed[1]).toBe(false);
  });

  it("applyMemoryFlip returns early when already revealed", () => {
    const state = createMemoryState({ bet: 10, rows: 2, cols: 2, rng: () => 0 });
    state.deck = ["A", "A", "B", "B"];
    let res = applyMemoryFlip(state, 0);
    res = applyMemoryFlip(res.state, 0);
    expect(res.state.revealed[0]).toBe(true);
  });

  it("finalizeMemoryGame computes payout", () => {
    const state = { bet: 10, deck: Array(4).fill("A"), misses: 0 };
    const result = finalizeMemoryGame(state);
    expect(result.payout).toBeGreaterThan(0);
  });

  it("finalizeMemoryGame handles missing deck", () => {
    const result = finalizeMemoryGame({ bet: 5, misses: 3 });
    expect(result.payout).toBeGreaterThanOrEqual(0);
  });

  it("computeMultiplier floors penalties", () => {
    expect(computeMultiplier(0, 6)).toBeGreaterThan(0);
    expect(computeMultiplier(50, 6)).toBeGreaterThan(0);
  });
});
