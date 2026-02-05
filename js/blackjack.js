import {
  state,
  updateBalance,
  updateBetTotal,
  payout,
  playSfx,
  showCenterToast,
  showCenterToasts,
  renderCards,
  revealDealer,
  buildDeck,
  shuffle,
  draw,
  handTotal,
  makeChipStack,
  bindBetChips,
} from "./core.js";

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

  finishRound() {
    const { autoBet, dealBtn } = this.ui;
    const dealerTotal = handTotal(state.blackjack.dealer);
    renderCards("bjDealer", state.blackjack.dealer);
    revealDealer("bjDealer");
    if (this.ui.dealerTotal) this.ui.dealerTotal.textContent = `Total: ${dealerTotal}`;

    const outcomeQueue = [];
    const pending = state.blackjack.pendingMessages || [];
    state.blackjack.hands.forEach((hand, index) => {
      if (state.blackjack.busted[index]) return;
      const playerTotal = handTotal(hand);
      const bet = state.blackjack.bets[index];
      const multiple = state.blackjack.hands.length > 1;
      const labelPrefix = multiple ? `Hand ${index + 1} ` : "";
      if (playerTotal > 21) {
        playSfx("lose");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}busts.` : "You bust.",
          tone: "danger",
        });
      } else if (dealerTotal > 21 || playerTotal > dealerTotal) {
        payout(bet * 2);
        playSfx("win");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}wins!` : "You win!",
          tone: "win",
        });
      } else if (dealerTotal === playerTotal) {
        payout(bet);
        playSfx("win");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}pushes.` : "Push.",
          tone: "win",
        });
      } else {
        playSfx("lose");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}loses.` : "You lose.",
          tone: "danger",
        });
      }
    });

    const combinedMessages = [...pending, ...outcomeQueue];
    if (combinedMessages.length > 0) showCenterToasts(combinedMessages);
    state.blackjack.pendingMessages = [];

    state.blackjack.inRound = false;
    state.blackjack.awaitingClear = true;
    const auto = autoBet?.checked;
    if (!auto) {
      state.blackjack.betAmount = 0;
      updateBetTotal(0, "bjBetTotal");
    } else {
      this.updateTotal();
    }
    this.updateControls();
    setTimeout(() => {
      this.resetRound(auto);
      this.updateControls();
      if (auto) dealBtn?.click();
      else this.scheduleAutoBet();
    }, ROUND_RESET_DELAY);
  }

  advanceHandOrDealer() {
    if (state.blackjack.activeHand < state.blackjack.hands.length - 1) {
      state.blackjack.activeHand += 1;
      this.renderHands();
      this.updateControls();
      return;
    }
    const allBusted = state.blackjack.hands.every(
      (hand, index) => state.blackjack.busted[index] || handTotal(hand) > 21
    );
    if (!allBusted) {
      while (handTotal(state.blackjack.dealer) < 17) {
        state.blackjack.dealer.push(draw(state.blackjack.deck));
      }
    }
    this.finishRound();
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
      canBet: () => !state.blackjack.inRound,
      getBalance: () => Math.min(state.balance, MAX_BET),
      getBetAmount: () => state.blackjack.betAmount,
      setBetAmount: (amount) => {
        if (amount === state.blackjack.betAmount && amount === MAX_BET) {
          showCenterToast("Max bet is $100.", "danger");
        }
        state.blackjack.betAmount = amount;
      },
      onUpdate: () => this.updateTotal(),
      onHit: () => playSfx("hit"),
      onClosed: () => showCenterToast("Round running.", "danger"),
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

    dealBtn?.addEventListener("click", () => {
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
      state.balance -= bet;
      updateBalance();
      state.blackjack.bet = bet;
      state.blackjack.deck = shuffle(buildDeck());
      state.blackjack.hands = [[draw(state.blackjack.deck), draw(state.blackjack.deck)]];
      state.blackjack.bets = [bet];
      state.blackjack.doubled = [false];
      state.blackjack.busted = [false];
      state.blackjack.pendingMessages = [];
      state.blackjack.activeHand = 0;
      state.blackjack.splitUsed = false;
      state.blackjack.dealer = [draw(state.blackjack.deck), draw(state.blackjack.deck)];
      state.blackjack.inRound = true;
      state.blackjack.revealDealer = false;
      this.renderHands();
      renderCards("bjDealer", state.blackjack.dealer, true);
      if (this.ui.dealerTotal) this.ui.dealerTotal.textContent = "Total: ?";
      this.updateControls();
      this.updateTotal();
    });

    hitBtn?.addEventListener("click", () => {
      if (!state.blackjack.inRound) return;
      const hand = state.blackjack.hands[state.blackjack.activeHand];
      hand.push(draw(state.blackjack.deck));
      this.renderHands();
      const total = handTotal(hand);
      if (total > 21) {
        const multiple = state.blackjack.hands.length > 1;
        const message = multiple
          ? `Hand ${state.blackjack.activeHand + 1} busts.`
          : "You bust.";
        playSfx("lose");
        if (state.blackjack.activeHand === state.blackjack.hands.length - 1) {
          state.blackjack.pendingMessages.push({ text: message, tone: "danger" });
        } else {
          showCenterToast(message, "danger");
        }
        state.blackjack.busted[state.blackjack.activeHand] = true;
        this.advanceHandOrDealer();
      }
      this.updateControls();
    });

    standBtn?.addEventListener("click", () => {
      if (!state.blackjack.inRound) return;
      this.advanceHandOrDealer();
      this.updateControls();
    });

    doubleBtn?.addEventListener("click", () => {
      if (!state.blackjack.inRound) return;
      const hand = state.blackjack.hands[state.blackjack.activeHand];
      if (hand.length !== 2) return;
      const bet = state.blackjack.bets[state.blackjack.activeHand];
      if (bet > state.balance) {
        showCenterToast("Not enough credits to double.", "danger");
        return;
      }
      state.balance -= bet;
      updateBalance();
      state.blackjack.bets[state.blackjack.activeHand] = bet * 2;
      state.blackjack.doubled[state.blackjack.activeHand] = true;
      hand.push(draw(state.blackjack.deck));
      this.renderHands();
      this.advanceHandOrDealer();
      this.updateControls();
      this.updateTotal();
    });

    splitBtn?.addEventListener("click", () => {
      if (!state.blackjack.inRound || state.blackjack.splitUsed) return;
      const hand = state.blackjack.hands[state.blackjack.activeHand];
      if (hand.length !== 2 || hand[0].rank !== hand[1].rank) return;
      const bet = state.blackjack.bets[state.blackjack.activeHand];
      if (bet > state.balance) {
        showCenterToast("Not enough credits to split.", "danger");
        return;
      }
      state.balance -= bet;
      updateBalance();
      const cardA = hand[0];
      const cardB = hand[1];
      state.blackjack.hands = [
        [cardA, draw(state.blackjack.deck)],
        [cardB, draw(state.blackjack.deck)],
      ];
      state.blackjack.bets = [bet, bet];
      state.blackjack.doubled = [false, false];
      state.blackjack.busted = [false, false];
      state.blackjack.pendingMessages = [];
      state.blackjack.activeHand = 0;
      state.blackjack.splitUsed = true;
      this.updateTotal();
      this.renderHands();
      this.updateControls();
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
