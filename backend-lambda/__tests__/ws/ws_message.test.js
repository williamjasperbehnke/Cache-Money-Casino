process.env.LOCAL_DEV = "true";
process.env.CONNECTIONS_TABLE = "Connections";
process.env.ROOMS_TABLE = "Rooms";
process.env.GAME_SESSIONS_TABLE = "GameSessions";
process.env.CORS_ORIGIN = "*";

const { resetLocalTables, makeWsEvent, parseResponse } = require("../helpers/test-helpers");
const { put, get } = require("../../lib/db");

let handler;
let sendMock;

describe("ws_message", () => {
  beforeEach(async () => {
    resetLocalTables();
    vi.resetModules();
    const { ApiGatewayManagementApiClient } = require("@aws-sdk/client-apigatewaymanagementapi");
    sendMock = vi
      .spyOn(ApiGatewayManagementApiClient.prototype, "send")
      .mockResolvedValue({});
    ({ handler } = require("../../ws_message"));
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", username: "alice", room_id: null },
    });
  });

  it("rejects unknown connection", async () => {
    const resp = await handler(
      makeWsEvent({ connectionId: "missing", body: { action: "join" } })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("joins room", async () => {
    const resp = await handler(makeWsEvent({ connectionId: "c1", body: { action: "join" } }));
    expect(parseResponse(resp).statusCode).toBe(200);
    const room = await get({ TableName: "Rooms", Key: { room_id: "lobby" } });
    expect(room.Item).toBeTruthy();
  });

  it("leaves room", async () => {
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", username: "alice", room_id: "lobby" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "lobby", player_id: "c1", username: "alice" },
    });
    const resp = await handler(makeWsEvent({ connectionId: "c1", body: { action: "leave" } }));
    expect(parseResponse(resp).statusCode).toBe(200);
  });

  it("does not remove rejoined player on stale leave cleanup", async () => {
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", username: "alice", player_id: "p1", room_id: "r1" },
    });
    await put({
      TableName: "Connections",
      Item: { connection_id: "c2", username: "alice", player_id: "p1", room_id: null },
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
        game: "blackjack",
        state: { roomId: "r1", hostId: "p1", players: [{ id: "p1", username: "alice" }] },
      },
    });

    const resp = await handler(makeWsEvent({ connectionId: "c1", body: { action: "leave" } }));
    expect(parseResponse(resp).statusCode).toBe(200);

    const stateResp = await get({ TableName: "GameSessions", Key: { session_id: "room:r1" } });
    expect(stateResp.Item?.state?.players?.length).toBe(1);
    expect(stateResp.Item?.state?.players?.[0]?.id).toBe("p1");
  });

  it("does not remove player if rejoin to same room happens during leave cleanup window", async () => {
    await put({
      TableName: "Connections",
      Item: { connection_id: "c1", username: "alice", player_id: "p1", room_id: "r1" },
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
        game: "blackjack",
        state: { roomId: "r1", hostId: "p1", players: [{ id: "p1", username: "alice" }] },
      },
    });

    const pendingLeave = handler(makeWsEvent({ connectionId: "c1", body: { action: "leave" } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await put({
      TableName: "Connections",
      Item: { connection_id: "c2", username: "alice", player_id: "p1", room_id: "r1" },
    });
    await put({
      TableName: "Rooms",
      Item: { room_id: "r1", player_id: "c2", username: "alice" },
    });

    const resp = await pendingLeave;
    expect(parseResponse(resp).statusCode).toBe(200);

    const stateResp = await get({ TableName: "GameSessions", Key: { session_id: "room:r1" } });
    expect(stateResp.Item?.state?.players?.length).toBe(1);
    expect(stateResp.Item?.state?.players?.[0]?.id).toBe("p1");
  });

  it("acks action", async () => {
    const resp = await handler(
      makeWsEvent({ connectionId: "c1", body: { action: "action", payload: { x: 1 } } })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
  });

  it("handles unknown action", async () => {
    const resp = await handler(
      makeWsEvent({ connectionId: "c1", body: { action: "weird" } })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
  });

  it("sends messages when not local", async () => {
    process.env.LOCAL_DEV = "false";
    const resp = await handler(
      makeWsEvent({ connectionId: "c1", body: { action: "action", payload: { ok: true } } })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
    expect(sendMock).toHaveBeenCalled();
    process.env.LOCAL_DEV = "true";
  });
});
