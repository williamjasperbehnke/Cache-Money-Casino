import {
  state,
  updateBalance,
  payout,
  playSfx,
  showCenterToast,
  setStatus,
  triggerBigWin,
  triggerSmallWin,
  withBet,
} from "./core.js";

const slotSymbols = ["🍒", "🍋", "🔔", "⭐", "💎", "🍇", "🍀", "💥", "🍉", "🪙"];

export class SlotsGame {
  init() {
    const spinBtn = document.getElementById("slotsSpin");
    const reels = document.querySelectorAll(".reel");
    const lever = document.getElementById("slotsLever");
    const winLight = document.querySelector(".slots-payout-light");
    const presets = document.querySelectorAll(".slots-presets .preset");
    const autoToggle = document.getElementById("slotsAuto");
    let currentBet = 5;
    let spinning = false;

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
              playSfx("stop");
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
              playSfx("deal");
              setTimeout(() => {
                reel.classList.remove("stop");
                reel.classList.remove("snap");
              }, 220);
            },
            { once: true }
          );
        });

        setTimeout(() => {
          winLight?.classList.remove("active");
          document
            .querySelectorAll(".payout-card.highlight")
            .forEach((card) => card.classList.remove("highlight"));
          const [a, b, c] = result;
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

          let multiplier = 0;
          let payoutKey = "";
          if (hasThreeKind) {
            if (tripleSymbol === "💎") {
              multiplier = 12;
              payoutKey = "3-diamond";
            } else if (tripleSymbol === "⭐") {
              multiplier = 10;
              payoutKey = "3-star";
            } else if (tripleSymbol === "🔔") {
              multiplier = 8;
              payoutKey = "3-bell";
            } else if (tripleSymbol === "🍇") {
              multiplier = 6;
              payoutKey = "3-grape";
            } else if (tripleSymbol === "🍒") {
              multiplier = 6;
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
              }, 700);
            }
          }, 260);
        }, maxDuration + 240);
      });

      if (message) {
        setStatus("slotsStatus", "");
        showCenterToast(message, "danger");
      }
    };

    spinBtn?.addEventListener("click", pullLever);
    lever?.addEventListener("click", pullLever);
    lever?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pullLever();
      }
    });
  }

  reset() {
    setStatus("slotsStatus", "Bank reset. Spin away!");
  }
}
