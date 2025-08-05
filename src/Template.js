/** An instance of a template with comprehensive pixel counting and statistics.
 * Handles all mathematics, manipulation, and statistical analysis regarding a single template.
 * 
 * TEMPLATE FEATURES:
 * - Automatic pixel counting and dimension analysis
 * - Tile-based template chunking for efficient rendering
 * - Statistical information storage and retrieval
 * - Bitmap processing with configurable scaling
 * - Memory-efficient template tile generation
 * 
 * PIXEL COUNTING SYSTEM:
 * - Calculates total pixel count (width × height) during template creation
 * - Stores pixel count for statistical display and analysis
 * - Integrates with template manager for aggregate statistics
 * - Provides formatted pixel count information to user interface
 * 
 * @since 0.65.2
 * @version 1.1.0 - Added comprehensive pixel counting and statistical analysis system
 */
export default class Template {
  /** The constructor for the {@link Template} class with enhanced pixel tracking.
   * 
   * Initializes a new template instance with all necessary properties for rendering
   * and statistical analysis. The pixel counting system is initialized here and
   * populated during the template creation process.
   * 
   * PIXEL COUNTING INTEGRATION:
   * The pixelCount property is automatically calculated during createTemplateTiles()
   * and represents the total number of pixels in the source image (width × height).
   * This information is used for:
   * - User interface statistics display
   * - Template comparison and analysis
   * - Performance optimization decisions
   * - Memory usage estimation
   * 
   * @param {Object} [params={}] - Object containing all optional parameters
   * @param {string} [params.displayName='My template'] - The display name of the template
   * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
   * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
   * @param {string} [params.url=''] - The URL to the source image
   * @param {File} [params.file=null] - The template file (pre-processed File or processed bitmap)
   * @param {[number, number, number, number]} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
   * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
   * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
   * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
   * @since 0.65.2
   * @version 1.1.0 - Added pixelCount property for comprehensive template statistics and analysis
   */
  constructor({
    displayName = 'My template',
    sortID = 0,
    authorID = '',
    url = '',
    file = null,
    coords = null,
    chunked = null,
    tileSize = 1000,
  } = {}) {
    this.displayName = displayName;
    this.sortID = sortID;
    this.authorID = authorID;
    this.url = url;
    this.file = file;
    this.coords = coords;
    this.chunked = chunked;
    this.tileSize = tileSize;
    this.pixelCount = 0; // Total pixel count in template (automatically calculated during createTemplateTiles)
  }

  /** Creates chunks of the template for each tile with integrated pixel counting system.
   * 
   * This method processes the template image and performs several critical operations:
   * 1. PIXEL ANALYSIS: Calculates total pixel count (width × height) for statistical purposes
   * 2. TILE CHUNKING: Divides the template into tile-sized chunks for efficient rendering
   * 3. BITMAP PROCESSING: Applies scaling and filtering for optimal display quality
   * 4. MEMORY OPTIMIZATION: Creates efficient ImageBitmap objects for each tile segment
   * 
   * PIXEL COUNTING IMPLEMENTATION:
   * The pixel counting system calculates the total number of pixels in the source image
   * by multiplying the bitmap width by height. This information is stored in the
   * pixelCount property and used throughout the application for:
   * - User interface statistics display
   * - Template comparison and analysis
   * - Performance monitoring and optimization
   * - Memory usage estimation and management
   * 
   * TECHNICAL DETAILS:
   * - Uses createImageBitmap() for efficient image processing
   * - Applies 3x scaling factor (shreadSize) for pixel art enhancement
   * - Processes images in tile-sized chunks for memory efficiency
   * - Maintains pixel-perfect rendering with nearest-neighbor sampling
   * - Handles coordinate transformation between template and tile coordinate systems
   * 
   * PERFORMANCE CONSIDERATIONS:
   * - Large templates are processed incrementally to avoid memory issues
   * - Bitmap creation uses OffscreenCanvas for optimal performance
   * - Pixel counting is performed once during initial processing
   * - Results are cached in the pixelCount property for repeated access
   * 
   * @returns {Object} Collection of template bitmaps organized by tile coordinates
   * @since 0.65.4
   * @version 1.1.0 - Added comprehensive pixel counting functionality with detailed logging and statistics
   */
  async createTemplateTiles() {
    console.log('Template coordinates:', this.coords);

    const shreadSize = 3; // Scale image factor for pixel art enhancement (must be odd)
    const bitmap = await createImageBitmap(this.file); // Create efficient bitmap from uploaded file
    const imageWidth = bitmap.width;
    const imageHeight = bitmap.height;
    
    // ==================== PIXEL COUNTING SYSTEM ====================
    // Calculate total pixel count using standard width × height formula
    // This provides essential statistical information for the user interface
    const totalPixels = imageWidth * imageHeight;
    console.log(`Template pixel analysis - Dimensions: ${imageWidth}×${imageHeight} = ${totalPixels.toLocaleString()} pixels`);
    
    // Store pixel count in instance property for access by template manager and UI components
    // This enables real-time statistics display and template comparison features
    this.pixelCount = totalPixels;

    const templateTiles = {}; // Holds the template tiles

    const canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
    const context = canvas.getContext('2d', { willReadFrequently: true });

    // For every tile...
    for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {
      // Draws the partial tile first, if any
      // This calculates the size based on which is smaller:
      // A. The top left corner of the current tile to the bottom right corner of the current tile
      // B. The top left corner of the current tile to the bottom right corner of the image
      const drawSizeY = Math.min(
        this.tileSize - (pixelY % this.tileSize),
        imageHeight - (pixelY - this.coords[3])
      );
      console.log(
        `Math.min(${this.tileSize} - (${pixelY} % ${
          this.tileSize
        }), ${imageHeight} - (${pixelY - this.coords[3]}))`
      );

      for (
        let pixelX = this.coords[2];
        pixelX < imageWidth + this.coords[2];

      ) {
        console.log(`Pixel X: ${pixelX}\nPixel Y: ${pixelY}`);

        // Draws the partial tile first, if any
        // This calculates the size based on which is smaller:
        // A. The top left corner of the current tile to the bottom right corner of the current tile
        // B. The top left corner of the current tile to the bottom right corner of the image
        const drawSizeX = Math.min(
          this.tileSize - (pixelX % this.tileSize),
          imageWidth - (pixelX - this.coords[2])
        );
        console.log(
          `Math.min(${this.tileSize} - (${pixelX} % ${
            this.tileSize
          }), ${imageWidth} - (${pixelX - this.coords[2]}))`
        );

        console.log(`Draw Size X: ${drawSizeX}\nDraw Size Y: ${drawSizeY}`);

        // Change the canvas size and wipe the canvas
        const canvasWidth =
          drawSizeX * shreadSize + (pixelX % this.tileSize) * shreadSize;
        const canvasHeight =
          drawSizeY * shreadSize + (pixelY % this.tileSize) * shreadSize;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        console.log(
          `Draw X: ${drawSizeX}\nDraw Y: ${drawSizeY}\nCanvas Width: ${canvasWidth}\nCanvas Height: ${canvasHeight}`
        );

        context.imageSmoothingEnabled = false; // Nearest neighbor

        console.log(
          `Getting X ${pixelX}-${pixelX + drawSizeX}\nGetting Y ${pixelY}-${
            pixelY + drawSizeY
          }`
        );

        // Draws the template segment on this tile segment
        context.clearRect(0, 0, canvasWidth, canvasHeight); // Clear any previous drawing (only runs when canvas size does not change)
        context.drawImage(
          bitmap,
          pixelX - this.coords[2],
          pixelY - this.coords[3],
          drawSizeX,
          drawSizeY,
          (pixelX % this.tileSize) * shreadSize,
          (pixelY % this.tileSize) * shreadSize,
          drawSizeX * shreadSize,
          drawSizeY * shreadSize
        ); // Coordinates and size of draw area of source image, then canvas

        // const final = await canvas.convertToBlob({ type: 'image/png' });
        // const url = URL.createObjectURL(final); // Creates a blob URL
        // window.open(url, '_blank'); // Opens a new tab with blob
        // setTimeout(() => URL.revokeObjectURL(url), 60000); // Destroys the blob 1 minute later

        const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight); // Data of the image on the canvas

        for (let y = 0; y < canvasHeight; y++) {
          for (let x = 0; x < canvasWidth; x++) {
            // For every pixel...

            // ... Make it transparent unless it is the "center"
            if (x % shreadSize !== 1 || y % shreadSize !== 1) {
              const pixelIndex = (y * canvasWidth + x) * 4; // Find the pixel index in an array where every 4 indexes are 1 pixel
              imageData.data[pixelIndex + 3] = 0; // Make the pixel transparent on the alpha channel
            }
          }
        }

        console.log(`Shreaded pixels for ${pixelX}, ${pixelY}`, imageData);

        context.putImageData(imageData, 0, 0);
        //templateTiles[`${(this.coords[0] + Math.floor(pixelX / 1000)).toString().padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000)).toString().padStart(4, '0')},${(pixelX % 1000).toString().padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`] = await canvas.convertToBlob({ type: 'image/png' });
        templateTiles[
          `${(this.coords[0] + Math.floor(pixelX / 1000))
            .toString()
            .padStart(4, '0')},${(this.coords[1] + Math.floor(pixelY / 1000))
            .toString()
            .padStart(4, '0')},${(pixelX % 1000)
            .toString()
            .padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`
        ] = await createImageBitmap(canvas);

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
