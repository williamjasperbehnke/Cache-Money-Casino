const crypto = require("crypto");
const { get, put } = require("./lib/db");
const { jsonResponse, parseJson, getRoute, getAuthToken } = require("./lib/utils");
const { updateStats } = require("./lib/stats");
const { 
  getSession,
  putUser, 
  resolveBalance, 
  persistBalance
} = require("./lib/session");
const {
  normalizeBets,
  totalBet,
  spinOutcome,
  computePayout,
  buildChaosZones,
  computeChaosBudget,
  applyRandomBets,
} = require("./game/roulette");
const { spinSlots } = require("./game/slots");
const { sanitizeState } = require("./game/sanitize");
const {
  createPokerState,
  applyPokerBet,
  applyPokerDraw,
  applyPokerCall,
  applyPokerFold,
  applyPokerReveal,
} = require("./game/poker");
const {
  createHoldemState,
  applyHoldemAction,
  applyHoldemFold,
} = require("./game/holdem");
const { 
  createBlackjackState, 
  applyBlackjackStats, 
  applyHit, 
  applyStand, 
  applyDouble, 
  applySplit
} = require("./game/blackjack");

const { GAME_SESSIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

const gameSessionId = (token, game) => `${token}:${game}`;

const parseGameFromPath = (path) => path.split("/games/")[1]?.split("/")[0] || "";

const getGameState = async (token, game) => {
  const resp = await get({
    TableName: GAME_SESSIONS_TABLE,
    Key: { session_id: gameSessionId(token, game) },
  });
  return resp.Item?.state || null;
};

const saveGameState = (token, session, game, state) =>
  put({
    TableName: GAME_SESSIONS_TABLE,
    Item: {
      session_id: gameSessionId(token, game),
      username: session?.username || "guest",
      game,
      state,
      updated_at: new Date().toISOString(),
    },
  });

const respondWithState = (status, game, payload) =>
  jsonResponse(status, { ...payload, state: sanitizeState(game, payload.state) }, CORS_ORIGIN);

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

  if (method === "GET" && path.includes("/games/") && path.endsWith("/state")) {
    const game = parseGameFromPath(path);
    const state = await getGameState(token, game);
    const { balance } = await resolveBalance(session);
    const active = Boolean(state && (state.inRound || state.awaitingClear));
    return respondWithState(200, game, {
      active,
      balance,
      state: active ? state : null,
    });
  }

  if (method === "POST" && path.endsWith("/games/roulette/spin")) {
    const { bets, paid } = parseJson(event);
    const normalized = normalizeBets(bets);
    const wager = totalBet(normalized);
    if (wager <= 0) {
      return jsonResponse(400, { error: "No bets placed." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (!paid && balance < wager) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const resultNumber = spinOutcome();
    const { payout, profit, win } = computePayout(normalized, resultNumber);

    let nextBalance = (paid ? balance : balance - wager) + payout;
    nextBalance = await persistBalance(session, user, nextBalance);
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "roulette",
        bet: wager,
        net: profit > 0 ? profit : -wager,
        result: profit > 0 ? "win" : "loss",
      });
      await putUser(user);
      nextBalance = user.balance;
    }
    return jsonResponse(
      200,
      {
        resultNumber,
        totalBet: wager,
        payout,
        profit,
        balance: nextBalance,
        win,
      },
      CORS_ORIGIN
    );
  }

  if (method === "POST" && path.endsWith("/games/roulette/chaos")) {
    const body = parseJson(event);
    const bets = normalizeBets(body.bets);
    const chipValues = (body.chipValues || []).map(Number).filter((val) => val > 0);
    const maxPerSlot = Number(body.maxPerSlot) || 50;
    if (chipValues.length === 0) {
      return jsonResponse(400, { error: "No chip values." }, CORS_ORIGIN);
    }
    const { balance } = await resolveBalance(session);
    const { available, spend } = computeChaosBudget(balance);
    if (available <= 0) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const zones = buildChaosZones();
    const { nextBets, spent } = applyRandomBets({
      bets,
      chipValues,
      maxPerSlot,
      spend,
      zones,
    });

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
    const { user, balance } = await resolveBalance(session);
    const result = spinSlots(bet, balance);
    if (result.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    let { nextBalance } = result;
    nextBalance = await persistBalance(session, user, nextBalance);
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "slots",
        bet: Number(bet),
        net: result.profit,
        result: result.profit > 0 ? "win" : "loss",
      });
      await putUser(user);
      nextBalance = user.balance;
    }

    return jsonResponse(
      200,
      {
        symbols: result.symbols,
        outcome: result.outcome,
        payout: result.payout,
        profit: result.profit,
        balance: nextBalance,
        wipeBalance: result.wipeBalance,
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
    const state = createBlackjackState(wager);
    await saveGameState(token, session, "blackjack", state);
    const nextBalance = await persistBalance(session, user, balance - wager);
    return respondWithState(200, "blackjack", {
      state,
      balance: nextBalance,
      message: null,
    });
  }

  if (method === "POST" && path.endsWith("/games/blackjack/hit")) {
    const state = await getGameState(token, "blackjack");
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const result = applyHit(state);
    if (result.finished) {
      const { user, balance } = await resolveBalance(session);
      applyBlackjackStats(user, state, result.outcomes);
      const nextBalance = await persistBalance(session, user, balance + result.payoutTotal);
      if (user) await putUser(user);
      await saveGameState(token, session, "blackjack", state);
      return respondWithState(200, "blackjack", {
        state,
        outcomes: result.outcomes,
        payoutTotal: result.payoutTotal,
        messages: result.messages,
        balance: nextBalance,
      });
    }
    await saveGameState(token, session, "blackjack", state);
    return respondWithState(200, "blackjack", { state, messages: result.messages });
  }

  if (method === "POST" && path.endsWith("/games/blackjack/stand")) {
    const state = await getGameState(token, "blackjack");
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const result = applyStand(state);
    if (result.finished) {
      const { user, balance } = await resolveBalance(session);
      applyBlackjackStats(user, state, result.outcomes);
      const nextBalance = await persistBalance(session, user, balance + result.payoutTotal);
      if (user) await putUser(user);
      await saveGameState(token, session, "blackjack", state);
      return respondWithState(200, "blackjack", {
        state,
        outcomes: result.outcomes,
        payoutTotal: result.payoutTotal,
        messages: result.messages,
        balance: nextBalance,
      });
    }
    await saveGameState(token, session, "blackjack", state);
    return respondWithState(200, "blackjack", { state, messages: result.messages });
  }

  if (method === "POST" && path.endsWith("/games/blackjack/double")) {
    const state = await getGameState(token, "blackjack");
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
    const result = applyDouble(state);
    if (result.finished) {
      applyBlackjackStats(user, state, result.outcomes);
      const finalBalance = await persistBalance(session, user, nextBalance + result.payoutTotal);
      if (user) await putUser(user);
      await saveGameState(token, session, "blackjack", state);
      return respondWithState(200, "blackjack", {
        state,
        outcomes: result.outcomes,
        payoutTotal: result.payoutTotal,
        messages: result.messages,
        balance: finalBalance,
      });
    }
    await saveGameState(token, session, "blackjack", state);
    return respondWithState(200, "blackjack", { state, messages: result.messages, balance: nextBalance });
  }

  if (method === "POST" && path.endsWith("/games/blackjack/split")) {
    const state = await getGameState(token, "blackjack");
    if (!state || !state.inRound) {
      return jsonResponse(400, { error: "Round not running." }, CORS_ORIGIN);
    }
    const bet = state.bets[state.activeHand];
    const { user, balance } = await resolveBalance(session);
    if (balance < bet) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, balance - bet);
    const splitResult = applySplit(state);
    if (splitResult.error) {
      return jsonResponse(400, { error: splitResult.error }, CORS_ORIGIN);
    }
    await saveGameState(token, session, "blackjack", state);
    return respondWithState(200, "blackjack", { state, balance: nextBalance, messages: [] });
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
    const state = createHoldemState({
      blindSmall,
      blindBig,
      dealerButton,
      playerBlind,
      dealerBlind,
    });
    const message = `Blinds in. You: $${playerBlind}, Dealer: $${dealerBlind}.`;
    await saveGameState(token, session, "holdem", state);
    return respondWithState(200, "holdem", {
      state,
      balance: nextBalance,
      messages: [{ text: message, tone: "win", duration: 1600 }],
    });
  }

  if (method === "POST" && path.endsWith("/games/holdem/action")) {
    const body = parseJson(event);
    const state = await getGameState(token, "holdem");
    const betAmount = Number(body.betAmount) || 0;
    const { user, balance } = await resolveBalance(session);
    const result = applyHoldemAction(state, betAmount, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (result?.net !== undefined && user) {
      user.stats = updateStats(user.stats, {
        game: "holdem",
        bet: state.playerPaid,
        net: result.net,
        result: result.net > 0 ? "win" : result.net < 0 ? "loss" : "push",
      });
      await putUser(user);
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "holdem", state);
    return respondWithState(200, "holdem", {
      state,
      balance: nextBalance,
      messages: result.messages || [],
      showdown: result.showdown,
    });
  }

  if (method === "POST" && path.endsWith("/games/holdem/fold")) {
    const state = await getGameState(token, "holdem");
    const { user, balance } = await resolveBalance(session);
    const result = applyHoldemFold(state, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "holdem",
        bet: state.playerPaid,
        net: result.net,
        result: "loss",
      });
      await putUser(user);
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "holdem", state);
    return respondWithState(200, "holdem", {
      state,
      balance: nextBalance,
      messages: result.messages || [],
    });
  }

  if (method === "POST" && path.endsWith("/games/poker/deal")) {
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
    const state = createPokerState({
      blindSmall,
      blindBig,
      dealerButton,
      playerBlind,
      dealerBlind,
    });
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", { state, balance: nextBalance });
  }

  if (method === "POST" && path.endsWith("/games/poker/bet")) {
    const body = parseJson(event);
    const betAmount = Number(body.betAmount) || 0;
    const state = await getGameState(token, "poker");
    const { user, balance } = await resolveBalance(session);
    const result = applyPokerBet(state, betAmount, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (result?.net !== undefined && user) {
      user.stats = updateStats(user.stats, {
        game: "poker",
        bet: state.playerPaid,
        net: result.net,
        result: result.result || (result.net > 0 ? "win" : result.net < 0 ? "loss" : "push"),
      });
      await putUser(user);
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", {
      state,
      balance: nextBalance,
      messages: result.messages || [],
    });
  }

  if (method === "POST" && path.endsWith("/games/poker/draw")) {
    const body = parseJson(event);
    const discards = Array.isArray(body.discards) ? body.discards : [];
    const state = await getGameState(token, "poker");
    const result = applyPokerDraw(state, discards);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", {
      state,
      dealerDiscarded: result.dealerDiscarded,
    });
  }

  if (method === "POST" && path.endsWith("/games/poker/call")) {
    const state = await getGameState(token, "poker");
    const { user, balance } = await resolveBalance(session);
    const result = applyPokerCall(state, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", { state, balance: nextBalance });
  }

  if (method === "POST" && path.endsWith("/games/poker/fold")) {
    const state = await getGameState(token, "poker");
    const { user, balance } = await resolveBalance(session);
    const result = applyPokerFold(state, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "poker",
        bet: state.playerPaid,
        net: result.net,
        result: result.result || "loss",
      });
      await putUser(user);
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", {
      state,
      balance: nextBalance,
      messages: result.messages || [],
    });
  }

  if (method === "POST" && path.endsWith("/games/poker/reveal")) {
    const state = await getGameState(token, "poker");
    const { user, balance } = await resolveBalance(session);
    const result = applyPokerReveal(state, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "poker",
        bet: state.playerPaid,
        net: result.net,
        result: result.net > 0 ? "win" : result.net < 0 ? "loss" : "push",
      });
      await putUser(user);
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", {
      state,
      balance: nextBalance,
      result: result.result,
      playerLabel: result.playerLabel,
      dealerLabel: result.dealerLabel,
      playerIndexes: result.playerIndexes,
      dealerIndexes: result.dealerIndexes,
    });
  }

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
