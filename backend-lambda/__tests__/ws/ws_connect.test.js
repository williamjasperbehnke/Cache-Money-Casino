process.env.LOCAL_DEV = "true";
process.env.CONNECTIONS_TABLE = "Connections";
process.env.SESSIONS_TABLE = "Sessions";
process.env.USERS_TABLE = "Users";
process.env.CORS_ORIGIN = "*";

const { resetLocalTables, parseResponse } = require("../helpers/test-helpers");
const { handler } = require("../../ws_connect");
const { putSession } = require("../../lib/session");
const { get } = require("../../lib/db");

describe("ws_connect", () => {
  beforeEach(async () => {
    resetLocalTables();
    await putSession({ token: "t1", username: "alice" });
  });

  it("stores connection", async () => {
    const resp = await handler({
      requestContext: { connectionId: "c1" },
      queryStringParameters: { token: "t1" },
    });
    expect(parseResponse(resp).statusCode).toBe(200);
    const stored = await get({ TableName: "Connections", Key: { connection_id: "c1" } });
    expect(stored.Item.username).toBe("alice");
  });

  it("stores guest when no session", async () => {
    const resp = await handler({
      requestContext: { connectionId: "c2" },
      queryStringParameters: { token: "missing" },
    });
    expect(parseResponse(resp).statusCode).toBe(200);
    const stored = await get({ TableName: "Connections", Key: { connection_id: "c2" } });
    expect(stored.Item.username).toBe("guest");
  });
});
