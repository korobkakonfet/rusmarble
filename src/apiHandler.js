/** ApiHandler class for handling API requests, responses, and interactions.
 * Note: Fetch spying is done in main.js, not here.
 * @since 0.11.1
 */
export class ApiHandler {

  /** Constructor for ApiHandler class
   * @param {CoordsHandler} coordsHandler - The CoordsHandler instance
   * @since 0.11.34
   */
  constructor(coordsHandler) {
    this.coordsHandler = coordsHandler;
    this.disableAll = false; // Should the entire userscript be disabled?
    this.coordsTilePixel = []; // Contains the last detected tile/pixel coordinate pair requested
  }

  /** Determines if the spontaneously recieved response is something we want.
   * Otherwise, we can ignore it.
   * @param {Overlay} overlay - The Overlay class instance
   * @since 0.11.1
  */
  spontaneousResponseListener(overlay) {

    // Triggers whenever a message is sent
    window.addEventListener('message', (event) => {

      const data = event.data; // The data of the message

      // Kills itself if the message was not intended for Blue Marble
      if (!(data && data.source === 'blue-marble')) {return;}

      // Trims endpoint to the second to last non-number, non-null directoy.
      // E.g. "wplace.live/api/pixel/0/0?payload" -> "pixel"
      const endpointText = data.endpoint.split('?')[0].split('/').filter(s => s && isNaN(Number(s))).pop();

      console.log(`Recieved message about "${endpointText}"`);

      // Each case is something that Blue Marble can use from the fetch.
      // For instance, if the fetch was for "me", we can update the overlay stats
      switch (endpointText) {

        case 'me': // Request to retrieve user data
          const nextLevelPixels = Math.ceil(Math.pow(Math.floor(data.jsonData?.level) * Math.pow(30, 0.65), (1/0.65)) - data.jsonData?.pixelsPainted); // Calculates pixels to the next level

          overlay.updateInnerHTML('bm-user-name', `Username: <b>${data.jsonData?.name}</b>`); // Updates the text content of the username field
          overlay.updateInnerHTML('bm-user-droplets', `Droplets: <b>${new Intl.NumberFormat().format(data.jsonData?.droplets)}</b>`); // Updates the text content of the droplets field
          overlay.updateInnerHTML('bm-user-nextlevel', `Next level in <b>${new Intl.NumberFormat().format(nextLevelPixels)}</b> pixel${nextLevelPixels == 1 ? '' : 's'}`); // Updates the text content of the next level field
          break;

        case 'pixel': // Request to retrieve pixel data
          const coordsTile = data.endpoint.split('?')[0].split('/').filter(s => s && !isNaN(Number(s))); // Retrieves the tile coords as [x, y]
          const payloadExtractor = new URLSearchParams(data.endpoint.split('?')[1]); // Declares a new payload deconstructor and passes in the fetch request payload
          const coordsPixel = [payloadExtractor.get('x'), payloadExtractor.get('y')]; // Retrieves the deconstructed pixel coords from the payload
          this.coordsTilePixel = [...coordsTile, ...coordsPixel]; // Combines the two arrays such that [x, y, x, y]
          const displayTP = this.coordsHandler.serverTPtoDisplayTP(coordsTile, coordsPixel);
          
          const spanElements = document.querySelectorAll('span'); // Retrieves all span elements

          // For every span element, find the one we want (pixel numbers when canvas clicked)
          for (const element of spanElements) {
            if (element.textContent.trim().includes(`${displayTP[0]}, ${displayTP[1]}`)) {

              let displayCoords = document.querySelector('#bm-display-coords'); // Find the additional pixel coords span

              const text = `(Tl X: ${coordsTile[0]}, Tl Y: ${coordsTile[1]}, Px X: ${coordsPixel[0]}, Px Y: ${coordsPixel[1]})`;
              
              // If we could not find the addition coord span, we make it then update the textContent with the new coords
              if (!displayCoords) {
                displayCoords = document.createElement('span');
                displayCoords.id = 'bm-display-coords';
                displayCoords.textContent = text;
                displayCoords.style = 'margin-left: calc(var(--spacing)*3); font-size: small;';
                element.parentNode.parentNode.parentNode.insertAdjacentElement('afterend', displayCoords);
              } else {
                displayCoords.textContent = text;
              }
            }
          }
          break;

        case 'robots': // Request to retrieve what script types are allowed
          this.disableAll = data.jsonData?.userscript?.toString().toLowerCase() == 'false'; // Disables Blue Marble if site owner wants userscripts disabled
          break;

      }
    });
  }
}