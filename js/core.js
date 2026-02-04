const balanceEl = document.getElementById("balance");
const balanceDeltaEl = document.getElementById("balanceDelta");
const centerToastEl = document.getElementById("centerToast");
const resetBankBtn = document.getElementById("resetBank");

export const state = {
  balance: Number(localStorage.getItem("pixel-casino-balance")) || 1000,
  lastBalance: Number(localStorage.getItem("pixel-casino-balance")) || 1000,
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
};

const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

let audioCtx = null;

function saveBalance() {
  localStorage.setItem("pixel-casino-balance", String(state.balance));
}

export function updateBalance() {
  const diff = state.balance - state.lastBalance;
  if (balanceEl) balanceEl.textContent = `$${state.balance}`;
  if (diff !== 0 && balanceDeltaEl) {
    balanceDeltaEl.textContent = diff > 0 ? `+${diff}` : `${diff}`;
    balanceDeltaEl.classList.remove("positive", "negative", "show");
    balanceDeltaEl.classList.add(diff > 0 ? "positive" : "negative");
    void balanceDeltaEl.offsetWidth;
    balanceDeltaEl.classList.add("show");
    setTimeout(() => balanceDeltaEl.classList.remove("show"), 1200);
  }
  state.lastBalance = state.balance;
  saveBalance();
}

export function initCore(onReset) {
  updateBalance();
  resetBankBtn?.addEventListener("click", () => {
    state.balance = 1000;
    updateBalance();
    if (onReset) onReset();
  });
}

export function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

export function buildDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function draw(deck) {
  return deck.pop();
}

export function drawSpecific(deck, rank) {
  const index = deck.findIndex((card) => card.rank === rank);
  if (index === -1) return draw(deck);
  return deck.splice(index, 1)[0];
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
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const settings = {
    deal: { freq: 520, dur: 0.08 },
    hit: { freq: 640, dur: 0.08 },
    spin: { freq: 420, dur: 0.12 },
    win: { freq: 880, dur: 0.18 },
    lose: { freq: 220, dur: 0.16 },
    big: { freq: 1040, dur: 0.24 },
    stop: { freq: 560, dur: 0.06 },
  }[type];

  if (!settings) return;
  osc.type = "square";
  osc.frequency.setValueAtTime(settings.freq, now);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + settings.dur);
  osc.start(now);
  osc.stop(now + settings.dur);
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

export function setStatus(id, message, tone = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  if (tone === "danger") {
    el.style.color = "var(--danger)";
  } else if (tone === "win") {
    el.style.color = "var(--accent)";
  } else {
    el.style.color = "var(--accent)";
  }
}

export function showCenterToast(message, tone = "", duration = 1200) {
  showCenterToasts([{ text: message, tone, duration }]);
}

export function showCenterToasts(messages) {
  if (!centerToastEl) return;
  centerToastEl.innerHTML = "";
  messages.forEach((msg) => {
    const el = document.createElement("div");
    el.className = "center-toast-item";
    if (msg.tone === "danger") el.classList.add("negative");
    if (msg.tone === "win") el.classList.add("positive");
    el.textContent = msg.text;
    centerToastEl.appendChild(el);
    requestAnimationFrame(() => {
      el.classList.add("show");
    });
    const duration = Number.isFinite(msg.duration) ? msg.duration : 1200;
    setTimeout(() => el.classList.remove("show"), duration);
  });
}

export function renderCards(containerId, cards, hideFirst = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.classList.remove("reveal");
  container.innerHTML = "";
  cards.forEach((card, index) => {
    const div = document.createElement("div");
    div.className = "card";
    if (hideFirst && index === 0) {
      div.classList.add("back");
      div.textContent = "??";
    } else {
      div.textContent = formatCard(card);
      div.setAttribute("data-rank", formatCard(card));
      if (card.suit === "♥" || card.suit === "♦") {
        div.classList.add("red");
      } else {
        div.classList.add("black");
      }
    }
    container.appendChild(div);
  });
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

export function getCardValue(card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number(card.rank);
}

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  cards.forEach((card) => {
    total += getCardValue(card);
    if (card.rank === "A") aces += 1;
  });
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

export function makeChipStack(container, amount) {
  if (!container) return;
  container.innerHTML = "";
  if (!amount || amount <= 0) return;
  const denoms = [1000, 500, 100, 50, 25, 10, 5, 1];
  let remaining = amount;
  denoms.forEach((denom) => {
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

export function updateBetTotal(amount, totalId) {
  const totalEl = document.getElementById(totalId);
  if (totalEl) totalEl.textContent = `$${amount}`;
}

export function animateChip(fromEl, toEl) {
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
