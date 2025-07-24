/** ApiHandler class for handling API requests, responses, and interactions.
 * Note: Fetch spying is done in main.js, not here.
 * @since 0.11.1
 */
export class ApiHandler {

  /** Constructor for ApiHandler class
   * @since 0.11.34
   */
  constructor() {
    this.disableAll = false; // Should the entire userscript be disabled?
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

      // Each case is something that Blue Marble can use from the fetch.
      // For instance, if the fetch was for "me", we can update the overlay stats
      switch (data.endpoint) {
        case 'me':
          const nextLevelPixels = Math.ceil(Math.pow(Math.floor(data.jsonData?.level) * Math.pow(30, 0.65), (1/0.65)) - data.jsonData?.pixelsPainted); // Calculates pixels to the next level

          overlay.updateInnerHTML('bm-user-name', `Username: <b>${data.jsonData?.name}</b>`); // Updates the text content of the username field
          overlay.updateInnerHTML('bm-user-droplets', `Droplets: <b>${new Intl.NumberFormat().format(data.jsonData?.droplets)}</b>`); // Updates the text content of the droplets field
          overlay.updateInnerHTML('bm-user-nextlevel', `Next level in <b>${new Intl.NumberFormat().format(nextLevelPixels)}</b> pixel${nextLevelPixels == 1 ? '' : 's'}`); // Updates the text content of the next level field
          break;
        case 'robots':
          this.disableAll = data.jsonData?.userscript?.toString().toLowerCase() == 'false'; // Disables Blue Marble if site owner wants userscripts disabled

      }
    });
  }
}