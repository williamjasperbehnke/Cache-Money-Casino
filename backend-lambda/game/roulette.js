const { sumValues } = require("../lib/utils");

const rouletteOrder = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  "00", 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const normalizeBets = (bets) => ({
  numbers: bets?.numbers || {},
  colors: bets?.colors || {},
  parities: bets?.parities || {},
});

const totalBet = (bets) =>
  sumValues(bets.numbers) + sumValues(bets.colors) + sumValues(bets.parities);

const spinOutcome = () => rouletteOrder[Math.floor(Math.random() * rouletteOrder.length)];

const computePayout = (bets, resultNumber) => {
  let payout = 0;
  let profit = 0;

  const numberAmount = bets.numbers[resultNumber] || 0;
  if (numberAmount) {
    payout += numberAmount * 35 + numberAmount;
    profit += numberAmount * 35;
  }
  const color = redNumbers.has(Number(resultNumber)) ? "red" : "black";
  const colorAmount = bets.colors[color] || 0;
  if (colorAmount) {
    payout += colorAmount * 2;
    profit += colorAmount;
  }
  const parity = Number(resultNumber) % 2 === 0 ? "even" : "odd";
  const parityAmount = bets.parities[parity] || 0;
  if (parityAmount) {
    payout += parityAmount * 2;
    profit += parityAmount;
  }

  return { payout, profit, win: profit > 0 };
};

const buildChaosZones = () => [
  ...rouletteOrder.map((value) => ({ bucket: "numbers", key: String(value) })),
  { bucket: "colors", key: "red" },
  { bucket: "colors", key: "black" },
  { bucket: "parities", key: "odd" },
  { bucket: "parities", key: "even" },
];

const computeChaosBudget = (remainingBalance) => {
  const available = Math.min(remainingBalance, 200);
  if (available <= 0) return { available: 0, spend: 0 };
  const spend = Math.min(available, Math.floor(Math.random() * 150) + 50);
  return { available, spend };
};

const applyRandomBets = ({ bets, chipValues, maxPerSlot, spend, zones, guardLimit = 500 }) => {
  const nextBets = {
    numbers: { ...(bets.numbers || {}) },
    colors: { ...(bets.colors || {}) },
    parities: { ...(bets.parities || {}) },
  };

  let spent = 0;
  let guard = 0;
  while (spent < spend && guard < guardLimit) {
    guard += 1;
    const amount = chipValues[Math.floor(Math.random() * chipValues.length)];
    if (spent + amount > spend) continue;
    const zone = zones[Math.floor(Math.random() * zones.length)];
    if (!zone) break;
    const current = Number(nextBets[zone.bucket][zone.key] || 0);
    if (current + amount > maxPerSlot) continue;
    nextBets[zone.bucket][zone.key] = current + amount;
    spent += amount;
  }

  return { nextBets, spent };
};

module.exports = {
  normalizeBets,
  totalBet,
  spinOutcome,
  computePayout,
  buildChaosZones,
  computeChaosBudget,
  applyRandomBets,
};
