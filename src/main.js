import Overlay from './overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';

const name = GM_info.script.name.toString();
const version = GM_info.script.version.toString();

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} fn - The code to execute
 * @since 0.11.15
 */
function inject(fn) {
    const script = document.createElement('script');
    script.textContent = `(${fn})();`;
    document.documentElement.appendChild(script);
    script.remove();
}

/** What code to execute instantly in the client.
 * This code will execute outside of TamperMonkey's sandbox
 * @since 0.11.15
 */
inject(() => {
  
  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function(...args) {

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {

      // Retrieves the endpoint name. Unknown endpoint = "ignore"
      let endpointName = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';
      //endpointName = endpointName.split('/').filter(Boolean).pop() || 'ignore';

      console.log(`Sending JSON message about endpoint "${endpointName}"`);

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
          console.error('BM - Failed to parse JSON:', err);
        });
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

const observers = new Observers(); // Constructs a new Observers object
const overlay = new Overlay(name, version); // Constructs a new Overlay object
const apiManager = new ApiManager(); // Constructs a new ApiManager object

overlay.setApiManager(apiManager); // Sets the API manager

// Deploys the overlay to the page
// Parent/child relationships in the DOM structure below are indicated by indentation
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
    .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
    .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
    .addBr().buildElement()
    .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
    .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
    .addBr().buildElement()
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
      .addInput({'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1}).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1}).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1}).buildElement()
      .addInput({'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1}).buildElement()
    .buildElement()
    .addInputFile({'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif'}).buildElement()
    .addDiv({'id': 'bm-contain-buttons'})
      .addButton({'id': 'bm-button-enable', 'textContent': 'Enable'}, (instance, button) => {
        button.onclick = () => {
          const input = document.querySelector('#bm-input-file-template');

          // Kills itself if there is no file
          if (!input?.files[0]) {instance.handleDisplayError(`No file selected!`); return;}

          const url = URL.createObjectURL(input.files[0]); // Creates a blob URL
          window.open(url, '_blank'); // Opens a new tab with blob
          setTimeout(() => URL.revokeObjectURL(url), 10000); // Destroys the blob 10 seconds later
        }
      }).buildElement()
      .addButton({'id': 'bm-button-disable', 'textContent': 'Disable'}).buildElement()
    .buildElement()
    .addTextarea({'id': overlay.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true}).buildElement()
  .buildElement()
.buildOverlay(document.body);

overlay.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlay); // Reads spontaneous fetch responces

console.log(`${name} (${version}) userscript has loaded!`);