import { numberToEncoded } from "./utils";

/** Manages the template system.
 * This class handles all external requests for modification to a Template.
 * @since 0.55.8
 * @example
 * // JSON structure for a template
 * {
 *   "whoami": "BlueMarble",
 *   "scriptVersion": "1.13.0",
 *   "schemaVersion": "2.1.0",
 *   "templates": {
 *     "0 $Z": {
 *       "name": "My Template",
 *       "enabled": true,
 *       "tiles": {
 *         "1231,0047,183,593": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "1231,0048,183,000": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     },
 *     "1 $Z": {
 *       "name": "My Template",
 *       "enabled": false,
 *       "tiles": {
 *         "375,1846,276,188": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "376,1846,000,188": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     }
 *   }
 * }
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @since 0.55.8
   */
  constructor(name, version) {

    // Meta
    this.name = name; // Name of userscript
    this.version = version; // Version of userscript
    this.templatesVersion = '1.0.0'; // Version of JSON schema
    this.userID = null; // The ID of the current user
    this.encodingBase = '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'; // Characters to use for encoding/decoding
    
    // Template
    this.canvasTemplate = null; // Our canvas
    this.canvasTemplateZoomed = null; // The template when zoomed out
    this.canvasTemplateID = 'bm-canvas'; // Our canvas ID
    this.canvasMainID = 'div#map canvas.maplibregl-canvas'; // The selector for the main canvas
    this.template = null; // The template image.
    this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
    this.templates = null; // All templates currently loaded (JSON)
  }

  /** Retrieves the pixel art canvas.
   * If the canvas has been updated/replaced, it retrieves the new one.
   * @param {string} selector - The CSS selector to use to find the canvas.
   * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
   * @since 0.58.3
   * @deprecated Not in use since 0.63.25
   */
  /* @__PURE__ */getCanvas() {

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

  /** Creates the JSON object to store templates in
   * @returns {{ whoami: string, scriptVersion: string, schemaVersion: string, templates: Object }} The JSON object
   * @since 0.65.4
   */
  async createJSON() {
    return {
      "whoami": this.name.replace(' ', ''), // Name of userscript without spaces
      "scriptVersion": this.version, // Version of userscript
      "schemaVersion": this.templatesVersion, // Version of JSON schema
      "templates": {} // The templates
    };
  }

  /** Creates the template from the inputed file blob
   * @param {File} blob - The file blob to create a template from
   * @param {string} name - The display name of the template
   * @param {Array<number, number, number, number>} coords - The coordinates of the top left corner of the template
   */
  async createTemplate(blob, name, coords) {

    // Creates the JSON object if it does not already exist
    if (!this.templates) {this.templates = await this.createJSON();}

    const tileSize = 1000; // The size of a tile in pixels

    console.log(`Awaiting creation...`);
    
    // Appends a child into the templates object
    // The child's name is the number of templates already in the list (sort order) plus the encoded player ID
    this.templates.templates[`${this.templates.templates.length || 0} ${numberToEncoded(this.userID || 0, this.encodingBase)}`] = {
      "name": name, // Display name of template
      "tiles": await this.#createTemplateTiles(blob, coords, tileSize)
    };

    console.log(this.templates);
  }

  /** Creates chunks of the template for each tile.
   * @param {File} blob - The File blob to process
   * @param {Array<number, number, number, number>} coords - The coordinates of the top left corner of the template
   * @param {number} tileSize - The size of a tile (assumes tiles are square)
   * @returns {Object} Collection of template bitmaps in a Object
   * @since 0.65.4
   */
  async #createTemplateTiles(blob, coords, tileSize) {

    console.log(coords);

    const shreadSize = 3; // Scale image factor. Must be odd
    const bitmap = await createImageBitmap(blob); // Creates a bitmap image
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;

    const templateTiles = {}; // Holds the template tiles

    const canvas = new OffscreenCanvas(tileSize, tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // For every tile...
    for (let pixelY = coords[3]; pixelY < (imageHeight + coords[3]);) {

      // Draws the partial tile first, if any
      // This calculates the size based on which is smaller:
      // A. The top left corner of the current tile to the bottom right corner of the current tile
      // B. The top left corner of the current tile to the bottom right corner of the image
      const drawSizeY = Math.min(tileSize - (pixelY % tileSize), imageHeight - ((pixelY - coords[3]) * (pixelY != coords[3])));
      console.log(`Math.min(${tileSize} - (${pixelY} % ${tileSize}), ${imageHeight} - (${pixelY - coords[3]} * (${pixelY} != ${coords[3]})))`);

      for (let pixelX = coords[2]; pixelX < (imageWidth + coords[2]);) {
        console.log(`Pixel X: ${pixelX}\nPixel Y: ${pixelY}`);

        // Draws the partial tile first, if any
        // This calculates the size based on which is smaller:
        // A. The top left corner of the current tile to the bottom right corner of the current tile
        // B. The top left corner of the current tile to the bottom right corner of the image
        const drawSizeX = Math.min(tileSize - (pixelX % tileSize), imageWidth - ((pixelX - coords[2]) * (pixelX != coords[2])));
        console.log(`Math.min(${tileSize} - (${pixelX} % ${tileSize}), ${imageWidth} - (${pixelX} * (${pixelX} != ${coords[2]})))`);

        console.log(`Draw Size X: ${drawSizeX}\nDraw Size Y: ${drawSizeY}`);

        console.log(`Draw X: ${drawSizeX}\nDraw Y: ${drawSizeY}\nCanvas Width: ${drawSizeX * shreadSize}\nCanvas Height: ${drawSizeY * shreadSize}`);

        // Change the canvas size and wipe the canvas
        canvas.width = drawSizeX * shreadSize;
        canvas.height = drawSizeY * shreadSize;

        console.log(`Getting X ${pixelX}-${pixelX + drawSizeX}\nGetting Y ${pixelY}-${pixelY + drawSizeY}`);

        // Draws the template segment on this tile segment
        context.clearRect(0, 0, drawSizeX * shreadSize, drawSizeY * shreadSize); // Clear any previous drawing (only runs when canvas size does not change)
        context.drawImage(bitmap, pixelX, pixelY, drawSizeX, drawSizeY, 0, 0, drawSizeX * shreadSize, drawSizeY * shreadSize); // Coordinates and size of draw area of source image, then canvas

        const imageData = context.getImageData(0, 0, drawSizeX * shreadSize, drawSizeY * shreadSize); // Data of the image on the canvas

        for (let y = 0; y < drawSizeY * shreadSize; y++) {
          for (let x = 0; x < drawSizeX * shreadSize; x++) {
            // For every pixel...

            // ... Make it transparent unless it is the "center"
            if ((x % shreadSize !== 1) || (y % shreadSize !== 1)) {
              const pixelIndex = (y * drawSizeX + x) * 4; // Find the pixel index in an array where every 4 indexes are 1 pixel
              imageData.data[pixelIndex + 3] = 0; // Make the pixel transparent on the alpha channel
            }
          }
        }

        console.log(`Shreaded pixels for ${pixelX}, ${pixelY}`, imageData);

        context.putImageData(imageData, 0, 0);
        templateTiles[`${(coords[0] + Math.floor(pixelX / 1000)).toString().padStart(4, '0')},${(coords[1] + Math.floor(pixelY / 1000)).toString().padStart(4, '0')},${(pixelX % 1000).toString().padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`] = await canvas.convertToBlob({ type: 'image/png' });
        
        console.log(templateTiles);

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
    }

    console.log('Template Tiles: ', templateTiles);
    return templateTiles;
  }

  /** Creates an image from a blob File
   * @param {File} blob - The blob to convert to an Image
   * @returns {Image} The image of the blob as an Image
   * @since 0.65.4
   */
  #loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Create a blank image
      image.onload = () => resolve(image); // When the blank image loads, populate it with the blob
      image.onerror = reject; // Return the error, if any
      image.src = URL.createObjectURL(blob);
    });
  }

  /** Generates a {@link Template} class instance from the JSON object template
   * 
   */
  #loadTemplate() {

  }

  /** Deletes a template from the JSON object.
   * Also delete's the corrosponding {@link Template} class instance
   * 
   */
  deleteTemplate() {

  }

  /** Draws all templates on that tile
   * 
   */
  drawTemplateOnTile() {

  }

  importJSON() {

  }

  #parseBlueMarble() {

  }

  #parseOSU() {

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

  /** Draws the template on the tile.
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

    context.imageSmoothingEnabled = false; // Nearest neighbor

    // Tells the canvas to ignore anything outside of this area
    context.beginPath();
    context.rect(0, 0, drawSize, drawSize);
    context.clip();

    context.clearRect(0, 0, drawSize, drawSize); // Draws transparent background
    context.drawImage(tileBitmap, 0, 0, drawSize, drawSize);
    context.drawImage(templateBitmap, coordsTilePixel[2]*3, coordsTilePixel[3]*3);

    const final = await canvas.convertToBlob({ type: 'image/png' });

    // If the template is not drawn yet...
    if (this.templateState != 'template') {
      // (99% chance templateState is 'file')
      this.template = templateBitmap; // Store the drawn template
      this.templateState = 'template'; // Indicate that the template has been drawn

      // const url = URL.createObjectURL(final); // Creates a blob URL
      // window.open(url, '_blank'); // Opens a new tab with blob
      // setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
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