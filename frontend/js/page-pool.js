import { initCore, initGamePersistence } from "./core.js";
import { PoolGame } from "./pool.js";

const game = new PoolGame();

game.init();
initGamePersistence({
  key: "pool",
  getState: () => game.serializeState(),
  applyState: (saved) => game.restoreFromSaved(saved),
});
initCore(() => {
  game.reRack();
});
