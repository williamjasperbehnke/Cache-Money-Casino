import { initCore, fetchGameState, clearGameState, updateBalance, state } from "./core.js";
import { MemoryGame } from "./memory.js";

const game = new MemoryGame();

game.init();
initCore(() => {
  game.reset();
});

(async () => {
  const payload = await fetchGameState("memory");
  if (!payload) return;
  if (payload.active && payload.state && !payload.state.completed) {
    game.applyServerState(payload);
    if (Number.isFinite(payload.balance)) {
      state.balance = payload.balance;
      updateBalance();
    }
    game.updateUI();
    return;
  }
  game.reset();
  clearGameState("memory");
})();
