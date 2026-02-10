const { createCrapsState, resolveCrapsRoll } = require("../../game/craps");

describe("craps", () => {
  it("createCrapsState initializes", () => {
    const state = createCrapsState();
    expect(state.point).toBe(0);
    expect(state.inRound).toBe(true);
  });

  it("resolveCrapsRoll validates bets", () => {
    const state = createCrapsState();
    const res = resolveCrapsRoll(state, {}, 100, false, true, () => 0.2);
    expect(res.error).toBe("No bets placed.");
  });

  it("resolveCrapsRoll applies payouts", () => {
    const state = createCrapsState();
    const rng = () => 0.9; // 6 + 6 = 12
    const res = resolveCrapsRoll(state, { pass: 10 }, 100, false, true, rng);
    expect(res.wager).toBe(10);
    expect(res.balance).toBeGreaterThanOrEqual(90);
  });

  it("resolveCrapsRoll handles field payouts", () => {
    const state = createCrapsState();
    const rng = () => 0.0; // 1 + 1 = 2
    const res = resolveCrapsRoll(state, { field: 10 }, 100, false, true, rng);
    expect(res.payout).toBeGreaterThan(0);
  });

  it("resolveCrapsRoll handles field payout on 3", () => {
    const state = createCrapsState();
    let call = 0;
    const rngSeq = () => {
      call += 1;
      return call === 1 ? 0.0 : 0.2;
    };
    const res = resolveCrapsRoll(state, { field: 10 }, 100, false, true, rngSeq);
    expect(res.payout).toBeGreaterThan(0);
  });

  it("resolveCrapsRoll honors table off for hardways", () => {
    const state = createCrapsState();
    const rng = () => 0.2; // 2 + 2 = 4 hard
    const res = resolveCrapsRoll(state, { hardways: { 4: 10 } }, 100, false, false, rng);
    expect(res.payout).toBe(0);
  });

  it("resolveCrapsRoll clears hardways on 7", () => {
    const state = createCrapsState();
    let call = 0;
    const rngSeq = () => {
      call += 1;
      return call === 1 ? 0.32 : 0.83; // 2 + 5 = 7
    };
    const res = resolveCrapsRoll(state, { hardways: { 4: 10 } }, 100, false, true, rngSeq);
    expect(res.state.bets.hardways[4]).toBe(0);
  });

  it("resolveCrapsRoll sets point on come out", () => {
    const state = createCrapsState();
    const rng = () => 0.5; // 4 + 4 = 8
    const res = resolveCrapsRoll(state, { pass: 5 }, 100, false, true, rng);
    expect(res.state.point).toBe(8);
  });

  it("resolveCrapsRoll pays pass on point hit", () => {
    const state = createCrapsState();
    state.point = 6;
    const rng = () => 0.4; // 3 + 3 = 6
    const res = resolveCrapsRoll(state, { pass: 5 }, 100, false, true, rng);
    expect(res.state.point).toBe(0);
    expect(res.payout).toBeGreaterThan(0);
  });

  it("resolveCrapsRoll pays dont on 7 after point", () => {
    const state = createCrapsState();
    state.point = 5;
    let call = 0;
    const rngSeq = () => {
      call += 1;
      return call === 1 ? 0.32 : 0.83; // 2 + 5 = 7
    };
    const res = resolveCrapsRoll(state, { dont: 5 }, 100, false, true, rngSeq);
    expect(res.state.point).toBe(0);
    expect(res.payout).toBeGreaterThan(0);
  });

  it("resolveCrapsRoll pays place bets", () => {
    const state = createCrapsState();
    const rng = () => 0.5; // 4 + 4 = 8
    const res = resolveCrapsRoll(state, { place: { 8: 12 } }, 100, false, true, rng);
    expect(res.payout).toBeGreaterThan(0);
  });

  it("resolveCrapsRoll pays come points", () => {
    const state = createCrapsState();
    state.bets.comePoints[6] = 5;
    const rng = () => 0.4; // 3 + 3 = 6
    const res = resolveCrapsRoll(state, { comePoints: { 6: 5 } }, 100, true, true, rng);
    expect(res.payout).toBeGreaterThan(0);
  });

  it("resolveCrapsRoll resolves come bet loss on 12", () => {
    const state = createCrapsState();
    const rng = () => 0.9; // 6 + 6 = 12
    const res = resolveCrapsRoll(state, { come: 5 }, 100, false, true, rng);
    expect(res.state.bets.come).toBe(0);
  });
  it("resolveCrapsRoll handles come bets to points", () => {
    const state = createCrapsState();
    const rng = () => 0.5; // 4 + 4 = 8
    const res = resolveCrapsRoll(state, { come: 5 }, 100, false, true, rng);
    expect(res.state.bets.comePoints[8]).toBe(5);
  });
});
