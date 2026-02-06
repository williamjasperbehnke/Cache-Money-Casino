import { initCore } from "./core.js";
import { auth } from "./auth.js";

const gameLabels = {
  blackjack: "Blackjack",
  poker: "5-Card Poker",
  holdem: "Hold'em",
  roulette: "Roulette",
  slots: "Slots",
};

const formatLabel = (key) => {
  if (!key) return "—";
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
  return gameLabels[normalized] || gameLabels[key] || key;
};

const formatMoney = (value) => {
  const num = Number(value) || 0;
  return num >= 0 ? `+$${num}` : `-$${Math.abs(num)}`;
};

const renderStats = (stats) => {
  const totals = stats?.totals || {};
  const games = stats?.games || {};
  const recent = stats?.recent || [];

  const totalBets = document.getElementById("statTotalBets");
  const wins = document.getElementById("statWins");
  const losses = document.getElementById("statLosses");
  const net = document.getElementById("statNet");
  if (totalBets) totalBets.textContent = `$${totals.bets || 0}`;
  if (wins) wins.textContent = totals.wins || 0;
  if (losses) losses.textContent = totals.losses || 0;
  if (net) net.textContent = totals.net >= 0 ? `+$${totals.net || 0}` : `-$${Math.abs(totals.net || 0)}`;

  const gameStats = document.getElementById("gameStats");
  if (gameStats) {
    gameStats.innerHTML = "";
    Object.entries(games).forEach(([key, value]) => {
      const card = document.createElement("div");
      card.className = "account-card";
      card.innerHTML = `
        <h3>${formatLabel(key)}</h3>
        <div class="account-stat">Bets: $${value.bets || 0}</div>
        <div class="account-stat">Wins: ${value.wins || 0}</div>
        <div class="account-stat">Losses: ${value.losses || 0}</div>
        <div class="account-stat">Net: ${value.net >= 0 ? `+$${value.net || 0}` : `-$${Math.abs(value.net || 0)}`}</div>
      `;
      gameStats.appendChild(card);
    });
  }

  const recentEl = document.getElementById("recentResults");
  if (recentEl) {
    recentEl.innerHTML = "";
    recent.forEach((entry) => {
      const row = document.createElement("div");
      row.textContent = `${formatLabel(entry.game)}: ${entry.result} ${formatMoney(entry.net)} (bet $${entry.bet})`;
      recentEl.appendChild(row);
    });
  }

  const favorite = document.getElementById("statFavorite");
  const winRate = document.getElementById("statWinRate");
  if (favorite) {
    const favKey = stats?.favorite;
    favorite.textContent = favKey ? formatLabel(favKey) : "—";
  }
  if (winRate) {
    const best = stats?.bestWinRate;
    if (!best || best === "—") {
      winRate.textContent = "—";
    } else {
      const [key, rate] = best.split(" ");
      const label = formatLabel(key);
      winRate.textContent = rate ? `${label} ${rate}` : label;
    }
  }
};

const wireBalanceUpdates = () => {
  const balanceEl = document.getElementById("accountBalance");
  const prev = auth.onBalanceUpdate;
  auth.onBalanceUpdate = (balance) => {
    if (prev) prev(balance);
    if (balanceEl) balanceEl.textContent = `$${balance}`;
  };
};

const initAccount = async () => {
  const section = document.getElementById("account");
  if (section) section.classList.add("loading");
  wireBalanceUpdates();

  if (!auth.isAuthed()) {
    renderStats({ totals: {}, games: {}, recent: [] });
    if (section) section.classList.remove("loading");
    return;
  }

  try {
    const me = await auth.fetchMe();
    const nameEl = document.getElementById("accountName");
    const balanceEl = document.getElementById("accountBalance");
    if (nameEl) nameEl.textContent = me.username;
    if (balanceEl) balanceEl.textContent = `$${me.balance}`;
    renderStats(me.stats || {});
    if (section) section.classList.remove("loading");
  } catch (err) {
    renderStats({ totals: {}, games: {}, recent: [] });
    if (section) section.classList.remove("loading");
  }
};

initCore();
initAccount();
