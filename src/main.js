import { Overlay } from './overlay.js';

// Imports overlay CSS from src folder on github
const cssOverlay = GM_getResourceText("CSS-Overlay");
GM_addStyle(cssOverlay);

console.log("Blue Marble script has loaded.");

const overlay = new Overlay();
overlay.create();