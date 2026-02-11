const { jsonResponse, parseJson } = require("./lib/utils");
const {
  sendToConnection,
  hasRoomsConfig,
  getConnection,
  setConnectionRoom,
  addRoomMember,
  removeRoomMember,
  getRoomState,
  saveRoomState,
  updateRoomMeta,
  broadcastRoomState,
  cleanupRoomForConnection,
} = require("./lib/ws_rooms");
const { startRound, applyHit, applyStand } = require("./game/blackjack_multi");

const { CORS_ORIGIN = "*" } = process.env;

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
    await addRoomMember({ roomId, connectionId, username: connection.username });
    await setConnectionRoom(connectionId, roomId);
    await sendToConnection(endpoint, connectionId, { type: "ROOM_JOINED", roomId });
    if (hasRoomsConfig()) {
      const state = await getRoomState(roomId);
      if (state) {
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
      endpoint,
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
      const state = await getRoomState(roomId);
      if (!state) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: "Room not found." });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      let result = { state };
      if (payload.type === "START") {
        if (state.hostId && state.hostId !== connection.player_id) {
          await sendToConnection(endpoint, connectionId, {
            type: "ERROR",
            error: "Only the host can start the round.",
          });
          return jsonResponse(200, { ok: false }, CORS_ORIGIN);
        }
        result = startRound(state);
      } else if (payload.type === "HIT") {
        result = applyHit(state, connection.player_id);
      } else if (payload.type === "STAND") {
        result = applyStand(state, connection.player_id);
      }
      if (result?.error) {
        await sendToConnection(endpoint, connectionId, { type: "ERROR", error: result.error });
        return jsonResponse(200, { ok: false }, CORS_ORIGIN);
      }
      await saveRoomState(roomId, state);
      await updateRoomMeta(roomId, state);
      await broadcastRoomState(endpoint, roomId, state);
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
