/** Manages the template system.
 * @since 0.55.8
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @since 0.55.8
   */
  constructor() {
    this.canvasTemplate = null; // Our canvas
    this.canvasTemplateID = 'bm-canvas'; // Our canvas ID
    this.canvasMainID = 'div#map canvas.maplibregl-canvas'; // The selector for the main canvas
    this.template = null; // The template image.
    this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
  }

  /** Retrieves the pixel art canvas.
   * If the canvas has been updated/replaced, it retrieves the new one.
   * @param {string} selector - The CSS selector to use to find the canvas.
   * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
   * @since 0.58.3
   * @deprecated Not in use since 0.63.25
   */
  getCanvas() {

    // If the stored canvas is "fresh", return the stored canvas
    if (document.body.contains(this.canvasTemplate)) {return this.canvasTemplate;}
    // Else, the stored canvas is "stale", get the canvas again

    // Attempt to find and destroy the "stale" canvas
    document.getElementById(this.canvasTemplateID)?.remove(); 

    const canvasMain = document.querySelector(this.canvasMainID);

    const canvasTemplateNew = document.createElement('canvas');
    canvasTemplateNew.id = this.canvasTemplateID;
    canvasTemplateNew.className = 'maplibregl-canvas';
    canvasTemplateNew.style.position = 'absolute';
    canvasTemplateNew.style.top = '0';
    canvasTemplateNew.style.left = '0';
    canvasTemplateNew.style.height = `${canvasMain?.clientHeight * (window.devicePixelRatio || 1)}px`;
    canvasTemplateNew.style.width = `${canvasMain?.clientWidth * (window.devicePixelRatio || 1)}px`;
    canvasTemplateNew.height = canvasMain?.clientHeight * (window.devicePixelRatio || 1);
    canvasTemplateNew.width = canvasMain?.clientWidth * (window.devicePixelRatio || 1);
    canvasTemplateNew.style.zIndex = '8999';
    canvasTemplateNew.style.pointerEvents = 'none';
    canvasMain?.parentElement?.appendChild(canvasTemplateNew); // Append the newCanvas as a child of the parent of the main canvas
    this.canvasTemplate = canvasTemplateNew; // Store the new canvas

    window.addEventListener('move', this.onMove);
    window.addEventListener('zoom', this.onZoom);
    window.addEventListener('resize', this.onResize);

    return this.canvasTemplate; // Return the new canvas
  }

  /** Sets the template to the image passed in.
   * @param {File} file - The file of the template image.
   * @since 0.55.8
   */
  setTemplateImage(file) {

    this.template = file;
    this.templateState = 'file';

    // const url = URL.createObjectURL(file); // Creates a blob URL
    // window.open(url, '_blank'); // Opens a new tab with blob
    // setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
  }

  async drawTemplate(tileBlob) {

    // Only continue if template state is NOT 'file' NOR 'template'
    if (!((this.templateState == 'file') || (this.templateState == 'template'))) {return;}

    const tileSize = 1000; // Pixels in a tile
    const drawMult = 3; // Multiplier of draw size
    const drawSize = tileSize * drawMult; // Draw multiplier

    // const [templateBitmap, tileBitmap] = await Promise.all([
    //   createImageBitmap(await this.shrinkPixelsInPlace(this.template)),
    //   createImageBitmap(tileBlob)
    // ]);
    
    // If the template has already been drawn, don't draw it again
    console.log(this.template);
    const templateBitmap = this.templateState == 'template' ? this.template : await createImageBitmap(await this.shreadBlob(this.template));
    const tileBitmap = await createImageBitmap(tileBlob);

    const canvas = new OffscreenCanvas(drawSize, drawSize);
    const context = canvas.getContext('2d');

    context.imageSmoothingEnabled = false; // Nearest neighbor

    context.clearRect(0, 0, drawSize, drawSize); // Draws transparent background
    context.drawImage(templateBitmap, 0, 0); // TODO: Change X Y here
    context.drawImage(tileBitmap, 0, 0, drawSize, drawSize);

    const final = await canvas.convertToBlob({ type: 'image/png' });

    // If the template is not drawn yet...
    if (this.templateState != 'template') {
      // (99% chance templateState is 'file')
      this.template = templateBitmap; // Store the drawn template
      this.templateState = 'template'; // Indicate that the template has been drawn

      const url = URL.createObjectURL(final); // Creates a blob URL
      window.open(url, '_blank'); // Opens a new tab with blob
      setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
    }

    return final;
  }

  /** Shreads the blob so that every pixel is surrounded by adjacent transparent pixels
   * @param {Blob|File} blob - The blob to manipulate
   * @param {number} [shrinkFactor=3] - An odd number that will place each pixel in the center. Even numbers will be increased by 1
   * @param {string} [fileType='image/png'] - The File type to output as. PNG is one of the few transparent types.
   * @returns {Promise<File>} - A Promise that resolved to a image/png file blob
   * @since 0.63.37
   */
  async shreadBlob(blob, shreadSize = 3, fileType = 'image/png') {
    
    const bitmap = await createImageBitmap(blob); // Creates a bitmap image

    shreadSize |= 1; // Converts shreadSize to always be odd by forcing the right-most bit to be 1.

    const width = bitmap.width * Math.round(shreadSize); // Width of the canvas based on shread size times blob
    const height = bitmap.height * Math.round(shreadSize); // Height of the canvas based on shread size times blob

    const canvas = document.createElement('canvas'); // Creates a canvas
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d'); // Gets the context of the canvas
    context.imageSmoothingEnabled = false; // Nearest Neighbor scaling

    context.drawImage(bitmap, 0, 0, width, height); // Fills the canvas with the blob
    
    const imageData = context.getImageData(0, 0, width, height); // Data of the image on the canvas

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // For every pixel...

        // ... Make it transparent unless it is the "center"
        if ((x % shreadSize !== 1) || (y % shreadSize !== 1)) {
          const pixelIndex = (y * width + x) * 4; // Find the pixel index in an array where every 4 indexes are 1 pixel
          imageData.data[pixelIndex + 3] = 0; // Make the pixel transparent on the alpha channel
        }
      }
    }

    context.putImageData(imageData, 0, 0);
    return new Promise((resolve) => {canvas.toBlob(resolve, fileType);});
  }
}