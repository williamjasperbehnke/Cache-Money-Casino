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
  { key: "threeOfAKind", label: "Three of a Kind" },
  { key: "fourOfAKind", label: "Four of a Kind" },
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
      diceWrap: document.getElementById("yahtzeeDice"),
      dealerDiceWrap: document.getElementById("yahtzeeDealerDice"),
      scoreBody: document.getElementById("yahtzeeScores"),
      chipsWrap: document.getElementById("yahtzeeChips"),
      chips: document.querySelectorAll("#yahtzeeChips .chip"),
      playerTotal: document.getElementById("yahtzeePlayerTotal"),
      dealerTotal: document.getElementById("yahtzeeDealerTotal"),
    };
  }

  applyServerState(payload, { skipDealerScores = false } = {}) {
    const server = payload?.state;
    if (!server) return;
    state.yahtzee.bet = Number(server.bet) || 0;
    state.yahtzee.inRound = Boolean(server.inRound);
    state.yahtzee.phase = server.phase || "player";
    state.yahtzee.rollsLeft = Number(server.rollsLeft) || 0;
    state.yahtzee.dice = Array.isArray(server.dice) ? server.dice : [];
    state.yahtzee.holds = Array.isArray(server.holds) ? server.holds : [false, false, false, false, false];
    state.yahtzee.dealerDice = Array.isArray(server.dealerDice) ? server.dealerDice : [];
    state.yahtzee.playerScores = server.playerScores || {};
    if (!skipDealerScores) {
      state.yahtzee.dealerScores = server.dealerScores || {};
    }
    if (state.yahtzee.inRound) {
      state.yahtzee.hasRolled = Number(server.rollsLeft) < 3;
    } else {
      state.yahtzee.hasRolled = false;
    }
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
      const left = state.yahtzee.rollsLeft || 0;
      this.ui.rollBtn.textContent = state.yahtzee.inRound ? `Roll (${left} left)` : "Roll";
      this.ui.rollBtn.disabled = !state.yahtzee.inRound || left <= 0;
      this.ui.rollBtn.classList.toggle("hidden", !state.yahtzee.inRound);
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

  buildDie(face, { interactive, held, rolling } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "craps-die yahtzee-die";
    if (held) btn.classList.add("held");
    if (rolling) btn.classList.add("rolling");
    if (!interactive) btn.disabled = true;
    btn.dataset.face = String(face || 1);
    for (let i = 0; i < 9; i += 1) {
      const pip = document.createElement("span");
      pip.className = "pip";
      btn.appendChild(pip);
    }
    return btn;
  }

  renderDice() {
    if (!this.ui.diceWrap) return;
    this.ui.diceWrap.innerHTML = "";
    let dice = state.yahtzee.dice || [];
    if (dice.length === 0) {
      dice = [1, 1, 1, 1, 1];
    }
    dice.forEach((die, index) => {
      const btn = this.buildDie(die, {
        interactive: state.yahtzee.inRound && state.yahtzee.hasRolled,
        held: state.yahtzee.holds[index],
        rolling: state.yahtzee.rolling && !state.yahtzee.holds[index],
      });
      btn.dataset.index = String(index);
      this.ui.diceWrap.appendChild(btn);
    });
    if (!this.ui.dealerDiceWrap) return;
    this.ui.dealerDiceWrap.innerHTML = "";
    let dealerDice = state.yahtzee.dealerDice || [];
    if (dealerDice.length === 0) {
      dealerDice = [1, 1, 1, 1, 1];
    }
    if (state.yahtzee.dealerRolling && dealerDice.length === 0) {
      dealerDice = Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1);
    }
    dealerDice.forEach((die) => {
      const btn = this.buildDie(die, {
        interactive: false,
        rolling: state.yahtzee.dealerRolling,
      });
      this.ui.dealerDiceWrap.appendChild(btn);
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
      const playerScore = state.yahtzee.playerScores?.[cat.key];
      const available =
        !Number.isFinite(playerScore) && state.yahtzee.inRound && state.yahtzee.hasRolled;
      const preview = computeScore(cat.key, dice);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "yahtzee-score-action";
      action.textContent = Number.isFinite(playerScore)
        ? String(playerScore)
        : state.yahtzee.hasRolled
        ? String(preview)
        : "—";
      action.disabled = !available;
      action.dataset.category = cat.key;
      action.title = available ? `Score ${preview}` : "Locked";
      if (Number.isFinite(playerScore)) action.classList.add("locked");
      player.className = "yahtzee-score-value";
      player.appendChild(action);

      const dealer = document.createElement("div");
      dealer.className = "yahtzee-score-value";
      const dealerScore = state.yahtzee.dealerScores?.[cat.key];
      dealer.textContent = Number.isFinite(dealerScore) ? String(dealerScore) : "—";

      row.appendChild(label);
      row.appendChild(player);
      row.appendChild(dealer);
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
      state.yahtzee.hasRolled = false;
      this.updateUI();
      showCenterToast("Roll to start.", "win");
    } catch (err) {
      showCenterToast(err?.message || "Start failed.", "danger");
    } finally {
      unlock();
    }
  }

  async rollDice() {
    if (!state.yahtzee.inRound) return;
    state.yahtzee.rolling = true;
    this.updateUI();
    const unlock = lockPanel("yahtzee");
    try {
      const payload = await auth.request("/api/games/yahtzee/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holds: state.yahtzee.holds }),
      });
      this.applyServerState(payload);
      state.yahtzee.hasRolled = true;
      state.yahtzee.rolling = false;
      this.updateUI();
      playSfx("spin");
    } catch (err) {
      state.yahtzee.rolling = false;
      showCenterToast(err?.message || "Roll failed.", "danger");
    } finally {
      unlock();
    }
  }

  async scoreCategory(category) {
    if (!state.yahtzee.inRound) return;
    state.yahtzee.dealerRolling = true;
    this.updateUI();
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
      this.applyServerState(payload, { skipDealerScores: true });
      state.yahtzee.hasRolled = false;
      this.updateUI();
      setTimeout(() => {
        state.yahtzee.dealerRolling = false;
        this.applyServerState(payload);
        this.updateUI();
        if (payload?.messages?.length) {
          payload.messages.forEach((msg) => showCenterToast(msg.text, msg.tone, msg.duration));
        }
      }, 500);
    } catch (err) {
      state.yahtzee.dealerRolling = false;
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
      if (!state.yahtzee.inRound || !state.yahtzee.hasRolled) return;
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
    state.yahtzee.hasRolled = false;
    this.updateUI();
  }

  init() {
    this.cacheElements();
    this.bindChips();
    this.bindEvents();
    this.reset();
  }
}
