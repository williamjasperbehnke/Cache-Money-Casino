import {
  state,
  updateBalance,
  showCenterToast,
  updateBetTotal,
  makeChipStack,
  lockPanel,
  playSfx,
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
      onBtn: document.getElementById("crapsTableOn"),
      offBtn: document.getElementById("crapsTableOff"),
      autoToggle: document.getElementById("crapsAuto"),
      betTotal: document.getElementById("crapsBet"),
      pointStrip: document.getElementById("crapsPointStrip"),
      rollEl: document.getElementById("crapsLastRoll"),
      lastDie1: document.getElementById("crapsLastDie1"),
      lastDie2: document.getElementById("crapsLastDie2"),
      lastTotal: document.getElementById("crapsLastTotal"),
      die1: document.getElementById("crapsDie1"),
      die2: document.getElementById("crapsDie2"),
      betZones: document.querySelectorAll("#craps [data-bet]"),
      chips: document.querySelectorAll("#craps .chip"),
    };
  }

  totalBet() {
    const { pass, dont, field, come, place, hardways, comePoints } = state.craps.bets;
    const sum = (obj) =>
      Object.values(obj || {}).reduce((total, val) => total + (Number(val) || 0), 0);
    return pass + dont + field + come + sum(place) + sum(hardways) + sum(comePoints);
  }

  setBet(key, amount) {
    state.craps.bets[key] = Math.max(0, amount);
  }

  getBetByKey(key) {
    if (key.startsWith("place-")) {
      const num = key.split("-")[1];
      return state.craps.bets.place?.[num] || 0;
    }
    if (key.startsWith("hard-")) {
      const num = key.split("-")[1];
      return state.craps.bets.hardways?.[num] || 0;
    }
    if (key.startsWith("come-")) {
      const num = key.split("-")[1];
      return state.craps.bets.comePoints?.[num] || 0;
    }
    return state.craps.bets[key] || 0;
  }

  setBetByKey(key, amount) {
    const value = Math.max(0, amount);
    if (key.startsWith("place-")) {
      const num = key.split("-")[1];
      state.craps.bets.place[num] = value;
      return;
    }
    if (key.startsWith("hard-")) {
      const num = key.split("-")[1];
      state.craps.bets.hardways[num] = value;
      return;
    }
    if (key.startsWith("come-")) {
      const num = key.split("-")[1];
      state.craps.bets.comePoints[num] = value;
      return;
    }
    state.craps.bets[key] = value;
  }

  updateUI() {
    updateBetTotal(this.totalBet(), "crapsBet");
    if (this.ui.onBtn && this.ui.offBtn) {
      this.ui.onBtn.classList.toggle("ghost", !state.craps.tableOn);
      this.ui.offBtn.classList.toggle("ghost", state.craps.tableOn);
    }
    if (this.ui.autoToggle) {
      this.ui.autoToggle.checked = Boolean(state.craps.autoBet);
    }
    if (this.ui.pointStrip) {
      const active = String(state.craps.point || "");
      this.ui.pointStrip.querySelectorAll("span").forEach((el) => {
        el.classList.toggle("active", el.dataset.point === active);
      });
    }
    if (this.ui.lastTotal) {
      this.ui.lastTotal.textContent = state.craps.lastRoll ? String(state.craps.lastRoll) : "--";
    }
    this.ui.betZones?.forEach((zone) => {
      const key = zone.dataset.bet || "";
      const stack = zone.querySelector(".chip-stack");
      if (!stack) return;
      makeChipStack(stack, this.getBetByKey(key));
    });
  }

  setDiceFaces(total) {
    const die1 = Math.min(6, Math.max(1, Math.ceil(total / 2)));
    const die2 = Math.max(1, Math.min(6, total - die1));
    if (this.ui.die1) this.ui.die1.dataset.face = String(die1);
    if (this.ui.die2) this.ui.die2.dataset.face = String(die2);
    if (this.ui.lastDie1) this.ui.lastDie1.dataset.face = String(die1);
    if (this.ui.lastDie2) this.ui.lastDie2.dataset.face = String(die2);
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
      if (typeof payload.state.tableOn === "boolean") {
        state.craps.tableOn = payload.state.tableOn;
      }
      state.craps.bets = {
        pass: Number(payload.state.bets?.pass) || 0,
        dont: Number(payload.state.bets?.dont) || 0,
        field: Number(payload.state.bets?.field) || 0,
        come: Number(payload.state.bets?.come) || 0,
        place: {
          4: Number(payload.state.bets?.place?.[4]) || 0,
          5: Number(payload.state.bets?.place?.[5]) || 0,
          6: Number(payload.state.bets?.place?.[6]) || 0,
          8: Number(payload.state.bets?.place?.[8]) || 0,
          9: Number(payload.state.bets?.place?.[9]) || 0,
          10: Number(payload.state.bets?.place?.[10]) || 0,
        },
        hardways: {
          4: Number(payload.state.bets?.hardways?.[4]) || 0,
          6: Number(payload.state.bets?.hardways?.[6]) || 0,
          8: Number(payload.state.bets?.hardways?.[8]) || 0,
          10: Number(payload.state.bets?.hardways?.[10]) || 0,
        },
        comePoints: {
          4: Number(payload.state.bets?.comePoints?.[4]) || 0,
          5: Number(payload.state.bets?.comePoints?.[5]) || 0,
          6: Number(payload.state.bets?.comePoints?.[6]) || 0,
          8: Number(payload.state.bets?.comePoints?.[8]) || 0,
          9: Number(payload.state.bets?.comePoints?.[9]) || 0,
          10: Number(payload.state.bets?.comePoints?.[10]) || 0,
        },
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

  bindZone(zone) {
    if (!zone) return;
    zone.addEventListener("click", () => {
      if (state.craps.rolling) return;
      const key = zone.dataset.bet || "";
      const current = this.getBetByKey(key);
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
      this.setBetByKey(key, current + delta);
      state.balance -= delta;
      state.craps.roundPaid = true;
      updateBalance();
      this.updateUI();
    });

    zone.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (state.craps.rolling) return;
      const removeAmount = this.selectedChip || 5;
      const key = zone.dataset.bet || "";
      const current = this.getBetByKey(key);
      if (!current) return;
      const delta = Math.min(removeAmount, current);
      this.setBetByKey(key, current - delta);
      state.balance += delta;
      updateBalance();
      state.craps.roundPaid = this.totalBet() > 0;
      this.updateUI();
    });
  }

  async roll(fromAuto = false) {
    if (state.craps.rolling) return;
    if (this.totalBet() <= 0) {
      if (!fromAuto) {
        showCenterToast("Place a bet to roll.", "danger");
      }
      return;
    }
    state.craps.rolling = true;
    if (this.ui.rollBtn) this.ui.rollBtn.disabled = true;
    const stopDice = this.animateDice(520);
    playSfx("spin");
    const unlock = lockPanel("craps");
    try {
      const payload = await auth.request("/api/games/craps/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bets: state.craps.bets, paid: true, tableOn: state.craps.tableOn }),
      });
      this.applyServerState(payload);
      stopDice();
      if (Number.isFinite(payload?.roll)) this.setDiceFaces(payload.roll);
      this.updateUI();
      if (this.ui.lastTotal) {
        this.ui.lastTotal.classList.remove("pulse");
        void this.ui.lastTotal.offsetWidth;
        this.ui.lastTotal.classList.add("pulse");
      }
      if (payload.payout > 0) {
        showCenterToast(`Payout +$${Math.round(payload.payout)}`, "win");
      } else {
        showCenterToast("No win.", "danger");
      }
      if (state.craps.autoBet && this.totalBet() > 0) {
        setTimeout(() => this.roll(true), 420);
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
    state.craps.bets = {
      pass: 0,
      dont: 0,
      field: 0,
      come: 0,
      place: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0 },
      hardways: { 4: 0, 6: 0, 8: 0, 10: 0 },
      comePoints: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0 },
    };
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
    state.craps.bets = {
      pass: 0,
      dont: 0,
      field: 0,
      come: 0,
      place: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0 },
      hardways: { 4: 0, 6: 0, 8: 0, 10: 0 },
      comePoints: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0 },
    };
    state.craps.point = 0;
    state.craps.roundPaid = false;
    state.craps.lastRoll = null;
    state.craps.tableOn = true;
    this.updateUI();
  }

  init() {
    this.cacheElements();
    this.bindChipEvents();
    this.ui.betZones?.forEach((zone) => this.bindZone(zone));
    this.ui.rollBtn?.addEventListener("click", () => this.roll());
    this.ui.clearBtn?.addEventListener("click", () => this.clearBets());
    this.ui.autoToggle?.addEventListener("change", () => {
      state.craps.autoBet = this.ui.autoToggle.checked;
      this.updateUI();
      if (state.craps.autoBet && !state.craps.rolling && this.totalBet() > 0) {
        this.roll(true);
      }
    });
    this.ui.onBtn?.addEventListener("click", () => {
      state.craps.tableOn = true;
      this.updateUI();
    });
    this.ui.offBtn?.addEventListener("click", () => {
      state.craps.tableOn = false;
      this.updateUI();
    });
    this.selectChip(this.selectedChip, this.ui.chips[0]);
    this.updateUI();
    this.loadState();
  }
}
