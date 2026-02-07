import {
  state,
  updateBalance,
  showCenterToast,
  updateBetTotal,
  makeChipStack,
  lockPanel,
} from "./core.js";
import { auth } from "./auth.js";

const MAX_BET_PER_SLOT = 50;

export class CrapsGame {
  constructor() {
    this.selectedChip = 5;
    this.ui = {};
  }

  cacheElements() {
    this.ui = {
      rollBtn: document.getElementById("crapsRoll"),
      clearBtn: document.getElementById("crapsClear"),
      betTotal: document.getElementById("crapsBet"),
      pointEl: document.getElementById("crapsPoint"),
      rollEl: document.getElementById("crapsLastRoll"),
      die1: document.getElementById("crapsDie1"),
      die2: document.getElementById("crapsDie2"),
      passZone: document.querySelector('[data-bet="pass"]'),
      dontZone: document.querySelector('[data-bet="dont"]'),
      fieldZone: document.querySelector('[data-bet="field"]'),
      chips: document.querySelectorAll("#craps .chip"),
    };
  }

  totalBet() {
    const { pass, dont, field } = state.craps.bets;
    return pass + dont + field;
  }

  setBet(key, amount) {
    state.craps.bets[key] = Math.max(0, amount);
  }

  updateUI() {
    updateBetTotal(this.totalBet(), "crapsBet");
    if (this.ui.pointEl) {
      this.ui.pointEl.textContent = state.craps.point ? `Point: ${state.craps.point}` : "Point: --";
    }
    if (this.ui.rollEl) {
      const text = state.craps.lastRoll ? `Last Roll: ${state.craps.lastRoll}` : "Last Roll: --";
      this.ui.rollEl.textContent = text;
    }
    const passStack = this.ui.passZone?.querySelector(".chip-stack");
    const dontStack = this.ui.dontZone?.querySelector(".chip-stack");
    const fieldStack = this.ui.fieldZone?.querySelector(".chip-stack");
    makeChipStack(passStack, state.craps.bets.pass);
    makeChipStack(dontStack, state.craps.bets.dont);
    makeChipStack(fieldStack, state.craps.bets.field);
  }

  setDiceFaces(total) {
    const die1 = Math.min(6, Math.max(1, Math.ceil(total / 2)));
    const die2 = Math.max(1, Math.min(6, total - die1));
    if (this.ui.die1) this.ui.die1.dataset.face = String(die1);
    if (this.ui.die2) this.ui.die2.dataset.face = String(die2);
  }

  animateDice(duration = 500) {
    const { die1, die2 } = this.ui;
    if (!die1 || !die2) return () => {};
    die1.classList.add("rolling");
    die2.classList.add("rolling");
    const interval = setInterval(() => {
      die1.dataset.face = String(Math.floor(Math.random() * 6) + 1);
      die2.dataset.face = String(Math.floor(Math.random() * 6) + 1);
    }, 80);
    return () => {
      clearInterval(interval);
      die1.classList.remove("rolling");
      die2.classList.remove("rolling");
    };
  }

  applyServerState(payload) {
    if (payload?.state) {
      state.craps.point = Number(payload.state.point) || 0;
      state.craps.bets = {
        pass: Number(payload.state.bets?.pass) || 0,
        dont: Number(payload.state.bets?.dont) || 0,
        field: Number(payload.state.bets?.field) || 0,
      };
      state.craps.roundPaid = this.totalBet() > 0;
    }
    if (Number.isFinite(payload?.balance)) {
      state.balance = payload.balance;
      updateBalance();
    }
    if (Number.isFinite(payload?.roll)) {
      state.craps.lastRoll = payload.roll;
    }
  }

  selectChip(amount, btn) {
    this.selectedChip = amount;
    this.ui.chips.forEach((chip) => chip.classList.remove("active"));
    if (btn) btn.classList.add("active");
  }

  bindChipEvents() {
    this.ui.chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const amount = Number(chip.dataset.amount) || 0;
        if (!amount) return;
        this.selectChip(amount, chip);
      });
    });
  }

  bindZone(zone, key) {
    if (!zone) return;
    zone.addEventListener("click", () => {
      if (state.craps.rolling) return;
      const current = state.craps.bets[key] || 0;
      const available = MAX_BET_PER_SLOT - current;
      if (available <= 0) {
        showCenterToast("Max bet per slot is $50.", "danger");
        return;
      }
      if (state.balance <= 0) {
        showCenterToast("Not enough credits.", "danger");
        return;
      }
      const delta = Math.min(this.selectedChip, state.balance, available);
      this.setBet(key, current + delta);
      state.balance -= delta;
      state.craps.roundPaid = true;
      updateBalance();
      this.updateUI();
    });

    zone.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (state.craps.rolling) return;
      const removeAmount = this.selectedChip || 5;
      const current = state.craps.bets[key] || 0;
      if (!current) return;
      const delta = Math.min(removeAmount, current);
      this.setBet(key, current - delta);
      state.balance += delta;
      updateBalance();
      state.craps.roundPaid = this.totalBet() > 0;
      this.updateUI();
    });
  }

  async roll() {
    if (state.craps.rolling) return;
    if (this.totalBet() <= 0) {
      showCenterToast("Place a bet to roll.", "danger");
      return;
    }
    state.craps.rolling = true;
    if (this.ui.rollBtn) this.ui.rollBtn.disabled = true;
    const stopDice = this.animateDice(520);
    const unlock = lockPanel("craps");
    try {
      const payload = await auth.request("/api/games/craps/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bets: state.craps.bets, paid: true }),
      });
      this.applyServerState(payload);
      stopDice();
      if (Number.isFinite(payload?.roll)) this.setDiceFaces(payload.roll);
      this.updateUI();
      if (payload.payout > 0) {
        showCenterToast(`Payout +$${Math.round(payload.payout)}`, "win");
      } else {
        showCenterToast("No win.", "danger");
      }
    } catch (err) {
      stopDice();
      showCenterToast(err?.message || "Roll failed.", "danger");
    } finally {
      state.craps.rolling = false;
      if (this.ui.rollBtn) this.ui.rollBtn.disabled = false;
      unlock();
    }
  }

  clearBets() {
    const total = this.totalBet();
    if (total > 0) {
      state.balance += total;
      updateBalance();
    }
    state.craps.bets = { pass: 0, dont: 0, field: 0 };
    state.craps.roundPaid = false;
    this.updateUI();
  }

  async loadState() {
    try {
      const payload = await auth.request("/api/games/craps/state", { method: "GET" });
      if (payload?.state) this.applyServerState(payload);
    } catch (err) {
      // ignore
    }
  }

  reset() {
    state.craps.bets = { pass: 0, dont: 0, field: 0 };
    state.craps.point = 0;
    state.craps.roundPaid = false;
    state.craps.lastRoll = null;
    this.updateUI();
  }

  init() {
    this.cacheElements();
    this.bindChipEvents();
    this.bindZone(this.ui.passZone, "pass");
    this.bindZone(this.ui.dontZone, "dont");
    this.bindZone(this.ui.fieldZone, "field");
    this.ui.rollBtn?.addEventListener("click", () => this.roll());
    this.ui.clearBtn?.addEventListener("click", () => this.clearBets());
    this.selectChip(this.selectedChip, this.ui.chips[0]);
    this.updateUI();
    this.loadState();
  }
}
