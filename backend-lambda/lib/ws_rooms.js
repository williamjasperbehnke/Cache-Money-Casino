const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const { get, put, del, query, update } = require("./db");
const { sanitizeState } = require("../game/sanitize");
const { removePlayer } = require("../game/blackjack_multi");

const { CONNECTIONS_TABLE, ROOMS_TABLE, GAME_SESSIONS_TABLE } = process.env;

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

const saveConnection = async ({ connectionId, username, playerId }) => {
  if (!CONNECTIONS_TABLE) return;
  await put({
    TableName: CONNECTIONS_TABLE,
    Item: {
      connection_id: connectionId,
      username: username || "guest",
      player_id: playerId || "",
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
      game: "blackjack-multi",
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
      updated_at: new Date().toISOString(),
    },
  });
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

const broadcastRoomState = async (endpoint, roomId, state) => {
  const connections = await listRoomConnections(roomId);
  const payload = {
    type: "BLACKJACK_MULTI_STATE",
    roomId,
    state: sanitizeState("blackjack-multi", state),
  };
  await Promise.all(connections.map((entry) => sendToConnection(endpoint, entry.player_id, payload)));
};

const cleanupRoomForConnection = async ({ roomId, playerId, endpoint }) => {
  if (!roomId || !playerId || !hasRoomsConfig()) return;
  const state = await getRoomState(roomId);
  if (!state) return;
  removePlayer(state, playerId);
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
  broadcastRoomState,
  cleanupRoomForConnection,
};
