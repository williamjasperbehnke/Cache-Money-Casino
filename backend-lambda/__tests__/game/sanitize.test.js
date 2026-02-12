const { sanitizeState } = require("../../game/sanitize");

describe("sanitize", () => {
  it("sanitizes blackjack dealer and removes deck", () => {
    const state = {
      deck: [1, 2],
      dealer: [{ rank: "A", suit: "S" }, { rank: "9", suit: "H" }],
      revealDealer: false,
    };
    const sanitized = sanitizeState("blackjack", state);
    expect(sanitized.deck).toBeUndefined();
    expect(sanitized.dealer[0].rank).toBe("?");
  });

  it("returns state when null", () => {
    expect(sanitizeState("blackjack", null)).toBeNull();
  });

  it("reveals dealer when blackjack revealDealer is true", () => {
    const state = {
      deck: [1, 2],
      dealer: [{ rank: "A", suit: "S" }, { rank: "9", suit: "H" }],
      revealDealer: true,
    };
    const sanitized = sanitizeState("blackjack", state);
    expect(sanitized.dealer[0].rank).toBe("A");
  });

  it("sanitizes poker dealer until reveal", () => {
    const state = { deck: [1], dealer: [{ rank: "A", suit: "S" }], phase: "bet1" };
    const sanitized = sanitizeState("poker", state);
    expect(sanitized.dealer[0].rank).toBe("?");
  });

  it("sanitizes poker dealer on reveal", () => {
    const state = { deck: [1], dealer: [{ rank: "A", suit: "S" }], phase: "reveal" };
    const sanitized = sanitizeState("poker", state);
    expect(sanitized.dealer[0].rank).toBe("A");
  });

  it("sanitizes holdem community and dealer", () => {
    const state = {
      deck: [1],
      community: [
        { rank: "A", suit: "S" },
        { rank: "K", suit: "S" },
        { rank: "Q", suit: "S" },
        { rank: "J", suit: "S" },
        { rank: "10", suit: "S" },
      ],
      dealer: [{ rank: "2", suit: "H" }, { rank: "3", suit: "D" }],
      phase: "flop",
    };
    const sanitized = sanitizeState("holdem", state);
    expect(sanitized.community.length).toBe(3);
    expect(sanitized.dealer[0].rank).toBe("?");
  });

  it("sanitizes holdem dealer on showdown", () => {
    const state = {
      deck: [1],
      community: [{ rank: "A", suit: "S" }],
      dealer: [{ rank: "2", suit: "H" }],
      phase: "showdown",
    };
    const sanitized = sanitizeState("holdem", state);
    expect(sanitized.dealer[0].rank).toBe("2");
  });

  it("sanitizes memory deck into cards", () => {
    const state = {
      deck: ["A", "B"],
      revealed: [true, false],
      matched: [false, true],
    };
    const sanitized = sanitizeState("memory", state);
    expect(sanitized.cards.length).toBe(2);
    expect(sanitized.deck).toBeUndefined();
  });

  it("sanitizes memory with missing arrays", () => {
    const state = { deck: ["A"] };
    const sanitized = sanitizeState("memory", state);
    expect(sanitized.cards.length).toBe(1);
  });

  it("sanitizes holdem-multi by removing deck", () => {
    const state = {
      game: "holdem-multi",
      deck: [{ rank: "A", suit: "S" }],
      players: [
        { id: "p1", cards: [{ rank: "A", suit: "S" }, { rank: "K", suit: "S" }] },
        { id: "p2", cards: [{ rank: "Q", suit: "H" }, { rank: "J", suit: "H" }] },
      ],
      community: [{ rank: "K", suit: "H" }],
    };
    const sanitized = sanitizeState("holdem-multi", state, "p1");
    expect(sanitized.deck).toBeUndefined();
    expect(sanitized.community?.length).toBe(1);
    expect(sanitized.players?.[0]?.cards?.[0]?.rank).toBe("A");
    expect(sanitized.players?.[1]?.cards?.[0]?.rank).toBe("?");
  });
});
