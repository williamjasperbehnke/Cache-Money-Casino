const AWS = require("aws-sdk");
const { ddb } = require("./lib/db");
const { jsonResponse, parseJson } = require("./lib/utils");

const { CONNECTIONS_TABLE, ROOMS_TABLE, CORS_ORIGIN = "*" } = process.env;

const getConnection = async (connectionId) => {
  const resp = await ddb
    .get({
      TableName: CONNECTIONS_TABLE,
      Key: { connection_id: connectionId },
    })
    .promise();
  return resp.Item || null;
};

const sendToConnection = async (endpoint, connectionId, payload) => {
  const api = new AWS.ApiGatewayManagementApi({ endpoint });
  await api
    .postToConnection({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    })
    .promise();
};

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `${domain}/${stage}`;
  const body = parseJson(event);
  const action = body.action || "unknown";
  const connection = await getConnection(connectionId);

  if (!connection) return jsonResponse(400, { error: "Unknown connection." }, CORS_ORIGIN);

  if (action === "join") {
    const roomId = body.roomId || "lobby";
    await ddb
      .put({
        TableName: ROOMS_TABLE,
        Item: {
          room_id: roomId,
          player_id: connectionId,
          username: connection.username,
          joined_at: new Date().toISOString(),
        },
      })
      .promise();
    await ddb
      .update({
        TableName: CONNECTIONS_TABLE,
        Key: { connection_id: connectionId },
        UpdateExpression: "set room_id = :room",
        ExpressionAttributeValues: { ":room": roomId },
      })
      .promise();
    await sendToConnection(endpoint, connectionId, { type: "ROOM_JOINED", roomId });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "leave") {
    if (connection.room_id) {
      await ddb
        .delete({
          TableName: ROOMS_TABLE,
          Key: { room_id: connection.room_id, player_id: connectionId },
        })
        .promise();
    }
    await ddb
      .update({
        TableName: CONNECTIONS_TABLE,
        Key: { connection_id: connectionId },
        UpdateExpression: "set room_id = :room",
        ExpressionAttributeValues: { ":room": null },
      })
      .promise();
    await sendToConnection(endpoint, connectionId, { type: "ROOM_LEFT" });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "action") {
    await sendToConnection(endpoint, connectionId, {
      type: "ACTION_ACK",
      payload: body.payload || {},
    });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  await sendToConnection(endpoint, connectionId, { type: "UNKNOWN_ACTION", action });
  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
