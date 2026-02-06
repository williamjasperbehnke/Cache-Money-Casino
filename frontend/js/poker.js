import {
  state,
  updateBalance,
  playSfx,
  showCenterToast,
  showMessagesSequential,
  renderCards,
  renderHiddenCards,
  revealDealer,
  makeChipStack,
  updateBetTotal,
  bindBetChips,
} from "./core.js";
import { auth } from "./auth.js";

const BET_PHASES = new Set(["bet1", "bet2", "bet3"]);
const DISCARD_PHASES = new Set(["discard1", "discard2"]);

export class PokerGame {
  static highlightIndexes(containerId, indexes, className) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const indexSet = new Set(indexes || []);
    container.querySelectorAll(".card").forEach((cardEl, index) => {
      if (indexSet.has(index)) {
        cardEl.classList.add(className);
      } else {
        cardEl.classList.remove("win", "lose");
      }
    });
  }

  constructor() {
    this.handleCardClick = this.handleCardClick.bind(this);
  }

  normalizeDiscards(nextState) {
    const discards = nextState?.discards;
    if (discards instanceof Set) return discards;
    if (Array.isArray(discards)) return new Set(discards);
    return new Set();
  }

  serializeState() {
    return {
      ...state.poker,
      discards: Array.from(state.poker.discards || []),
    };
  }

  applyServerState(nextState, balance) {
    if (nextState) {
      Object.assign(state.poker, nextState);
      state.poker.discards = this.normalizeDiscards(nextState);
    }
    if (Number.isFinite(balance)) {
      state.balance = balance;
      updateBalance();
    }
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

  updatePokerTotal() {
    const showPot = state.poker.inRound || state.poker.awaitingClear;
    const total = showPot ? state.poker.pot : state.poker.blind;
    updateBetTotal(total, "pokerBetTotal");
    makeChipStack(document.getElementById("pokerPotStack"), total);
    const betLabel = document.getElementById("pokerBetLabel");
    if (betLabel) betLabel.textContent = showPot ? "Total Pot" : "Blind";
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
    if (clearBetBtn) {
      clearBetBtn.classList.toggle("hidden", !this.betPhaseActive() || state.poker.awaitingRaise);
    }

    this.updateDiscardLabel(drawBtn);
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
    if (state.poker.discards.has(idx)) state.poker.discards.delete(idx);
    else state.poker.discards.add(idx);
    playSfx("hit");
    this.updateDiscardLabel();
    this.renderDiscards();
  }

  showResult(payload) {
    const playerResult = document.getElementById("pokerPlayerResult");
    const dealerResult = document.getElementById("pokerDealerResult");
    if (playerResult) playerResult.textContent = `Player: ${payload.playerLabel}`;
    if (dealerResult) dealerResult.textContent = `Dealer: ${payload.dealerLabel}`;

    if (payload.result > 0) {
      PokerGame.highlightIndexes("pokerPlayer", payload.playerIndexes, "win");
      PokerGame.highlightIndexes("pokerDealer", payload.dealerIndexes, "lose");
      playSfx("win");
      showCenterToast(
        `You win with ${payload.playerLabel}! Dealer had ${payload.dealerLabel}.`,
        "win",
        4500
      );
    } else if (payload.result < 0) {
      PokerGame.highlightIndexes("pokerPlayer", payload.playerIndexes, "lose");
      PokerGame.highlightIndexes("pokerDealer", payload.dealerIndexes, "win");
      playSfx("lose");
      showCenterToast(
        `Dealer wins with ${payload.dealerLabel}. You had ${payload.playerLabel}.`,
        "danger",
        4500
      );
    } else {
      PokerGame.highlightIndexes("pokerPlayer", payload.playerIndexes, "win");
      PokerGame.highlightIndexes("pokerDealer", payload.dealerIndexes, "win");
      playSfx("win");
      showCenterToast(`Push! Both had ${payload.playerLabel}.`, "win", 4500);
    }
  }

  async requestGame(path, body) {
    try {
      const payload = await auth.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return payload;
    } catch (err) {
      showCenterToast(err?.message || "Server error.", "danger");
      return null;
    }
  }

  async revealFromServer() {
    const payload = await this.requestGame("/api/games/poker/reveal", {
      state: this.serializeState(),
    });
    if (!payload) return;
    this.applyServerState(payload.state, payload.balance);
    revealDealer("pokerDealer");
    renderCards("pokerPlayer", state.poker.player);
    renderCards("pokerDealer", state.poker.dealer);
    this.updateUiForPhase();
    this.updatePokerTotal();
    this.showResult(payload);
  }

  async handleDeal() {
    if (state.poker.inRound) {
      showCenterToast("Round already running.", "danger");
      return;
    }
    const payload = await this.requestGame("/api/games/poker/deal", {
      blind: state.poker.blind,
    });
    if (!payload) return;
    playSfx("deal");
    this.applyServerState(payload.state, payload.balance);
    state.poker.discards = new Set();
    const dealerDiscardEl = document.getElementById("pokerDealerDiscard");
    if (dealerDiscardEl) dealerDiscardEl.textContent = "";
    renderCards("pokerPlayer", state.poker.player);
    renderHiddenCards("pokerDealer", state.poker.dealer.length);
    showCenterToast("Place your bet.", "win", 2200);
    const playerResult = document.getElementById("pokerPlayerResult");
    const dealerResult = document.getElementById("pokerDealerResult");
    if (playerResult) playerResult.textContent = "";
    if (dealerResult) dealerResult.textContent = "";
    this.updatePokerTotal();
    this.updateUiForPhase();
  }

  async handleBet(drawBtn, clearTableBtn, foldBtn) {
    if (!state.poker.inRound) {
      showCenterToast("Deal first.", "danger");
      return;
    }
    if (state.poker.awaitingRaise) return;
    const betAmount = state.poker.betAmount || 0;
    if (betAmount <= 0) {
      showCenterToast("Select a bet amount.", "danger");
      return;
    }
    playSfx("hit");
    const payload = await this.requestGame("/api/games/poker/bet", {
      state: this.serializeState(),
      betAmount,
    });
    if (!payload) return;
    state.poker.betAmount = 0;
    this.applyServerState(payload.state, payload.balance);
    if (payload.messages?.length) showMessagesSequential(payload.messages);

    if (state.poker.awaitingRaise) {
      const callRaiseBtn = document.getElementById("pokerCallRaise");
      if (callRaiseBtn) callRaiseBtn.textContent = `Call $${state.poker.pendingCall}`;
    }

    this.updateUiForPhase();
    this.updatePokerTotal();

    if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;

    if (this.discardPhaseActive()) {
      showCenterToast("Click cards to discard.", "win", 2200);
      this.renderDiscards();
    }

    if (state.poker.phase === "reveal" && !state.poker.awaitingClear) {
      await this.revealFromServer();
    }
  }

  async handleDiscard(drawBtn, clearTableBtn, foldBtn) {
    if (!state.poker.inRound) return;
    playSfx("hit");
    const payload = await this.requestGame("/api/games/poker/draw", {
      state: this.serializeState(),
      discards: Array.from(state.poker.discards || []),
    });
    if (!payload) return;
    this.applyServerState(payload.state, payload.balance);
    state.poker.discards = new Set();
    renderCards("pokerPlayer", state.poker.player);
    this.renderDiscards();
    if (payload.dealerDiscarded !== undefined) {
      showCenterToast(`Dealer discarded ${payload.dealerDiscarded} cards.`, "win", 2000);
    }
    this.updateUiForPhase();
    this.updatePokerTotal();

    if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn, 2200)) return;

    if (this.betPhaseActive()) {
      this.updateUiForPhase();
    }
  }

  async handleCall(drawBtn, clearTableBtn, foldBtn) {
    if (!state.poker.awaitingRaise) return;
    const payload = await this.requestGame("/api/games/poker/call", {
      state: this.serializeState(),
    });
    if (!payload) return;
    this.applyServerState(payload.state, payload.balance);
    this.updateUiForPhase();
    this.updatePokerTotal();

    if (this.skipBettingIfBroke(drawBtn, clearTableBtn, foldBtn)) return;

    if (this.discardPhaseActive()) {
      showCenterToast("Click cards to discard.", "win", 2200);
      state.poker.canDiscard = true;
      state.poker.discards = new Set();
      this.renderDiscards();
    }

    if (state.poker.phase === "reveal" && !state.poker.awaitingClear) {
      await this.revealFromServer();
    }
  }

  async handleFold() {
    if (!state.poker.inRound) return;
    playSfx("lose");
    const payload = await this.requestGame("/api/games/poker/fold", {
      state: this.serializeState(),
    });
    if (!payload) return;
    this.applyServerState(payload.state, payload.balance);
    if (payload.messages?.length) showMessagesSequential(payload.messages);
    this.updateUiForPhase();
    this.updatePokerTotal();
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
    const fireToast = () =>
      showCenterToast("No credits left. Skipping betting.", "danger", skipDuration);

    if (delayToast) setTimeout(fireToast, delayToast);
    else fireToast();

    if (nextPhase === "reveal") {
      setTimeout(async () => {
        if (!state.poker.inRound) return;
        if (state.poker.phase !== "reveal") return;
        await this.revealFromServer();
      }, (delayToast || 0) + skipDuration);
      return true;
    }
    if (nextPhase.startsWith("discard")) {
      const discardDelay = (delayToast || 0) + skipDuration;
      setTimeout(() => {
        if (!state.poker.inRound) return;
        if (!this.discardPhaseActive()) return;
        showCenterToast("Click cards to discard.", "win", 2200);
        state.poker.canDiscard = true;
        renderCards("pokerPlayer", state.poker.player);
        this.renderDiscards();
      }, discardDelay);
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
    renderCards("pokerPlayer", []);
    renderCards("pokerDealer", []);
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

    bindBetChips({
      chips: pokerChips,
      canBet: () => this.betPhaseActive() && !state.poker.awaitingRaise,
      getBalance: () => state.balance,
      getBetAmount: () => state.poker.betAmount,
      setBetAmount: (amount) => {
        state.poker.betAmount = amount;
      },
      onUpdate: () => {
        this.updatePokerTotal();
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
      this.updatePokerTotal();
      this.updateUiForPhase();
    });

    dealBtn?.addEventListener("click", () => this.handleDeal());

    drawBtn?.addEventListener("click", async () => {
      if (!state.poker.inRound) {
        showCenterToast("Deal first.", "danger");
        return;
      }
      if (state.poker.awaitingRaise) return;
      if (this.betPhaseActive()) {
        await this.handleBet(drawBtn, clearTableBtn, foldBtn);
        return;
      }
      if (this.discardPhaseActive()) {
        await this.handleDiscard(drawBtn, clearTableBtn, foldBtn);
      }
    });

    callRaiseBtn?.addEventListener("click", async () => {
      await this.handleCall(drawBtn, clearTableBtn, foldBtn);
    });

    foldBtn?.addEventListener("click", async () => {
      await this.handleFold();
    });

    clearTableBtn?.addEventListener("click", () => {
      this.resetRound();
      clearTableBtn.classList.add("hidden");
      foldBtn?.classList.add("hidden");
      this.updateUiForPhase();
      this.updatePokerTotal();
    });

    this.resetRound();
    this.updatePokerTotal();
    this.updateUiForPhase();
  }
}
