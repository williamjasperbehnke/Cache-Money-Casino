const {
  createYahtzeeState,
  applyYahtzeeRoll,
  applyYahtzeeScore,
  scoreTotal,
  availableCategories,
  computeScore,
  CATEGORIES,
} = require("../../game/yahtzee");

describe("yahtzee", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createYahtzeeState initializes", () => {
    const state = createYahtzeeState({ bet: 10 });
    expect(state.bet).toBe(10);
    expect(state.rollsLeft).toBe(3);
  });

  it("applyYahtzeeRoll validates turn and rolls", () => {
    const state = createYahtzeeState({ bet: 10 });
    state.phase = "dealer";
    expect(applyYahtzeeRoll(state).error).toBe("Not your turn.");
  });

  it("applyYahtzeeRoll updates dice", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = createYahtzeeState({ bet: 10 });
    const result = applyYahtzeeRoll(state, [false, false, false, false, false]);
    expect(result.state.dice.length).toBe(5);
  });

  it("applyYahtzeeScore validates category", () => {
    const state = createYahtzeeState({ bet: 10 });
    expect(applyYahtzeeScore(state, "bad").error).toBe("Invalid category.");
  });

  it("scoreTotal and availableCategories", () => {
    const scores = CATEGORIES.reduce((acc, key) => {
      acc[key] = null;
      return acc;
    }, {});
    scores.ones = 3;
    expect(scoreTotal(scores)).toBe(3);
    expect(availableCategories(scores).length).toBe(CATEGORIES.length - 1);
  });

  it("applyYahtzeeScore completes game and returns result", () => {
    const state = createYahtzeeState({ bet: 10 });
    state.dice = [6, 6, 6, 6, 6];
    CATEGORIES.forEach((cat) => {
      state.playerScores[cat] = cat === "yahtzee" ? null : 0;
      state.dealerScores[cat] = cat === "yahtzee" ? null : 0;
    });
    const result = applyYahtzeeScore(state, "yahtzee");
    expect(result.result).toBeTruthy();
    expect(result.payout).toBeDefined();
  });

  it("applyYahtzeeScore handles loss", () => {
    const state = createYahtzeeState({ bet: 10 });
    state.dice = [1, 1, 1, 1, 2];
    CATEGORIES.forEach((cat) => {
      state.playerScores[cat] = cat === "chance" ? null : 0;
      state.dealerScores[cat] = cat === "chance" ? null : 20;
    });
    const result = applyYahtzeeScore(state, "chance");
    expect(result.result).toBe("loss");
    expect(result.payout).toBe(0);
  });

  it("computeScore returns 0 for unknown category", () => {
    expect(computeScore("unknown", [1, 2, 3, 4, 5])).toBe(0);
  });
});
