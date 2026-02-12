const { jsonResponse } = require("./lib/utils");
const {
  getConnection,
  removeRoomMember,
  cleanupRoomForConnection,
  deleteConnection,
} = require("./lib/ws_rooms");

const { CORS_ORIGIN = "*" } = process.env;

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;
  const domain = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `${domain}/${stage}`;

  const connection = await getConnection(connectionId);
  if (connection?.room_id) {
    await removeRoomMember({ roomId: connection.room_id, connectionId });
    await cleanupRoomForConnection({
      roomId: connection.room_id,
      playerId: connection.player_id,
      connectionId,
      endpoint,
    });
  }
  await deleteConnection(connectionId);

  return jsonResponse(200, { ok: true }, CORS_ORIGIN);
};
