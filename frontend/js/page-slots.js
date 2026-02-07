import { initCore } from "./core.js";
import { SlotsGame } from "./slots.js";

const game = new SlotsGame();

game.init();
initCore(() => {
  game.reset();
});
