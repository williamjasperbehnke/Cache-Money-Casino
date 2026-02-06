import { initCore, initGamePersistence } from "./core.js";
import { SlotsGame } from "./slots.js";

const game = new SlotsGame();

game.init();
initGamePersistence({
  key: "slots",
  getState: () => game.serializeState(),
  applyState: (saved) => game.restoreFromSaved(saved),
});
initCore(() => {
  game.reset();
});
