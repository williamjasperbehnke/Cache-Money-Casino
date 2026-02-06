import { initCore, initGamePersistence } from "./core.js";
import { BlackjackGame } from "./blackjack.js";

const game = new BlackjackGame();

game.init();
initGamePersistence({
  key: "blackjack",
  getState: () => game.serializeState(),
  applyState: (saved) => game.restoreFromSaved(saved),
});
initCore(() => {
  game.reset();
});
