const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const isLocal = process.env.LOCAL_DEV === "true";

const makeKey = (key) => JSON.stringify(key || {});

const localTables = globalThis.__casinoLocalTables || new Map();
globalThis.__casinoLocalTables = localTables;

const getLocalTable = (name) => {
  if (!localTables.has(name)) localTables.set(name, new Map());
  return localTables.get(name);
};

const localGet = async ({ TableName, Key }) => {
  const table = getLocalTable(TableName);
  let item = table.get(makeKey(Key));
  if (!item && Key && Object.keys(Key).length === 1 && Key.room_id) {
    const items = Array.from(table.values());
    item = items.find((entry) => entry.room_id === Key.room_id);
  }
  return { Item: item || undefined };
};

const localPut = async ({ TableName, Item }) => {
  const table = getLocalTable(TableName);
  const keyObj = {};
  if (Item && Item.room_id && Item.player_id) {
    keyObj.room_id = Item.room_id;
    keyObj.player_id = Item.player_id;
  } else if (Item && Item.connection_id) {
    keyObj.connection_id = Item.connection_id;
  } else if (Item && Item.token) {
    keyObj.token = Item.token;
  } else if (Item && Item.session_id) {
    keyObj.session_id = Item.session_id;
  } else if (Item && Item.username) {
    keyObj.username = Item.username;
  } else if (Item && Item.room_id) {
    keyObj.room_id = Item.room_id;
  } else if (Item && Item.player_id) {
    keyObj.player_id = Item.player_id;
  }
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

const localQuery = async ({ TableName, KeyConditionExpression, ExpressionAttributeValues }) => {
  const table = getLocalTable(TableName);
  const items = Array.from(table.values());
  if (!KeyConditionExpression) return { Items: items };
  const roomMatch = /room_id\s*=\s*(:[a-zA-Z0-9_]+)/i.exec(KeyConditionExpression);
  if (roomMatch) {
    const valueKey = roomMatch[1];
    const roomId = ExpressionAttributeValues?.[valueKey];
    return { Items: items.filter((item) => item.room_id === roomId) };
  }
  return { Items: items };
};

const localScan = async ({ TableName }) => {
  const table = getLocalTable(TableName);
  return { Items: Array.from(table.values()) };
};

const ddb = isLocal ? null : DynamoDBDocumentClient.from(new DynamoDBClient({}));

const get = (params) => (isLocal ? localGet(params) : ddb.send(new GetCommand(params)));
const put = (params) => (isLocal ? localPut(params) : ddb.send(new PutCommand(params)));
const del = (params) => (isLocal ? localDelete(params) : ddb.send(new DeleteCommand(params)));
const update = (params) =>
  isLocal ? localUpdate(params) : ddb.send(new UpdateCommand(params));
const query = (params) => (isLocal ? localQuery(params) : ddb.send(new QueryCommand(params)));
const scan = (params) => (isLocal ? localScan(params) : ddb.send(new ScanCommand(params)));

module.exports = {
  ddb,
  get,
  put,
  del,
  update,
  query,
  scan,
};
