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
} = require("./game/blackjack_multi");
const {
  startRound: startHoldemRound,
  applyCheck: applyHoldemCheck,
  applyCall: applyHoldemCall,
  applyRaise: applyHoldemRaise,
  applyFold: applyHoldemFold,
  isRoundClearPending: isHoldemRoundClearPending,
  clearCompletedRound: clearHoldemCompletedRound,
} = require("./game/holdem_multi");
const { handTotal, resolveOutcomes } = require("./game/blackjack_core");
const { updateStats } = require("./lib/stats");
const { getSession, resolveBalance, persistBalance, putUser } = require("./lib/session");

const { CORS_ORIGIN = "*" } = process.env;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

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
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
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
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
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
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "action") {
    const payload = body.payload || {};
    if (payload.game === "blackjack-multi") {
      if (!hasRoomsConfig()) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Server not configured." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      const roomId = payload.roomId || connection.room_id;
      if (!roomId) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Missing room." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      if (connection.room_id && connection.room_id !== roomId) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Not in this room." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      if (await closeRoomIfExpired(roomId)) {
        await sendToConnection(endpoint, connectionId, {
          type: "ERROR",
          error: "Room expired due to inactivity.",
        });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      const state = await getRoomState(roomId);
      if (!state) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Room not found." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      let settledThisAction = false;
      let autoClearedRound = false;
      const cooldownPending = isRoundClearPending(state);
      if (state.phase === "complete" && !cooldownPending) {
        clearCompletedRound(state);
        autoClearedRound = true;
      }
      const player = state.players.find((entry) => entry.id === connection.player_id);
      let result = { state };
      if (payload.type === "BET") {
        if (!player) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Player not found." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (state.inRound) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Round already in progress." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (cooldownPending) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Round settling. Wait a moment.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (!connection.token) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const session = await getSession(connection.token);
        if (!session) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const amount = Math.max(0, Number(payload.amount) || 0);
        const { balance } = await resolveBalance(session);
        if (amount > balance) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Not enough credits." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        player.betAmount = amount;
        if (amount > 0) player.lastBet = amount;
        player.status = amount > 0 ? "waiting" : "sitting";
        await saveRoomState(roomId, state);
        await updateRoomMeta(roomId, state);
        await broadcastRoomState(endpoint, roomId, state);
        return jsonResponse(200, { ok: true }, CORS_ORIGIN);
      }
      if (!player && !["START", "BET"].includes(payload.type)) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Player not found." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      if (payload.type === "START") {
        if (state.hostId && state.hostId !== connection.player_id) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Only the host can start the round.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (cooldownPending) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Round settling. Wait a moment.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
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
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
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
        if (!connection.token) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const session = await getSession(connection.token);
        if (!session) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const { user, balance } = await resolveBalance(session);
        const currentBet = player?.bets?.[player.activeHand] || 0;
        if (balance < currentBet) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Not enough credits." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const nextBalance = await persistBalance(session, user, balance - currentBet);
        await sendToConnection(endpoint, connectionId, {
          type: "BALANCE_UPDATE",
          balance: nextBalance,
        });
        result = applyDouble(state, connection.player_id);
      } else if (payload.type === "SPLIT") {
        if (!connection.token) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const session = await getSession(connection.token);
        if (!session) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const { user, balance } = await resolveBalance(session);
        const currentBet = player?.bets?.[player.activeHand] || 0;
        if (balance < currentBet) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Not enough credits." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const nextBalance = await persistBalance(session, user, balance - currentBet);
        await sendToConnection(endpoint, connectionId, {
          type: "BALANCE_UPDATE",
          balance: nextBalance,
        });
        result = applySplit(state, connection.player_id);
      }
      if (result?.error) {
        if (autoClearedRound) {
          await saveRoomState(roomId, state);
          await updateRoomMeta(roomId, state);
          await broadcastRoomState(endpoint, roomId, state);
        }
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: result.error });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
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
      await saveRoomState(roomId, state);
      await updateRoomMeta(roomId, state);
      await broadcastRoomState(endpoint, roomId, state);
      if (settledThisAction && state.phase === "complete") {
        const clearAtMs = Date.parse(state.roundClearAt || "");
        if (Number.isFinite(clearAtMs)) {
          await delay(clearAtMs - Date.now() + 30);
          const latest = await getRoomState(roomId);
          if (latest && latest.phase === "complete" && !isRoundClearPending(latest)) {
            if (clearCompletedRound(latest)) {
              await saveRoomState(roomId, latest);
              await updateRoomMeta(roomId, latest);
              await broadcastRoomState(endpoint, roomId, latest);
            }
          }
        }
      }
      return jsonResponse(200, { ok: true }, CORS_ORIGIN);
    }
    if (payload.game === "holdem-multi") {
      if (!hasRoomsConfig()) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Server not configured." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      const roomId = payload.roomId || connection.room_id;
      if (!roomId) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Missing room." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      if (connection.room_id && connection.room_id !== roomId) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Not in this room." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      if (await closeRoomIfExpired(roomId)) {
        await sendToConnection(endpoint, connectionId, {
          type: "ERROR",
          error: "Room expired due to inactivity.",
        });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      const state = await getRoomState(roomId);
      if (!state) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Room not found." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      let settledThisAction = false;
      const cooldownPending = isHoldemRoundClearPending(state);
      if (state.phase === "showdown" && !cooldownPending) {
        clearHoldemCompletedRound(state);
      }
      const player = state.players.find((entry) => entry.id === connection.player_id);
      let result = { state };

      if (payload.type === "BET") {
        if (!player) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Player not found." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (state.inRound) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Round already in progress." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (cooldownPending) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Round settling. Wait a moment.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (!connection.token) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const session = await getSession(connection.token);
        if (!session) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Session missing." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        const amount = Math.max(0, Number(payload.amount) || 0);
        const { balance } = await resolveBalance(session);
        if (amount > balance) {
          await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Not enough credits." });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        player.betAmount = amount;
        if (amount > 0) player.lastBet = amount;
        player.status = amount > 0 ? "waiting" : "sitting";
        await saveRoomState(roomId, state);
        await updateRoomMeta(roomId, state);
        await broadcastRoomState(endpoint, roomId, state);
        return jsonResponse(200, { ok: true }, CORS_ORIGIN);
      }

      if (!player && !["START", "BET"].includes(payload.type)) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Player not found." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }

      if (payload.type === "START") {
        if (state.hostId && state.hostId !== connection.player_id) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Only the host can start the round.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        if (cooldownPending) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Round settling. Wait a moment.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
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
        for (const [playerId, context] of sessionMap.entries()) {
          if (!debitedPlayerIds.has(playerId)) continue;
          const nextBalance = await persistBalance(context.session, context.user, context.balance);
          await sendToConnection(endpoint, context.connectionId, {
            type: "BALANCE_UPDATE",
            balance: nextBalance,
          });
        }
        result = startHoldemRound(state);
      } else if (payload.type === "CHECK") {
        result = applyHoldemCheck(state, connection.player_id);
      } else if (payload.type === "CALL") {
        result = applyHoldemCall(state, connection.player_id);
      } else if (payload.type === "RAISE") {
        result = applyHoldemRaise(state, connection.player_id, Number(payload.amount) || 0);
      } else if (payload.type === "FOLD") {
        result = applyHoldemFold(state, connection.player_id);
      } else {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Unknown action." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }

      if (result?.error) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: result.error });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }

      if (!state.inRound && state.phase === "showdown" && state.settled && !state.payoutApplied) {
        const sessionMap = await buildPlayerSessionMap(roomId);
        for (const [playerId, context] of sessionMap.entries()) {
          const entry = state.players.find((p) => p.id === playerId);
          if (!entry) continue;
          const payout = Math.max(0, Number(entry.lastPayout || 0));
          const nextBalance = await persistBalance(context.session, context.user, context.balance + payout);
          await sendToConnection(endpoint, context.connectionId, {
            type: "BALANCE_UPDATE",
            balance: nextBalance,
          });
          if (context.user && Number(entry.betAmount || 0) > 0) {
            const net = payout - Number(entry.betAmount || 0);
            context.user.stats = updateStats(context.user.stats, {
              game: "holdem",
              bet: Number(entry.betAmount || 0),
              net,
              result: net > 0 ? "win" : net < 0 ? "loss" : "push",
            });
            await putUser(context.user);
          }
        }
        state.payoutApplied = true;
        settledThisAction = true;
      }

      await saveRoomState(roomId, state);
      await updateRoomMeta(roomId, state);
      await broadcastRoomState(endpoint, roomId, state);
      if (settledThisAction && state.phase === "showdown") {
        const clearAtMs = Date.parse(state.roundClearAt || "");
        if (Number.isFinite(clearAtMs)) {
          await delay(clearAtMs - Date.now() + 30);
          const latest = await getRoomState(roomId);
          if (latest && latest.phase === "showdown" && !isHoldemRoundClearPending(latest)) {
            if (clearHoldemCompletedRound(latest)) {
              await saveRoomState(roomId, latest);
              await updateRoomMeta(roomId, latest);
              await broadcastRoomState(endpoint, roomId, latest);
            }
          }
        }
      }
      return jsonResponse(200, { ok: true }, CORS_ORIGIN);
    }
    await sendToConnection(endpoint, connectionId, {
      type: "ACTION_ACK",
      payload,
    });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  await sendToConnection(endpoint, connectionId, { type: "UNKNOWN_ACTION", action });
  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
