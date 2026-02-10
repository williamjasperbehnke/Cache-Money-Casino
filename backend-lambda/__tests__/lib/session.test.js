process.env.LOCAL_DEV = "true";
process.env.USERS_TABLE = "Users";
process.env.SESSIONS_TABLE = "Sessions";

const { resetLocalTables } = require("../helpers/test-helpers");
const {
  getSession,
  putSession,
  getUser,
  putUser,
  resolveBalance,
  persistBalance,
} = require("../../lib/session");

describe("session", () => {
  beforeEach(() => {
    resetLocalTables();
  });

  it("put/get session", async () => {
    await putSession({ token: "abc", username: "alice" });
    const session = await getSession("abc");
    expect(session.username).toBe("alice");
  });

  it("put/get user", async () => {
    await putUser({ username: "bob", balance: 123 });
    const user = await getUser("bob");
    expect(user.balance).toBe(123);
  });

  it("resolveBalance for user or guest", async () => {
    await putUser({ username: "carol", balance: 50 });
    const userSession = { username: "carol" };
    const userRes = await resolveBalance(userSession);
    expect(userRes.balance).toBe(50);

    const guestRes = await resolveBalance({ username: null, balance: 90 });
    expect(guestRes.balance).toBe(90);
  });

  it("persistBalance updates user or session", async () => {
    await putUser({ username: "dave", balance: 10 });
    const user = await getUser("dave");
    const newBal = await persistBalance({ username: "dave" }, user, 25.8);
    expect(newBal).toBe(25);
    const refreshed = await getUser("dave");
    expect(refreshed.balance).toBe(25);

    await putSession({ token: "g1", username: null, balance: 100 });
    const guestBal = await persistBalance({ token: "g1", username: null }, null, -5);
    expect(guestBal).toBe(0);
    const guestSession = await getSession("g1");
    expect(guestSession.balance).toBe(0);
  });
});
