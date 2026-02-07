const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "🍇", "🍀", "💥", "🍉", "🪙"];

const PAYOUTS = {
  "💎": { multiplier: 12, key: "3-diamond" },
  "⭐": { multiplier: 10, key: "3-star" },
  "🔔": { multiplier: 8, key: "3-bell" },
  "🍇": { multiplier: 6, key: "3-grape" },
  "🍒": { multiplier: 6, key: "3-cherry" },
  "🍋": { multiplier: 4, key: "3-lemon" },
  any3: { multiplier: 3, key: "3-any" },
  any2: { multiplier: 1.5, key: "2-any" },
};

const evaluateSlots = (symbols) => {
  const [a, b, c] = symbols;
  const hasThreeKind = a === b && b === c;
  const hasTwoKind = a === b || b === c || a === c;
  const tripleSymbol = hasThreeKind ? a : null;
  const twoSymbol = hasTwoKind
    ? a === b
      ? a
      : b === c
        ? b
        : a
    : null;

  if (hasThreeKind) {
    const payout = PAYOUTS[tripleSymbol] || PAYOUTS.any3;
    return { hasThreeKind, hasTwoKind, tripleSymbol, twoSymbol, ...payout };
  }

  if (hasTwoKind) {
    return {
      hasThreeKind,
      hasTwoKind,
      tripleSymbol,
      twoSymbol,
      multiplier: PAYOUTS.any2.multiplier,
      key: PAYOUTS.any2.key,
    };
  }

  return { hasThreeKind, hasTwoKind, tripleSymbol, twoSymbol, multiplier: 0, key: "" };
};

const spinSlots = (bet, balance) => {
  const wager = Number(bet);
  if (!Number.isFinite(wager) || wager <= 0) {
    return { error: "Invalid bet." };
  }
  if (balance < wager) {
    return { error: "Not enough credits." };
  }

  const symbols = Array.from({ length: 3 }, () =>
    SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
  );
  const outcome = evaluateSlots(symbols);
  let payout = 0;
  let profit = -wager;
  let nextBalance = balance - wager;
  let wipeBalance = false;

  if (outcome.hasThreeKind && outcome.tripleSymbol === "💥") {
    nextBalance = 0;
    wipeBalance = true;
    profit = -wager;
  } else if (outcome.hasTwoKind && outcome.twoSymbol === "💥") {
    profit = -wager;
  } else if (outcome.multiplier > 0 || outcome.hasTwoKind) {
    const payMultiplier = outcome.hasTwoKind ? PAYOUTS.any2.multiplier : outcome.multiplier;
    payout = wager * payMultiplier + wager;
    profit = wager * payMultiplier;
    nextBalance = balance - wager + payout;
  }

  return { symbols, outcome, payout, profit, nextBalance, wipeBalance };
};

module.exports = {
  spinSlots,
};
