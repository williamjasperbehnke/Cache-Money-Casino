import {
  state,
  updateBalance,
  payout,
  playSfx,
  showCenterToast,
  setStatus,
  makeChipStack,
  animateChip,
  triggerBigWin,
} from "./core.js";

const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const rouletteOrder = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  "00", 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

let rouletteRotation = 0;
let rouletteSelectedChip = 5;
let lastDragSource = null;

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

function initRouletteTable() {
  const grid = document.getElementById("rouletteGrid");
  if (!grid) return;
  grid.innerHTML = "";
  for (let number = 1; number <= 36; number += 1) {
    const color = redNumbers.has(number) ? "red" : "black";
    const cell = document.createElement("div");
    cell.className = `roulette-cell ${color}`;
    cell.dataset.number = number;
    cell.setAttribute("data-tooltip", `${number} pays 35:1`);
    cell.textContent = number;
    const stack = document.createElement("div");
    stack.className = "chip-stack";
    cell.appendChild(stack);
    grid.appendChild(cell);
  }
}

function initRouletteRing() {
  const ring = document.getElementById("rouletteRing");
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

function initRouletteWheel() {
  const wheel = document.getElementById("rouletteWheel");
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

function spinWheel(resultNumber) {
  const wheel = document.getElementById("rouletteWheel");
  const ball = document.getElementById("rouletteBall");
  const ring = document.getElementById("rouletteRing");
  if (!wheel || !ball || !ring) return;

  ring.querySelectorAll(".roulette-number").forEach((el) => {
    el.classList.remove("winning");
  });
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

function initChips() {
  const chips = document.querySelectorAll('.chips[data-target="rouletteBet"] .chip');
  chips.forEach((chip) => {
    chip.setAttribute("draggable", "true");
    chip.addEventListener("dragstart", (event) => {
      lastDragSource = chip;
      event.dataTransfer.setData("text/plain", chip.dataset.amount);
      event.dataTransfer.effectAllowed = "copy";
    });
    chip.addEventListener("click", () => {
      const amount = Number(chip.dataset.amount);
      if (!Number.isFinite(amount)) return;
      rouletteSelectedChip = amount;
      chip.parentElement?.querySelectorAll(".chip").forEach((btn) => btn.classList.remove("active"));
      chip.classList.add("active");
      playSfx("hit");
    });
  });
}

export class RouletteGame {
  init() {
    const spinBtn = document.getElementById("rouletteSpin");
    const resultEl = document.getElementById("rouletteResult");
    const clearBtn = document.getElementById("rouletteClear");
    const chaosBtn = document.getElementById("rouletteChaos");
    const autoToggle = document.getElementById("rouletteAuto");

  initRouletteRing();
  initRouletteWheel();
  initRouletteTable();
  initChips();

    const rouletteChips = document.querySelectorAll('.chips[data-target="rouletteBet"] .chip');
    if (rouletteChips.length > 0) {
      rouletteChips.forEach((chip) => chip.classList.remove("active"));
      rouletteChips[0].classList.add("active");
      rouletteSelectedChip = Number(rouletteChips[0].dataset.amount) || rouletteSelectedChip;
    }

    const clearBets = (refund = true) => {
      if (refund) {
        const totalBet = rouletteTotalBet();
        if (totalBet > 0) {
          payout(totalBet);
        }
      }
      state.roulette.bets.numbers = {};
      state.roulette.bets.colors = {};
      state.roulette.bets.parities = {};
      state.roulette.roundPaid = false;
      updateRouletteUI();
    };

    clearBtn?.addEventListener("click", () => {
      if (state.roulette.spinning) return;
      clearBets(true);
      playSfx("lose");
      setStatus("rouletteStatus", "Bets cleared.", "danger");
      showCenterToast("Bets cleared.", "danger");
    });

    chaosBtn?.addEventListener("click", () => {
      if (state.roulette.spinning) return;
      const chips = Array.from(
        document.querySelectorAll('.chips[data-target="rouletteBet"] .chip')
      )
        .map((chip) => Number(chip.dataset.amount))
        .filter((amount) => amount > 0);
      if (chips.length === 0) return;
      const available = Math.min(state.balance, 200);
      if (available <= 0) {
        showCenterToast("Not enough credits.", "danger");
        return;
      }
      const spend = Math.min(available, Math.floor(Math.random() * 150) + 50);
      let spent = 0;
      const zones = Array.from(document.querySelectorAll(
        ".roulette-cell, .roulette-zero, .bet-zone"
      ));
      while (spent < spend) {
        const amount = chips[Math.floor(Math.random() * chips.length)];
        if (spent + amount > spend) break;
        const zone = zones[Math.floor(Math.random() * zones.length)];
        if (!zone) break;
        const target = zone.classList.contains("roulette-cell")
          ? zone.dataset.number
          : zone.classList.contains("roulette-zero")
            ? zone.dataset.number
            : zone.classList.contains("color")
              ? zone.classList.contains("red")
                ? "red"
                : "black"
              : zone.classList.contains("odd")
                ? "odd"
                : "even";
        if (zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")) {
          const current = state.roulette.bets.numbers[target] || 0;
          if (current + amount > 50) continue;
          state.roulette.bets.numbers[target] = current + amount;
        } else if (zone.classList.contains("color")) {
          const current = state.roulette.bets.colors[target] || 0;
          if (current + amount > 50) continue;
          state.roulette.bets.colors[target] = current + amount;
        } else {
          const current = state.roulette.bets.parities[target] || 0;
          if (current + amount > 50) continue;
          state.roulette.bets.parities[target] = current + amount;
        }
        spent += amount;
        animateChip(
          document.querySelector('.chips[data-target="rouletteBet"] .chip.active') ||
            zone.querySelector(".chip-stack") ||
            zone,
          zone.querySelector(".chip-stack") || zone
        );
      }
      if (spent > 0) {
        state.balance -= spent;
        updateBalance();
        updateRouletteUI();
        state.roulette.roundPaid = true;
        playSfx("spin");
        showCenterToast(`Luck grenade! -$${spent}`, "win");
      } else {
        playSfx("lose");
        showCenterToast("Luck grenade fizzled.", "danger");
      }
    });

    document.querySelectorAll(".roulette-cell, .roulette-zero, .bet-zone").forEach((zone) => {
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (state.roulette.spinning) return;
        zone.classList.add("drop-active");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop-active"));
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("drop-active");
        if (state.roulette.spinning) {
          setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
          return;
        }
        const amount =
          Number(event.dataTransfer.getData("text/plain")) || rouletteSelectedChip || 0;
        if (!amount) return;
        const key = zone.dataset.number ||
          (zone.classList.contains("color")
            ? zone.classList.contains("red")
              ? "red"
              : "black"
            : zone.classList.contains("odd")
              ? "odd"
              : "even");
        const current =
          zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")
            ? state.roulette.bets.numbers[key] || 0
            : zone.classList.contains("color")
              ? state.roulette.bets.colors[key] || 0
              : state.roulette.bets.parities[key] || 0;
        if (current + amount > 50) {
          setStatus("rouletteStatus", "Max bet per slot is $50.", "danger");
          showCenterToast("Max bet per slot is $50.", "danger");
          return;
        }
        if (amount > state.balance) {
          setStatus("rouletteStatus", "Not enough credits.", "danger");
          showCenterToast("Not enough credits.", "danger");
          return;
        }
        state.balance -= amount;
        updateBalance();
        if (zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")) {
          state.roulette.bets.numbers[key] = current + amount;
        } else if (zone.classList.contains("color")) {
          state.roulette.bets.colors[key] = current + amount;
        } else {
          state.roulette.bets.parities[key] = current + amount;
        }
        updateRouletteUI();
        state.roulette.roundPaid = true;
      });

      zone.addEventListener("click", () => {
        if (state.roulette.spinning) {
          setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
          return;
        }
        if (!rouletteSelectedChip) return;
        const key = zone.dataset.number ||
          (zone.classList.contains("color")
            ? zone.classList.contains("red")
              ? "red"
              : "black"
            : zone.classList.contains("odd")
              ? "odd"
              : "even");
        const current =
          zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")
            ? state.roulette.bets.numbers[key] || 0
            : zone.classList.contains("color")
              ? state.roulette.bets.colors[key] || 0
              : state.roulette.bets.parities[key] || 0;
        if (current + rouletteSelectedChip > 50) {
          setStatus("rouletteStatus", "Max bet per slot is $50.", "danger");
          showCenterToast("Max bet per slot is $50.", "danger");
          return;
        }
        if (rouletteSelectedChip > state.balance) {
          setStatus("rouletteStatus", "Not enough credits.", "danger");
          showCenterToast("Not enough credits.", "danger");
          return;
        }
        state.balance -= rouletteSelectedChip;
        updateBalance();
        if (zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")) {
          state.roulette.bets.numbers[key] = current + rouletteSelectedChip;
        } else if (zone.classList.contains("color")) {
          state.roulette.bets.colors[key] = current + rouletteSelectedChip;
        } else {
          state.roulette.bets.parities[key] = current + rouletteSelectedChip;
        }
        updateRouletteUI();
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
        if (state.roulette.spinning) {
          setStatus("rouletteStatus", "Wait for the wheel to stop.", "danger");
          return;
        }
        const removeAmount = rouletteSelectedChip || 5;
        const key = zone.dataset.number ||
          (zone.classList.contains("color")
            ? zone.classList.contains("red")
              ? "red"
              : "black"
            : zone.classList.contains("odd")
              ? "odd"
              : "even");
        const current =
          zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")
            ? state.roulette.bets.numbers[key] || 0
            : zone.classList.contains("color")
              ? state.roulette.bets.colors[key] || 0
              : state.roulette.bets.parities[key] || 0;
        if (!current) return;
        const next = Math.max(0, current - removeAmount);
        if (zone.classList.contains("roulette-cell") || zone.classList.contains("roulette-zero")) {
          if (next <= 0) delete state.roulette.bets.numbers[key];
          else state.roulette.bets.numbers[key] = next;
        } else if (zone.classList.contains("color")) {
          if (next <= 0) delete state.roulette.bets.colors[key];
          else state.roulette.bets.colors[key] = next;
        } else {
          if (next <= 0) delete state.roulette.bets.parities[key];
          else state.roulette.bets.parities[key] = next;
        }
        payout(Math.min(removeAmount, current));
        updateRouletteUI();
        if (rouletteTotalBet() <= 0) {
          state.roulette.roundPaid = false;
        }
      });
    });

    spinBtn?.addEventListener("click", () => {
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
        setStatus("rouletteStatus", "Place a bet on the table.", "danger");
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
      spinWheel(spin);
      setTimeout(() => {
        const wins = [];
        let winnings = 0;
        let winningStake = 0;

        const numberAmount = chosenNumbers[spin] || 0;
        if (numberAmount) {
          winnings += numberAmount * 35;
          winningStake += numberAmount;
          wins.push(`Number ${spin}`);
        }

        const color = redNumbers.has(Number(spin)) ? "red" : "black";
        const colorAmount = chosenColors[color] || 0;
        if (colorAmount) {
          winnings += colorAmount;
          winningStake += colorAmount;
          wins.push(`${color} wins`);
        }

        const parity = Number(spin) % 2 === 0 ? "even" : "odd";
        const parityAmount = chosenParities[parity] || 0;
        if (parityAmount) {
          winnings += parityAmount;
          winningStake += parityAmount;
          wins.push(`${parity} wins`);
        }

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
        }
        state.roulette.roundPaid = false;
        state.roulette.spinning = false;
        spinBtn.disabled = false;
        if (autoToggle?.checked && rouletteTotalBet() > 0) {
          state.roulette.roundPaid = false;
          setTimeout(() => {
            if (!state.roulette.spinning && autoToggle.checked) {
              spinBtn.click();
            }
          }, 400);
        }
      }, 2600);
    });

    updateRouletteUI();
  }

  reset() {
    setStatus("rouletteStatus", "Bank reset. Place your bets.");
    updateRouletteUI();
  }
}
