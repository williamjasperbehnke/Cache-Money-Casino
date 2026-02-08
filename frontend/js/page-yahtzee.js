import { initCore, fetchGameState, clearGameState, updateBalance, state } from "./core.js";
import { YahtzeeGame } from "./yahtzee.js";

const game = new YahtzeeGame();

game.init();
initCore(() => {
  game.reset();
});

(async () => {
  const payload = await fetchGameState("yahtzee");
  if (!payload) return;
  if (payload.active && payload.state) {
    game.applyServerState(payload);
    if (Number.isFinite(payload.balance)) {
      state.balance = payload.balance;
      updateBalance();
    }
    game.updateUI();
    return;
  }
  game.reset();
  clearGameState("yahtzee");
})();
