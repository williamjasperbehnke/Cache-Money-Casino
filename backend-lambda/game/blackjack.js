const { updateStats } = require("../lib/stats");
const { buildDeck, shuffle, draw } = require("./cards");
const {
  handTotal,
  applyHit: applyCoreHit,
  applyStand: applyCoreStand,
  applyDouble: applyCoreDouble,
  applySplit: applyCoreSplit,
  resolveOutcomes,
  playDealer,
} = require("./blackjack_core");

const resolveDealer = (state) => {
  const allBusted = state.hands.every((hand, idx) => state.busted[idx] || handTotal(hand) > 21);
  if (!allBusted) {
    playDealer(state.dealer, state.deck, draw);
  }
  state.revealDealer = true;
  state.inRound = false;
};

const resolveBlackjack = (state, { omitBusted = false } = {}) => {
  resolveDealer(state);
  const dealerTotal = handTotal(state.dealer);
  const resolved = resolveOutcomes(state, dealerTotal);
  if (!omitBusted) return { dealerTotal, ...resolved };
  return {
    dealerTotal,
    outcomes: resolved.outcomes.filter((outcome) => !state.busted[outcome.index]),
    payoutTotal: resolved.payoutTotal,
  };
};

const createBlackjackState = (bet) => {
  const deck = shuffle(buildDeck());
  const hands = [[draw(deck), draw(deck)]];
  const dealer = [draw(deck), draw(deck)];
  return {
    deck,
    hands,
    dealer,
    bets: [bet],
    doubled: [false],
    busted: [false],
    activeHand: 0,
    splitUsed: false,
    inRound: true,
    revealDealer: false,
  };
};

const applyBlackjackStats = (user, state, outcomes) => {
  if (!user) return;
  outcomes.forEach((outcome) => {
    const bet = state.bets[outcome.index];
    const net = outcome.net;
    const result = net > 0 ? "win" : net < 0 ? "loss" : "push";
    user.stats = updateStats(user.stats, {
      game: "blackjack",
      bet,
      net,
      result,
    });
  });
};

const finalizeIfDone = (state, finished, messages = []) => {
  if (!finished) return { state, messages, finished: false };
  const resolved = resolveBlackjack(state, { omitBusted: true });
  return {
    state,
    messages,
    finished: true,
    outcomes: resolved.outcomes,
    payoutTotal: resolved.payoutTotal,
  };
};

const applyAction = (state, actionFn) => {
  const { messages, finished } = actionFn();
  return finalizeIfDone(state, finished, messages || []);
};

const applyHit = (state) => applyAction(state, () => applyCoreHit(state, state.deck, draw));

const applyStand = (state) => applyAction(state, () => applyCoreStand(state));

const applyDouble = (state) => applyAction(state, () => applyCoreDouble(state, state.deck, draw));

const applySplit = (state) => applyCoreSplit(state, state.deck, draw);

module.exports = {
  resolveBlackjack,
  createBlackjackState,
  applyBlackjackStats,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
};
