import { initCore } from "./core.js";
import { RouletteGame } from "./roulette.js";

const game = new RouletteGame();

game.init();
initCore(() => {
  game.reset();
});
