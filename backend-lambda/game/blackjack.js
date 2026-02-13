const { buildDeck, shuffle, draw } = require("./cards");

const ROUND_CLEAR_DELAY_MS = 4000;

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

const playDealer = (dealerHand, deck) => {
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

const canSplit = (player) => {
  if (player.splitUsed) return false;
  const hand = player.hands[player.activeHand] || [];
  return hand.length === 2 && hand[0].rank === hand[1].rank;
};

const advanceHand = (player) => {
  if (player.activeHand < player.hands.length - 1) {
    player.activeHand += 1;
    return false;
  }
  return true;
};

const applyPlayerHit = (player, deck) => {
  const hand = player.hands[player.activeHand];
  hand.push(draw(deck));
  const total = handTotal(hand);
  const messages = [];
  let finished = false;
  if (total > 21) {
    player.busted[player.activeHand] = true;
    const multiple = player.hands.length > 1;
    messages.push({
      text: multiple ? `Hand ${player.activeHand + 1} busts.` : "You bust.",
      tone: "danger",
    });
    finished = advanceHand(player);
  }
  return { messages, finished };
};

const applyPlayerStand = (player) => ({ messages: [], finished: advanceHand(player) });

const applyPlayerDouble = (player, deck) => {
  const hand = player.hands[player.activeHand];
  const bet = player.bets[player.activeHand];
  player.bets[player.activeHand] = bet * 2;
  player.doubled[player.activeHand] = true;
  hand.push(draw(deck));
  const total = handTotal(hand);
  const messages = [];
  if (total > 21) {
    player.busted[player.activeHand] = true;
    const multiple = player.hands.length > 1;
    messages.push({
      text: multiple ? `Hand ${player.activeHand + 1} busts.` : "You bust.",
      tone: "danger",
    });
  }
  return { messages, finished: advanceHand(player) };
};

const applyPlayerSplit = (player, deck) => {
  if (!canSplit(player)) {
    return { error: "Cannot split now." };
  }
  const bet = player.bets[player.activeHand];
  const hand = player.hands[player.activeHand];
  const cardA = hand[0];
  const cardB = hand[1];
  player.hands = [
    [cardA, draw(deck)],
    [cardB, draw(deck)],
  ];
  player.bets = [bet, bet];
  player.doubled = [false, false];
  player.busted = [false, false];
  player.activeHand = 0;
  player.splitUsed = true;
  return { messages: [], finished: false };
};

const resolveOutcomes = (player, dealerTotal) => {
  const outcomes = [];
  let payoutTotal = 0;
  player.hands.forEach((hand, index) => {
    const bet = player.bets[index];
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
    payoutTotal += bet;
    outcomes.push({ index, result: "push", net: 0 });
  });
  return { outcomes, payoutTotal };
};

const normalizePlayer = (player) => ({
  id: player.id,
  username: player.username || "Guest",
  hands: Array.isArray(player.hands) ? player.hands : [],
  bets: Array.isArray(player.bets) ? player.bets : [],
  doubled: Array.isArray(player.doubled) ? player.doubled : [],
  busted: Array.isArray(player.busted) ? player.busted : [],
  activeHand: Number.isFinite(player.activeHand) ? player.activeHand : 0,
  splitUsed: Boolean(player.splitUsed),
  betAmount: Number(player.betAmount) || 0,
  lastBet: Number(player.lastBet) || 0,
  status: player.status || "waiting",
  lastResult: player.lastResult || "",
  total: Number.isFinite(player.total) ? player.total : 0,
});

const createBlackjackState = ({ roomId, host, hostId, maxPlayers = 5 }) => ({
  game: "blackjack",
  roomId,
  host: host || "host",
  hostId: hostId || "",
  maxPlayers,
  players: [],
  dealer: [],
  deck: [],
  inRound: false,
  revealDealer: false,
  settled: false,
  phase: "lobby",
  turnIndex: 0,
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
  next.push(normalizePlayer({ ...player, hand: [], status: "waiting" }));
  const hostMissing =
    !state.hostId || !next.find((entry) => entry.id === state.hostId);
  if (hostMissing && next.length === 1) {
    state.hostId = player.id;
    state.host = player.username || state.host;
  }
  state.players = next;
  state.updatedAt = new Date().toISOString();
  return state;
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
      resolveDealer(state);
    } else {
      state.turnIndex = nextIndex;
    }
  }
  state.updatedAt = new Date().toISOString();
  return state;
};

const resetForRound = (state) => {
  state.deck = shuffle(buildDeck());
  state.dealer = [draw(state.deck), draw(state.deck)];
  state.revealDealer = false;
  state.inRound = true;
  state.settled = false;
  state.phase = "player";
  state.roundClearAt = null;
  state.turnIndex = 0;
  state.players = state.players.map((player) => {
    if (!player.betAmount || player.betAmount <= 0) {
      return {
        ...player,
        status: "sitting",
        hands: [],
        bets: [],
        doubled: [],
        busted: [],
        activeHand: 0,
        splitUsed: false,
        lastResult: "",
        total: 0,
      };
    }
    const hands = [[draw(state.deck), draw(state.deck)]];
    return {
      ...player,
      hands,
      bets: [player.betAmount],
      doubled: [false],
      busted: [false],
      activeHand: 0,
      splitUsed: false,
      status: "playing",
      lastResult: "",
      total: handTotal(hands[0]),
    };
  });
  const nextIndex = findNextActiveIndex(state, 0);
  state.turnIndex = nextIndex === -1 ? 0 : nextIndex;
  state.updatedAt = new Date().toISOString();
};

const currentPlayer = (state) => state.players[state.turnIndex] || null;

const findNextActiveIndex = (state, startIndex) => {
  for (let i = startIndex; i < state.players.length; i += 1) {
    if (state.players[i].status === "playing") return i;
  }
  return -1;
};

const advanceTurn = (state) => {
  const nextIndex = findNextActiveIndex(state, state.turnIndex + 1);
  if (nextIndex !== -1) {
    state.turnIndex = nextIndex;
    return;
  }
  resolveDealer(state);
};

const resolveDealer = (state) => {
  if (!state.inRound) return;
  const allBusted = state.players.every((player) =>
    Array.isArray(player.busted) && player.busted.length > 0
      ? player.busted.every(Boolean)
      : true
  );
  const dealerTotal = allBusted ? handTotal(state.dealer) : playDealer(state.dealer, state.deck);
  state.revealDealer = true;
  state.players.forEach((player) => {
    if (!player.hands || player.hands.length === 0) {
      player.lastResult = "";
      return;
    }
    const resolved = resolveOutcomes(
      {
        hands: player.hands,
        bets: player.bets,
        busted: player.busted,
      },
      dealerTotal
    );
    const results = resolved.outcomes.map((outcome) => outcome.result);
    const summary = results.includes("win")
      ? "win"
      : results.includes("push")
        ? "push"
        : results.includes("loss")
          ? "loss"
          : "bust";
    player.lastResult = summary;
    player.lastOutcomes = resolved.outcomes;
    player.lastPayout = resolved.payoutTotal;
    const activeHand = player.hands[player.activeHand] || player.hands[0];
    player.total = activeHand ? handTotal(activeHand) : 0;
  });
  state.inRound = false;
  state.phase = "complete";
  state.roundClearAt = new Date(Date.now() + ROUND_CLEAR_DELAY_MS).toISOString();
  state.updatedAt = new Date().toISOString();
};

const getRoundClearAtMs = (state) => {
  const ms = Date.parse(state?.roundClearAt || "");
  return Number.isFinite(ms) ? ms : 0;
};

const isRoundClearPending = (state, nowMs = Date.now()) =>
  Boolean(state?.phase === "complete" && getRoundClearAtMs(state) > nowMs);

const clearCompletedRound = (state) => {
  if (!state || state.phase !== "complete") return false;
  state.dealer = [];
  state.revealDealer = false;
  state.settled = false;
  state.phase = "lobby";
  state.roundClearAt = null;
  state.turnIndex = 0;
  state.players = (state.players || []).map((player) => ({
    ...player,
    hands: [],
    bets: [],
    doubled: [],
    busted: [],
    activeHand: 0,
    splitUsed: false,
    total: 0,
    lastResult: "",
    lastOutcomes: [],
    lastPayout: 0,
    status: player.betAmount > 0 ? "waiting" : "sitting",
  }));
  state.updatedAt = new Date().toISOString();
  return true;
};

const startRound = (state) => {
  if (!state.players.length) {
    return { error: "No players in the room." };
  }
  resetForRound(state);
  return { state };
};

const applyPlayerAction = (state, playerId, actionFn, { forceNotFinished = false } = {}) => {
  if (!state.inRound) return { error: "Round not active." };
  const player = currentPlayer(state);
  if (!player || player.id !== playerId) {
    return { error: "Not your turn." };
  }
  const result = actionFn(player);
  if (result?.error) return result;
  const finished = forceNotFinished ? false : Boolean(result?.finished);
  const activeHand = player.hands[player.activeHand] || [];
  player.total = handTotal(activeHand);
  if (finished) {
    player.status = "done";
    advanceTurn(state);
  }
  state.updatedAt = new Date().toISOString();
  return undefined;
};

const applyHit = (state, playerId) =>
  applyPlayerAction(state, playerId, (player) => applyPlayerHit(player, state.deck));

const applyStand = (state, playerId) =>
  applyPlayerAction(state, playerId, (player) => applyPlayerStand(player));

const applyDouble = (state, playerId) =>
  applyPlayerAction(state, playerId, (player) => applyPlayerDouble(player, state.deck));

const applySplit = (state, playerId) =>
  applyPlayerAction(
    state,
    playerId,
    (player) => applyPlayerSplit(player, state.deck),
    { forceNotFinished: true }
  );

module.exports = {
  ROUND_CLEAR_DELAY_MS,
  createBlackjackState,
  addPlayer,
  removePlayer,
  startRound,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
  resolveDealer,
  getRoundClearAtMs,
  isRoundClearPending,
  clearCompletedRound,
  handTotal,
  resolveOutcomes,
};
