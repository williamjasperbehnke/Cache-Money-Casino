const { buildDeck, shuffle, draw, cardValue, evaluateFiveCardHand } = require("../../game/cards");

describe("cards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("buildDeck creates 52 unique cards", () => {
    const deck = buildDeck();
    expect(deck.length).toBe(52);
    const unique = new Set(deck.map((card) => `${card.rank}${card.suit}`));
    expect(unique.size).toBe(52);
  });

  it("shuffle returns new array", () => {
    const deck = buildDeck();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const shuffled = shuffle(deck);
    expect(shuffled).not.toBe(deck);
    expect(shuffled.length).toBe(deck.length);
  });

  it("draw removes the first card", () => {
    const deck = [{ rank: "A", suit: "S" }, { rank: "K", suit: "S" }];
    const card = draw(deck);
    expect(card.rank).toBe("A");
    expect(deck.length).toBe(1);
  });

  it("cardValue maps ranks", () => {
    expect(cardValue({ rank: "A" })).toBe(14);
    expect(cardValue({ rank: "K" })).toBe(13);
    expect(cardValue({ rank: "Q" })).toBe(12);
    expect(cardValue({ rank: "J" })).toBe(11);
    expect(cardValue({ rank: "9" })).toBe(9);
  });

  it("evaluateFiveCardHand ranks hands", () => {
    const straightFlush = [
      { rank: "10", suit: "S" },
      { rank: "J", suit: "S" },
      { rank: "Q", suit: "S" },
      { rank: "K", suit: "S" },
      { rank: "A", suit: "S" },
    ];
    expect(evaluateFiveCardHand(straightFlush).rank).toBe(8);

    const fourKind = [
      { rank: "9", suit: "S" },
      { rank: "9", suit: "H" },
      { rank: "9", suit: "D" },
      { rank: "9", suit: "C" },
      { rank: "2", suit: "S" },
    ];
    expect(evaluateFiveCardHand(fourKind).rank).toBe(7);

    const fullHouse = [
      { rank: "7", suit: "S" },
      { rank: "7", suit: "H" },
      { rank: "7", suit: "D" },
      { rank: "2", suit: "C" },
      { rank: "2", suit: "S" },
    ];
    expect(evaluateFiveCardHand(fullHouse).rank).toBe(6);

    const flush = [
      { rank: "2", suit: "H" },
      { rank: "5", suit: "H" },
      { rank: "9", suit: "H" },
      { rank: "J", suit: "H" },
      { rank: "K", suit: "H" },
    ];
    expect(evaluateFiveCardHand(flush).rank).toBe(5);

    const straight = [
      { rank: "A", suit: "H" },
      { rank: "2", suit: "D" },
      { rank: "3", suit: "S" },
      { rank: "4", suit: "C" },
      { rank: "5", suit: "H" },
    ];
    expect(evaluateFiveCardHand(straight).rank).toBe(4);

    const threeKind = [
      { rank: "4", suit: "S" },
      { rank: "4", suit: "H" },
      { rank: "4", suit: "D" },
      { rank: "9", suit: "C" },
      { rank: "2", suit: "S" },
    ];
    expect(evaluateFiveCardHand(threeKind).rank).toBe(3);

    const twoPair = [
      { rank: "8", suit: "S" },
      { rank: "8", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "5", suit: "C" },
      { rank: "K", suit: "S" },
    ];
    expect(evaluateFiveCardHand(twoPair).rank).toBe(2);

    const pair = [
      { rank: "9", suit: "S" },
      { rank: "9", suit: "H" },
      { rank: "2", suit: "D" },
      { rank: "4", suit: "C" },
      { rank: "6", suit: "S" },
    ];
    expect(evaluateFiveCardHand(pair).rank).toBe(1);

    const pairAces = [
      { rank: "A", suit: "S" },
      { rank: "A", suit: "H" },
      { rank: "2", suit: "D" },
      { rank: "4", suit: "C" },
      { rank: "6", suit: "S" },
    ];
    expect(evaluateFiveCardHand(pairAces).label).toMatch(/Aces/);

    const pairQueens = [
      { rank: "Q", suit: "S" },
      { rank: "Q", suit: "H" },
      { rank: "2", suit: "D" },
      { rank: "4", suit: "C" },
      { rank: "6", suit: "S" },
    ];
    expect(evaluateFiveCardHand(pairQueens).label).toMatch(/Queens/);

    const high = [
      { rank: "2", suit: "S" },
      { rank: "5", suit: "H" },
      { rank: "7", suit: "D" },
      { rank: "J", suit: "C" },
      { rank: "K", suit: "S" },
    ];
    expect(evaluateFiveCardHand(high).rank).toBe(0);
  });
});
