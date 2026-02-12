import { initCore } from "./core.js";
import { HoldemMultiGame } from "./holdem-multi.js";

const game = new HoldemMultiGame();

initCore();
game.init();
