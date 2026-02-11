const { get, del } = require("./lib/db");
const { jsonResponse } = require("./lib/utils");

const { CONNECTIONS_TABLE, ROOMS_TABLE, CORS_ORIGIN = "*" } = process.env;

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
  await del({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
