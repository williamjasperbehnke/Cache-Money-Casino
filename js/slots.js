import {
  state,
  updateBalance,
  payout,
  playSfx,
  showCenterToast,
  triggerBigWin,
  triggerSmallWin,
  withBet,
} from "./core.js";

const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "🍇", "🍀", "💥", "🍉", "🪙"];
const DEFAULT_BET = 5;
const REEL_STOP_DELAY = 220;
const RESULT_DELAY = 260;
const AUTO_SPIN_DELAY = 700;

const PAYOUTS = {
  "💎": { multiplier: 12, key: "3-diamond" },
  "⭐": { multiplier: 10, key: "3-star" },
  "🔔": { multiplier: 8, key: "3-bell" },
  "🍇": { multiplier: 6, key: "3-grape" },
  "🍒": { multiplier: 6, key: "3-cherry" },
  "🍋": { multiplier: 4, key: "3-lemon" },
  any3: { multiplier: 3, key: "3-any" },
  any2: { multiplier: 1.5, key: "2-any" },
};

export class SlotsGame {
  constructor() {
    this.currentBet = DEFAULT_BET;
    this.spinning = false;
    this.ui = {};
    this.reels = [];
  }

  cacheElements() {
    this.ui = {
      spinBtn: document.getElementById("slotsSpin"),
      lever: document.getElementById("slotsLever"),
      winLight: document.querySelector(".slots-payout-light"),
      presets: document.querySelectorAll(".slots-presets .preset"),
      autoToggle: document.getElementById("slotsAuto"),
      reelsWrap: document.getElementById("slotsReels"),
    };
    this.reels = Array.from(document.querySelectorAll(".reel"));
  }

  getResultSymbols() {
    return Array.from({ length: 3 }, () =>
      SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
    );
  }

  clearHighlights() {
    document
      .querySelectorAll(".payout-card.highlight")
      .forEach((card) => card.classList.remove("highlight"));
  }

  highlightPayout(key) {
    if (!key) return;
    document.querySelector(`.payout-card[data-payout="${key}"]`)?.classList.add("highlight");
  }

  buildReelStrip(reel) {
    const measured = Math.round(reel.getBoundingClientRect().height) || reel.clientHeight || 96;
    const height = measured > 10 ? measured : 96;
    const isMobile = window.matchMedia("(max-width: 520px)").matches;
    const extraGap = isMobile ? 16 : 0;
    const symbolHeight = height + extraGap;
    const windowEl = document.createElement("div");
    windowEl.className = "reel-window";
    const symbolCount = SLOT_SYMBOLS.length;
    const maxCycles = 4;
    const total = symbolCount * (maxCycles + 1);
    windowEl.style.height = `${symbolHeight * total}px`;
    windowEl.dataset.symbolCount = String(symbolCount);
    windowEl.dataset.stripTotal = String(total);
    windowEl.dataset.symbolHeight = String(symbolHeight);
    for (let i = 0; i < total; i += 1) {
      const span = document.createElement("span");
      span.textContent = SLOT_SYMBOLS[i % symbolCount];
      span.style.height = `${symbolHeight}px`;
      windowEl.appendChild(span);
    }
    reel.textContent = "";
    reel.appendChild(windowEl);
    windowEl.style.transition = "none";
    windowEl.style.transform = "translateY(0px)";
  }

  resetReelStripIfNeeded(reel) {
    const windowEl = reel.querySelector(".reel-window");
    const currentHeight = reel.clientHeight || 96;
    if (!windowEl || Number(windowEl.dataset.symbolHeight) !== currentHeight) {
      this.buildReelStrip(reel);
      return reel.querySelector(".reel-window");
    }
    return windowEl;
  }

  spinReel(reel, targetSymbol, index) {
    const windowEl = this.resetReelStripIfNeeded(reel);
    if (!windowEl) return 0;

    reel.classList.add("spinning");
    windowEl.style.textDecoration = "none";

    const symbolCount = Number(windowEl.dataset.symbolCount) || SLOT_SYMBOLS.length;
    const stripTotal = Number(windowEl.dataset.stripTotal) || symbolCount * 5;
    const reelHeight = Number(windowEl.dataset.symbolHeight) || reel.clientHeight || 96;

    const targetIndex = SLOT_SYMBOLS.indexOf(targetSymbol);
    const cycles = 2 + index;
    const steps = cycles * symbolCount + targetIndex;
    const maxSteps = Math.max(0, stripTotal - 1);
    const distance = Math.min(steps, maxSteps) * reelHeight;
    const duration = 1200 + index * 320;

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
        playSfx("stop");
        setTimeout(() => {
          reel.classList.remove("stop");
          reel.classList.remove("snap");
        }, REEL_STOP_DELAY);
      },
      { once: true }
    );

    return duration;
  }

  evaluateSpin(symbols) {
    const [a, b, c] = symbols;
    const hasThreeKind = a === b && b === c;
    const hasTwoKind = a === b || b === c || a === c;
    const tripleSymbol = hasThreeKind ? a : null;
    const twoSymbol = hasTwoKind
      ? a === b
        ? a
        : b === c
          ? b
          : a
      : null;

    if (hasThreeKind) {
      const payout = PAYOUTS[tripleSymbol] || PAYOUTS.any3;
      return { hasThreeKind, hasTwoKind, tripleSymbol, twoSymbol, ...payout };
    }

    if (hasTwoKind) {
      return {
        hasThreeKind,
        hasTwoKind,
        tripleSymbol,
        twoSymbol,
        multiplier: PAYOUTS.any2.multiplier,
        key: PAYOUTS.any2.key,
      };
    }

    return { hasThreeKind, hasTwoKind, tripleSymbol, twoSymbol, multiplier: 0, key: "" };
  }

  applyOutcome({ bet, winLight, outcome, onAutoSpin }) {
    this.clearHighlights();

    if (outcome.hasThreeKind && outcome.tripleSymbol === "💥") {
      playSfx("lose");
      state.balance = 0;
      updateBalance();
      showCenterToast("Kaboom! Balance wiped.", "danger");
      winLight?.classList.remove("active");
      triggerBigWin(false);
      this.clearHighlights();
      onAutoSpin();
      return;
    }

    if (outcome.hasTwoKind && outcome.twoSymbol === "💥") {
      playSfx("lose");
      showCenterToast("Bang! House takes it.", "danger");
      onAutoSpin();
      return;
    }

    if (outcome.multiplier > 0 || outcome.hasTwoKind) {
      const payMultiplier = outcome.hasTwoKind ? PAYOUTS.any2.multiplier : outcome.multiplier;
      payout(bet * payMultiplier + bet);
      playSfx("win");
      if (outcome.hasThreeKind) {
        triggerBigWin();
      } else if (outcome.hasTwoKind) {
        triggerSmallWin();
      } else if (outcome.multiplier >= 10) {
        triggerBigWin();
      }
      showCenterToast(`You win ${payMultiplier}x!`, "win");
      winLight?.classList.add("active");
      this.highlightPayout(outcome.key);
      onAutoSpin();
      return;
    }

    playSfx("lose");
    showCenterToast("No win. Spin again!", "danger");
    onAutoSpin();
  }

  pullLever() {
    if (this.spinning) {
      showCenterToast("Reels are spinning...", "danger");
      return;
    }
    const bet = this.currentBet;
    const message = withBet(bet, () => {
      this.spinning = true;
      if (this.ui.spinBtn) this.ui.spinBtn.disabled = true;
      playSfx("spin");
      if (this.ui.lever) {
        this.ui.lever.classList.add("pull");
        setTimeout(() => this.ui.lever.classList.remove("pull"), REEL_STOP_DELAY);
      }
      const reelsEl = this.ui.reelsWrap;
      reelsEl?.classList.remove("spin");
      void reelsEl?.offsetWidth;
      reelsEl?.classList.add("spin");

      const result = this.getResultSymbols();
      let maxDuration = 0;
      this.reels.forEach((reel, index) => {
        const duration = this.spinReel(reel, result[index], index);
        maxDuration = Math.max(maxDuration, duration);
      });

      setTimeout(() => {
        this.ui.winLight?.classList.remove("active");
        this.clearHighlights();
        const outcome = this.evaluateSpin(result);

        setTimeout(() => {
          const onAutoSpin = () => {
            this.spinning = false;
            if (this.ui.spinBtn) this.ui.spinBtn.disabled = false;
            if (this.ui.autoToggle?.checked) {
              setTimeout(() => {
                if (!this.spinning && this.ui.autoToggle.checked) {
                  this.pullLever();
                }
              }, AUTO_SPIN_DELAY);
            }
          };
          this.applyOutcome({ bet, winLight: this.ui.winLight, outcome, onAutoSpin });
        }, RESULT_DELAY);
      }, maxDuration + 240);
    });

    if (message) {
      showCenterToast(message, "danger");
    }
  }

  bindEvents() {
    this.ui.presets?.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (this.spinning || this.ui.autoToggle?.checked) {
          showCenterToast("Reels are spinning...", "danger");
          return;
        }
        this.ui.presets.forEach((preset) => preset.classList.remove("active"));
        btn.classList.add("active");
        this.currentBet = Number(btn.dataset.amount) || this.currentBet;
        playSfx("hit");
      });
    });

    this.ui.spinBtn?.addEventListener("click", () => this.pullLever());
    this.ui.lever?.addEventListener("click", () => this.pullLever());
    this.ui.lever?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.pullLever();
      }
    });
  }

  init() {
    this.cacheElements();
    this.reels.forEach((reel) => {
      if (!reel.querySelector(".reel-window")) {
        this.buildReelStrip(reel);
      }
    });
    const syncReels = () => {
      this.reels.forEach((reel) => {
        this.resetReelStripIfNeeded(reel);
      });
    };
    requestAnimationFrame(syncReels);
    setTimeout(syncReels, 120);
    setTimeout(syncReels, 300);
    this.bindEvents();
  }

  reset() {}
}
