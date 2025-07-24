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