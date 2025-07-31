/** An instance of a template.
 * Handles all mathmatics and manipulation regarding a single template.
 * @since 0.65.2
 */
export default class Template {

  /** The constructor for the {@link Template} class.
   * @since 0.65.2
   */
  constructor() {
    this.templateName = ''; // The name of the template
    this.templateFile = null; // The template file. This can be a pre-processed File, or a processed bitmap
    this.templateState = ''; // The state of the template file. This is how you tell if it is a File, bitmap, or nothing
    this.templateCoords = null; // The coordinates of the top left corner as (x, y, x, y)
    this.templateChunked = null; // The affected chunks of the template, and their template for each chunk
  }

  /** Sets the template to the image passed in.
   * @param {File} file - The file of the template image.
   * @since 0.65.2
   */
  setTemplateImage(file) {

    this.templateName = file.name.replace(/\.[^/.]+$/, ''); // "foo.bar.png" -> "foo.bar"
    this.template = file; // Overrides The previous template image/bitmap with the new image
    this.templateState = 'file'; // Indicates that the template is now an image (not a bitmap)

    // const url = URL.createObjectURL(file); // Creates a blob URL
    // window.open(url, '_blank'); // Opens a new tab with blob
    // setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
  }

  /** Draws the template on the tile. Returns the tile plus the overlay.
   * @param {File|Blob} tileBlob - The blob of the tile
   * @param {Array<number, number, number, number>} [coordsTilePixel=[0,0,0,0]] - A number array of the four coordinates
   * @returns {File|Blob} A image/png blob file
   * @since 0.63.59
   */
  async drawTemplate(tileBlob, coordsTilePixel=[0, 0, 0, 0]) {

    // Only continue if template state is NOT 'file' NOR 'template'
    if (!((this.templateState == 'file') || (this.templateState == 'template'))) {return;}

    const tileSize = 1000; // Pixels in a tile
    const drawMult = 3; // Multiplier of draw size
    const drawSize = tileSize * drawMult; // Draw multiplier

    coordsTilePixel = !!coordsTilePixel?.length ? coordsTilePixel : [0, 0, 0, 0]; // Set to default if [] passed in
    
    console.log(this.template);
    // If the template has already been drawn, don't draw it again
    const templateBitmap = this.templateState == 'template' ? this.template : await createImageBitmap(await this.shreadBlob(this.template));
    const tileBitmap = await createImageBitmap(tileBlob);

    const canvas = new OffscreenCanvas(drawSize, drawSize);
    const context = canvas.getContext('2d');

    context.imageSmoothingEnabled = false; // Nearest neighbor scaleing
    context.globalCompositeOperation = "destination-over"; // If we the image we are drawing has transparent pixels, don't preserve them.

    // Tells the canvas to ignore anything outside of this area
    context.beginPath();
    context.rect(0, 0, drawSize, drawSize);
    context.clip();

    context.clearRect(0, 0, drawSize, drawSize); // Draws transparent background
    context.drawImage(tileBitmap, 0, 0, drawSize, drawSize); // Draws the tile
    context.drawImage(templateBitmap, coordsTilePixel[2]*3, coordsTilePixel[3]*3); // Draws the template on top of the tile

    const final = await canvas.convertToBlob({ type: 'image/png' });

    // If the template is not drawn yet...
    if (this.templateState != 'template') {
      // (99% chance templateState is 'file')

      this.template = templateBitmap; // Store the drawn template
      this.templateState = 'template'; // Indicate that the template has been drawn, and this.template now stores a bitmap

      // const url = URL.createObjectURL(final); // Creates a blob URL
      // window.open(url, '_blank'); // Opens a new tab with blob
      // setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
    }

    return final;
  }
}