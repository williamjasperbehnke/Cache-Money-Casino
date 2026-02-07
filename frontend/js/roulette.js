import {
  state,
  updateBalance,
  playSfx,
  showCenterToast,
  makeChipStack,
  animateChip,
  triggerBigWin,
  lockPanel,
} from "./core.js";
import { auth } from "./auth.js";

const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const rouletteOrder = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  "00", 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

const MAX_BET_PER_SLOT = 50;
const SPIN_DURATION = 2600;
const AUTO_SPIN_DELAY = 400;
const betZoneSelector = ".roulette-cell, .roulette-zero, .bet-zone";

export class RouletteGame {
  constructor() {
    this.rotation = 0;
    this.selectedChip = 5;
    this.ui = {};
  }

  cacheElements() {
    this.ui = {
      spinBtn: document.getElementById("rouletteSpin"),
      clearBtn: document.getElementById("rouletteClear"),
      chaosBtn: document.getElementById("rouletteChaos"),
      autoToggle: document.getElementById("rouletteAuto"),
      ring: document.getElementById("rouletteRing"),
      wheel: document.getElementById("rouletteWheel"),
      ball: document.getElementById("rouletteBall"),
      grid: document.getElementById("rouletteGrid"),
      betInput: document.getElementById("rouletteBet"),
    };
  }

  getZoneKey(zone) {
    return (
      zone.dataset.number ||
      (zone.classList.contains("color")
        ? zone.classList.contains("red")
          ? "red"
          : "black"
        : zone.classList.contains("odd")
          ? "odd"
          : "even")
    );
  }

  getZoneBucket(zone) {
    return zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")
      ? "numbers"
      : zone.classList.contains("color")
        ? "colors"
        : "parities";
  }

  getZoneCurrent(zone, key) {
    return state.roulette.bets[this.getZoneBucket(zone)][key] || 0;
  }

  setZoneBet(zone, key, value) {
    const bucket = this.getZoneBucket(zone);
    if (value <= 0) delete state.roulette.bets[bucket][key];
    else state.roulette.bets[bucket][key] = value;
  }

  totalBet() {
    const { numbers, colors, parities } = state.roulette.bets;
    const sum = (obj) => Object.values(obj).reduce((acc, val) => acc + val, 0);
    return sum(numbers) + sum(colors) + sum(parities);
  }

  updateUI() {
    const total = this.totalBet();
    if (this.ui.betInput) this.ui.betInput.textContent = `$${total}`;

    document.querySelectorAll(".roulette-cell .chip-stack").forEach((el) => {
      makeChipStack(el, 0);
    });
    makeChipStack(document.querySelector(".roulette-zero .chip-stack"), 0);
    makeChipStack(document.querySelector(".roulette-zero.double-zero .chip-stack"), 0);
    document.querySelectorAll(".bet-zone .chip-stack").forEach((el) => makeChipStack(el, 0));

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

  initTable() {
    const grid = this.ui.grid;
    if (!grid) return;
    grid.innerHTML = "";
    for (let number = 1; number <= 36; number += 1) {
      const color = redNumbers.has(number) ? "red" : "black";
      const cell = document.createElement("div");
      cell.className = `roulette-cell ${color}`;
      cell.dataset.number = number;
      cell.setAttribute("data-tooltip", "Pays 35:1");
      cell.textContent = number;
      const stack = document.createElement("div");
      stack.className = "chip-stack";
      cell.appendChild(stack);
      grid.appendChild(cell);
    }
  }

  initRing() {
    const ring = this.ui.ring;
    if (!ring) return;
    ring.innerHTML = "";
    const segment = 360 / rouletteOrder.length;
    ring.style.setProperty("--ring-offset", `${segment / 2}deg`);
    rouletteOrder.forEach((value, index) => {
      const num = document.createElement("div");
      num.className = "roulette-number";
      const color = value === 0 || value === "00" ? "green" : redNumbers.has(value) ? "red" : "black";
      num.classList.add(color);
      num.style.setProperty("--angle", `${segment * index}deg`);
      num.dataset.number = value;
      num.textContent = value;
      ring.appendChild(num);
    });
  }

  initWheel() {
    const wheel = this.ui.wheel;
    if (!wheel) return;
    const segment = 360 / rouletteOrder.length;
    const gradient = rouletteOrder
      .map((value, index) => {
        const color =
          value === 0 || value === "00"
            ? "#16a34a"
            : redNumbers.has(value)
              ? "#b91c1c"
              : "#111827";
        const start = index * segment;
        const end = start + segment;
        return `${color} ${start}deg ${end}deg`;
      })
      .join(", ");
    wheel.style.background = `conic-gradient(${gradient})`;
  }

  clearWinningHighlight() {
    this.ui.ring?.querySelectorAll(".roulette-number").forEach((el) => {
      el.classList.remove("winning");
    });
    document
      .querySelectorAll(".roulette-cell.winning")
      .forEach((el) => el.classList.remove("winning"));
    const zeroCell = document.querySelector(".roulette-zero");
    const doubleZeroCell = document.querySelector(".roulette-zero.double-zero");
    zeroCell?.classList.remove("winning");
    doubleZeroCell?.classList.remove("winning");
  }

  applyWinningHighlight(resultNumber) {
    const ringTarget = this.ui.ring?.querySelector(
      `.roulette-number[data-number="${resultNumber}"]`
    );
    ringTarget?.classList.add("winning");
    if (resultNumber === 0) {
      document.querySelector(".roulette-zero")?.classList.add("winning");
    } else if (resultNumber === "00") {
      document.querySelector(".roulette-zero.double-zero")?.classList.add("winning");
    } else {
      document
        .querySelector(`.roulette-cell[data-number="${resultNumber}"]`)
        ?.classList.add("winning");
    }
  }

  spinWheel(resultNumber) {
    const { wheel, ball } = this.ui;
    if (!wheel || !ball || !this.ui.ring) return;

    this.clearWinningHighlight();

    const index = rouletteOrder.indexOf(resultNumber);
    const segment = 360 / rouletteOrder.length;
    const ringOffset = segment / 2;
    const targetAngle = -ringOffset - index * segment;
    const spins = 4 + Math.floor(Math.random() * 3);
    const normalized = this.rotation % 360;
    this.rotation = this.rotation - normalized + spins * 360 + targetAngle;
    wheel.style.transform = `rotate(${this.rotation}deg)`;
    ball.classList.remove("landed");
    void ball.offsetWidth;
    setTimeout(() => {
      this.applyWinningHighlight(resultNumber);
      ball.classList.add("landed");
    }, SPIN_DURATION);
  }

  initChips() {
    const chips = document.querySelectorAll('.chips[data-target="rouletteBet"] .chip');
    chips.forEach((chip) => {
      chip.setAttribute("draggable", "true");
      chip.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", chip.dataset.amount);
        event.dataTransfer.effectAllowed = "copy";
      });
      chip.addEventListener("click", () => {
        const amount = Number(chip.dataset.amount);
        if (!Number.isFinite(amount)) return;
        this.selectedChip = amount;
        chip.parentElement?.querySelectorAll(".chip").forEach((btn) => btn.classList.remove("active"));
        chip.classList.add("active");
        playSfx("hit");
      });
    });

    if (chips.length > 0) {
      chips.forEach((chip) => chip.classList.remove("active"));
      chips[0].classList.add("active");
      this.selectedChip = Number(chips[0].dataset.amount) || this.selectedChip;
    }
  }

  clearBets() {
    const totalBet = this.totalBet();
    if (totalBet > 0) {
      state.balance += totalBet;
      updateBalance();
    }
    state.roulette.bets.numbers = {};
    state.roulette.bets.colors = {};
    state.roulette.bets.parities = {};
    state.roulette.roundPaid = false;
    this.updateUI();
  }

  bindZoneEvents(zone) {
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (state.roulette.spinning) return;
      zone.classList.add("drop-active");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drop-active"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("drop-active");
      if (state.roulette.spinning) return;
      const amount = Number(event.dataTransfer.getData("text/plain")) || this.selectedChip || 0;
      if (!amount) return;
      const key = this.getZoneKey(zone);
      const current = this.getZoneCurrent(zone, key);
      const next = Math.min(MAX_BET_PER_SLOT, current + amount);
      const delta = next - current;
      if (delta <= 0) {
        showCenterToast("Max bet per slot is $50.", "danger");
        return;
      }
      if (delta > state.balance) {
        showCenterToast("Not enough credits.", "danger");
        return;
      }
      state.balance -= delta;
      updateBalance();
      this.setZoneBet(zone, key, next);
      this.updateUI();
      state.roulette.roundPaid = true;
    });

    zone.addEventListener("click", () => {
      if (state.roulette.spinning) return;
      if (!this.selectedChip) return;
      const key = this.getZoneKey(zone);
      const current = this.getZoneCurrent(zone, key);
      const next = Math.min(MAX_BET_PER_SLOT, current + this.selectedChip);
      const delta = next - current;
      if (delta <= 0) {
        showCenterToast("Max bet per slot is $50.", "danger");
        return;
      }
      if (delta > state.balance) {
        showCenterToast("Not enough credits.", "danger");
        return;
      }
      state.balance -= delta;
      updateBalance();
      this.setZoneBet(zone, key, next);
      this.updateUI();
      animateChip(
        document.querySelector('.chips[data-target="rouletteBet"] .chip.active') ||
          zone.querySelector(".chip-stack") ||
          zone,
        zone.querySelector(".chip-stack") || zone
      );
      state.roulette.roundPaid = true;
    });

    zone.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (state.roulette.spinning) return;
      const removeAmount = this.selectedChip || 5;
      const key = this.getZoneKey(zone);
      const current = this.getZoneCurrent(zone, key);
      if (!current) return;
      const next = Math.max(0, current - removeAmount);
      this.setZoneBet(zone, key, next);
      state.balance += Math.min(removeAmount, current);
      updateBalance();
      this.updateUI();
      if (this.totalBet() <= 0) {
        state.roulette.roundPaid = false;
      }
    });
  }

  bindEvents() {
    const { spinBtn, clearBtn, chaosBtn, autoToggle } = this.ui;

    clearBtn?.addEventListener("click", () => {
      if (state.roulette.spinning) return;
      this.clearBets();
      playSfx("lose");
      showCenterToast("Bets cleared.", "danger");
    });

    chaosBtn?.addEventListener("click", async () => {
      if (state.roulette.spinning) return;
      const unlock = lockPanel("roulette");
      const chips = Array.from(
        document.querySelectorAll('.chips[data-target="rouletteBet"] .chip')
      )
        .map((chip) => Number(chip.dataset.amount))
        .filter((amount) => amount > 0);
      if (chips.length === 0) {
        unlock();
        return;
      }
      const available = Math.min(state.balance, 200);
      if (available <= 0) {
        showCenterToast("Not enough credits.", "danger");
        unlock();
        return;
      }
      try {
        const payload = await auth.request("/api/games/roulette/chaos", {
          method: "POST",
          body: JSON.stringify({
            bets: state.roulette.bets,
            chipValues: chips,
            maxPerSlot: MAX_BET_PER_SLOT,
          }),
        });
        state.roulette.bets = payload.bets;
        if (payload.spent > 0) {
          state.balance = Math.max(0, state.balance - payload.spent);
          updateBalance();
          state.roulette.roundPaid = true;
        }
        this.updateUI();
        if (payload.spent > 0) {
          playSfx("spin");
          showCenterToast(`Luck grenade! -$${payload.spent}`, "win");
        } else {
          playSfx("lose");
          showCenterToast("Luck grenade fizzled.", "danger");
        }
      } catch (err) {
        showCenterToast(err.message || "Luck grenade failed.", "danger");
      } finally {
        unlock();
      }
    });

    document.querySelectorAll(betZoneSelector).forEach((zone) => {
      this.bindZoneEvents(zone);
    });

    spinBtn?.addEventListener("click", async () => {
      if (state.roulette.spinning) {
        showCenterToast("Wheel is spinning...", "danger");
        return;
      }
      const unlock = lockPanel("roulette");
      const totalBet = this.totalBet();
      if (totalBet <= 0) {
        showCenterToast("Place a bet on the table.", "danger");
        unlock();
        return;
      }
      if (!state.roulette.roundPaid) {
        if (totalBet > state.balance) {
          showCenterToast("Not enough credits.", "danger");
          state.roulette.bets.numbers = {};
          state.roulette.bets.colors = {};
          state.roulette.bets.parities = {};
          state.roulette.roundPaid = false;
          this.updateUI();
          unlock();
          return;
        }
        state.balance -= totalBet;
        updateBalance();
        state.roulette.roundPaid = true;
      }
      state.roulette.spinning = true;
      spinBtn.disabled = true;
      playSfx("spin");
      let payload;
      try {
        payload = await auth.request("/api/games/roulette/spin", {
          method: "POST",
          body: JSON.stringify({ bets: state.roulette.bets, paid: state.roulette.roundPaid }),
        });
      } catch (err) {
        if (state.roulette.roundPaid) {
          state.balance += totalBet;
          updateBalance();
          state.roulette.roundPaid = false;
        }
        state.roulette.spinning = false;
        spinBtn.disabled = false;
        showCenterToast(err.message || "Spin failed.", "danger");
        unlock();
        return;
      }
      const spin = payload.resultNumber;
      this.spinWheel(spin);
      setTimeout(() => {
        if (payload.payout && payload.payout > 0) {
          state.balance += payload.payout;
          updateBalance();
        }
        const profit = payload.profit || 0;
        if (profit > 0) {
          playSfx("win");
          if ((payload.payout || 0) >= totalBet * 5) {
            triggerBigWin();
          }
          showCenterToast(`Win! +$${Math.round(profit)}`, "win");
        } else {
          playSfx("lose");
          showCenterToast("No win.", "danger");
        }

        if (!autoToggle?.checked) {
          state.roulette.bets.numbers = {};
          state.roulette.bets.colors = {};
          state.roulette.bets.parities = {};
          this.updateUI();
        }
        state.roulette.roundPaid = false;
        state.roulette.spinning = false;
        spinBtn.disabled = false;
        unlock();
        if (autoToggle?.checked && this.totalBet() > 0) {
          state.roulette.roundPaid = false;
          setTimeout(() => {
            if (!state.roulette.spinning && autoToggle.checked) {
              spinBtn.click();
            }
          }, AUTO_SPIN_DELAY);
        }
      }, SPIN_DURATION);
    });
  }

  init() {
    this.cacheElements();
    this.initRing();
    this.initWheel();
    this.initTable();
    this.initChips();
    this.bindEvents();
    this.updateUI();
  }

  reset() {
    this.updateUI();
  }

  serializeState() {
    return {
      bets: {
        numbers: { ...state.roulette.bets.numbers },
        colors: { ...state.roulette.bets.colors },
        parities: { ...state.roulette.bets.parities },
      },
      roundPaid: Boolean(state.roulette.roundPaid),
    };
  }

  restoreFromSaved(saved) {
    if (!saved) return;
    const bets = saved.bets || {};
    state.roulette.bets = {
      numbers: bets.numbers || {},
      colors: bets.colors || {},
      parities: bets.parities || {},
    };
    state.roulette.roundPaid = Boolean(saved.roundPaid);
    state.roulette.spinning = false;
    this.updateUI();
  }
}
