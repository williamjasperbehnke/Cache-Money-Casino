process.env.LOCAL_DEV = "true";
process.env.USERS_TABLE = "Users";
process.env.SESSIONS_TABLE = "Sessions";
process.env.CORS_ORIGIN = "*";

const { resetLocalTables, makeEvent, parseResponse } = require("../helpers/test-helpers");
const { handler } = require("../../auth");
const { getUser, getSession } = require("../../lib/session");

describe("auth handler", () => {
  beforeEach(() => {
    resetLocalTables();
  });

  it("handles options", async () => {
    const resp = await handler(makeEvent({ method: "OPTIONS", path: "/auth/login" }));
    expect(resp.statusCode).toBe(204);
  });

  it("rejects missing fields", async () => {
    const resp = await handler(
      makeEvent({ method: "POST", path: "/auth/register", body: { username: "a" } })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("rejects weak password", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/auth/register",
        body: { username: "alice", password: "weak" },
      })
    );
    expect(parseResponse(resp).body.error).toMatch(/Password/);
  });

  it("registers user and returns token", async () => {
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/auth/register",
        body: { username: "alice", password: "Strong1!" },
      })
    );
    const parsed = parseResponse(resp);
    expect(parsed.statusCode).toBe(200);
    const user = await getUser("alice");
    expect(user).toBeTruthy();
    const session = await getSession(parsed.body.token);
    expect(session).toBeTruthy();
  });

  it("login validates credentials", async () => {
    await handler(
      makeEvent({
        method: "POST",
        path: "/auth/register",
        body: { username: "bob", password: "Strong1!" },
      })
    );
    const badResp = await handler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { username: "bob", password: "Wrong1!" },
      })
    );
    expect(parseResponse(badResp).statusCode).toBe(401);

    const okResp = await handler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { username: "bob", password: "Strong1!" },
      })
    );
    expect(parseResponse(okResp).statusCode).toBe(200);
  });

  it("rejects duplicate registration", async () => {
    await handler(
      makeEvent({
        method: "POST",
        path: "/auth/register",
        body: { username: "dup", password: "Strong1!" },
      })
    );
    const resp = await handler(
      makeEvent({
        method: "POST",
        path: "/auth/register",
        body: { username: "dup", password: "Strong1!" },
      })
    );
    expect(parseResponse(resp).statusCode).toBe(409);
  });

  it("rejects login with missing fields", async () => {
    const resp = await handler(
      makeEvent({ method: "POST", path: "/auth/login", body: { username: "x" } })
    );
    expect(parseResponse(resp).statusCode).toBe(400);
  });

  it("creates guest session", async () => {
    const resp = await handler(
      makeEvent({ method: "POST", path: "/auth/guest", body: {} })
    );
    const parsed = parseResponse(resp);
    expect(parsed.body.user.username).toBe("guest");
  });

  it("returns 404 on unknown route", async () => {
    const resp = await handler(makeEvent({ method: "GET", path: "/auth/unknown" }));
    expect(parseResponse(resp).statusCode).toBe(404);
  });
});
