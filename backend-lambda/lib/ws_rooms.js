const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const { get, put, del, query, scan, update } = require("./db");
const { sanitizeState } = require("../game/sanitize");
const { removePlayer: removeBlackjackMultiPlayer } = require("../game/blackjack_multi");
const { removePlayer: removeHoldemMultiPlayer } = require("../game/holdem_multi");
const { isRoomExpired } = require("./room_expiration");

const { CONNECTIONS_TABLE, ROOMS_TABLE, GAME_SESSIONS_TABLE } = process.env;
const DISCONNECT_REJOIN_GRACE_MS = 1200;
const LEAVE_REJOIN_GRACE_MS = 600;

const hasRoomsConfig = () => Boolean(ROOMS_TABLE && GAME_SESSIONS_TABLE);

const roomSessionId = (roomId) => `room:${roomId}`;

const getConnection = async (connectionId) => {
  if (!CONNECTIONS_TABLE) return null;
  const resp = await get({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
  return resp.Item || null;
};

const setConnectionRoom = async (connectionId, roomId) => {
  if (!CONNECTIONS_TABLE) return;
  await update({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
    UpdateExpression: "set room_id = :room",
    ExpressionAttributeValues: { ":room": roomId || null },
  });
};

const addRoomMember = async ({ roomId, connectionId, username }) => {
  if (!ROOMS_TABLE) return;
  await put({
    TableName: ROOMS_TABLE,
    Item: {
      room_id: roomId,
      player_id: connectionId,
      username,
      joined_at: new Date().toISOString(),
    },
  });
};

const removeRoomMember = async ({ roomId, connectionId }) => {
  if (!ROOMS_TABLE) return;
  await del({
    TableName: ROOMS_TABLE,
    Key: { room_id: roomId, player_id: connectionId },
  });
};

const deleteConnection = async (connectionId) => {
  if (!CONNECTIONS_TABLE) return;
  await del({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
};

const saveConnection = async ({ connectionId, username, playerId, token }) => {
  if (!CONNECTIONS_TABLE) return;
  await put({
    TableName: CONNECTIONS_TABLE,
    Item: {
      connection_id: connectionId,
      username: username || "guest",
      player_id: playerId || "",
      token: token || "",
      room_id: null,
      connected_at: new Date().toISOString(),
    },
  });
};

const getRoomMeta = async (roomId) => {
  if (!ROOMS_TABLE) return null;
  const resp = await get({
    TableName: ROOMS_TABLE,
    Key: { room_id: roomId, player_id: "meta" },
  });
  return resp.Item || null;
};

const saveRoomMeta = async (meta) => {
  if (!ROOMS_TABLE) return;
  await put({
    TableName: ROOMS_TABLE,
    Item: meta,
  });
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

const getRoomState = async (roomId) => {
  if (!GAME_SESSIONS_TABLE) return null;
  const resp = await get({
    TableName: GAME_SESSIONS_TABLE,
    Key: { session_id: roomSessionId(roomId) },
  });
  return resp.Item?.state || null;
};

const saveRoomState = (roomId, state) => {
  if (!GAME_SESSIONS_TABLE) return null;
  return put({
    TableName: GAME_SESSIONS_TABLE,
    Item: {
      session_id: roomSessionId(roomId),
      game: state?.game || "blackjack-multi",
      state,
      updated_at: new Date().toISOString(),
    },
  });
};

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
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
};

const closeRoom = async (roomId) => {
  if (!roomId || !hasRoomsConfig()) return;
  const entries = await query({
    TableName: ROOMS_TABLE,
    KeyConditionExpression: "room_id = :room",
    ExpressionAttributeValues: { ":room": roomId },
  });
  await Promise.all(
    (entries.Items || []).map((item) =>
      del({
        TableName: ROOMS_TABLE,
        Key: { room_id: roomId, player_id: item.player_id },
      })
    )
  );
  await del({
    TableName: GAME_SESSIONS_TABLE,
    Key: { session_id: roomSessionId(roomId) },
  });
};

const closeRoomIfExpired = async (roomId) => {
  if (!roomId || !hasRoomsConfig()) return false;
  const [meta, state] = await Promise.all([getRoomMeta(roomId), getRoomState(roomId)]);
  if (!state) return false;
  if (!isRoomExpired({ meta, state })) return false;
  await closeRoom(roomId);
  return true;
};

const listRoomConnections = async (roomId) => {
  if (!ROOMS_TABLE) return [];
  const resp = await query({
    TableName: ROOMS_TABLE,
    KeyConditionExpression: "room_id = :room",
    ExpressionAttributeValues: { ":room": roomId },
  });
  return (resp.Items || []).filter((item) => item.player_id && item.player_id !== "meta");
};

const hasOtherRoomConnectionForPlayer = async ({ roomId, playerId, excludeConnectionId }) => {
  if (!roomId || !playerId) return false;
  const entries = await listRoomConnections(roomId);
  for (const entry of entries) {
    const connectionId = entry.player_id;
    if (!connectionId || connectionId === excludeConnectionId) continue;
    const connection = await getConnection(connectionId);
    if (connection?.player_id === playerId) return true;
  }
  return false;
};

const hasOtherActiveConnectionForPlayer = async ({ playerId, excludeConnectionId }) => {
  if (!playerId || !CONNECTIONS_TABLE) return false;
  const resp = await scan({ TableName: CONNECTIONS_TABLE });
  const items = resp.Items || [];
  return items.some((item) => {
    if (!item?.connection_id || item.connection_id === excludeConnectionId) return false;
    return item.player_id === playerId;
  });
};

const broadcastRoomState = async (endpoint, roomId, state) => {
  const connections = await listRoomConnections(roomId);
  const gameKey = state?.game || "blackjack-multi";
  const payload = {
    type: gameKey === "holdem-multi" ? "HOLDEM_MULTI_STATE" : "BLACKJACK_MULTI_STATE",
    roomId,
    state: sanitizeState(gameKey, state),
  };
  await Promise.all(connections.map((entry) => sendToConnection(endpoint, entry.player_id, payload)));
};

const removeRoomPlayerByGame = (state, playerId) => {
  if (state?.game === "holdem-multi") return removeHoldemMultiPlayer(state, playerId);
  return removeBlackjackMultiPlayer(state, playerId);
};

const cleanupRoomForConnection = async ({
  roomId,
  playerId,
  connectionId,
  endpoint,
  reason = "leave",
}) => {
  if (!roomId || !playerId || !hasRoomsConfig()) return;
  const state = await getRoomState(roomId);
  if (!state) return;
  const hasOtherConnection = await hasOtherRoomConnectionForPlayer({
    roomId,
    playerId,
    excludeConnectionId: connectionId,
  });
  if (hasOtherConnection) return;
  if (reason === "leave") {
    await new Promise((resolve) => setTimeout(resolve, LEAVE_REJOIN_GRACE_MS));
    const rejoinedRoomDuringLeave = await hasOtherRoomConnectionForPlayer({
      roomId,
      playerId,
      excludeConnectionId: connectionId,
    });
    if (rejoinedRoomDuringLeave) return;
  }
  if (reason === "disconnect") {
    await new Promise((resolve) => setTimeout(resolve, DISCONNECT_REJOIN_GRACE_MS));
    const stillHasOtherConnection = await hasOtherActiveConnectionForPlayer({
      playerId,
      excludeConnectionId: connectionId,
    });
    if (stillHasOtherConnection) return;
  }
  removeRoomPlayerByGame(state, playerId);
  if (state.players.length === 0) {
    await del({
      TableName: GAME_SESSIONS_TABLE,
      Key: { session_id: roomSessionId(roomId) },
    });
    await del({
      TableName: ROOMS_TABLE,
      Key: { room_id: roomId, player_id: "meta" },
    });
    return;
  }
  await saveRoomState(roomId, state);
  await updateRoomMeta(roomId, state);
  await broadcastRoomState(endpoint, roomId, state);
};

module.exports = {
  roomSessionId,
  hasRoomsConfig,
  sendToConnection,
  getConnection,
  setConnectionRoom,
  addRoomMember,
  removeRoomMember,
  deleteConnection,
  saveConnection,
  getRoomMeta,
  saveRoomMeta,
  getRoomState,
  saveRoomState,
  updateRoomMeta,
  closeRoom,
  closeRoomIfExpired,
  listRoomConnections,
  broadcastRoomState,
  cleanupRoomForConnection,
};
