// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.0.2
// @description  A userscript for Wplace.live
// @author       SwingTheVine
// @license      MPL-2.0
// @supportURL   https://discord.gg/tpeBPy46hf
// @homepageURL  https://github.com/SwingTheVine/Wplace-BlueMarble
// @icon         https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/Favicon.png
// @updateURL    https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/BlueMarble.user.js
// @downloadURL  https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/BlueMarble.user.js
// @match        *://*.wplace.live/*
// ==/UserScript==

/** This script is designed to automate and/or enhance the user experience on Wplace.live.
 * Make sure to comply with the site's Terms of Service, and rules!
 * This script is not affiliated with Wplace.live in any way.
 * Use at your own risk.
 * The author is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script.
 * This script is provided "as is" under the MPL-2.0 license.
 * The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication. The image is owned by NASA.
 * @author SwingTheVine
 * @version 0.0.2
 * @description A userscript for Wplace.live
 * @license MPL-2.0
 * @link https://wplace.live
 * @link https://github.com/SwingTheVine/Wplace-BlueMarble
 * @link https://www.mozilla.org/en-US/MPL/2.0/
*/ 

console.log("Blue Marble script has loaded.");

(function() {
  'use strict';

  /** The overlay for the Blue Marble script.
   * @since 0.0.2
   * @description Thie class handles the overlay UI for the Blue Marble script.
   * @class Overlay
  */
  class Overlay {

    /** Constructor for the Overlay class.
     * @param {*} text - The text to display in the overlay.
     * @since 0.0.2
     * @see {@link Overlay}
     */
    constructor(text) {
      this.text = text;
      this.element = null;
    }

    /** Creates and deploys the overlay element
     * @since 0.0.2
     */
    create() {

      const div = document.createElement('div'); // Creates a new <div> element

      div.textContent = this.text; // Sets the text content of the <div> to the passed-in text

      // Styles the <div>
      Object.assign(div.style, {
          position: 'fixed',
          top: '10px',
          right: '10px',
          backgroundColor: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '10px',
          borderRadius: '8px',
          zIndex: '9999',
          fontFamily: 'sans-serif'
      });
      
      document.body.appendChild(div); // Adds the <div> to the body of the webpage

      this.element = div; // Stores the state of the overlay element in the "element" variable
    }

    /** Updates the display text of the overlay.
     * @param {*} newText - New text to populate the overlay with.
     * @since 0.0.2
     */
    updateText(newText) {

      // If the element exists...
      if (this.element) {

        this.element.textContent = newText; // ...update the text content
      }
    }
  }

  const overlay = new Overlay("Blue Marble");
  overlay.create();

  setTimeout(() => {
    overlay.updateText("Updated text");
  }, 5000);
})();
