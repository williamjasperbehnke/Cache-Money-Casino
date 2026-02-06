const crypto = require("crypto");
const { ddb } = require("./lib/db");
const { jsonResponse, parseJson, getRoute, getAuthToken } = require("./lib/utils");

const {
  GAME_SESSIONS_TABLE,
  SESSIONS_TABLE,
  CORS_ORIGIN = "*",
} = process.env;

const getSession = async (token) => {
  if (!token) return null;
  const resp = await ddb
    .get({
      TableName: SESSIONS_TABLE,
      Key: { token },
    })
    .promise();
  return resp.Item || null;
};

exports.handler = async (event) => {
  const { method, path } = getRoute(event);
  if (method === "OPTIONS") return jsonResponse(204, {}, CORS_ORIGIN);

  const token = getAuthToken(event);
  const session = await getSession(token);
  if (!session) return jsonResponse(401, { error: "Unauthorized" }, CORS_ORIGIN);

  if (method === "POST" && path.includes("/games/") && path.endsWith("/session")) {
    const game = event.pathParameters?.game || "unknown";
    const { state } = parseJson(event);
    const sessionId = crypto.randomUUID();
    await ddb
      .put({
        TableName: GAME_SESSIONS_TABLE,
        Item: {
          session_id: sessionId,
          username: session.username,
          game,
          state: state || {},
          created_at: new Date().toISOString(),
        },
      })
      .promise();
    return jsonResponse(200, { sessionId }, CORS_ORIGIN);
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
