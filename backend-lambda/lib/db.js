const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const get = (params) => ddb.send(new GetCommand(params));
const put = (params) => ddb.send(new PutCommand(params));
const del = (params) => ddb.send(new DeleteCommand(params));
const update = (params) => ddb.send(new UpdateCommand(params));

module.exports = {
  ddb,
  get,
  put,
  del,
  update,
};
