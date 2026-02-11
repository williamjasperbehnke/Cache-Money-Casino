const crypto = require("crypto");
const { jsonResponse } = require("./lib/utils");
const { getSession } = require("./lib/session");
const { saveConnection } = require("./lib/ws_rooms");

const { CORS_ORIGIN = "*" } = process.env;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token || "";
  const session = await getSession(token);
  const playerId = crypto.createHash("sha256").update(token || "").digest("hex").slice(0, 12);

  await saveConnection({
    connectionId,
    username: session ? session.username : "guest",
    playerId,
    token,
  });

  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
