import {
  state,
  updateBalance,
  payout,
  playSfx,
  showCenterToast,
  renderCards,
  renderHiddenCards,
  revealDealer,
  buildDeck,
  shuffle,
  draw,
  makeChipStack,
  updateBetTotal,
  setStatus,
} from "./core.js";

function getPokerCardValue(card) {
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
}

function getWinningCardIndexes(cards, evaluation) {
  const values = cards.map((card) => getPokerCardValue(card));
  const counts = {};
  values.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
  });
  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (evaluation.rank >= 4) {
    return cards.map((_, idx) => idx);
  }
  if (evaluation.rank === 7) {
    const target = byCount.find((entry) => entry.count === 4)?.value;
    return values
      .map((value, idx) => (value === target ? idx : null))
      .filter((idx) => idx !== null);
  }
  if (evaluation.rank === 6) {
    return cards.map((_, idx) => idx);
  }
  if (evaluation.rank === 3) {
    const target = byCount.find((entry) => entry.count === 3)?.value;
    return values
      .map((value, idx) => (value === target ? idx : null))
      .filter((idx) => idx !== null);
  }
  if (evaluation.rank === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return values
      .map((value, idx) => (pairs.includes(value) ? idx : null))
      .filter((idx) => idx !== null);
  }
  if (evaluation.rank === 1) {
    const target = byCount.find((entry) => entry.count === 2)?.value;
    return values
      .map((value, idx) => (value === target ? idx : null))
      .filter((idx) => idx !== null);
  }
  const high = Math.max(...values);
  const highIndex = values.indexOf(high);
  return highIndex >= 0 ? [highIndex] : [];
}

function highlightPokerHand(containerId, cards, evaluation, className = "win") {
  const container = document.getElementById(containerId);
  if (!container) return;
  const indexes = getWinningCardIndexes(cards, evaluation);
  container.querySelectorAll(".card").forEach((cardEl, index) => {
    if (indexes.includes(index)) {
      cardEl.classList.add(className);
    } else {
      cardEl.classList.remove("win", "lose");
    }
  });
}

function pokerBetPhaseActive() {
  return (
    state.poker.phase === "bet1" ||
    state.poker.phase === "bet2" ||
    state.poker.phase === "bet3"
  );
}

function updatePokerDiscardLabel(drawBtn) {
  if (!state.poker.phase.startsWith("discard")) return;
  const btn = drawBtn || document.getElementById("pokerDraw");
  if (!btn) return;
  const count = state.poker.discards ? state.poker.discards.size : 0;
  btn.textContent = `Discard ${count}`;
}

function dealerRaisePercent(rank) {
  if (rank >= 6) return 0.8;
  if (rank >= 4) return 0.65;
  if (rank >= 2) return 0.5;
  if (rank >= 1) return 0.25;
  return 0;
}

function dealerDecision(betAmount, phase) {
  const evalHand = evaluateHand(state.poker.dealer);
  const raisePct = dealerRaisePercent(evalHand.rank);
  if (betAmount === 0) {
    if (raisePct > 0 && Math.random() > 0.35) {
      return { action: "raise", raisePct, evalHand };
    }
    return { action: "call", raisePct, evalHand };
  }
  if (phase !== "bet1" && evalHand.rank === 0 && Math.random() > 0.5) {
    return { action: "fold", raisePct, evalHand };
  }
  if (raisePct > 0 && Math.random() > 0.55) {
    return { action: "raise", raisePct, evalHand };
  }
  return { action: "call", raisePct, evalHand };
}

function setPokerPhase(phase, drawBtn) {
  state.poker.phase = phase;
  if (!drawBtn) return;
  if (phase === "bet1") drawBtn.textContent = "Bet";
  if (phase === "bet2") drawBtn.textContent = "Bet";
  if (phase === "bet3") drawBtn.textContent = "Bet";
  if (phase === "discard1") drawBtn.textContent = "Discard 0";
  if (phase === "discard2") drawBtn.textContent = "Discard 0";
}

function updatePokerUiForPhase() {
  const betRow = document.getElementById("pokerBetRow");
  const chips = document.getElementById("pokerChips");
  const bettingPanel = document.getElementById("pokerBettingPanel");
  const dealBtn = document.getElementById("pokerDeal");
  const drawBtn = document.getElementById("pokerDraw");
  const callRaiseBtn = document.getElementById("pokerCallRaise");
  const foldBtn = document.getElementById("pokerFold");
  const isBetting = pokerBetPhaseActive() || state.poker.awaitingRaise;
  const isDiscard = state.poker.phase === "discard1" || state.poker.phase === "discard2";

  if (betRow) betRow.classList.remove("hidden");
  if (bettingPanel) bettingPanel.classList.remove("hidden");
  if (chips) chips.classList.remove("hidden");
  if (chips)
    chips.classList.toggle(
      "hidden",
      (state.poker.inRound && !pokerBetPhaseActive()) || state.poker.awaitingClear
    );
  if (dealBtn) dealBtn.classList.toggle("hidden", state.poker.inRound || state.poker.awaitingClear);

  if (drawBtn) {
    drawBtn.classList.toggle(
      "hidden",
      state.poker.awaitingRaise || (!isBetting && !isDiscard)
    );
    if (pokerBetPhaseActive()) {
      const betValue = state.poker.betAmount > 0 ? state.poker.betAmount : 0;
      drawBtn.textContent = `Bet $${betValue}`;
    }
  }
  if (callRaiseBtn) {
    callRaiseBtn.classList.toggle("hidden", !state.poker.awaitingRaise);
  }
  if (foldBtn) {
    foldBtn.classList.toggle(
      "hidden",
      !state.poker.inRound || (!isBetting && !state.poker.awaitingRaise)
    );
  }
}

function endPokerRound(clearTableBtn, foldBtn) {
  state.poker.inRound = false;
  state.poker.awaitingClear = true;
  if (clearTableBtn) clearTableBtn.classList.remove("hidden");
  if (foldBtn) foldBtn.classList.add("hidden");
  const drawBtn = document.getElementById("pokerDraw");
  drawBtn?.classList.add("hidden");
}

function finalizePokerShowdown(clearTableBtn, foldBtn) {
  renderCards("pokerDealer", state.poker.dealer);
  revealDealer("pokerDealer");
  const playerEval = evaluateHand(state.poker.player);
  const dealerEval = evaluateHand(state.poker.dealer);
  const result = compareHands(playerEval, dealerEval);
  const playerResult = document.getElementById("pokerPlayerResult");
  const dealerResult = document.getElementById("pokerDealerResult");
  if (playerResult) playerResult.textContent = playerEval.label;
  if (dealerResult) dealerResult.textContent = dealerEval.label;
  if (result > 0) {
    highlightPokerHand("pokerPlayer", state.poker.player, playerEval, "win");
    highlightPokerHand("pokerDealer", state.poker.dealer, dealerEval, "lose");
  } else if (result < 0) {
    highlightPokerHand("pokerPlayer", state.poker.player, playerEval, "lose");
    highlightPokerHand("pokerDealer", state.poker.dealer, dealerEval, "win");
  } else {
    highlightPokerHand("pokerPlayer", state.poker.player, playerEval, "win");
    highlightPokerHand("pokerDealer", state.poker.dealer, dealerEval, "win");
  }
  if (result > 0) {
    payout(state.poker.pot);
    playSfx("win");
    showCenterToast(
      `You win with ${playerEval.label}! Dealer had ${dealerEval.label}.`,
      "win",
      4500
    );
  } else if (result < 0) {
    playSfx("lose");
    showCenterToast(
      `Dealer wins with ${dealerEval.label}. You had ${playerEval.label}.`,
      "danger",
      4500
    );
  } else {
    payout(state.poker.playerPaid);
    playSfx("win");
    showCenterToast(`Push! Both had ${playerEval.label}.`, "win", 4500);
  }
  endPokerRound(clearTableBtn, foldBtn);
}

function evaluateHand(cards) {
  const values = cards.map(getPokerCardValue).sort((a, b) => a - b);
  const counts = {};
  const suitsCount = {};
  cards.forEach((card) => {
    const value = getPokerCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
    suitsCount[card.suit] = (suitsCount[card.suit] || 0) + 1;
  });

  const uniqueValues = Object.keys(counts).map(Number);
  const isFlush = Object.values(suitsCount).some((count) => count === 5);
  const isWheel = values.toString() === "2,3,4,5,14";
  const isStraight = values.every(
    (value, index) => (index === 0 ? true : value === values[index - 1] + 1)
  ) || isWheel;
  const straightValues = isWheel ? [5, 4, 3, 2, 1] : [...values];

  const sortedCounts = Object.values(counts).sort((a, b) => b - a);

  const valueLabel = (value) => {
    if (value === 14) return "Aces";
    if (value === 13) return "Kings";
    if (value === 12) return "Queens";
    if (value === 11) return "Jacks";
    return `${value}s`;
  };
  const byCount = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (isStraight && isFlush)
    return { rank: 8, label: "Straight Flush", values: straightValues };
  if (sortedCounts[0] === 4) {
    const quad = byCount.find((entry) => entry.count === 4)?.value;
    return { rank: 7, label: `Four of a Kind (${valueLabel(quad)})`, values };
  }
  if (sortedCounts[0] === 3 && sortedCounts[1] === 2) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return {
      rank: 6,
      label: `Full House (${valueLabel(trips)} over ${valueLabel(pair)})`,
      values,
    };
  }
  if (isFlush) return { rank: 5, label: "Flush", values };
  if (isStraight) return { rank: 4, label: "Straight", values: straightValues };
  if (sortedCounts[0] === 3) {
    const trips = byCount.find((entry) => entry.count === 3)?.value;
    return { rank: 3, label: `Three of a Kind (${valueLabel(trips)})`, values };
  }
  if (sortedCounts[0] === 2 && sortedCounts[1] === 2) {
    const pairs = byCount.filter((entry) => entry.count === 2).map((entry) => entry.value);
    return {
      rank: 2,
      label: `Two Pair (${valueLabel(pairs[0])} & ${valueLabel(pairs[1])})`,
      values,
    };
  }
  if (sortedCounts[0] === 2) {
    const pair = byCount.find((entry) => entry.count === 2)?.value;
    return { rank: 1, label: `Pair of ${valueLabel(pair)}`, values };
  }
  return { rank: 0, label: `High Card`, values };
}

function compareHands(player, dealer) {
  if (player.rank !== dealer.rank) {
    return player.rank > dealer.rank ? 1 : -1;
  }
  const dVals = [...dealer.values].sort((a, b) => b - a);
  const pVals = [...player.values].sort((a, b) => b - a);
  for (let i = 0; i < pVals.length; i += 1) {
    if (pVals[i] !== dVals[i]) {
      return pVals[i] > dVals[i] ? 1 : -1;
    }
  }
  return 0;
}

function dealerPokerDraw(hand, deck) {
  const evaluation = evaluateHand(hand);
  const rank = evaluation.rank;
  const counts = {};
  hand.forEach((card) => {
    const value = getPokerCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
  });

  let keepRanks = new Set();
  if (rank >= 4) {
    return { hand, discarded: 0 };
  }
  if (rank === 3) {
    Object.entries(counts).forEach(([value, count]) => {
      if (count === 3) keepRanks.add(Number(value));
    });
  } else if (rank === 2) {
    Object.entries(counts).forEach(([value, count]) => {
      if (count === 2) keepRanks.add(Number(value));
    });
  } else if (rank === 1) {
    Object.entries(counts).forEach(([value, count]) => {
      if (count === 2) keepRanks.add(Number(value));
    });
  } else {
    const high = Math.max(...hand.map((card) => getPokerCardValue(card)));
    keepRanks.add(high);
  }

  let discarded = 0;
  const nextHand = hand.map((card) => {
    const value = getPokerCardValue(card);
    if (keepRanks.has(value)) return card;
    discarded += 1;
    return draw(deck);
  });

  return { hand: nextHand, discarded };
}

function skipPokerBettingIfBroke(drawBtn, clearTableBtn, foldBtn, delayToast = 0) {
  if (!state.poker.inRound) return false;
  if (!state.poker.phase.startsWith("bet")) return false;
  if (state.balance > 0) return false;

  const drawButton = document.getElementById("pokerDraw");
  drawButton?.classList.add("hidden");
  const showToast = () => {
    showCenterToast("No credits left. Skipping betting.", "danger", 2200);
  };
  if (delayToast > 0) {
    setTimeout(showToast, delayToast);
  } else {
    showToast();
  }

  const nextPhase =
    state.poker.phase === "bet1"
      ? "discard1"
      : state.poker.phase === "bet2"
        ? "discard2"
        : "reveal";

  if (nextPhase === "reveal") {
    if (delayToast > 0) {
      state.poker.phase = "reveal";
      updatePokerUiForPhase();
      setTimeout(() => {
        finalizePokerShowdown(clearTableBtn, foldBtn);
        updatePokerUiForPhase();
      }, delayToast);
      return true;
    }
    finalizePokerShowdown(clearTableBtn, foldBtn);
    updatePokerUiForPhase();
    return true;
  }

  setPokerPhase(nextPhase, drawBtn);
  state.poker.canDiscard = true;
  state.poker.discards = new Set();
  renderPokerDiscards();
  updatePokerUiForPhase();
  return true;
}

function resetPokerRound() {
  state.poker.bet = 0;
  state.poker.betAmount = 0;
  state.poker.bet1 = 0;
  state.poker.bet2 = 0;
  state.poker.betRaise = 0;
  state.poker.pot = 0;
  state.poker.playerPaid = 0;
  state.poker.pendingCall = 0;
  state.poker.blind = 5;
  state.poker.drawRound = 0;
  state.poker.discards = new Set();
  state.poker.canDiscard = false;
  state.poker.awaitingClear = false;
  state.poker.awaitingRaise = false;
  state.poker.phase = "idle";
  state.poker.nextPhase = "";
  state.poker.deck = [];
  state.poker.player = [];
  state.poker.dealer = [];
  state.poker.inRound = false;
  document.getElementById("pokerPlayer").innerHTML = "";
  document.getElementById("pokerDealer").innerHTML = "";
  document.getElementById("pokerHolds").innerHTML = "";
  document.getElementById("pokerDraw").classList.add("hidden");
  document.getElementById("pokerClearTable")?.classList.add("hidden");
  const callRaiseBtn = document.getElementById("pokerCallRaise");
  callRaiseBtn?.classList.add("hidden");
  if (callRaiseBtn) callRaiseBtn.textContent = "Call Raise";
  document.getElementById("pokerFold")?.classList.add("hidden");
  document.getElementById("pokerDraw").textContent = "Draw";
  const playerResult = document.getElementById("pokerPlayerResult");
  const dealerResult = document.getElementById("pokerDealerResult");
  if (playerResult) playerResult.textContent = "";
  if (dealerResult) dealerResult.textContent = "";
  const betTotalEl = document.getElementById("pokerBetTotal");
  if (betTotalEl) updateBetTotal(state.poker.blind, "pokerBetTotal");
  makeChipStack(document.getElementById("pokerPotStack"), state.poker.blind);
  const betLabel = document.getElementById("pokerBetLabel");
  if (betLabel) betLabel.textContent = "Blind";
  setStatus("pokerStatus", "");
  updatePokerUiForPhase();
}

function renderPokerDiscards() {
  const handEl = document.getElementById("pokerPlayer");
  if (!handEl) return;
  handEl.querySelectorAll(".card").forEach((cardEl, index) => {
    cardEl.dataset.index = String(index);
    if (state.poker.discards.has(index)) {
      cardEl.classList.add("discard");
    } else {
      cardEl.classList.remove("discard");
    }
    if (!cardEl.dataset.bound) {
      cardEl.dataset.bound = "true";
      cardEl.addEventListener("click", () => {
        if (!state.poker.inRound || !state.poker.canDiscard) return;
        const idx = Number(cardEl.dataset.index);
        if (Number.isNaN(idx)) return;
        if (state.poker.discards.has(idx)) {
          state.poker.discards.delete(idx);
          cardEl.classList.remove("discard");
        } else {
          state.poker.discards.add(idx);
          cardEl.classList.add("discard");
        }
        updatePokerDiscardLabel();
        playSfx("hit");
      });
    }
  });
  updatePokerDiscardLabel();
}

export class PokerGame {
  init() {
    const dealBtn = document.getElementById("pokerDeal");
    const drawBtn = document.getElementById("pokerDraw");
    const clearTableBtn = document.getElementById("pokerClearTable");
    const callRaiseBtn = document.getElementById("pokerCallRaise");
    const foldBtn = document.getElementById("pokerFold");
    const pokerChips = document.querySelectorAll("#poker .chip");

    const updatePokerTotal = () => {
      const showPot = state.poker.inRound || state.poker.awaitingClear;
      const total = showPot ? state.poker.pot : state.poker.blind;
      const totalEl = document.getElementById("pokerBetTotal");
      if (totalEl) updateBetTotal(total, "pokerBetTotal");
      makeChipStack(document.getElementById("pokerPotStack"), total);
      const betLabel = document.getElementById("pokerBetLabel");
      if (betLabel) betLabel.textContent = showPot ? "Total Pot" : "Blind";
    };

    const addPokerBet = (amount) => {
      if (state.poker.inRound) {
        if (pokerBetPhaseActive()) {
          state.poker.betAmount = Math.min(
            state.balance,
            state.poker.betAmount + amount
          );
          updatePokerTotal();
          updatePokerUiForPhase();
          return;
        }
        showCenterToast("Betting is closed.", "danger");
        return;
      }
      state.poker.blind = state.poker.blind + amount;
      updatePokerTotal();
    };

    const removePokerBet = (amount) => {
      if (state.poker.inRound) {
        if (pokerBetPhaseActive()) {
          state.poker.betAmount = Math.max(0, state.poker.betAmount - amount);
          updatePokerTotal();
          updatePokerUiForPhase();
          return;
        }
        showCenterToast("Betting is closed.", "danger");
        return;
      }
      state.poker.blind = Math.max(1, state.poker.blind - amount);
      updatePokerTotal();
    };

    pokerChips.forEach((chip) => {
      if (chip.id === "pokerAllIn") {
        chip.addEventListener("click", () => {
          if (state.poker.inRound) {
            if (pokerBetPhaseActive()) {
              state.poker.betAmount = Math.max(1, state.balance);
              updatePokerTotal();
              updatePokerUiForPhase();
            } else {
              showCenterToast("Betting is closed.", "danger");
            }
            return;
          }
          state.poker.blind = Math.max(1, state.balance);
          updatePokerTotal();
        });
        return;
      }
      const amount = Number(chip.dataset.amount) || 0;
      chip.addEventListener("click", () => addPokerBet(amount));
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removePokerBet(amount);
      });
    });

    dealBtn?.addEventListener("click", () => {
      if (state.poker.inRound) {
        showCenterToast("Round already running.", "danger");
        return;
      }
      if (state.balance < state.poker.blind) {
        showCenterToast(`Need $${state.poker.blind} blind to deal.`, "danger");
        return;
      }
      const bet = state.poker.betAmount;
      state.poker.lastBet = bet;
      playSfx("deal");
      state.balance -= state.poker.blind;
      updateBalance();
      state.poker.bet = bet;
      state.poker.bet1 = bet;
      state.poker.bet2 = 0;
      state.poker.betRaise = 0;
      state.poker.pot = state.poker.blind * 2;
      state.poker.playerPaid = state.poker.blind;
      state.poker.betAmount = 0;
      state.poker.drawRound = 0;
      state.poker.awaitingClear = false;
      state.poker.awaitingRaise = false;
      state.poker.phase = "bet1";
      state.poker.nextPhase = "";
      state.poker.deck = shuffle(buildDeck());
      state.poker.player = [draw(state.poker.deck), draw(state.poker.deck), draw(state.poker.deck), draw(state.poker.deck), draw(state.poker.deck)];
      state.poker.dealer = [draw(state.poker.deck), draw(state.poker.deck), draw(state.poker.deck), draw(state.poker.deck), draw(state.poker.deck)];
      state.poker.inRound = true;
      drawBtn.classList.remove("hidden");
      setPokerPhase("bet1", drawBtn);
      showCenterToast("Place your bet.", "win", 2200);
      clearTableBtn?.classList.add("hidden");
      callRaiseBtn?.classList.add("hidden");
      foldBtn?.classList.remove("hidden");
      renderCards("pokerPlayer", state.poker.player);
      renderHiddenCards("pokerDealer", state.poker.dealer.length);
      const dealerDiscardEl = document.getElementById("pokerDealerDiscard");
      if (dealerDiscardEl) dealerDiscardEl.textContent = "";
      if (skipPokerBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;
      state.poker.discards = new Set();
      state.poker.canDiscard = false;
      renderPokerDiscards();
      updatePokerTotal();
      updatePokerUiForPhase();
    });

    drawBtn?.addEventListener("click", () => {
      if (!state.poker.inRound) {
        showCenterToast("Deal first.", "danger");
        return;
      }
      if (state.poker.awaitingRaise) return;
      playSfx("hit");
      if (state.poker.phase.startsWith("bet")) {
        const prevPhase = state.poker.phase;
        state.poker.phase = "bet-resolving";
        updatePokerUiForPhase();
        const bet = state.poker.betAmount;
        state.poker.betAmount = 0;
        if (bet > 0) {
          if (bet > state.balance) {
            showCenterToast("Not enough credits.", "danger");
            state.poker.phase = prevPhase;
            updatePokerUiForPhase();
            return;
          }
          state.balance -= bet;
          updateBalance();
          state.poker.pot += bet;
          state.poker.playerPaid += bet;
        }
        updatePokerTotal();
        const { action, raisePct } = dealerDecision(bet, prevPhase);
        if (action === "fold") {
          payout(state.poker.pot);
          playSfx("win");
          showCenterToast("Dealer folds. You win!", "win", 4500);
          endPokerRound(clearTableBtn, foldBtn);
          updatePokerUiForPhase();
          return;
        }
        if (action === "raise") {
          const cap = Math.max(0, state.balance);
          const raiseAmount = Math.min(
            cap,
            Math.max(5, Math.round(state.poker.pot * raisePct))
          );
          if (raiseAmount <= 0) {
            setPokerPhase(
              prevPhase === "bet1"
                ? "discard1"
                : prevPhase === "bet2"
                  ? "discard2"
                  : "reveal",
              drawBtn
            );
            state.poker.canDiscard = state.poker.phase.startsWith("discard");
            state.poker.discards = new Set();
            renderPokerDiscards();
            updatePokerUiForPhase();
            return;
          }
          state.poker.betRaise = raiseAmount;
          state.poker.pendingCall = raiseAmount;
          state.poker.awaitingRaise = true;
          state.poker.nextPhase =
            prevPhase === "bet1"
              ? "discard1"
              : prevPhase === "bet2"
                ? "discard2"
                : "reveal";
          if (bet > 0) state.poker.pot += bet;
          state.poker.pot += raiseAmount;
          updatePokerTotal();
          callRaiseBtn?.classList.remove("hidden");
          foldBtn?.classList.remove("hidden");
          if (callRaiseBtn) callRaiseBtn.textContent = `Call $${raiseAmount}`;
          showCenterToast(`Dealer raises $${raiseAmount}. Call or fold.`, "danger", 4500);
          updatePokerUiForPhase();
          return;
        }
        if (bet > 0) {
          state.poker.pot += bet;
          updatePokerTotal();
        }
        const nextPhase =
          prevPhase === "bet1"
            ? "discard1"
            : prevPhase === "bet2"
              ? "discard2"
              : "reveal";
        if (nextPhase === "reveal") {
          finalizePokerShowdown(clearTableBtn, foldBtn);
          updatePokerUiForPhase();
          return;
        }
        setPokerPhase(nextPhase, drawBtn);
        if (nextPhase.startsWith("discard")) {
          showCenterToast("Click cards to discard.", "win", 2200);
        }
        if (skipPokerBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;
        state.poker.canDiscard = true;
        state.poker.discards = new Set();
        renderPokerDiscards();
        updatePokerUiForPhase();
        return;
      }

      if (state.poker.phase.startsWith("discard")) {
        const discardIndexes = state.poker.discards || new Set();
        state.poker.player = state.poker.player.map((card, index) =>
          discardIndexes.has(index) ? draw(state.poker.deck) : card
        );
        const dealerResult = dealerPokerDraw(state.poker.dealer, state.poker.deck);
        state.poker.dealer = dealerResult.hand;
        showCenterToast(`Dealer discarded ${dealerResult.discarded} cards.`, "win", 2000);
        renderCards("pokerPlayer", state.poker.player);
        document.getElementById("pokerHolds").innerHTML = "";
        state.poker.canDiscard = false;
        const nextPhase = state.poker.phase === "discard1" ? "bet2" : "bet3";
        if (nextPhase.startsWith("bet") && state.balance <= 0) {
          state.poker.phase = nextPhase;
          if (skipPokerBettingIfBroke(drawBtn, clearTableBtn, foldBtn, 2200)) return;
        }
        setPokerPhase(nextPhase, drawBtn);
        if (nextPhase.startsWith("discard")) {
          showCenterToast("Click cards to discard.", "win", 2200);
        }
        if (skipPokerBettingIfBroke(drawBtn, clearTableBtn, foldBtn, 2200)) return;
        updatePokerUiForPhase();
        return;
      }
    });

    callRaiseBtn?.addEventListener("click", () => {
      if (!state.poker.awaitingRaise) return;
      const raiseAmount = state.poker.pendingCall;
      if (raiseAmount > state.balance) {
        showCenterToast("Not enough credits to call.", "danger");
        return;
      }
      state.balance -= raiseAmount;
      updateBalance();
      state.poker.awaitingRaise = false;
      state.poker.pendingCall = 0;
      state.poker.playerPaid += raiseAmount;
      state.poker.pot += raiseAmount;
      callRaiseBtn.classList.add("hidden");
      callRaiseBtn.textContent = "Call Raise";
      foldBtn?.classList.add("hidden");
      updatePokerTotal();
      const next = state.poker.nextPhase;
      state.poker.nextPhase = "";
      if (next === "reveal") {
        finalizePokerShowdown(clearTableBtn, foldBtn);
        updatePokerUiForPhase();
        return;
      }
      if (next) {
        setPokerPhase(next, drawBtn);
        if (next.startsWith("discard")) {
          state.poker.canDiscard = true;
          state.poker.discards = new Set();
          renderPokerDiscards();
          showCenterToast("Click cards to discard.", "win", 2200);
        } else {
          state.poker.canDiscard = false;
        }
        updatePokerUiForPhase();
      }
    });

    foldBtn?.addEventListener("click", () => {
      if (!state.poker.inRound) return;
      state.poker.awaitingRaise = false;
      state.poker.nextPhase = "";
      state.poker.pendingCall = 0;
      showCenterToast("You folded. Dealer wins.", "danger", 4500);
      callRaiseBtn?.classList.add("hidden");
      foldBtn.classList.add("hidden");
      endPokerRound(clearTableBtn, foldBtn);
      updatePokerUiForPhase();
    });

    clearTableBtn?.addEventListener("click", () => {
      if (!state.poker.awaitingClear) return;
      resetPokerRound();
      clearTableBtn.classList.add("hidden");
      callRaiseBtn?.classList.add("hidden");
      foldBtn?.classList.add("hidden");
      updatePokerUiForPhase();
    });

    resetPokerRound();
    updatePokerTotal();
  }

  reset() {
    resetPokerRound();
  }
}
