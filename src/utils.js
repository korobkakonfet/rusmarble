/** Contains miscellaneous helper functions.
 * @since 0.44.2
 */
export default class Utils {

  /** Sanitizes HTML to display as plain-text.
   * This prevents some Cross Site Scripting (XSS).
   * This is handy when you are displaying user-made data, and you *must* use innerHTML.
   * @param {string} text - The text to sanitize
   * @returns {string} HTML escaped string
   * @since 0.44.2
   * @example
   * const paragraph = document.createElement('p');
   * paragraph.innerHTML = escapeHTML('<u>Foobar.</u>');
   * // Output:
   * // (Does not include the paragraph element)
   * // (Output is not HTML formatted)
   * <p>
   *   "<u>Foobar.</u>"
   * </p>
   */
  static escapeHTML(text) {
    const div = document.createElement('div'); // Creates a div
    div.textContent = text; // Puts the text in a PLAIN-TEXT property
    return div.innerHTML; // Returns the HTML property of the div
  }
}