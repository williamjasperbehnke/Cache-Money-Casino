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

const sanitizeState = (game, state) => {
  if (!state) return state;
  if (game === "blackjack") return sanitizeBlackjackState(state);
  if (game === "poker") return sanitizePokerState(state);
  if (game === "holdem") return sanitizeHoldemState(state);
  return state;
};

module.exports = {
  sanitizeState,
};
