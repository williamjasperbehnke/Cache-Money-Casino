import {
  state,
  updateBalance,
  updateBetTotal,
  showCenterToast,
  bindBetChips,
  lockPanel,
  playSfx,
} from "./core.js";
import { auth } from "./auth.js";

const MAX_BET = 100;
const CATEGORIES = [
  { key: "ones", label: "Ones" },
  { key: "twos", label: "Twos" },
  { key: "threes", label: "Threes" },
  { key: "fours", label: "Fours" },
  { key: "fives", label: "Fives" },
  { key: "sixes", label: "Sixes" },
  { key: "threeKind", label: "Three of a Kind" },
  { key: "fourKind", label: "Four of a Kind" },
  { key: "fullHouse", label: "Full House" },
  { key: "smallStraight", label: "Small Straight" },
  { key: "largeStraight", label: "Large Straight" },
  { key: "yahtzee", label: "Yahtzee" },
  { key: "chance", label: "Chance" },
];

const sumDice = (dice) => dice.reduce((acc, val) => acc + val, 0);

const countFaces = (dice) => {
  const counts = Array(7).fill(0);
  dice.forEach((die) => {
    counts[die] += 1;
  });
  return counts;
};

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
    case "threeKind":
      return counts.some((c) => c >= 3) ? total : 0;
    case "fourKind":
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

export class YahtzeeGame {
  constructor() {
    this.ui = {};
  }

  cacheElements() {
    this.ui = {
      betTotal: document.getElementById("yahtzeeBet"),
      startBtn: document.getElementById("yahtzeeStart"),
      clearBtn: document.getElementById("yahtzeeClear"),
      rollBtn: document.getElementById("yahtzeeRoll"),
      rollsLeft: document.getElementById("yahtzeeRollsLeft"),
      diceWrap: document.getElementById("yahtzeeDice"),
      scoreBody: document.getElementById("yahtzeeScores"),
      chipsWrap: document.getElementById("yahtzeeChips"),
      chips: document.querySelectorAll("#yahtzeeChips .chip"),
      playerTotal: document.getElementById("yahtzeePlayerTotal"),
      dealerTotal: document.getElementById("yahtzeeDealerTotal"),
    };
  }

  applyServerState(payload) {
    const server = payload?.state;
    if (!server) return;
    state.yahtzee.bet = Number(server.bet) || 0;
    state.yahtzee.inRound = Boolean(server.inRound);
    state.yahtzee.phase = server.phase || "player";
    state.yahtzee.rollsLeft = Number(server.rollsLeft) || 0;
    state.yahtzee.dice = Array.isArray(server.dice) ? server.dice : [];
    state.yahtzee.holds = Array.isArray(server.holds) ? server.holds : [false, false, false, false, false];
    state.yahtzee.playerScores = server.playerScores || {};
    state.yahtzee.dealerScores = server.dealerScores || {};
  }

  updateUI() {
    const total = state.yahtzee.inRound ? state.yahtzee.bet : state.yahtzee.betAmount;
    updateBetTotal(total, "yahtzeeBet");

    if (this.ui.startBtn) {
      this.ui.startBtn.classList.toggle("hidden", state.yahtzee.inRound);
      this.ui.startBtn.disabled = state.yahtzee.inRound;
    }
    if (this.ui.clearBtn) {
      this.ui.clearBtn.classList.toggle("hidden", state.yahtzee.inRound);
      this.ui.clearBtn.disabled = state.yahtzee.inRound;
    }
    if (this.ui.rollBtn) {
      this.ui.rollBtn.disabled = !state.yahtzee.inRound || state.yahtzee.rollsLeft <= 0;
    }
    if (this.ui.rollsLeft) {
      this.ui.rollsLeft.textContent = state.yahtzee.inRound ? String(state.yahtzee.rollsLeft) : "—";
    }
    if (this.ui.chipsWrap) {
      this.ui.chipsWrap.classList.toggle("hidden", state.yahtzee.inRound);
    }
    if (this.ui.playerTotal) {
      const totalScore = Object.values(state.yahtzee.playerScores || {}).reduce(
        (acc, val) => acc + (Number(val) || 0),
        0
      );
      this.ui.playerTotal.textContent = String(totalScore);
    }
    if (this.ui.dealerTotal) {
      const totalScore = Object.values(state.yahtzee.dealerScores || {}).reduce(
        (acc, val) => acc + (Number(val) || 0),
        0
      );
      this.ui.dealerTotal.textContent = String(totalScore);
    }
    this.renderDice();
    this.renderScores();
  }

  renderDice() {
    if (!this.ui.diceWrap) return;
    this.ui.diceWrap.innerHTML = "";
    const dice = state.yahtzee.dice || [];
    dice.forEach((die, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "yahtzee-die";
      if (state.yahtzee.holds[index]) btn.classList.add("held");
      btn.dataset.index = String(index);
      btn.textContent = String(die || "-");
      if (!state.yahtzee.inRound) btn.disabled = true;
      this.ui.diceWrap.appendChild(btn);
    });
  }

  renderScores() {
    if (!this.ui.scoreBody) return;
    this.ui.scoreBody.innerHTML = "";
    const dice = state.yahtzee.dice || [];
    CATEGORIES.forEach((cat) => {
      const row = document.createElement("div");
      row.className = "yahtzee-score-row";
      const label = document.createElement("div");
      label.className = "yahtzee-score-label";
      label.textContent = cat.label;

      const player = document.createElement("div");
      player.className = "yahtzee-score-value";
      const playerScore = state.yahtzee.playerScores?.[cat.key];
      player.textContent = Number.isFinite(playerScore) ? String(playerScore) : "—";

      const dealer = document.createElement("div");
      dealer.className = "yahtzee-score-value";
      const dealerScore = state.yahtzee.dealerScores?.[cat.key];
      dealer.textContent = Number.isFinite(dealerScore) ? String(dealerScore) : "—";

      const action = document.createElement("button");
      action.type = "button";
      action.className = "btn small";
      action.textContent = "Score";
      const available = !Number.isFinite(playerScore) && state.yahtzee.inRound;
      action.disabled = !available;
      const preview = computeScore(cat.key, dice);
      action.dataset.category = cat.key;
      action.dataset.preview = String(preview);
      action.title = `Score ${preview}`;

      row.appendChild(label);
      row.appendChild(player);
      row.appendChild(dealer);
      row.appendChild(action);
      this.ui.scoreBody.appendChild(row);
    });
  }

  bindChips() {
    bindBetChips({
      chips: this.ui.chips,
      canBet: () => !state.yahtzee.inRound && state.balance > 0,
      getBalance: () => state.balance,
      getBetAmount: () => state.yahtzee.betAmount,
      setBetAmount: (amount) => {
        if (amount > MAX_BET) {
          showCenterToast("Max bet is $100.", "danger");
        }
        state.yahtzee.betAmount = Math.min(MAX_BET, amount);
      },
      onUpdate: () => this.updateUI(),
      onHit: () => playSfx("hit"),
      onClosed: () => showCenterToast("Finish the round first.", "danger"),
    });
  }

  async startGame() {
    if (state.yahtzee.inRound) return;
    const bet = Number(state.yahtzee.betAmount) || 0;
    if (bet <= 0) {
      showCenterToast("Choose a bet to start.", "danger");
      return;
    }
    if (state.balance < bet) {
      showCenterToast("Not enough credits.", "danger");
      return;
    }
    const unlock = lockPanel("yahtzee");
    try {
      const payload = await auth.request("/api/games/yahtzee/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bet }),
      });
      if (Number.isFinite(payload?.balance)) {
        state.balance = payload.balance;
        updateBalance();
      }
      state.yahtzee.betAmount = 0;
      this.applyServerState(payload);
      this.updateUI();
      showCenterToast("Roll the dice!", "win");
    } catch (err) {
      showCenterToast(err?.message || "Start failed.", "danger");
    } finally {
      unlock();
    }
  }

  async rollDice() {
    if (!state.yahtzee.inRound) return;
    const unlock = lockPanel("yahtzee");
    try {
      const payload = await auth.request("/api/games/yahtzee/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holds: state.yahtzee.holds }),
      });
      this.applyServerState(payload);
      this.updateUI();
      playSfx("spin");
    } catch (err) {
      showCenterToast(err?.message || "Roll failed.", "danger");
    } finally {
      unlock();
    }
  }

  async scoreCategory(category) {
    if (!state.yahtzee.inRound) return;
    const unlock = lockPanel("yahtzee");
    try {
      const payload = await auth.request("/api/games/yahtzee/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (Number.isFinite(payload?.balance)) {
        state.balance = payload.balance;
        updateBalance();
      }
      this.applyServerState(payload);
      this.updateUI();
      if (payload?.messages?.length) {
        payload.messages.forEach((msg) => showCenterToast(msg.text, msg.tone, msg.duration));
      }
    } catch (err) {
      showCenterToast(err?.message || "Score failed.", "danger");
    } finally {
      unlock();
    }
  }

  bindEvents() {
    this.ui.startBtn?.addEventListener("click", () => this.startGame());
    this.ui.clearBtn?.addEventListener("click", () => {
      if (state.yahtzee.inRound) return;
      state.yahtzee.betAmount = 0;
      this.updateUI();
    });
    this.ui.rollBtn?.addEventListener("click", () => this.rollDice());
    this.ui.diceWrap?.addEventListener("click", (event) => {
      const btn = event.target.closest(".yahtzee-die");
      if (!btn) return;
      if (!state.yahtzee.inRound) return;
      const index = Number(btn.dataset.index);
      if (!Number.isInteger(index)) return;
      state.yahtzee.holds[index] = !state.yahtzee.holds[index];
      this.updateUI();
    });
    this.ui.scoreBody?.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-category]");
      if (!btn) return;
      const category = btn.dataset.category;
      this.scoreCategory(category);
    });
  }

  reset() {
    state.yahtzee.betAmount = 0;
    state.yahtzee.bet = 0;
    state.yahtzee.inRound = false;
    state.yahtzee.phase = "idle";
    state.yahtzee.rollsLeft = 0;
    state.yahtzee.dice = [];
    state.yahtzee.holds = [false, false, false, false, false];
    state.yahtzee.playerScores = {};
    state.yahtzee.dealerScores = {};
    this.updateUI();
  }

  init() {
    this.cacheElements();
    this.bindChips();
    this.bindEvents();
    this.reset();
  }
}
