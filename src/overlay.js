/** The overlay for the Blue Marble script.
 * @since 0.0.2
 * @description Thie class handles the overlay UI for the Blue Marble script.
*/
export class Overlay {

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

    // Declarations of all elements used in the overlay
    const overlay = document.createElement('div'); // Creates a new <div> element
    const panBar = document.createElement('div'); // Creates the pan bar for the overlay

    overlay.id = 'bm-overlay'; // Sets the ID of the overlay
    overlay.textContent = this.text; // Sets the text content of the overlay to the passed-in text

    panBar.id = 'bm-panbar'; // Sets the ID of the pan bar
    
    // Construction of the overlay element
    document.body.appendChild(overlay); // Adds the overlay to the body of the webpage
    overlay.appendChild(panBar); // Adds the pan bar to the overlay

    this.element = overlay; // Stores the state of the overlay element in the "element" variable
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