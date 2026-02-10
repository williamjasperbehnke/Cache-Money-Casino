const { spinSlots } = require("../../game/slots");

describe("slots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates bet and balance", () => {
    expect(spinSlots(0, 100).error).toBe("Invalid bet.");
    expect(spinSlots(10, 5).error).toBe("Not enough credits.");
  });

  it("pays out on three of a kind", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.01);
    const result = spinSlots(10, 100);
    expect(result.profit).toBeGreaterThan(0);
    expect(result.payout).toBeGreaterThan(0);
  });

  it("handles wipe symbol", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.75);
    const result = spinSlots(10, 100);
    expect(result.wipeBalance).toBe(true);
    expect(result.nextBalance).toBe(0);
  });

  it("pays on any two of a kind", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.5);
    const result = spinSlots(10, 100);
    expect(result.outcome.hasTwoKind).toBe(true);
    expect(result.payout).toBeGreaterThan(0);
  });

  it("handles two bomb symbols with no payout", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.1);
    const result = spinSlots(10, 100);
    expect(result.outcome.hasTwoKind).toBe(true);
    expect(result.profit).toBe(-10);
    expect(result.payout).toBe(0);
  });

  it("two of a kind when first and last match", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.11)
      .mockReturnValueOnce(0.01);
    const result = spinSlots(10, 100);
    expect(result.outcome.hasTwoKind).toBe(true);
    expect(result.outcome.twoSymbol).toBe(result.symbols[0]);
  });
});
