const normalizeNumberMap = (map = {}, keys) => {
  const out = {};
  keys.forEach((key) => {
    const value = Number(map?.[key]) || 0;
    out[key] = Math.max(0, value);
  });
  return out;
};

const normalizeBets = (bets = {}) => {
  const pass = Math.max(0, Number(bets.pass) || 0);
  const dont = Math.max(0, Number(bets.dont) || 0);
  const field = Math.max(0, Number(bets.field) || 0);
  const come = Math.max(0, Number(bets.come) || 0);
  const place = normalizeNumberMap(bets.place, [4, 5, 6, 8, 9, 10]);
  const hardways = normalizeNumberMap(bets.hardways, [4, 6, 8, 10]);
  const comePoints = normalizeNumberMap(bets.comePoints, [4, 5, 6, 8, 9, 10]);
  return { pass, dont, field, come, place, hardways, comePoints };
};

const totalBet = (bets) =>
  bets.pass +
  bets.dont +
  bets.field +
  bets.come +
  Object.values(bets.place).reduce((sum, val) => sum + val, 0) +
  Object.values(bets.hardways).reduce((sum, val) => sum + val, 0) +
  Object.values(bets.comePoints).reduce((sum, val) => sum + val, 0);

const rollDice = (rng = Math.random) => {
  const die1 = Math.floor(rng() * 6) + 1;
  const die2 = Math.floor(rng() * 6) + 1;
  return { die1, die2, total: die1 + die2, hard: die1 === die2 };
};

const resolveField = (roll, fieldBet) => {
  if (!fieldBet) return { payout: 0, win: false };
  if (roll === 2 || roll === 12) return { payout: fieldBet * 3, win: true };
  if ([3, 4, 9, 10, 11].includes(roll)) return { payout: fieldBet * 2, win: true };
  return { payout: 0, win: false };
};

const createCrapsState = () => {
  return {
    point: 0,
    bets: {
      pass: 0,
      dont: 0,
      field: 0,
      come: 0,
      place: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0 },
      hardways: { 4: 0, 6: 0, 8: 0, 10: 0 },
      comePoints: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0 },
    },
    inRound: true,
  }
};

const resolveCrapsRoll = (state, bets, balance, paid, tableOn = true, rng = Math.random) => {
  const cleanBets = normalizeBets(bets);
  const wager = totalBet(cleanBets);
  if (wager <= 0) return { error: "No bets placed." };
  if (!paid && balance < wager) return { error: "Not enough credits." };

  let nextBalance = paid ? balance : balance - wager;
  const rollResult = rollDice(rng);
  const roll = rollResult.total;
  const isComeOut = !state.point;
  let point = state.point || 0;
  let passBet = cleanBets.pass;
  let dontBet = cleanBets.dont;
  let fieldBet = cleanBets.field;
  let comeBet = cleanBets.come;
  const placeBets = { ...cleanBets.place };
  const hardways = { ...cleanBets.hardways };
  const comePoints = { ...cleanBets.comePoints };
  let payout = 0;

  const fieldResult = resolveField(roll, fieldBet);
  payout += fieldResult.payout;
  fieldBet = 0;

  const hardwayPays = {
    4: 8,
    6: 10,
    8: 10,
    10: 8,
  };
  if (tableOn) {
    Object.keys(hardways).forEach((key) => {
      const num = Number(key);
      const bet = hardways[num] || 0;
      if (!bet) return;
      if (roll === 7) {
        hardways[num] = 0;
        return;
      }
      if (roll === num) {
        if (rollResult.hard) {
          payout += bet * hardwayPays[num];
        }
        hardways[num] = 0;
      }
    });
  }
  if (tableOn) {
    if (roll === 7) {
      Object.keys(placeBets).forEach((key) => (placeBets[key] = 0));
      Object.keys(comePoints).forEach((key) => (comePoints[key] = 0));
    } else {
      const placePays = {
        4: 1.8,
        10: 1.8,
        5: 1.4,
        9: 1.4,
        6: 1.1666667,
        8: 1.1666667,
      };
      Object.keys(placeBets).forEach((key) => {
        const num = Number(key);
        const bet = placeBets[num] || 0;
        if (!bet) return;
        if (roll === num) {
          payout += bet * placePays[num];
        }
      });

      Object.keys(comePoints).forEach((key) => {
        const num = Number(key);
        const bet = comePoints[num] || 0;
        if (!bet) return;
        if (roll === num) {
          payout += bet * 2;
          comePoints[num] = 0;
        }
      });
    }

    if (comeBet > 0) {
      if (roll === 7 || roll === 11) {
        payout += comeBet * 2;
        comeBet = 0;
      } else if (roll === 2 || roll === 3 || roll === 12) {
        comeBet = 0;
      } else {
        comePoints[roll] = (comePoints[roll] || 0) + comeBet;
        comeBet = 0;
      }
    }
  }

  if (isComeOut) {
    if (roll === 7 || roll === 11) {
      payout += passBet * 2;
      passBet = 0;
      dontBet = 0;
    } else if (roll === 2 || roll === 3) {
      payout += dontBet * 2;
      passBet = 0;
      dontBet = 0;
    } else if (roll === 12) {
      passBet = 0;
      payout += dontBet;
      dontBet = 0;
    } else {
      point = roll;
    }
  } else {
    if (roll === point) {
      payout += passBet * 2;
      passBet = 0;
      dontBet = 0;
      point = 0;
    } else if (roll === 7) {
      payout += dontBet * 2;
      passBet = 0;
      dontBet = 0;
      point = 0;
    }
  }

  nextBalance += payout;

  const nextState = {
    point,
    tableOn,
    bets: {
      pass: passBet,
      dont: dontBet,
      field: fieldBet,
      come: comeBet,
      place: placeBets,
      hardways,
      comePoints,
    },
  };

  return {
    state: nextState,
    balance: nextBalance,
    roll,
    payout,
    wager,
    win: payout > 0,
  };
};

module.exports = {
  createCrapsState,
  resolveCrapsRoll,
};
