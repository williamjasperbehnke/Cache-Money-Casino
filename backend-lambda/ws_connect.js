const crypto = require("crypto");
const { put } = require("./lib/db");
const { jsonResponse } = require("./lib/utils");
const { getSession } = require("./lib/session");

const { CONNECTIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token || "";
  const session = await getSession(token);
  const playerId = crypto.createHash("sha256").update(token || "").digest("hex").slice(0, 12);

  await put({
    TableName: CONNECTIONS_TABLE,
    Item: {
      connection_id: connectionId,
      username: session ? session.username : "guest",
      player_id: playerId,
      room_id: null,
      connected_at: new Date().toISOString(),
    },
  });

  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
