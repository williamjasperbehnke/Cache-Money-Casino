const CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "threeOfAKind",
  "fourOfAKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yahtzee",
  "chance",
];

const rollDie = () => Math.floor(Math.random() * 6) + 1;

const rollDice = (holds = []) =>
  Array.from({ length: 5 }, (_, index) => (holds[index] ? holds[index] : rollDie()));

const countFaces = (dice) => {
  const counts = Array(7).fill(0);
  dice.forEach((die) => {
    counts[die] += 1;
  });
  return counts;
};

const sumDice = (dice) => dice.reduce((acc, val) => acc + val, 0);

const hasStraight = (dice, length) => {
  const unique = Array.from(new Set(dice)).sort((a, b) => a - b);
  let streak = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] === unique[i - 1] + 1) {
      streak += 1;
      if (streak >= length) return true;
    } else {
      streak = 1;
    }
  }
  return false;
};

const computeScore = (category, dice) => {
  const counts = countFaces(dice);
  const total = sumDice(dice);
  switch (category) {
    case "ones":
      return counts[1] * 1;
    case "twos":
      return counts[2] * 2;
    case "threes":
      return counts[3] * 3;
    case "fours":
      return counts[4] * 4;
    case "fives":
      return counts[5] * 5;
    case "sixes":
      return counts[6] * 6;
    case "threeOfAKind":
      return counts.some((c) => c >= 3) ? total : 0;
    case "fourOfAKind":
      return counts.some((c) => c >= 4) ? total : 0;
    case "fullHouse":
      return counts.some((c) => c === 3) && counts.some((c) => c === 2) ? 25 : 0;
    case "smallStraight":
      return hasStraight(dice, 4) ? 30 : 0;
    case "largeStraight":
      return hasStraight(dice, 5) ? 40 : 0;
    case "yahtzee":
      return counts.some((c) => c === 5) ? 50 : 0;
    case "chance":
      return total;
    default:
      return 0;
  }
};

const emptyScorecard = () =>
  CATEGORIES.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {});

const scoreTotal = (scores) =>
  Object.values(scores).reduce((acc, val) => acc + (Number(val) || 0), 0);

const availableCategories = (scores) =>
  CATEGORIES.filter((cat) => scores[cat] === null || typeof scores[cat] === "undefined");

const createYahtzeeState = ({ bet }) => ({
  bet,
  inRound: true,
  phase: "player",
  rollsLeft: 3,
  dice: [],
  holds: [false, false, false, false, false],
  dealerDice: [],
  playerScores: emptyScorecard(),
  dealerScores: emptyScorecard(),
});

const applyYahtzeeRoll = (state, holds) => {
  if (!state || !state.inRound) return { error: "Round not running." };
  if (state.phase !== "player") return { error: "Not your turn." };
  if (state.rollsLeft <= 0) return { error: "No rolls left." };
  const nextHolds = Array.isArray(holds) ? holds.map(Boolean) : state.holds;
  const rolled = rollDice(nextHolds.map((hold, index) => (hold ? state.dice[index] : 0)));
  state.dice = rolled;
  state.holds = nextHolds;
  state.rollsLeft -= 1;
  return { state };
};

const dealerTurn = (state) => {
  const dealerScores = state.dealerScores;
  let dice = Array.from({ length: 5 }, () => rollDie());
  for (let i = 0; i < 2; i += 1) {
    dice = Array.from({ length: 5 }, () => rollDie());
  }
  state.dealerDice = dice;
  const choices = availableCategories(dealerScores);
  let best = choices[0];
  let bestScore = -1;
  choices.forEach((cat) => {
    const score = computeScore(cat, dice);
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  });
  dealerScores[best] = bestScore;
  return {
    dice,
    category: best,
    score: bestScore,
  };
};

const applyYahtzeeScore = (state, category) => {
  if (!state || !state.inRound) return { error: "Round not running." };
  if (state.phase !== "player") return { error: "Not your turn." };
  if (!category || !CATEGORIES.includes(category)) return { error: "Invalid category." };
  if (state.playerScores[category] !== null) return { error: "Category already scored." };

  const score = computeScore(category, state.dice);
  state.playerScores[category] = score;
  state.rollsLeft = 3;
  state.holds = [false, false, false, false, false];
  // Keep player dice between rounds; only change on explicit roll.

  const dealerResult = dealerTurn(state);
  const done =
    availableCategories(state.playerScores).length === 0 &&
    availableCategories(state.dealerScores).length === 0;

  const categoryLabel = (key) =>
    key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (char) => char.toUpperCase());
  const messages = [
    { text: `You scored ${score} on ${categoryLabel(category)}.`, tone: "win", duration: 1600 },
    {
      text: `Dealer scored ${dealerResult.score} on ${categoryLabel(dealerResult.category)}.`,
      tone: "danger",
      duration: 1600,
    },
  ];

  if (!done) {
    state.phase = "player";
    return { state, messages };
  }

  const playerTotal = scoreTotal(state.playerScores);
  const dealerTotal = scoreTotal(state.dealerScores);
  state.inRound = false;
  state.phase = "reveal";

  let result = "push";
  let payout = state.bet;
  let net = 0;
  if (playerTotal > dealerTotal) {
    result = "win";
    payout = state.bet * 2;
    net = state.bet;
  } else if (playerTotal < dealerTotal) {
    result = "loss";
    payout = 0;
    net = -state.bet;
  }

  messages.push({
    text:
      result === "win"
        ? `You win! ${playerTotal} to ${dealerTotal}.`
        : result === "loss"
        ? `Dealer wins ${dealerTotal} to ${playerTotal}.`
        : `Push at ${playerTotal}.`,
    tone: result === "win" ? "win" : result === "loss" ? "danger" : "win",
    duration: 2200,
  });

  return {
    state,
    result,
    payout,
    net,
    messages,
    playerTotal,
    dealerTotal,
  };
};

module.exports = {
  createYahtzeeState,
  applyYahtzeeRoll,
  applyYahtzeeScore,
  scoreTotal,
  availableCategories,
  computeScore,
  CATEGORIES,
};
