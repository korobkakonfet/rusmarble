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
    this.canvasMainMap = window.__bm_interceptedMap;
    this.onMove = this.onMove.bind(this); // Binds the handler for `move` to this class instance's function
    this.onResize = this.onResize.bind(this); // Binds the handler for `resize` to this class instance's function
    this.onZoom = this.onZoom.bind(this); // Binds the handler for `zoom` to this class instance's function
    this.template = null; // The template image.
    this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
  }

  /** Retrieves the pixel art canvas.
   * If the canvas has been updated/replaced, it retrieves the new one.
   * @param {string} selector - The CSS selector to use to find the canvas.
   * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
   * @since 0.58.3
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

    const url = URL.createObjectURL(file); // Creates a blob URL
    window.open(url, '_blank'); // Opens a new tab with blob
    setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
  }

  tempDraw() {
    const ctx = this.getCanvas(this.canvasTemplateID)?.getContext('2d');
    if (ctx) {
      function drawLoop() {
        ctx.fillStyle = 'red';
        ctx.fillRect(10, 10, 100, 100);
        //ctx.setTransform(1, 0, 0, 1, -21511, -1305644);
        //requestAnimationFrame(drawLoop);
      }
      drawLoop();
    }
  }

  drawGojo() {
    
    if (this.templateState != 'file') {return;}

    return this.template;
  }

  /** What to do to our canvas when the canvas is panned.
   * @since 0.60.10
   */
  onMove() {
    this.tempDraw();
    console.log(this.canvasMainMap);
  }

  /** What to do to our canvas when the canvas is zoomes.
   * @since 0.60.11
   */
  onZoom() {
    this.tempDraw();
  }

  /** What to do to our canvas when the viewport is resized.
   * @since 0.60.10
   */
  onResize() {
    const canvasMain = document.querySelector(this.canvasMainID);
    const canvasTemplate = this.getCanvas();
    if (!canvasTemplate || !canvasMain) {return;}
    canvasTemplate.style.height = `${canvasMain?.clientHeight * (window.devicePixelRatio || 1)}px`;
    canvasTemplate.style.width = `${canvasMain?.clientWidth * (window.devicePixelRatio || 1)}px`;
    canvasTemplate.height = canvasMain?.clientHeight * (window.devicePixelRatio || 1);
    canvasTemplate.width = canvasMain?.clientWidth * (window.devicePixelRatio || 1);
    this.tempDraw();
  }
}