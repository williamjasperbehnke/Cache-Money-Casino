process.env.LOCAL_DEV = "true";
process.env.LOCAL_DEV = "true";
process.env.USERS_TABLE = "Users";
process.env.SESSIONS_TABLE = "Sessions";
process.env.CORS_ORIGIN = "*";

const { resetLocalTables, makeEvent, parseResponse } = require("../helpers/test-helpers");
const { handler } = require("../../account");
const { putUser, putSession } = require("../../lib/session");

describe("account handler", () => {
  beforeEach(async () => {
    resetLocalTables();
    await putUser({ username: "alice", balance: 100, stats: { totals: { bets: 0, wins: 0, losses: 0, net: 0 }, games: {}, recent: [] } });
    await putSession({ token: "t1", username: "alice" });
  });

  it("requires auth", async () => {
    const resp = await handler(makeEvent({ method: "GET", path: "/me" }));
    expect(parseResponse(resp).statusCode).toBe(401);
  });

  it("returns me profile", async () => {
    const resp = await handler(
      makeEvent({
        method: "GET",
        path: "/me",
        headers: { authorization: "Bearer t1" },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.user.username).toBe("alice");
  });

  it("updates balance", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/balance",
        headers: { authorization: "Bearer t1" },
        body: { balance: 250 },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
  });

  it("rejects invalid balance payload", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/balance",
        headers: { authorization: "Bearer t1" },
        body: { balance: "nope" },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("records stats", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/stats/record",
        headers: { authorization: "Bearer t1" },
        body: { game: "slots", bet: 5, net: 3 },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(200);
  });

  it("rejects invalid stats payload", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/stats/record",
        headers: { authorization: "Bearer t1" },
        body: { game: "", bet: "x", net: "y" },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("returns 404 for unknown", async () => {
    const resp = await handler(
      makeEvent({
        method: "GET",
        path: "/unknown",
        headers: { authorization: "Bearer t1" },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(404);
  });
});
