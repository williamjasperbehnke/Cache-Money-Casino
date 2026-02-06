const { ddb } = require("./lib/db");
const { jsonResponse } = require("./lib/utils");

const { CONNECTIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  await ddb
    .delete({
      TableName: CONNECTIONS_TABLE,
      Key: { connection_id: connectionId },
    })
    .promise();
  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
