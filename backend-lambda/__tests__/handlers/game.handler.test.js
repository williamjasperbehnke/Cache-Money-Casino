process.env.LOCAL_DEV = "true";
process.env.USERS_TABLE = "Users";
process.env.SESSIONS_TABLE = "Sessions";
process.env.GAME_SESSIONS_TABLE = "GameSessions";
process.env.ROOMS_TABLE = "Rooms";
process.env.CORS_ORIGIN = "*";

const crypto = require("crypto");
const { resetLocalTables, makeEvent, parseResponse } = require("../helpers/test-helpers");
const { handler } = require("../../game");
const { putSession, putUser, getUser } = require("../../lib/session");
const { put, get } = require("../../lib/db");
const { createHoldemState } = require("../../game/holdem");
const { createPokerState } = require("../../game/poker");

const authHeaders = { authorization: "Bearer t1" };

const seedSession = async (overrides = {}) => {
  await putSession({ token: "t1", username: null, balance: 1000, ...overrides });
};

describe("game handler", () => {
  beforeEach(async () => {
    resetLocalTables();
    await seedSession();
  });

  it("handles options", async () => {
    const resp = await handler(makeEvent({ method: "OPTIONS", path: "/games/slots/spin" }));
    expect(resp.statusCode).toBe(204);
  });

  it("requires auth", async () => {
    const resp = await handler(makeEvent({ method: "GET", path: "/games/slots/state" }));
    expect(parseResponse(resp).statusCode).toBe(401);
  });

  it("creates game session", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/slots/session",
        headers: authHeaders,
        pathParameters: { game: "slots" },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.sessionId).toBeTruthy();
  });

  it("returns game state", async () => {
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:roulette", state: { inRound: true, foo: 1 } },
    });
    const resp = await handler(
      makeEvent({ method: "GET", path: "/games/roulette/state", headers: authHeaders })
    );
    const parsed = parseResponse(resp);
    expect(parsed.body.active).toBe(true);
    expect(parsed.body.state.foo).toBe(1);
  });

  it("formats guest host name on blackjack-multi room creation", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/blackjack-multi/rooms",
        headers: authHeaders,
        body: { name: "Test Room", public: true },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    const roomId = parsed.body.roomId;
    const expectedSuffix = crypto
      .createHash("sha256")
      .update("t1")
      .digest("hex")
      .slice(0, 4);
    const meta = await get({ TableName: "Rooms", Key: { room_id: roomId, player_id: "meta" } });
    expect(meta.Item?.host).toBe(`Guest ${expectedSuffix}`);
  });

  it("formats legacy guest username value on blackjack-multi room creation", async () => {
    await putSession({ token: "t-guest", username: "guest", balance: 1000 });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/blackjack-multi/rooms",
        headers: { authorization: "Bearer t-guest" },
        body: { name: "Test Room", public: true },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    const roomId = parsed.body.roomId;
    const expectedSuffix = crypto
      .createHash("sha256")
      .update("t-guest")
      .digest("hex")
      .slice(0, 4);
    const meta = await get({ TableName: "Rooms", Key: { room_id: roomId, player_id: "meta" } });
    expect(meta.Item?.host).toBe(`Guest ${expectedSuffix}`);
  });

  it("roulette spin validates bets", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/roulette/spin",
        headers: authHeaders,
        body: { bets: {} },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("roulette spin succeeds", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/roulette/spin",
        headers: authHeaders,
        body: { bets: { numbers: { 0: 10 } } },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.balance).toBeGreaterThan(0);
  });

  it("craps roll validates", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/craps/roll",
        headers: authHeaders,
        body: { bets: {} },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("craps roll succeeds", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/craps/roll",
        headers: authHeaders,
        body: { bets: { pass: 5 } },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
  });

  it("memory start and flip", async () => {
    const start = await handler(
      makeEvent({
        method: "POST",
        path: "/games/memory/start",
        headers: authHeaders,
        body: { bet: 10 },
      })
    );
    expect(parseResponse(start).statusCode).toBe(200);

    const flip = await handler(
      makeEvent({
        method: "POST",
        path: "/games/memory/flip",
        headers: authHeaders,
        body: { index: 0 },
      })
    );
    expect(parseResponse(flip).statusCode).toBe(200);
  });

  it("slots spin succeeds", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/slots/spin",
        headers: authHeaders,
        body: { bet: 5 },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.symbols)).toBe(true);
  });

  it("yahtzee start/roll/score", async () => {
    const start = await handler(
      makeEvent({
        method: "POST",
        path: "/games/yahtzee/start",
        headers: authHeaders,
        body: { bet: 5 },
      })
    );
    expect(parseResponse(start).statusCode).toBe(200);

    const roll = await handler(
      makeEvent({
        method: "POST",
        path: "/games/yahtzee/roll",
        headers: authHeaders,
        body: { holds: [false, false, false, false, false] },
      })
    );
    expect(parseResponse(roll).statusCode).toBe(200);

    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "t1:yahtzee",
        state: {
          bet: 5,
          inRound: true,
          phase: "player",
          rollsLeft: 1,
          dice: [1, 1, 1, 1, 1],
          holds: [false, false, false, false, false],
          dealerDice: [],
          playerScores: {
            ones: null,
            twos: null,
            threes: null,
            fours: null,
            fives: null,
            sixes: null,
            threeOfAKind: null,
            fourOfAKind: null,
            fullHouse: null,
            smallStraight: null,
            largeStraight: null,
            yahtzee: null,
            chance: null,
          },
          dealerScores: {
            ones: null,
            twos: null,
            threes: null,
            fours: null,
            fives: null,
            sixes: null,
            threeOfAKind: null,
            fourOfAKind: null,
            fullHouse: null,
            smallStraight: null,
            largeStraight: null,
            yahtzee: null,
            chance: null,
          },
        },
      },
    });

    const score = await handler(
      makeEvent({
        method: "POST",
        path: "/games/yahtzee/score",
        headers: authHeaders,
        body: { category: "yahtzee" },
      })
    );
    expect(parseResponse(score).statusCode).toBe(200);
  });

  it("blackjack deal/hit/stand/double/split", async () => {
    const deal = await handler(
      makeEvent({
        method: "POST",
        path: "/games/blackjack/deal",
        headers: authHeaders,
        body: { bet: 10 },
      })
    );
    expect(parseResponse(deal).statusCode).toBe(200);

    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "t1:blackjack",
        state: {
          deck: [
            { rank: "2", suit: "S" },
            { rank: "3", suit: "D" },
            { rank: "4", suit: "C" },
            { rank: "5", suit: "H" },
          ],
          hands: [[{ rank: "9", suit: "H" }, { rank: "7", suit: "D" }]],
          dealer: [{ rank: "5", suit: "C" }, { rank: "6", suit: "S" }],
          bets: [10],
          doubled: [false],
          busted: [false],
          activeHand: 0,
          splitUsed: false,
          inRound: true,
          revealDealer: false,
        },
      },
    });
    const hit = await handler(
      makeEvent({ method: "POST", path: "/games/blackjack/hit", headers: authHeaders })
    );
    expect(parseResponse(hit).statusCode).toBe(200);

    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "t1:blackjack",
        state: {
          deck: [
            { rank: "2", suit: "S" },
            { rank: "3", suit: "D" },
            { rank: "4", suit: "C" },
            { rank: "5", suit: "H" },
          ],
          hands: [[{ rank: "10", suit: "H" }, { rank: "7", suit: "D" }]],
          dealer: [{ rank: "5", suit: "C" }, { rank: "6", suit: "S" }],
          bets: [10],
          doubled: [false],
          busted: [false],
          activeHand: 0,
          splitUsed: false,
          inRound: true,
          revealDealer: false,
        },
      },
    });
    const stand = await handler(
      makeEvent({ method: "POST", path: "/games/blackjack/stand", headers: authHeaders })
    );
    expect(parseResponse(stand).statusCode).toBe(200);

    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "t1:blackjack",
        state: {
          deck: [
            { rank: "2", suit: "S" },
            { rank: "3", suit: "D" },
            { rank: "4", suit: "C" },
            { rank: "5", suit: "H" },
          ],
          hands: [[{ rank: "5", suit: "H" }, { rank: "6", suit: "D" }]],
          dealer: [{ rank: "5", suit: "C" }, { rank: "6", suit: "S" }],
          bets: [10],
          doubled: [false],
          busted: [false],
          activeHand: 0,
          splitUsed: false,
          inRound: true,
          revealDealer: false,
        },
      },
    });
    const double = await handler(
      makeEvent({ method: "POST", path: "/games/blackjack/double", headers: authHeaders })
    );
    expect(parseResponse(double).statusCode).toBe(200);

    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "t1:blackjack",
        state: {
          deck: [
            { rank: "2", suit: "S" },
            { rank: "3", suit: "D" },
            { rank: "4", suit: "C" },
            { rank: "5", suit: "H" },
          ],
          hands: [[{ rank: "8", suit: "H" }, { rank: "9", suit: "D" }]],
          dealer: [{ rank: "5", suit: "C" }, { rank: "6", suit: "S" }],
          bets: [10],
          doubled: [false],
          busted: [false],
          activeHand: 0,
          splitUsed: false,
          inRound: true,
          revealDealer: false,
        },
      },
    });
    const split = await handler(
      makeEvent({ method: "POST", path: "/games/blackjack/split", headers: authHeaders })
    );
    expect(parseResponse(split).statusCode).toBe(400);
  });

  it("holdem deal/action/fold", async () => {
    const deal = await handler(
      makeEvent({
        method: "POST",
        path: "/games/holdem/deal",
        headers: authHeaders,
        body: { state: { blindSmall: 5, blindBig: 10, dealerButton: false } },
      })
    );
    expect(parseResponse(deal).statusCode).toBe(200);

    const holdemState = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:holdem", state: holdemState },
    });
    const action = await handler(
      makeEvent({
        method: "POST",
        path: "/games/holdem/action",
        headers: authHeaders,
        body: { betAmount: 0 },
      })
    );
    expect(parseResponse(action).statusCode).toBe(200);

    const holdemFoldState = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:holdem", state: holdemFoldState },
    });
    const fold = await handler(
      makeEvent({ method: "POST", path: "/games/holdem/fold", headers: authHeaders })
    );
    expect(parseResponse(fold).statusCode).toBe(200);
  });

  it("poker deal/bet/draw/call/fold", async () => {
    const deal = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/deal",
        headers: authHeaders,
        body: { state: { blindSmall: 5, blindBig: 10, dealerButton: false } },
      })
    );
    expect(parseResponse(deal).statusCode).toBe(200);

    const pokerState = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:poker", state: pokerState },
    });
    const bet = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/bet",
        headers: authHeaders,
        body: { betAmount: 0 },
      })
    );
    expect(parseResponse(bet).statusCode).toBe(200);

    pokerState.phase = "discard1";
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:poker", state: pokerState },
    });
    const draw = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/draw",
        headers: authHeaders,
        body: { discards: [0] },
      })
    );
    expect(parseResponse(draw).statusCode).toBe(200);

    const pokerCallState = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet2",
    });
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:poker", state: pokerCallState },
    });
    const call = await handler(
      makeEvent({ method: "POST", path: "/games/poker/call", headers: authHeaders })
    );
    expect(parseResponse(call).statusCode).toBe(200);

    const pokerFoldState = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:poker", state: pokerFoldState },
    });
    const fold = await handler(
      makeEvent({ method: "POST", path: "/games/poker/fold", headers: authHeaders })
    );
    expect(parseResponse(fold).statusCode).toBe(200);
  });

  it("holdem deal rejects zero balance", async () => {
    await seedSession({ token: "t2", balance: 0 });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/holdem/deal",
        headers: { authorization: "Bearer t2" },
        body: { state: { blindSmall: 5, blindBig: 10, dealerButton: false } },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("holdem action updates user stats on showdown", async () => {
    await putUser({
      username: "alice",
      balance: 0,
      stats: { totals: { bets: 0, wins: 0, losses: 0, net: 0 }, games: {}, recent: [] },
    });
    await seedSession({ username: "alice", balance: 0 });
    const state = createHoldemState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      balanceAfterBlind: 100,
    });
    state.phase = "preflop";
    state.playerBet = state.currentBet;
    state.dealerBet = state.currentBet;
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:holdem", state },
    });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/holdem/action",
        headers: authHeaders,
        body: { betAmount: 0 },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
    const user = await getUser("alice");
    expect(user.stats.totals.bets).toBeGreaterThan(0);
  });

  it("holdem fold returns error when no active state", async () => {
    const resp = await handler(
      makeEvent({ method: "POST", path: "/games/holdem/fold", headers: authHeaders })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("poker deal rejects zero balance", async () => {
    await seedSession({ token: "t3", balance: 0 });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/deal",
        headers: { authorization: "Bearer t3" },
        body: { state: { blindSmall: 5, blindBig: 10, dealerButton: false } },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("poker bet reveal updates user stats", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    await putUser({
      username: "kate",
      balance: 200,
      stats: { totals: { bets: 0, wins: 0, losses: 0, net: 0 }, games: {}, recent: [] },
    });
    await seedSession({ username: "kate", balance: 200 });
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet3",
    });
    state.player = [
      { rank: "10", suit: "S" },
      { rank: "J", suit: "S" },
      { rank: "Q", suit: "S" },
      { rank: "K", suit: "S" },
      { rank: "A", suit: "S" },
    ];
    state.dealer = [
      { rank: "2", suit: "H" },
      { rank: "5", suit: "D" },
      { rank: "7", suit: "S" },
      { rank: "9", suit: "C" },
      { rank: "J", suit: "H" },
    ];
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:poker", state },
    });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/bet",
        headers: authHeaders,
        body: { betAmount: 0 },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
    const user = await getUser("kate");
    expect(user.stats.totals.bets).toBeGreaterThan(0);
    randomSpy.mockRestore();
  });

  it("poker draw reveal updates user stats", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    await putUser({
      username: "mike",
      balance: 0,
      stats: { totals: { bets: 0, wins: 0, losses: 0, net: 0 }, games: {}, recent: [] },
    });
    await seedSession({ username: "mike", balance: 0 });
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "discard2",
    });
    await put({
      TableName: "GameSessions",
      Item: { session_id: "t1:poker", state },
    });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/draw",
        headers: authHeaders,
        body: { discards: [0, 1] },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
    const user = await getUser("mike");
    expect(user.stats.totals.bets).toBeGreaterThan(0);
    randomSpy.mockRestore();
  });

  it("poker bet rejects when short on credits", async () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    state.currentBet = 50;
    state.playerBet = 0;
    await seedSession({ balance: 5 });
    await put({ TableName: "GameSessions", Item: { session_id: "t1:poker", state } });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/bet",
        headers: authHeaders,
        body: { betAmount: 10 },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("poker draw rejects when not in discard phase", async () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet1",
    });
    await put({ TableName: "GameSessions", Item: { session_id: "t1:poker", state } });
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/games/poker/draw",
        headers: authHeaders,
        body: { discards: [0] },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("poker call rejects when short on credits", async () => {
    const state = createPokerState({
      blindSmall: 5,
      blindBig: 10,
      dealerButton: false,
      playerBlind: 10,
      dealerBlind: 5,
      phase: "bet2",
    });
    state.currentBet = 50;
    state.playerBet = 0;
    await seedSession({ balance: 5 });
    await put({ TableName: "GameSessions", Item: { session_id: "t1:poker", state } });
    const resp = await handler(
      makeEvent({ method: "POST", path: "/games/poker/call", headers: authHeaders })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("poker fold rejects when no active state", async () => {
    const resp = await handler(
      makeEvent({ method: "POST", path: "/games/poker/fold", headers: authHeaders })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });
});
