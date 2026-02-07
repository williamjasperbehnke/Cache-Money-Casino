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

module.exports = {
  buildDeck,
  shuffle,
  draw,
};
