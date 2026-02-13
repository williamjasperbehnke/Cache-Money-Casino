const { jsonResponse, parseJson } = require("./lib/utils");
const {
  sendToConnection,
  hasRoomsConfig,
  getConnection,
  setConnectionRoom,
  addRoomMember,
  removeRoomMember,
  getRoomMeta,
  getRoomState,
  saveRoomState,
  updateRoomMeta,
  closeRoom,
  closeRoomIfExpired,
  listRoomConnections,
  broadcastRoomState,
  cleanupRoomForConnection,
} = require("./lib/ws_rooms");
const { isRoomExpired } = require("./lib/room_expiration");
const {
  startRound,
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
  isRoundClearPending,
  clearCompletedRound,
  handTotal,
  resolveOutcomes,
} = require("./game/blackjack");
const {
  startRound: startHoldemRound,
  applyCheck: applyHoldemCheck,
  applyCall: applyHoldemCall,
  applyRaise: applyHoldemRaise,
  applyFold: applyHoldemFold,
  isRoundClearPending: isHoldemRoundClearPending,
  clearCompletedRound: clearHoldemCompletedRound,
} = require("./game/holdem");
const { updateStats } = require("./lib/stats");
const { getSession, resolveBalance, persistBalance, putUser } = require("./lib/session");

const { CORS_ORIGIN = "*" } = process.env;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const okResponse = (ok = true) => jsonResponse(200, { ok }, CORS_ORIGIN);
const failResponse = () => okResponse(false);

const sendWsError = async (endpoint, connectionId, error, { ok = false } = {}) => {
  await sendToConnection(endpoint, connectionId, { type: "ERROR", error });
  return ok ? okResponse() : failResponse();
};

const requireSessionContext = async ({ endpoint, connectionId, token }) => {
  if (!token) {
    await sendWsError(endpoint, connectionId, "Session missing.");
    return null;
  }
  const session = await getSession(token);
  if (!session) {
    await sendWsError(endpoint, connectionId, "Session missing.");
    return null;
  }
  const { user, balance } = await resolveBalance(session);
  return { session, user, balance };
};

const loadValidatedRoomState = async ({ endpoint, connectionId, connection, payload }) => {
  const roomId = payload.roomId || connection.room_id;
  if (!roomId) {
    await sendWsError(endpoint, connectionId, "Missing room.");
    return null;
  }
  if (connection.room_id && connection.room_id !== roomId) {
    await sendWsError(endpoint, connectionId, "Not in this room.");
    return null;
  }
  if (await closeRoomIfExpired(roomId)) {
    await sendWsError(endpoint, connectionId, "Room expired due to inactivity.");
    return null;
  }
  const state = await getRoomState(roomId);
  if (!state) {
    await sendWsError(endpoint, connectionId, "Room not found.");
    return null;
  }
  return { roomId, state };
};

const persistAndBroadcastRoom = async ({ endpoint, roomId, state }) => {
  await saveRoomState(roomId, state);
  await updateRoomMeta(roomId, state);
  await broadcastRoomState(endpoint, roomId, state);
};

const maybeClearRoundAfterSettle = async ({
  roomId,
  state,
  expectedPhase,
  isPending,
  clearFn,
  endpoint,
}) => {
  const clearAtMs = Date.parse(state?.roundClearAt || "");
  if (!Number.isFinite(clearAtMs)) return;
  await delay(clearAtMs - Date.now() + 30);
  const latest = await getRoomState(roomId);
  if (!latest || latest.phase !== expectedPhase) return;
  if (isPending(latest)) return;
  if (!clearFn(latest)) return;
  await persistAndBroadcastRoom({ endpoint, roomId, state: latest });
};

const buildPlayerSessionMap = async (roomId) => {
  const entries = await listRoomConnections(roomId);
  const map = new Map();
  await Promise.all(
    entries.map(async (entry) => {
      const connectionId = entry.player_id;
      const connection = await getConnection(connectionId);
      if (!connection || !connection.player_id) return;
      if (!connection.token) return;
      const session = await getSession(connection.token);
      if (!session) return;
      const { user, balance } = await resolveBalance(session);
      map.set(connection.player_id, {
        session,
        user,
        balance,
        token: connection.token,
        connectionId,
      });
    })
  );
  return map;
};

const handleBlackjackAction = async ({
  endpoint,
  connectionId,
  connection,
  payload,
}) => {
  if (!hasRoomsConfig()) {
    return sendWsError(endpoint, connectionId, "Server not configured.");
  }
  const roomContext = await loadValidatedRoomState({ endpoint, connectionId, connection, payload });
  if (!roomContext) return failResponse();
  const { roomId, state } = roomContext;
  let settledThisAction = false;
  let autoClearedRound = false;
  const cooldownPending = isRoundClearPending(state);
  if (state.phase === "complete" && !cooldownPending) {
    clearCompletedRound(state);
    autoClearedRound = true;
  }
  const player = state.players.find((entry) => entry.id === connection.player_id);
  let result = { state };
  const debitCurrentHandBet = async () => {
    const sessionContext = await requireSessionContext({
      endpoint,
      connectionId,
      token: connection.token,
    });
    if (!sessionContext) return { error: true };
    const { session, user, balance } = sessionContext;
    const currentBet = player?.bets?.[player.activeHand] || 0;
    if (balance < currentBet) {
      await sendWsError(endpoint, connectionId, "Not enough credits.");
      return { error: true };
    }
    const nextBalance = await persistBalance(session, user, balance - currentBet);
    await sendToConnection(endpoint, connectionId, {
      type: "BALANCE_UPDATE",
      balance: nextBalance,
    });
    return { error: false };
  };

  if (payload.type === "BET") {
    if (!player) {
      return sendWsError(endpoint, connectionId, "Player not found.");
    }
    if (state.inRound) {
      return sendWsError(endpoint, connectionId, "Round already in progress.");
    }
    if (cooldownPending) {
      return sendWsError(endpoint, connectionId, "Round settling. Wait a moment.");
    }
    const sessionContext = await requireSessionContext({
      endpoint,
      connectionId,
      token: connection.token,
    });
    if (!sessionContext) return failResponse();
    const amount = Math.max(0, Number(payload.amount) || 0);
    const { balance } = sessionContext;
    if (amount > balance) {
      return sendWsError(endpoint, connectionId, "Not enough credits.");
    }
    player.betAmount = amount;
    if (amount > 0) player.lastBet = amount;
    player.status = amount > 0 ? "waiting" : "sitting";
    await persistAndBroadcastRoom({ endpoint, roomId, state });
    return okResponse();
  }

  if (!player && !["START", "BET"].includes(payload.type)) {
    return sendWsError(endpoint, connectionId, "Player not found.");
  }
  if (payload.type === "START") {
    if (state.hostId && state.hostId !== connection.player_id) {
      return sendWsError(endpoint, connectionId, "Only the host can start the round.");
    }
    if (cooldownPending) {
      return sendWsError(endpoint, connectionId, "Round settling. Wait a moment.");
    }
    const sessionMap = await buildPlayerSessionMap(roomId);
    const debitedPlayerIds = new Set();
    for (const entry of state.players) {
      const context = sessionMap.get(entry.id);
      if (!entry.betAmount || entry.betAmount <= 0 || !context) {
        entry.betAmount = 0;
        entry.status = "sitting";
        continue;
      }
      if (context.balance < entry.betAmount) {
        entry.betAmount = 0;
        entry.status = "sitting";
        await sendToConnection(endpoint, context.connectionId, {
          type: "ERROR",
          error: "Not enough credits for current bet.",
        });
        continue;
      }
      context.balance -= entry.betAmount;
      debitedPlayerIds.add(entry.id);
    }
    if (!state.players.some((entry) => entry.betAmount > 0)) {
      await sendToConnection(endpoint, connectionId, {
        type: "ERROR",
        error: "All players are sitting out. Place a bet to start.",
      });
      return failResponse();
    }
    for (const [playerId, context] of sessionMap.entries()) {
      if (!debitedPlayerIds.has(playerId)) continue;
      const nextBalance = await persistBalance(context.session, context.user, context.balance);
      await sendToConnection(endpoint, context.connectionId, {
        type: "BALANCE_UPDATE",
        balance: nextBalance,
      });
    }
    result = startRound(state);
  } else if (payload.type === "HIT") {
    result = applyHit(state, connection.player_id);
  } else if (payload.type === "STAND") {
    result = applyStand(state, connection.player_id);
  } else if (payload.type === "DOUBLE") {
    const debitResult = await debitCurrentHandBet();
    if (debitResult.error) return failResponse();
    result = applyDouble(state, connection.player_id);
  } else if (payload.type === "SPLIT") {
    const debitResult = await debitCurrentHandBet();
    if (debitResult.error) return failResponse();
    result = applySplit(state, connection.player_id);
  }

  if (result?.error) {
    if (autoClearedRound) {
      await persistAndBroadcastRoom({ endpoint, roomId, state });
    }
    return sendWsError(endpoint, connectionId, result.error);
  }
  if (!state.inRound && state.phase === "complete" && !state.settled) {
    const dealerTotal = handTotal(state.dealer || []);
    const sessionMap = await buildPlayerSessionMap(roomId);
    state.players.forEach((entry) => {
      if (!entry.hands || entry.hands.length === 0) return;
      const resolved = resolveOutcomes(
        { hands: entry.hands, bets: entry.bets, busted: entry.busted },
        dealerTotal
      );
      entry.lastPayout = resolved.payoutTotal;
      entry.lastOutcomes = resolved.outcomes;
      const context = sessionMap.get(entry.id);
      if (!context) return;
      const nextBalance = context.balance + resolved.payoutTotal;
      context.balance = nextBalance;
    });
    for (const [playerId, context] of sessionMap.entries()) {
      const entry = state.players.find((p) => p.id === playerId);
      if (!entry || !entry.hands || entry.hands.length === 0) continue;
      const resolved = resolveOutcomes(
        { hands: entry.hands, bets: entry.bets, busted: entry.busted },
        dealerTotal
      );
      const nextBalance = await persistBalance(context.session, context.user, context.balance);
      await sendToConnection(endpoint, context.connectionId, {
        type: "BALANCE_UPDATE",
        balance: nextBalance,
      });
      if (context.user) {
        resolved.outcomes.forEach((outcome) => {
          const bet = entry.bets[outcome.index] || 0;
          const net = outcome.net;
          const resultLabel = net > 0 ? "win" : net < 0 ? "loss" : "push";
          context.user.stats = updateStats(context.user.stats, {
            game: "blackjack",
            bet,
            net,
            result: resultLabel,
          });
        });
        await putUser(context.user);
      }
      entry.total = handTotal(entry.hands[entry.activeHand] || entry.hands[0] || []);
    }
    state.settled = true;
    settledThisAction = true;
  }
  await persistAndBroadcastRoom({ endpoint, roomId, state });
  if (settledThisAction && state.phase === "complete") {
    await maybeClearRoundAfterSettle({
      roomId,
      state,
      expectedPhase: "complete",
      isPending: isRoundClearPending,
      clearFn: clearCompletedRound,
      endpoint,
    });
  }
  return okResponse();
};

const handleHoldemAction = async ({
  endpoint,
  connectionId,
  connection,
  payload,
}) => {
  if (!hasRoomsConfig()) {
    return sendWsError(endpoint, connectionId, "Server not configured.");
  }
  const roomContext = await loadValidatedRoomState({ endpoint, connectionId, connection, payload });
  if (!roomContext) return failResponse();
  const { roomId, state } = roomContext;
  let settledThisAction = false;
  const cooldownPending = isHoldemRoundClearPending(state);
  if (state.phase === "showdown" && !cooldownPending) {
    clearHoldemCompletedRound(state);
  }
  const player = state.players.find((entry) => entry.id === connection.player_id);
  let result = { state };

  if (payload.type === "BET") {
    return sendWsError(
      endpoint,
      connectionId,
      "Pre-deal staking is disabled. Bets happen during the hand.",
      { ok: true }
    );
  }

  if (!player && !["START", "BET"].includes(payload.type)) {
    return sendWsError(endpoint, connectionId, "Player not found.");
  }

  if (payload.type === "START") {
    if (state.hostId && state.hostId !== connection.player_id) {
      return sendWsError(endpoint, connectionId, "Only the host can start the round.");
    }
    if (cooldownPending) {
      return sendWsError(endpoint, connectionId, "Round settling. Wait a moment.");
    }
    const sessionMap = await buildPlayerSessionMap(roomId);
    const stackByPlayerId = {};
    for (const entry of state.players) {
      const context = sessionMap.get(entry.id);
      stackByPlayerId[entry.id] = Math.max(0, Number(context?.balance || 0));
    }
    result = startHoldemRound(state, stackByPlayerId);
    if (!result?.error) {
      for (const [playerId, context] of sessionMap.entries()) {
        const entry = state.players.find((p) => p.id === playerId);
        if (!entry || entry.status !== "playing") continue;
        const nextBalance = await persistBalance(
          context.session,
          context.user,
          Math.max(0, Number(entry.stack || 0))
        );
        await sendToConnection(endpoint, context.connectionId, {
          type: "BALANCE_UPDATE",
          balance: nextBalance,
        });
      }
    }
  } else if (payload.type === "CHECK") {
    result = applyHoldemCheck(state, connection.player_id);
  } else if (payload.type === "CALL") {
    result = applyHoldemCall(state, connection.player_id);
  } else if (payload.type === "RAISE") {
    result = applyHoldemRaise(state, connection.player_id, Number(payload.amount) || 0);
  } else if (payload.type === "FOLD") {
    result = applyHoldemFold(state, connection.player_id);
  } else {
    return sendWsError(endpoint, connectionId, "Unknown action.");
  }

  if (result?.error) {
    return sendWsError(endpoint, connectionId, result.error);
  }

  if (["CALL", "RAISE"].includes(payload.type) && connection.token) {
    const session = await getSession(connection.token);
    const entry = state.players.find((p) => p.id === connection.player_id);
    if (session && entry) {
      const { user } = await resolveBalance(session);
      const nextBalance = await persistBalance(session, user, Math.max(0, Number(entry.stack || 0)));
      await sendToConnection(endpoint, connectionId, {
        type: "BALANCE_UPDATE",
        balance: nextBalance,
      });
    }
  }

  if (!state.inRound && state.phase === "showdown" && state.settled && !state.payoutApplied) {
    const sessionMap = await buildPlayerSessionMap(roomId);
    for (const [playerId, context] of sessionMap.entries()) {
      const entry = state.players.find((p) => p.id === playerId);
      if (!entry) continue;
      const committed = Math.max(0, Number(entry.lastCommitted || 0));
      if (committed <= 0) continue;
      const finalBalance = Math.max(0, Number(entry.lastPayout || 0));
      const nextBalance = await persistBalance(context.session, context.user, finalBalance);
      await sendToConnection(endpoint, context.connectionId, {
        type: "BALANCE_UPDATE",
        balance: nextBalance,
      });
      if (context.user) {
        const net = finalBalance - Number(context.balance || 0);
        context.user.stats = updateStats(context.user.stats, {
          game: "holdem",
          bet: committed,
          net,
          result: net > 0 ? "win" : net < 0 ? "loss" : "push",
        });
        await putUser(context.user);
      }
    }
    state.payoutApplied = true;
    settledThisAction = true;
  }

  await persistAndBroadcastRoom({ endpoint, roomId, state });
  if (settledThisAction && state.phase === "showdown") {
    await maybeClearRoundAfterSettle({
      roomId,
      state,
      expectedPhase: "showdown",
      isPending: isHoldemRoundClearPending,
      clearFn: clearHoldemCompletedRound,
      endpoint,
    });
  }
  return okResponse();
};

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `${domain}/${stage}`;
  const body = parseJson(event);
  const action = body.action || "unknown";
  const connection = await getConnection(connectionId);

  if (!connection) return jsonResponse(400, { error: "Unknown connection." }, CORS_ORIGIN);

  if (action === "join") {
    const roomId = body.roomId || "lobby";
    if (hasRoomsConfig()) {
      const [meta, state] = await Promise.all([getRoomMeta(roomId), getRoomState(roomId)]);
      if (state && isRoomExpired({ meta, state })) {
        await closeRoom(roomId);
        await sendToConnection(endpoint, connectionId, {
          type: "ERROR",
          error: "Room expired due to inactivity.",
        });
        return failResponse();
      }
    }
    await addRoomMember({ roomId, connectionId, username: connection.username });
    await setConnectionRoom(connectionId, roomId);
    await sendToConnection(endpoint, connectionId, { type: "ROOM_JOINED", roomId });
    if (connection.token) {
      const session = await getSession(connection.token);
      if (session) {
        const { balance } = await resolveBalance(session);
        await sendToConnection(endpoint, connectionId, { type: "BALANCE_UPDATE", balance });
      }
    }
    if (hasRoomsConfig()) {
      const state = await getRoomState(roomId);
      if (state) {
        await updateRoomMeta(roomId, state);
        await broadcastRoomState(endpoint, roomId, state);
      }
    }
    return okResponse();
  }

  if (action === "leave") {
    if (connection.room_id) {
      await removeRoomMember({ roomId: connection.room_id, connectionId });
    }
    await setConnectionRoom(connectionId, null);
    await cleanupRoomForConnection({
      roomId: connection.room_id,
      playerId: connection.player_id,
      connectionId,
      endpoint,
      reason: "leave",
    });
    await sendToConnection(endpoint, connectionId, { type: "ROOM_LEFT" });
    return okResponse();
  }

  if (action === "action") {
    const payload = body.payload || {};
    if (payload.game === "blackjack") {
      return handleBlackjackAction({
        endpoint,
        connectionId,
        connection,
        payload,
      });
    }
    if (payload.game === "holdem") {
      return handleHoldemAction({
        endpoint,
        connectionId,
        connection,
        payload,
      });
    }
    await sendToConnection(endpoint, connectionId, {
      type: "ACTION_ACK",
      payload,
    });
    return okResponse();
  }

  await sendToConnection(endpoint, connectionId, { type: "UNKNOWN_ACTION", action });
  return okResponse();
};
