const { get, put } = require("./lib/db");
const { jsonResponse, parseJson, getRoute, getAuthToken } = require("./lib/utils");
const { updateStats, computeHighlights } = require("./lib/stats");

const { USERS_TABLE, SESSIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

const getSession = async (token) => {
  if (!token) return null;
  const resp = await get({
    TableName: SESSIONS_TABLE,
    Key: { token },
  });
  return resp.Item || null;
};

const getUser = async (username) => {
  const resp = await get({
    TableName: USERS_TABLE,
    Key: { username },
  });
  return resp.Item || null;
};

const putUser = (user) =>
  put({
    TableName: USERS_TABLE,
    Item: user,
  });

exports.handler = async (event) => {
  const { method, path } = getRoute(event);
  if (method === "OPTIONS") return jsonResponse(204, {}, CORS_ORIGIN);

  const token = getAuthToken(event);
  const session = await getSession(token);
  if (!session) return jsonResponse(401, { error: "Unauthorized" }, CORS_ORIGIN);

  const user = await getUser(session.username);
  if (!user) return jsonResponse(404, { error: "User not found." }, CORS_ORIGIN);

  if ((path.endsWith("/api/me") || path.endsWith("/me")) && method === "GET") {
    const highlights = computeHighlights(user.stats);
    return jsonResponse(
      200,
      {
        user: {
          username: user.username,
          balance: user.balance,
          stats: { ...user.stats, ...highlights },
        },
      },
      CORS_ORIGIN
    );
  }

  if ((path.endsWith("/api/balance") || path.endsWith("/balance")) && method === "POST") {
    const { balance } = parseJson(event);
    if (!Number.isFinite(balance)) {
      return jsonResponse(400, { error: "Invalid balance." }, CORS_ORIGIN);
    }
    user.balance = Math.max(0, Math.floor(balance));
    await putUser(user);
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if ((path.endsWith("/api/stats/record") || path.endsWith("/stats/record")) && method === "POST") {
    const { game, bet, net, result } = parseJson(event);
    if (!game || !Number.isFinite(bet) || !Number.isFinite(net)) {
      return jsonResponse(400, { error: "Invalid payload." }, CORS_ORIGIN);
    }
    user.stats = updateStats(user.stats, {
      game,
      bet: Math.max(0, Math.floor(bet)),
      net: Math.floor(net),
      result: result || (net > 0 ? "win" : net < 0 ? "loss" : "push"),
    });
    await putUser(user);
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
