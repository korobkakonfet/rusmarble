import { Overlay } from './overlay.js';

console.log("Blue Marble script has loaded.");

const overlay = new Overlay("Blue Marble");
overlay.create();

setTimeout(() => {
  overlay.updateText("Updated text");
}, 5000);