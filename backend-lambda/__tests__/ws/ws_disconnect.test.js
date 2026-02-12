process.env.LOCAL_DEV = "true";
process.env.CONNECTIONS_TABLE = "Connections";
process.env.ROOMS_TABLE = "Rooms";
process.env.GAME_SESSIONS_TABLE = "GameSessions";
process.env.CORS_ORIGIN = "*";

const { resetLocalTables, parseResponse } = require("../helpers/test-helpers");
const { handler } = require("../../ws_disconnect");
const { put, get } = require("../../lib/db");

describe("ws_disconnect", () => {
  beforeEach(async () => {
    resetLocalTables();
    await put({ TableName: "Connections", Item: { connection_id: "c1" } });
  });

  it("deletes connection", async () => {
    const resp = await handler({ requestContext: { connectionId: "c1" } });
    expect(parseResponse(resp).statusCode).toBe(200);
    const stored = await get({ TableName: "Connections", Key: { connection_id: "c1" } });
    expect(stored.Item).toBeUndefined();
  });

  it("keeps player in room state when another connection for same player exists", async () => {
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", player_id: "p1", room_id: "r1" },
    });
    await put({
      TableName: "Connections",
      Item: { connection_id: "c2", player_id: "p1", room_id: "r1" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "c1", username: "alice" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "c2", username: "alice" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "meta", host: "alice", player_count: 1 },
    });
    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "room:r1",
        game: "blackjack-multi",
        state: { roomId: "r1", hostId: "p1", players: [{ id: "p1", username: "alice" }] },
      },
    });

    const resp = await handler({ requestContext: { connectionId: "c1" } });
    expect(parseResponse(resp).statusCode).toBe(200);

    const stateResp = await get({ TableName: "GameSessions", Key: { session_id: "room:r1" } });
    expect(stateResp.Item?.state?.players?.length).toBe(1);
    expect(stateResp.Item?.state?.players?.[0]?.id).toBe("p1");
  });

  it("preserves solo room state on disconnect for reconnect", async () => {
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", player_id: "p1", room_id: "r1" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "c1", username: "alice" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "meta", host: "alice", player_count: 1 },
    });
    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "room:r1",
        game: "blackjack-multi",
        state: { roomId: "r1", hostId: "p1", players: [{ id: "p1", username: "alice" }] },
      },
    });

    const resp = await handler({ requestContext: { connectionId: "c1" } });
    expect(parseResponse(resp).statusCode).toBe(200);

    const stateResp = await get({ TableName: "GameSessions", Key: { session_id: "room:r1" } });
    expect(stateResp.Item?.state?.players?.length).toBe(1);
    expect(stateResp.Item?.state?.players?.[0]?.id).toBe("p1");
  });

  it("preserves player hand and bet when disconnecting during round", async () => {
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", player_id: "p1", room_id: "r1" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "c1", username: "alice" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "meta", host: "alice", player_count: 1 },
    });
    await put({
      TableName: "GameSessions",
      Item: {
        session_id: "room:r1",
        game: "blackjack-multi",
        state: {
          roomId: "r1",
          inRound: true,
          phase: "player",
          turnIndex: 0,
          players: [
            {
              id: "p1",
              username: "alice",
              status: "playing",
              betAmount: 25,
              hands: [[{ rank: "K", suit: "H" }, { rank: "9", suit: "D" }]],
              bets: [25],
              busted: [false],
              doubled: [false],
              activeHand: 0,
              splitUsed: false,
            },
          ],
          dealer: [{ rank: "9", suit: "S" }, { rank: "7", suit: "C" }],
          deck: [{ rank: "2", suit: "D" }, { rank: "3", suit: "C" }],
        },
      },
    });

    const resp = await handler({ requestContext: { connectionId: "c1" } });
    expect(parseResponse(resp).statusCode).toBe(200);

    const stateResp = await get({ TableName: "GameSessions", Key: { session_id: "room:r1" } });
    const player = stateResp.Item?.state?.players?.[0];
    expect(player?.id).toBe("p1");
    expect(player?.hands?.[0]?.length).toBe(2);
    expect(player?.bets?.[0]).toBe(25);
  });
});
