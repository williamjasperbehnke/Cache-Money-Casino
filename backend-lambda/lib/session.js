const { get, put } = require("./db");

const { USERS_TABLE, SESSIONS_TABLE } = process.env;

const getSession = async (token) => {
  if (!token) return null;
  const resp = await get({
    TableName: SESSIONS_TABLE,
    Key: { token },
  });
  return resp.Item || null;
};

const putSession = (session) =>
  put({
    TableName: SESSIONS_TABLE,
    Item: session,
  });

const getUser = async (username) => {
  if (!username) return null;
  const resp = await get({
    TableName: USERS_TABLE,
    Key: { username },
  });
  return resp.Item || null;
};

const putUser = (user) =>
  put({
    TableName: USERS_TABLE,
    Item: user,
  });

const resolveBalance = async (session) => {
  if (session.username) {
    const user = await getUser(session.username);
    return { user, balance: user?.balance ?? 0 };
  }
  return { user: null, balance: Number(session.balance) || 0 };
};

const persistBalance = async (session, user, balance) => {
  if (user) {
    user.balance = Math.max(0, Math.floor(balance));
    await putUser(user);
    return user.balance;
  }
  const next = Math.max(0, Math.floor(balance));
  await putSession({ ...session, balance: next });
  return next;
};

module.exports = {
  getSession,
  putSession,
  getUser,
  putUser,
  resolveBalance,
  persistBalance,
};
