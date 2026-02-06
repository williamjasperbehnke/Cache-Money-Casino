import { initCore, initGamePersistence } from "./core.js";
import { PokerGame } from "./poker.js";

const game = new PokerGame();

game.init();
initGamePersistence({
  key: "poker",
  getState: () => game.serializeState(),
  applyState: (saved) => game.restoreFromSaved(saved),
});
initCore(() => {
  game.reset();
});
