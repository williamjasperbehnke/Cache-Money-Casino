import {
  state,
  updateBalance,
  updateBetTotal,
  playSfx,
  showCenterToast,
  showCenterToasts,
  renderCards,
  revealDealer,
  handTotal,
  makeChipStack,
  bindBetChips,
} from "./core.js";
import { auth } from "./auth.js";

const MAX_BET = 100;
const AUTO_DEAL_DELAY = 200;
const ROUND_RESET_DELAY = 1800;

export class BlackjackGame {
  constructor() {
    this.ui = {};
  }

  cacheElements() {
    this.ui = {
      dealBtn: document.getElementById("bjDeal"),
      hitBtn: document.getElementById("bjHit"),
      standBtn: document.getElementById("bjStand"),
      doubleBtn: document.getElementById("bjDouble"),
      splitBtn: document.getElementById("bjSplit"),
      clearBtn: document.getElementById("bjClear"),
      maxBtn: document.getElementById("bjMax"),
      dealerEl: document.getElementById("bjDealer"),
      playerEl: document.getElementById("bjPlayer"),
      dealerTotal: document.getElementById("bjDealerTotal"),
      playerTotal: document.getElementById("bjPlayerTotal"),
      chipsWrap: document.querySelector("#blackjack .chips"),
      chips: document.querySelectorAll("#blackjack .chip"),
      autoBet: document.getElementById("bjAuto"),
    };
  }

  updateTotal() {
    const total =
      state.blackjack.inRound && state.blackjack.bets.length > 0
        ? state.blackjack.bets.reduce((sum, val) => sum + val, 0)
        : state.blackjack.betAmount;
    updateBetTotal(total, "bjBetTotal");
  }

  scheduleAutoBet() {
    const { autoBet, dealBtn } = this.ui;
    if (!autoBet?.checked || state.blackjack.lastBet <= 0) return;
    setTimeout(() => {
      if (state.blackjack.inRound) return;
      state.blackjack.betAmount = state.blackjack.lastBet;
      this.updateTotal();
      dealBtn?.click();
    }, AUTO_DEAL_DELAY);
  }

  renderHands() {
    const playerEl = this.ui.playerEl;
    if (!playerEl) return;
    playerEl.innerHTML = "";
    const showLabels = state.blackjack.hands.length > 1;
    state.blackjack.hands.forEach((hand, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = showLabels ? "hand-block" : "hand-block single";
      if (index === state.blackjack.activeHand) wrapper.classList.add("active-hand");
      if (showLabels) {
        const label = document.createElement("div");
        label.className = "hand-label";
        label.textContent = `Hand ${index + 1}`;
        wrapper.appendChild(label);
      }
      const cardsEl = document.createElement("div");
      cardsEl.className = "cards";
      renderCards(cardsEl, hand);
      const totalEl = document.createElement("div");
      totalEl.className = "total";
      totalEl.textContent = `Total: ${handTotal(hand)}`;
      const stackEl = document.createElement("div");
      stackEl.className = "chip-stack inline hand-stack";
      makeChipStack(stackEl, state.blackjack.bets[index] || 0);
      wrapper.appendChild(cardsEl);
      wrapper.appendChild(totalEl);
      wrapper.appendChild(stackEl);
      playerEl.appendChild(wrapper);
    });
  }

  updateControls() {
    const {
      dealBtn,
      hitBtn,
      standBtn,
      doubleBtn,
      splitBtn,
      clearBtn,
      maxBtn,
      chipsWrap,
    } = this.ui;
    if (!state.blackjack.inRound) {
      hitBtn?.classList.add("hidden");
      standBtn?.classList.add("hidden");
      doubleBtn?.classList.add("hidden");
      splitBtn?.classList.add("hidden");
      dealBtn?.classList.remove("hidden");
      clearBtn?.classList.remove("hidden");
      maxBtn?.classList.remove("hidden");
      if (!state.blackjack.awaitingClear) chipsWrap?.classList.remove("hidden");
      else chipsWrap?.classList.add("hidden");
      return;
    }
    dealBtn?.classList.add("hidden");
    clearBtn?.classList.add("hidden");
    maxBtn?.classList.add("hidden");
    chipsWrap?.classList.add("hidden");
    hitBtn?.classList.remove("hidden");
    standBtn?.classList.remove("hidden");
    const hand = state.blackjack.hands[state.blackjack.activeHand] || [];
    const canDouble = hand.length === 2 && !state.blackjack.doubled[state.blackjack.activeHand];
    doubleBtn?.classList.toggle("hidden", !canDouble);
    const canSplit =
      !state.blackjack.splitUsed && hand.length === 2 && hand[0].rank === hand[1].rank;
    splitBtn?.classList.toggle("hidden", !canSplit);
  }

  resetRound(keepBet = false) {
    state.blackjack.bet = 0;
    if (!keepBet) {
      state.blackjack.betAmount = 0;
      updateBetTotal(0, "bjBetTotal");
    }
    state.blackjack.hands = [];
    state.blackjack.bets = [];
    state.blackjack.doubled = [];
    state.blackjack.busted = [];
    state.blackjack.pendingMessages = [];
    state.blackjack.activeHand = 0;
    state.blackjack.splitUsed = false;
    state.blackjack.deck = [];
    state.blackjack.player = [];
    state.blackjack.dealer = [];
    state.blackjack.inRound = false;
    state.blackjack.revealDealer = false;
    state.blackjack.awaitingClear = false;
    this.ui.hitBtn?.classList.add("hidden");
    this.ui.standBtn?.classList.add("hidden");
    this.ui.doubleBtn?.classList.add("hidden");
    this.ui.splitBtn?.classList.add("hidden");
    if (this.ui.dealerEl) this.ui.dealerEl.innerHTML = "";
    if (this.ui.playerEl) this.ui.playerEl.innerHTML = "";
    if (this.ui.dealerTotal) this.ui.dealerTotal.textContent = "";
    if (this.ui.playerTotal) this.ui.playerTotal.textContent = "";
    if (keepBet) updateBetTotal(state.blackjack.betAmount, "bjBetTotal");
  }

  applyServerState(serverState, balance) {
    if (!serverState) return;
    state.blackjack.hands = serverState.hands || [];
    state.blackjack.dealer = serverState.dealer || [];
    state.blackjack.bets = serverState.bets || [];
    state.blackjack.doubled = serverState.doubled || [];
    state.blackjack.busted = serverState.busted || [];
    state.blackjack.activeHand = serverState.activeHand || 0;
    state.blackjack.splitUsed = Boolean(serverState.splitUsed);
    state.blackjack.inRound = Boolean(serverState.inRound);
    state.blackjack.revealDealer = Boolean(serverState.revealDealer);
    state.blackjack.awaitingClear = !state.blackjack.inRound;
    state.blackjack.deck = serverState.deck || [];
    if (Number.isFinite(balance)) {
      state.balance = balance;
      updateBalance();
    }
  }

  serializeState() {
    return { ...state.blackjack };
  }

  restoreFromSaved(saved) {
    if (!saved) return;
    Object.assign(state.blackjack, saved);
    state.blackjack.hands = Array.isArray(state.blackjack.hands) ? state.blackjack.hands : [];
    state.blackjack.dealer = Array.isArray(state.blackjack.dealer) ? state.blackjack.dealer : [];
    state.blackjack.bets = Array.isArray(state.blackjack.bets) ? state.blackjack.bets : [];
    state.blackjack.doubled = Array.isArray(state.blackjack.doubled)
      ? state.blackjack.doubled
      : [];
    state.blackjack.busted = Array.isArray(state.blackjack.busted) ? state.blackjack.busted : [];
    state.blackjack.inRound = Boolean(state.blackjack.inRound);
    state.blackjack.revealDealer = Boolean(state.blackjack.revealDealer);
    state.blackjack.awaitingClear = Boolean(state.blackjack.awaitingClear);
    this.updateTotal();
    this.renderHands();
    this.renderDealer();
    this.updateControls();
  }

  renderDealer() {
    if (!this.ui.dealerEl) return;
    if (state.blackjack.revealDealer) {
      renderCards("bjDealer", state.blackjack.dealer);
      revealDealer("bjDealer");
      if (this.ui.dealerTotal) {
        this.ui.dealerTotal.textContent = `Total: ${handTotal(state.blackjack.dealer)}`;
      }
      return;
    }
    renderCards("bjDealer", state.blackjack.dealer, true);
    if (this.ui.dealerTotal) this.ui.dealerTotal.textContent = "Total: ?";
  }

  handleOutcome(outcomes = [], messages = []) {
    const combined = [...messages];
    if (outcomes.length > 0) {
      const multiple = outcomes.length > 1;
      outcomes.forEach((outcome) => {
        const labelPrefix = multiple ? `Hand ${outcome.index + 1} ` : "";
        if (outcome.result === "win") {
          combined.push({
            text: multiple ? `${labelPrefix}wins!` : "You win!",
            tone: "win",
          });
        } else if (outcome.result === "push") {
          combined.push({
            text: multiple ? `${labelPrefix}pushes.` : "Push.",
            tone: "win",
          });
        } else {
          combined.push({
            text: multiple ? `${labelPrefix}loses.` : "You lose.",
            tone: "danger",
          });
        }
      });
      const hasWin = outcomes.some((o) => o.result === "win");
      const hasPush = outcomes.some((o) => o.result === "push");
      playSfx(hasWin || hasPush ? "win" : "lose");
    } else if (messages.length > 0) {
      playSfx("lose");
    }
    if (combined.length > 0) showCenterToasts(combined);
  }

  handleRoundEnd(autoDeal) {
    const { dealBtn } = this.ui;
    state.blackjack.awaitingClear = true;
    this.updateControls();
    setTimeout(() => {
      this.resetRound(autoDeal);
      this.updateControls();
      if (autoDeal) dealBtn?.click();
      else this.scheduleAutoBet();
    }, ROUND_RESET_DELAY);
  }

  addBet(amount) {
    if (state.blackjack.inRound) {
      showCenterToast("Round running.", "danger");
      return;
    }
    const next = Math.min(MAX_BET, state.blackjack.betAmount + amount);
    if (next === state.blackjack.betAmount) {
      showCenterToast("Max bet is $100.", "danger");
      return;
    }
    state.blackjack.betAmount = next;
    this.updateTotal();
  }

  removeBet(amount) {
    if (state.blackjack.inRound) {
      showCenterToast("Round running.", "danger");
      return;
    }
    state.blackjack.betAmount = Math.max(0, state.blackjack.betAmount - amount);
    this.updateTotal();
  }

  bindEvents() {
    const { dealBtn, hitBtn, standBtn, doubleBtn, splitBtn, clearBtn, maxBtn } = this.ui;

    bindBetChips({
      chips: this.ui.chips,
      canBet: () => !state.blackjack.inRound && state.balance > 0,
      getBalance: () => Math.min(state.balance, MAX_BET),
      getToCall: () => 0,
      getBetAmount: () => state.blackjack.betAmount,
      setBetAmount: (amount) => {
        if (amount === state.blackjack.betAmount && amount === MAX_BET) {
          showCenterToast("Max bet is $100.", "danger");
        }
        state.blackjack.betAmount = amount;
      },
      onUpdate: () => this.updateTotal(),
      onHit: () => playSfx("hit"),
      onClosed: () => {
        if (state.blackjack.inRound) {
          showCenterToast("Round running.", "danger");
        } else {
          showCenterToast("Not enough credits.", "danger");
        }
      },
    });

    clearBtn?.addEventListener("click", () => {
      if (state.blackjack.inRound) {
        showCenterToast("Round running.", "danger");
        return;
      }
      state.blackjack.betAmount = 0;
      this.updateTotal();
    });

    maxBtn?.addEventListener("click", () => {
      if (state.blackjack.inRound) {
        showCenterToast("Round running.", "danger");
        return;
      }
      state.blackjack.betAmount = Math.min(MAX_BET, state.balance);
      this.updateTotal();
    });

    dealBtn?.addEventListener("click", async () => {
      if (state.blackjack.inRound) {
        showCenterToast("Round already running.", "danger");
        return;
      }
      const bet = state.blackjack.betAmount;
      if (bet <= 0) {
        showCenterToast("Place a bet to deal.", "danger");
        return;
      }
      if (bet > state.balance) {
        showCenterToast("Not enough credits.", "danger");
        return;
      }
      playSfx("deal");
      state.blackjack.lastBet = bet;
      try {
        const payload = await auth.request("/api/games/blackjack/deal", {
          method: "POST",
          body: JSON.stringify({ bet }),
        });
        this.applyServerState(payload.state, payload.balance);
        this.renderHands();
        this.renderDealer();
        this.updateControls();
        this.updateTotal();
      } catch (err) {
        showCenterToast(err.message || "Deal failed.", "danger");
      }
    });

    hitBtn?.addEventListener("click", async () => {
      if (!state.blackjack.inRound) return;
      try {
        const payload = await auth.request("/api/games/blackjack/hit", {
          method: "POST",
          body: JSON.stringify({ state: state.blackjack }),
        });
        this.applyServerState(payload.state, payload.balance);
        this.renderHands();
        this.renderDealer();
        this.updateControls();
        this.updateTotal();
        this.handleOutcome(payload.outcomes || [], payload.messages || []);
        if (!state.blackjack.inRound) {
          const auto = this.ui.autoBet?.checked;
          if (!auto) {
            state.blackjack.betAmount = 0;
            updateBetTotal(0, "bjBetTotal");
          }
          this.handleRoundEnd(auto);
        }
      } catch (err) {
        showCenterToast(err.message || "Hit failed.", "danger");
      }
    });

    standBtn?.addEventListener("click", async () => {
      if (!state.blackjack.inRound) return;
      try {
        const payload = await auth.request("/api/games/blackjack/stand", {
          method: "POST",
          body: JSON.stringify({ state: state.blackjack }),
        });
        this.applyServerState(payload.state, payload.balance);
        this.renderHands();
        this.renderDealer();
        this.updateControls();
        this.updateTotal();
        this.handleOutcome(payload.outcomes || [], payload.messages || []);
        if (!state.blackjack.inRound) {
          const auto = this.ui.autoBet?.checked;
          if (!auto) {
            state.blackjack.betAmount = 0;
            updateBetTotal(0, "bjBetTotal");
          }
          this.handleRoundEnd(auto);
        }
      } catch (err) {
        showCenterToast(err.message || "Stand failed.", "danger");
      }
    });

    doubleBtn?.addEventListener("click", async () => {
      if (!state.blackjack.inRound) return;
      const currentBet = state.blackjack.bets[state.blackjack.activeHand] || 0;
      if (currentBet > state.balance) {
        showCenterToast("Not enough credits to double.", "danger");
        return;
      }
      state.balance -= currentBet;
      updateBalance();
      try {
        const payload = await auth.request("/api/games/blackjack/double", {
          method: "POST",
          body: JSON.stringify({ state: state.blackjack }),
        });
        this.applyServerState(payload.state, payload.balance);
        this.renderHands();
        this.renderDealer();
        this.updateControls();
        this.updateTotal();
        this.handleOutcome(payload.outcomes || [], payload.messages || []);
        if (!state.blackjack.inRound) {
          const auto = this.ui.autoBet?.checked;
          if (!auto) {
            state.blackjack.betAmount = 0;
            updateBetTotal(0, "bjBetTotal");
          }
          this.handleRoundEnd(auto);
        }
      } catch (err) {
        state.balance += currentBet;
        updateBalance();
        showCenterToast(err.message || "Double failed.", "danger");
      }
    });

    splitBtn?.addEventListener("click", async () => {
      if (!state.blackjack.inRound || state.blackjack.splitUsed) return;
      try {
        const payload = await auth.request("/api/games/blackjack/split", {
          method: "POST",
          body: JSON.stringify({ state: state.blackjack }),
        });
        this.applyServerState(payload.state, payload.balance);
        this.updateTotal();
        this.renderHands();
        this.renderDealer();
        this.updateControls();
        this.handleOutcome(payload.outcomes || [], payload.messages || []);
      } catch (err) {
        showCenterToast(err.message || "Split failed.", "danger");
      }
    });
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.resetRound(false);
    this.updateTotal();
    this.updateControls();
  }

  reset() {
    this.resetRound(false);
  }
}
