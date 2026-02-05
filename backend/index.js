import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { isStrongPassword } from "../shared/password.js";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const {
  AWS_REGION = "us-east-1",
  USERS_TABLE = "casino_users",
  JWT_SECRET = "change-me",
  CORS_ORIGIN = "*",
  TOKEN_TTL = "7d",
  PORT = 8080,
  AWS_ENDPOINT_URL,
} = process.env;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: AWS_REGION,
    endpoint: AWS_ENDPOINT_URL || undefined,
  })
);

const emptyStats = () => ({
  totals: { bets: 0, wins: 0, losses: 0, net: 0 },
  games: {},
  recent: [],
});

const ensureGameStats = (stats, game) => {
  if (!stats.games[game]) {
    stats.games[game] = { bets: 0, wins: 0, losses: 0, net: 0 };
  }
};

const updateStats = (stats, { game, bet, net, result }) => {
  const next = stats || emptyStats();
  ensureGameStats(next, game);
  next.totals.bets += bet;
  if (net > 0) next.totals.wins += 1;
  if (net < 0) next.totals.losses += 1;
  next.totals.net += net;

  const gameStats = next.games[game];
  gameStats.bets += bet;
  if (net > 0) gameStats.wins += 1;
  if (net < 0) gameStats.losses += 1;
  gameStats.net += net;

  next.recent.unshift({
    game,
    bet,
    net,
    result,
    ts: new Date().toISOString(),
  });
  next.recent = next.recent.slice(0, 20);
  return next;
};

const computeHighlights = (stats) => {
  if (!stats) return { favorite: "—", bestWinRate: "—" };
  let favorite = "—";
  let favoritePlays = -1;
  let bestWinRate = 0;
  let bestGame = "—";
  Object.entries(stats.games || {}).forEach(([game, value]) => {
    const plays = (value.wins || 0) + (value.losses || 0);
    if (plays > favoritePlays) {
      favoritePlays = plays;
      favorite = game;
    }
    const totalRounds = value.wins + value.losses;
    const rate = totalRounds ? value.wins / totalRounds : 0;
    if (rate > bestWinRate) {
      bestWinRate = rate;
      bestGame = game;
    }
  });
  return {
    favorite,
    bestWinRate: bestGame === "—" ? "—" : `${bestGame} ${(bestWinRate * 100).toFixed(0)}%`,
  };
};

const signToken = (user) =>
  jwt.sign({ sub: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { username: payload.sub };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

const getUser = async (username) => {
  const resp = await ddb.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { username },
    })
  );
  return resp.Item || null;
};

const putUser = async (user) => {
  await ddb.send(
    new PutCommand({
      TableName: USERS_TABLE,
      Item: user,
    })
  );
};

app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields." });
  if (!isStrongPassword(password)) {
    return res.status(400).json({
      error: "Password must be 8+ chars with upper, lower, number, and symbol.",
    });
  }
  const exists = await getUser(username);
  if (exists) return res.status(409).json({ error: "Username already exists." });
  const hash = await bcrypt.hash(password, 10);
  const user = {
    username,
    password_hash: hash,
    balance: 1000,
    stats: emptyStats(),
    created_at: new Date().toISOString(),
  };
  await putUser(user);
  const token = signToken(user);
  return res.json({ token, user: { username: user.username, balance: user.balance, stats: user.stats } });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields." });
  const user = await getUser(username);
  if (!user) return res.status(401).json({ error: "Invalid credentials." });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials." });
  const token = signToken(user);
  return res.json({ token, user: { username: user.username, balance: user.balance, stats: user.stats } });
});

app.get("/api/me", authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username);
  if (!user) return res.status(404).json({ error: "User not found." });
  const highlights = computeHighlights(user.stats);
  return res.json({
    user: {
      username: user.username,
      balance: user.balance,
      stats: { ...user.stats, ...highlights },
    },
  });
});

app.post("/api/balance", authMiddleware, async (req, res) => {
  const { balance } = req.body || {};
  if (!Number.isFinite(balance)) return res.status(400).json({ error: "Invalid balance." });
  const user = await getUser(req.user.username);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.balance = Math.max(0, Math.floor(balance));
  await putUser(user);
  return res.json({ ok: true });
});

app.post("/api/stats/record", authMiddleware, async (req, res) => {
  const { game, bet, net, result } = req.body || {};
  if (!game || !Number.isFinite(bet) || !Number.isFinite(net)) {
    return res.status(400).json({ error: "Invalid payload." });
  }
  const user = await getUser(req.user.username);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.stats = updateStats(user.stats, {
    game,
    bet: Math.max(0, Math.floor(bet)),
    net: Math.floor(net),
    result: result || (net > 0 ? "win" : net < 0 ? "loss" : "push"),
  });
  await putUser(user);
  return res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on ${PORT}`);
});
