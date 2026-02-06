import { initCore, initGamePersistence } from "./core.js";
import { HoldemGame } from "./holdem.js";

const game = new HoldemGame();

game.init();
initGamePersistence({
  key: "holdem",
  getState: () => game.serializeState(),
  applyState: (saved) => game.restoreFromSaved(saved),
});
initCore(() => {
  game.reset();
});
