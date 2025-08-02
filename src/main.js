/** The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn } from './utils.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
    const script = document.createElement('script');
    script.setAttribute('bm-name', name); // Passes in the name value
    script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
    script.textContent = `(${callback})();`;
    document.documentElement.appendChild(script);
    script.remove();
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Blue Marble'; // Gets the name value that was passed in. Defaults to "Blue Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
    console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function(...args) {

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {


      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');

      // Sends a message about the endpoint it spied on
      cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap'))) {
      // Fetch custom for all images but opensourcemap

      const blink = Date.now(); // Current time

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Returns the manipulated blob
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID(); // Generates a random UUID

        // Store the blob while we wait for processing
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          // The response that triggers when the blob is finished processing

          // Creates a new response
          resolve(new Response(blobProcessed, {
            headers: cloned.headers,
            status: cloned.status,
            statusText: cloned.statusText
          }));

          // Since this code does not run in the userscript, we can't use consoleLog().
          console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
        });

        window.postMessage({
          source: 'blue-marble',
          endpoint: endpointName,
          blobID: blobUUID,
          blobData: blob,
          blink: blink
        });
      }).catch(exception => {
        const elapsed = Date.now();
        console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
        console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
        console.log(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')} MM:SS.mmm`);
        console.error(`Exception stack:`, exception);
        console.groupEnd();
      });

      // cloned.blob().then(blob => {
      //   window.postMessage({
      //     source: 'blue-marble',
      //     endpoint: endpointName,
      //     blobData: blob
      //   }, '*');
      // });
    }

    return response; // Returns the original response
  };
});

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);

// Imports the Roboto Mono font family
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head.appendChild(stylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlay = new Overlay(name, version); // Constructs a new Overlay object
const templateManager = new TemplateManager(name, version, overlay); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlay.setApiManager(apiManager); // Sets the API manager

buildOverlayMain(); // Builds the main overlay

overlay.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlay); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) {return;} // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move ↑';
      move.className = 'btn btn-soft';
      move.onclick = function() {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Deploys the overlay to the page.
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */
function buildOverlayMain() {
  overlay.addDiv({'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;'})
    .addDiv({'id': 'bm-contain-header'})
      .addDiv({'id': 'bm-bar-drag'}).buildElement()
      .addImg({'alt': 'Blue Marble Icon', 'src': 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png'}).buildElement()
      .addHeader(1, {'textContent': name}).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-userinfo'})
      .addP({'id': 'bm-user-name', 'textContent': 'Username:'}).buildElement()
      .addP({'id': 'bm-user-droplets', 'textContent': 'Droplets:'}).buildElement()
      .addP({'id': 'bm-user-nextlevel', 'textContent': 'Next level in...'}).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({'id': 'bm-contain-automation'})
      // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
      // .addBr().buildElement()
      // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
      // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
      // .addBr().buildElement()
      .addDiv({'id': 'bm-contain-coords'})
        .addButton({'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>'},
          (instance, button) => {
            button.onclick = () => {
              const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
              if (!coords?.[0]) {
                instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
                return;
              }
              instance.updateInnerHTML('bm-input-tx', coords?.[0] || '');
              instance.updateInnerHTML('bm-input-ty', coords?.[1] || '');
              instance.updateInnerHTML('bm-input-px', coords?.[2] || '');
              instance.updateInnerHTML('bm-input-py', coords?.[3] || '');
            }
          }
        ).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
        .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true}).buildElement()
      .buildElement()
      .addInputFile({'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'}).buildElement()
      .addDiv({'id': 'bm-contain-buttons-template'})
        .addButton({'id': 'bm-button-enable', 'textContent': 'Enable'}, (instance, button) => {
          button.onclick = () => {
            const input = document.querySelector('#bm-input-file-template');

            const coordTlX = document.querySelector('#bm-input-tx');
            if (!coordTlX.checkValidity()) {coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordTlY = document.querySelector('#bm-input-ty');
            if (!coordTlY.checkValidity()) {coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxX = document.querySelector('#bm-input-px');
            if (!coordPxX.checkValidity()) {coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}
            const coordPxY = document.querySelector('#bm-input-py');
            if (!coordPxY.checkValidity()) {coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return;}

            // Kills itself if there is no file
            if (!input?.files[0]) {instance.handleDisplayError(`No file selected!`); return;}

            templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);

            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // apiManager.templateCoordsTilePixel = apiManager.coordsTilePixel; // Update template coords
            // console.log(`TCoords: ${apiManager.templateCoordsTilePixel}\nCoords: ${apiManager.coordsTilePixel}`);
            // templateManager.setTemplateImage(input.files[0]);

            instance.handleDisplayStatus(`Drew to canvas!`);
          }
        }).buildElement()
        // .addButton({'id': 'bm-button-disable', 'textContent': 'Disable'}).buildElement()
      .buildElement()
      .addTextarea({'id': overlay.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true}).buildElement()
      .addDiv({'id': 'bm-contain-buttons-action'})
        .addDiv()
          // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
          // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
          // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
          .addButton({'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter'}, 
            (instance, button) => {
            button.addEventListener('click', () => {
              window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
            });
          }).buildElement()
        .buildElement()
        .addSmall({'textContent': 'Made by SwingTheVine', 'style': 'margin-top: auto;'}).buildElement()
      .buildElement()
    .buildElement()
  .buildOverlay(document.body);
}