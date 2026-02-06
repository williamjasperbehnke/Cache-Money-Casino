const crypto = require("crypto");

const PASSWORD_ITERATIONS = 100000;
const PASSWORD_KEYLEN = 64;
const PASSWORD_DIGEST = "sha512";

const jsonResponse = (statusCode, body, origin) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  },
  body: JSON.stringify(body || {}),
});

const parseJson = (event) => {
  if (!event || !event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (err) {
    return {};
  }
};

const getAuthToken = (event) => {
  const header =
    (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return "";
};

const createToken = () => crypto.randomBytes(32).toString("hex");

const isStrongPassword = (password = "") =>
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password);

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST)
    .toString("hex");
  return { salt, hash };
};

const verifyPassword = (password, salt, hash) => {
  const attempt = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEYLEN, PASSWORD_DIGEST)
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
};

const getRoute = (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || "";
  const path = event?.requestContext?.http?.path || event?.path || "";
  return { method, path };
};

module.exports = {
  jsonResponse,
  parseJson,
  getAuthToken,
  createToken,
  isStrongPassword,
  hashPassword,
  verifyPassword,
  getRoute,
};
