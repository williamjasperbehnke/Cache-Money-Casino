const { buildDeck, shuffle, draw, evaluateFiveCardHand } = require("./cards");

const ROUND_CLEAR_DELAY_MS = 5000;

const normalizePlayer = (player) => ({
  id: player.id,
  username: player.username || "Guest",
  cards: Array.isArray(player.cards) ? player.cards : [],
  folded: Boolean(player.folded),
  acted: Boolean(player.acted),
  betAmount: Number(player.betAmount) || 0,
  lastBet: Number(player.lastBet) || 0,
  status: player.status || "waiting",
  lastResult: player.lastResult || "",
  lastPayout: Number(player.lastPayout) || 0,
  bestLabel: player.bestLabel || "",
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
  phase: "lobby",
  inRound: false,
  turnIndex: 0,
  deck: [],
  settled: false,
  payoutApplied: false,
  roundClearAt: null,
  updatedAt: new Date().toISOString(),
});

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
      lastResult: "",
      lastPayout: 0,
      bestLabel: "",
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

const findNextActiveIndex = (state, startIndex) => {
  for (let i = startIndex; i < state.players.length; i += 1) {
    const player = state.players[i];
    if (player.status === "playing" && !player.folded) return i;
  }
  return -1;
};

const removePlayer = (state, playerId) => {
  const idx = state.players.findIndex((entry) => entry.id === playerId);
  if (idx === -1) return state;
  const wasHost = state.hostId === playerId;
  const wasCurrent = idx === state.turnIndex;
  state.players.splice(idx, 1);
  if (state.turnIndex > idx) state.turnIndex -= 1;
  if (state.turnIndex >= state.players.length) state.turnIndex = 0;
  if (wasHost) {
    const nextHost = state.players[0];
    state.hostId = nextHost ? nextHost.id : "";
    state.host = nextHost ? nextHost.username : "";
  }
  if (state.inRound && wasCurrent) {
    const nextIndex = findNextActiveIndex(state, idx);
    if (nextIndex === -1) {
      state.inRound = false;
      state.phase = "showdown";
    } else {
      state.turnIndex = nextIndex;
    }
  }
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

const activePlayers = (state) =>
  state.players.filter((entry) => entry.status === "playing" && !entry.folded);

const clearActedFlags = (state) => {
  state.players.forEach((entry) => {
    if (entry.status === "playing" && !entry.folded) entry.acted = false;
  });
};

const advancePhase = (state) => {
  if (state.phase === "preflop") {
    state.phase = "flop";
    state.community = [draw(state.deck), draw(state.deck), draw(state.deck)];
  } else if (state.phase === "flop") {
    state.phase = "turn";
    state.community.push(draw(state.deck));
  } else if (state.phase === "turn") {
    state.phase = "river";
    state.community.push(draw(state.deck));
  } else {
    state.phase = "showdown";
    state.inRound = false;
  }
  clearActedFlags(state);
};

const settleShowdown = (state) => {
  const contenders = activePlayers(state);
  if (contenders.length === 0) {
    state.players.forEach((entry) => {
      entry.lastResult = "loss";
      entry.lastPayout = 0;
      entry.bestLabel = "";
      entry.status = entry.betAmount > 0 ? "waiting" : "sitting";
    });
    state.settled = true;
    state.payoutApplied = false;
    state.roundClearAt = new Date(Date.now() + ROUND_CLEAR_DELAY_MS).toISOString();
    return;
  }

  const ranked = contenders.map((entry) => {
    const best = bestHoldemHand([...(entry.cards || []), ...(state.community || [])]);
    return { entry, best };
  });

  let bestEval = null;
  ranked.forEach(({ best }) => {
    if (!bestEval || compareEval(best.eval, bestEval) > 0) bestEval = best.eval;
  });

  const winners = ranked.filter(({ best }) => compareEval(best.eval, bestEval) === 0);
  const share = winners.length > 0 ? Math.floor(state.pot / winners.length) : 0;
  let remainder = state.pot - share * winners.length;

  state.players.forEach((entry) => {
    const winnerIndex = winners.findIndex((winner) => winner.entry.id === entry.id);
    const isWinner = winnerIndex >= 0;
    const payout = isWinner ? share + (remainder > 0 ? 1 : 0) : 0;
    if (isWinner && remainder > 0) remainder -= 1;
    entry.lastPayout = payout;
    entry.lastResult = isWinner ? "win" : "loss";
    const rankedEntry = ranked.find((row) => row.entry.id === entry.id);
    entry.bestLabel = rankedEntry?.best?.eval?.label || "";
    entry.status = entry.betAmount > 0 ? "waiting" : "sitting";
  });

  state.settled = true;
  state.payoutApplied = false;
  state.roundClearAt = new Date(Date.now() + ROUND_CLEAR_DELAY_MS).toISOString();
};

const maybeAdvanceTurn = (state) => {
  const contenders = activePlayers(state);
  if (contenders.length <= 1) {
    state.phase = "showdown";
    state.inRound = false;
    return;
  }

  const allActed = contenders.every((entry) => entry.acted);
  if (allActed) {
    advancePhase(state);
    if (state.phase === "showdown") return;
    const first = findNextActiveIndex(state, 0);
    state.turnIndex = first === -1 ? 0 : first;
    return;
  }

  let nextIndex = findNextActiveIndex(state, state.turnIndex + 1);
  if (nextIndex === -1) nextIndex = findNextActiveIndex(state, 0);
  state.turnIndex = nextIndex === -1 ? 0 : nextIndex;
};

const startRound = (state) => {
  if (!Array.isArray(state.players) || state.players.length === 0) {
    return { error: "No players in the room." };
  }
  const ready = state.players.filter((entry) => Number(entry.betAmount || 0) > 0);
  if (ready.length < 2) {
    return { error: "Need at least 2 players with bets to start." };
  }
  state.deck = shuffle(buildDeck());
  state.community = [];
  state.pot = ready.reduce((sum, entry) => sum + Number(entry.betAmount || 0), 0);
  state.phase = "preflop";
  state.inRound = true;
  state.settled = false;
  state.payoutApplied = false;
  state.roundClearAt = null;

  state.players = state.players.map((entry) => {
    const next = normalizePlayer(entry);
    const active = Number(next.betAmount || 0) > 0;
    next.cards = active ? [draw(state.deck), draw(state.deck)] : [];
    next.folded = !active;
    next.acted = false;
    next.status = active ? "playing" : "sitting";
    next.lastResult = "";
    next.lastPayout = 0;
    next.bestLabel = "";
    return next;
  });

  const first = findNextActiveIndex(state, 0);
  state.turnIndex = first === -1 ? 0 : first;
  state.updatedAt = new Date().toISOString();
  return { state };
};

const withTurn = (state, playerId, fn) => {
  if (!state.inRound) return { error: "Round not active." };
  const player = state.players[state.turnIndex] || null;
  if (!player || player.id !== playerId) return { error: "Not your turn." };
  if (player.folded || player.status !== "playing") return { error: "Player cannot act." };
  return fn(player);
};

const applyCheck = (state, playerId) =>
  withTurn(state, playerId, (player) => {
    player.acted = true;
    maybeAdvanceTurn(state);
    if (!state.inRound && state.phase === "showdown") {
      settleShowdown(state);
    }
    state.updatedAt = new Date().toISOString();
    return { state };
  });

const applyFold = (state, playerId) =>
  withTurn(state, playerId, (player) => {
    player.folded = true;
    player.status = "folded";
    player.acted = true;
    maybeAdvanceTurn(state);
    if (!state.inRound && state.phase === "showdown") {
      settleShowdown(state);
    }
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
  state.inRound = false;
  state.phase = "lobby";
  state.settled = false;
  state.payoutApplied = false;
  state.roundClearAt = null;
  state.turnIndex = 0;
  state.players = (state.players || []).map((entry) => ({
    ...entry,
    cards: [],
    folded: false,
    acted: false,
    status: entry.betAmount > 0 ? "waiting" : "sitting",
    lastResult: "",
    lastPayout: 0,
    bestLabel: "",
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
  applyFold,
  getRoundClearAtMs,
  isRoundClearPending,
  clearCompletedRound,
};
