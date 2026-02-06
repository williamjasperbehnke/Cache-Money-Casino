const crypto = require("crypto");
const { ddb } = require("./lib/db");
const { jsonResponse, parseJson, getRoute, getAuthToken } = require("./lib/utils");
const { updateStats } = require("./lib/stats");

const {
  GAME_SESSIONS_TABLE,
  USERS_TABLE,
  SESSIONS_TABLE,
  CORS_ORIGIN = "*",
} = process.env;

const rouletteOrder = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  "00", 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "🍇", "🍀", "💥", "🍉", "🪙"];

const PAYOUTS = {
  "💎": { multiplier: 12, key: "3-diamond" },
  "⭐": { multiplier: 10, key: "3-star" },
  "🔔": { multiplier: 8, key: "3-bell" },
  "🍇": { multiplier: 6, key: "3-grape" },
  "🍒": { multiplier: 6, key: "3-cherry" },
  "🍋": { multiplier: 4, key: "3-lemon" },
  any3: { multiplier: 3, key: "3-any" },
  any2: { multiplier: 1.5, key: "2-any" },
};

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

const putSession = (session) =>
  ddb
    .put({
      TableName: SESSIONS_TABLE,
      Item: session,
    })
    .promise();

const getUser = async (username) => {
  if (!username) return null;
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

const resolveBalance = async (session) => {
  if (session.username) {
    const user = await getUser(session.username);
    return { user, balance: user?.balance ?? 0 };
  }
  return { user: null, balance: Number(session.balance) || 0 };
};

const persistBalance = async (session, user, balance) => {
  if (user) {
    user.balance = Math.max(0, Math.floor(balance));
    await putUser(user);
    return user.balance;
  }
  const next = Math.max(0, Math.floor(balance));
  await putSession({ ...session, balance: next });
  return next;
};

const sumValues = (obj) =>
  Object.values(obj || {}).reduce((acc, val) => acc + Number(val || 0), 0);

const evaluateSlots = (symbols) => {
  const [a, b, c] = symbols;
  const hasThreeKind = a === b && b === c;
  const hasTwoKind = a === b || b === c || a === c;
  const tripleSymbol = hasThreeKind ? a : null;
  const twoSymbol = hasTwoKind
    ? a === b
      ? a
      : b === c
        ? b
        : a
    : null;

  if (hasThreeKind) {
    const payout = PAYOUTS[tripleSymbol] || PAYOUTS.any3;
    return { hasThreeKind, hasTwoKind, tripleSymbol, twoSymbol, ...payout };
  }

  if (hasTwoKind) {
    return {
      hasThreeKind,
      hasTwoKind,
      tripleSymbol,
      twoSymbol,
      multiplier: PAYOUTS.any2.multiplier,
      key: PAYOUTS.any2.key,
    };
  }

  return { hasThreeKind, hasTwoKind, tripleSymbol, twoSymbol, multiplier: 0, key: "" };
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
          username: session.username || "guest",
          game,
          state: state || {},
          created_at: new Date().toISOString(),
        },
      })
      .promise();
    return jsonResponse(200, { sessionId }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/roulette/spin")) {
    const { bets } = parseJson(event);
    const numbers = bets?.numbers || {};
    const colors = bets?.colors || {};
    const parities = bets?.parities || {};
    const totalBet = sumValues(numbers) + sumValues(colors) + sumValues(parities);
    if (totalBet <= 0) {
      return jsonResponse(400, { error: "No bets placed." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (balance < totalBet) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const resultNumber = rouletteOrder[Math.floor(Math.random() * rouletteOrder.length)];
    let payout = 0;
    let profit = 0;

    const numberAmount = numbers[resultNumber] || 0;
    if (numberAmount) {
      payout += numberAmount * 35 + numberAmount;
      profit += numberAmount * 35;
    }
    const color = redNumbers.has(Number(resultNumber)) ? "red" : "black";
    const colorAmount = colors[color] || 0;
    if (colorAmount) {
      payout += colorAmount * 2;
      profit += colorAmount;
    }
    const parity = Number(resultNumber) % 2 === 0 ? "even" : "odd";
    const parityAmount = parities[parity] || 0;
    if (parityAmount) {
      payout += parityAmount * 2;
      profit += parityAmount;
    }

    let nextBalance = balance - totalBet + payout;
    nextBalance = await persistBalance(session, user, nextBalance);
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "roulette",
        bet: totalBet,
        net: profit > 0 ? profit : -totalBet,
        result: profit > 0 ? "win" : "loss",
      });
      await putUser(user);
      nextBalance = user.balance;
    }
    return jsonResponse(
      200,
      {
        resultNumber,
        totalBet,
        payout,
        profit,
        balance: nextBalance,
        win: profit > 0,
      },
      CORS_ORIGIN
    );
  }

  if (method === "POST" && path.endsWith("/games/roulette/chaos")) {
    const body = parseJson(event);
    const bets = body.bets || { numbers: {}, colors: {}, parities: {} };
    const chipValues = (body.chipValues || []).map(Number).filter((val) => val > 0);
    const maxPerSlot = Number(body.maxPerSlot) || 50;
    if (chipValues.length === 0) {
      return jsonResponse(400, { error: "No chip values." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    const available = Math.min(balance, 200);
    if (available <= 0) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const spend = Math.min(available, Math.floor(Math.random() * 150) + 50);
    let spent = 0;
    const zones = [
      ...rouletteOrder.map((value) => ({ bucket: "numbers", key: String(value) })),
      { bucket: "colors", key: "red" },
      { bucket: "colors", key: "black" },
      { bucket: "parities", key: "odd" },
      { bucket: "parities", key: "even" },
    ];

    const nextBets = {
      numbers: { ...(bets.numbers || {}) },
      colors: { ...(bets.colors || {}) },
      parities: { ...(bets.parities || {}) },
    };

    let guard = 0;
    while (spent < spend && guard < 500) {
      guard += 1;
      const amount = chipValues[Math.floor(Math.random() * chipValues.length)];
      if (spent + amount > spend) continue;
      const zone = zones[Math.floor(Math.random() * zones.length)];
      if (!zone) break;
      const current = Number(nextBets[zone.bucket][zone.key] || 0);
      if (current + amount > maxPerSlot) continue;
      nextBets[zone.bucket][zone.key] = current + amount;
      spent += amount;
    }

    const nextBalance = await persistBalance(session, user, balance - spent);
    return jsonResponse(
      200,
      {
        bets: nextBets,
        spent,
        balance: nextBalance,
      },
      CORS_ORIGIN
    );
  }

  if (method === "POST" && path.endsWith("/games/slots/spin")) {
    const { bet } = parseJson(event);
    const wager = Number(bet);
    if (!Number.isFinite(wager) || wager <= 0) {
      return jsonResponse(400, { error: "Invalid bet." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (balance < wager) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const symbols = Array.from({ length: 3 }, () =>
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
    );
    const outcome = evaluateSlots(symbols);
    let payout = 0;
    let profit = -wager;
    let nextBalance = balance - wager;
    let wipeBalance = false;

    if (outcome.hasThreeKind && outcome.tripleSymbol === "💥") {
      nextBalance = 0;
      wipeBalance = true;
      profit = -wager;
    } else if (outcome.hasTwoKind && outcome.twoSymbol === "💥") {
      profit = -wager;
    } else if (outcome.multiplier > 0 || outcome.hasTwoKind) {
      const payMultiplier = outcome.hasTwoKind ? PAYOUTS.any2.multiplier : outcome.multiplier;
      payout = wager * payMultiplier + wager;
      profit = wager * payMultiplier;
      nextBalance = balance - wager + payout;
    }

    nextBalance = await persistBalance(session, user, nextBalance);
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "slots",
        bet: wager,
        net: profit,
        result: profit > 0 ? "win" : "loss",
      });
      await putUser(user);
      nextBalance = user.balance;
    }

    return jsonResponse(
      200,
      {
        symbols,
        outcome,
        payout,
        profit,
        balance: nextBalance,
        wipeBalance,
      },
      CORS_ORIGIN
    );
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
