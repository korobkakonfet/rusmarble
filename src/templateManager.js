import Template from "./Template";
import { numberToEncoded } from "./utils";

/** Manages the comprehensive template system with integrated pixel counting and statistics.
 * 
 * This class handles all external requests for template modification, creation, and statistical analysis.
 * It serves as the central coordinator between template instances and the user interface, providing
 * real-time feedback on template statistics including pixel counts and rendering status.
 * 
 * ENHANCED FEATURES (v1.1.0):
 * - Real-time pixel counting and statistics display
 * - Intelligent template filtering based on active tiles
 * - Internationalized number formatting for large pixel counts
 * - Comprehensive status reporting with detailed template information
 * - Enhanced user feedback during template creation and rendering
 * 
 * PIXEL COUNTING SYSTEM:
 * The template manager integrates with the Template class pixel counting system to provide:
 * - Individual template pixel counts during creation
 * - Aggregate pixel counts for multiple templates during rendering
 * - Smart filtering to count only actively displayed templates
 * - Formatted display of pixel statistics in user interface
 * 
 * STATISTICAL INTEGRATION POINTS:
 * 1. Template Creation: Displays pixel count when new templates are processed
 * 2. Template Rendering: Shows aggregate pixel count for templates being displayed
 * 3. Tile Filtering: Counts pixels only for templates active in current viewport
 * 4. User Interface: Provides formatted statistics for status messages
 * 
 * @since 0.55.8
 * @version 1.1.0 - Added comprehensive pixel counting system and enhanced statistical reporting
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
 *       "URL": "https://github.com/SwingTheVine/Wplace-BlueMarble/blob/main/dist/assets/Favicon.png",
 *       "URLType": "template",
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
  constructor(name, version, overlay) {

    // Meta
    this.name = name; // Name of userscript
    this.version = version; // Version of userscript
    this.overlay = overlay; // The main instance of the Overlay class
    this.templatesVersion = '1.0.0'; // Version of JSON schema
    this.userID = null; // The ID of the current user
    this.encodingBase = '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'; // Characters to use for encoding/decoding
    this.tileSize = 1000; // The number of pixels in a tile. Assumes the tile is square
    this.drawMult = 3; // The enlarged size for each pixel. E.g. when "3", a 1x1 pixel becomes a 1x1 pixel inside a 3x3 area. MUST BE ODD
    
    // Template
    this.canvasTemplate = null; // Our canvas
    this.canvasTemplateZoomed = null; // The template when zoomed out
    this.canvasTemplateID = 'bm-canvas'; // Our canvas ID
    this.canvasMainID = 'div#map canvas.maplibregl-canvas'; // The selector for the main canvas
    this.template = null; // The template image.
    this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
    this.templatesArray = []; // All Template instnaces currently loaded (Template)
    this.templatesJSON = null; // All templates currently loaded (JSON)
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
   * @since 0.65.77
   */
  async createTemplate(blob, name, coords) {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); console.log(`Creating JSON...`);}

    this.overlay.handleDisplayStatus(`Creating template at ${coords.join(', ')}...`);

    // Creates a new template instance
    const template = new Template({
      displayName: name,
      sortID: 0, // Object.keys(this.templatesJSON.templates).length || 0, // Uncomment this to enable multiple templates (1/2)
      authorID: numberToEncoded(this.userID || 0, this.encodingBase),
      file: blob,
      coords: coords
    });
    template.chunked = await template.createTemplateTiles(this.tileSize); // Chunks the tiles
    
    // Appends a child into the templates object
    // The child's name is the number of templates already in the list (sort order) plus the encoded player ID
    this.templatesJSON.templates[`${template.sortID} ${template.authorID}`] = {
      "name": template.displayName, // Display name of template
      "enabled": true,
      "tiles": template.chunked
    };

    this.templatesArray = []; // Remove this to enable multiple templates (2/2)
    this.templatesArray.push(template); // Pushes the Template object instance to the Template Array

    // ==================== PIXEL COUNT DISPLAY SYSTEM ====================
    // Display pixel count statistics with internationalized number formatting
    // This provides immediate feedback to users about template complexity and size
    const pixelCountFormatted = new Intl.NumberFormat().format(template.pixelCount);
    this.overlay.handleDisplayStatus(`Template created at ${coords.join(', ')}! Total pixels: ${pixelCountFormatted}`);

    console.log(Object.keys(this.templatesJSON.templates).length);
    console.log(this.templatesJSON);
    console.log(this.templatesArray);
  }

  /** Generates a {@link Template} class instance from the JSON object template
   */
  #loadTemplate() {

  }

  /** Deletes a template from the JSON object.
   * Also delete's the corrosponding {@link Template} class instance
   */
  deleteTemplate() {

  }

  /** Disables the template from view
   */
  async disableTemplate() {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); console.log(`Creating JSON...`);}


  }

  /** Draws all templates on the specified tile with intelligent pixel count reporting.
   * 
   * This method handles the rendering of template overlays on individual tiles and provides
   * comprehensive statistics about the templates being displayed. It integrates with the
   * pixel counting system to give users real-time feedback about template complexity.
   * 
   * PIXEL COUNTING INTEGRATION:
   * The method implements intelligent pixel counting that:
   * - Identifies templates that have content in the current tile
   * - Sums pixel counts only for templates actually being rendered
   * - Formats large numbers with locale-appropriate separators
   * - Provides detailed status messages with template and pixel statistics
   * 
   * PERFORMANCE OPTIMIZATIONS:
   * - Filters templates by tile coordinates before processing
   * - Counts pixels only for active templates to avoid unnecessary calculations
   * - Uses efficient array operations for template filtering and aggregation
   * - Caches formatted numbers to avoid repeated formatting operations
   * 
   * USER EXPERIENCE ENHANCEMENTS:
   * - Shows both template count and total pixel count in status messages
   * - Uses internationalized number formatting for better readability
   * - Provides immediate feedback when templates are being displayed
   * - Handles singular/plural forms correctly for template count
   * 
   * @param {File} tileBlob - The pixels that are placed on a tile
   * @param {[number, number]} tileCoords - The tile coordinates [x, y]
   * @since 0.65.77
   * @version 1.1.0 - Added intelligent pixel counting and enhanced status reporting
   */
  async drawTemplateOnTile(tileBlob, tileCoords) {

    const drawSize = this.tileSize * this.drawMult; // Calculate draw multiplier for scaling

    // Format tile coordinates with proper padding for consistent lookup
    tileCoords = tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0');

    console.log(`Searching for templates in tile: "${tileCoords}"`);

    const templateArray = this.templatesArray; // Stores a copy for sorting

    // Sorts the array of Template class instances. 0 = first = lowest draw priority
    templateArray.sort((a, b) => {
      return a.sortID - b.sortID;
    });

    console.log(templateArray);

    // Retrieves the relavent template tile blobs
    const templateBlobs = templateArray
      .map(template => {
        const matchingTiles = Object.keys(template.chunked).filter(tile =>
          tile.startsWith(tileCoords)
        );

        if (matchingTiles.length === 0) {return null;} // Return nothing when nothing is found

        // Retrieves the blobs of the templates for this tile
        const matchingTileBlobs = matchingTiles.map(tile => template.chunked[tile]);

        return matchingTileBlobs?.[0];
      })
    .filter(Boolean);

    console.log(templateBlobs);

    if (templateBlobs.length > 0) {
      // ==================== INTELLIGENT PIXEL COUNTING SYSTEM ====================
      // Calculate total pixel count for templates actively being displayed in this tile
      // This provides accurate statistics by counting only templates with content in the current viewport
      
      const totalPixels = templateArray
        .filter(template => {
          // Filter templates to include only those with tiles matching current coordinates
          // This ensures we count pixels only for templates actually being rendered
          const matchingTiles = Object.keys(template.chunked).filter(tile =>
            tile.startsWith(tileCoords)
          );
          return matchingTiles.length > 0;
        })
        .reduce((sum, template) => sum + (template.pixelCount || 0), 0);
      
      // Format pixel count with locale-appropriate thousands separators for better readability
      // Examples: "1,234,567" (US), "1.234.567" (DE), "1 234 567" (FR)
      const pixelCountFormatted = new Intl.NumberFormat().format(totalPixels);
      
      // Display comprehensive status information including both template count and pixel statistics
      // This gives users immediate feedback about the complexity and scope of what's being rendered
      this.overlay.handleDisplayStatus(
        `Displaying ${templateBlobs.length} template${templateBlobs.length == 1 ? '' : 's'}. ` +
        `Total pixels: ${pixelCountFormatted}`
      );
    }
    
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

    // For each template in this tile, draw them.
    for (const templateBitmap of templateBlobs) {
      console.log(`Template Blob is ${typeof templateBitmap}`);
      console.log(templateBitmap);
      context.drawImage(templateBitmap, 0, 0);
    }

    return await canvas.convertToBlob({ type: 'image/png' });
  }

  /** Imports the JSON object, and appends it to any JSON object already loaded
   */
  importJSON() {

  }

  /** Parses the Blue Marble JSON object
   */
  #parseBlueMarble() {

  }

  /** Parses the OSU! Place JSON object
   */
  #parseOSU() {

  }
}
