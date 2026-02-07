const pokerCardValue = (card) => {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
};

const pokerEvaluateHand = (cards) => {
  const values = cards.map((card) => pokerCardValue(card)).sort((a, b) => a - b);
  const counts = {};
  const suitsCount = {};
  cards.forEach((card) => {
    const value = pokerCardValue(card);
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

  const valueLabel = (value) => {
    if (value === 14) return "Aces";
    if (value === 13) return "Kings";
    if (value === 12) return "Queens";
    if (value === 11) return "Jacks";
    return `${value}s`;
  };

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

const pokerCompareHands = (player, dealer) => {
  if (player.rank !== dealer.rank) {
    return player.rank > dealer.rank ? 1 : -1;
  }
  const dVals = [...dealer.values].sort((a, b) => b - a);
  const pVals = [...player.values].sort((a, b) => b - a);
  for (let i = 0; i < pVals.length; i += 1) {
    if (pVals[i] !== dVals[i]) {
      return pVals[i] > dVals[i] ? 1 : -1;
    }
  }
  return 0;
};

const pokerWinningIndexes = (cards, evaluation) => {
  const values = cards.map((card) => pokerCardValue(card));
  const counts = {};
  values.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
  });
  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (evaluation.rank >= 4) return cards.map((_, idx) => idx);
  if (evaluation.rank === 7) {
    const target = byCount.find((entry) => entry.count === 4)?.value;
    return values.map((value, idx) => (value === target ? idx : null)).filter((idx) => idx !== null);
  }
  if (evaluation.rank === 6) return cards.map((_, idx) => idx);
  if (evaluation.rank === 3) {
    const target = byCount.find((entry) => entry.count === 3)?.value;
    return values.map((value, idx) => (value === target ? idx : null)).filter((idx) => idx !== null);
  }
  if (evaluation.rank === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return values.map((value, idx) => (pairs.includes(value) ? idx : null)).filter((idx) => idx !== null);
  }
  if (evaluation.rank === 1) {
    const target = byCount.find((entry) => entry.count === 2)?.value;
    return values.map((value, idx) => (value === target ? idx : null)).filter((idx) => idx !== null);
  }
  const high = Math.max(...values);
  const highIndex = values.indexOf(high);
  return highIndex >= 0 ? [highIndex] : [];
};

const pokerRaisePercent = (rank) => {
  if (rank >= 6) return 0.8;
  if (rank >= 4) return 0.65;
  if (rank >= 2) return 0.5;
  if (rank >= 1) return 0.25;
  return 0;
};

const pokerDealerAction = (hand, betAmount, phase) => {
  const evalHand = pokerEvaluateHand(hand);
  const raisePct = pokerRaisePercent(evalHand.rank);
  if (betAmount === 0) {
    if (raisePct > 0 && Math.random() > 0.35) {
      return { action: "raise", raisePct, evalHand };
    }
    return { action: "call", raisePct, evalHand };
  }
  if (phase !== "bet1" && evalHand.rank === 0 && Math.random() > 0.5) {
    return { action: "fold", raisePct, evalHand };
  }
  if (raisePct > 0 && Math.random() > 0.55) {
    return { action: "raise", raisePct, evalHand };
  }
  return { action: "call", raisePct, evalHand };
};

const pokerDealerDraw = (hand, deck) => {
  const evaluation = pokerEvaluateHand(hand);
  const rank = evaluation.rank;
  const counts = {};
  hand.forEach((card) => {
    const value = pokerCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
  });

  const keepRanks = new Set();
  if (rank >= 4) {
    return { hand, discarded: 0 };
  }
  if (rank === 3 || rank === 2 || rank === 1) {
    const keepCount = rank === 3 ? 3 : 2;
    Object.entries(counts).forEach(([value, count]) => {
      if (count === keepCount) keepRanks.add(Number(value));
    });
  } else {
    const high = Math.max(...hand.map((card) => pokerCardValue(card)));
    keepRanks.add(high);
  }

  const nextHand = [];
  let discarded = 0;
  hand.forEach((card) => {
    const value = pokerCardValue(card);
    if (keepRanks.has(value)) {
      nextHand.push(card);
    } else {
      nextHand.push(deck.pop());
      discarded += 1;
    }
  });

  return { hand: nextHand, discarded };
};

const createPokerState = ({
  blindSmall,
  blindBig,
  dealerButton,
  playerBlind,
  dealerBlind,
}) => {
  const deck = shuffle(buildDeck());
  const player = [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)];
  const dealer = [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)];
  return {
    deck,
    player,
    dealer,
    pot: playerBlind + dealerBlind,
    playerPaid: playerBlind,
    playerBet: playerBlind,
    dealerBet: dealerBlind,
    currentBet: Math.max(playerBlind, dealerBlind),
    betAmount: 0,
    blindSmall,
    blindBig,
    dealerButton: !dealerButton,
    awaitingRaise: false,
    skipBetting: false,
    phase: "bet1",
    inRound: true,
    awaitingClear: false,
    dealerRaised: false,
  };
};

const applyPokerBet = (state, betAmount, balance, rng = Math.random) => {
  if (!state || !state.inRound) return { error: "Round not running." };

  const { dealer } = state;
  const toCall = Math.max(0, state.currentBet - state.playerBet);
  let nextBalance = balance;
  const messages = [];

  if (betAmount > 0) {
    const totalNeeded = toCall + betAmount;
    if (totalNeeded > nextBalance) return { error: "Not enough credits to raise." };
    nextBalance -= totalNeeded;
    state.playerPaid += totalNeeded;
    state.playerBet += totalNeeded;
    state.currentBet = state.playerBet;
    state.pot += totalNeeded;
    state.awaitingRaise = false;
  } else if (toCall > 0) {
    if (toCall > nextBalance) return { error: "Not enough credits to call." };
    nextBalance -= toCall;
    state.playerPaid += toCall;
    state.playerBet += toCall;
    state.pot += toCall;
    state.awaitingRaise = false;
  } else if (betAmount === 0) {
    return { error: "Bet cannot be zero." };
  }

  const decision = pokerDealerAction(dealer, betAmount, state.phase);
  if (decision.action === "fold") {
    messages.push({ text: "Dealer folds. You win!", tone: "win", duration: 2000 });
    nextBalance += state.pot;
    state.awaitingClear = true;
    state.inRound = false;
    state.phase = "reveal";
    return { state, balance: nextBalance, messages, net: state.pot - state.playerPaid, result: "win" };
  }

  if (decision.action === "raise" && !state.dealerRaised) {
    const raiseBy = Math.max(5, Math.round(state.pot * decision.raisePct));
    const maxRaiseTo = state.playerBet + nextBalance;
    const raiseTo = Math.min(state.currentBet + raiseBy, maxRaiseTo);
    if (raiseTo > state.currentBet) {
      const add = raiseTo - state.dealerBet;
      state.dealerBet = raiseTo;
      state.currentBet = raiseTo;
      state.pot += add;
      state.awaitingRaise = true;
      state.dealerRaised = true;
      messages.push({ text: `Dealer raises to $${raiseTo}.`, tone: "danger", duration: 2000 });
      return { state, balance: nextBalance, messages };
    }
  }

  const dealerToCall = Math.max(0, state.currentBet - state.dealerBet);
  state.dealerBet = state.currentBet;
  state.pot += dealerToCall;
  state.awaitingRaise = false;
  messages.push({ text: "Dealer calls.", tone: "win", duration: 1200 });

  if (state.phase === "bet1") state.phase = "discard1";
  else if (state.phase === "bet2") state.phase = "discard2";
  else if (state.phase === "bet3") state.phase = "reveal";

  return { state, balance: nextBalance, messages };
};

const applyPokerDraw = (state, discards) => {
  if (!state || !state.inRound) return { error: "Round not running." };
  if (!state.phase.startsWith("discard")) return { error: "Not in discard phase." };

  const discardSet = new Set(discards);
  state.player = state.player.map((card, idx) => (discardSet.has(idx) ? draw(state.deck) : card));

  if (state.phase === "discard1") state.phase = "bet2";
  else if (state.phase === "discard2") state.phase = "bet3";

  const dealerDraw = pokerDealerDraw(state.dealer, state.deck);
  state.dealer = dealerDraw.hand;

  return { state, dealerDiscarded: dealerDraw.discarded };
};

const applyPokerCall = (state, balance) => {
  if (!state || !state.inRound) return { error: "Round not running." };
  const toCall = Math.max(0, state.currentBet - state.playerBet);
  if (toCall > balance) return { error: "Not enough credits." };

  const nextBalance = balance - toCall;
  state.playerPaid += toCall;
  state.playerBet += toCall;
  state.pot += toCall;
  state.awaitingRaise = false;

  if (state.phase === "bet1") state.phase = "discard1";
  else if (state.phase === "bet2") state.phase = "discard2";
  else if (state.phase === "bet3") state.phase = "reveal";

  return { state, balance: nextBalance };
};

const applyPokerFold = (state, balance) => {
  if (!state || !state.inRound) return { error: "Round not running." };
  state.awaitingClear = true;
  state.inRound = false;
  state.phase = "reveal";
  return {
    state,
    balance,
    messages: [{ text: "You folded.", tone: "danger", duration: 2000 }],
    net: -state.playerPaid,
    result: "loss",
  };
};

const applyPokerReveal = (state, balance) => {
  if (!state) return { error: "Invalid state." };
  const playerEval = pokerEvaluateHand(state.player);
  const dealerEval = pokerEvaluateHand(state.dealer);
  const result = pokerCompareHands(playerEval, dealerEval);
  let payoutTotal = 0;
  let net = 0;
  if (result > 0) {
    payoutTotal = state.pot;
    net = state.pot - state.playerPaid;
  } else if (result < 0) {
    net = -state.playerPaid;
  } else {
    payoutTotal = state.playerPaid;
    net = 0;
  }
  const nextBalance = balance + payoutTotal;
  state.awaitingClear = true;
  state.inRound = false;
  state.phase = "reveal";

  return {
    state,
    balance: nextBalance,
    result,
    net,
    playerLabel: playerEval.label,
    dealerLabel: dealerEval.label,
    playerIndexes: pokerWinningIndexes(state.player, playerEval),
    dealerIndexes: pokerWinningIndexes(state.dealer, dealerEval),
  };
};

module.exports = {
  createPokerState,
  applyPokerBet,
  applyPokerDraw,
  applyPokerCall,
  applyPokerFold,
  applyPokerReveal,
};
