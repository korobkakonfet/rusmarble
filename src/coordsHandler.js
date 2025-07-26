/** Handles translation of coordinate systems.
 * @since 0.42.4
 */
export class CoordsHandler {

  /** Converts the server tile-pixel coordinate system to the displayed tile-pixel coordinate system.
   * @param {string[]} tile - The tile to convert (as an array like ["12", "124"])
   * @param {string[]} pixel - The pixel to convert (as an array like ["12", "124"])
   * @returns {number[]} [tile, pixel]
   * @since 0.42.4
   * @example
   * console.log(serverTPtoDisplayTP(['12', '123'], ['34', '567'])); // [34, 3567]
   */
  serverTPtoDisplayTP(tile, pixel) {
    return [((parseInt(tile[0]) % 4) * 1000) + parseInt(pixel[0]), ((parseInt(tile[1]) % 4) * 1000) + parseInt(pixel[1])];
  }
}