const { buildDeck, shuffle, draw, cardValue, evaluateFiveCardHand } = require("./cards");

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
  const values = cards.map((card) => cardValue(card));
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
  const evalHand = evaluateFiveCardHand(hand);
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
  const evaluation = evaluateFiveCardHand(hand);
  const rank = evaluation.rank;
  const counts = {};
  hand.forEach((card) => {
    const value = cardValue(card);
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
    const high = Math.max(...hand.map((card) => cardValue(card)));
    keepRanks.add(high);
  }

  const nextHand = [];
  let discarded = 0;
  hand.forEach((card) => {
    const value = cardValue(card);
    if (keepRanks.has(value)) {
      nextHand.push(card);
    } else {
      nextHand.push(deck.pop());
      discarded += 1;
    }
  });

  return { hand: nextHand, discarded };
};

const advancePokerPhase = (state) => {
  if (state.phase === "bet1") state.phase = "discard1";
  else if (state.phase === "bet2") state.phase = "discard2";
  else if (state.phase === "bet3") state.phase = "reveal";
  else if (state.phase === "discard1") state.phase = "bet2";
  else if (state.phase === "discard2") state.phase = "bet3";
  return state.phase;
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
    phase: "bet1",
    inRound: true,
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
  }

  const decision = pokerDealerAction(dealer, betAmount, state.phase);
  if (decision.action === "fold") {
    messages.push({ text: "Dealer folds. You win!", tone: "win", duration: 2000 });
    nextBalance += state.pot;
    state.inRound = false;
    state.phase = "reveal";
    return { state, balance: nextBalance, messages, net: state.pot - state.playerPaid, result: "win" };
  }

  if (decision.action === "raise" && !state.dealerRaised) {
    const raiseBy = Math.max(5, Math.round(state.pot * decision.raisePct));
    const maxRaiseTo = state.playerBet + nextBalance;
    const raiseTo = Math.min(state.currentBet + raiseBy, maxRaiseTo);
    if (raiseTo > state.currentBet) {
      const raiseBy = raiseTo - state.currentBet;
      const add = raiseTo - state.dealerBet;
      state.dealerBet = raiseTo;
      state.currentBet = raiseTo;
      state.pot += add;
      state.awaitingRaise = true;
      state.dealerRaised = true;
      messages.push({ text: `Dealer raises $${raiseBy}.`, tone: "danger", duration: 2000 });
      return { state, balance: nextBalance, messages };
    }
  }

  const dealerToCall = Math.max(0, state.currentBet - state.dealerBet);
  state.dealerBet = state.currentBet;
  state.pot += dealerToCall;
  state.awaitingRaise = false;
  messages.push({
    text: dealerToCall > 0 ? "Dealer calls." : "Dealer checks.",
    tone: "win",
    duration: 1200,
  });

  advancePokerPhase(state);

  if (state.phase === "reveal") {
    return applyPokerReveal(state, nextBalance);
  }

  return { state, balance: nextBalance, messages };
};

const applyPokerDraw = (state, discards) => {
  if (!state || !state.inRound) return { error: "Round not running." };
  if (!state.phase.startsWith("discard")) return { error: "Not in discard phase." };

  const discardSet = new Set(discards);
  state.player = state.player.map((card, idx) => (discardSet.has(idx) ? draw(state.deck) : card));

  advancePokerPhase(state);

  const dealerDraw = pokerDealerDraw(state.dealer, state.deck);
  state.dealer = dealerDraw.hand;
  const result = state.phase === "reveal" ? applyPokerReveal(state, 0) : null;
  if (result) {
    return {
      state: result.state,
      dealerDiscarded: dealerDraw.discarded,
      reveal: result,
    };
  }
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

  advancePokerPhase(state);
  if (state.phase === "reveal") {
    return applyPokerReveal(state, nextBalance);
  }
  return { state, balance: nextBalance };
};

const applyPokerFold = (state, balance) => {
  if (!state || !state.inRound) return { error: "Round not running." };
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
  const playerEval = evaluateFiveCardHand(state.player);
  const dealerEval = evaluateFiveCardHand(state.dealer);
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
