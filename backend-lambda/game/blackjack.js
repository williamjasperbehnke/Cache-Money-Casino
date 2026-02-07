const { updateStats } = require("../lib/stats");
const { buildDeck, shuffle, draw } = require("./cards");

const handTotal = (hand) => {
  let total = 0;
  let aces = 0;
  hand.forEach((card) => {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
};

const canSplit = (state) => {
  if (state.splitUsed) return false;
  const hand = state.hands[state.activeHand] || [];
  return hand.length === 2 && hand[0].rank === hand[1].rank;
};

const advanceHand = (state) => {
  if (state.activeHand < state.hands.length - 1) {
    state.activeHand += 1;
    return false;
  }
  return true;
};

const resolveDealer = (state) => {
  const allBusted = state.hands.every((hand, idx) => state.busted[idx] || handTotal(hand) > 21);
  if (!allBusted) {
    while (handTotal(state.dealer) < 17) {
      state.dealer.push(draw(state.deck));
    }
  }
  state.revealDealer = true;
  state.inRound = false;
};

const resolveBlackjack = (state, { omitBusted = false } = {}) => {
  resolveDealer(state);
  const dealerTotal = handTotal(state.dealer);
  const outcomes = [];
  let payoutTotal = 0;
  state.hands.forEach((hand, index) => {
    if (omitBusted && (state.busted[index] || handTotal(hand) > 21)) {
      return;
    }
    const bet = state.bets[index];
    const total = handTotal(hand);
    if (state.busted[index] || total > 21) {
      outcomes.push({ index, result: "loss", net: -bet });
      return;
    }
    if (dealerTotal > 21 || total > dealerTotal) {
      payoutTotal += bet * 2;
      outcomes.push({ index, result: "win", net: bet });
      return;
    }
    if (dealerTotal === total) {
      payoutTotal += bet;
      outcomes.push({ index, result: "push", net: 0 });
      return;
    }
    outcomes.push({ index, result: "loss", net: -bet });
  });
  return { dealerTotal, outcomes, payoutTotal };
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

const applyHit = (state) => {
  const hand = state.hands[state.activeHand];
  hand.push(draw(state.deck));
  const total = handTotal(hand);
  const messages = [];
  let finished = false;
  let outcomes;
  let payoutTotal;

  if (total > 21) {
    state.busted[state.activeHand] = true;
    const multiple = state.hands.length > 1;
    messages.push({
      text: multiple ? `Hand ${state.activeHand + 1} busts.` : "You bust.",
      tone: "danger",
    });
    const done = advanceHand(state);
    if (done) {
      const resolved = resolveBlackjack(state, { omitBusted: true });
      outcomes = resolved.outcomes;
      payoutTotal = resolved.payoutTotal;
      finished = true;
    }
  }

  return { state, messages, finished, outcomes, payoutTotal };
};

const applyStand = (state) => {
  const done = advanceHand(state);
  if (!done) {
    return { state, messages: [], finished: false };
  }
  const resolved = resolveBlackjack(state, { omitBusted: true });
  return {
    state,
    messages: [],
    finished: true,
    outcomes: resolved.outcomes,
    payoutTotal: resolved.payoutTotal,
  };
};

const applyDouble = (state) => {
  const hand = state.hands[state.activeHand];
  const bet = state.bets[state.activeHand];
  state.bets[state.activeHand] = bet * 2;
  state.doubled[state.activeHand] = true;
  hand.push(draw(state.deck));
  const total = handTotal(hand);
  const messages = [];
  if (total > 21) {
    state.busted[state.activeHand] = true;
    const multiple = state.hands.length > 1;
    messages.push({
      text: multiple ? `Hand ${state.activeHand + 1} busts.` : "You bust.",
      tone: "danger",
    });
  }
  const done = advanceHand(state);
  if (!done) {
    return { state, messages, finished: false };
  }
  const resolved = resolveBlackjack(state, { omitBusted: true });
  return {
    state,
    messages,
    finished: true,
    outcomes: resolved.outcomes,
    payoutTotal: resolved.payoutTotal,
  };
};

const applySplit = (state) => {
  if (!canSplit(state)) {
    return { error: "Cannot split now." };
  }
  const bet = state.bets[state.activeHand];
  const hand = state.hands[state.activeHand];
  const cardA = hand[0];
  const cardB = hand[1];
  state.hands = [
    [cardA, draw(state.deck)],
    [cardB, draw(state.deck)],
  ];
  state.bets = [bet, bet];
  state.doubled = [false, false];
  state.busted = [false, false];
  state.activeHand = 0;
  state.splitUsed = true;
  return { state };
};

module.exports = {
  createBlackjackState,
  applyBlackjackStats,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
};
