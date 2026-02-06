const { ddb } = require("./lib/db");
const {
  jsonResponse,
  parseJson,
  getRoute,
  createToken,
  isStrongPassword,
  hashPassword,
  verifyPassword,
} = require("./lib/utils");
const { emptyStats } = require("./lib/stats");

const { USERS_TABLE, SESSIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

const ttlFromNow = (seconds) => Math.floor(Date.now() / 1000) + seconds;

const getUser = async (username) => {
  const resp = await ddb
    .get({
      TableName: USERS_TABLE,
      Key: { username },
    })
    .promise();
  return resp.Item || null;
};

const putUser = (user) =>
  ddb
    .put({
      TableName: USERS_TABLE,
      Item: user,
    })
    .promise();

const putSession = (token, username) =>
  ddb
    .put({
      TableName: SESSIONS_TABLE,
      Item: {
        token,
        username,
        ttl: ttlFromNow(60 * 60 * 24 * 7),
      },
    })
    .promise();

const putGuestSession = (token) =>
  ddb
    .put({
      TableName: SESSIONS_TABLE,
      Item: {
        token,
        username: null,
        balance: 1000,
        ttl: ttlFromNow(60 * 60 * 24 * 7),
      },
    })
    .promise();

exports.handler = async (event) => {
  const { method, path } = getRoute(event);
  if (method === "OPTIONS") return jsonResponse(204, {}, CORS_ORIGIN);

  const body = parseJson(event);
  if ((path.endsWith("/api/auth/register") || path.endsWith("/auth/register")) && method === "POST") {
    const { username, password } = body;
    if (!username || !password) {
      return jsonResponse(400, { error: "Missing fields." }, CORS_ORIGIN);
    }
    if (!isStrongPassword(password)) {
      return jsonResponse(
        400,
        { error: "Password must be 8+ chars with upper, lower, number, and symbol." },
        CORS_ORIGIN
      );
    }
    const exists = await getUser(username);
    if (exists) return jsonResponse(409, { error: "Username already exists." }, CORS_ORIGIN);
    const { salt, hash } = hashPassword(password);
    const user = {
      username,
      password_salt: salt,
      password_hash: hash,
      balance: 1000,
      stats: emptyStats(),
      created_at: new Date().toISOString(),
    };
    await putUser(user);
    const token = createToken();
    await putSession(token, username);
    return jsonResponse(
      200,
      { token, user: { username, balance: user.balance, stats: user.stats } },
      CORS_ORIGIN
    );
  }

  if ((path.endsWith("/api/auth/login") || path.endsWith("/auth/login")) && method === "POST") {
    const { username, password } = body;
    if (!username || !password) {
      return jsonResponse(400, { error: "Missing fields." }, CORS_ORIGIN);
    }
    const user = await getUser(username);
    if (!user) return jsonResponse(401, { error: "Invalid credentials." }, CORS_ORIGIN);
    const ok = verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) return jsonResponse(401, { error: "Invalid credentials." }, CORS_ORIGIN);
    const token = createToken();
    await putSession(token, username);
    return jsonResponse(
      200,
      { token, user: { username, balance: user.balance, stats: user.stats } },
      CORS_ORIGIN
    );
  }

  if ((path.endsWith("/api/auth/guest") || path.endsWith("/auth/guest")) && method === "POST") {
    const token = createToken();
    await putGuestSession(token);
    return jsonResponse(
      200,
      { token, user: { username: "guest", balance: 1000 } },
      CORS_ORIGIN
    );
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
