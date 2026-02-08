const DEFAULT_ROWS = 4;
const DEFAULT_COLS = 6;
const MEMORY_SYMBOLS = [
  "🍒",
  "🍋",
  "🔔",
  "⭐",
  "💎",
  "🍇",
  "🍀",
  "🪙",
  "🍉",
  "🎲",
  "🎯",
  "🧩",
];

const shuffle = (cards, rng = Math.random) => {
  const deck = cards.slice();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const buildDeck = (rows = DEFAULT_ROWS, cols = DEFAULT_COLS, rng = Math.random) => {
  const total = rows * cols;
  const pairs = Math.floor(total / 2);
  const symbols = MEMORY_SYMBOLS.slice(0, pairs);
  const deck = [];
  symbols.forEach((symbol) => {
    deck.push(symbol, symbol);
  });
  return shuffle(deck, rng);
};

const createMemoryState = ({ bet, rows = DEFAULT_ROWS, cols = DEFAULT_COLS, rng = Math.random }) => {
  const deck = buildDeck(rows, cols, rng);
  const size = deck.length;
  return {
    rows,
    cols,
    bet,
    deck,
    revealed: Array(size).fill(false),
    matched: Array(size).fill(false),
    flipped: [],
    moves: 0,
    matches: 0,
    completed: false,
    inRound: true,
  };
};

const computeMultiplier = (moves, pairs) => {
  const perfect = Math.max(1, pairs);
  const extra = Math.max(0, moves - perfect);
  const maxMultiplier = 3;
  const minMultiplier = 0.5;
  const penalty = 0.1;
  const value = Math.max(minMultiplier, maxMultiplier - extra * penalty);
  return Math.round(value * 100) / 100;
};

const applyMemoryFlip = (state, index) => {
  if (!state || !state.inRound) return { error: "No active game." };
  if (state.completed) return { error: "Game complete." };
  const size = state.deck?.length || 0;
  if (size === 0) return { error: "No deck." };
  if (!Number.isInteger(index) || index < 0 || index >= size) {
    return { error: "Invalid card." };
  }

  const deck = state.deck;
  const revealed = Array.isArray(state.revealed) ? state.revealed.slice() : Array(size).fill(false);
  const matched = Array.isArray(state.matched) ? state.matched.slice() : Array(size).fill(false);
  let flipped = Array.isArray(state.flipped) ? state.flipped.slice() : [];

  if (flipped.length === 2) {
    const [a, b] = flipped;
    if (deck[a] !== deck[b]) {
      revealed[a] = false;
      revealed[b] = false;
    }
    flipped = [];
  }

  if (matched[index] || revealed[index]) {
    return { state: { ...state, revealed, matched, flipped } };
  }

  revealed[index] = true;
  flipped.push(index);

  let moves = state.moves || 0;
  let matches = state.matches || 0;
  let matchedPair = false;

  if (flipped.length === 2) {
    moves += 1;
    const [a, b] = flipped;
    if (deck[a] === deck[b]) {
      matched[a] = true;
      matched[b] = true;
      matches += 1;
      matchedPair = true;
      flipped = [];
    }
  }

  const completed = matches >= size / 2;

  return {
    state: {
      ...state,
      revealed,
      matched,
      flipped,
      moves,
      matches,
      completed,
      inRound: true,
    },
    matched: matchedPair,
    completed,
  };
};

const finalizeMemoryGame = (state) => {
  const pairs = Math.floor((state.deck?.length || 0) / 2);
  const multiplier = computeMultiplier(state.moves || 0, pairs);
  const payout = Math.round((state.bet || 0) * multiplier);
  return {
    multiplier,
    payout,
    profit: payout - (state.bet || 0),
  };
};

module.exports = {
  createMemoryState,
  applyMemoryFlip,
  finalizeMemoryGame,
  computeMultiplier,
};
