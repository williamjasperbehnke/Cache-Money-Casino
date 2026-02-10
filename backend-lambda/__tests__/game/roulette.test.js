const {
  normalizeBets,
  totalBet,
  spinOutcome,
  computePayout,
  applyRandomBets,
} = require("../../game/roulette");

describe("roulette", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes bets and totals", () => {
    const bets = normalizeBets({ numbers: { 1: 10 }, colors: { red: 5 } });
    expect(bets.parities).toEqual({});
    expect(totalBet(bets)).toBe(15);
  });

  it("spinOutcome uses roulette order", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(spinOutcome()).toBe(0);
  });

  it("computePayout handles number, color, parity", () => {
    const bets = normalizeBets({
      numbers: { 0: 2 },
      colors: { black: 1 },
      parities: { even: 1 },
    });
    const payout = computePayout(bets, 0);
    expect(payout.payout).toBeGreaterThan(0);
    expect(payout.win).toBe(true);
  });

  it("computePayout handles red numbers", () => {
    const bets = normalizeBets({
      colors: { red: 5 },
    });
    const payout = computePayout(bets, 1);
    expect(payout.payout).toBeGreaterThan(0);
  });

  it("applyRandomBets respects spend and max per slot", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = applyRandomBets({
      bets: { numbers: {}, colors: {}, parities: {} },
      chipValues: [5],
      maxPerSlot: 5,
      spend: 10,
      zones: [{ bucket: "colors", key: "red" }],
    });
    expect(result.spent).toBeLessThanOrEqual(10);
    expect(result.nextBets.colors.red).toBeGreaterThanOrEqual(5);
  });

  it("applyRandomBets skips when amount exceeds spend or zone missing", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = applyRandomBets({
      bets: { numbers: {}, colors: {}, parities: {} },
      chipValues: [10],
      maxPerSlot: 5,
      spend: 5,
      zones: [null],
    });
    expect(result.spent).toBe(0);
  });
});
