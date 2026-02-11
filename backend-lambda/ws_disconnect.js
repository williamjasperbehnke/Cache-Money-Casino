const { get, put, del } = require("./lib/db");
const { jsonResponse } = require("./lib/utils");
const { removePlayer } = require("./game/blackjack_multi");

const { CONNECTIONS_TABLE, ROOMS_TABLE, GAME_SESSIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

const roomSessionId = (roomId) => `room:${roomId}`;

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

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const resp = await get({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
  const connection = resp.Item || null;
  if (ROOMS_TABLE && connection?.room_id) {
    await del({
      TableName: ROOMS_TABLE,
      Key: { room_id: connection.room_id, player_id: connectionId },
    });
  }
  if (ROOMS_TABLE && GAME_SESSIONS_TABLE && connection?.room_id) {
    const state = await getRoomState(connection.room_id);
    if (state) {
      removePlayer(state, connection.player_id);
      if (state.players.length === 0) {
        await del({
          TableName: GAME_SESSIONS_TABLE,
          Key: { session_id: roomSessionId(connection.room_id) },
        });
        await del({
          TableName: ROOMS_TABLE,
          Key: { room_id: connection.room_id, player_id: "meta" },
        });
      } else {
        await saveRoomState(connection.room_id, state);
        const meta = await get({
          TableName: ROOMS_TABLE,
          Key: { room_id: connection.room_id, player_id: "meta" },
        });
        if (meta.Item) {
          await put({
            TableName: ROOMS_TABLE,
            Item: {
              ...meta.Item,
              host: state.host,
              player_count: state.players.length,
              in_round: Boolean(state.inRound),
              updated_at: new Date().toISOString(),
            },
          });
        }
      }
    }
  }
  await del({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
