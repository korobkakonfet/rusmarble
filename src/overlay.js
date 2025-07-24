/** The overlay for the Blue Marble script.
 * @description This class handles the overlay UI for the Blue Marble script.
 * @since 0.0.2
*/
export class Overlay {

  /** Constructor for the Overlay class.
   * @since 0.0.2
   * @see {@link Overlay}
   */
  constructor() {
  }

  /** Creates and deploys the overlay element
   * @since 0.0.2
   */
  create() {

    // Declarations of all elements used in the overlay
    const overlay = document.createElement('div'); // Creates a new <div> element
    const panBar = document.createElement('div'); // Creates the pan bar for the overlay

    overlay.id = 'bm-overlay'; // Sets the ID of the overlay

    panBar.id = 'bm-panbar'; // Sets the ID of the pan bar
    
    // Construction of the overlay element
    overlay.appendChild(panBar); // Adds the pan bar to the overlay
    document.body.appendChild(overlay); // Adds the overlay to the body of the webpage
  }
}