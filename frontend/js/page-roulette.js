import { initCore, initGamePersistence } from "./core.js";
import { RouletteGame } from "./roulette.js";

const game = new RouletteGame();

game.init();
initGamePersistence({
  key: "roulette",
  getState: () => game.serializeState(),
  applyState: (saved) => game.restoreFromSaved(saved),
});
initCore(() => {
  game.reset();
});
