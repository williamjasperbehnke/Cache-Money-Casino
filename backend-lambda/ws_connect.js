const { ddb } = require("./lib/db");
const { jsonResponse } = require("./lib/utils");

const { CONNECTIONS_TABLE, SESSIONS_TABLE, CORS_ORIGIN = "*" } = process.env;

const getSession = async (token) => {
  if (!token) return null;
  const resp = await ddb
    .get({
      TableName: SESSIONS_TABLE,
      Key: { token },
    })
    .promise();
  return resp.Item || null;
};

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token || "";
  const session = await getSession(token);

  await ddb
    .put({
      TableName: CONNECTIONS_TABLE,
      Item: {
        connection_id: connectionId,
        username: session ? session.username : "guest",
        room_id: null,
        connected_at: new Date().toISOString(),
      },
    })
    .promise();

  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
