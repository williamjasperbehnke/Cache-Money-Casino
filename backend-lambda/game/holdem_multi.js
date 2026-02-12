const { buildDeck, shuffle, draw, evaluateFiveCardHand } = require("./cards");

const ROUND_CLEAR_DELAY_MS = 30000;

const normalizePlayer = (player) => ({
  id: player.id,
  username: player.username || "Guest",
  cards: Array.isArray(player.cards) ? player.cards : [],
  folded: Boolean(player.folded),
  acted: Boolean(player.acted),
  allIn: Boolean(player.allIn),
  stack: Number(player.stack) || 0,
  roundBet: Number(player.roundBet) || 0,
  committed: Number(player.committed) || 0,
  betAmount: Number(player.betAmount) || 0,
  lastBet: Number(player.lastBet) || 0,
  status: player.status || "waiting",
  lastResult: player.lastResult || "",
  lastPayout: Number(player.lastPayout) || 0,
  lastCommitted: Number(player.lastCommitted) || 0,
  bestLabel: player.bestLabel || "",
  bestIndexes: Array.isArray(player.bestIndexes) ? player.bestIndexes : [],
  lastAction: player.lastAction || "",
});

const createHoldemMultiState = ({ roomId, host, hostId, maxPlayers = 6 }) => ({
  game: "holdem-multi",
  roomId,
  host: host || "host",
  hostId: hostId || "",
  maxPlayers,
  players: [],
  community: [],
  pot: 0,
  potBreakdown: [],
  phase: "lobby",
  inRound: false,
  turnIndex: 0,
  buttonIndex: -1,
  smallBlindIndex: -1,
  bigBlindIndex: -1,
  smallBlind: 5,
  bigBlind: 10,
  currentBet: 0,
  minRaise: 10,
  deck: [],
  settled: false,
  payoutApplied: false,
  roundClearAt: null,
  updatedAt: new Date().toISOString(),
});

const isInHand = (player) => player.status === "playing" && !player.folded;
const canAct = (player) => isInHand(player) && !player.allIn;

const addPlayer = (state, player) => {
  const next = state.players.map(normalizePlayer);
  if (next.find((entry) => entry.id === player.id)) {
    state.players = next;
    return state;
  }
  if (next.length >= state.maxPlayers) {
    return { error: "Room is full." };
  }
  next.push(
    normalizePlayer({
      ...player,
      status: "waiting",
      cards: [],
      folded: false,
      acted: false,
      allIn: false,
      stack: 0,
      roundBet: 0,
      committed: 0,
      lastResult: "",
      lastPayout: 0,
      lastCommitted: 0,
      bestLabel: "",
      bestIndexes: [],
      lastAction: "",
    })
  );
  const hostMissing = !state.hostId || !next.find((entry) => entry.id === state.hostId);
  if (hostMissing && next.length === 1) {
    state.hostId = player.id;
    state.host = player.username || state.host;
  }
  state.players = next;
  state.updatedAt = new Date().toISOString();
  return state;
};

const nextIndexFrom = (state, startIndex, predicate) => {
  const total = state.players.length;
  if (total === 0) return -1;
  for (let step = 0; step < total; step += 1) {
    const idx = (startIndex + step + total) % total;
    const player = state.players[idx];
    if (player && predicate(player, idx)) return idx;
  }
  return -1;
};

const removePlayer = (state, playerId) => {
  const idx = state.players.findIndex((entry) => entry.id === playerId);
  if (idx === -1) return state;
  const wasHost = state.hostId === playerId;
  state.players.splice(idx, 1);

  const normalizeIndex = (value) => {
    if (value < 0) return -1;
    if (idx < value) return value - 1;
    if (idx === value) return -1;
    return value;
  };
  state.turnIndex = normalizeIndex(state.turnIndex);
  state.buttonIndex = normalizeIndex(state.buttonIndex);
  state.smallBlindIndex = normalizeIndex(state.smallBlindIndex);
  state.bigBlindIndex = normalizeIndex(state.bigBlindIndex);

  if (state.turnIndex >= state.players.length) state.turnIndex = 0;
  if (wasHost) {
    const nextHost = state.players[0];
    state.hostId = nextHost ? nextHost.id : "";
    state.host = nextHost ? nextHost.username : "";
  }
  progressState(state);
  state.updatedAt = new Date().toISOString();
  return state;
};

const compareEval = (left, right) => {
  if (!left || !right) return 0;
  if (left.rank !== right.rank) return left.rank - right.rank;
  const lv = left.values || [];
  const rv = right.values || [];
  for (let i = 0; i < Math.max(lv.length, rv.length); i += 1) {
    const diff = (lv[i] || 0) - (rv[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const combos = (length, size) => {
  const out = [];
  const cur = [];
  const dfs = (start) => {
    if (cur.length === size) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i <= length - (size - cur.length); i += 1) {
      cur.push(i);
      dfs(i + 1);
      cur.pop();
    }
  };
  dfs(0);
  return out;
};

const bestHoldemHand = (cards) => {
  const idxSets = combos(cards.length, 5);
  let best = null;
  idxSets.forEach((idxSet) => {
    const hand = idxSet.map((idx) => cards[idx]);
    const current = evaluateFiveCardHand(hand);
    if (!best || compareEval(current, best.eval) > 0) {
      best = { eval: current, indexes: idxSet };
    }
  });
  return best;
};

const applyBet = (player, amount, state) => {
  const pay = Math.max(0, Math.min(Number(amount) || 0, player.stack));
  if (pay <= 0) return 0;
  player.stack -= pay;
  player.roundBet += pay;
  player.committed += pay;
  if (player.stack <= 0) player.allIn = true;
  state.pot += pay;
  return pay;
};

const buildPotSegments = (state) => {
  const levels = [...new Set((state.players || []).map((entry) => Number(entry.committed || 0)).filter((v) => v > 0))]
    .sort((a, b) => a - b);
  const segments = [];
  let previous = 0;
  levels.forEach((level) => {
    const participants = (state.players || []).filter((entry) => Number(entry.committed || 0) >= level);
    if (!participants.length) return;
    const amount = (level - previous) * participants.length;
    previous = level;
    if (amount <= 0) return;
    const eligible = participants.filter((entry) => isInHand(entry));
    if (!eligible.length) return;
    segments.push({
      amount,
      eligibleIds: eligible.map((entry) => entry.id),
      winnerIds: [],
    });
  });
  return segments;
};

const writePotBreakdown = (state, segments = []) => {
  const nameById = new Map((state.players || []).map((entry) => [entry.id, entry.username || "Guest"]));
  state.potBreakdown = segments.map((segment, idx) => ({
    label: idx === 0 ? "Main Pot" : `Side Pot ${idx}`,
    amount: Number(segment.amount || 0),
    eligibleIds: segment.eligibleIds || [],
    eligibleNames: (segment.eligibleIds || []).map((id) => nameById.get(id) || "Guest"),
    winnerIds: segment.winnerIds || [],
    winnerNames: (segment.winnerIds || []).map((id) => nameById.get(id) || "Guest"),
  }));
};

const dealCommunityForPhase = (state, nextPhase) => {
  if (nextPhase === "flop") {
    state.community = [draw(state.deck), draw(state.deck), draw(state.deck)];
    return;
  }
  if (nextPhase === "turn" || nextPhase === "river") {
    state.community.push(draw(state.deck));
  }
};

const advanceStreet = (state) => {
  if (state.phase === "preflop") {
    state.phase = "flop";
    dealCommunityForPhase(state, "flop");
  } else if (state.phase === "flop") {
    state.phase = "turn";
    dealCommunityForPhase(state, "turn");
  } else if (state.phase === "turn") {
    state.phase = "river";
    dealCommunityForPhase(state, "river");
  } else {
    state.phase = "showdown";
    state.inRound = false;
    while ((state.community || []).length < 5) {
      state.community.push(draw(state.deck));
    }
    return;
  }

  state.players.forEach((entry) => {
    if (!isInHand(entry)) return;
    entry.roundBet = 0;
    entry.acted = false;
    entry.lastAction = "";
  });
  state.currentBet = 0;
  state.minRaise = Math.max(1, Number(state.bigBlind) || 10);

  const firstToAct = nextIndexFrom(state, state.buttonIndex + 1, (entry) => canAct(entry));
  state.turnIndex = firstToAct === -1 ? 0 : firstToAct;
};

const finalizeRound = (state) => {
  state.settled = true;
  state.payoutApplied = false;
  state.roundClearAt = new Date(Date.now() + ROUND_CLEAR_DELAY_MS).toISOString();
  state.players.forEach((entry) => {
    entry.status = Number(entry.lastPayout || 0) > 0 ? "waiting" : "sitting";
    entry.lastCommitted = Number(entry.committed || 0);
  });
};

const settleSingleWinner = (state, winnerId) => {
  state.players.forEach((entry) => {
    const isWinner = entry.id === winnerId;
    const winnings = isWinner ? Number(state.pot || 0) : 0;
    const refund = Number(entry.stack || 0);
    entry.lastPayout = winnings + refund;
    entry.lastResult = isWinner ? "win" : "loss";
    entry.bestLabel = "";
    entry.bestIndexes = [];
  });
  state.inRound = false;
  state.phase = "showdown";
  writePotBreakdown(state, [
    {
      amount: Number(state.pot || 0),
      eligibleIds: state.players.filter((entry) => isInHand(entry)).map((entry) => entry.id),
      winnerIds: winnerId ? [winnerId] : [],
    },
  ]);
  finalizeRound(state);
};

const settleShowdown = (state) => {
  while ((state.community || []).length < 5) {
    state.community.push(draw(state.deck));
  }

  const contenders = state.players.filter((entry) => isInHand(entry));
  if (contenders.length === 0) {
    state.players.forEach((entry) => {
      entry.lastPayout = Number(entry.stack || 0);
      entry.lastResult = "loss";
      entry.bestLabel = "";
      entry.bestIndexes = [];
    });
    finalizeRound(state);
    return;
  }

  const rankedById = new Map();
  contenders.forEach((entry) => {
    const best = bestHoldemHand([...(entry.cards || []), ...(state.community || [])]);
    rankedById.set(entry.id, best);
  });

  const segments = buildPotSegments(state);
  const payouts = new Map();
  segments.forEach((segment) => {
    const eligible = state.players.filter((entry) => segment.eligibleIds.includes(entry.id));
    if (!eligible.length) return;

    let bestEval = null;
    eligible.forEach((entry) => {
      const hand = rankedById.get(entry.id);
      if (!hand) return;
      if (!bestEval || compareEval(hand.eval, bestEval) > 0) bestEval = hand.eval;
    });

    const winners = eligible.filter((entry) => {
      const hand = rankedById.get(entry.id);
      return hand && compareEval(hand.eval, bestEval) === 0;
    });
    if (!winners.length) return;

    segment.winnerIds = winners.map((entry) => entry.id);
    const share = Math.floor(segment.amount / winners.length);
    let remainder = segment.amount - share * winners.length;
    winners.forEach((winner) => {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      payouts.set(winner.id, (payouts.get(winner.id) || 0) + share + extra);
    });
  });
  writePotBreakdown(state, segments);

  state.players.forEach((entry) => {
    const winnings = Number(payouts.get(entry.id) || 0);
    const refund = Number(entry.stack || 0);
    const committed = Number(entry.committed || 0);
    entry.lastPayout = winnings + refund;
    const net = winnings - committed;
    entry.lastResult = net > 0 ? "win" : net < 0 ? "loss" : "push";
    const best = rankedById.get(entry.id);
    entry.bestLabel = best?.eval?.label || "";
    entry.bestIndexes = Array.isArray(best?.indexes) ? best.indexes.slice() : [];
    if (!isInHand(entry) && committed > 0 && winnings === 0) {
      entry.lastResult = "loss";
      entry.bestLabel = "";
      entry.bestIndexes = [];
    }
  });

  finalizeRound(state);
};

function progressState(state) {
  writePotBreakdown(state, buildPotSegments(state));
  if (!state.inRound) {
    if (state.phase === "showdown" && !state.settled) settleShowdown(state);
    return;
  }

  while (state.inRound) {
    const contenders = state.players.filter((entry) => isInHand(entry));
    if (contenders.length <= 1) {
      settleSingleWinner(state, contenders[0]?.id || "");
      return;
    }

    const actionable = state.players.filter((entry) => canAct(entry));
    if (actionable.length === 0) {
      if (state.phase === "river") {
        state.inRound = false;
        state.phase = "showdown";
        settleShowdown(state);
        return;
      }
      advanceStreet(state);
      continue;
    }

    const allActedAndMatched = actionable.every(
      (entry) => Boolean(entry.acted) && Number(entry.roundBet || 0) === Number(state.currentBet || 0)
    );

    if (allActedAndMatched) {
      if (state.phase === "river") {
        state.inRound = false;
        state.phase = "showdown";
        settleShowdown(state);
        return;
      }
      advanceStreet(state);
      continue;
    }

    const current = state.players[state.turnIndex];
    if (!current || !canAct(current)) {
      const next = nextIndexFrom(state, state.turnIndex + 1, (entry) => canAct(entry));
      state.turnIndex = next === -1 ? 0 : next;
    }
    return;
  }
}

const startRound = (state, stackByPlayerId = {}) => {
  if (!Array.isArray(state.players) || state.players.length === 0) {
    return { error: "No players in the room." };
  }

  const readyIndexes = [];
  state.players.forEach((entry, index) => {
    const available = Math.max(
      0,
      Number(
        Object.prototype.hasOwnProperty.call(stackByPlayerId, entry.id)
          ? stackByPlayerId[entry.id]
          : entry.betAmount || 0
      )
    );
    if (available > 0) readyIndexes.push(index);
  });
  if (readyIndexes.length < 2) {
    return { error: "Need at least 2 players with chips to start." };
  }

  state.deck = shuffle(buildDeck());
  state.community = [];
  state.pot = 0;
  state.potBreakdown = [];
  state.phase = "preflop";
  state.inRound = true;
  state.settled = false;
  state.payoutApplied = false;
  state.roundClearAt = null;
  state.currentBet = 0;
  state.minRaise = Math.max(1, Number(state.bigBlind) || 10);

  state.players = state.players.map((entry, index) => {
    const next = normalizePlayer(entry);
    const available = Math.max(
      0,
      Number(
        Object.prototype.hasOwnProperty.call(stackByPlayerId, next.id)
          ? stackByPlayerId[next.id]
          : next.betAmount || 0
      )
    );
    const active = readyIndexes.includes(index) && available > 0;
    next.cards = active ? [draw(state.deck), draw(state.deck)] : [];
    next.folded = !active;
    next.acted = false;
    next.allIn = false;
    next.stack = active ? available : 0;
    next.roundBet = 0;
    next.committed = 0;
    next.status = active ? "playing" : "sitting";
    next.lastResult = "";
    next.lastPayout = 0;
    next.lastCommitted = 0;
    next.bestLabel = "";
    next.lastAction = "";
    return next;
  });

  const activeByIndex = (idx) => readyIndexes.includes(idx) && isInHand(state.players[idx]);
  const button = nextIndexFrom(state, state.buttonIndex + 1, (_, idx) => activeByIndex(idx));
  if (button === -1) return { error: "No active players." };

  state.buttonIndex = button;
  state.smallBlindIndex = nextIndexFrom(state, button + 1, (_, idx) => activeByIndex(idx));
  state.bigBlindIndex = nextIndexFrom(state, state.smallBlindIndex + 1, (_, idx) => activeByIndex(idx));

  if (state.smallBlindIndex === -1 || state.bigBlindIndex === -1) {
    return { error: "Need at least 2 active players." };
  }

  const sb = state.players[state.smallBlindIndex];
  const bb = state.players[state.bigBlindIndex];
  applyBet(sb, Number(state.smallBlind || 5), state);
  applyBet(bb, Number(state.bigBlind || 10), state);
  sb.lastAction = "small-blind";
  bb.lastAction = "big-blind";
  state.currentBet = Math.max(Number(sb.roundBet || 0), Number(bb.roundBet || 0));

  state.turnIndex = nextIndexFrom(state, state.bigBlindIndex + 1, (entry) => canAct(entry));
  if (state.turnIndex === -1) state.turnIndex = 0;

  progressState(state);
  state.updatedAt = new Date().toISOString();
  return { state };
};

const withTurn = (state, playerId, fn) => {
  if (!state.inRound) return { error: "Round not active." };
  const player = state.players[state.turnIndex] || null;
  if (!player || player.id !== playerId) return { error: "Not your turn." };
  if (!canAct(player)) return { error: "Player cannot act." };
  return fn(player);
};

const advanceTurnCursor = (state) => {
  const next = nextIndexFrom(state, state.turnIndex + 1, (entry) => canAct(entry));
  if (next !== -1) state.turnIndex = next;
};

const applyCheck = (state, playerId) =>
  withTurn(state, playerId, (player) => {
    const toCall = Math.max(0, Number(state.currentBet || 0) - Number(player.roundBet || 0));
    if (toCall > 0) return { error: "Cannot check. Call or fold." };
    player.acted = true;
    player.lastAction = "check";
    advanceTurnCursor(state);
    progressState(state);
    state.updatedAt = new Date().toISOString();
    return { state };
  });

const applyCall = (state, playerId) =>
  withTurn(state, playerId, (player) => {
    const toCall = Math.max(0, Number(state.currentBet || 0) - Number(player.roundBet || 0));
    if (toCall <= 0) return { error: "Nothing to call." };
    const paid = applyBet(player, toCall, state);
    if (paid <= 0) return { error: "No chips left to call." };
    player.acted = true;
    player.lastAction = paid < toCall ? "all-in" : "call";
    advanceTurnCursor(state);
    progressState(state);
    state.updatedAt = new Date().toISOString();
    return { state };
  });

const applyRaise = (state, playerId, raiseByAmount) =>
  withTurn(state, playerId, (player) => {
    const toCall = Math.max(0, Number(state.currentBet || 0) - Number(player.roundBet || 0));
    const raiseBy = Math.max(0, Number(raiseByAmount) || 0);

    if (toCall <= 0 && raiseBy <= 0) {
      return { error: "Enter a raise amount or check." };
    }

    const minRaise = Math.max(1, Number(state.minRaise || state.bigBlind || 10));
    const targetTotal = toCall + raiseBy;
    const available = Number(player.stack || 0);
    if (available <= 0) return { error: "No chips left." };

    const pay = Math.min(targetTotal > 0 ? targetTotal : toCall, available);
    const newBet = Number(player.roundBet || 0) + pay;
    const raiseSize = newBet - Number(state.currentBet || 0);
    const isAllIn = pay >= available;

    if (raiseSize <= 0) {
      if (toCall > 0) {
        const paid = applyBet(player, toCall, state);
        if (paid <= 0) return { error: "No chips left to call." };
        player.acted = true;
        player.lastAction = paid < toCall ? "all-in" : "call";
        advanceTurnCursor(state);
        progressState(state);
        state.updatedAt = new Date().toISOString();
        return { state };
      }
      return { error: "Invalid raise." };
    }

    // Minimum legal raise is at least the last raise increment.
    if (raiseBy > 0 && raiseBy < minRaise && !isAllIn) {
      return { error: `Minimum raise is $${minRaise}.` };
    }

    const actualPaid = applyBet(player, pay, state);
    if (actualPaid <= 0) return { error: "Invalid raise." };

    state.currentBet = Math.max(Number(state.currentBet || 0), Number(player.roundBet || 0));
    if (raiseSize >= minRaise) state.minRaise = raiseSize;

    state.players.forEach((entry) => {
      if (!canAct(entry)) return;
      entry.acted = entry.id === player.id;
    });

    player.lastAction = player.allIn ? "all-in" : "raise";
    advanceTurnCursor(state);
    progressState(state);
    state.updatedAt = new Date().toISOString();
    return { state };
  });

const applyFold = (state, playerId) =>
  withTurn(state, playerId, (player) => {
    player.folded = true;
    player.status = "folded";
    player.acted = true;
    player.lastAction = "fold";
    advanceTurnCursor(state);
    progressState(state);
    state.updatedAt = new Date().toISOString();
    return { state };
  });

const getRoundClearAtMs = (state) => {
  const ms = Date.parse(state?.roundClearAt || "");
  return Number.isFinite(ms) ? ms : 0;
};

const isRoundClearPending = (state, nowMs = Date.now()) =>
  Boolean(state?.phase === "showdown" && getRoundClearAtMs(state) > nowMs);

const clearCompletedRound = (state) => {
  if (!state || state.phase !== "showdown") return false;
  state.community = [];
  state.pot = 0;
  state.potBreakdown = [];
  state.inRound = false;
  state.phase = "lobby";
  state.settled = false;
  state.payoutApplied = false;
  state.roundClearAt = null;
  state.turnIndex = 0;
  state.currentBet = 0;
  state.players = (state.players || []).map((entry) => ({
    ...entry,
    cards: [],
    folded: false,
    acted: false,
    allIn: false,
    stack: 0,
    roundBet: 0,
    committed: 0,
    status: "waiting",
    lastResult: "",
    lastPayout: 0,
    lastCommitted: 0,
    bestLabel: "",
    bestIndexes: [],
    lastAction: "",
  }));
  state.updatedAt = new Date().toISOString();
  return true;
};

module.exports = {
  ROUND_CLEAR_DELAY_MS,
  createHoldemMultiState,
  addPlayer,
  removePlayer,
  startRound,
  applyCheck,
  applyCall,
  applyRaise,
  applyFold,
  getRoundClearAtMs,
  isRoundClearPending,
  clearCompletedRound,
};
