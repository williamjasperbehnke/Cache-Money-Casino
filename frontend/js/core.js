const balanceEl = document.getElementById("balance");
const balanceDeltaEl = document.getElementById("balanceDelta");
const centerToastEl = document.getElementById("centerToast");

import { DEFAULT_BALANCE, BALANCE_STORAGE_KEY } from "./constants.js";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const CHIP_DENOMS = [1000, 500, 100, 50, 25, 10, 5, 1];

export const state = {
  balance: Number(localStorage.getItem(BALANCE_STORAGE_KEY)) || DEFAULT_BALANCE,
  lastBalance: Number(localStorage.getItem(BALANCE_STORAGE_KEY)) || DEFAULT_BALANCE,
  poker: {
    bet: 0,
    betAmount: 0,
    lastBet: 0,
    bet1: 0,
    bet2: 0,
    betRaise: 0,
    pot: 0,
    playerPaid: 0,
    pendingCall: 0,
    blind: 5,
    drawRound: 0,
    discards: new Set(),
    canDiscard: false,
    awaitingClear: false,
    awaitingRaise: false,
    phase: "idle",
    nextPhase: "",
    deck: [],
    player: [],
    dealer: [],
    inRound: false,
  },
  blackjack: {
    bet: 0,
    betAmount: 0,
    lastBet: 0,
    hands: [],
    bets: [],
    doubled: [],
    activeHand: 0,
    splitUsed: false,
    deck: [],
    player: [],
    dealer: [],
    inRound: false,
    revealDealer: false,
    awaitingClear: false,
  },
  roulette: {
    bets: {
      numbers: {},
      colors: {},
      parities: {},
    },
    spinning: false,
    roundPaid: false,
  },
  slots: {
    bet: 0,
  },
  holdem: {
    pot: 0,
    playerPaid: 0,
    playerBet: 0,
    dealerBet: 0,
    currentBet: 0,
    betAmount: 0,
    blindSmall: 5,
    blindBig: 10,
    dealerButton: false,
    awaitingRaise: false,
    skipBetting: false,
    deck: [],
    player: [],
    dealer: [],
    community: [],
    phase: "idle",
    awaitingClear: false,
    inRound: false,
  },
};

class BalanceManager {
  constructor(stateRef, balanceNode, deltaNode) {
    this.state = stateRef;
    this.balanceNode = balanceNode;
    this.deltaNode = deltaNode;
  }

  update(stateRef) {
    if (stateRef) this.state = stateRef;
    const diff = this.state.balance - this.state.lastBalance;
    if (this.balanceNode) this.balanceNode.textContent = `$${this.state.balance}`;
    if (diff !== 0 && this.deltaNode) {
      this.deltaNode.textContent = diff > 0 ? `+${diff}` : `${diff}`;
      this.deltaNode.classList.remove("positive", "negative", "show");
      this.deltaNode.classList.add(diff > 0 ? "positive" : "negative");
      void this.deltaNode.offsetWidth;
      this.deltaNode.classList.add("show");
      setTimeout(() => this.deltaNode.classList.remove("show"), 1200);
    }
    this.state.lastBalance = this.state.balance;
    localStorage.setItem(BALANCE_STORAGE_KEY, String(this.state.balance));
  }

  reset(stateRef, onReset) {
    if (stateRef) this.state = stateRef;
    this.state.balance = DEFAULT_BALANCE;
    this.update();
    if (onReset) onReset();
  }

  init(stateRef, onReset) {
    if (stateRef) this.state = stateRef;
    this.update();
  }
}

class AudioManager {
  constructor() {
    this.audioCtx = null;
    this.settings = {
      deal: { freq: 520, dur: 0.08 },
      hit: { freq: 640, dur: 0.08 },
      spin: { freq: 420, dur: 0.12 },
      win: { freq: 880, dur: 0.18 },
      lose: { freq: 220, dur: 0.16 },
      big: { freq: 1040, dur: 0.24 },
      stop: { freq: 560, dur: 0.06 },
    };
  }

  play(type) {
    const settings = this.settings[type];
    if (!settings) return;
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.type = "square";
    osc.frequency.setValueAtTime(settings.freq, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + settings.dur);
    osc.start(now);
    osc.stop(now + settings.dur);
  }
}

class ToastManager {
  constructor(container) {
    this.container = container;
  }

  showToasts(messages) {
    if (!this.container) return;
    this.container.innerHTML = "";
    messages.forEach((msg) => {
      const el = document.createElement("div");
      el.className = "center-toast-item";
      if (msg.tone === "danger") el.classList.add("negative");
      if (msg.tone === "win") el.classList.add("positive");
      el.textContent = msg.text;
      this.container.appendChild(el);
      requestAnimationFrame(() => {
        el.classList.add("show");
      });
      const duration = Number.isFinite(msg.duration) ? msg.duration : 1200;
      setTimeout(() => el.classList.remove("show"), duration);
    });
  }
}

export class Card {
  constructor(rank, suit) {
    this.rank = rank;
    this.suit = suit;
  }

  value() {
    if (this.rank === "A") return 14;
    if (this.rank === "K") return 13;
    if (this.rank === "Q") return 12;
    if (this.rank === "J") return 11;
    return Number(this.rank);
  }

  blackjackValue() {
    if (this.rank === "A") return 11;
    if (["K", "Q", "J"].includes(this.rank)) return 10;
    return Number(this.rank);
  }

  static from(raw) {
    return raw instanceof Card ? raw : new Card(raw.rank, raw.suit);
  }
}

class CardUtils {
  static format(card) {
    return `${card.rank}${card.suit}`;
  }

  static buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push(new Card(rank, suit));
      }
    }
    return deck;
  }

  static shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  static draw(deck) {
    return deck.pop();
  }

  static drawSpecific(deck, rank) {
    const index = deck.findIndex((card) => card.rank === rank);
    if (index === -1) return CardUtils.draw(deck);
    return deck.splice(index, 1)[0];
  }

  static total(cards) {
    let total = 0;
    let aces = 0;
    cards.forEach((card) => {
      total += card.blackjackValue();
      if (card.rank === "A") aces += 1;
    });
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }
}

class ChipRenderer {
  static renderStack(container, amount) {
    if (!container) return;
    container.innerHTML = "";
    if (!amount || amount <= 0) return;
    let remaining = amount;
    CHIP_DENOMS.forEach((denom) => {
      const count = Math.floor(remaining / denom);
      remaining -= count * denom;
      for (let i = 0; i < count; i += 1) {
        const chip = document.createElement("div");
        chip.className = `mini-chip d${denom}`;
        const label = denom >= 1000 ? "1k" : `${denom}`;
        chip.setAttribute("data-value", label);
        container.appendChild(chip);
      }
    });
  }

  static updateTotal(amount, totalId) {
    const totalEl = document.getElementById(totalId);
    if (totalEl) totalEl.textContent = `$${amount}`;
  }

  static animate(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const chip = document.createElement("div");
    chip.className = "flying-chip";
    chip.style.transform = `translate(${from.left + from.width / 2}px, ${
      from.top + from.height / 2
    }px)`;
    document.body.appendChild(chip);
    requestAnimationFrame(() => {
      chip.style.transform = `translate(${to.left + to.width / 2}px, ${
        to.top + to.height / 2
      }px)`;
      chip.style.opacity = "0.2";
    });
    chip.addEventListener(
      "transitionend",
      () => {
        chip.remove();
      },
      { once: true }
    );
  }
}

import { auth } from "./auth.js";

const balanceManager = new BalanceManager(state, balanceEl, balanceDeltaEl);
const audioManager = new AudioManager();
const toastManager = new ToastManager(centerToastEl);

export function updateBalance() {
  balanceManager.update(state);
  auth.queueBalanceUpdate();
}

export function initCore(onReset) {
  balanceManager.init(state, onReset);
  auth.init({
    onBalanceUpdate: (balance) => {
      if (!Number.isFinite(balance)) return;
      state.balance = balance;
      updateBalance();
    },
    getBalance: () => state.balance,
  });
}

export function formatCard(card) {
  return CardUtils.format(card);
}

export function buildDeck() {
  return CardUtils.buildDeck();
}

export function shuffle(deck) {
  return CardUtils.shuffle(deck);
}

export function draw(deck) {
  return CardUtils.draw(deck);
}

export function drawSpecific(deck, rank) {
  return CardUtils.drawSpecific(deck, rank);
}

export function withBet(amount, onSuccess) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter a valid bet.";
  }
  if (amount > state.balance) {
    return "Not enough credits.";
  }
  state.balance -= amount;
  updateBalance();
  onSuccess();
  return "";
}

export function payout(amount) {
  state.balance += Math.round(amount);
  updateBalance();
}

export function playSfx(type) {
  audioManager.play(type);
}

export function triggerBigWin(withSound = true) {
  document.body.classList.remove("big-win");
  void document.body.offsetWidth;
  document.body.classList.add("big-win");
  if (withSound) playSfx("big");
  setTimeout(() => document.body.classList.remove("big-win"), 400);
}

export function triggerSmallWin() {
  document.body.classList.remove("small-win");
  void document.body.offsetWidth;
  document.body.classList.add("small-win");
  setTimeout(() => document.body.classList.remove("small-win"), 240);
}

export function showCenterToast(message, tone = "", duration = 1200) {
  showCenterToasts([{ text: message, tone, duration }]);
}

export function showCenterToasts(messages) {
  toastManager.showToasts(messages);
}

export function renderCards(containerId, cards, hideFirst = false) {
  const container =
    typeof containerId === "string" ? document.getElementById(containerId) : containerId;
  if (!container) return;
  container.classList.remove("reveal");
  container.innerHTML = "";
  cards.forEach((card, index) => {
    const div = buildCardEl(card, hideFirst && index === 0);
    container.appendChild(div);
  });
}

export function buildCardEl(card, hidden = false) {
  const div = document.createElement("div");
  div.className = "card";
  if (hidden) {
    div.classList.add("back");
    div.textContent = "??";
    return div;
  }
  const label = formatCard(card);
  div.textContent = label;
  div.setAttribute("data-rank", label);
  if (card.suit === "♥" || card.suit === "♦") {
    div.classList.add("red");
  } else {
    div.classList.add("black");
  }
  return div;
}

export function renderHiddenCards(containerId, count) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove("reveal");
  container.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const div = document.createElement("div");
    div.className = "card back";
    div.textContent = "??";
    container.appendChild(div);
  }
}

export function revealDealer(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove("reveal");
  void container.offsetWidth;
  container.classList.add("reveal");
}

export function handTotal(cards) {
  return CardUtils.total(cards);
}

export function makeChipStack(container, amount) {
  ChipRenderer.renderStack(container, amount);
}

export function updateBetTotal(amount, totalId) {
  ChipRenderer.updateTotal(amount, totalId);
}

export function animateChip(fromEl, toEl) {
  ChipRenderer.animate(fromEl, toEl);
}

export function bindBetChips({
  chips,
  canBet,
  getBalance,
  getToCall = () => 0,
  getBetAmount,
  setBetAmount,
  onUpdate,
  onHit,
  onClosed,
}) {
  if (!chips) return;
  const list = Array.from(chips);
  const canPlace = () => {
    if (canBet()) return true;
    if (onClosed) onClosed();
    return false;
  };
  const commit = (next) => {
    setBetAmount(next);
    if (onUpdate) onUpdate();
    if (onHit) onHit();
  };
  const clampToBalance = (next) => {
    const toCall = getToCall();
    const cap = Math.max(0, getBalance() - toCall);
    return Math.min(cap, Math.max(0, next));
  };

  list.forEach((chip) => {
    if (chip.classList.contains("all-in")) {
      chip.addEventListener("click", () => {
        if (!canPlace()) return;
        const toCall = getToCall();
        const cap = Math.max(0, getBalance() - toCall);
        const next = Math.max(1, cap);
        commit(next);
      });
      chip.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (!canPlace()) return;
        commit(0);
      });
      return;
    }

    const amount = Number(chip.dataset.amount) || 0;
    chip.addEventListener("click", () => {
      if (!canPlace()) return;
      const next = clampToBalance(getBetAmount() + amount);
      commit(next);
    });

    chip.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!canPlace()) return;
      const next = clampToBalance(getBetAmount() - amount);
      commit(next);
    });
  });
}
