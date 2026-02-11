const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const { get, put, update, del, query } = require("./lib/db");
const { jsonResponse, parseJson } = require("./lib/utils");
const { sanitizeState } = require("./game/sanitize");
const { startRound, applyHit, applyStand, removePlayer } = require("./game/blackjack_multi");

const { CONNECTIONS_TABLE, ROOMS_TABLE, GAME_SESSIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

const getConnection = async (connectionId) => {
  const resp = await get({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
  return resp.Item || null;
};

const sendToConnection = async (endpoint, connectionId, payload) => {
  const api = new ApiGatewayManagementApiClient({ endpoint: `https://${endpoint}` });
  await api.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    })
  );
};

const roomSessionId = (roomId) => `room:${roomId}`;

const getRoomState = async (roomId) => {
  const resp = await get({
    TableName: GAME_SESSIONS_TABLE,
    Key: { session_id: roomSessionId(roomId) },
  });
  return resp.Item?.state || null;
};

const saveRoomState = (roomId, state) =>
  put({
    TableName: GAME_SESSIONS_TABLE,
    Item: {
      session_id: roomSessionId(roomId),
      game: "blackjack-multi",
      state,
      updated_at: new Date().toISOString(),
    },
  });

const updateRoomMeta = async (roomId, state) => {
  if (!ROOMS_TABLE) return;
  const resp = await get({
    TableName: ROOMS_TABLE,
    Key: { room_id: roomId, player_id: "meta" },
  });
  const meta = resp.Item;
  if (!meta) return;
  await put({
    TableName: ROOMS_TABLE,
    Item: {
      ...meta,
      host: state.host,
      player_count: Array.isArray(state.players) ? state.players.length : 0,
      in_round: Boolean(state.inRound),
      updated_at: new Date().toISOString(),
    },
  });
};

const listRoomConnections = async (roomId) => {
  const resp = await query({
    TableName: ROOMS_TABLE,
    KeyConditionExpression: "room_id = :room",
    ExpressionAttributeValues: { ":room": roomId },
  });
  return (resp.Items || []).filter((item) => item.player_id && item.player_id !== "meta");
};

const broadcastRoomState = async (endpoint, roomId, state) => {
  const connections = await listRoomConnections(roomId);
  const payload = { type: "BLACKJACK_MULTI_STATE", roomId, state: sanitizeState("blackjack-multi", state) };
  await Promise.all(
    connections.map((entry) => sendToConnection(endpoint, entry.player_id, payload))
  );
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
    await put({
      TableName: ROOMS_TABLE,
      Item: {
        room_id: roomId,
        player_id: connectionId,
        username: connection.username,
        joined_at: new Date().toISOString(),
      },
    });
    await update({
      TableName: CONNECTIONS_TABLE,
      Key: { connection_id: connectionId },
      UpdateExpression: "set room_id = :room",
      ExpressionAttributeValues: { ":room": roomId },
    });
    await sendToConnection(endpoint, connectionId, { type: "ROOM_JOINED", roomId });
    if (GAME_SESSIONS_TABLE) {
      const state = await getRoomState(roomId);
      if (state) {
        await broadcastRoomState(endpoint, roomId, state);
      }
    }
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "leave") {
    if (connection.room_id) {
      await del({
        TableName: ROOMS_TABLE,
        Key: { room_id: connection.room_id, player_id: connectionId },
      });
    }
    await update({
      TableName: CONNECTIONS_TABLE,
      Key: { connection_id: connectionId },
      UpdateExpression: "set room_id = :room",
      ExpressionAttributeValues: { ":room": null },
    });
    await sendToConnection(endpoint, connectionId, { type: "ROOM_LEFT" });
    if (GAME_SESSIONS_TABLE && connection.room_id) {
      const state = await getRoomState(connection.room_id);
      if (state) {
        await broadcastRoomState(endpoint, connection.room_id, state);
      }
    }
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "action") {
    const payload = body.payload || {};
    if (payload.game === "blackjack-multi") {
      if (!ROOMS_TABLE || !GAME_SESSIONS_TABLE) {
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
      await sendToConnection(endpoint, connectionId, {
        type: "BLACKJACK_MULTI_STATE",
        roomId,
        state: sanitizeState("blackjack-multi", state),
      });
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
