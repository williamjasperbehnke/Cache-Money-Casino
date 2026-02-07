const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const { get, put, update, del } = require("./lib/db");
const { jsonResponse, parseJson } = require("./lib/utils");

const { CONNECTIONS_TABLE, ROOMS_TABLE, CORS_ORIGIN = "*" } = process.env;

const getConnection = async (connectionId) => {
  const resp = await get({
    TableName: CONNECTIONS_TABLE,
    Key: { connection_id: connectionId },
  });
  return resp.Item || null;
};

const sendToConnection = async (endpoint, connectionId, payload) => {
  const api = new ApiGatewayManagementApiClient({ endpoint: `https://${endpoint}` });
  await api.send(
    new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(payload),
    })
  );
};

const sendOrLog = async (endpoint, connectionId, payload) => {
  if (process.env.LOCAL_DEV === "true") return;
  await sendToConnection(endpoint, connectionId, payload);
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
    await put({
      TableName: ROOMS_TABLE,
      Item: {
        room_id: roomId,
        player_id: connectionId,
        username: connection.username,
        joined_at: new Date().toISOString(),
      },
    });
    await update({
      TableName: CONNECTIONS_TABLE,
      Key: { connection_id: connectionId },
      UpdateExpression: "set room_id = :room",
      ExpressionAttributeValues: { ":room": roomId },
    });
    await sendOrLog(endpoint, connectionId, { type: "ROOM_JOINED", roomId });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "leave") {
    if (connection.room_id) {
      await del({
        TableName: ROOMS_TABLE,
        Key: { room_id: connection.room_id, player_id: connectionId },
      });
    }
    await update({
      TableName: CONNECTIONS_TABLE,
      Key: { connection_id: connectionId },
      UpdateExpression: "set room_id = :room",
      ExpressionAttributeValues: { ":room": null },
    });
    await sendOrLog(endpoint, connectionId, { type: "ROOM_LEFT" });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  if (action === "action") {
    await sendOrLog(endpoint, connectionId, {
      type: "ACTION_ACK",
      payload: body.payload || {},
    });
    return jsonResponse(200, { ok: true }, CORS_ORIGIN);
  }

  await sendOrLog(endpoint, connectionId, { type: "UNKNOWN_ACTION", action });
  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
