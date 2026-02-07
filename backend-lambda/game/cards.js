const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const BJ_SUITS = ["♠", "♥", "♦", "♣"];

const buildDeck = () => {
  const deck = [];
  BJ_SUITS.forEach((suit) => {
    BJ_RANKS.forEach((rank) => {
      deck.push({ rank, suit });
    });
  });
  return deck;
};

const shuffle = (deck) => {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const draw = (deck) => deck.shift();

const cardValue = (card) => {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
};

const valueLabel = (value) => {
  if (value === 14) return "Aces";
  if (value === 13) return "Kings";
  if (value === 12) return "Queens";
  if (value === 11) return "Jacks";
  return `${value}s`;
};

const evaluateFiveCardHand = (cards) => {
  const values = cards.map((card) => cardValue(card)).sort((a, b) => a - b);
  const counts = {};
  const suitsCount = {};
  cards.forEach((card) => {
    const value = cardValue(card);
    counts[value] = (counts[value] || 0) + 1;
    suitsCount[card.suit] = (suitsCount[card.suit] || 0) + 1;
  });

  const isFlush = Object.values(suitsCount).some((count) => count === 5);
  const isWheel = values.toString() === "2,3,4,5,14";
  const isStraight =
    values.every((value, index) => (index === 0 ? true : value === values[index - 1] + 1)) ||
    isWheel;
  const straightValues = isWheel ? [5, 4, 3, 2, 1] : [...values];
  const sortedCounts = Object.values(counts).sort((a, b) => b - a);

  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (isStraight && isFlush) return { rank: 8, label: "Straight Flush", values: straightValues };
  if (sortedCounts[0] === 4) {
    const quad = byCount.find((entry) => entry.count === 4)?.value;
    return { rank: 7, label: `Four of a Kind (${valueLabel(quad)})`, values };
  }
  if (sortedCounts[0] === 3 && sortedCounts[1] === 2) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return {
      rank: 6,
      label: `Full House (${valueLabel(trips)} over ${valueLabel(pair)})`,
      values,
    };
  }
  if (isFlush) return { rank: 5, label: "Flush", values };
  if (isStraight) return { rank: 4, label: "Straight", values: straightValues };
  if (sortedCounts[0] === 3) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    return { rank: 3, label: `Three of a Kind (${valueLabel(trips)})`, values };
  }
  if (sortedCounts[0] === 2 && sortedCounts[1] === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return {
      rank: 2,
      label: `Two Pair (${valueLabel(pairs[0])} & ${valueLabel(pairs[1])})`,
      values,
    };
  }
  if (sortedCounts[0] === 2) {
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return { rank: 1, label: `Pair of ${valueLabel(pair)}`, values };
  }
  return { rank: 0, label: "High Card", values };
};

module.exports = {
  buildDeck,
  shuffle,
  draw,
  cardValue,
  evaluateFiveCardHand,
};
