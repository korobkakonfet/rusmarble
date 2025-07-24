import { Overlay } from './overlay.js';
import { ApiHandler } from './apiHandler.js';

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
      endpointName = endpointName.split('/').filter(Boolean).pop() || 'ignore';

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

// Imports overlay CSS from src folder on github
const cssOverlay = GM_getResourceText("CSS-Overlay");
GM_addStyle(cssOverlay);

const overlay = new Overlay(); // Constructs a new Overlay object
overlay.create(); // Deploys the overlay to the page

const apiHandler = new ApiHandler(); // Constructs a new ApiHandler object
apiHandler.spontaneousResponseListener(overlay); // Reads spontaneous fetch responces

console.log("Blue Marble userscript has loaded!");