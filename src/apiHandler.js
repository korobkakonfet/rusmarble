/** ApiHandler class for handling API requests, responses, and interactions.
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
  manageSpontaneousResponse(overlay) {

    // Triggers whenever a message is sent
    window.addEventListener('message', (event) => {

      const data = event.data; // The data of the message

      // Kills itself if the message was not intended for Blue Marble
      if (!(data && data.source === 'blue-marble')) {return;}

      // Each case is something that Blue Marble can use from the fetch.
      // For instance, if the fetch was for "me", we can update the overlay stats
      switch (data.endpoint) {
        case 'me':
          console.log(`${data.jsonData?.name} has ${data.jsonData?.droplets} droplets`);
          break;
        case 'robots':
          this.disableAll = data.jsonData?.userscript?.toString().toLowerCase() == 'false';

      }
    });
  }
}