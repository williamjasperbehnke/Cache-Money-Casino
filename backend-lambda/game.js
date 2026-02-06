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

const pokerCardValue = (card) => {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
};

const pokerEvaluateHand = (cards) => {
  const values = cards.map((card) => pokerCardValue(card)).sort((a, b) => a - b);
  const counts = {};
  const suitsCount = {};
  cards.forEach((card) => {
    const value = pokerCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
    suitsCount[card.suit] = (suitsCount[card.suit] || 0) + 1;
  });

  const isFlush = Object.values(suitsCount).some((count) => count === 5);
  const isWheel = values.toString() === "2,3,4,5,14";
  const isStraight =
    values.every((value, index) => (index === 0 ? true : value === values[index - 1] + 1)) ||
    isWheel;
  const straightValues = isWheel ? [5, 4, 3, 2, 1] : [...values];
  const sortedCounts = Object.values(counts).sort((a, b) => b - a);

  const valueLabel = (value) => {
    if (value === 14) return "Aces";
    if (value === 13) return "Kings";
    if (value === 12) return "Queens";
    if (value === 11) return "Jacks";
    return `${value}s`;
  };

  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (isStraight && isFlush) return { rank: 8, label: "Straight Flush", values: straightValues };
  if (sortedCounts[0] === 4) {
    const quad = byCount.find((entry) => entry.count === 4)?.value;
    return { rank: 7, label: `Four of a Kind (${valueLabel(quad)})`, values };
  }
  if (sortedCounts[0] === 3 && sortedCounts[1] === 2) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return {
      rank: 6,
      label: `Full House (${valueLabel(trips)} over ${valueLabel(pair)})`,
      values,
    };
  }
  if (isFlush) return { rank: 5, label: "Flush", values };
  if (isStraight) return { rank: 4, label: "Straight", values: straightValues };
  if (sortedCounts[0] === 3) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    return { rank: 3, label: `Three of a Kind (${valueLabel(trips)})`, values };
  }
  if (sortedCounts[0] === 2 && sortedCounts[1] === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return {
      rank: 2,
      label: `Two Pair (${valueLabel(pairs[0])} & ${valueLabel(pairs[1])})`,
      values,
    };
  }
  if (sortedCounts[0] === 2) {
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return { rank: 1, label: `Pair of ${valueLabel(pair)}`, values };
  }
  return { rank: 0, label: "High Card", values };
};

const pokerCompareHands = (player, dealer) => {
  if (player.rank !== dealer.rank) {
    return player.rank > dealer.rank ? 1 : -1;
  }
  const dVals = [...dealer.values].sort((a, b) => b - a);
  const pVals = [...player.values].sort((a, b) => b - a);
  for (let i = 0; i < pVals.length; i += 1) {
    if (pVals[i] !== dVals[i]) {
      return pVals[i] > dVals[i] ? 1 : -1;
    }
  }
  return 0;
};

const pokerWinningIndexes = (cards, evaluation) => {
  const values = cards.map((card) => pokerCardValue(card));
  const counts = {};
  values.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
  });
  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (evaluation.rank >= 4) return cards.map((_, idx) => idx);
  if (evaluation.rank === 7) {
    const target = byCount.find((entry) => entry.count === 4)?.value;
    return values.map((value, idx) => (value === target ? idx : null)).filter((idx) => idx !== null);
  }
  if (evaluation.rank === 6) return cards.map((_, idx) => idx);
  if (evaluation.rank === 3) {
    const target = byCount.find((entry) => entry.count === 3)?.value;
    return values.map((value, idx) => (value === target ? idx : null)).filter((idx) => idx !== null);
  }
  if (evaluation.rank === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return values.map((value, idx) => (pairs.includes(value) ? idx : null)).filter((idx) => idx !== null);
  }
  if (evaluation.rank === 1) {
    const target = byCount.find((entry) => entry.count === 2)?.value;
    return values.map((value, idx) => (value === target ? idx : null)).filter((idx) => idx !== null);
  }
  const high = Math.max(...values);
  const highIndex = values.indexOf(high);
  return highIndex >= 0 ? [highIndex] : [];
};

const pokerRaisePercent = (rank) => {
  if (rank >= 6) return 0.8;
  if (rank >= 4) return 0.65;
  if (rank >= 2) return 0.5;
  if (rank >= 1) return 0.25;
  return 0;
};

const pokerDealerAction = (hand, betAmount, phase) => {
  const evalHand = pokerEvaluateHand(hand);
  const raisePct = pokerRaisePercent(evalHand.rank);
  if (betAmount === 0) {
    if (raisePct > 0 && Math.random() > 0.35) {
      return { action: "raise", raisePct, evalHand };
    }
    return { action: "call", raisePct, evalHand };
  }
  if (phase !== "bet1" && evalHand.rank === 0 && Math.random() > 0.5) {
    return { action: "fold", raisePct, evalHand };
  }
  if (raisePct > 0 && Math.random() > 0.55) {
    return { action: "raise", raisePct, evalHand };
  }
  return { action: "call", raisePct, evalHand };
};

const pokerDealerDraw = (hand, deck) => {
  const evaluation = pokerEvaluateHand(hand);
  const rank = evaluation.rank;
  const counts = {};
  hand.forEach((card) => {
    const value = pokerCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
  });

  const keepRanks = new Set();
  if (rank >= 4) {
    return { hand, discarded: 0 };
  }
  if (rank === 3 || rank === 2 || rank === 1) {
    const keepCount = rank === 3 ? 3 : 2;
    Object.entries(counts).forEach(([value, count]) => {
      if (count === keepCount) keepRanks.add(Number(value));
    });
  } else {
    const high = Math.max(...hand.map((card) => pokerCardValue(card)));
    keepRanks.add(high);
  }

  let discarded = 0;
  const nextHand = hand.map((card) => {
    const value = pokerCardValue(card);
    if (keepRanks.has(value)) return card;
    discarded += 1;
    return draw(deck);
  });

  return { hand: nextHand, discarded };
};

const HOLDEM_BETTING_PHASES = new Set(["preflop", "flop", "turn", "river"]);

const holdemPhaseCommunityCount = (phase) => {
  if (phase === "flop") return 3;
  if (phase === "turn") return 4;
  if (phase === "river" || phase === "showdown") return 5;
  return 0;
};

const holdemCardValue = (card) => {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
};

const holdemEvaluateHand = (cards) => {
  const values = cards.map((card) => holdemCardValue(card)).sort((a, b) => a - b);
  const counts = {};
  const suitsCount = {};
  cards.forEach((card) => {
    const value = holdemCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
    suitsCount[card.suit] = (suitsCount[card.suit] || 0) + 1;
  });

  const isFlush = Object.values(suitsCount).some((count) => count === 5);
  const isWheel = values.toString() === "2,3,4,5,14";
  const isStraight =
    values.every((value, index) => (index === 0 ? true : value === values[index - 1] + 1)) ||
    isWheel;
  const straightValues = isWheel ? [5, 4, 3, 2, 1] : [...values];
  const sortedCounts = Object.values(counts).sort((a, b) => b - a);

  const valueLabel = (value) => {
    if (value === 14) return "Aces";
    if (value === 13) return "Kings";
    if (value === 12) return "Queens";
    if (value === 11) return "Jacks";
    return `${value}s`;
  };

  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (isStraight && isFlush) return { rank: 8, label: "Straight Flush", values: straightValues };
  if (sortedCounts[0] === 4) {
    const quad = byCount.find((entry) => entry.count === 4)?.value;
    return { rank: 7, label: `Four of a Kind (${valueLabel(quad)})`, values };
  }
  if (sortedCounts[0] === 3 && sortedCounts[1] === 2) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return {
      rank: 6,
      label: `Full House (${valueLabel(trips)} over ${valueLabel(pair)})`,
      values,
    };
  }
  if (isFlush) return { rank: 5, label: "Flush", values };
  if (isStraight) return { rank: 4, label: "Straight", values: straightValues };
  if (sortedCounts[0] === 3) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    return { rank: 3, label: `Three of a Kind (${valueLabel(trips)})`, values };
  }
  if (sortedCounts[0] === 2 && sortedCounts[1] === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return {
      rank: 2,
      label: `Two Pair (${valueLabel(pairs[0])} & ${valueLabel(pairs[1])})`,
      values,
    };
  }
  if (sortedCounts[0] === 2) {
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return { rank: 1, label: `Pair of ${valueLabel(pair)}`, values };
  }
  return { rank: 0, label: "High Card", values };
};

const holdemCompareHands = (player, dealer) => {
  if (player.rank !== dealer.rank) {
    return player.rank > dealer.rank ? 1 : -1;
  }
  const dVals = [...dealer.values].sort((a, b) => b - a);
  const pVals = [...player.values].sort((a, b) => b - a);
  for (let i = 0; i < pVals.length; i += 1) {
    if (pVals[i] !== dVals[i]) {
      return pVals[i] > dVals[i] ? 1 : -1;
    }
  }
  return 0;
};

const holdemCombinations = (arrLength, size) => {
  const results = [];
  const combo = [];
  const dfs = (start, depth) => {
    if (depth === size) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i <= arrLength - (size - depth); i += 1) {
      combo.push(i);
      dfs(i + 1, depth + 1);
      combo.pop();
    }
  };
  dfs(0, 0);
  return results;
};

const holdemBestHand = (cards) => {
  const combos = holdemCombinations(cards.length, 5);
  let bestEval = null;
  let bestCombo = combos[0];
  combos.forEach((indexes) => {
    const hand = indexes.map((idx) => cards[idx]);
    const evalHand = holdemEvaluateHand(hand);
    if (!bestEval) {
      bestEval = evalHand;
      bestCombo = indexes;
      return;
    }
    if (holdemCompareHands(evalHand, bestEval) > 0) {
      bestEval = evalHand;
      bestCombo = indexes;
    }
  });
  return { eval: bestEval, indexes: bestCombo };
};

const holdemResetBettingRound = (state) => {
  state.playerBet = 0;
  state.dealerBet = 0;
  state.currentBet = 0;
  state.betAmount = 0;
  state.awaitingRaise = false;
  state.dealerRaised = false;
};

const holdemAdvancePhase = (state) => {
  if (state.phase === "preflop") state.phase = "flop";
  else if (state.phase === "flop") state.phase = "turn";
  else if (state.phase === "turn") state.phase = "river";
  else if (state.phase === "river") state.phase = "showdown";
  holdemResetBettingRound(state);
};

const holdemPreflopStrength = (hand) => {
  const values = hand.map((card) => holdemCardValue(card)).sort((a, b) => b - a);
  const isPair = values[0] === values[1];
  const suited = hand[0].suit === hand[1].suit;
  const gap = Math.abs(values[0] - values[1]);
  if (isPair && values[0] >= 11) return 5;
  if (isPair) return 4;
  if (values[0] >= 13 && suited) return 4;
  if (values[0] >= 13) return 3;
  if (suited && gap <= 2) return 3;
  if (values[0] >= 11) return 2;
  return 1;
};

const holdemDealerStrength = (state) => {
  const visibleCommunity = state.community.slice(0, holdemPhaseCommunityCount(state.phase));
  if (visibleCommunity.length < 3) {
    return holdemPreflopStrength(state.dealer);
  }
  const combined = [...state.dealer, ...visibleCommunity];
  const best = holdemBestHand(combined);
  return best.eval.rank;
};

const holdemDealerRaiseAmount = (state, strength, playerBalance) => {
  const base = Math.max(10, Math.round(state.pot * (0.35 + strength * 0.1)));
  return Math.min(base, Math.max(5, playerBalance));
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

const resolveBlackjack = (state, { omitBusted = false } = {}) => {
  resolveDealer(state);
  const dealerTotal = handTotal(state.dealer);
  const outcomes = [];
  let payoutTotal = 0;
  state.hands.forEach((hand, index) => {
    if (omitBusted && (state.busted[index] || handTotal(hand) > 21)) {
      return;
    }
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
    const { bets, paid } = parseJson(event);
    const numbers = bets?.numbers || {};
    const colors = bets?.colors || {};
    const parities = bets?.parities || {};
    const totalBet = sumValues(numbers) + sumValues(colors) + sumValues(parities);
    if (totalBet <= 0) {
      return jsonResponse(400, { error: "No bets placed." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (!paid && balance < totalBet) {
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

    let nextBalance = (paid ? balance : balance - totalBet) + payout;
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
      const { outcomes, payoutTotal } = resolveBlackjack(state, { omitBusted: true });
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
      const { outcomes, payoutTotal } = resolveBlackjack(state, { omitBusted: true });
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
      const { outcomes, payoutTotal } = resolveBlackjack(state, { omitBusted: true });
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

  if (method === "POST" && path.endsWith("/games/holdem/deal")) {
    const body = parseJson(event);
    const incoming = body.state || {};
    const blindSmall = Number(incoming.blindSmall) || 5;
    const blindBig = Number(incoming.blindBig) || 10;
    const dealerButton = Boolean(incoming.dealerButton);
    const nextDealerButton = !dealerButton;
    const desiredPlayerBlind = nextDealerButton ? blindBig : blindSmall;
    const desiredDealerBlind = nextDealerButton ? blindSmall : blindBig;
    const { user, balance } = await resolveBalance(session);
    const playerBlind = Math.min(desiredPlayerBlind, balance);
    const dealerBlind = Math.min(desiredDealerBlind, balance);
    if (playerBlind <= 0) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, balance - playerBlind);
    const deck = shuffle(buildDeck());
    const state = {
      pot: playerBlind + dealerBlind,
      playerPaid: playerBlind,
      playerBet: playerBlind,
      dealerBet: dealerBlind,
      currentBet: Math.max(playerBlind, dealerBlind),
      betAmount: 0,
      blindSmall,
      blindBig,
      dealerButton: nextDealerButton,
      awaitingRaise: false,
      skipBetting: false,
      deck,
      player: [draw(deck), draw(deck)],
      dealer: [draw(deck), draw(deck)],
      community: [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)],
      phase: "preflop",
      awaitingClear: false,
      inRound: true,
      dealerRaised: false,
    };
    const message = `Blinds in. You: $${playerBlind}, Dealer: $${dealerBlind}.`;
    return jsonResponse(200, { state, balance: nextBalance, messages: [{ text: message, tone: "win", duration: 1600 }] }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/holdem/action")) {
    const body = parseJson(event);
    const state = body.state;
    const betAmount = Number(body.betAmount) || 0;
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    state.betAmount = betAmount;
    const { user, balance } = await resolveBalance(session);
    let nextBalance = balance;
    const messages = [];

    const toCall = Math.max(0, state.currentBet - state.playerBet);
    const canBet = HOLDEM_BETTING_PHASES.has(state.phase);
    if (!canBet) {
      return jsonResponse(400, { error: "Betting is closed." }, CORS_ORIGIN);
    }

    const phaseLabels = {
      flop: "Flop dealt.",
      turn: "Turn card.",
      river: "River card.",
      preflop: "Pre-flop betting.",
    };

    const advanceToShowdownIfBroke = () => {
      if (nextBalance > 0) return false;
      state.skipBetting = true;
      while (state.inRound && HOLDEM_BETTING_PHASES.has(state.phase)) {
        holdemAdvancePhase(state);
      }
      return true;
    };

    const finishShowdown = () => {
      const playerCombined = [...state.player, ...state.community];
      const dealerCombined = [...state.dealer, ...state.community];
      const playerBest = holdemBestHand(playerCombined);
      const dealerBest = holdemBestHand(dealerCombined);
      const result = holdemCompareHands(playerBest.eval, dealerBest.eval);
      let payoutTotal = 0;
      let net = 0;
      if (result > 0) {
        payoutTotal = state.pot;
        net = state.pot - state.playerPaid;
        messages.push({ text: `You win with ${playerBest.eval.label}!`, tone: "win", duration: 2400 });
      } else if (result < 0) {
        net = -state.playerPaid;
        messages.push({ text: `Dealer wins with ${dealerBest.eval.label}.`, tone: "danger", duration: 2400 });
      } else {
        payoutTotal = state.pot / 2;
        net = 0;
        messages.push({ text: "Push. Pot split.", tone: "win", duration: 2000 });
      }
      nextBalance += payoutTotal;
      state.awaitingClear = true;
      state.inRound = false;
      state.phase = "showdown";
      if (user) {
        user.stats = updateStats(user.stats, {
          game: "holdem",
          bet: state.playerPaid,
          net,
          result: net > 0 ? "win" : net < 0 ? "loss" : "push",
        });
        putUser(user);
      }
      return {
        showdown: {
          playerLabel: playerBest.eval.label,
          dealerLabel: dealerBest.eval.label,
          result,
          playerIndexes: playerBest.indexes,
          dealerIndexes: dealerBest.indexes,
        },
      };
    };

    const dealerActs = () => {
      const dealerToCall = Math.max(0, state.currentBet - state.dealerBet);
      const strength = holdemDealerStrength(state);
      if (dealerToCall === 0) {
        if (strength >= 2 && Math.random() > 0.15 && !state.dealerRaised) {
          const raiseBy = holdemDealerRaiseAmount(state, strength, nextBalance);
          const maxRaiseTo = state.playerBet + nextBalance;
          const raiseTo = Math.min(state.currentBet + raiseBy, maxRaiseTo);
          if (raiseTo > state.currentBet) {
            const add = raiseTo - state.dealerBet;
            state.dealerBet = raiseTo;
            state.currentBet = raiseTo;
            state.pot += add;
            state.dealerRaised = true;
            state.betAmount = 0;
            state.awaitingRaise = true;
            messages.push({ text: `Dealer bets $${raiseTo}.`, tone: "danger", duration: 2000 });
            return null;
          }
        }
        messages.push({ text: "Dealer checks.", tone: "win", duration: 1200 });
        holdemAdvancePhase(state);
        return null;
      }

      if (strength <= 1 && Math.random() > 0.85) {
        messages.push({ text: "Dealer folds. You win!", tone: "win", duration: 2000 });
        nextBalance += state.pot;
        state.awaitingClear = true;
        state.inRound = false;
        state.phase = "showdown";
        if (user) {
          user.stats = updateStats(user.stats, {
            game: "holdem",
            bet: state.playerPaid,
            net: state.pot - state.playerPaid,
            result: "win",
          });
          putUser(user);
        }
        return { folded: true };
      }

      if (strength >= 3 && Math.random() > 0.2 && !state.dealerRaised) {
        const raiseBy = holdemDealerRaiseAmount(state, strength, nextBalance);
        const maxRaiseTo = state.playerBet + nextBalance;
        const raiseTo = Math.min(state.currentBet + raiseBy, maxRaiseTo);
        if (raiseTo > state.currentBet) {
          const add = raiseTo - state.dealerBet;
          state.dealerBet = raiseTo;
          state.currentBet = raiseTo;
          state.pot += add;
          state.dealerRaised = true;
          state.betAmount = 0;
          state.awaitingRaise = true;
          messages.push({ text: `Dealer raises to $${raiseTo}.`, tone: "danger", duration: 2000 });
          return null;
        }
      }

      state.pot += dealerToCall;
      state.dealerBet = state.currentBet;
      messages.push({ text: "Dealer calls.", tone: "win", duration: 1200 });
      holdemAdvancePhase(state);
      return null;
    };

    const prevPhase = state.phase;

    let skipDealer = false;
    if (toCall > 0 && betAmount > 0) {
      const totalNeeded = toCall + betAmount;
      if (totalNeeded > nextBalance) {
        return jsonResponse(400, { error: "Not enough credits to raise." }, CORS_ORIGIN);
      }
      nextBalance -= totalNeeded;
      state.pot += totalNeeded;
      state.playerPaid += totalNeeded;
      state.playerBet += totalNeeded;
      state.currentBet = state.playerBet;
      state.awaitingRaise = false;
    } else if (toCall > 0) {
      const amount = Math.min(toCall, nextBalance);
      if (amount <= 0) return jsonResponse(400, { error: "Not enough credits to call." }, CORS_ORIGIN);
      nextBalance -= amount;
      state.pot += amount;
      state.playerPaid += amount;
      state.playerBet += amount;
      if (amount === toCall) state.playerBet = state.currentBet;
      if (amount < toCall) {
        messages.push({ text: "All-in call.", tone: "win", duration: 1600 });
      }
      if (state.awaitingRaise) {
        state.awaitingRaise = false;
        holdemAdvancePhase(state);
        skipDealer = true;
      }
    } else if (betAmount > 0) {
      if (betAmount > nextBalance) {
        return jsonResponse(400, { error: "Not enough credits to raise." }, CORS_ORIGIN);
      }
      nextBalance -= betAmount;
      state.pot += betAmount;
      state.playerPaid += betAmount;
      state.playerBet += betAmount;
      state.currentBet = state.playerBet;
      state.awaitingRaise = false;
    }

    if (advanceToShowdownIfBroke()) {
      const showdown = finishShowdown();
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages, ...showdown }, CORS_ORIGIN);
    }

    if (state.phase === "showdown") {
      const showdown = finishShowdown();
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages, ...showdown }, CORS_ORIGIN);
    }

    if (state.awaitingRaise) {
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
    }
    if (skipDealer) {
      if (state.phase !== prevPhase && state.phase !== "showdown" && !state.skipBetting) {
        const label = phaseLabels[state.phase];
        if (label) messages.push({ text: label, tone: "win", duration: 1400 });
      }
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
    }

    const dealerResult = dealerActs();
    if (state.phase !== prevPhase && state.phase !== "showdown" && !state.skipBetting) {
      const label = phaseLabels[state.phase];
      if (label) messages.push({ text: label, tone: "win", duration: 1400 });
    }
    if (state.phase === "showdown") {
      const showdown = finishShowdown();
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages, ...showdown }, CORS_ORIGIN);
    }
    if (dealerResult && dealerResult.folded) {
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
    }

    const finalBalance = await persistBalance(session, user, nextBalance);
    return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/holdem/fold")) {
    const body = parseJson(event);
    const state = body.state;
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    const messages = [{ text: "You folded. Dealer wins.", tone: "danger", duration: 2000 }];
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "holdem",
        bet: state.playerPaid,
        net: -state.playerPaid,
        result: "loss",
      });
      await putUser(user);
    }
    state.awaitingClear = true;
    state.inRound = false;
    state.phase = "showdown";
    const finalBalance = await persistBalance(session, user, balance);
    return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/poker/deal")) {
    const body = parseJson(event);
    const blind = Number(body.blind) || 5;
    const { user, balance } = await resolveBalance(session);
    if (balance < blind) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, balance - blind);
    const deck = shuffle(buildDeck());
    const player = [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)];
    const dealer = [draw(deck), draw(deck), draw(deck), draw(deck), draw(deck)];
    const state = {
      blind,
      pot: blind * 2,
      playerPaid: blind,
      betAmount: 0,
      bet1: 0,
      bet2: 0,
      bet3: 0,
      betRaise: 0,
      pendingCall: 0,
      awaitingRaise: false,
      phase: "bet1",
      drawRound: 0,
      discards: [],
      canDiscard: false,
      deck,
      player,
      dealer,
      inRound: true,
      awaitingClear: false,
    };
    return jsonResponse(200, { state, balance: nextBalance }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/poker/bet")) {
    const body = parseJson(event);
    const state = body.state;
    const betAmount = Number(body.betAmount) || 0;
    if (!state || !state.inRound || !state.phase?.startsWith("bet")) {
      return jsonResponse(400, { error: "Betting is closed." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    let nextBalance = balance;
    const messages = [];
    if (betAmount < 0) {
      return jsonResponse(400, { error: "Select a bet amount." }, CORS_ORIGIN);
    }
    if (betAmount > nextBalance) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    nextBalance -= betAmount;
    state.betAmount = 0;
    state.playerPaid += betAmount;
    state.pot += betAmount;
    if (state.phase === "bet1") state.bet1 = betAmount;
    if (state.phase === "bet2") state.bet2 = betAmount;
    if (state.phase === "bet3") state.bet3 = betAmount;

    const decision = pokerDealerAction(state.dealer, betAmount, state.phase);
    if (decision.action === "fold") {
      messages.push({ text: "Dealer folds. You win!", tone: "win", duration: 2000 });
      nextBalance += state.pot;
      state.awaitingClear = true;
      state.inRound = false;
      state.phase = "reveal";
      if (user) {
        user.stats = updateStats(user.stats, {
          game: "poker",
          bet: state.playerPaid,
          net: state.pot - state.playerPaid,
          result: "win",
        });
        await putUser(user);
      }
      const finalBalance = await persistBalance(session, user, nextBalance);
      return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
    }

    if (decision.action === "raise") {
      const raiseAmount = Math.min(
        Math.max(5, Math.round(state.pot * decision.raisePct)),
        nextBalance
      );
      if (raiseAmount > 0) {
        state.pot += raiseAmount;
        state.betRaise = raiseAmount;
        state.pendingCall = raiseAmount;
        state.awaitingRaise = true;
        messages.push({ text: `Dealer raises to $${raiseAmount}.`, tone: "danger", duration: 2000 });
        const finalBalance = await persistBalance(session, user, nextBalance);
        return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
      }
    }

    // dealer calls
    state.pot += betAmount;
    messages.push({ text: "Dealer calls.", tone: "win", duration: 1200 });
    if (state.phase === "bet1") state.phase = "discard1";
    else if (state.phase === "bet2") state.phase = "discard2";
    else if (state.phase === "bet3") state.phase = "reveal";
    state.canDiscard = state.phase.startsWith("discard");
    const finalBalance = await persistBalance(session, user, nextBalance);
    return jsonResponse(200, { state, balance: finalBalance, messages }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/poker/draw")) {
    const body = parseJson(event);
    const state = body.state;
    const discards = Array.isArray(body.discards) ? body.discards : [];
    if (!state || !state.inRound || !state.phase?.startsWith("discard")) {
      return jsonResponse(400, { error: "Discard not allowed." }, CORS_ORIGIN);
    }
    const discardSet = new Set(discards);
    state.player = state.player.map((card, idx) => (discardSet.has(idx) ? draw(state.deck) : card));
    const dealerDraw = pokerDealerDraw(state.dealer, state.deck);
    state.dealer = dealerDraw.hand;
    state.canDiscard = false;
    if (state.phase === "discard1") state.phase = "bet2";
    else if (state.phase === "discard2") state.phase = "bet3";
    return jsonResponse(200, { state, dealerDiscarded: dealerDraw.discarded }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/poker/call")) {
    const body = parseJson(event);
    const state = body.state;
    if (!state || !state.inRound || !state.awaitingRaise) {
      return jsonResponse(400, { error: "No raise to call." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    const callAmount = Math.min(state.pendingCall || 0, balance);
    if (callAmount <= 0) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    let nextBalance = balance - callAmount;
    state.pot += callAmount;
    state.playerPaid += callAmount;
    state.awaitingRaise = false;
    state.pendingCall = 0;
    if (state.phase === "bet1") state.phase = "discard1";
    else if (state.phase === "bet2") state.phase = "discard2";
    else if (state.phase === "bet3") state.phase = "reveal";
    state.canDiscard = state.phase.startsWith("discard");
    const finalBalance = await persistBalance(session, user, nextBalance);
    return jsonResponse(200, { state, balance: finalBalance }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/poker/fold")) {
    const body = parseJson(event);
    const state = body.state;
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    state.awaitingClear = true;
    state.inRound = false;
    state.phase = "reveal";
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "poker",
        bet: state.playerPaid,
        net: -state.playerPaid,
        result: "loss",
      });
      await putUser(user);
    }
    const finalBalance = await persistBalance(session, user, balance);
    return jsonResponse(200, { state, balance: finalBalance, messages: [{ text: "You folded.", tone: "danger", duration: 2000 }] }, CORS_ORIGIN);
  }

  if (method === "POST" && path.endsWith("/games/poker/reveal")) {
    const body = parseJson(event);
    const state = body.state;
    if (!state) return jsonResponse(400, { error: "Invalid state." }, CORS_ORIGIN);
    const { user, balance } = await resolveBalance(session);
    const playerEval = pokerEvaluateHand(state.player);
    const dealerEval = pokerEvaluateHand(state.dealer);
    const result = pokerCompareHands(playerEval, dealerEval);
    let payoutTotal = 0;
    let net = 0;
    if (result > 0) {
      payoutTotal = state.pot;
      net = state.pot - state.playerPaid;
    } else if (result < 0) {
      net = -state.playerPaid;
    } else {
      payoutTotal = state.playerPaid;
      net = 0;
    }
    const nextBalance = await persistBalance(session, user, balance + payoutTotal);
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "poker",
        bet: state.playerPaid,
        net,
        result: net > 0 ? "win" : net < 0 ? "loss" : "push",
      });
      await putUser(user);
    }
    state.awaitingClear = true;
    state.inRound = false;
    state.phase = "reveal";
    return jsonResponse(
      200,
      {
        state,
        balance: nextBalance,
        result,
        playerLabel: playerEval.label,
        dealerLabel: dealerEval.label,
        playerIndexes: pokerWinningIndexes(state.player, playerEval),
        dealerIndexes: pokerWinningIndexes(state.dealer, dealerEval),
      },
      CORS_ORIGIN
    );
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
