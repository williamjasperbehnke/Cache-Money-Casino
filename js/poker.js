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
  bindBetChips,
} from "./core.js";

const BET_PHASES = new Set(["bet1", "bet2", "bet3"]);
const DISCARD_PHASES = new Set(["discard1", "discard2"]);

class Dealer {
  raisePercent(rank) {
    if (rank >= 6) return 0.8;
    if (rank >= 4) return 0.65;
    if (rank >= 2) return 0.5;
    if (rank >= 1) return 0.25;
    return 0;
  }

  decideAction(hand, betAmount, phase) {
    const evalHand = PokerGame.evaluateHand(hand);
    const raisePct = this.raisePercent(evalHand.rank);
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

  draw(hand, deck) {
    const evaluation = PokerGame.evaluateHand(hand);
    const rank = evaluation.rank;
    const counts = {};
    hand.forEach((card) => {
      const value = card.value();
      counts[value] = (counts[value] || 0) + 1;
    });

    const keepRanks = new Set();
    if (rank >= 4) {
      return { hand, discarded: 0 };
    }
    if (rank === 3 || rank === 2 || rank === 1) {
      const keepCount = rank === 3 ? 3 : 2;
      Object.entries(counts).forEach(([value, count]) => {
        if (count === keepCount) keepRanks.add(Number(value));
      });
    } else {
      const high = Math.max(...hand.map((card) => card.value()));
      keepRanks.add(high);
    }

    let discarded = 0;
    const nextHand = hand.map((card) => {
      const value = card.value();
      if (keepRanks.has(value)) return card;
      discarded += 1;
      return draw(deck);
    });

    return { hand: nextHand, discarded };
  }
}

export class PokerGame {
  static getWinningCardIndexes(cards, evaluation) {
    const values = cards.map((card) => card.value());
    const counts = {};
    values.forEach((value) => {
      counts[value] = (counts[value] || 0) + 1;
    });
    const byCount = Object.entries(counts)
      .map(([value, count]) => ({ value: Number(value), count }))
      .sort((a, b) => b.count - a.count || b.value - a.value);

    if (evaluation.rank >= 4) return cards.map((_, idx) => idx);
    if (evaluation.rank === 7) {
      const target = byCount.find((entry) => entry.count === 4)?.value;
      return values
        .map((value, idx) => (value === target ? idx : null))
        .filter((idx) => idx !== null);
    }
    if (evaluation.rank === 6) return cards.map((_, idx) => idx);
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

  static highlightHand(containerId, cards, evaluation, className = "win") {
    const container = document.getElementById(containerId);
    if (!container) return;
    const indexes = PokerGame.getWinningCardIndexes(cards, evaluation);
    container.querySelectorAll(".card").forEach((cardEl, index) => {
      if (indexes.includes(index)) {
        cardEl.classList.add(className);
      } else {
        cardEl.classList.remove("win", "lose");
      }
    });
  }

  static evaluateHand(cards) {
    const values = cards.map((card) => card.value()).sort((a, b) => a - b);
    const counts = {};
    const suitsCount = {};
    cards.forEach((card) => {
      const value = card.value();
      counts[value] = (counts[value] || 0) + 1;
      suitsCount[card.suit] = (suitsCount[card.suit] || 0) + 1;
    });

    const isFlush = Object.values(suitsCount).some((count) => count === 5);
    const isWheel = values.toString() === "2,3,4,5,14";
    const isStraight =
      values.every((value, index) => (index === 0 ? true : value === values[index - 1] + 1)) ||
      isWheel;
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

    if (isStraight && isFlush) return { rank: 8, label: "Straight Flush", values: straightValues };
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
    return { rank: 0, label: "High Card", values };
  }

  static compareHands(player, dealer) {
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

  constructor() {
    this.dealer = new Dealer();
    this.handleCardClick = this.handleCardClick.bind(this);
  }

  schedulePhaseToast(phase, delay, message, tone, duration) {
    const fire = () => {
      if (!state.poker.inRound) return;
      if (state.poker.phase !== phase) return;
      showCenterToast(message, tone, duration);
    };
    if (delay) setTimeout(fire, delay);
    else fire();
  }

  betPhaseActive() {
    return BET_PHASES.has(state.poker.phase);
  }

  discardPhaseActive() {
    return DISCARD_PHASES.has(state.poker.phase);
  }

  updateDiscardLabel(drawBtn) {
    if (!this.discardPhaseActive()) return;
    const btn = drawBtn || document.getElementById("pokerDraw");
    if (!btn) return;
    const count = state.poker.discards ? state.poker.discards.size : 0;
    btn.textContent = `Discard ${count}`;
  }

  setPhase(phase, drawBtn) {
    state.poker.phase = phase;
    if (!drawBtn) return;
    if (BET_PHASES.has(phase)) drawBtn.textContent = "Bet";
    if (phase === "discard1" || phase === "discard2") drawBtn.textContent = "Discard 0";
  }

  updateUiForPhase() {
    const betRow = document.getElementById("pokerBetRow");
    const chips = document.getElementById("pokerChips");
    const bettingPanel = document.getElementById("pokerBettingPanel");
    const dealBtn = document.getElementById("pokerDeal");
    const drawBtn = document.getElementById("pokerDraw");
    const callRaiseBtn = document.getElementById("pokerCallRaise");
    const foldBtn = document.getElementById("pokerFold");
    const clearBetBtn = document.getElementById("pokerClearBet");
    const clearTableBtn = document.getElementById("pokerClearTable");
    const isBetting = this.betPhaseActive() || state.poker.awaitingRaise;
    const isDiscard = this.discardPhaseActive();

    if (dealBtn) {
      dealBtn.classList.toggle(
        "hidden",
        state.poker.inRound && state.poker.phase !== "reveal"
      );
      if (state.poker.phase === "reveal") dealBtn.classList.add("hidden");
    }
    if (bettingPanel)
      bettingPanel.classList.toggle("hidden", !state.poker.inRound && !state.poker.awaitingClear);
    if (betRow) betRow.classList.toggle("hidden", false);
    if (clearTableBtn)
      clearTableBtn.classList.toggle("hidden", !state.poker.awaitingClear);
    if (chips) {
      chips.classList.toggle("hidden", !isBetting);
      chips.querySelectorAll(".chip").forEach((chip) => {
        if (isBetting) chip.removeAttribute("disabled");
        else chip.setAttribute("disabled", "disabled");
      });
    }
    if (drawBtn) {
      drawBtn.classList.toggle("hidden", state.poker.awaitingRaise || (!isBetting && !isDiscard));
      if (this.betPhaseActive()) {
        const betValue = state.poker.betAmount > 0 ? state.poker.betAmount : 0;
        drawBtn.textContent = `Bet $${betValue}`;
      }
    }
    if (callRaiseBtn) callRaiseBtn.classList.toggle("hidden", !state.poker.awaitingRaise);
    if (foldBtn) foldBtn.classList.toggle("hidden", !state.poker.inRound);
    if (clearBetBtn)
      clearBetBtn.classList.toggle(
        "hidden",
        !this.betPhaseActive() || state.poker.awaitingRaise
      );

    this.updateDiscardLabel(drawBtn);
  }

  endRound(clearTableBtn, foldBtn) {
    state.poker.awaitingClear = true;
    state.poker.inRound = false;
    state.poker.awaitingRaise = false;
    state.poker.phase = "reveal";
    this.updateUiForPhase();
    clearTableBtn?.classList.remove("hidden");
    foldBtn?.classList.add("hidden");
  }

  finalizeShowdown(clearTableBtn, foldBtn) {
    const playerEval = PokerGame.evaluateHand(state.poker.player);
    const dealerEval = PokerGame.evaluateHand(state.poker.dealer);
    const result = PokerGame.compareHands(playerEval, dealerEval);
    const playerResult = document.getElementById("pokerPlayerResult");
    const dealerResult = document.getElementById("pokerDealerResult");

    if (playerResult) playerResult.textContent = `Player: ${playerEval.label}`;
    if (dealerResult) dealerResult.textContent = `Dealer: ${dealerEval.label}`;

    if (result > 0) {
      PokerGame.highlightHand("pokerPlayer", state.poker.player, playerEval, "win");
      PokerGame.highlightHand("pokerDealer", state.poker.dealer, dealerEval, "lose");
      payout(state.poker.pot + state.poker.playerPaid);
      playSfx("win");
      showCenterToast(
        `You win with ${playerEval.label}! Dealer had ${dealerEval.label}.`,
        "win",
        4500
      );
    } else if (result < 0) {
      PokerGame.highlightHand("pokerPlayer", state.poker.player, playerEval, "lose");
      PokerGame.highlightHand("pokerDealer", state.poker.dealer, dealerEval, "win");
      playSfx("lose");
      showCenterToast(
        `Dealer wins with ${dealerEval.label}. You had ${playerEval.label}.`,
        "danger",
        4500
      );
    } else {
      PokerGame.highlightHand("pokerPlayer", state.poker.player, playerEval, "win");
      PokerGame.highlightHand("pokerDealer", state.poker.dealer, dealerEval, "win");
      payout(state.poker.playerPaid);
      playSfx("win");
      showCenterToast(`Push! Both had ${playerEval.label}.`, "win", 4500);
    }
    this.endRound(clearTableBtn, foldBtn);
  }

  skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn, delayToast = 0) {
    if (!state.poker.inRound) return false;
    if (!state.poker.phase.startsWith("bet")) return false;
    if (state.balance > 0) return false;

    const drawButton = document.getElementById("pokerDraw");
    drawButton?.classList.add("hidden");

    const nextPhase =
      state.poker.phase === "bet1"
        ? "discard1"
        : state.poker.phase === "bet2"
          ? "discard2"
          : "reveal";
    state.poker.phase = nextPhase;
    this.updateUiForPhase();
    const skipDuration = 2200;
    this.schedulePhaseToast(
      nextPhase,
      delayToast,
      "No credits left. Skipping betting.",
      "danger",
      skipDuration
    );
    if (nextPhase === "reveal") {
      setTimeout(() => {
        if (!state.poker.inRound) return;
        if (state.poker.phase !== "reveal") return;
        revealDealer("pokerDealer");
        renderCards("pokerDealer", state.poker.dealer);
        this.finalizeShowdown(clearTableBtn, foldBtn);
      }, (delayToast || 0) + skipDuration);
      return true;
    }
    if (nextPhase.startsWith("discard")) {
      const discardDelay = (delayToast || 0) + skipDuration;
      this.schedulePhaseToast(nextPhase, discardDelay, "Click cards to discard.", "win", 2200);
    }
    if (state.poker.phase === "discard2") {
      state.poker.drawRound = 1;
    }
    if (state.poker.phase === "discard1" || state.poker.phase === "discard2") {
      state.poker.canDiscard = true;
      renderCards("pokerPlayer", state.poker.player);
      this.renderDiscards();
    }
    if (state.poker.phase === "bet2") {
      state.poker.drawRound = 1;
    }
    return true;
  }

  resetRound() {
    state.poker.bet = 0;
    state.poker.betAmount = 0;
    state.poker.bet1 = 0;
    state.poker.bet2 = 0;
    state.poker.betRaise = 0;
    state.poker.pot = state.poker.blind;
    state.poker.playerPaid = 0;
    state.poker.pendingCall = 0;
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
    const callRaiseBtn = document.getElementById("pokerCallRaise");
    callRaiseBtn?.classList.add("hidden");
    const playerResult = document.getElementById("pokerPlayerResult");
    const dealerResult = document.getElementById("pokerDealerResult");
    if (playerResult) playerResult.textContent = "";
    if (dealerResult) dealerResult.textContent = "";
    const betTotalEl = document.getElementById("pokerBetTotal");
    if (betTotalEl) updateBetTotal(state.poker.blind, "pokerBetTotal");
    const betLabel = document.getElementById("pokerBetLabel");
    if (betLabel) betLabel.textContent = state.poker.inRound ? "Total Pot" : "Blind";
    renderCards("pokerPlayer", []);
    renderCards("pokerDealer", []);
    this.renderDiscards();
  }

  renderDiscards() {
    const handEl = document.getElementById("pokerPlayer");
    if (!handEl) return;
    handEl.querySelectorAll(".card").forEach((cardEl, index) => {
      cardEl.dataset.index = index;
      if (state.poker.discards && state.poker.discards.has(index)) {
        cardEl.classList.add("discard");
      } else {
        cardEl.classList.remove("discard");
      }
    });
  }

  handleCardClick(event) {
    const target = event.target.closest(".card");
    if (!target) return;
    if (!state.poker.canDiscard) return;
    if (!state.poker.discards) state.poker.discards = new Set();
    const idx = Number(target.dataset.index);
    if (!Number.isFinite(idx)) return;
    if (state.poker.discards.has(idx)) {
      state.poker.discards.delete(idx);
    } else {
      state.poker.discards.add(idx);
    }
    playSfx("hit");
    this.updateDiscardLabel();
    this.renderDiscards();
  }

  init() {
    const dealBtn = document.getElementById("pokerDeal");
    const drawBtn = document.getElementById("pokerDraw");
    const clearBetBtn = document.getElementById("pokerClearBet");
    const clearTableBtn = document.getElementById("pokerClearTable");
    const callRaiseBtn = document.getElementById("pokerCallRaise");
    const foldBtn = document.getElementById("pokerFold");
    const pokerChips = document.querySelectorAll("#poker .chip");
    const playerHand = document.getElementById("pokerPlayer");

    playerHand?.addEventListener("click", this.handleCardClick);

    const updatePokerTotal = () => {
      const showPot = state.poker.inRound || state.poker.awaitingClear;
      const total = showPot ? state.poker.pot : state.poker.blind;
      const totalEl = document.getElementById("pokerBetTotal");
      if (totalEl) updateBetTotal(total, "pokerBetTotal");
      makeChipStack(document.getElementById("pokerPotStack"), total);
      const betLabel = document.getElementById("pokerBetLabel");
      if (betLabel) betLabel.textContent = state.poker.inRound ? "Total Pot" : "Blind";
    };

    const updatePokerTotalAfterBlind = () => {
      const total = state.poker.blind;
      const totalEl = document.getElementById("pokerBetTotal");
      if (totalEl) updateBetTotal(total, "pokerBetTotal");
      makeChipStack(document.getElementById("pokerPotStack"), total);
      const betLabel = document.getElementById("pokerBetLabel");
      if (betLabel) betLabel.textContent = state.poker.inRound ? "Total Pot" : "Blind";
    };

    bindBetChips({
      chips: pokerChips,
      canBet: () => this.betPhaseActive() && !state.poker.awaitingRaise,
      getBalance: () => state.balance,
      getBetAmount: () => state.poker.betAmount,
      setBetAmount: (amount) => {
        state.poker.betAmount = amount;
      },
      onUpdate: () => {
        updatePokerTotal();
        this.updateUiForPhase();
      },
      onHit: () => playSfx("hit"),
      onClosed: () => showCenterToast("Betting is closed.", "danger"),
    });

    clearBetBtn?.addEventListener("click", () => {
      if (!this.betPhaseActive() || state.poker.awaitingRaise) {
        showCenterToast("Betting is closed.", "danger");
        return;
      }
      state.poker.betAmount = 0;
      updatePokerTotal();
      this.updateUiForPhase();
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
      state.poker.player = [
        draw(state.poker.deck),
        draw(state.poker.deck),
        draw(state.poker.deck),
        draw(state.poker.deck),
        draw(state.poker.deck),
      ];
      state.poker.dealer = [
        draw(state.poker.deck),
        draw(state.poker.deck),
        draw(state.poker.deck),
        draw(state.poker.deck),
        draw(state.poker.deck),
      ];
      state.poker.inRound = true;
      drawBtn.classList.remove("hidden");
      this.setPhase("bet1", drawBtn);
      showCenterToast("Place your bet.", "win", 2200);
      clearTableBtn?.classList.add("hidden");
      callRaiseBtn?.classList.add("hidden");
      foldBtn?.classList.remove("hidden");
      renderCards("pokerPlayer", state.poker.player);
      renderHiddenCards("pokerDealer", state.poker.dealer.length);
      const dealerDiscardEl = document.getElementById("pokerDealerDiscard");
      if (dealerDiscardEl) dealerDiscardEl.textContent = "";
      if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;
      state.poker.discards = new Set();
      state.poker.canDiscard = false;
      this.renderDiscards();
      updatePokerTotal();
      this.updateUiForPhase();
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
        this.updateUiForPhase();
        const bet = state.poker.betAmount;
        state.poker.betAmount = 0;
        if (bet > 0) {
          if (bet > state.balance) {
            showCenterToast("Not enough credits.", "danger");
            state.poker.phase = prevPhase;
            this.updateUiForPhase();
            return;
          }
          state.balance -= bet;
          updateBalance();
          state.poker.bet += bet;
          state.poker.playerPaid += bet;
          state.poker.pot += bet;
          if (prevPhase === "bet1") state.poker.bet1 = bet;
          if (prevPhase === "bet2") state.poker.bet2 = bet;
          updatePokerTotal();
        }

        const nextPhase =
          prevPhase === "bet1"
            ? "discard1"
            : prevPhase === "bet2"
              ? "discard2"
              : "reveal";
        state.poker.nextPhase = nextPhase;

        const { action, raisePct } = this.dealer.decideAction(
          state.poker.dealer,
          bet,
          prevPhase
        );
        if (action === "fold") {
          payout(state.poker.pot);
          playSfx("win");
          showCenterToast("Dealer folds. You win!", "win", 4500);
          this.endRound(clearTableBtn, foldBtn);
          return;
        }
        if (action === "raise") {
          const cap = Math.max(0, state.balance);
          const raiseAmount = Math.min(cap, Math.max(5, Math.round(state.poker.pot * raisePct)));
          if (raiseAmount <= 0) {
            state.poker.pot += bet;
            updatePokerTotal();
            state.poker.nextPhase = "";
            this.setPhase(nextPhase, drawBtn);
            if (nextPhase.startsWith("discard")) {
              showCenterToast("Click cards to discard.", "win", 2200);
            }
            if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;
            if (nextPhase.startsWith("discard")) {
              state.poker.canDiscard = true;
              state.poker.discards = new Set();
              this.renderDiscards();
              updatePokerTotal();
              this.updateUiForPhase();
            }
            return;
          }
          state.poker.pendingCall = raiseAmount;
          state.poker.awaitingRaise = true;
          state.poker.betRaise = raiseAmount;
          state.poker.phase = prevPhase;
          this.updateUiForPhase();
          showCenterToast(`Dealer raises $${raiseAmount}. Call or fold.`, "danger", 4500);
          callRaiseBtn.textContent = `Call $${raiseAmount}`;
          return;
        }
        state.poker.pot += bet;
        updatePokerTotal();
        state.poker.nextPhase = "";
        this.setPhase(nextPhase, drawBtn);
        if (nextPhase.startsWith("discard")) {
          showCenterToast("Click cards to discard.", "win", 2200);
        }
        if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;
        if (nextPhase.startsWith("discard")) {
          state.poker.canDiscard = true;
          state.poker.discards = new Set();
          this.renderDiscards();
          updatePokerTotal();
          this.updateUiForPhase();
        }
        if (nextPhase === "reveal") {
          revealDealer("pokerDealer");
          renderCards("pokerDealer", state.poker.dealer);
          this.finalizeShowdown(clearTableBtn, foldBtn);
        }
        return;
      }

      if (state.poker.phase === "discard1" || state.poker.phase === "discard2") {
        const discardIndexes = state.poker.discards || new Set();
        state.poker.canDiscard = false;
        state.poker.player = state.poker.player.map((card, index) =>
          discardIndexes.has(index) ? draw(state.poker.deck) : card
        );
        const dealerResult = this.dealer.draw(state.poker.dealer, state.poker.deck);
        state.poker.dealer = dealerResult.hand;
        showCenterToast(`Dealer discarded ${dealerResult.discarded} cards.`, "win", 2000);
        renderCards("pokerPlayer", state.poker.player);
        state.poker.discards = new Set();
        this.renderDiscards();
        const nextPhase = state.poker.phase === "discard1" ? "bet2" : "bet3";
        this.setPhase(nextPhase, drawBtn);
        if (nextPhase.startsWith("discard")) {
          showCenterToast("Click cards to discard.", "win", 2200);
        }
        if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn, 2200)) return;
        this.updateUiForPhase();
        return;
      }

      if (state.poker.phase === "reveal") {
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
      state.poker.pot += raiseAmount;
      state.poker.playerPaid += raiseAmount;
      state.poker.awaitingRaise = false;
      state.poker.pendingCall = 0;
      state.poker.phase = "bet-resolving";
      updatePokerTotal();
      this.updateUiForPhase();
      const next = state.poker.nextPhase;
      state.poker.nextPhase = "";
      if (next) {
        this.setPhase(next, drawBtn);
        this.updateUiForPhase();
      }
      if (next === "discard1" || next === "discard2") {
        showCenterToast("Click cards to discard.", "win", 2200);
        state.poker.canDiscard = true;
        state.poker.discards = new Set();
        this.renderDiscards();
      }
      if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;
      if (next === "reveal") {
        revealDealer("pokerDealer");
        renderCards("pokerDealer", state.poker.dealer);
        this.finalizeShowdown(clearTableBtn, foldBtn);
      }
    });

    foldBtn?.addEventListener("click", () => {
      if (!state.poker.inRound) return;
      playSfx("lose");
      showCenterToast("You folded. Dealer wins.", "danger", 4500);
      this.endRound(clearTableBtn, foldBtn);
    });

    clearTableBtn?.addEventListener("click", () => {
      this.resetRound();
      clearTableBtn.classList.add("hidden");
      foldBtn?.classList.add("hidden");
      this.updateUiForPhase();
      updatePokerTotalAfterBlind();
    });

    updatePokerTotalAfterBlind();
    this.resetRound();
    this.updateUiForPhase();
  }
}
