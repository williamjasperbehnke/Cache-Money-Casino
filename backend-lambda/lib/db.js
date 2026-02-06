const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const isLocal = process.env.LOCAL_DEV === "true";

const makeKey = (key) => JSON.stringify(key || {});

const localTables = new Map();

const getLocalTable = (name) => {
  if (!localTables.has(name)) localTables.set(name, new Map());
  return localTables.get(name);
};

const localGet = async ({ TableName, Key }) => {
  const table = getLocalTable(TableName);
  const item = table.get(makeKey(Key));
  return { Item: item || undefined };
};

const localPut = async ({ TableName, Item }) => {
  const table = getLocalTable(TableName);
  const keyFields = Object.keys(Item || {}).filter((key) =>
    ["username", "token", "connection_id", "room_id", "player_id", "session_id"].includes(key)
  );
  const keyObj = {};
  keyFields.forEach((key) => {
    keyObj[key] = Item[key];
  });
  table.set(makeKey(keyObj), Item);
  return {};
};

const localDelete = async ({ TableName, Key }) => {
  const table = getLocalTable(TableName);
  table.delete(makeKey(Key));
  return {};
};

const localUpdate = async ({ TableName, Key, UpdateExpression, ExpressionAttributeValues }) => {
  const table = getLocalTable(TableName);
  const item = table.get(makeKey(Key)) || { ...Key };
  const match = /set\s+([a-zA-Z0-9_]+)\s*=\s*(:[a-zA-Z0-9_]+)/i.exec(
    UpdateExpression || ""
  );
  if (match) {
    const field = match[1];
    const valueKey = match[2];
    item[field] = ExpressionAttributeValues[valueKey];
  }
  table.set(makeKey(Key), item);
  return { Attributes: item };
};

const ddb = isLocal ? null : DynamoDBDocumentClient.from(new DynamoDBClient({}));

const get = (params) => (isLocal ? localGet(params) : ddb.send(new GetCommand(params)));
const put = (params) => (isLocal ? localPut(params) : ddb.send(new PutCommand(params)));
const del = (params) => (isLocal ? localDelete(params) : ddb.send(new DeleteCommand(params)));
const update = (params) =>
  isLocal ? localUpdate(params) : ddb.send(new UpdateCommand(params));

module.exports = {
  ddb,
  get,
  put,
  del,
  update,
};
