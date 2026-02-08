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
} = require("./game/roulette");
const { createCrapsState, resolveCrapsRoll } = require("./game/craps");
const {
  createMemoryState,
  applyMemoryFlip,
  finalizeMemoryGame,
} = require("./game/memory");
const { spinSlots } = require("./game/slots");
const {
  createYahtzeeState,
  applyYahtzeeRoll,
  applyYahtzeeScore,
} = require("./game/yahtzee");
const { sanitizeState } = require("./game/sanitize");
const {
  createPokerState,
  applyPokerBet,
  applyPokerDraw,
  applyPokerCall,
  applyPokerFold,
} = require("./game/poker");
const {
  createHoldemState,
  applyHoldemAction,
  applyHoldemFold,
  resolveHoldemShowdown,
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
    const active = Boolean(state && state.inRound);
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

  if (method === "POST" && path.endsWith("/games/craps/roll")) {
    const body = parseJson(event);
    const bets = body.bets || {};
    const paid = Boolean(body.paid);
    const state = (await getGameState(token, "craps")) || createCrapsState();
    const { user, balance } = await resolveBalance(session);
    const tableOn = body.tableOn !== false;
    const result = resolveCrapsRoll(state, bets, balance, paid, tableOn);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    const net = result.payout - result.wager;
    if (user) {
      user.stats = updateStats(user.stats, {
        game: "craps",
        bet: result.wager,
        net,
        result: net > 0 ? "win" : net < 0 ? "loss" : "push",
      });
      await putUser(user);
    }
    const nextState = { ...result.state, inRound: true };
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "craps", nextState);
    return respondWithState(200, "craps", {
      state: nextState,
      balance: nextBalance,
      roll: result.roll,
      payout: result.payout,
      wager: result.wager,
      win: result.win,
    });
  }

  if (method === "POST" && path.endsWith("/games/memory/start")) {
    const { bet } = parseJson(event);
    const wager = Number(bet) || 0;
    const MAX_MEMORY_BET = 100;
    if (wager <= 0) {
      return jsonResponse(400, { error: "Invalid bet." }, CORS_ORIGIN);
    }
    if (wager > MAX_MEMORY_BET) {
      return jsonResponse(400, { error: "Max bet is $100." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (balance < wager) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const state = createMemoryState({ bet: wager });
    const nextBalance = await persistBalance(session, user, balance - wager);
    await saveGameState(token, session, "memory", state);
    return respondWithState(200, "memory", { state, balance: nextBalance });
  }

  if (method === "POST" && path.endsWith("/games/memory/flip")) {
    const { index } = parseJson(event);
    const current = await getGameState(token, "memory");
    if (!current || !current.inRound) {
      return jsonResponse(400, { error: "No active game." }, CORS_ORIGIN);
    }
    const result = applyMemoryFlip(current, Number(index));
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    let nextBalance = balance;
    let payout = 0;
    let profit = 0;
    let multiplier = 0;
    if (result.completed) {
      const final = finalizeMemoryGame(result.state);
      payout = final.payout;
      profit = final.profit;
      multiplier = final.multiplier;
      nextBalance = await persistBalance(session, user, balance + payout);
      if (user) {
        user.stats = updateStats(user.stats, {
          game: "memory",
          bet: result.state.bet,
          net: profit,
          result: profit > 0 ? "win" : profit < 0 ? "loss" : "push",
        });
        await putUser(user);
      }
    }
    await saveGameState(token, session, "memory", result.state);
    return respondWithState(200, "memory", {
      state: result.state,
      balance: nextBalance,
      completed: Boolean(result.completed),
      payout,
      profit,
      multiplier,
      matched: Boolean(result.matched),
    });
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

  if (method === "POST" && path.endsWith("/games/yahtzee/start")) {
    const { bet } = parseJson(event);
    const wager = Number(bet) || 0;
    if (wager <= 0) {
      return jsonResponse(400, { error: "Place a bet to start." }, CORS_ORIGIN);
    }
    const { user, balance } = await resolveBalance(session);
    if (balance < wager) {
      return jsonResponse(400, { error: "Not enough credits." }, CORS_ORIGIN);
    }
    const nextBalance = await persistBalance(session, user, balance - wager);
    const state = createYahtzeeState({ bet: wager });
    await saveGameState(token, session, "yahtzee", state);
    return respondWithState(200, "yahtzee", { state, balance: nextBalance });
  }

  if (method === "POST" && path.endsWith("/games/yahtzee/roll")) {
    const { holds } = parseJson(event);
    const state = await getGameState(token, "yahtzee");
    const result = applyYahtzeeRoll(state, holds);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    await saveGameState(token, session, "yahtzee", state);
    return respondWithState(200, "yahtzee", { state });
  }

  if (method === "POST" && path.endsWith("/games/yahtzee/score")) {
    const { category } = parseJson(event);
    const state = await getGameState(token, "yahtzee");
    const { user, balance } = await resolveBalance(session);
    const result = applyYahtzeeScore(state, category);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    let nextBalance = balance;
    if (typeof result.payout === "number") {
      nextBalance = await persistBalance(session, user, balance + result.payout);
    }
    if (result?.net !== undefined && user) {
      user.stats = updateStats(user.stats, {
        game: "yahtzee",
        bet: state.bet,
        net: result.net,
        result: result.result,
      });
      await putUser(user);
      nextBalance = user.balance;
    }
    await saveGameState(token, session, "yahtzee", state);
    return respondWithState(200, "yahtzee", {
      state,
      balance: nextBalance,
      messages: result.messages || [],
      result: result.result,
      playerTotal: result.playerTotal,
      dealerTotal: result.dealerTotal,
      payout: result.payout,
    });
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
      balanceAfterBlind: nextBalance,
    });
    const message = `Blinds in. You: $${playerBlind}, Dealer: $${dealerBlind}.`;
    if (nextBalance <= 0) {
      const messages = [{ text: message, tone: "win", duration: 1600 }];
      const showdownResult = resolveHoldemShowdown(state, nextBalance, messages);
      const finalBalance = await persistBalance(session, user, showdownResult.balance);
      await saveGameState(token, session, "holdem", showdownResult.state);
      return respondWithState(200, "holdem", {
        state: showdownResult.state,
        balance: finalBalance,
        messages,
        showdown: showdownResult.showdown,
      });
    }
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
    const startPhase = nextBalance <= 0 ? "discard1" : "bet1";
    const state = createPokerState({
      blindSmall,
      blindBig,
      dealerButton,
      playerBlind,
      dealerBlind,
      phase: startPhase,
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
    if (result?.playerLabel) {
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
      await saveGameState(token, session, "poker", result.state);
      return respondWithState(200, "poker", {
        state: result.state,
        balance: nextBalance,
        result: result.result,
        playerLabel: result.playerLabel,
        dealerLabel: result.dealerLabel,
        playerIndexes: result.playerIndexes,
        dealerIndexes: result.dealerIndexes,
        messages: result.messages || [],
      });
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
    const { user, balance } = await resolveBalance(session);
    const result = applyPokerDraw(state, discards, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (result?.reveal) {
      if (user) {
        user.stats = updateStats(user.stats, {
          game: "poker",
          bet: state.playerPaid,
          net: result.reveal.net,
          result:
            result.reveal.net > 0 ? "win" : result.reveal.net < 0 ? "loss" : "push",
        });
        await putUser(user);
      }
      const nextBalance = await persistBalance(session, user, result.reveal.balance);
      await saveGameState(token, session, "poker", result.reveal.state);
      return respondWithState(200, "poker", {
        state: result.reveal.state,
        balance: nextBalance,
        dealerDiscarded: result.dealerDiscarded,
        result: result.reveal.result,
        playerLabel: result.reveal.playerLabel,
        dealerLabel: result.reveal.dealerLabel,
        playerIndexes: result.reveal.playerIndexes,
        dealerIndexes: result.reveal.dealerIndexes,
        messages: result.messages || [],
      });
    }
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", {
      state,
      dealerDiscarded: result.dealerDiscarded,
      messages: result.messages || [],
    });
  }

  if (method === "POST" && path.endsWith("/games/poker/call")) {
    const state = await getGameState(token, "poker");
    const { user, balance } = await resolveBalance(session);
    const result = applyPokerCall(state, balance);
    if (result?.error) {
      return jsonResponse(400, { error: result.error }, CORS_ORIGIN);
    }
    if (result?.playerLabel) {
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
      await saveGameState(token, session, "poker", result.state);
      return respondWithState(200, "poker", {
        state: result.state,
        balance: nextBalance,
        result: result.result,
        playerLabel: result.playerLabel,
        dealerLabel: result.dealerLabel,
        playerIndexes: result.playerIndexes,
        dealerIndexes: result.dealerIndexes,
      });
    }
    const nextBalance = await persistBalance(session, user, result.balance);
    await saveGameState(token, session, "poker", state);
    return respondWithState(200, "poker", {
      state,
      balance: nextBalance,
    });
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

  return jsonResponse(404, { error: "Not found." }, CORS_ORIGIN);
};
