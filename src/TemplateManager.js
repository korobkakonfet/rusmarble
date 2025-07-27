/** Manages the template system.
 * @since 0.55.8
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @since 0.55.8
   */
  constructor() {
    this.template = null; // The template image.
    this.state = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
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
}