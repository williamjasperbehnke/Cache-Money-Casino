const balanceEl = document.getElementById("balance");
const balanceDeltaEl = document.getElementById("balanceDelta");
const centerToastEl = document.getElementById("centerToast");
const resetBankBtn = document.getElementById("resetBank");

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

const state = {
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
const ranks = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];

const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const slotSymbols = ["🍒", "🍋", "🔔", "⭐", "💎", "🍇", "🍀", "💥", "🍉", "🪙"];
let audioCtx = null;
let rouletteSelectedChip = 5;
let lastDragSource = null;
const rouletteOrder = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  "00", 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];
let rouletteRotation = 0;

function saveBalance() {
  localStorage.setItem("pixel-casino-balance", String(state.balance));
}

function updateBalance() {
  const diff = state.balance - state.lastBalance;
  balanceEl.textContent = `$${state.balance}`;
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

function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

function buildDeck() {
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck) {
  return deck.pop();
}

function drawSpecific(deck, rank) {
  const index = deck.findIndex((card) => card.rank === rank);
  if (index === -1) return draw(deck);
  return deck.splice(index, 1)[0];
}

function withBet(amount, onSuccess) {
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

function payout(amount) {
  state.balance += Math.round(amount);
  updateBalance();
}

function playSfx(type) {
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
  }[type];

  osc.type = "square";
  osc.frequency.setValueAtTime(settings.freq, now);
  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + settings.dur);
  osc.start(now);
  osc.stop(now + settings.dur);
}

function triggerBigWin(withSound = true) {
  document.body.classList.remove("big-win");
  void document.body.offsetWidth;
  document.body.classList.add("big-win");
  if (withSound) playSfx("big");
  setTimeout(() => document.body.classList.remove("big-win"), 400);
}

function triggerSmallWin() {
  document.body.classList.remove("small-win");
  void document.body.offsetWidth;
  document.body.classList.add("small-win");
  setTimeout(() => document.body.classList.remove("small-win"), 240);
}

function setStatus(id, message, tone = "") {
  const el = document.getElementById(id);
  el.textContent = message;
  if (tone === "danger") {
    el.style.color = "var(--danger)";
  } else if (tone === "win") {
    el.style.color = "var(--accent)";
  } else {
    el.style.color = "var(--accent)";
  }
}

function showCenterToast(message, tone = "", duration = 1200) {
  showCenterToasts([{ text: message, tone, duration }]);
}

function showCenterToasts(messages) {
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

function renderCards(containerId, cards, hideFirst = false) {
  const container = document.getElementById(containerId);
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

function renderHiddenCards(containerId, count) {
  const container = document.getElementById(containerId);
  container.classList.remove("reveal");
  container.innerHTML = "";
  for (let i = 0; i < count; i += 1) {
    const div = document.createElement("div");
    div.className = "card back";
    div.textContent = "??";
    container.appendChild(div);
  }
}

function revealDealer(containerId) {
  const container = document.getElementById(containerId);
  container.classList.remove("reveal");
  void container.offsetWidth;
  container.classList.add("reveal");
}

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
    state.poker.inRound &&
    (state.poker.phase === "bet1" ||
      state.poker.phase === "bet2" ||
      state.poker.phase === "bet3")
  );
}

function dealerRaisePercent(rank) {
  if (rank >= 4) return 1.0;
  if (rank >= 3) return 0.75;
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

function updatePokerDiscardLabel(drawBtn) {
  if (!state.poker.phase.startsWith("discard")) return;
  const btn = drawBtn || document.getElementById("pokerDraw");
  if (!btn) return;
  const count = state.poker.discards ? state.poker.discards.size : 0;
  btn.textContent = `Discard ${count}`;
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
    foldBtn.classList.toggle("hidden", !state.poker.inRound || (!isBetting && !state.poker.awaitingRaise));
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
    if (state.poker.pot >= state.poker.playerPaid * 5) {
      triggerBigWin();
    }
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
function renderHolds(cards) {
  const holds = document.getElementById("pokerHolds");
  holds.innerHTML = "";
  cards.forEach((card, index) => {
    const label = document.createElement("label");
    label.className = "hold";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.index = index;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(`Hold ${formatCard(card)}`));
    holds.appendChild(label);
  });
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
  const high = Math.max(...values);
  return { rank: 0, label: `High Card`, values };
}

function compareHands(player, dealer) {
  if (player.rank !== dealer.rank) {
    return player.rank > dealer.rank ? 1 : -1;
  }
  const pVals = [...player.values].sort((a, b) => b - a);
  const dVals = [...dealer.values].sort((a, b) => b - a);
  for (let i = 0; i < pVals.length; i += 1) {
    if (pVals[i] !== dVals[i]) {
      return pVals[i] > dVals[i] ? 1 : -1;
    }
  }
  return 0;
}

function dealerPokerDraw(hand, deck) {
  const evaluation = evaluateHand(hand);
  const counts = {};
  hand.forEach((card) => {
    const value = getPokerCardValue(card);
    counts[value] = (counts[value] || 0) + 1;
  });
  const keepValues = new Set();
  Object.entries(counts).forEach(([value, count]) => {
    if (count >= 2) keepValues.add(Number(value));
  });

  let discarded = 0;
  const nextHand = hand.map((card) => {
    const value = getPokerCardValue(card);
    if (evaluation.rank >= 4) return card;
    if (keepValues.has(value)) return card;
    discarded += 1;
    return draw(deck);
  });
  return { hand: nextHand, discarded };
}

function getCardValue(card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J"].includes(card.rank)) return 10;
  return Number(card.rank);
}

function handTotal(cards) {
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
  document.getElementById("bjPlayer").innerHTML = "";
  document.getElementById("bjDealer").innerHTML = "";
  document.getElementById("bjPlayerTotal").textContent = "";
  document.getElementById("bjDealerTotal").textContent = "";
  setStatus("bjStatus", "");
  if (keepBet) {
    updateBetTotal(state.blackjack.betAmount, "bjBetTotal");
  }
}

function initTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((btn) => btn.classList.remove("active"));
      panels.forEach((panel) => panel.classList.add("hidden"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.game).classList.remove("hidden");
    });
  });
}

function initChips() {
  const chips = document.querySelectorAll(".chip");
  chips.forEach((chip) => {
    chip.setAttribute("draggable", "true");
    chip.addEventListener("dragstart", (event) => {
      lastDragSource = chip;
      event.dataTransfer.setData("text/plain", chip.dataset.amount);
      event.dataTransfer.effectAllowed = "copy";
    });
    chip.addEventListener("click", () => {
      const container = chip.closest(".chips");
      const targetId = container?.dataset.target;
      const amount = Number(chip.dataset.amount);
      if (!targetId || !Number.isFinite(amount)) return;
      if (targetId === "bjBet" || targetId === "pokerBet") return;
      if (targetId === "rouletteBet") {
        rouletteSelectedChip = amount;
        container.querySelectorAll(".chip").forEach((btn) => btn.classList.remove("active"));
        chip.classList.add("active");
        playSfx("hit");
        return;
      } else {
        const input = document.getElementById(targetId);
        if (!input) return;
        const current = Number(input.value) || 0;
        input.value = Math.max(1, current + amount);
      }
      container.querySelectorAll(".chip").forEach((btn) => btn.classList.remove("active"));
      chip.classList.add("active");
      playSfx("hit");
    });
  });
}

function makeChipStack(container, amount) {
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

function updateBetTotal(amount, totalId) {
  const totalEl = document.getElementById(totalId);
  if (totalEl) totalEl.textContent = `$${amount}`;
}

function rouletteTotalBet() {
  const { numbers, colors, parities } = state.roulette.bets;
  const sum = (obj) => Object.values(obj).reduce((acc, val) => acc + val, 0);
  return sum(numbers) + sum(colors) + sum(parities);
}

function updateRouletteUI() {
  const betInput = document.getElementById("rouletteBet");
  const total = rouletteTotalBet();
  if (betInput) betInput.textContent = `$${total}`;

  document.querySelectorAll(".roulette-cell .chip-stack").forEach((el) => {
    makeChipStack(el, 0);
  });
  makeChipStack(document.querySelector(".roulette-zero .chip-stack"), 0);
  makeChipStack(document.querySelector(".roulette-zero.double-zero .chip-stack"), 0);
  document
    .querySelectorAll(".bet-zone .chip-stack")
    .forEach((el) => makeChipStack(el, 0));

  Object.entries(state.roulette.bets.numbers).forEach(([value, amount]) => {
    const target =
      value === "00"
        ? document.querySelector(".roulette-zero.double-zero .chip-stack")
        : value === "0"
          ? document.querySelector(".roulette-zero .chip-stack")
          : document.querySelector(`.roulette-cell[data-number="${value}"] .chip-stack`);
    makeChipStack(target, amount);
  });

  Object.entries(state.roulette.bets.colors).forEach(([value, amount]) => {
    const target = document.querySelector(`.bet-zone.color.${value} .chip-stack`);
    makeChipStack(target, amount);
  });

  Object.entries(state.roulette.bets.parities).forEach(([value, amount]) => {
    const target = document.querySelector(`.bet-zone.parity.${value} .chip-stack`);
    makeChipStack(target, amount);
  });
}

function animateChip(fromEl, toEl) {
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

function placeRouletteBet(type, value, amount, sourceEl, targetEl, options = {}) {
  if (state.roulette.spinning) {
    showCenterToast("Wait for the wheel to stop.", "danger");
    setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
    return 0;
  }
  if (!Number.isFinite(amount) || amount <= 0) return;
  const availableBalance =
    typeof options.availableBalance === "number" ? options.availableBalance : state.balance;
  const deferBalance = options.deferBalance === true;
  let capped = false;
  let added = 0;
  if (type === "number") {
    const key = String(value);
    const current = state.roulette.bets.numbers[key] || 0;
    const add = Math.min(amount, 50 - current);
    if (add <= 0) {
      setStatus("rouletteStatus", "Max bet per slot is $50.", "danger");
      showCenterToast("Max bet per slot is $50.", "danger");
      return;
    }
    if (add < amount) capped = true;
    added = add;
    state.roulette.bets.numbers[key] = current + add;
  }
  if (type === "color") {
    const key = String(value);
    const current = state.roulette.bets.colors[key] || 0;
    const add = Math.min(amount, 50 - current);
    if (add <= 0) {
      setStatus("rouletteStatus", "Max bet per slot is $50.", "danger");
      showCenterToast("Max bet per slot is $50.", "danger");
      return;
    }
    if (add < amount) capped = true;
    added = add;
    state.roulette.bets.colors[key] = current + add;
  }
  if (type === "parity") {
    const key = String(value);
    const current = state.roulette.bets.parities[key] || 0;
    const add = Math.min(amount, 50 - current);
    if (add <= 0) {
      setStatus("rouletteStatus", "Max bet per slot is $50.", "danger");
      showCenterToast("Max bet per slot is $50.", "danger");
      return;
    }
    if (add < amount) capped = true;
    added = add;
    state.roulette.bets.parities[key] = current + add;
  }
  if (added > availableBalance) {
    showCenterToast("Not enough credits.", "danger");
    setStatus("rouletteStatus", "Not enough credits.", "danger");
    if (type === "number") {
      const key = String(value);
      state.roulette.bets.numbers[key] -= added;
      if (state.roulette.bets.numbers[key] <= 0) delete state.roulette.bets.numbers[key];
    }
    if (type === "color") {
      const key = String(value);
      state.roulette.bets.colors[key] -= added;
      if (state.roulette.bets.colors[key] <= 0) delete state.roulette.bets.colors[key];
    }
    if (type === "parity") {
      const key = String(value);
      state.roulette.bets.parities[key] -= added;
      if (state.roulette.bets.parities[key] <= 0) delete state.roulette.bets.parities[key];
    }
    return 0;
  }
  if (!deferBalance) {
    state.balance -= added;
    updateBalance();
    if (added > 0) {
      state.roulette.roundPaid = true;
    }
  }
  if (capped) {
    setStatus("rouletteStatus", "Max bet per slot is $50.", "danger");
    showCenterToast("Max bet per slot is $50.", "danger");
  }
  updateRouletteUI();
  animateChip(sourceEl, targetEl);
  playSfx("hit");
  return added;
}

function removeRouletteBet(type, value, amount) {
  if (state.roulette.spinning) {
    showCenterToast("Wait for the wheel to stop.", "danger");
    setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) return;
  let removed = 0;
  if (type === "number") {
    const key = String(value);
    const current = state.roulette.bets.numbers[key] || 0;
    removed = Math.min(amount, current);
    if (removed > 0) {
      const next = current - removed;
      if (next <= 0) delete state.roulette.bets.numbers[key];
      else state.roulette.bets.numbers[key] = next;
    }
  }
  if (type === "color") {
    const key = String(value);
    const current = state.roulette.bets.colors[key] || 0;
    removed = Math.min(amount, current);
    if (removed > 0) {
      const next = current - removed;
      if (next <= 0) delete state.roulette.bets.colors[key];
      else state.roulette.bets.colors[key] = next;
    }
  }
  if (type === "parity") {
    const key = String(value);
    const current = state.roulette.bets.parities[key] || 0;
    removed = Math.min(amount, current);
    if (removed > 0) {
      const next = current - removed;
      if (next <= 0) delete state.roulette.bets.parities[key];
      else state.roulette.bets.parities[key] = next;
    }
  }
  if (removed > 0) {
    state.balance += removed;
    updateBalance();
    updateRouletteUI();
    playSfx("hit");
    if (rouletteTotalBet() <= 0) {
      state.roulette.roundPaid = false;
    }
  }
}

function initRouletteTable() {
  const grid = document.getElementById("rouletteGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let num = 1; num <= 36; num += 1) {
    const cell = document.createElement("div");
    const color = redNumbers.has(num) ? "red" : "black";
    cell.className = `roulette-cell ${color}`;
    cell.textContent = num;
    cell.dataset.number = String(num);
    cell.setAttribute("data-tooltip", "Payout 35:1");
    const stack = document.createElement("div");
    stack.className = "chip-stack";
    cell.appendChild(stack);
    grid.appendChild(cell);
  }
}

function initRouletteRing() {
  const ring = document.getElementById("rouletteRing");
  const wheel = document.getElementById("rouletteWheel");
  if (!ring) return;
  ring.innerHTML = "";
  const segment = 360 / rouletteOrder.length;
  ring.style.setProperty("--ring-offset", `${segment / 2}deg`);
  if (wheel) {
    let angle = 0;
    const slices = rouletteOrder.map((value) => {
      const color =
        value === 0 || value === "00"
          ? "#16a34a"
          : redNumbers.has(value)
            ? "#b91c1c"
            : "#111827";
      const start = angle;
      const end = angle + segment;
      angle = end;
      return `${color} ${start}deg ${end}deg`;
    });
    wheel.style.background = `conic-gradient(${slices.join(", ")})`;
  }
  rouletteOrder.forEach((value, index) => {
    const num = document.createElement("div");
    num.className = "roulette-number";
    const color =
      value === 0 || value === "00" ? "green" : redNumbers.has(value) ? "red" : "black";
    num.classList.add(color);
    num.textContent = value;
    num.dataset.number = String(value);
    num.style.setProperty("--angle", `${index * segment}deg`);
    ring.appendChild(num);
  });
}

function spinRouletteWheel(resultNumber) {
  const wheel = document.getElementById("rouletteWheel");
  const ball = document.getElementById("rouletteBall");
  const ring = document.getElementById("rouletteRing");
  if (!wheel || !ball) return;
  if (ring) {
    ring.querySelectorAll(".roulette-number").forEach((el) => {
      el.classList.remove("winning");
    });
  }
  document
    .querySelectorAll(".roulette-cell.winning")
    .forEach((el) => el.classList.remove("winning"));
  const zeroCell = document.querySelector(".roulette-zero");
  const doubleZeroCell = document.querySelector(".roulette-zero.double-zero");
  zeroCell?.classList.remove("winning");
  doubleZeroCell?.classList.remove("winning");

  const index = rouletteOrder.indexOf(resultNumber);
  const segment = 360 / rouletteOrder.length;
  const ringOffset = segment / 2;
  const pointerOffset = 0;
  const targetAngle = pointerOffset - ringOffset - index * segment;
  const spins = 4 + Math.floor(Math.random() * 3);
  const normalized = rouletteRotation % 360;
  rouletteRotation = rouletteRotation - normalized + spins * 360 + targetAngle;
  wheel.style.transform = `rotate(${rouletteRotation}deg)`;
  ball.classList.remove("landed");
  void ball.offsetWidth;
  setTimeout(() => {
    const ringTarget = ring?.querySelector(
      `.roulette-number[data-number="${resultNumber}"]`
    );
    ringTarget?.classList.add("winning");
    if (resultNumber === 0) {
      zeroCell?.classList.add("winning");
    } else if (resultNumber === "00") {
      document.querySelector(".roulette-zero.double-zero")?.classList.add("winning");
    } else {
      document
        .querySelector(`.roulette-cell[data-number="${resultNumber}"]`)
        ?.classList.add("winning");
    }
    ball.classList.add("landed");
  }, 2600);
}

function initPoker() {
  const dealBtn = document.getElementById("pokerDeal");
  const drawBtn = document.getElementById("pokerDraw");
  const clearTableBtn = document.getElementById("pokerClearTable");
  const callRaiseBtn = document.getElementById("pokerCallRaise");
  const foldBtn = document.getElementById("pokerFold");
  const pokerChips = document.querySelectorAll('#poker .chip');
  const autoToggle = null;

  const updatePokerTotal = () => {
    const showPot = state.poker.inRound || state.poker.awaitingClear;
    const total = showPot ? state.poker.pot : state.poker.blind;
    const totalEl = document.getElementById("pokerBetTotal");
    if (totalEl) updateBetTotal(total, "pokerBetTotal");
    makeChipStack(document.getElementById("pokerPotStack"), total);
    const betLabel = document.getElementById("pokerBetLabel");
  if (betLabel) betLabel.textContent = showPot ? "Total Pot" : "Blind";
};

  updatePokerUiForPhase();

  const scheduleAutoPoker = () => {};

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
    updatePokerUiForPhase();
  };

  const removePokerBet = (amount) => {
    if (state.poker.inRound) {
      if (pokerBetPhaseActive()) {
        state.poker.betAmount = Math.max(
          0,
          Math.min(state.balance, state.poker.betAmount - amount)
        );
        updatePokerTotal();
        updatePokerUiForPhase();
        return;
      }
      showCenterToast("Betting is closed.", "danger");
      return;
    }
    state.poker.blind = Math.max(1, state.poker.blind - amount);
    updatePokerTotal();
    updatePokerUiForPhase();
  };

  pokerChips.forEach((chip) => {
    if (chip.id === "pokerAllIn") {
      chip.addEventListener("click", () => {
        if (state.poker.inRound) {
          if (pokerBetPhaseActive()) {
            state.poker.betAmount = state.balance;
            updatePokerTotal();
            updatePokerUiForPhase();
            return;
          }
          showCenterToast("Betting is closed.", "danger");
          return;
        }
        state.poker.blind = Math.max(1, state.balance);
        updatePokerTotal();
        updatePokerUiForPhase();
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


  dealBtn.addEventListener("click", () => {
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

  drawBtn.addEventListener("click", () => {
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

function initBlackjack() {
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
        div.textContent = formatCard(card);
        div.setAttribute("data-rank", formatCard(card));
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
      const labelPrefix = multiple ? `Hand ${index + 1} ` : "You ";
      if (playerTotal > 21) {
        playSfx("lose");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}busts.` : `${labelPrefix}bust.`,
          tone: "danger",
        });
        return;
      }
      if (dealerTotal > 21 || playerTotal > dealerTotal) {
        const payoutAmount =
          hand.length === 2 && playerTotal === 21 ? bet * 2.5 : bet * 2;
        payout(payoutAmount);
        playSfx("win");
        if (payoutAmount >= bet * 5) {
          triggerBigWin();
        }
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}wins!` : `${labelPrefix}win!`,
          tone: "win",
        });
      } else if (dealerTotal === playerTotal) {
        payout(bet);
        playSfx("win");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}pushes.` : `${labelPrefix}push.`,
          tone: "win",
        });
      } else {
        playSfx("lose");
        outcomeQueue.push({
          text: multiple ? `${labelPrefix}loses.` : `${labelPrefix}lose.`,
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
      setStatus("bjStatus", "Max bet is $100.", "danger");
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
    state.blackjack.betAmount = 100;
    updateBjTotal();
  });

  dealBtn.addEventListener("click", () => {
    if (state.blackjack.inRound) {
      setStatus("bjStatus", "");
      syncBetTotal();
      showCenterToast("Round already running.", "danger");
      return;
    }
    const bet = state.blackjack.betAmount;
    if (bet <= 0) {
      setStatus("bjStatus", "");
      showCenterToast("Place a bet.", "danger");
      return;
    }
    state.blackjack.lastBet = bet;
    const message = withBet(bet, () => {
      playSfx("deal");
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
      updateBlackjackControls();
      renderCards("bjDealer", state.blackjack.dealer, true);
      document.getElementById("bjPlayerTotal").textContent = "";
      document.getElementById("bjDealerTotal").textContent = "Total: ?";
      setStatus("bjStatus", "");
    });
    if (message) {
      setStatus("bjStatus", "");
      showCenterToast(message, "danger");
    }
  });

  hitBtn.addEventListener("click", () => {
    if (!state.blackjack.inRound) {
      setStatus("bjStatus", "");
      showCenterToast("Deal first.", "danger");
      return;
    }
    playSfx("hit");
    const hand = state.blackjack.hands[state.blackjack.activeHand];
    hand.push(draw(state.blackjack.deck));
    renderBlackjackHands();
    if (handTotal(hand) > 21) {
      playSfx("lose");
      const multiple = state.blackjack.hands.length > 1;
      const labelPrefix = multiple
        ? `Hand ${state.blackjack.activeHand + 1} `
        : "You ";
      const message = {
        text: multiple ? `${labelPrefix}busts.` : `${labelPrefix}bust.`,
        tone: "danger",
      };
      if (state.blackjack.activeHand === state.blackjack.hands.length - 1) {
        state.blackjack.pendingMessages.push(message);
      } else {
        showCenterToast(message.text, message.tone);
      }
      state.blackjack.busted[state.blackjack.activeHand] = true;
      advanceHandOrDealer();
    } else {
      updateBlackjackControls();
    }
  });

  standBtn.addEventListener("click", () => {
    if (!state.blackjack.inRound) {
      setStatus("bjStatus", "");
      showCenterToast("Deal first.", "danger");
      return;
    }
    playSfx("hit");
    advanceHandOrDealer();
  });

  doubleBtn.addEventListener("click", () => {
    if (!state.blackjack.inRound) return;
    const hand = state.blackjack.hands[state.blackjack.activeHand];
    if (hand.length !== 2) return;
    const bet = state.blackjack.bets[state.blackjack.activeHand];
    if (bet > state.balance) {
      showCenterToast("Not enough credits to double.", "danger");
      return;
    }
    playSfx("hit");
    state.balance -= bet;
    updateBalance();
    state.blackjack.bets[state.blackjack.activeHand] = bet * 2;
    state.blackjack.doubled[state.blackjack.activeHand] = true;
    syncBetTotal();
    hand.push(draw(state.blackjack.deck));
    renderBlackjackHands();
    advanceHandOrDealer();
  });

  splitBtn.addEventListener("click", () => {
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

function initRoulette() {
  const betInput = document.getElementById("rouletteBet");
  const spinBtn = document.getElementById("rouletteSpin");
  const resultEl = document.getElementById("rouletteResult");
  const clearBtn = document.getElementById("rouletteClear");
  const chaosBtn = document.getElementById("rouletteChaos");
  const autoToggle = document.getElementById("rouletteAuto");

  initRouletteRing();
  initRouletteTable();
  const zeroZone = document.querySelector(".roulette-zero");
  const doubleZeroZone = document.querySelector(".roulette-zero.double-zero");
  if (zeroZone) zeroZone.setAttribute("data-tooltip", "Payout 35:1");
  if (doubleZeroZone) doubleZeroZone.setAttribute("data-tooltip", "Payout 35:1");
  document
    .querySelectorAll(".bet-zone.color")
    .forEach((zone) => zone.setAttribute("data-tooltip", "Payout 1:1"));
  document
    .querySelectorAll(".bet-zone.parity")
    .forEach((zone) => zone.setAttribute("data-tooltip", "Payout 1:1"));
  updateRouletteUI();

  const rouletteChips = document.querySelectorAll(
    '.chips[data-target="rouletteBet"] .chip'
  );
  if (rouletteChips.length > 0) {
    rouletteChips.forEach((chip) => chip.classList.remove("active"));
    rouletteChips[0].classList.add("active");
    rouletteSelectedChip = Number(rouletteChips[0].dataset.amount) || rouletteSelectedChip;
  }

  clearBtn?.addEventListener("click", () => {
    const refund = rouletteTotalBet();
    state.roulette.bets.numbers = {};
    state.roulette.bets.colors = {};
    state.roulette.bets.parities = {};
    state.roulette.roundPaid = false;
    if (refund > 0) {
      state.balance += refund;
      updateBalance();
    }
    updateRouletteUI();
    playSfx("lose");
    setStatus("rouletteStatus", "Bets cleared.", "danger");
    showCenterToast("Bets cleared.", "danger");
  });

  chaosBtn?.addEventListener("click", () => {
    if (state.roulette.spinning) return;
    const chips = Array.from(
      document.querySelectorAll('.chips[data-target="rouletteBet"] .chip')
    ).map((chip) => Number(chip.dataset.amount)).filter((amount) => amount > 0);
    if (chips.length === 0) return;
    const placements = 3 + Math.floor(Math.random() * 5);
    const targets = [];
    for (let n = 0; n <= 36; n += 1) targets.push({ type: "number", value: n });
    targets.push({ type: "number", value: "00" });
    targets.push({ type: "color", value: "red" });
    targets.push({ type: "color", value: "black" });
    targets.push({ type: "parity", value: "odd" });
    targets.push({ type: "parity", value: "even" });

    let tries = 0;
    let placed = 0;
    let spent = 0;
    while (placed < placements && tries < 60) {
      tries += 1;
      const remainingBalance = state.balance - spent;
      if (remainingBalance <= 0) break;
      const target = targets[Math.floor(Math.random() * targets.length)];
      const key = String(target.value);
      const current =
        target.type === "number"
          ? state.roulette.bets.numbers[key] || 0
          : target.type === "color"
            ? state.roulette.bets.colors[key] || 0
            : state.roulette.bets.parities[key] || 0;
      const remaining = 50 - current;
      if (remaining <= 0) continue;
      const amount = chips[Math.floor(Math.random() * chips.length)];
      const betAmount = Math.min(amount, remaining, remainingBalance);
      if (betAmount <= 0) break;

      let zone;
      if (target.type === "number") {
        zone =
          target.value === "00"
            ? document.querySelector(".roulette-zero.double-zero")
            : target.value === 0
              ? document.querySelector(".roulette-zero")
              : document.querySelector(`.roulette-cell[data-number="${target.value}"]`);
      } else if (target.type === "color") {
        zone = document.querySelector(`.bet-zone.color.${target.value}`);
      } else {
        zone = document.querySelector(`.bet-zone.parity.${target.value}`);
      }

      const added = placeRouletteBet(
        target.type,
        target.value,
        betAmount,
        chaosBtn,
        zone?.querySelector(".chip-stack") || zone,
        { deferBalance: true, availableBalance: remainingBalance }
      );
      if (added > 0) {
        spent += added;
        placed += 1;
      }
    }
    if (spent > 0) {
      state.balance -= spent;
      updateBalance();
      showCenterToast(`Luck grenade! -$${spent}`, "win");
      state.roulette.roundPaid = true;
    } else {
      showCenterToast("Luck grenade fizzled.", "danger");
    }
  });


  const dropZones = document.querySelectorAll(
    ".roulette-cell, .roulette-zero, .bet-zone"
  );
  dropZones.forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      zone.classList.add("drop-active");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drop-active"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("drop-active");
      if (state.roulette.spinning) {
        showCenterToast("Wait for the wheel to stop.", "danger");
        setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
        return;
      }
      const amount =
        Number(event.dataTransfer.getData("text/plain")) || rouletteSelectedChip || 0;
      if (!amount) return;
      if (zone.dataset.number !== undefined) {
        const numberValue =
          zone.dataset.number === "00" ? "00" : Number(zone.dataset.number);
        placeRouletteBet(
          "number",
          numberValue,
          amount,
          lastDragSource,
          zone.querySelector(".chip-stack") || zone
        );
      }
      if (zone.dataset.color) {
        placeRouletteBet(
          "color",
          zone.dataset.color,
          amount,
          lastDragSource,
          zone.querySelector(".chip-stack") || zone
        );
      }
      if (zone.dataset.parity) {
        placeRouletteBet(
          "parity",
          zone.dataset.parity,
          amount,
          lastDragSource,
          zone.querySelector(".chip-stack") || zone
        );
      }
    });
    zone.addEventListener("click", () => {
      if (state.roulette.spinning) {
        showCenterToast("Wait for the wheel to stop.", "danger");
        setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
        return;
      }
      if (!rouletteSelectedChip) return;
      if (zone.dataset.number !== undefined) {
        const numberValue =
          zone.dataset.number === "00" ? "00" : Number(zone.dataset.number);
        placeRouletteBet(
          "number",
          numberValue,
          rouletteSelectedChip,
          document.querySelector('.chips[data-target="rouletteBet"] .chip.active') ||
            zone,
          zone.querySelector(".chip-stack") || zone
        );
      }
      if (zone.dataset.color) {
        placeRouletteBet(
          "color",
          zone.dataset.color,
          rouletteSelectedChip,
          document.querySelector('.chips[data-target="rouletteBet"] .chip.active') ||
            zone,
          zone.querySelector(".chip-stack") || zone
        );
      }
      if (zone.dataset.parity) {
        placeRouletteBet(
          "parity",
          zone.dataset.parity,
          rouletteSelectedChip,
          document.querySelector('.chips[data-target="rouletteBet"] .chip.active') ||
            zone,
          zone.querySelector(".chip-stack") || zone
        );
      }
    });
    zone.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (state.roulette.spinning) {
        showCenterToast("Wait for the wheel to stop.", "danger");
        setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
        return;
      }
      const removeAmount = rouletteSelectedChip || 5;
      if (zone.dataset.number !== undefined) {
        const numberValue =
          zone.dataset.number === "00" ? "00" : Number(zone.dataset.number);
        removeRouletteBet("number", numberValue, removeAmount);
      }
      if (zone.dataset.color) {
        removeRouletteBet("color", zone.dataset.color, removeAmount);
      }
      if (zone.dataset.parity) {
        removeRouletteBet("parity", zone.dataset.parity, removeAmount);
      }
    });
  });

  spinBtn.addEventListener("click", () => {
    if (state.roulette.spinning) {
      setStatus("rouletteStatus", "Wheel is spinning...", "danger");
      showCenterToast("Wheel is spinning...", "danger");
      return;
    }
    const totalBet = rouletteTotalBet();
    const chosenNumbers = state.roulette.bets.numbers;
    const chosenColors = state.roulette.bets.colors;
    const chosenParities = state.roulette.bets.parities;

    if (totalBet <= 0) {
      setStatus("rouletteStatus", "Pick at least one bet type.", "danger");
      showCenterToast("Place a bet on the table.", "danger");
      return;
    }
    if (!state.roulette.roundPaid) {
      if (totalBet > state.balance) {
        setStatus("rouletteStatus", "Not enough credits.", "danger");
        showCenterToast("Not enough credits.", "danger");
        state.roulette.bets.numbers = {};
        state.roulette.bets.colors = {};
        state.roulette.bets.parities = {};
        updateRouletteUI();
        state.roulette.roundPaid = false;
        return;
      }
      state.balance -= totalBet;
      updateBalance();
      state.roulette.roundPaid = true;
    }

    state.roulette.spinning = true;
    spinBtn.disabled = true;
    playSfx("spin");
    const spin = rouletteOrder[Math.floor(Math.random() * rouletteOrder.length)];
    const color =
      spin === 0 || spin === "00" ? "green" : redNumbers.has(spin) ? "red" : "black";
    const parity =
      spin === 0 || spin === "00" ? "none" : spin % 2 === 0 ? "even" : "odd";

    let winnings = 0;
    let winningStake = 0;
    const wins = [];

    const numberAmount = chosenNumbers[String(spin)];
    if (numberAmount) {
      winnings += numberAmount * 35;
      winningStake += numberAmount;
      wins.push(`Number ${spin}`);
    }

    const colorAmount = chosenColors[color];
    if (colorAmount) {
      winnings += colorAmount;
      winningStake += colorAmount;
      wins.push(`${color} wins`);
    }

    const parityAmount = chosenParities[parity];
    if (parityAmount) {
      winnings += parityAmount;
      winningStake += parityAmount;
      wins.push(`${parity} wins`);
    }

    spinRouletteWheel(spin);
    setTimeout(() => {
      resultEl.textContent = `Ball lands on ${spin} (${color}).`;
      if (winnings > 0) {
        payout(winnings + winningStake);
        playSfx("win");
        if (winnings + winningStake >= totalBet * 5) {
          triggerBigWin();
        }
        setStatus("rouletteStatus", `You win! ${wins.join(" + ")}.`, "win");
        showCenterToast(`Win! +$${Math.round(winnings)}`, "win");
      } else {
        playSfx("lose");
        setStatus("rouletteStatus", "No win this spin.", "danger");
        showCenterToast("No win.", "danger");
      }
      if (!autoToggle?.checked) {
        state.roulette.bets.numbers = {};
        state.roulette.bets.colors = {};
        state.roulette.bets.parities = {};
        updateRouletteUI();
        state.roulette.roundPaid = false;
      }
      state.roulette.spinning = false;
      spinBtn.disabled = false;
      if (autoToggle?.checked && rouletteTotalBet() > 0) {
        state.roulette.roundPaid = false;
        setTimeout(() => {
          if (!state.roulette.spinning && autoToggle.checked) {
            spinBtn.click();
          }
        }, 700);
      }
    }, 2600);
  });
}

function initSlots() {
  const spinBtn = document.getElementById("slotsSpin");
  const reels = document.querySelectorAll(".reel");
  const lever = document.getElementById("slotsLever");
  const winLight = document.querySelector(".slots-payout-light");
  const presets = document.querySelectorAll(".slots-presets .preset");
  const autoToggle = document.getElementById("slotsAuto");
  let currentBet = 5;
  let spinning = false;
  const estimateSpinDuration = (ticks, start = 60, increment = 6, maxDelay = 140) => {
    let delay = start;
    let total = 0;
    for (let i = 0; i < ticks; i += 1) {
      total += delay;
      delay = Math.min(maxDelay, delay + increment);
    }
    return total;
  };

  const buildReelStrip = (reel) => {
    const height = reel.clientHeight || 96;
    const windowEl = document.createElement("div");
    windowEl.className = "reel-window";
    const symbolCount = slotSymbols.length;
    const maxCycles = 4;
    const total = symbolCount * (maxCycles + 1);
    windowEl.style.height = `${height * total}px`;
    windowEl.dataset.symbolCount = String(symbolCount);
    windowEl.dataset.stripTotal = String(total);
    windowEl.dataset.symbolHeight = String(height);
    for (let i = 0; i < total; i += 1) {
      const span = document.createElement("span");
      const symbol = slotSymbols[i % symbolCount];
      span.textContent = symbol;
      span.style.setProperty("--symbol-offset", "2px");
      span.style.height = `${height}px`;
      windowEl.appendChild(span);
    }
    reel.textContent = "";
    reel.appendChild(windowEl);
    windowEl.style.transition = "none";
    windowEl.style.transform = "translateY(0px)";
  };

  reels.forEach((reel) => {
    if (!reel.querySelector(".reel-window")) {
      buildReelStrip(reel);
    }
  });

  presets.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (spinning || autoToggle?.checked) {
        showCenterToast("Reels are spinning...", "danger");
        return;
      }
      presets.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentBet = Number(btn.dataset.amount) || currentBet;
      playSfx("hit");
    });
  });

  const pullLever = () => {
    if (spinning) {
      showCenterToast("Reels are spinning...", "danger");
      return;
    }
    const bet = currentBet;
    const message = withBet(bet, () => {
      spinning = true;
      spinBtn.disabled = true;
      playSfx("spin");
      if (lever) {
        lever.classList.add("pull");
        setTimeout(() => lever.classList.remove("pull"), 220);
      }
      const reelsEl = document.getElementById("slotsReels");
      reelsEl.classList.remove("spin");
      void reelsEl.offsetWidth;
      reelsEl.classList.add("spin");
      const result = Array.from({ length: 3 }, () =>
        slotSymbols[Math.floor(Math.random() * slotSymbols.length)]
      );

      let maxDuration = 0;

      reels.forEach((reel, index) => {
        let windowEl = reel.querySelector(".reel-window");
        const currentHeight = reel.clientHeight || 96;
        if (!windowEl || Number(windowEl.dataset.symbolHeight) !== currentHeight) {
          buildReelStrip(reel);
          windowEl = reel.querySelector(".reel-window");
        }
        reel.classList.add("spinning");
        if (windowEl) {
          windowEl.style.textDecoration = "none";
        }
        if (!windowEl) return;
        const symbolCount = Number(windowEl.dataset.symbolCount) || slotSymbols.length;
        const stripTotal = Number(windowEl.dataset.stripTotal) || symbolCount * 5;
        const reelHeight = Number(windowEl.dataset.symbolHeight) || currentHeight;
        const targetIndex = slotSymbols.indexOf(result[index]);
        const cycles = 2 + index;
        const steps = cycles * symbolCount + targetIndex;
        const maxSteps = Math.max(0, stripTotal - 1);
        const distance = Math.min(steps, maxSteps) * reelHeight;
        const duration = 1200 + index * 320;
        maxDuration = Math.max(maxDuration, duration);

        windowEl.style.transition = "none";
        windowEl.style.transform = "translateY(0px)";
        void windowEl.offsetWidth;
        windowEl.style.transition = `transform ${duration}ms cubic-bezier(0.18, 0.75, 0.08, 1)`;
        windowEl.style.transform = `translateY(-${distance}px)`;
        windowEl.addEventListener(
          "transitionend",
          () => {
            reel.classList.remove("spinning");
            reel.classList.add("stop");
            reel.classList.add("snap");
            setTimeout(() => {
              reel.classList.remove("stop");
              reel.classList.remove("snap");
            }, 260);
            const resetOffset = targetIndex * reelHeight;
            windowEl.style.transition = "none";
            windowEl.style.transform = `translateY(-${resetOffset}px)`;
            void windowEl.offsetWidth;
            playSfx("hit");
          },
          { once: true }
        );
      });

      const counts = result.reduce((acc, symbol) => {
        acc[symbol] = (acc[symbol] || 0) + 1;
        return acc;
      }, {});

      const values = Object.values(counts);
      let multiplier = 0;
      let payoutKey = "";
      const hasTwoKind = values.includes(2);
      const twoSymbol = hasTwoKind
        ? Object.keys(counts).find((key) => counts[key] === 2)
        : null;

      const hasThreeKind = values.includes(3);
      const tripleSymbol = hasThreeKind
        ? Object.keys(counts).find((key) => counts[key] === 3)
        : null;
      if (hasThreeKind) {
        if (tripleSymbol === "💎") {
          multiplier = 20;
          payoutKey = "3-diamond";
        } else if (tripleSymbol === "⭐") {
          multiplier = 12;
          payoutKey = "3-star";
        } else if (tripleSymbol === "🔔") {
          multiplier = 8;
          payoutKey = "3-bell";
        } else if (tripleSymbol === "🍇") {
          multiplier = 6;
          payoutKey = "3-grape";
        } else if (tripleSymbol === "🍒") {
          multiplier = 5;
          payoutKey = "3-cherry";
        } else if (tripleSymbol === "🍋") {
          multiplier = 4;
          payoutKey = "3-lemon";
        } else {
          multiplier = 3;
          payoutKey = "3-any";
        }
      } else if (hasTwoKind) {
        payoutKey = "2-any";
      }

      setTimeout(() => {
        winLight?.classList.remove("active");
        document
          .querySelectorAll(".payout-card.highlight")
          .forEach((card) => card.classList.remove("highlight"));
        if (hasThreeKind && tripleSymbol === "💥") {
          playSfx("lose");
          state.balance = 0;
          updateBalance();
          setStatus("slotsStatus", "");
          showCenterToast("Kaboom! Balance wiped.", "danger");
          winLight?.classList.remove("active");
          triggerBigWin(false);
          document
            .querySelectorAll(".payout-card.highlight")
            .forEach((card) => card.classList.remove("highlight"));
        } else if (hasTwoKind && twoSymbol === "💥") {
          playSfx("lose");
          setStatus("slotsStatus", "");
          showCenterToast("Bang! House takes it.", "danger");
        } else if (multiplier > 0 || hasTwoKind) {
          const payMultiplier = hasTwoKind ? 1.5 : multiplier;
          payout(bet * payMultiplier + bet);
          playSfx("win");
          if (hasThreeKind) {
            triggerBigWin();
          } else if (hasTwoKind) {
            triggerSmallWin();
          } else if (multiplier >= 10) {
            triggerBigWin();
          }
          setStatus("slotsStatus", "");
          showCenterToast(`You win ${payMultiplier}x!`, "win");
          winLight?.classList.add("active");
          if (payoutKey) {
            document
              .querySelector(`.payout-card[data-payout="${payoutKey}"]`)
              ?.classList.add("highlight");
          }
        } else {
          playSfx("lose");
          setStatus("slotsStatus", "");
          showCenterToast("No win. Spin again!", "danger");
        }
        spinning = false;
        spinBtn.disabled = false;
        if (autoToggle?.checked) {
          setTimeout(() => {
            if (!spinning && autoToggle.checked) {
              pullLever();
            }
          }, 800);
        }
      }, maxDuration + 240);
    });

    if (message) {
      setStatus("slotsStatus", "");
      showCenterToast(message, "danger");
    }
  };

  spinBtn.addEventListener("click", pullLever);
  lever?.addEventListener("click", pullLever);
  lever?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pullLever();
    }
  });
}

resetBankBtn.addEventListener("click", () => {
  state.balance = 1000;
  updateBalance();
  resetPokerRound();
  resetBlackjackRound();
  setStatus("rouletteStatus", "Bank reset. Place your bets.");
  setStatus("slotsStatus", "Bank reset. Spin away!");
});

updateBalance();
initTabs();
initChips();
initPoker();
initBlackjack();
initRoulette();
initSlots();
