const { buildDeck, shuffle, draw, cardValue, evaluateFiveCardHand } = require("./cards");

const BETTING_PHASES = new Set(["preflop", "flop", "turn", "river"]);

const holdemPhaseCommunityCount = (phase) => {
  if (phase === "flop") return 3;
  if (phase === "turn") return 4;
  if (phase === "river" || phase === "showdown") return 5;
  return 0;
};

const holdemCompareHands = (player, dealer) => {
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

const holdemCombinations = (arrLength, size) => {
  const results = [];
  const combo = [];
  const dfs = (start, depth) => {
    if (depth === size) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i <= arrLength - (size - depth); i += 1) {
      combo.push(i);
      dfs(i + 1, depth + 1);
      combo.pop();
    }
  };
  dfs(0, 0);
  return results;
};

const holdemBestHand = (cards) => {
  const combos = holdemCombinations(cards.length, 5);
  let bestEval = null;
  let bestCombo = combos[0];
  combos.forEach((indexes) => {
    const hand = indexes.map((idx) => cards[idx]);
    const evalHand = evaluateFiveCardHand(hand);
    if (!bestEval) {
      bestEval = evalHand;
      bestCombo = indexes;
      return;
    }
    if (holdemCompareHands(evalHand, bestEval) > 0) {
      bestEval = evalHand;
      bestCombo = indexes;
    }
  });
  return { eval: bestEval, indexes: bestCombo };
};

const holdemResetBettingRound = (state) => {
  state.playerBet = 0;
  state.dealerBet = 0;
  state.currentBet = 0;
  state.betAmount = 0;
  state.awaitingRaise = false;
  state.dealerRaised = false;
};

const holdemAdvancePhase = (state) => {
  if (state.phase === "preflop") state.phase = "flop";
  else if (state.phase === "flop") state.phase = "turn";
  else if (state.phase === "turn") state.phase = "river";
  else if (state.phase === "river") state.phase = "showdown";
  holdemResetBettingRound(state);
};

const holdemPreflopStrength = (hand) => {
  const values = hand.map((card) => cardValue(card)).sort((a, b) => b - a);
  const isPair = values[0] === values[1];
  const suited = hand[0].suit === hand[1].suit;
  const gap = Math.abs(values[0] - values[1]);
  if (isPair && values[0] >= 11) return 5;
  if (isPair) return 4;
  if (values[0] >= 13 && suited) return 4;
  if (values[0] >= 13) return 3;
  if (suited && gap <= 2) return 3;
  if (values[0] >= 11) return 2;
  return 1;
};

const holdemDealerStrength = (state) => {
  const visibleCommunity = state.community.slice(0, holdemPhaseCommunityCount(state.phase));
  if (visibleCommunity.length < 3) {
    return holdemPreflopStrength(state.dealer);
  }
  const combined = [...state.dealer, ...visibleCommunity];
  const best = holdemBestHand(combined);
  return best.eval.rank;
};

const holdemDealerRaiseAmount = (state, strength, playerBalance) => {
  const base = Math.max(10, Math.round(state.pot * (0.35 + strength * 0.1)));
  return Math.min(base, Math.max(5, playerBalance));
};


const createHoldemState = ({
  blindSmall,
  blindBig,
  dealerButton,
  playerBlind,
  dealerBlind,
}) => {
  const deck = shuffle(buildDeck());
  return {
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
    deck,
    player: [draw(deck), draw(deck)],
    dealer: [draw(deck), draw(deck)],
    community: [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)],
    phase: "preflop",
    inRound: true,
    dealerRaised: false,
  };
};

const applyHoldemAction = (state, betAmount, balance, rng = Math.random) => {
  if (!state || !state.inRound) {
    return { error: "Round not running." };
  }

  const messages = [];
  let nextBalance = balance;
  const toCall = Math.max(0, state.currentBet - state.playerBet);
  const canBet = BETTING_PHASES.has(state.phase);
  if (!canBet) {
    return { error: "Betting is closed." };
  }

  const phaseLabels = {
    flop: "Flop dealt.",
    turn: "Turn card.",
    river: "River card.",
    preflop: "Pre-flop betting.",
  };

  const advanceToShowdownIfBroke = () => {
    if (nextBalance > 0) return false;
    while (state.inRound && BETTING_PHASES.has(state.phase)) {
      holdemAdvancePhase(state);
    }
    return true;
  };

  const finishShowdown = () => {
    const playerCombined = [...state.player, ...state.community];
    const dealerCombined = [...state.dealer, ...state.community];
    const playerBest = holdemBestHand(playerCombined);
    const dealerBest = holdemBestHand(dealerCombined);
    const result = holdemCompareHands(playerBest.eval, dealerBest.eval);
    let payoutTotal = 0;
    let net = 0;
    if (result > 0) {
      payoutTotal = state.pot;
      net = state.pot - state.playerPaid;
      messages.push({ text: `You win with ${playerBest.eval.label}!`, tone: "win", duration: 2400 });
    } else if (result < 0) {
      net = -state.playerPaid;
      messages.push({ text: `Dealer wins with ${dealerBest.eval.label}.`, tone: "danger", duration: 2400 });
    } else {
      payoutTotal = state.pot / 2;
      net = 0;
      messages.push({ text: "Push. Pot split.", tone: "win", duration: 2000 });
    }
    nextBalance += payoutTotal;
    state.inRound = false;
    state.phase = "showdown";
    return {
      showdown: {
        playerLabel: playerBest.eval.label,
        dealerLabel: dealerBest.eval.label,
        result,
        playerIndexes: playerBest.indexes,
        dealerIndexes: dealerBest.indexes,
      },
      net,
    };
  };

  const dealerActs = () => {
    const dealerToCall = Math.max(0, state.currentBet - state.dealerBet);
    const strength = holdemDealerStrength(state);
    if (dealerToCall === 0) {
      if (strength >= 2 && rng() > 0.15 && !state.dealerRaised) {
        const raiseBy = holdemDealerRaiseAmount(state, strength, nextBalance);
        const maxRaiseTo = state.playerBet + nextBalance;
        const raiseTo = Math.min(state.currentBet + raiseBy, maxRaiseTo);
        if (raiseTo > state.currentBet) {
          const add = raiseTo - state.dealerBet;
          state.dealerBet = raiseTo;
          state.currentBet = raiseTo;
          state.pot += add;
          state.dealerRaised = true;
          state.betAmount = 0;
          state.awaitingRaise = true;
          messages.push({ text: `Dealer bets $${raiseTo}.`, tone: "danger", duration: 2000 });
          return { awaitingRaise: true };
        }
      }
      messages.push({ text: "Dealer checks.", tone: "win", duration: 1200 });
      holdemAdvancePhase(state);
      return { advanced: true };
    }

    if (strength <= 1 && rng() > 0.85) {
      messages.push({ text: "Dealer folds. You win!", tone: "win", duration: 2000 });
      nextBalance += state.pot;
      state.inRound = false;
      state.phase = "showdown";
      return { folded: true };
    }

    if (strength >= 3 && rng() > 0.2 && !state.dealerRaised) {
      const raiseBy = holdemDealerRaiseAmount(state, strength, nextBalance);
      const maxRaiseTo = state.playerBet + nextBalance;
      const raiseTo = Math.min(state.currentBet + raiseBy, maxRaiseTo);
      if (raiseTo > state.currentBet) {
        const add = raiseTo - state.dealerBet;
        state.dealerBet = raiseTo;
        state.currentBet = raiseTo;
        state.pot += add;
        state.dealerRaised = true;
        state.betAmount = 0;
        state.awaitingRaise = true;
        messages.push({ text: `Dealer raises to $${raiseTo}.`, tone: "danger", duration: 2000 });
        return { awaitingRaise: true };
      }
    }

    state.pot += dealerToCall;
    state.dealerBet = state.currentBet;
    messages.push({ text: "Dealer calls.", tone: "win", duration: 1200 });
    holdemAdvancePhase(state);
    return { advanced: true };
  };

  const prevPhase = state.phase;
  let skipDealer = false;

  if (toCall > 0 && betAmount > 0) {
    const totalNeeded = toCall + betAmount;
    if (totalNeeded > nextBalance) {
      return { error: "Not enough credits to raise." };
    }
    nextBalance -= totalNeeded;
    state.pot += totalNeeded;
    state.playerPaid += totalNeeded;
    state.playerBet += totalNeeded;
    state.currentBet = state.playerBet;
    state.awaitingRaise = false;
  } else if (toCall > 0) {
    const amount = Math.min(toCall, nextBalance);
    if (amount <= 0) {
      if (state.awaitingRaise) {
        state.awaitingRaise = false;
        holdemAdvancePhase(state);
        skipDealer = true;
      }
    } else {
      nextBalance -= amount;
      state.pot += amount;
      state.playerPaid += amount;
      state.playerBet += amount;
      if (amount === toCall) state.playerBet = state.currentBet;
      if (amount < toCall) {
        messages.push({ text: "All-in call.", tone: "win", duration: 1600 });
      }
      if (state.awaitingRaise) {
        state.awaitingRaise = false;
        holdemAdvancePhase(state);
        skipDealer = true;
      }
    }
  } else if (betAmount > 0) {
    if (betAmount > nextBalance) {
      return { error: "Not enough credits to raise." };
    }
    nextBalance -= betAmount;
    state.pot += betAmount;
    state.playerPaid += betAmount;
    state.playerBet += betAmount;
    state.currentBet = state.playerBet;
    state.awaitingRaise = false;
  }

  if (state.phase === "showdown") {
    const showdown = finishShowdown();
    return { state, balance: nextBalance, messages, ...showdown };
  }

  if (state.awaitingRaise && nextBalance > 0) {
    return { state, balance: nextBalance, messages };
  }

  if (skipDealer) {
    if (state.phase !== prevPhase && state.phase !== "showdown") {
      const label = phaseLabels[state.phase];
      if (label) messages.push({ text: label, tone: "win", duration: 1400 });
    }
    return { state, balance: nextBalance, messages };
  }

  const dealerDecision = dealerActs();
  if (dealerDecision?.folded) {
    return { state, balance: nextBalance, messages, folded: true };
  }

  if (advanceToShowdownIfBroke()) {
    const showdown = finishShowdown();
    return { state, balance: nextBalance, messages, ...showdown };
  }

  if (state.awaitingRaise) {
    return { state, balance: nextBalance, messages };
  }

  if (state.phase !== prevPhase && state.phase !== "showdown") {
    const label = phaseLabels[state.phase];
    if (label) {
      messages.push({ text: label, tone: "win", duration: 1400 });
    }
  }

  if (state.phase === "showdown") {
    const showdown = finishShowdown();
    return { state, balance: nextBalance, messages, ...showdown };
  }

  return { state, balance: nextBalance, messages };
};

const applyHoldemFold = (state, balance) => {
  if (!state || !state.inRound) {
    return { error: "Round not running." };
  }
  state.inRound = false;
  state.phase = "showdown";
  return {
    state,
    balance,
    messages: [{ text: "You fold.", tone: "danger", duration: 2000 }],
    net: -state.playerPaid,
  };
};

module.exports = {
  createHoldemState,
  applyHoldemAction,
  applyHoldemFold,
  holdemPhaseCommunityCount,
};
