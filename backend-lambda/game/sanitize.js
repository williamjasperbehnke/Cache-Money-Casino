const { holdemPhaseCommunityCount } = require("./holdem");

const maskCard = () => ({ rank: "?", suit: "?" });

const maskCards = (count) => Array.from({ length: count }, () => maskCard());

const sanitizeBlackjackState = (state) => {
  if (!state) return state;
  const next = { ...state };
  delete next.deck;
  if (Array.isArray(next.dealer)) {
    if (!next.revealDealer && next.dealer.length > 0) {
      next.dealer = next.dealer.map((card, index) => (index === 0 ? maskCard() : card));
    } else {
      next.dealer = next.dealer.slice();
    }
  }
  return next;
};

const sanitizeBlackjackMultiState = (state) => {
  if (!state) return state;
  const next = { ...state };
  delete next.deck;
  if (Array.isArray(next.dealer)) {
    if (!next.revealDealer && next.dealer.length > 0) {
      next.dealer = next.dealer.map((card, index) => (index === 0 ? maskCard() : card));
    } else {
      next.dealer = next.dealer.slice();
    }
  }
  return next;
};

const sanitizeHoldemMultiState = (state, viewerId = "") => {
  if (!state) return state;
  const next = { ...state };
  delete next.deck;
  if (Array.isArray(next.players)) {
    next.players = next.players.map((entry) => {
      const cards = Array.isArray(entry?.cards) ? entry.cards : [];
      if (next.phase === "showdown") return { ...entry, cards: cards.slice() };
      if (viewerId && entry?.id === viewerId) return { ...entry, cards: cards.slice() };
      return { ...entry, cards: maskCards(cards.length) };
    });
  }
  return next;
};

const sanitizePokerState = (state) => {
  if (!state) return state;
  const next = { ...state };
  delete next.deck;
  if (Array.isArray(next.dealer)) {
    next.dealer =
      next.phase === "reveal" ? next.dealer.slice() : maskCards(next.dealer.length);
  }
  return next;
};

const sanitizeHoldemState = (state) => {
  if (!state) return state;
  const next = { ...state };
  delete next.deck;
  if (Array.isArray(next.community)) {
    const visible = holdemPhaseCommunityCount(next.phase);
    next.community = next.community.slice(0, visible);
  }
  if (Array.isArray(next.dealer)) {
    next.dealer =
      next.phase === "showdown" ? next.dealer.slice() : maskCards(next.dealer.length);
  }
  return next;
};

const sanitizeMemoryState = (state) => {
  if (!state) return state;
  const next = { ...state };
  const deck = Array.isArray(state.deck) ? state.deck : [];
  const revealed = Array.isArray(state.revealed) ? state.revealed : [];
  const matched = Array.isArray(state.matched) ? state.matched : [];
  next.cards = deck.map((value, index) => ({
    value: revealed[index] || matched[index] ? value : null,
    revealed: Boolean(revealed[index]),
    matched: Boolean(matched[index]),
  }));
  delete next.deck;
  return next;
};

const sanitizeState = (game, state, viewerId = "") => {
  if (!state) return state;
  if (game === "blackjack") return sanitizeBlackjackState(state);
  if (game === "blackjack-multi") return sanitizeBlackjackMultiState(state);
  if (game === "holdem-multi") return sanitizeHoldemMultiState(state, viewerId);
  if (game === "poker") return sanitizePokerState(state);
  if (game === "holdem") return sanitizeHoldemState(state);
  if (game === "memory") return sanitizeMemoryState(state);
  return state;
};

module.exports = {
  sanitizeState,
};
