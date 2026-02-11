import { initCore } from "./core.js";
import { BlackjackMultiGame } from "./blackjack-multi.js";

const game = new BlackjackMultiGame();

game.init();
initCore();
