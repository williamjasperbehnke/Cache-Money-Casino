import {
  initCore,
  fetchGameState,
  clearGameState,
  renderCards,
  renderHiddenCards,
  revealDealer,
  state,
} from "./core.js";
import { HoldemGame } from "./holdem.js";

const game = new HoldemGame();

game.init();
initCore(() => {
  game.reset();
});

(async () => {
  const payload = await fetchGameState("holdem");
  if (!payload) return;
  if (payload.state?.phase === "reveal" || payload.state?.phase === "showdown") {
    clearGameState("holdem");
    game.reset();
    return;
  }
  if (payload.active && payload.state) {
    game.applyServerState(payload.state, payload.balance);
    game.updateCommunity();
    if (payload.state.phase === "showdown" || payload.state.awaitingClear) {
      revealDealer("holdemDealer");
      renderCards("holdemDealer", state.holdem.dealer);
    } else {
      renderHiddenCards("holdemDealer", state.holdem.dealer.length || 0);
    }
    renderCards("holdemPlayer", state.holdem.player);
    game.updatePotUI();
    game.updateButtons();
    return;
  }
  game.reset();
  clearGameState("holdem");
})();
