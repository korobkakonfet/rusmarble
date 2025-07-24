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

    const overlay = document.createElement('div'); // Creates a new <div> element for the overlay
    overlay.id = 'bm-overlay';

    const barPan = document.createElement('div'); // Pan bar for the overlay
    barPan.id = 'bm-bar-pan';

    const barHeader = document.createElement('h1'); // Header bar for the overlay
    const barHeaderImage = document.createElement('img'); // Image in header
    barHeaderImage.src = 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png';
    barHeaderImage.alt = 'Blue Marble Icon';
    barHeader.appendChild(barHeaderImage); // Appends the image to the header
    barHeader.append('Blue Marble');
    
    // Construction of the overlay element
    overlay.appendChild(barPan); // Adds the pan bar to the overlay
    overlay.appendChild(barHeader); // Adds the header to the overlay
    document.body.appendChild(overlay); // Adds the overlay to the body of the webpage
  }
}