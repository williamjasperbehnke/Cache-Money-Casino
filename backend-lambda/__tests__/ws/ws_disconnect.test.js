process.env.LOCAL_DEV = "true";
process.env.CONNECTIONS_TABLE = "Connections";
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
});
