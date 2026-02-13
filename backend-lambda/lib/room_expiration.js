const DEFAULT_ROOM_IDLE_TIMEOUT_SECONDS = 60 * 60;

const getRoomIdleTimeoutMs = () => {
  const raw = Number(
    process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS ||
      DEFAULT_ROOM_IDLE_TIMEOUT_SECONDS
  );
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw * 1000);
};

const parseTimestamp = (value) => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const getRoomLastActivityMs = ({ meta, state } = {}) =>
  parseTimestamp(meta?.last_activity_at) ||
  parseTimestamp(meta?.updated_at) ||
  parseTimestamp(state?.updatedAt) ||
  parseTimestamp(state?.updated_at) ||
  parseTimestamp(meta?.created_at);

const isRoomExpired = ({ meta, state, nowMs = Date.now() } = {}) => {
  const timeoutMs = getRoomIdleTimeoutMs();
  if (!timeoutMs) return false;
  const lastActivityMs = getRoomLastActivityMs({ meta, state });
  if (!lastActivityMs) return false;
  return nowMs - lastActivityMs > timeoutMs;
};

module.exports = {
  getRoomIdleTimeoutMs,
  getRoomLastActivityMs,
  isRoomExpired,
};
