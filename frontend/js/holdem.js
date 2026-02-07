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
  lockPanel,
} from "./core.js";
import { auth } from "./auth.js";

const BETTING_PHASES = new Set(["preflop", "flop", "turn", "river"]);

export class HoldemGame {
  constructor() {
    this.ui = {};
  }

  cacheElements() {
    this.ui = {
      dealBtn: document.getElementById("holdemDeal"),
      raiseBtn: document.getElementById("holdemRaise"),
      clearBetBtn: document.getElementById("holdemClearBet"),
      foldBtn: document.getElementById("holdemFold"),
      clearBtn: document.getElementById("holdemClearTable"),
      betTotal: document.getElementById("holdemBetTotal"),
      betLabel: document.getElementById("holdemBetLabel"),
      potStack: document.getElementById("holdemPotStack"),
      chips: document.querySelectorAll("#holdem .chip"),
      community: document.getElementById("holdemCommunity"),
      player: document.getElementById("holdemPlayer"),
      dealer: document.getElementById("holdemDealer"),
      playerResult: document.getElementById("holdemPlayerResult"),
      dealerResult: document.getElementById("holdemDealerResult"),
      bettingPanel: document.getElementById("holdemBettingPanel"),
      playerBlindTag: document.getElementById("holdemPlayerBlindTag"),
      dealerBlindTag: document.getElementById("holdemDealerBlindTag"),
    };
  }

  phaseCommunityCount() {
    if (state.holdem.phase === "flop") return 3;
    if (state.holdem.phase === "turn") return 4;
    if (state.holdem.phase === "river" || state.holdem.phase === "showdown") return 5;
    return 0;
  }

  updateCommunity() {
    const count = this.phaseCommunityCount();
    const cards = state.holdem.community.slice(0, count);
    renderCards(this.ui.community, cards);
  }

  applyServerState(nextState, balance) {
    if (!nextState) return;
    Object.assign(state.holdem, nextState);
    if (Number.isFinite(balance)) {
      state.balance = balance;
      updateBalance();
    }
  }

  serializeState() {
    return { ...state.holdem };
  }

  restoreFromSaved(saved) {
    if (!saved) return;
    Object.assign(state.holdem, saved);
    state.holdem.player = Array.isArray(state.holdem.player) ? state.holdem.player : [];
    state.holdem.dealer = Array.isArray(state.holdem.dealer) ? state.holdem.dealer : [];
    state.holdem.community = Array.isArray(state.holdem.community) ? state.holdem.community : [];
    state.holdem.inRound = Boolean(state.holdem.inRound);
    state.holdem.awaitingClear = Boolean(state.holdem.awaitingClear);
    this.updateCommunity();
    if (state.holdem.inRound) {
      renderCards(this.ui.player, state.holdem.player);
      if (state.holdem.phase === "showdown" || state.holdem.awaitingClear) {
        revealDealer("holdemDealer");
        renderCards("holdemDealer", state.holdem.dealer);
      } else {
        renderHiddenCards("holdemDealer", state.holdem.dealer.length || 0);
      }
    } else {
      renderCards(this.ui.player, []);
      renderCards("holdemDealer", []);
    }
    this.updatePotUI();
    this.updateButtons();
  }

  updatePotUI() {
    if (state.holdem.inRound || state.holdem.awaitingClear) {
      const total = state.holdem.pot;
      updateBetTotal(total, "holdemBetTotal");
      makeChipStack(this.ui.potStack, total);
      if (this.ui.betLabel) this.ui.betLabel.textContent = "Total Pot";
      this.updateBlindIndicators(state.holdem.dealerButton);
      return;
    }
    const upcomingDealerButton = !state.holdem.dealerButton;
    const defaultBlind = upcomingDealerButton ? state.holdem.blindBig : state.holdem.blindSmall;
    const playerBlind = state.balance === 0 ? defaultBlind : Math.min(defaultBlind, state.balance);
    updateBetTotal(playerBlind, "holdemBetTotal");
    makeChipStack(this.ui.potStack, playerBlind);
    if (this.ui.betLabel) this.ui.betLabel.textContent = "Blind";
    this.updateBlindIndicators(upcomingDealerButton);
  }

  updateBlindIndicators(dealerButton) {
    const playerIsBig = dealerButton;
    if (this.ui.playerBlindTag) {
      this.ui.playerBlindTag.textContent = playerIsBig ? "Big Blind" : "Small Blind";
    }
    if (this.ui.dealerBlindTag) {
      this.ui.dealerBlindTag.textContent = playerIsBig ? "Small Blind" : "Big Blind";
    }
  }

  toCallAmount() {
    return Math.max(0, state.holdem.currentBet - state.holdem.playerBet);
  }

  updateButtons() {
    const inBetting = state.holdem.inRound && BETTING_PHASES.has(state.holdem.phase);
    const skipping = state.holdem.skipBetting;
    const toCall = this.toCallAmount();
    if (this.ui.raiseBtn) {
      const amount = state.holdem.betAmount > 0 ? state.holdem.betAmount : 0;
      if (toCall > 0) {
        const callAmount = Math.min(toCall, state.balance);
        this.ui.raiseBtn.textContent =
          amount > 0 ? `Raise $${toCall + amount}` : `Call $${callAmount}`;
      } else {
        this.ui.raiseBtn.textContent = `Bet $${amount}`;
      }
    }

    this.ui.dealBtn?.classList.toggle(
      "hidden",
      state.holdem.inRound || state.holdem.awaitingClear
    );
    this.ui.foldBtn?.classList.toggle("hidden", !state.holdem.inRound || skipping);
    this.ui.raiseBtn?.classList.toggle(
      "hidden",
      !inBetting || state.holdem.awaitingClear || skipping
    );
    this.ui.clearBetBtn?.classList.toggle(
      "hidden",
      !inBetting || state.holdem.awaitingClear || skipping
    );
    this.ui.clearBtn?.classList.toggle("hidden", !state.holdem.awaitingClear);

    if (this.ui.bettingPanel) {
      this.ui.bettingPanel.classList.toggle(
        "hidden",
        !state.holdem.inRound && !state.holdem.awaitingClear
      );
    }

    this.ui.chips?.forEach((chip) => {
      if (!inBetting || state.holdem.awaitingClear || skipping) {
        chip.setAttribute("disabled", "disabled");
      } else {
        chip.removeAttribute("disabled");
      }
    });
  }

  resetRound() {
    state.holdem.pot = 0;
    state.holdem.playerPaid = 0;
    state.holdem.playerBet = 0;
    state.holdem.dealerBet = 0;
    state.holdem.currentBet = 0;
    state.holdem.betAmount = 0;
    state.holdem.awaitingRaise = false;
    state.holdem.skipBetting = false;
    state.holdem.deck = [];
    state.holdem.player = [];
    state.holdem.dealer = [];
    state.holdem.community = [];
    state.holdem.phase = "idle";
    state.holdem.awaitingClear = false;
    state.holdem.inRound = false;
    state.holdem.skipBetting = false;
    state.holdem.dealerRaised = false;
    if (this.ui.playerResult) this.ui.playerResult.textContent = "";
    if (this.ui.dealerResult) this.ui.dealerResult.textContent = "";
    renderCards(this.ui.player, []);
    renderCards(this.ui.dealer, []);
    renderCards(this.ui.community, []);
    this.updatePotUI();
    this.updateButtons();
  }

  postBlinds(dealerButton = state.holdem.dealerButton) {
    const { blindSmall, blindBig } = state.holdem;
    const desiredPlayerBlind = dealerButton ? blindBig : blindSmall;
    const desiredDealerBlind = dealerButton ? blindSmall : blindBig;
    const available = state.balance;
    const playerBlind = Math.min(desiredPlayerBlind, available);
    const dealerBlind = Math.min(desiredDealerBlind, available);
    if (playerBlind <= 0) {
      showCenterToast("Not enough credits.", "danger");
      return false;
    }
    state.balance -= playerBlind;
    updateBalance();
    state.holdem.playerBet = playerBlind;
    state.holdem.playerPaid = playerBlind;
    state.holdem.dealerBet = dealerBlind;
    state.holdem.currentBet = Math.max(playerBlind, dealerBlind);
    state.holdem.pot = playerBlind + dealerBlind;
    this.updatePotUI();
    showCenterToast(`Blinds in. You: $${playerBlind}, Dealer: $${dealerBlind}.`, "win", 1600);
    return true;
  }

  async startHand() {
    if (state.holdem.inRound) {
      showCenterToast("Round already running.", "danger");
      return;
    }
    const unlock = lockPanel("holdem");
    try {
      const payload = await auth.request("/api/games/holdem/deal", {
        method: "POST",
        body: JSON.stringify({ state: {
          blindSmall: state.holdem.blindSmall,
          blindBig: state.holdem.blindBig,
          dealerButton: state.holdem.dealerButton,
        } }),
      });
      playSfx("deal");
      this.applyServerState(payload.state, payload.balance);
      renderCards(this.ui.player, state.holdem.player);
      renderHiddenCards("holdemDealer", state.holdem.dealer.length);
      this.updateCommunity();
      this.updatePotUI();
      this.updateButtons();
      if (payload.messages?.length) {
        showMessagesSequential(payload.messages);
      }
    } catch (err) {
      if ((err.message || "").toLowerCase().includes("not enough credits")) {
        showCenterToast("Need more credits to cover the blind.", "danger");
      } else {
        showCenterToast(err.message || "Deal failed.", "danger");
      }
    } finally {
      unlock();
    }
  }

  async playerAction() {
    if (!state.holdem.inRound || !BETTING_PHASES.has(state.holdem.phase)) return;
    playSfx("hit");
    const unlock = lockPanel("holdem");
    try {
      const payload = await auth.request("/api/games/holdem/action", {
        method: "POST",
        body: JSON.stringify({ betAmount: state.holdem.betAmount }),
      });
      this.applyServerState(payload.state, payload.balance);
      this.updateCommunity();
      this.updatePotUI();
      this.updateButtons();
      renderCards(this.ui.player, state.holdem.player);
      renderHiddenCards("holdemDealer", state.holdem.dealer.length);
      const hasShowdown = Boolean(payload.showdown);
      const messages = payload.messages || [];
      if (messages.length) {
        showMessagesSequential(messages);
      }
      if (hasShowdown) {
        this.renderShowdown(payload.showdown);
      }
    } catch (err) {
      showCenterToast(err.message || "Action failed.", "danger");
    } finally {
      unlock();
    }
  }

  async playerFold() {
    if (!state.holdem.inRound) return;
    playSfx("lose");
    const unlock = lockPanel("holdem");
    try {
      const payload = await auth.request("/api/games/holdem/fold", {
        method: "POST",
        body: JSON.stringify({}),
      });
      this.applyServerState(payload.state, payload.balance);
      this.updatePotUI();
      this.updateButtons();
      if (payload.messages?.length) {
        showMessagesSequential(payload.messages);
      }
    } catch (err) {
      showCenterToast(err.message || "Fold failed.", "danger");
    } finally {
      unlock();
    }
  }

  renderShowdown(showdown) {
    revealDealer("holdemDealer");
    renderCards("holdemDealer", state.holdem.dealer);
    if (this.ui.playerResult) {
      this.ui.playerResult.textContent = `Player: ${showdown.playerLabel}`;
    }
    if (this.ui.dealerResult) {
      this.ui.dealerResult.textContent = `Dealer: ${showdown.dealerLabel}`;
    }
    this.applyHighlights(showdown.playerIndexes, showdown.dealerIndexes, showdown.result);
    const hasWin = showdown.result > 0;
    const hasPush = showdown.result === 0;
    playSfx(hasWin || hasPush ? "win" : "lose");
  }

  applyHighlights(playerIndexes, dealerIndexes, result) {
    const playerEl = this.ui.player;
    const dealerEl = this.ui.dealer;
    const communityEl = this.ui.community;
    if (!playerEl || !dealerEl || !communityEl) return;

    const winningIndexes = result >= 0 ? playerIndexes : dealerIndexes;
    const winningIsPlayer = result >= 0;
    const winClass = winningIsPlayer ? "win" : "lose";
    const holeSet = new Set(winningIndexes.filter((idx) => idx < 2));
    const communitySet = new Set(winningIndexes.filter((idx) => idx >= 2).map((idx) => idx - 2));

    playerEl.querySelectorAll(".card").forEach((cardEl, index) => {
      if (winningIsPlayer && holeSet.has(index)) cardEl.classList.add(winClass);
      else cardEl.classList.remove("win", "lose");
    });

    dealerEl.querySelectorAll(".card").forEach((cardEl, index) => {
      if (!winningIsPlayer && holeSet.has(index)) cardEl.classList.add(winClass);
      else cardEl.classList.remove("win", "lose");
    });

    communityEl.querySelectorAll(".card").forEach((cardEl, index) => {
      if (communitySet.has(index)) cardEl.classList.add(winClass);
      else cardEl.classList.remove("win", "lose");
    });
  }

  bindChips() {
    bindBetChips({
      chips: this.ui.chips,
      canBet: () =>
        BETTING_PHASES.has(state.holdem.phase) &&
        state.holdem.inRound &&
        !state.holdem.awaitingClear &&
        !state.holdem.skipBetting,
      getBalance: () => state.balance,
      getToCall: () => this.toCallAmount(),
      getBetAmount: () => state.holdem.betAmount,
      setBetAmount: (amount) => {
        state.holdem.betAmount = amount;
      },
      onUpdate: () => this.updateButtons(),
      onHit: () => playSfx("hit"),
      onClosed: () => showCenterToast("Betting is closed.", "danger"),
    });
  }

  bindEvents() {
    this.ui.dealBtn?.addEventListener("click", () => this.startHand());
    this.ui.raiseBtn?.addEventListener("click", () => this.playerAction());
    this.ui.clearBetBtn?.addEventListener("click", () => {
      if (!BETTING_PHASES.has(state.holdem.phase)) {
        showCenterToast("Betting is closed.", "danger");
        return;
      }
      state.holdem.betAmount = 0;
      this.updateButtons();
    });
    this.ui.foldBtn?.addEventListener("click", () => this.playerFold());
    this.ui.clearBtn?.addEventListener("click", () => this.resetRound());
    this.bindChips();
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    this.resetRound();
  }

  reset() {
    this.resetRound();
  }
}
