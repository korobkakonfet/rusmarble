/** An instance of a template.
 * Handles all mathmatics and manipulation regarding a single template.
 * @since 0.65.2
 */
export default class Template {

  /** The constructor for the {@link Template} class.
   * @param {Object} [params={}] - Object containing all optional params
   * @param {string} [params.displayName='My template'] - The display name of the template
   * @param {number} [params.sortID=0] - The sort number of the template
   * @param {string} [params.authorID=''] - The user ID of the person who exported the template. This is to prevent sort ID collisions when importing
   * @param {string} [params.url=''] - The URL to the image
   * @param {File} [params.file=null] - The template file. This can be a pre-processed File, or a processed bitmap
   * @param {[number, number, number, number]} [params.coords=null] - The coordinates of the top left corner as (x, y, x, y)
   * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
   * @param {number} [params.tileSize=1000] - The size of a tile in pixels. Assumes the tile is a square
   * @since 0.65.2
   */
  constructor({
    displayName = 'My template',
    sortID = 0,
    authorID = '',
    url = '',
    file = null,
    coords = null,
    chunked = null,
    tileSize = 1000
  } = {}) {
    this.displayName = displayName;
    this.sortID = sortID;
    this.authorID = authorID;
    this.url = url;
    this.file = file;
    this.coords = coords;
    this.chunked = chunked;
    this.tileSize = tileSize;
  }

  /** Creates chunks of the template for each tile.
   * @returns {Object} Collection of template bitmaps in a Object
   * @since 0.65.4
   */
  async createTemplateTiles() {

    console.log(this.coords);

    const shreadSize = 3; // Scale image factor. Must be odd
    const bitmap = await createImageBitmap(this.file); // Creates a bitmap image from the uploaded file
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;

    const templateTiles = {}; // Holds the template tiles

    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // For every tile...
    for (let pixelY = this.coords[3]; pixelY < (imageHeight + this.coords[3]);) {

      // Draws the partial tile first, if any
      // This calculates the size based on which is smaller:
      // A. The top left corner of the current tile to the bottom right corner of the current tile
      // B. The top left corner of the current tile to the bottom right corner of the image
      const drawSizeY = Math.min(this.tileSize - (pixelY % this.tileSize), imageHeight - ((pixelY - this.coords[3]) * (pixelY != this.coords[3])));
      console.log(`Math.min(${this.tileSize} - (${pixelY} % ${this.tileSize}), ${imageHeight} - (${pixelY - this.coords[3]} * (${pixelY} != ${this.coords[3]})))`);

      for (let pixelX = this.coords[2]; pixelX < (imageWidth + this.coords[2]);) {
        console.log(`Pixel X: ${pixelX}\nPixel Y: ${pixelY}`);

        // Draws the partial tile first, if any
        // This calculates the size based on which is smaller:
        // A. The top left corner of the current tile to the bottom right corner of the current tile
        // B. The top left corner of the current tile to the bottom right corner of the image
        const drawSizeX = Math.min(this.tileSize - (pixelX % this.tileSize), imageWidth - ((pixelX - this.coords[2]) * (pixelX != this.coords[2])));
        console.log(`Math.min(${this.tileSize} - (${pixelX} % ${this.tileSize}), ${imageWidth} - (${pixelX} * (${pixelX} != ${this.coords[2]})))`);

        console.log(`Draw Size X: ${drawSizeX}\nDraw Size Y: ${drawSizeY}`);

        // Change the canvas size and wipe the canvas
        const canvasWidth = (drawSizeX * shreadSize) + (this.coords[2] * shreadSize);
        const canvasHeight = (drawSizeY * shreadSize) + (this.coords[3] * shreadSize);
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        console.log(`Draw X: ${drawSizeX}\nDraw Y: ${drawSizeY}\nCanvas Width: ${canvasWidth}\nCanvas Height: ${canvasHeight}`);

        context.imageSmoothingEnabled = false; // Nearest neighbor

        console.log(`Getting X ${pixelX}-${pixelX + drawSizeX}\nGetting Y ${pixelY}-${pixelY + drawSizeY}`);

        // Draws the template segment on this tile segment
        context.clearRect(0, 0, canvasWidth, canvasHeight); // Clear any previous drawing (only runs when canvas size does not change)
        context.drawImage(bitmap, pixelX - this.coords[2], pixelY - this.coords[3], drawSizeX, drawSizeY, (pixelX % this.tileSize) * shreadSize, (pixelY % this.tileSize) * shreadSize, drawSizeX * shreadSize, drawSizeY * shreadSize); // Coordinates and size of draw area of source image, then canvas

        const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight); // Data of the image on the canvas

        for (let y = 0; y < canvasHeight; y++) {
          for (let x = 0; x < canvasWidth; x++) {
            // For every pixel...

            // ... Make it transparent unless it is the "center"
            if ((x % shreadSize !== 1) || (y % shreadSize !== 1)) {
              const pixelIndex = (y * canvasWidth + x) * 4; // Find the pixel index in an array where every 4 indexes are 1 pixel
              imageData.data[pixelIndex + 3] = 0; // Make the pixel transparent on the alpha channel
            }
          }
        }

        console.log(`Shreaded pixels for ${pixelX}, ${pixelY}`, imageData);

        context.putImageData(imageData, 0, 0);
        //templateTiles[`${(this.coords[0] + Math.floor(pixelX / 1000)).toString().padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000)).toString().padStart(4, '0')},${(pixelX % 1000).toString().padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`] = await canvas.convertToBlob({ type: 'image/png' });
        templateTiles[`${(this.coords[0] + Math.floor(pixelX / 1000)).toString().padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000)).toString().padStart(4, '0')},${(pixelX % 1000).toString().padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`] = await createImageBitmap(canvas);

        console.log(templateTiles);

        // const final = await canvas.convertToBlob({ type: 'image/png' });
        // const url = URL.createObjectURL(final); // Creates a blob URL
        // window.open(url, '_blank'); // Opens a new tab with blob
        // setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later

        pixelX += drawSizeX;
      }

      pixelY += drawSizeY;
    }

    console.log('Template Tiles: ', templateTiles);
    return templateTiles;
  }
}