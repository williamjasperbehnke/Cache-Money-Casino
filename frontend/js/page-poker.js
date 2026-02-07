import {
  initCore,
  fetchGameState,
  clearGameState,
  renderCards,
  renderHiddenCards,
  revealDealer,
  state,
} from "./core.js";
import { PokerGame } from "./poker.js";

const game = new PokerGame();

game.init();
initCore(() => {
  game.reset();
});

(async () => {
  const payload = await fetchGameState("poker");
  if (!payload) return;
  if (payload.active && payload.state) {
    game.applyServerState(payload.state, payload.balance);
    if (state.poker.inRound) {
      renderCards("pokerPlayer", state.poker.player);
      if (state.poker.phase === "reveal" || state.poker.awaitingClear) {
        revealDealer("pokerDealer");
        renderCards("pokerDealer", state.poker.dealer);
      } else {
        renderHiddenCards("pokerDealer", state.poker.dealer.length || 0);
      }
    } else {
      renderCards("pokerPlayer", []);
      renderCards("pokerDealer", []);
    }
    game.renderDiscards();
    game.updatePokerTotal();
    game.updateUiForPhase();
    return;
  }
  game.reset();
  clearGameState("poker");
})();
