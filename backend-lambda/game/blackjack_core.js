const handTotal = (hand = []) => {
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

const playDealer = (dealerHand, deck, draw) => {
  while (handTotal(dealerHand) < 17) {
    dealerHand.push(draw(deck));
  }
  return handTotal(dealerHand);
};

const compareTotals = (playerTotal, dealerTotal) => {
  if (playerTotal > 21) return "bust";
  if (dealerTotal > 21 || playerTotal > dealerTotal) return "win";
  if (playerTotal === dealerTotal) return "push";
  return "loss";
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

const applyHit = (state, deck, draw) => {
  const hand = state.hands[state.activeHand];
  hand.push(draw(deck));
  const total = handTotal(hand);
  const messages = [];
  let finished = false;

  if (total > 21) {
    state.busted[state.activeHand] = true;
    const multiple = state.hands.length > 1;
    messages.push({
      text: multiple ? `Hand ${state.activeHand + 1} busts.` : "You bust.",
      tone: "danger",
    });
    finished = advanceHand(state);
  }

  return { state, messages, finished };
};

const applyStand = (state) => {
  const finished = advanceHand(state);
  return { state, messages: [], finished };
};

const applyDouble = (state, deck, draw) => {
  const hand = state.hands[state.activeHand];
  const bet = state.bets[state.activeHand];
  state.bets[state.activeHand] = bet * 2;
  state.doubled[state.activeHand] = true;
  hand.push(draw(deck));
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
  const finished = advanceHand(state);
  return { state, messages, finished };
};

const applySplit = (state, deck, draw) => {
  if (!canSplit(state)) {
    return { error: "Cannot split now." };
  }
  const bet = state.bets[state.activeHand];
  const hand = state.hands[state.activeHand];
  const cardA = hand[0];
  const cardB = hand[1];
  state.hands = [
    [cardA, draw(deck)],
    [cardB, draw(deck)],
  ];
  state.bets = [bet, bet];
  state.doubled = [false, false];
  state.busted = [false, false];
  state.activeHand = 0;
  state.splitUsed = true;
  return { state, messages: [], finished: false };
};

const resolveOutcomes = (state, dealerTotal) => {
  const outcomes = [];
  let payoutTotal = 0;
  state.hands.forEach((hand, index) => {
    const bet = state.bets[index];
    const total = handTotal(hand);
    const result = compareTotals(total, dealerTotal);
    if (result === "bust" || result === "loss") {
      outcomes.push({ index, result: "loss", net: -bet });
      return;
    }
    if (result === "win") {
      payoutTotal += bet * 2;
      outcomes.push({ index, result: "win", net: bet });
      return;
    }
    if (result === "push") {
      payoutTotal += bet;
      outcomes.push({ index, result: "push", net: 0 });
    }
  });
  return { outcomes, payoutTotal };
};

module.exports = {
  handTotal,
  playDealer,
  compareTotals,
  canSplit,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
  resolveOutcomes,
};
