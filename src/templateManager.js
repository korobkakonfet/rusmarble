/** Manages the template system.
 * @since 0.55.8
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @since 0.55.8
   */
  constructor() {
    this.canvas = null; // The canvas
    this.canvasID = 'div#map canvas'; // The selector for the main canvas
    this.template = null; // The template image.
    this.state = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
  }

  /** Retrieves the pixel art canvas.
   * If the canvas has been updated/replaced, it retrieves the new one.
   * @param {string} selector - The CSS selector to use to find the canvas.
   * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
   * @since 0.58.3
   */
  getCanvas(selector) {

    // If the stored canvas is "fresh," return the stored canvas
    if (document.body.contains(this.canvas)) {return this.canvas;}
    // Else, the stored canvas is "stale," get the canvas again

    this.canvas = document.querySelector(selector); // Get the new canvas
    return this.canvas; // Return the new canvas or null
  }

  /** Sets the template to the image passed in.
   * @param {File} file - The file of the template image.
   * @since 0.55.8
   */
  setTemplateImage(file) {

    this.template = file;
    this.state = 'file';

    const url = URL.createObjectURL(file); // Creates a blob URL
    window.open(url, '_blank'); // Opens a new tab with blob
    setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
  }

  tempDraw() {
    const ctx = this.getCanvas(this.canvasID)?.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'red';
      ctx.fillRect(21511, 1305644, 500, 500);
    }
  }
}