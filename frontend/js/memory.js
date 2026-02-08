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
const DEFAULT_ROWS = 4;
const DEFAULT_COLS = 6;
const MAX_MULTIPLIER = 3;
const MIN_MULTIPLIER = 0.5;
const MOVE_PENALTY = 0.1;

export class MemoryGame {
  constructor() {
    this.ui = {};
    this.flipResetTimer = null;
    this.finishTimer = null;
  }

  cacheElements() {
    this.ui = {
      grid: document.getElementById("memoryGrid"),
      betTotal: document.getElementById("memoryBet"),
      startBtn: document.getElementById("memoryStart"),
      clearBtn: document.getElementById("memoryClear"),
      movesEl: document.getElementById("memoryMoves"),
      matchesEl: document.getElementById("memoryMatches"),
      multiplierEl: document.getElementById("memoryMultiplier"),
      chipsWrap: document.getElementById("memoryChips"),
      chips: document.querySelectorAll('#memoryChips .chip'),
    };
  }

  totalPairs() {
    const rows = state.memory.rows || DEFAULT_ROWS;
    const cols = state.memory.cols || DEFAULT_COLS;
    return Math.floor((rows * cols) / 2);
  }

  buildPlaceholderCards() {
    const total = (state.memory.rows || DEFAULT_ROWS) * (state.memory.cols || DEFAULT_COLS);
    return Array.from({ length: total }, () => ({ value: null, revealed: false, matched: false }));
  }

  applyServerState(payload) {
    const server = payload?.state;
    if (!server) return;
    state.memory.rows = server.rows || DEFAULT_ROWS;
    state.memory.cols = server.cols || DEFAULT_COLS;
    state.memory.bet = Number(server.bet) || 0;
    state.memory.moves = Number(server.moves) || 0;
    state.memory.matches = Number(server.matches) || 0;
    state.memory.completed = Boolean(server.completed);
    state.memory.inRound = Boolean(server.inRound);
    state.memory.cards = Array.isArray(server.cards) ? server.cards : this.buildPlaceholderCards();
  }

  updateStats() {
    if (this.ui.movesEl) this.ui.movesEl.textContent = String(state.memory.moves || 0);
    if (this.ui.matchesEl) {
      this.ui.matchesEl.textContent = String(state.memory.matches || 0);
    }
    if (this.ui.multiplierEl) {
      const pairs = this.totalPairs();
      const moves = state.memory.moves || 0;
      const extra = Math.max(0, moves - pairs);
      const running = Math.max(MIN_MULTIPLIER, MAX_MULTIPLIER - extra * MOVE_PENALTY);
      if (state.memory.completed) {
        const finalValue = Number.isFinite(state.memory.multiplier)
          ? state.memory.multiplier
          : running;
        this.ui.multiplierEl.textContent = `${Number(finalValue).toFixed(2)}x`;
      } else {
        this.ui.multiplierEl.textContent = `${running.toFixed(2)}x`;
      }
    }
  }

  renderBoard() {
    if (!this.ui.grid) return;
    const cards = Array.isArray(state.memory.cards) && state.memory.cards.length
      ? state.memory.cards
      : this.buildPlaceholderCards();
    this.ui.grid.innerHTML = "";
    cards.forEach((card, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "memory-card";
      button.dataset.index = String(index);
      if (card.revealed) button.classList.add("revealed");
      if (card.matched) button.classList.add("matched");
      const face = document.createElement("span");
      face.className = "memory-face";
      face.textContent = card.value || "?";
      button.appendChild(face);
      this.ui.grid.appendChild(button);
    });
  }

  updateUI() {
    const total = state.memory.inRound ? state.memory.bet : state.memory.betAmount;
    updateBetTotal(total, "memoryBet");
    if (this.ui.chipsWrap) {
      this.ui.chipsWrap.classList.toggle("hidden", state.memory.inRound && !state.memory.completed);
    }
    if (this.ui.startBtn) {
      if (state.memory.inRound && !state.memory.completed) {
        this.ui.startBtn.textContent = "In Play";
        this.ui.startBtn.disabled = true;
        this.ui.startBtn.classList.add("hidden");
      } else {
        this.ui.startBtn.textContent = "Start";
        this.ui.startBtn.disabled = false;
        this.ui.startBtn.classList.remove("hidden");
      }
    }
    if (this.ui.clearBtn) {
      const hide = state.memory.inRound && !state.memory.completed;
      this.ui.clearBtn.disabled = hide;
      this.ui.clearBtn.classList.toggle("hidden", hide);
    }
    this.updateStats();
    this.renderBoard();
  }

  bindChips() {
    bindBetChips({
      chips: this.ui.chips,
      canBet: () => (!state.memory.inRound || state.memory.completed) && state.balance > 0,
      getBalance: () => state.balance,
      getBetAmount: () => state.memory.betAmount,
      setBetAmount: (amount) => {
        if (amount > MAX_BET) {
          showCenterToast("Max bet is $100.", "danger");
        }
        state.memory.betAmount = Math.min(MAX_BET, amount);
      },
      onUpdate: () => this.updateUI(),
      onHit: () => playSfx("hit"),
      onClosed: () => showCenterToast("Finish the round first.", "danger"),
    });
  }

  async startGame() {
    if (state.memory.inRound && !state.memory.completed) return;
    const bet = Number(state.memory.betAmount) || 0;
    if (bet <= 0) {
      showCenterToast("Choose a bet to start.", "danger");
      return;
    }
    if (bet > MAX_BET) {
      showCenterToast("Max bet is $100.", "danger");
      return;
    }
    if (state.balance < bet) {
      showCenterToast("Not enough credits.", "danger");
      return;
    }
    const unlock = lockPanel("memory");
    try {
      const payload = await auth.request("/api/games/memory/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bet }),
      });
      if (Number.isFinite(payload?.balance)) {
        state.balance = payload.balance;
        updateBalance();
      }
      state.memory.betAmount = 0;
      this.applyServerState(payload);
      this.updateUI();
      showCenterToast("Match the pairs!", "win");
    } catch (err) {
      showCenterToast(err?.message || "Start failed.", "danger");
    } finally {
      unlock();
    }
  }

  async flipCard(index) {
    if (!state.memory.inRound) {
      showCenterToast("Start a round first.", "danger");
      return;
    }
    if (state.memory.completed) {
      showCenterToast("Round complete. Start a new game.", "win");
      return;
    }
    const unlock = lockPanel("memory");
    try {
      const payload = await auth.request("/api/games/memory/flip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      if (Number.isFinite(payload?.balance)) {
        state.balance = payload.balance;
        updateBalance();
      }
      if (payload?.multiplier) state.memory.multiplier = payload.multiplier;
      this.applyServerState(payload);
      this.updateUI();
      const unmatchedRevealed = state.memory.cards.filter(
        (card) => card.revealed && !card.matched
      ).length;
      if (!payload?.matched && unmatchedRevealed >= 2) {
        playSfx("lose");
      }
      this.scheduleFlipReset();
      if (payload?.matched) {
        playSfx("win");
        showCenterToast("Match!", "win");
      }
      if (payload?.completed) {
        const multiplier = payload.multiplier ? `${payload.multiplier.toFixed(2)}x` : "1x";
        showCenterToast(`Solved! Payout ${multiplier}.`, "win");
        this.scheduleFinishReset();
      }
    } catch (err) {
      showCenterToast(err?.message || "Flip failed.", "danger");
    } finally {
      unlock();
    }
  }

  bindBoard() {
    if (!this.ui.grid) return;
    this.ui.grid.addEventListener("click", (event) => {
      const card = event.target.closest(".memory-card");
      if (!card) return;
      const index = Number(card.dataset.index);
      if (!Number.isInteger(index)) return;
      this.flipCard(index);
    });
  }

  reset() {
    state.memory.betAmount = 0;
    state.memory.bet = 0;
    state.memory.inRound = false;
    state.memory.completed = false;
    state.memory.moves = 0;
    state.memory.matches = 0;
    state.memory.rows = DEFAULT_ROWS;
    state.memory.cols = DEFAULT_COLS;
    state.memory.cards = this.buildPlaceholderCards();
    state.memory.multiplier = 0;
    if (this.flipResetTimer) {
      clearTimeout(this.flipResetTimer);
      this.flipResetTimer = null;
    }
    if (this.finishTimer) {
      clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }
    this.updateUI();
  }

  scheduleFlipReset() {
    if (this.flipResetTimer) clearTimeout(this.flipResetTimer);
    if (!state.memory.inRound || state.memory.completed) return;
    this.flipResetTimer = setTimeout(async () => {
      if (!state.memory.inRound || state.memory.completed) return;
      const unmatched = state.memory.cards.filter(
        (card) => card.revealed && !card.matched
      ).length;
      if (unmatched < 2) return;
      state.memory.cards = state.memory.cards.map((card) => {
        if (card.revealed && !card.matched) {
          return { ...card, revealed: false, value: null };
        }
        return card;
      });
      this.updateUI();
    }, 950);
  }

  scheduleFinishReset() {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => {
      this.reset();
    }, 1800);
  }

  init() {
    this.cacheElements();
    this.bindChips();
    this.bindBoard();
    this.ui.startBtn?.addEventListener("click", () => this.startGame());
    this.ui.clearBtn?.addEventListener("click", () => {
      if (state.memory.inRound && !state.memory.completed) return;
      state.memory.betAmount = 0;
      this.updateUI();
    });
    this.reset();
  }
}
