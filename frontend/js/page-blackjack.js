import { initCore, fetchGameState, clearGameState } from "./core.js";
import { BlackjackGame } from "./blackjack.js";

const game = new BlackjackGame();

game.init();
initCore(() => {
  game.reset();
});

(async () => {
  const payload = await fetchGameState("blackjack");
  if (!payload) return;
  if (payload.active && payload.state) {
    game.applyServerState(payload.state, payload.balance);
    game.renderHands();
    game.renderDealer();
    game.updateControls();
    game.updateTotal();
    return;
  }
  game.reset();
  clearGameState("blackjack");
})();
