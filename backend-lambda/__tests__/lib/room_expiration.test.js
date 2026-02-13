const { getRoomIdleTimeoutMs, getRoomLastActivityMs, isRoomExpired } = require("../../lib/room_expiration");

describe("room_expiration", () => {
  const originalTimeout = process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS;
  const originalLegacy = process.env.BLACKJACK_MULTI_ROOM_IDLE_SECONDS;

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS;
    else process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS = originalTimeout;
    if (originalLegacy === undefined) delete process.env.BLACKJACK_MULTI_ROOM_IDLE_SECONDS;
    else process.env.BLACKJACK_MULTI_ROOM_IDLE_SECONDS = originalLegacy;
  });

  it("uses default timeout when env is not set", () => {
    delete process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS;
    delete process.env.BLACKJACK_MULTI_ROOM_IDLE_SECONDS;
    expect(getRoomIdleTimeoutMs()).toBe(60 * 60 * 1000);
  });

  it("uses configured timeout in seconds", () => {
    process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS = "90";
    expect(getRoomIdleTimeoutMs()).toBe(90 * 1000);
  });

  it("treats non-positive timeout as disabled", () => {
    process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS = "0";
    expect(getRoomIdleTimeoutMs()).toBe(0);
  });

  it("chooses last_activity_at before other timestamps", () => {
    const activity = "2025-01-02T00:00:00.000Z";
    const updated = "2024-12-31T00:00:00.000Z";
    expect(
      getRoomLastActivityMs({
        meta: { last_activity_at: activity, updated_at: updated },
        state: { updatedAt: updated },
      })
    ).toBe(Date.parse(activity));
  });

  it("marks room expired when timeout exceeded", () => {
    process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS = "60";
    const now = Date.parse("2026-01-01T00:02:00.000Z");
    const state = { updatedAt: "2026-01-01T00:00:00.000Z" };
    expect(isRoomExpired({ state, nowMs: now })).toBe(true);
  });

  it("does not expire room without activity timestamp", () => {
    process.env.MULTI_ROOM_IDLE_TIMEOUT_SECONDS = "60";
    expect(isRoomExpired({ meta: {}, state: {}, nowMs: Date.now() })).toBe(false);
  });
});
