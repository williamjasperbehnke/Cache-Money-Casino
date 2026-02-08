import { initCore } from "./core.js";
import { CrapsGame } from "./craps.js";

const game = new CrapsGame();

game.init();
initCore(() => {
  game.reset();
});
