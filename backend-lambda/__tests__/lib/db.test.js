process.env.LOCAL_DEV = "true";

const { resetLocalTables } = require("../helpers/test-helpers");
const { get, put, del, update } = require("../../lib/db");

describe("db local", () => {
  beforeEach(() => {
    resetLocalTables();
  });

  it("put/get stores by token key", async () => {
    await put({ TableName: "Sessions", Item: { token: "t1", value: 1 } });
    const resp = await get({ TableName: "Sessions", Key: { token: "t1" } });
    expect(resp.Item).toEqual({ token: "t1", value: 1 });
  });

  it("update sets attribute", async () => {
    await put({ TableName: "Connections", Item: { connection_id: "c1", room_id: null } });
    const resp = await update({
      TableName: "Connections",
      Key: { connection_id: "c1" },
      UpdateExpression: "set room_id = :room",
      ExpressionAttributeValues: { ":room": "lobby" },
    });
    expect(resp.Attributes.room_id).toBe("lobby");
  });

  it("del removes items", async () => {
    await put({ TableName: "Users", Item: { username: "neo", balance: 100 } });
    await del({ TableName: "Users", Key: { username: "neo" } });
    const resp = await get({ TableName: "Users", Key: { username: "neo" } });
    expect(resp.Item).toBeUndefined();
  });
});
