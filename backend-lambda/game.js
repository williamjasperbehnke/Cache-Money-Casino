const crypto = require("crypto");
const { get, put, update } = require("./lib/db");
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

const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const BJ_SUITS = ["♠", "♥", "♦", "♣"];

const buildDeck = () => {
  const deck = [];
  BJ_SUITS.forEach((suit) => {
    BJ_RANKS.forEach((rank) => {
      deck.push({ rank, suit });
    });
  });
  return deck;
};

const shuffle = (deck) => {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const draw = (deck) => deck.shift();

const handTotal = (hand) => {
  let total = 0;
  let aces = 0;
  hand.forEach((card) => {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
};

const initBlackjackState = (bet) => {
  const deck = shuffle(buildDeck());
  const hands = [[draw(deck), draw(deck)]];
  const dealer = [draw(deck), draw(deck)];
  return {
    deck,
    hands,
    dealer,
    bets: [bet],
    doubled: [false],
    busted: [false],
    activeHand: 0,
    splitUsed: false,
    inRound: true,
    revealDealer: false,
  };
};

const canSplit = (state) => {
  if (state.splitUsed) return false;
  const hand = state.hands[state.activeHand] || [];
  return hand.length === 2 && hand[0].rank === hand[1].rank;
};

const advanceHand = (state) => {
  if (state.activeHand < state.hands.length - 1) {
    state.activeHand += 1;
    return false;
  }
  return true;
};

const resolveDealer = (state) => {
  const allBusted = state.hands.every((hand, idx) => state.busted[idx] || handTotal(hand) > 21);
  if (!allBusted) {
    while (handTotal(state.dealer) < 17) {
      state.dealer.push(draw(state.deck));
    }
  }
  state.revealDealer = true;
  state.inRound = false;
};

const resolveBlackjack = (state) => {
  resolveDealer(state);
  const dealerTotal = handTotal(state.dealer);
  const outcomes = [];
  let payoutTotal = 0;
  state.hands.forEach((hand, index) => {
    const bet = state.bets[index];
    const total = handTotal(hand);
    if (state.busted[index] || total > 21) {
      outcomes.push({ index, result: "loss", net: -bet });
      return;
    }
    if (dealerTotal > 21 || total > dealerTotal) {
      payoutTotal += bet * 2;
      outcomes.push({ index, result: "win", net: bet });
      return;
    }
    if (dealerTotal === total) {
      payoutTotal += bet;
      outcomes.push({ index, result: "push", net: 0 });
      return;
    }
    outcomes.push({ index, result: "loss", net: -bet });
  });
  return { dealerTotal, outcomes, payoutTotal };
};

const applyBlackjackStats = (user, state, outcomes) => {
  if (!user) return;
  outcomes.forEach((outcome) => {
    const bet = state.bets[outcome.index];
    const net = outcome.net;
    const result = net > 0 ? "win" : net < 0 ? "loss" : "push";
    user.stats = updateStats(user.stats, {
      game: "blackjack",
      bet,
      net,
      result,
    });
  });
};

const getSession = async (token) => {
  if (!token) return null;
  const resp = await get({
    TableName: SESSIONS_TABLE,
    Key: { token },
  });
  return resp.Item || null;
};

const putSession = (session) =>
  put({
    TableName: SESSIONS_TABLE,
    Item: session,
  });

const getUser = async (username) => {
  if (!username) return null;
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
    await put({
      TableName: GAME_SESSIONS_TABLE,
      Item: {
        session_id: sessionId,
        username: session.username || "guest",
        game,
        state: state || {},
        created_at: new Date().toISOString(),
      },
    });
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
    const { balance } = await resolveBalance(session);
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

    return jsonResponse(
      200,
      {
        bets: nextBets,
        spent,
        balance,
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

  if (method === "POST" && path.endsWith("/games/blackjack/deal")) {
    const { bet } = parseJson(event);
    const wager = Number(bet);
    if (!Number.isFinite(wager) || wager <= 0) {
      return jsonResponse(400, { error: "Invalid bet." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (balance < wager) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const state = initBlackjackState(wager);
    const nextBalance = await persistBalance(session, user, balance - wager);
    return jsonResponse(
      200,
      {
        state,
        balance: nextBalance,
        message: null,
      },
      CORS_ORIGIN
    );
  }

  if (method === "POST" && path.endsWith("/games/blackjack/hit")) {
    const { state } = parseJson(event);
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const hand = state.hands[state.activeHand];
    hand.push(draw(state.deck));
    const total = handTotal(hand);
    const messages = [];
    if (total > 21) {
      state.busted[state.activeHand] = true;
      const multiple = state.hands.length > 1;
      messages.push({
        text: multiple ? `Hand ${state.activeHand + 1} busts.` : "You bust.",
        tone: "danger",
      });
      const done = advanceHand(state);
      if (done) {
      const { outcomes, payoutTotal } = resolveBlackjack(state);
      const { user, balance } = await resolveBalance(session);
      applyBlackjackStats(user, state, outcomes);
      const nextBalance = await persistBalance(session, user, balance + payoutTotal);
      if (user) await putUser(user);
      return jsonResponse(
        200,
        {
          state,
          outcomes,
          payoutTotal,
          messages,
          balance: nextBalance,
        },
        CORS_ORIGIN
      );
      }
    }
    return jsonResponse(200, { state, messages }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/blackjack/stand")) {
    const { state } = parseJson(event);
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const done = advanceHand(state);
    if (done) {
      const { outcomes, payoutTotal } = resolveBlackjack(state);
      const { user, balance } = await resolveBalance(session);
      applyBlackjackStats(user, state, outcomes);
      const nextBalance = await persistBalance(session, user, balance + payoutTotal);
      if (user) await putUser(user);
      return jsonResponse(
        200,
        {
          state,
          outcomes,
          payoutTotal,
          messages: [],
          balance: nextBalance,
        },
        CORS_ORIGIN
      );
    }
    return jsonResponse(200, { state, messages: [] }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/blackjack/double")) {
    const { state } = parseJson(event);
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const hand = state.hands[state.activeHand];
    if (hand.length !== 2) {
      return jsonResponse(400, { error: "Cannot double now." }, CORS_ORIGIN);
    }
    const bet = state.bets[state.activeHand];
    const { user, balance } = await resolveBalance(session);
    if (balance < bet) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, balance - bet);
    state.bets[state.activeHand] = bet * 2;
    state.doubled[state.activeHand] = true;
    hand.push(draw(state.deck));
    const total = handTotal(hand);
    const messages = [];
    if (total > 21) {
      state.busted[state.activeHand] = true;
      const multiple = state.hands.length > 1;
      messages.push({
        text: multiple ? `Hand ${state.activeHand + 1} busts.` : "You bust.",
        tone: "danger",
      });
    }
    const done = advanceHand(state);
    if (done) {
      const { outcomes, payoutTotal } = resolveBlackjack(state);
      applyBlackjackStats(user, state, outcomes);
      const finalBalance = await persistBalance(session, user, nextBalance + payoutTotal);
      if (user) await putUser(user);
      return jsonResponse(
        200,
        {
          state,
          outcomes,
          payoutTotal,
          messages,
          balance: finalBalance,
        },
        CORS_ORIGIN
      );
    }
    return jsonResponse(200, { state, messages, balance: nextBalance }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/blackjack/split")) {
    const { state } = parseJson(event);
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    if (!canSplit(state)) {
      return jsonResponse(400, { error: "Cannot split now." }, CORS_ORIGIN);
    }
    const bet = state.bets[state.activeHand];
    const { user, balance } = await resolveBalance(session);
    if (balance < bet) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, balance - bet);
    const hand = state.hands[state.activeHand];
    const cardA = hand[0];
    const cardB = hand[1];
    state.hands = [
      [cardA, draw(state.deck)],
      [cardB, draw(state.deck)],
    ];
    state.bets = [bet, bet];
    state.doubled = [false, false];
    state.busted = [false, false];
    state.activeHand = 0;
    state.splitUsed = true;
    return jsonResponse(200, { state, balance: nextBalance, messages: [] }, CORS_ORIGIN);
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
