const { buildDeck, shuffle, draw } = require("./cards");

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

const normalizePlayer = (player) => ({
  id: player.id,
  username: player.username || "Guest",
  hand: Array.isArray(player.hand) ? player.hand : [],
  status: player.status || "waiting",
  lastResult: player.lastResult || "",
  total: Number.isFinite(player.total) ? player.total : 0,
});

const createBlackjackMultiState = ({ roomId, host, hostId, maxPlayers = 5 }) => ({
  game: "blackjack-multi",
  roomId,
  host: host || "host",
  hostId: hostId || "",
  maxPlayers,
  players: [],
  dealer: [],
  deck: [],
  inRound: false,
  revealDealer: false,
  phase: "lobby",
  turnIndex: 0,
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
  state.phase = "player";
  state.turnIndex = 0;
  state.players = state.players.map((player) => ({
    ...player,
    hand: [draw(state.deck), draw(state.deck)],
    status: "playing",
    lastResult: "",
    total: 0,
  }));
  state.players.forEach((player) => {
    player.total = handTotal(player.hand);
  });
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
  while (handTotal(state.dealer) < 17) {
    state.dealer.push(draw(state.deck));
  }
  state.revealDealer = true;
  const dealerTotal = handTotal(state.dealer);
  state.players.forEach((player) => {
    const total = handTotal(player.hand);
    player.total = total;
    if (total > 21) {
      player.lastResult = "bust";
      return;
    }
    if (dealerTotal > 21 || total > dealerTotal) {
      player.lastResult = "win";
      return;
    }
    if (total === dealerTotal) {
      player.lastResult = "push";
      return;
    }
    player.lastResult = "loss";
  });
  state.inRound = false;
  state.phase = "complete";
  state.updatedAt = new Date().toISOString();
};

const startRound = (state) => {
  if (!state.players.length) {
    return { error: "No players in the room." };
  }
  resetForRound(state);
  return { state };
};

const applyHit = (state, playerId) => {
  if (!state.inRound) return { error: "Round not active." };
  const player = currentPlayer(state);
  if (!player || player.id !== playerId) {
    return { error: "Not your turn." };
  }
  player.hand.push(draw(state.deck));
  player.total = handTotal(player.hand);
  if (player.total > 21) {
    player.status = "busted";
    advanceTurn(state);
  }
  state.updatedAt = new Date().toISOString();
  return { state };
};

const applyStand = (state, playerId) => {
  if (!state.inRound) return { error: "Round not active." };
  const player = currentPlayer(state);
  if (!player || player.id !== playerId) {
    return { error: "Not your turn." };
  }
  player.status = "stood";
  advanceTurn(state);
  state.updatedAt = new Date().toISOString();
  return { state };
};

module.exports = {
  handTotal,
  createBlackjackMultiState,
  addPlayer,
  removePlayer,
  startRound,
  applyHit,
  applyStand,
};
