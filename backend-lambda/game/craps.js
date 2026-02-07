const normalizeBets = (bets = {}) => {
  const pass = Math.max(0, Number(bets.pass) || 0);
  const dont = Math.max(0, Number(bets.dont) || 0);
  const field = Math.max(0, Number(bets.field) || 0);
  return { pass, dont, field };
};

const totalBet = (bets) => bets.pass + bets.dont + bets.field;

const rollDice = (rng = Math.random) =>
  (Math.floor(rng() * 6) + 1) + (Math.floor(rng() * 6) + 1);

const resolveField = (roll, fieldBet) => {
  if (!fieldBet) return { payout: 0, win: false };
  if (roll === 2 || roll === 12) return { payout: fieldBet * 3, win: true };
  if ([3, 4, 9, 10, 11].includes(roll)) return { payout: fieldBet * 2, win: true };
  return { payout: 0, win: false };
};

const resolveCrapsRoll = (state, bets, balance, paid, rng = Math.random) => {
  const cleanBets = normalizeBets(bets);
  const wager = totalBet(cleanBets);
  if (wager <= 0) return { error: "No bets placed." };
  if (!paid && balance < wager) return { error: "Not enough credits." };

  let nextBalance = paid ? balance : balance - wager;
  const roll = rollDice(rng);
  const isComeOut = !state.point;
  let point = state.point || 0;
  let passBet = cleanBets.pass;
  let dontBet = cleanBets.dont;
  let fieldBet = cleanBets.field;
  let payout = 0;

  const fieldResult = resolveField(roll, fieldBet);
  payout += fieldResult.payout;
  fieldBet = 0;

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
    bets: { pass: passBet, dont: dontBet, field: fieldBet },
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
  normalizeBets,
  totalBet,
  resolveCrapsRoll,
};
