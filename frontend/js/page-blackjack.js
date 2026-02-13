import { initCore } from "./core.js";
import { BlackjackGame } from "./blackjack.js";

const game = new BlackjackGame();

initCore();
game.init();
