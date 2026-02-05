import { initCore } from "./core.js";
import { PokerGame } from "./poker.js";

const game = new PokerGame();

game.init();
initCore(() => {
  game.reset();
});
