import { initCore } from "./core.js";
import { HoldemGame } from "./holdem.js";

const game = new HoldemGame();

game.init();
initCore(() => {
  game.reset();
});
