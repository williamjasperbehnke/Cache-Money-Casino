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
  setStatus,
} from "./core.js";

function resetBlackjackRound(keepBet = false) {
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
  document.getElementById("bjHit").classList.add("hidden");
  document.getElementById("bjStand").classList.add("hidden");
  document.getElementById("bjDouble").classList.add("hidden");
  document.getElementById("bjSplit").classList.add("hidden");
  document.getElementById("bjDealer").innerHTML = "";
  document.getElementById("bjPlayer").innerHTML = "";
  document.getElementById("bjDealerTotal").textContent = "";
  document.getElementById("bjPlayerTotal").textContent = "";
  setStatus("bjStatus", "");
  if (keepBet) {
    updateBetTotal(state.blackjack.betAmount, "bjBetTotal");
  }
}

export class BlackjackGame {
  init() {
    const dealBtn = document.getElementById("bjDeal");
    const hitBtn = document.getElementById("bjHit");
    const standBtn = document.getElementById("bjStand");
    const doubleBtn = document.getElementById("bjDouble");
    const splitBtn = document.getElementById("bjSplit");
    const clearBtn = document.getElementById("bjClear");
    const maxBtn = document.getElementById("bjMax");
    const bjChips = document.querySelectorAll('#blackjack .chip');
    const autoBet = document.getElementById("bjAuto");

    const updateBjTotal = () => {
      const total =
        state.blackjack.inRound && state.blackjack.bets.length > 0
          ? state.blackjack.bets.reduce((sum, val) => sum + val, 0)
          : state.blackjack.betAmount;
      updateBetTotal(total, "bjBetTotal");
    };

    const syncBetTotal = () => {
      updateBjTotal();
    };

    const scheduleAutoBet = () => {
      if (!autoBet?.checked || state.blackjack.lastBet <= 0) return;
      setTimeout(() => {
        if (state.blackjack.inRound) return;
        state.blackjack.betAmount = state.blackjack.lastBet;
        updateBjTotal();
        dealBtn.click();
      }, 200);
    };

    const renderBlackjackHands = () => {
      const playerEl = document.getElementById("bjPlayer");
      playerEl.innerHTML = "";
      const showLabels = state.blackjack.hands.length > 1;
      state.blackjack.hands.forEach((hand, index) => {
        const wrapper = document.createElement("div");
        wrapper.className = showLabels ? "hand-block" : "hand-block single";
        if (index === state.blackjack.activeHand) {
          wrapper.classList.add("active-hand");
        }
        if (showLabels) {
          const label = document.createElement("div");
          label.className = "hand-label";
          label.textContent = `Hand ${index + 1}`;
          wrapper.appendChild(label);
        }
        const cardsEl = document.createElement("div");
        cardsEl.className = "cards";
        hand.forEach((card) => {
          const div = document.createElement("div");
          div.className = "card";
          div.textContent = `${card.rank}${card.suit}`;
          div.setAttribute("data-rank", `${card.rank}${card.suit}`);
          if (card.suit === "♥" || card.suit === "♦") {
            div.classList.add("red");
          } else {
            div.classList.add("black");
          }
          cardsEl.appendChild(div);
        });
        const totalEl = document.createElement("div");
        totalEl.className = "total";
        totalEl.textContent = `Total: ${handTotal(hand)}`;
        const stackEl = document.createElement("div");
        stackEl.className = "chip-stack inline hand-stack";
        const betValue = state.blackjack.bets[index] || 0;
        makeChipStack(stackEl, betValue);
        wrapper.appendChild(cardsEl);
        wrapper.appendChild(totalEl);
        wrapper.appendChild(stackEl);
        playerEl.appendChild(wrapper);
      });
    };

    const updateBlackjackControls = () => {
      const chips = document.querySelector('#blackjack .chips');
      if (!state.blackjack.inRound) {
        hitBtn.classList.add("hidden");
        standBtn.classList.add("hidden");
        doubleBtn.classList.add("hidden");
        splitBtn.classList.add("hidden");
        dealBtn.classList.remove("hidden");
        clearBtn.classList.remove("hidden");
        maxBtn.classList.remove("hidden");
        if (!state.blackjack.awaitingClear) {
          chips?.classList.remove("hidden");
        } else {
          chips?.classList.add("hidden");
        }
        return;
      }
      dealBtn.classList.add("hidden");
      clearBtn.classList.add("hidden");
      maxBtn.classList.add("hidden");
      chips?.classList.add("hidden");
      hitBtn.classList.remove("hidden");
      standBtn.classList.remove("hidden");
      const hand = state.blackjack.hands[state.blackjack.activeHand] || [];
      const canDouble = hand.length === 2 && !state.blackjack.doubled[state.blackjack.activeHand];
      if (canDouble) doubleBtn.classList.remove("hidden");
      else doubleBtn.classList.add("hidden");
      const canSplit =
        !state.blackjack.splitUsed &&
        hand.length === 2 &&
        hand[0].rank === hand[1].rank;
      if (canSplit) splitBtn.classList.remove("hidden");
      else splitBtn.classList.add("hidden");
    };

    const advanceHandOrDealer = () => {
      if (state.blackjack.activeHand < state.blackjack.hands.length - 1) {
        state.blackjack.activeHand += 1;
        renderBlackjackHands();
        updateBlackjackControls();
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
      const dealerTotal = handTotal(state.blackjack.dealer);
      renderCards("bjDealer", state.blackjack.dealer);
      revealDealer("bjDealer");
      document.getElementById("bjDealerTotal").textContent = `Total: ${dealerTotal}`;

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
      if (combinedMessages.length > 0) {
        showCenterToasts(combinedMessages);
      }
      state.blackjack.pendingMessages = [];

      state.blackjack.inRound = false;
      state.blackjack.awaitingClear = true;
      const auto = autoBet?.checked;
      if (!auto) {
        state.blackjack.betAmount = 0;
        updateBetTotal(0, "bjBetTotal");
      } else {
        syncBetTotal();
      }
      updateBlackjackControls();
      setTimeout(() => {
        resetBlackjackRound(auto);
        updateBlackjackControls();
        if (auto) {
          dealBtn.click();
        } else {
          scheduleAutoBet();
        }
      }, 1800);
    };

    const addBjBet = (amount) => {
      if (state.blackjack.inRound) {
        showCenterToast("Round running.", "danger");
        return;
      }
      const next = Math.min(100, state.blackjack.betAmount + amount);
      if (next === state.blackjack.betAmount) {
        showCenterToast("Max bet is $100.", "danger");
        return;
      }
      state.blackjack.betAmount = next;
      updateBjTotal();
    };

    const removeBjBet = (amount) => {
      if (state.blackjack.inRound) {
        showCenterToast("Round running.", "danger");
        return;
      }
      state.blackjack.betAmount = Math.max(0, state.blackjack.betAmount - amount);
      updateBjTotal();
    };

    bjChips.forEach((chip) => {
      const amount = Number(chip.dataset.amount) || 0;
      chip.addEventListener("click", () => addBjBet(amount));
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removeBjBet(amount);
      });
    });

    clearBtn?.addEventListener("click", () => {
      if (state.blackjack.inRound) {
        showCenterToast("Round running.", "danger");
        return;
      }
      state.blackjack.betAmount = 0;
      updateBjTotal();
    });

    maxBtn?.addEventListener("click", () => {
      if (state.blackjack.inRound) {
        showCenterToast("Round running.", "danger");
        return;
      }
      state.blackjack.betAmount = Math.min(100, state.balance);
      updateBjTotal();
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
      renderBlackjackHands();
      renderCards("bjDealer", state.blackjack.dealer, true);
      document.getElementById("bjDealerTotal").textContent = "Total: ?";
      updateBlackjackControls();
      syncBetTotal();
    });

    hitBtn?.addEventListener("click", () => {
      if (!state.blackjack.inRound) return;
      const hand = state.blackjack.hands[state.blackjack.activeHand];
      hand.push(draw(state.blackjack.deck));
      renderBlackjackHands();
      const total = handTotal(hand);
      if (total > 21) {
        const multiple = state.blackjack.hands.length > 1;
        const message = multiple
          ? `Hand ${state.blackjack.activeHand + 1} busts.`
          : "You bust.";
        if (state.blackjack.activeHand === state.blackjack.hands.length - 1) {
          playSfx("lose");
          state.blackjack.pendingMessages.push({ text: message, tone: "danger" });
        } else {
          playSfx("lose");
          showCenterToast(message, "danger");
        }
        state.blackjack.busted[state.blackjack.activeHand] = true;
        advanceHandOrDealer();
      }
      updateBlackjackControls();
    });

    standBtn?.addEventListener("click", () => {
      if (!state.blackjack.inRound) return;
      advanceHandOrDealer();
      updateBlackjackControls();
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
      renderBlackjackHands();
      advanceHandOrDealer();
      updateBlackjackControls();
      syncBetTotal();
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
      syncBetTotal();
      renderBlackjackHands();
      updateBlackjackControls();
    });

    resetBlackjackRound(false);
    updateBjTotal();
    updateBlackjackControls();
  }

  reset() {
    resetBlackjackRound(false);
    setStatus("bjStatus", "");
  }
}
