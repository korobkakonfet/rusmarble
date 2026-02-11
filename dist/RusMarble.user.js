// ==UserScript==
// @name         Rus Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.87.4
// @description  A userscript to automate and/or enhance the user experience on Wplace.live. Make sure to comply with the site's Terms of Service, and rules! This script is not affiliated with Wplace.live in any way, use at your own risk. This script is not affiliated with TamperMonkey. The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script. This script is provided "as is" under the MPL-2.0 license. The "Rus Marble" icon is the Flag of Russia.
// @author       SwingTheVine
// @license      MPL-2.0
// @supportURL   https://discord.gg/tpeBPy46hf
// @homepageURL  https://RusMarble.camilledaguin.fr/
// @icon         https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Flag_of_Russia.svg/960px-Flag_of_Russia.svg.png
// @match        https://wplace.live/*
// @grant        GM.addStyle
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      localhost:8003
// @connect      telemetry.thebluecorner.net
// @noframes
// ==/UserScript==

// Wplace  --> https://wplace.live
// License --> https://www.mozilla.org/en-US/MPL/2.0/


(() => {
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

  // src/polyfill.js
  if (!window.OffscreenCanvas) {
    window.OffscreenCanvas = function(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.convertToBlob = function({ type, quality } = {}) {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("toBlob() returned null"));
          }, type, quality);
        });
      };
      return canvas;
    };
  }
  if (!Array.prototype.extend) {
    Array.prototype.extend = function(elements) {
      elements.forEach((element) => this.push(element));
    };
  }

  // src/Overlay.js
  var _Overlay_instances, createElement_fn;
  var Overlay = class {
    /** Constructor for the Overlay class.
     * @param {string} name - The name of the userscript
     * @param {string} version - The version of the userscript
     * @since 0.0.2
     * @see {@link Overlay}
     */
    constructor(name2, version2) {
      __privateAdd(this, _Overlay_instances);
      this.name = name2;
      this.version = version2;
      this.apiManager = null;
      this.outputStatusId = "bm-output-status";
      this.overlay = null;
      this.currentParent = null;
      this.parentStack = [];
    }
    /** Populates the apiManager variable with the apiManager class.
     * @param {apiManager} apiManager - The apiManager class instance
     * @since 0.41.4
     */
    setApiManager(apiManager2) {
      this.apiManager = apiManager2;
    }
    /** Finishes building an element.
     * Call this after you are finished adding children.
     * If the element will have no children, call it anyways.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.2
     * @example
     * overlay
     *   .addDiv()
     *     .addHeader(1).buildElement() // Breaks out of the <h1>
     *     .addP().buildElement() // Breaks out of the <p>
     *   .buildElement() // Breaks out of the <div>
     *   .addHr() // Since there are no more elements, calling buildElement() is optional
     * .buildOverlay(document.body);
     */
    buildElement() {
      if (this.parentStack.length > 0) {
        this.currentParent = this.parentStack.pop();
      }
      return this;
    }
    /** Finishes building the overlay and displays it.
     * Call this when you are done chaining methods.
     * @param {HTMLElement} parent - The parent HTMLElement this overlay should be appended to as a child.
     * @since 0.43.2
     * @example
     * overlay
     *   .addDiv()
     *     .addP().buildElement()
     *   .buildElement()
     * .buildOverlay(document.body); // Adds DOM structure to document body
     * // <div><p></p></div>
     */
    buildOverlay(parent) {
      parent?.appendChild(this.overlay);
      this.overlay = null;
      this.currentParent = null;
      this.parentStack = [];
    }
    /** Adds a `div` to the overlay.
     * This `div` element will have properties shared between all `div` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `div` that are NOT shared between all overlay `div` elements. These should be camelCase.
     * @param {function(Overlay, HTMLDivElement):void} [callback=()=>{}] - Additional JS modification to the `div`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.2
     * @example
     * // Assume all <div> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addDiv({'id': 'foo'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <div id="foo" class="bar"></div>
     * </body>
     */
    addDiv(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const div = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "div", properties, additionalProperties);
      callback(this, div);
      return this;
    }
    /** Adds a `p` to the overlay.
     * This `p` element will have properties shared between all `p` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `p` that are NOT shared between all overlay `p` elements. These should be camelCase.
     * @param {function(Overlay, HTMLParagraphElement):void} [callback=()=>{}] - Additional JS modification to the `p`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.2
     * @example
     * // Assume all <p> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addP({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <p id="foo" class="bar">Foobar.</p>
     * </body>
     */
    addP(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const p = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "p", properties, additionalProperties);
      callback(this, p);
      return this;
    }
    /** Similar to addP, but adds a `span` instead.
     * @since 0.85.27
     */
    addSpan(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const span = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "span", properties, additionalProperties);
      callback(this, span);
      return this;
    }
    /** Similar to addSpan, but adds a `b` instead.
     * @since 0.85.27
     */
    addB(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const b = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "b", properties, additionalProperties);
      callback(this, b);
      return this;
    }
    /** Adds plain text to the overlay
     * No .buildElement() is required
     * @since 0.43.27
     */
    addText(textContent) {
      if (!this.overlay) return this;
      const textNode = document.createTextNode(textContent);
      this.currentParent?.appendChild(textNode);
      return this;
    }
    /** Adds a `small` to the overlay.
     * This `small` element will have properties shared between all `small` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `small` that are NOT shared between all overlay `small` elements. These should be camelCase.
     * @param {function(Overlay, HTMLParagraphElement):void} [callback=()=>{}] - Additional JS modification to the `small`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.55.8
     * @example
     * // Assume all <small> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addSmall({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <small id="foo" class="bar">Foobar.</small>
     * </body>
     */
    addSmall(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const small = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "small", properties, additionalProperties);
      callback(this, small);
      return this;
    }
    /** Adds a `img` to the overlay.
     * This `img` element will have properties shared between all `img` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `img` that are NOT shared between all overlay `img` elements. These should be camelCase.
     * @param {function(Overlay, HTMLImageElement):void} [callback=()=>{}] - Additional JS modification to the `img`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.2
     * @example
     * // Assume all <img> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addimg({'id': 'foo', 'src': './img.png'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <img id="foo" src="./img.png" class="bar">
     * </body>
     */
    addImg(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const img = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "img", properties, additionalProperties);
      callback(this, img);
      return this;
    }
    /** Adds a header to the overlay.
     * This header element will have properties shared between all header elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {number} level - The header level. Must be between 1 and 6 (inclusive)
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the header that are NOT shared between all overlay header elements. These should be camelCase.
     * @param {function(Overlay, HTMLHeadingElement):void} [callback=()=>{}] - Additional JS modification to the header.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.7
     * @example
     * // Assume all header elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addHeader(6, {'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <h6 id="foo" class="bar">Foobar.</h6>
     * </body>
     */
    addHeader(level, additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const header = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "h" + level, properties, additionalProperties);
      callback(this, header);
      return this;
    }
    /** Adds a `hr` to the overlay.
     * This `hr` element will have properties shared between all `hr` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `hr` that are NOT shared between all overlay `hr` elements. These should be camelCase.
     * @param {function(Overlay, HTMLHRElement):void} [callback=()=>{}] - Additional JS modification to the `hr`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.7
     * @example
     * // Assume all <hr> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addhr({'id': 'foo'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <hr id="foo" class="bar">
     * </body>
     */
    addHr(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const hr = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "hr", properties, additionalProperties);
      callback(this, hr);
      return this;
    }
    /** Adds a `br` to the overlay.
     * This `br` element will have properties shared between all `br` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `br` that are NOT shared between all overlay `br` elements. These should be camelCase.
     * @param {function(Overlay, HTMLBRElement):void} [callback=()=>{}] - Additional JS modification to the `br`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.11
     * @example
     * // Assume all <br> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addbr({'id': 'foo'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <br id="foo" class="bar">
     * </body>
     */
    addBr(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const br = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "br", properties, additionalProperties);
      callback(this, br);
      return this;
    }
    /** Adds a checkbox to the overlay.
     * This checkbox element will have properties shared between all checkbox elements in the overlay.
     * You can override the shared properties by using a callback. Note: the checkbox element is inside a label element.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the checkbox that are NOT shared between all overlay checkbox elements. These should be camelCase.
     * @param {function(Overlay, HTMLLabelElement, HTMLInputElement):void} [callback=()=>{}] - Additional JS modification to the checkbox.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.10
     * @example
     * // Assume all checkbox elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addCheckbox({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <label>
     *     <input type="checkbox" id="foo" class="bar">
     *     "Foobar."
     *   </label>
     * </body>
     */
    addCheckbox(additionalProperties = {}, callback = () => {
    }) {
      const properties = { "type": "checkbox" };
      const label = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "label", { "textContent": additionalProperties["textContent"] ?? "" });
      delete additionalProperties["textContent"];
      const checkbox = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "input", properties, additionalProperties);
      label.insertBefore(checkbox, label.firstChild);
      this.buildElement();
      callback(this, label, checkbox);
      return this;
    }
    /** Adds a 'details' to the overlay.
     * This details element will have properties shared between all details elements in the overlay.
     * You can override the shared properties by using a callback. Note: the summary element is inside a details element.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the details that are NOT shared between all overlay details elements. These should be camelCase.
     * @param {function(Overlay, HTMLSummaryElement, HTMLDetailsElement):void} [callback=()=>{}] - Additional JS modification to the details.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.85.34
     * @example
     * // Assume all details elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addDetails({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <details id="foo" class="bar">
     *     <summary>Foobar.</summary>
     *   </details>
     * </body>
     */
    addDetails(additionalProperties = {}, callback = () => {
    }) {
      const properties = { "type": "details" };
      const textContent = additionalProperties["textContent"];
      delete additionalProperties["textContent"];
      const details = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "details", properties, additionalProperties);
      const summary = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "summary", { "textContent": textContent ?? "" });
      details.appendChild(summary);
      this.buildElement();
      callback(this, summary, details);
      return this;
    }
    /** Adds a `button` to the overlay.
     * This `button` element will have properties shared between all `button` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `button` that are NOT shared between all overlay `button` elements. These should be camelCase.
     * @param {function(Overlay, HTMLButtonElement):void} [callback=()=>{}] - Additional JS modification to the `button`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.12
     * @example
     * // Assume all <button> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addButton({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <button id="foo" class="bar">Foobar.</button>
     * </body>
     */
    addButton(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const button = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "button", properties, additionalProperties);
      callback(this, button);
      return this;
    }
    /** Adds a help button to the overlay. It will have a "?" icon unless overridden in callback.
     * On click, the button will attempt to output the title to the output element (ID defined in Overlay constructor).
     * This `button` element will have properties shared between all `button` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `button` that are NOT shared between all overlay `button` elements. These should be camelCase.
     * @param {function(Overlay, HTMLButtonElement):void} [callback=()=>{}] - Additional JS modification to the `button`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.12
     * @example
     * // Assume all help button elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addButtonHelp({'id': 'foo', 'title': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <button id="foo" class="bar" title="Help: Foobar.">?</button>
     * </body>
     * @example
     * // Assume all help button elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addButtonHelp({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <button id="foo" class="bar" title="Help: Foobar.">?</button>
     * </body>
     */
    addButtonHelp(additionalProperties = {}, callback = () => {
    }) {
      const tooltip = additionalProperties["title"] ?? additionalProperties["textContent"] ?? "Help: No info";
      delete additionalProperties["textContent"];
      additionalProperties["title"] = `Help: ${tooltip}`;
      const properties = {
        "textContent": "?",
        "className": "bm-help",
        "onclick": () => {
          this.updateInnerHTML(this.outputStatusId, tooltip);
        }
      };
      const help = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "button", properties, additionalProperties);
      callback(this, help);
      return this;
    }
    /** Adds a select to the overlay.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the checkbox that are NOT shared between all overlay checkbox elements. These should be camelCase.
     * @param {function(Overlay, HTMLSelectElement):void} [callback=()=>{}] - Additional JS modification to the checkbox.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.85.23
     */
    addSelect(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const select = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "select", properties, additionalProperties);
      callback(this, select);
      return this;
    }
    /** Adds a `input` to the overlay.
     * This `input` element will have properties shared between all `input` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `input` that are NOT shared between all overlay `input` elements. These should be camelCase.
     * @param {function(Overlay, HTMLInputElement):void} [callback=()=>{}] - Additional JS modification to the `input`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.13
     * @example
     * // Assume all <input> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addInput({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <input id="foo" class="bar">Foobar.</input>
     * </body>
     */
    addInput(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const input = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "input", properties, additionalProperties);
      callback(this, input);
      return this;
    }
    /** Adds a file input to the overlay with enhanced visibility controls.
     * This input element will have properties shared between all file input elements in the overlay.
     * Uses multiple hiding methods to prevent browser native text from appearing during minimize/maximize.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the file input that are NOT shared between all overlay file input elements. These should be camelCase.
     * @param {function(Overlay, HTMLDivElement, HTMLInputElement, HTMLButtonElement):void} [callback=()=>{}] - Additional JS modification to the file input.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.17
     * @example
     * // Assume all file input elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addInputFile({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <div>
     *     <input type="file" id="foo" class="bar" style="display: none"></input>
     *     <button>Foobar.</button>
     *   </div>
     * </body>
     */
    addInputFile(additionalProperties = {}, callback = () => {
    }) {
      const properties = {
        "type": "file",
        "style": "display: none !important; visibility: hidden !important; position: absolute !important; left: -9999px !important; width: 0 !important; height: 0 !important; opacity: 0 !important;"
      };
      const text = additionalProperties["textContent"] ?? "";
      delete additionalProperties["textContent"];
      const container = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "span");
      const input = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "input", properties, additionalProperties);
      this.buildElement();
      const button = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "button", { "textContent": text });
      this.buildElement();
      this.buildElement();
      input.setAttribute("tabindex", "-1");
      input.setAttribute("aria-hidden", "true");
      button.addEventListener("click", () => {
        input.click();
      });
      input.addEventListener("change", () => {
        button.style.maxWidth = `${button.offsetWidth}px`;
        if (input.files.length > 0) {
          button.textContent = input.files[0].name;
        } else {
          button.textContent = text;
        }
      });
      callback(this, container, input, button);
      return this;
    }
    /** Adds a `textarea` to the overlay.
     * This `textarea` element will have properties shared between all `textarea` elements in the overlay.
     * You can override the shared properties by using a callback.
     * @param {Object.<string, any>} [additionalProperties={}] - The DOM properties of the `textarea` that are NOT shared between all overlay `textarea` elements. These should be camelCase.
     * @param {function(Overlay, HTMLTextAreaElement):void} [callback=()=>{}] - Additional JS modification to the `textarea`.
     * @returns {Overlay} Overlay class instance (this)
     * @since 0.43.13
     * @example
     * // Assume all <textarea> elements have a shared class (e.g. {'className': 'bar'})
     * overlay.addTextarea({'id': 'foo', 'textContent': 'Foobar.'}).buildOverlay(document.body);
     * // Output:
     * // (Assume <body> already exists in the webpage)
     * <body>
     *   <textarea id="foo" class="bar">Foobar.</textarea>
     * </body>
     */
    addTextarea(additionalProperties = {}, callback = () => {
    }) {
      const properties = {};
      const textarea = __privateMethod(this, _Overlay_instances, createElement_fn).call(this, "textarea", properties, additionalProperties);
      callback(this, textarea);
      return this;
    }
    /** Updates the inner HTML of the element.
     * The element is discovered by it's id.
     * If the element is an `input`, it will modify the value attribute instead.
     * @param {string} id - The ID of the element to change
     * @param {string} html - The HTML/text to update with
     * @param {boolean} [doSafe] - (Optional) Should `textContent` be used instead of `innerHTML` to avoid XSS? False by default
     * @since 0.24.2
     */
    updateInnerHTML(id, html, doSafe = false) {
      const element = document.getElementById(id.replace(/^#/, ""));
      if (!element) {
        return;
      }
      if (element instanceof HTMLInputElement) {
        element.value = html;
        return;
      }
      if (doSafe) {
        element.textContent = html;
      } else {
        element.innerHTML = html;
      }
    }
    /** Handles dragging of the overlay.
     * Uses requestAnimationFrame for smooth animations and GPU-accelerated transforms.
     * @param {string} moveMe - The ID of the element to be moved
     * @param {string} iMoveThings - The ID of the drag handle element
     * @since 0.8.2
    */
    handleDrag(moveMe, iMoveThings) {
      let isDragging = false;
      let offsetX, offsetY = 0;
      let animationFrame = null;
      let currentX = 0;
      let currentY = 0;
      let targetX = 0;
      let targetY = 0;
      moveMe = document.querySelector(moveMe?.[0] == "#" ? moveMe : "#" + moveMe);
      iMoveThings = document.querySelector(iMoveThings?.[0] == "#" ? iMoveThings : "#" + iMoveThings);
      if (!moveMe || !iMoveThings) {
        this.handleDisplayError(`Can not drag! ${!moveMe ? "moveMe" : ""} ${!moveMe && !iMoveThings ? "and " : ""}${!iMoveThings ? "iMoveThings " : ""}was not found!`);
        return;
      }
      const updatePosition = () => {
        if (isDragging) {
          const deltaX = Math.abs(currentX - targetX);
          const deltaY = Math.abs(currentY - targetY);
          if (deltaX > 0.5 || deltaY > 0.5) {
            currentX = targetX;
            currentY = targetY;
            moveMe.style.transform = `translate(${currentX}px, ${currentY}px)`;
            moveMe.style.left = "0px";
            moveMe.style.top = "0px";
            moveMe.style.right = "";
          }
          animationFrame = requestAnimationFrame(updatePosition);
        }
      };
      let initialRect = null;
      const startDrag = (clientX, clientY) => {
        isDragging = true;
        initialRect = moveMe.getBoundingClientRect();
        offsetX = clientX - initialRect.left;
        offsetY = clientY - initialRect.top;
        const computedStyle = window.getComputedStyle(moveMe);
        const transform = computedStyle.transform;
        if (transform && transform !== "none") {
          const matrix = new DOMMatrix(transform);
          currentX = matrix.m41;
          currentY = matrix.m42;
        } else {
          currentX = initialRect.left;
          currentY = initialRect.top;
        }
        targetX = currentX;
        targetY = currentY;
        document.body.style.userSelect = "none";
        iMoveThings.classList.add("dragging");
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
        }
        updatePosition();
      };
      const endDrag = () => {
        isDragging = false;
        if (animationFrame) {
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }
        document.body.style.userSelect = "";
        iMoveThings.classList.remove("dragging");
      };
      iMoveThings.addEventListener("mousedown", function(event) {
        event.preventDefault();
        startDrag(event.clientX, event.clientY);
      });
      iMoveThings.addEventListener("touchstart", function(event) {
        const touch = event?.touches?.[0];
        if (!touch) {
          return;
        }
        startDrag(touch.clientX, touch.clientY);
        event.preventDefault();
      }, { passive: false });
      document.addEventListener("mousemove", function(event) {
        if (isDragging && initialRect) {
          targetX = event.clientX - offsetX;
          targetY = event.clientY - offsetY;
        }
      }, { passive: true });
      document.addEventListener("touchmove", function(event) {
        if (isDragging && initialRect) {
          const touch = event?.touches?.[0];
          if (!touch) {
            return;
          }
          targetX = touch.clientX - offsetX;
          targetY = touch.clientY - offsetY;
          event.preventDefault();
        }
      }, { passive: false });
      document.addEventListener("mouseup", endDrag);
      document.addEventListener("touchend", endDrag);
      document.addEventListener("touchcancel", endDrag);
    }
    /** Handles status display.
     * This will output plain text into the output Status box.
     * Additionally, this will output an info message to the console.
     * @param {string} text - The status text to display.
     * @since 0.58.4
     */
    handleDisplayStatus(text) {
      const consoleInfo = console.info;
      consoleInfo(`${this.name}: ${text}`);
      this.updateInnerHTML(this.outputStatusId, "Status: " + text, true);
    }
    /** Handles error display.
     * This will output plain text into the output Status box.
     * Additionally, this will output an error to the console.
     * @param {string} text - The error text to display.
     * @since 0.41.6
     */
    handleDisplayError(text) {
      const consoleError2 = console.error;
      consoleError2(`${this.name}: ${text}`);
      this.updateInnerHTML(this.outputStatusId, "Error: " + text, true);
    }
  };
  _Overlay_instances = new WeakSet();
  /** Creates an element.
   * For **internal use** of the {@link Overlay} class.
   * @param {string} tag - The tag name as a string.
   * @param {Object.<string, any>} [properties={}] - The DOM properties of the element.
   * @returns {HTMLElement} HTML Element
   * @since 0.43.2
   */
  createElement_fn = function(tag, properties = {}, additionalProperties = {}) {
    const element = document.createElement(tag);
    if (!this.overlay) {
      this.overlay = element;
      this.currentParent = element;
    } else {
      this.currentParent?.appendChild(element);
      this.parentStack.push(this.currentParent);
      this.currentParent = element;
    }
    for (const [property, value] of Object.entries(properties)) {
      element[property] = value;
    }
    for (const [property, value] of Object.entries(additionalProperties)) {
      element[property] = value;
    }
    return element;
  };

  // src/utils.js
  function consoleLog(...args) {
    ((consoleLog2) => consoleLog2(...args))(console.log);
  }
  function consoleWarn(...args) {
    ((consoleWarn2) => consoleWarn2(...args))(console.warn);
  }
  function numberToEncoded(number, encoding) {
    if (number === 0) return encoding[0];
    let result = "";
    const base = encoding.length;
    while (number > 0) {
      result = encoding[number % base] + result;
      number = Math.floor(number / base);
    }
    return result;
  }
  function uint8ToBase64(uint8) {
    let binary = "";
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }
  function base64ToUint8(base64) {
    const binary = atob(base64);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      array[i] = binary.charCodeAt(i);
    }
    return array;
  }
  function selectAllCoordinateInputs(document2) {
    coords = [];
    coords.push(document2.querySelector("#bm-input-tx"));
    coords.push(document2.querySelector("#bm-input-ty"));
    coords.push(document2.querySelector("#bm-input-px"));
    coords.push(document2.querySelector("#bm-input-py"));
    return coords;
  }
  var colorpalette = [
    { "id": 0, "premium": false, "name": "Transparent", "rgb": [0, 0, 0] },
    { "id": 1, "premium": false, "name": "Black", "rgb": [0, 0, 0] },
    { "id": 2, "premium": false, "name": "Dark Gray", "rgb": [60, 60, 60] },
    { "id": 3, "premium": false, "name": "Gray", "rgb": [120, 120, 120] },
    { "id": 4, "premium": false, "name": "Light Gray", "rgb": [210, 210, 210] },
    { "id": 5, "premium": false, "name": "White", "rgb": [255, 255, 255] },
    { "id": 6, "premium": false, "name": "Deep Red", "rgb": [96, 0, 24] },
    { "id": 7, "premium": false, "name": "Red", "rgb": [237, 28, 36] },
    { "id": 8, "premium": false, "name": "Orange", "rgb": [255, 127, 39] },
    { "id": 9, "premium": false, "name": "Gold", "rgb": [246, 170, 9] },
    { "id": 10, "premium": false, "name": "Yellow", "rgb": [249, 221, 59] },
    { "id": 11, "premium": false, "name": "Light Yellow", "rgb": [255, 250, 188] },
    { "id": 12, "premium": false, "name": "Dark Green", "rgb": [14, 185, 104] },
    { "id": 13, "premium": false, "name": "Green", "rgb": [19, 230, 123] },
    { "id": 14, "premium": false, "name": "Light Green", "rgb": [135, 255, 94] },
    { "id": 15, "premium": false, "name": "Dark Teal", "rgb": [12, 129, 110] },
    { "id": 16, "premium": false, "name": "Teal", "rgb": [16, 174, 166] },
    { "id": 17, "premium": false, "name": "Light Teal", "rgb": [19, 225, 190] },
    { "id": 18, "premium": false, "name": "Dark Blue", "rgb": [40, 80, 158] },
    { "id": 19, "premium": false, "name": "Blue", "rgb": [64, 147, 228] },
    { "id": 20, "premium": false, "name": "Cyan", "rgb": [96, 247, 242] },
    { "id": 21, "premium": false, "name": "Indigo", "rgb": [107, 80, 246] },
    { "id": 22, "premium": false, "name": "Light Indigo", "rgb": [153, 177, 251] },
    { "id": 23, "premium": false, "name": "Dark Purple", "rgb": [120, 12, 153] },
    { "id": 24, "premium": false, "name": "Purple", "rgb": [170, 56, 185] },
    { "id": 25, "premium": false, "name": "Light Purple", "rgb": [224, 159, 249] },
    { "id": 26, "premium": false, "name": "Dark Pink", "rgb": [203, 0, 122] },
    { "id": 27, "premium": false, "name": "Pink", "rgb": [236, 31, 128] },
    { "id": 28, "premium": false, "name": "Light Pink", "rgb": [243, 141, 169] },
    { "id": 29, "premium": false, "name": "Dark Brown", "rgb": [104, 70, 52] },
    { "id": 30, "premium": false, "name": "Brown", "rgb": [149, 104, 42] },
    { "id": 31, "premium": false, "name": "Beige", "rgb": [248, 178, 119] },
    { "id": 32, "premium": true, "name": "Medium Gray", "rgb": [170, 170, 170] },
    { "id": 33, "premium": true, "name": "Dark Red", "rgb": [165, 14, 30] },
    { "id": 34, "premium": true, "name": "Light Red", "rgb": [250, 128, 114] },
    { "id": 35, "premium": true, "name": "Dark Orange", "rgb": [228, 92, 26] },
    { "id": 36, "premium": true, "name": "Light Tan", "rgb": [214, 181, 148] },
    { "id": 37, "premium": true, "name": "Dark Goldenrod", "rgb": [156, 132, 49] },
    { "id": 38, "premium": true, "name": "Goldenrod", "rgb": [197, 173, 49] },
    { "id": 39, "premium": true, "name": "Light Goldenrod", "rgb": [232, 212, 95] },
    { "id": 40, "premium": true, "name": "Dark Olive", "rgb": [74, 107, 58] },
    { "id": 41, "premium": true, "name": "Olive", "rgb": [90, 148, 74] },
    { "id": 42, "premium": true, "name": "Light Olive", "rgb": [132, 197, 115] },
    { "id": 43, "premium": true, "name": "Dark Cyan", "rgb": [15, 121, 159] },
    { "id": 44, "premium": true, "name": "Light Cyan", "rgb": [187, 250, 242] },
    { "id": 45, "premium": true, "name": "Light Blue", "rgb": [125, 199, 255] },
    { "id": 46, "premium": true, "name": "Dark Indigo", "rgb": [77, 49, 184] },
    { "id": 47, "premium": true, "name": "Dark Slate Blue", "rgb": [74, 66, 132] },
    { "id": 48, "premium": true, "name": "Slate Blue", "rgb": [122, 113, 196] },
    { "id": 49, "premium": true, "name": "Light Slate Blue", "rgb": [181, 174, 241] },
    { "id": 50, "premium": true, "name": "Light Brown", "rgb": [219, 164, 99] },
    { "id": 51, "premium": true, "name": "Dark Beige", "rgb": [209, 128, 81] },
    { "id": 52, "premium": true, "name": "Light Beige", "rgb": [255, 197, 165] },
    { "id": 53, "premium": true, "name": "Dark Peach", "rgb": [155, 82, 73] },
    { "id": 54, "premium": true, "name": "Peach", "rgb": [209, 128, 120] },
    { "id": 55, "premium": true, "name": "Light Peach", "rgb": [250, 182, 164] },
    { "id": 56, "premium": true, "name": "Dark Tan", "rgb": [123, 99, 82] },
    { "id": 57, "premium": true, "name": "Tan", "rgb": [156, 132, 107] },
    { "id": 58, "premium": true, "name": "Dark Slate", "rgb": [51, 57, 65] },
    { "id": 59, "premium": true, "name": "Slate", "rgb": [109, 117, 141] },
    { "id": 60, "premium": true, "name": "Light Slate", "rgb": [179, 185, 209] },
    { "id": 61, "premium": true, "name": "Dark Stone", "rgb": [109, 100, 63] },
    { "id": 62, "premium": true, "name": "Stone", "rgb": [148, 140, 107] },
    { "id": 63, "premium": true, "name": "Light Stone", "rgb": [205, 197, 158] }
  ];
  var rgbToMeta = new Map(
    colorpalette.filter((color) => Array.isArray(color?.rgb)).map((color) => [`${color.rgb[0]},${color.rgb[1]},${color.rgb[2]}`, { id: color.id, premium: !!color.premium, name: color.name }])
  );
  var defaceKey = "222,250,206";
  try {
    const transparent = colorpalette.find((color) => (color?.name || "").toLowerCase() === "transparent");
    if (transparent && Array.isArray(transparent.rgb)) {
      rgbToMeta.set(defaceKey, { id: transparent.id, premium: !!transparent.premium, name: transparent.name });
    }
  } catch (ignored) {
  }
  var keyOther = "other";
  try {
    rgbToMeta.set(keyOther, { id: "other", premium: false, name: "Other" });
  } catch (ignored) {
  }
  function cleanUpCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
    if (canvas.constructor === HTMLCanvasElement) canvas.remove();
    canvas = null;
  }
  function getOverlayCoordsRaw() {
    const tx = document.querySelector("#bm-input-tx")?.value || "";
    const ty = document.querySelector("#bm-input-ty")?.value || "";
    const px = document.querySelector("#bm-input-px")?.value || "";
    const py = document.querySelector("#bm-input-py")?.value || "";
    return [[tx, ty], [px, py]];
  }
  function getOverlayCoords() {
    const rawCoords = getOverlayCoordsRaw();
    const tx = Number(rawCoords[0][0]);
    const ty = Number(rawCoords[0][1]);
    const px = Number(rawCoords[1][0]);
    const py = Number(rawCoords[1][1]);
    return [[tx, ty], [px, py]];
  }
  function areOverlayCoordsFilledAndValid() {
    const rawCoords = getOverlayCoordsRaw();
    const parsedCoords = getOverlayCoords();
    if (rawCoords.some(
      (coords2) => coords2.some(
        (coord) => coord === ""
      )
    )) return false;
    if (parsedCoords.some(
      (coords2) => coords2.some(
        (coord) => isNaN(coord) || coord < 0
      )
    )) return false;
    if (parsedCoords[0][0] > 2048) return false;
    if (parsedCoords[0][1] > 2048) return false;
    if (parsedCoords[1][0] > 1e3) return false;
    if (parsedCoords[1][1] > 1e3) return false;
    return true;
  }
  var sortByOptions = {
    "total": ([rgb, paintedCount, totalCount]) => totalCount,
    "painted": ([rgb, paintedCount, totalCount]) => paintedCount,
    "remaining": ([rgb, paintedCount, totalCount]) => totalCount - paintedCount,
    "painted%": ([rgb, paintedCount, totalCount]) => paintedCount / (totalCount === 0 ? 1 : totalCount),
    "hue": ([rgb, paintedCount, totalCount]) => {
      if (rgb === "other") return 361;
      if (rgb === "#deface") return -1;
      const [r, g, b] = rgb.split(",").map(Number);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta === 0) return 361 + r;
      if (max === r) {
        return ((g - b) / delta + 6) % 6 * 60;
      } else if (max === g) {
        return ((b - r) / delta + 2) * 60;
      } else {
        return ((r - g) / delta + 4) * 60;
      }
    },
    "luminance": ([rgb, paintedCount, totalCount]) => {
      if (rgb === "other") return 2;
      if (rgb === "#deface") return 0;
      const [r, g, b] = rgb.split(",").map(Number);
      return (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    }
  };
  function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text);
    } else {
      var temp = document.createElement("textArea");
      temp.innerHTML = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    }
  }
  function calculateTopLeftAndSize(coords1, coords2) {
    const xs = [
      coords1[0][0] % 2048 * 1e3 + coords1[1][0] % 1e3,
      coords2[0][0] % 2048 * 1e3 + coords2[1][0] % 1e3
    ];
    const ys = [
      coords1[0][1] % 2048 * 1e3 + coords1[1][1] % 1e3,
      coords2[0][1] % 2048 * 1e3 + coords2[1][1] % 1e3
    ];
    const top = Math.min(ys[0], ys[1]);
    const height = Math.abs(ys[0] - ys[1]) + 1;
    const rawWidth = Math.abs(xs[0] - xs[1]) + 1;
    const earthWrap = rawWidth * 2 > 2048 * 1e3;
    const left = earthWrap ? Math.max(xs[0], xs[1]) : Math.min(xs[0], xs[1]);
    const width = earthWrap ? 2048 * 1e3 - rawWidth + 2 : rawWidth;
    return [[left, top], [width, height]];
  }
  function testCanvasSize(width, height) {
    let canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillRect(width - 1, height - 1, 1, 1);
    const result = context.getImageData(width - 1, height - 1, 1, 1).data[3] !== 0;
    cleanUpCanvas(canvas);
    canvas = null;
    return result;
  }
  function downloadTile(tx, ty) {
    const remoteURL = "https://backend.wplace.live/files/s0/tiles/" + tx % 2048 + "/" + ty + ".png";
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function() {
        resolve(img);
      };
      img.onerror = function(error) {
        reject(error);
      };
      img.src = remoteURL;
    });
  }
  function getCurrentColor() {
    const currentColor = Number(localStorage.getItem("selected-color")) ?? 0;
    if (isNaN(currentColor) || !isFinite(currentColor) || currentColor < 0 || currentColor >= 64) return 0;
    return currentColor;
  }
  function* plotLine([x0, y0], [x1, y1]) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      yield [x0, y0];
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  function lineBitmap([x0, y0], [x1, y1], [r, g, b]) {
    if (Math.abs(x1 - x0) * 2 > 2048e3) {
      if (x1 > x0) {
        x0 += 2048e3;
      } else {
        x1 += 2048e3;
      }
    }
    const minX = Math.min(x0, x1);
    const minY = Math.min(y0, y1);
    const maxX = Math.max(x0, x1);
    const maxY = Math.max(y0, y1);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const data = new Uint8ClampedArray(width * height * 4);
    const image = new ImageData(data, width, height);
    for (const [x, y] of plotLine([x0, y0], [x1, y1])) {
      const bx = x - minX;
      const by = y - minY;
      const idx = (by * width + bx) * 4;
      data[idx + 0] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
    return {
      imageData: image,
      offsetX: minX,
      offsetY: minY
    };
  }
  function midPointDistance([x0, y0], [x1, y1]) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const r2 = dx * dx + dy * dy;
    let y = Math.ceil(Math.sqrt(r2));
    let d = (y + y - 1) * (y + y - 1) - 4 * r2;
    if (d >= 0) {
      --y;
      d -= 8 * y;
    }
    return {
      "d": d,
      "y": y
    };
  }
  function* plotCircle([x0, y0], [x1, y1]) {
    let { d, y } = midPointDistance([x0, y0], [x1, y1]);
    yield [x0, y0 + y];
    if (y === 0) return;
    yield [x0, y0 - y];
    yield [x0 + y, y0];
    yield [x0 - y, y0];
    let x = 1;
    while (x < y) {
      d += 8 * x - 4;
      if (d >= 0) {
        --y;
        d -= 8 * y;
      }
      yield [x0 + x, y0 + y];
      yield [x0 + x, y0 - y];
      yield [x0 - x, y0 + y];
      yield [x0 - x, y0 - y];
      if (x == y) break;
      yield [x0 + y, y0 + x];
      yield [x0 + y, y0 - x];
      yield [x0 - y, y0 + x];
      yield [x0 - y, y0 - x];
      ++x;
    }
  }
  function circleBitmap([x0, y0], [x1, y1], [r, g, b]) {
    if (Math.abs(x1 - x0) * 2 > 2048e3) {
      if (x1 > x0) {
        x0 += 2048e3;
      } else {
        x1 += 2048e3;
      }
    }
    let { d, y } = midPointDistance([x0, y0], [x1, y1]);
    const minX = (x0 + 2048e3 - y) % 2048e3;
    const minY = Math.max(0, y0 - y);
    const actualX = minX + y;
    const actualX1 = x1 + (actualX - x0);
    const maxX = actualX + y;
    const maxY = Math.min(y0 + y, 2048e3 - 1);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const data = new Uint8ClampedArray(width * height * 4);
    const image = new ImageData(data, width, height);
    for (const [x, y2] of plotCircle([actualX, y0], [actualX1, y1])) {
      const bx = x - minX;
      const by = y2 - minY;
      if (bx < 0 || bx >= width) continue;
      if (by < 0 || by >= height) continue;
      const idx = (by * width + bx) * 4;
      data[idx + 0] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
    return {
      imageData: image,
      offsetX: minX,
      offsetY: minY
    };
  }

  // src/Template.js
  var Template = class {
    /** The constructor for the {@link Template} class with enhanced pixel tracking.
     * @param {Object} [params={}] - Object containing all optional parameters
     * @param {string} [params.displayName='My template'] - The display name of the template
     * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
     * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
     * @param {string} [params.url=''] - The URL to the source image
     * @param {File | ImageBitmap | ImageData} [params.file=null] - The template file (pre-processed File or processed bitmap)
     * @param {Array<number>} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
     * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
     * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
     * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
     * @since 0.65.2
     */
    constructor({
      displayName = "My template",
      sortID = 0,
      authorID = "",
      url = "",
      file = null,
      coords: coords2 = null,
      chunked = null,
      chunkedBuffer = null,
      tileSize = 1e3
    } = {}) {
      this.displayName = displayName;
      this.sortID = sortID;
      this.authorID = authorID;
      this.url = url;
      this.file = file;
      this.coords = coords2;
      this.chunked = chunked;
      this.chunkedBuffer = chunkedBuffer;
      this.tileSize = tileSize;
      this.enabled = true;
      this.pixelCount = 0;
      this.requiredPixelCount = 0;
      this.defacePixelCount = 0;
      this.colorPalette = {};
      this.tilePrefixes = /* @__PURE__ */ new Set();
      this.storageKey = null;
      this.storageTimeString = Date.now().toString();
      console.log("Allowed colors for template:", new Set(rgbToMeta.keys()));
      this.shreadSize = null;
    }
    customMask(x, y, shreadSize) {
      const center = shreadSize - 1 >> 1;
      return (x % shreadSize == center || y % shreadSize == center) && (x % shreadSize >= center - 1 && x % shreadSize <= center + 1 && y % shreadSize >= center - 1 && y % shreadSize <= center + 1);
    }
    customMaskPoints(shreadSize) {
      const result = [];
      for (let offsetY = 0; offsetY < shreadSize; offsetY++) {
        for (let offsetX = 0; offsetX < shreadSize; offsetX++) {
          if (this.customMask(offsetX, offsetY, shreadSize)) {
            result.push([offsetX, offsetY]);
          }
        }
      }
      return result;
    }
    /** Creates chunks of the template for each tile.
     * 
     * @returns {Object} Collection of template bitmaps & buffers organized by tile coordinates
     * @since 0.65.4
     */
    async createTemplateTiles(anchor) {
      console.log("Template coordinates:", this.coords);
      if (this.shreadSize === null) {
        this.shreadSize = testCanvasSize(5e3, 5e3) ? 5 : 4;
      }
      const shreadSize = this.shreadSize;
      const bitmap = this.file instanceof ImageBitmap ? this.file : await createImageBitmap(this.file, { "colorSpaceConversion": "none" });
      const imageWidth = bitmap.width;
      const imageHeight = bitmap.height;
      const [tx, ty, px, py] = this.coords;
      let mapX = tx * this.tileSize + px;
      let mapY = ty * this.tileSize + py;
      mapX -= Math.floor((imageWidth - 1) * {
        "l": 0,
        "m": 0.5,
        "r": 1
      }[anchor[0]]);
      mapY -= Math.floor((imageHeight - 1) * {
        "t": 0,
        "m": 0.5,
        "b": 1
      }[anchor[1]]);
      if (mapX < 0) {
        mapX += 2048 * this.tileSize;
      }
      this.coords = [
        Math.floor(mapX / this.tileSize),
        Math.floor(mapY / this.tileSize),
        mapX % this.tileSize,
        mapY % this.tileSize
      ];
      console.log("Top left template coordinates:", this.coords);
      const totalPixels = imageWidth * imageHeight;
      console.log(`Template pixel analysis - Dimensions: ${imageWidth}\xD7${imageHeight} = ${totalPixels.toLocaleString()} pixels`);
      this.pixelCount = totalPixels;
      try {
        let inspectCanvas = new OffscreenCanvas(imageWidth, imageHeight);
        const inspectCtx = inspectCanvas.getContext("2d", { willReadFrequently: true });
        inspectCtx.imageSmoothingEnabled = false;
        inspectCtx.clearRect(0, 0, imageWidth, imageHeight);
        inspectCtx.drawImage(bitmap, 0, 0);
        const inspectData = inspectCtx.getImageData(0, 0, imageWidth, imageHeight).data;
        cleanUpCanvas(inspectCanvas);
        inspectCanvas = null;
        let required = 0;
        let deface = 0;
        const paletteMap = /* @__PURE__ */ new Map();
        for (let y = 0; y < imageHeight; y++) {
          for (let x = 0; x < imageWidth; x++) {
            const idx = (y * imageWidth + x) * 4;
            const r = inspectData[idx];
            const g = inspectData[idx + 1];
            const b = inspectData[idx + 2];
            const a = inspectData[idx + 3];
            if (a === 0) {
              continue;
            }
            if (r === 222 && g === 250 && b === 206) {
              deface++;
            }
            const key = rgbToMeta.has(`${r},${g},${b}`) ? `${r},${g},${b}` : "other";
            required++;
            paletteMap.set(key, (paletteMap.get(key) || 0) + 1);
          }
        }
        this.requiredPixelCount = required;
        this.defacePixelCount = deface;
        const paletteObj = {};
        for (const [key, count] of paletteMap.entries()) {
          paletteObj[key] = { count, enabled: true };
        }
        this.colorPalette = paletteObj;
      } catch (err) {
        this.requiredPixelCount = Math.max(0, this.pixelCount);
        this.defacePixelCount = 0;
        console.warn("Failed to compute required/deface counts. Falling back to total pixels.", err);
      }
      const templateTiles = {};
      const templateTilesBuffers = {};
      let canvas = new OffscreenCanvas(this.tileSize, this.tileSize);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {
        const drawSizeY = Math.min(
          this.tileSize - pixelY % this.tileSize,
          // remaining y in this tile
          imageHeight + this.coords[3] - pixelY
          // bottom y
        );
        console.log(`Math.min(${this.tileSize} - (${pixelY} % ${this.tileSize}), ${imageHeight} - (${pixelY - this.coords[3]}))`);
        for (let pixelX = this.coords[2]; pixelX < imageWidth + this.coords[2]; ) {
          console.log(`Pixel X: ${pixelX}
Pixel Y: ${pixelY}`);
          const drawSizeX = Math.min(
            this.tileSize - pixelX % this.tileSize,
            // remaining x in this tile
            imageWidth + this.coords[2] - pixelX
            // right x
          );
          console.log(`Math.min(${this.tileSize} - (${pixelX} % ${this.tileSize}), ${imageWidth} - (${pixelX - this.coords[2]}))`);
          console.log(`Draw Size X: ${drawSizeX}
Draw Size Y: ${drawSizeY}`);
          const canvasWidth = drawSizeX * shreadSize;
          const canvasHeight = drawSizeY * shreadSize;
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          console.log(`Draw X: ${drawSizeX}
Draw Y: ${drawSizeY}
Canvas Width: ${canvasWidth}
Canvas Height: ${canvasHeight}`);
          context.imageSmoothingEnabled = false;
          console.log(`Getting X ${pixelX}-${pixelX + drawSizeX}
Getting Y ${pixelY}-${pixelY + drawSizeY}`);
          context.clearRect(0, 0, canvasWidth, canvasHeight);
          context.drawImage(
            bitmap,
            // Bitmap image to draw
            pixelX - this.coords[2],
            // Coordinate X to draw from
            pixelY - this.coords[3],
            // Coordinate Y to draw from
            drawSizeX,
            // X width to draw from
            drawSizeY,
            // Y height to draw from
            0,
            // Coordinate X to draw at
            0,
            // Coordinate Y to draw at
            drawSizeX * shreadSize,
            // X width to draw at
            drawSizeY * shreadSize
            // Y height to draw at
          );
          const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
          for (let y = 0; y < canvasHeight; y++) {
            for (let x = 0; x < canvasWidth; x++) {
              const pixelIndex = (y * canvasWidth + x) * 4;
              if (imageData.data[pixelIndex] === 222 && imageData.data[pixelIndex + 1] === 250 && imageData.data[pixelIndex + 2] === 206) {
                if ((x + y) % 2 === 0) {
                  imageData.data[pixelIndex] = 0;
                  imageData.data[pixelIndex + 1] = 0;
                  imageData.data[pixelIndex + 2] = 0;
                } else {
                  imageData.data[pixelIndex] = 255;
                  imageData.data[pixelIndex + 1] = 255;
                  imageData.data[pixelIndex + 2] = 255;
                }
                imageData.data[pixelIndex + 3] = 32;
              } else if (!this.customMask(x, y, shreadSize)) {
                imageData.data[pixelIndex + 3] = 0;
              }
            }
          }
          console.log(`Shreaded pixels for ${pixelX}, ${pixelY}`, imageData);
          context.putImageData(imageData, 0, 0);
          const templateTileName = `${((this.coords[0] + Math.floor(pixelX / this.tileSize)) % 2048).toString().padStart(4, "0")},${(this.coords[1] + Math.floor(pixelY / this.tileSize)).toString().padStart(4, "0")},${(pixelX % this.tileSize).toString().padStart(3, "0")},${(pixelY % this.tileSize).toString().padStart(3, "0")}`;
          templateTiles[templateTileName] = await createImageBitmap(canvas);
          this.tilePrefixes.add(templateTileName.split(",").slice(0, 2).join(","));
          const canvasBlob = await canvas.convertToBlob();
          const canvasBuffer = await canvasBlob.arrayBuffer();
          const canvasBufferBytes = Array.from(new Uint8Array(canvasBuffer));
          templateTilesBuffers[templateTileName] = uint8ToBase64(canvasBufferBytes);
          console.log(templateTiles);
          pixelX += drawSizeX;
        }
        pixelY += drawSizeY;
      }
      bitmap.close();
      cleanUpCanvas(canvas);
      canvas = null;
      console.log("Template Tiles: ", templateTiles);
      console.log("Template Tiles Buffers: ", templateTilesBuffers);
      return { templateTiles, templateTilesBuffers };
    }
    /** Get the bitmap for a tile key. Supporting memory-saving mode
     * @param {string} tileKey - The tile key
     * @param {boolean} memorySaving - Whether to store the bitmap in memory
     * @since 0.85.33
     */
    async getChunked(tileKey, memorySaving = false) {
      if (this.chunked[tileKey] === void 0) {
        return void 0;
      }
      if (this.chunked[tileKey] !== null) {
        const result = this.chunked[tileKey];
        if (memorySaving) {
          this.chunked[tileKey] = null;
        }
        return result;
      }
      const templateBlob = new Blob([this.chunkedBuffer[tileKey]], { type: "image/png" });
      const templateBitmap = await createImageBitmap(templateBlob);
      if (memorySaving === false) {
        this.chunked[tileKey] = templateBitmap;
      }
      ;
      return templateBitmap;
    }
  };

  // src/utilsMaptiler.js
  function isMapTilerLoaded() {
    if (isMapFound) return true;
    const myLocationButton = document.querySelector(".right-3>button");
    if (myLocationButton === null) {
      return false;
    }
    if (myLocationButton["__click"] !== void 0) {
      isMapFound = typeof myLocationButton["__click"] === "object" && // not a function yet
      myLocationButton["__click"][3] !== void 0 && myLocationButton["__click"][3]["v"] !== void 0 && myLocationButton["__click"][3]["v"]["addSource"] !== void 0 || document.head.__bmmap !== void 0;
    } else {
      const injector = () => {
        const script2 = document.currentScript;
        if (document.head.__bmmap) {
          script2.setAttribute("bm-result", "true");
          return;
        }
        try {
          const mapAddSource = document.querySelector(".right-3>button")["__click"][3]["v"]["addSource"];
          if (mapAddSource !== void 0) {
            script2.setAttribute("bm-result", "true");
          } else {
            script2.setAttribute("bm-result", "false");
          }
        } catch (e) {
          if (e instanceof TypeError) {
            script2.setAttribute("bm-result", "false");
          }
        }
      };
      const script = document.createElement("script");
      script.textContent = `(${injector})();`;
      document.documentElement?.appendChild(script);
      const result = script.getAttribute("bm-result") === "true";
      script.remove();
      isMapFound = result;
    }
    if (isMapFound) {
      mapFoundHandlers.forEach((handler) => handler());
    }
    return isMapFound;
  }
  function controlMapTiler(func, ...args) {
    if (!isMapTilerLoaded()) {
      doAfterMapFound(() => controlMapTiler(func, ...args));
      return;
    }
    ;
    const myLocationButton = document.querySelector(".right-3>button");
    if (document.head.__bmmap) {
      const map = document.head.__bmmap;
      return func(map, ...args);
    } else if (myLocationButton !== null) {
      if (myLocationButton["__click"]) {
        const map = myLocationButton["__click"][3]["v"];
        return func(map, ...args);
      } else {
        const getMap = () => {
          return document.head.__bmmap || document.querySelector(".right-3>button")["__click"][3]["v"];
        };
        const injector = (result2) => {
          const script2 = document.currentScript;
          script2.setAttribute("bm-result", JSON.stringify(result2 ?? null));
        };
        const passArgs = args.map((arg) => JSON.stringify(arg)).join(",");
        const script = document.createElement("script");
        script.textContent = `(${injector})((${func})((${getMap})(), ${passArgs}));`;
        document.documentElement?.appendChild(script);
        const result = JSON.parse(script.getAttribute("bm-result"));
        script.remove();
        return result;
      }
    } else {
      throw new Error('Could not find the "My location" button.');
    }
  }
  function getCenterGeoCoords() {
    return controlMapTiler((map) => {
      const center = map["transform"]["center"];
      return [center["lat"], center["lng"]];
    });
  }
  function getPixelPerWplacePixel() {
    return controlMapTiler((map) => {
      return map["transform"]["tileSize"] * map["transform"]["scale"] / 2048e3;
    });
  }
  var bmCanvas = {};
  function addTemplateCanvas(sortID, tileName, templateSize, blob, usage) {
    const tileCoords = tileName.split(",").map(Number);
    const [tileWidth, tileHeight] = templateSize;
    const geoCoords1 = coordsTileCoordsToGeoCoords(
      [tileCoords[0], tileCoords[1]],
      [tileCoords[2], tileCoords[3]],
      false
    );
    const geoCoords2 = coordsTileCoordsToGeoCoords(
      [tileCoords[0], tileCoords[1]],
      [tileCoords[2] + tileWidth, tileCoords[3] + tileHeight],
      false
    );
    if (!bmCanvas[usage]) {
      bmCanvas[usage] = {};
    }
    ;
    let prefix = "BM";
    const sourceID = `${prefix}-${usage}-${tileName}-${sortID}`;
    bmCanvas[usage][sourceID] = [geoCoords1, geoCoords2];
    const blobUrl = URL.createObjectURL(blob);
    return controlMapTiler(async (map, sourceID2, tileName2, templateSize2, blobUrl2, geoCoords12, geoCoords22, usage2, bmCanvas2) => {
      document.head.__bmCanvas = bmCanvas2;
      const overlayImg = document.createElement("img");
      overlayImg.src = blobUrl2;
      await new Promise((resolve) => overlayImg.addEventListener("load", () => resolve(overlayImg)));
      const currentCanvas = document.getElementById(sourceID2);
      if (currentCanvas) {
        currentCanvas.width = 0;
        currentCanvas.height = 0;
        currentCanvas.remove();
      }
      ;
      const canvas = document.createElement("canvas");
      canvas.id = sourceID2;
      canvas.style.display = "none";
      document.body.appendChild(canvas);
      canvas.width = overlayImg.naturalWidth, canvas.height = overlayImg.naturalHeight;
      const overlayContext = canvas.getContext("2d");
      overlayContext.drawImage(overlayImg, 0, 0);
      URL.revokeObjectURL(blobUrl2);
      if (map["getLayer"](sourceID2)) {
        map["removeLayer"](sourceID2);
      }
      ;
      if (map["getSource"](sourceID2)) {
        map["removeSource"](sourceID2);
      }
      ;
      map["addSource"](sourceID2, {
        "type": "canvas",
        "canvas": sourceID2,
        "coordinates": [
          [geoCoords12[1], geoCoords12[0]],
          [geoCoords22[1], geoCoords12[0]],
          [geoCoords22[1], geoCoords22[0]],
          [geoCoords12[1], geoCoords22[0]]
        ]
      });
      map["addLayer"]({
        "id": sourceID2,
        "source": sourceID2,
        "type": "raster",
        "paint": {
          "raster-resampling": "nearest",
          "raster-opacity": 1
        }
      });
      const layers = map["getLayersOrder"]();
      const hoverLayerName = "pixel-hover";
      const prefix2 = "bm";
      const nextLayer = layers.find((layer) => usage2 === "overlay" && layer.startsWith(prefix2 + "-error-") || layer === hoverLayerName + "-ghost");
      console.log("moveLayer", sourceID2, nextLayer);
      map["moveLayer"](sourceID2, nextLayer);
      if (!map["getLayer"](hoverLayerName + "-ghost")) {
        map["addLayer"]({
          "id": hoverLayerName + "-ghost",
          "type": "raster",
          "source": hoverLayerName,
          "paint": {
            "raster-resampling": "nearest",
            "raster-opacity": 0.4
          }
        });
      } else {
        const layers2 = map["getLayersOrder"]();
        if (layers2 && layers2.length && layers2[layers2.length - 1] !== hoverLayerName + "-ghost") {
          console.log("moveLayer-1", hoverLayerName + "-ghost");
          map["moveLayer"](hoverLayerName + "-ghost");
        }
      }
    }, sourceID, tileName, templateSize, blobUrl, geoCoords1, geoCoords2, usage, bmCanvas);
  }
  function removeLayer(usage = null, sortID = null) {
    const matchSuffix = sortID ? "-" + sortID : "";
    const toRemove = [];
    const removeUsages = usage ? [usage] : ["overlay", "error"];
    removeUsages.forEach((usage2) => {
      Object.keys(bmCanvas[usage2] ?? {}).forEach((sourceID) => {
        if (sourceID.endsWith(matchSuffix)) {
          delete bmCanvas[usage2][sourceID];
          toRemove.push(sourceID);
        }
      });
    });
    return controlMapTiler((map, toRemove2, bmCanvas2) => {
      document.head.__bmCanvas = bmCanvas2;
      toRemove2.forEach((sourceID) => {
        if (map["getLayer"](sourceID)) {
          map["removeLayer"](sourceID);
        }
        ;
        if (map["getSource"](sourceID)) {
          map["removeSource"](sourceID);
        }
        ;
        const canvas = document.getElementById(sourceID);
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
          canvas.remove();
        }
        ;
      });
    }, toRemove, bmCanvas);
  }
  function forceRefreshTiles() {
    try {
      return controlMapTiler((map) => {
        return map["refreshTiles"]("pixel-art-layer");
      });
    } catch (ignored) {
    }
    ;
  }
  var themeList = {
    "liberty": ["Liberty (Default)", ""],
    "bright": ["Bright", ""],
    "positron": ["Positron", ""],
    "dark": ["Dark", "dark"],
    "fiord": ["Fiord (Dark)", "dark"],
    "halloween": ["Fiord (Halloween)", "halloween"]
  };
  function setTheme(themeName) {
    if (!themeList[themeName]) return;
    const dataTheme = themeList[themeName][1];
    document.documentElement.dataset["theme"] = dataTheme;
    return controlMapTiler((map, themeName2, bmCanvas2) => {
      document.head.__bmCanvas = bmCanvas2;
      const artLayerName = "pixel-art-layer";
      const hoverLayerName = "pixel-hover";
      let hoverLayerSource = map["getSource"](hoverLayerName);
      const restoreLayers = async () => {
        if (!map["getSource"](artLayerName)) {
          map["addSource"](artLayerName, {
            "type": "raster",
            "tiles": ["https://backend.wplace.live/files/s0/tiles/{x}/{y}.png"],
            "minzoom": 11,
            "maxzoom": 11,
            "tileSize": window.innerWidth > 640 ? 550 : 400
          });
        }
        ;
        if (!map["getLayer"](artLayerName)) {
          map["addLayer"]({
            "id": artLayerName,
            "type": "raster",
            "source": artLayerName,
            "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 1
            }
          });
        }
        ;
        if (!map["getSource"](hoverLayerName)) {
          if (hoverLayerSource) {
            map["addSource"](hoverLayerName, {
              "type": "canvas",
              "canvas": hoverLayerSource.canvas,
              "coordinates": hoverLayerSource.coordinates
            });
          } else {
            const hoverCanvas = document.createElement("canvas");
            const hoverImg = document.createElement("img");
            hoverImg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAAAAACoWZBhAAAAAXNSR0IArs4c6QAAACpJREFUeNpj+AsEZ86ASIa/DAwMZ84ACRDzDBigMs/AARITq1oUwxBWAADaREUdDMswKwAAAABJRU5ErkJggg==";
            await new Promise((resolve) => hoverImg.addEventListener("load", () => resolve(hoverImg)));
            hoverCanvas.width = hoverImg.naturalWidth, hoverCanvas.height = hoverImg.naturalHeight;
            const hoverContext = hoverCanvas.getContext("2d");
            hoverContext.drawImage(hoverImg, 0, 0);
            const epsilon = 1e-5;
            const bounds = [
              [0, 0],
              [epsilon, 0],
              [epsilon, -epsilon],
              [0, -epsilon]
            ];
            hoverLayerSource = {
              "type": "canvas",
              "canvas": hoverCanvas,
              "coordinates": bounds
            };
            map["addSource"](hoverLayerName, hoverLayerSource);
          }
          ;
        }
        ;
        if (!map["getLayer"](hoverLayerName)) {
          map["addLayer"]({
            "id": hoverLayerName,
            "type": "raster",
            "source": hoverLayerName,
            "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 0.4
            }
          });
        } else {
          let prefix = "BM";
          const layers = map["getLayersOrder"]();
          const nextLayer = layers.find((layer) => layer.startsWith(prefix + "-overlay-") || layer.startsWith(prefix + "-error-") || layer === hoverLayerName + "-ghost");
          const thisIndex = layers.indexOf(hoverLayerName);
          const nextIndex = nextLayer === void 0 ? layers.length : layers.indexOf(nextLayer);
          if (thisIndex + 1 !== nextIndex) {
            console.log("moveLayer", hoverLayerName, nextLayer);
            map["moveLayer"](hoverLayerName, nextLayer);
          }
        }
        ;
        if (!map["getLayer"](hoverLayerName + "-ghost")) {
          map["addLayer"]({
            "id": hoverLayerName + "-ghost",
            "type": "raster",
            "source": hoverLayerName,
            "paint": {
              "raster-resampling": "nearest",
              "raster-opacity": 0.4
            }
          });
        } else {
          const layers = map["getLayersOrder"]();
          if (layers && layers.length && layers[layers.length - 1] !== hoverLayerName + "-ghost") {
            console.log("moveLayer", hoverLayerName + "-ghost");
            map["moveLayer"](hoverLayerName + "-ghost");
          }
        }
        const bmCanvas3 = document.head.__bmCanvas;
        if (bmCanvas3) {
          ["overlay", "error"].forEach((usage) => {
            if (bmCanvas3[usage]) {
              let prefix = "BM";
              const layers = map["getLayersOrder"]();
              const nextLayer = layers.find((layer) => usage === "overlay" && layer.startsWith(prefix + "-error-") || layer === hoverLayerName + "-ghost");
              console.log("nextLayer", nextLayer);
              Object.entries(bmCanvas3[usage]).forEach(([sourceID, [geoCoords1, geoCoords2]]) => {
                if (!map["getSource"](sourceID)) {
                  map["addSource"](sourceID, {
                    "type": "canvas",
                    "canvas": sourceID,
                    "coordinates": [
                      [geoCoords1[1], geoCoords1[0]],
                      [geoCoords2[1], geoCoords1[0]],
                      [geoCoords2[1], geoCoords2[0]],
                      [geoCoords1[1], geoCoords2[0]]
                    ]
                  });
                }
                ;
                console.log("layers", layers.slice(-5));
                if (!map["getLayer"](sourceID)) {
                  map["addLayer"]({
                    "id": sourceID,
                    "type": "raster",
                    "source": sourceID,
                    "paint": {
                      "raster-resampling": "nearest",
                      "raster-opacity": 1
                    }
                  });
                  console.log("moveLayer", sourceID, nextLayer);
                  map["moveLayer"](sourceID, nextLayer);
                } else {
                  const thisIndex = layers.indexOf(sourceID);
                  const nextIndex = nextLayer === void 0 ? layers.length : layers.indexOf(nextLayer);
                  if (thisIndex > nextIndex) {
                    console.log("moveLayer", sourceID, nextLayer);
                    map["moveLayer"](sourceID, nextLayer);
                  }
                }
                ;
              });
            }
            ;
          });
        }
      };
      const restoreLayersName = "restoreLayers";
      const existingRestoreLayers = (map["_listeners"]["styledata"] ?? []).find((listener) => listener.name === restoreLayersName);
      if (!existingRestoreLayers) {
        restoreLayers.name = restoreLayersName;
        map["on"]("styledata", restoreLayers);
      }
      ;
      const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
      if (!allianceOrRankingButton) {
        const closeButton = document.querySelector(".gap-1+.btn-circle");
        if (closeButton) {
          closeButton.click();
        }
      }
      map["setStyle"]("https://maps.wplace.live/styles/" + themeName2, {});
      return null;
    }, themeName === "halloween" ? "fiord" : themeName, bmCanvas);
  }
  var overrideRandom = {
    "data": null
  };
  async function teleportToGeoCoords(lat, lng) {
    let smooth = false;
    if (isMapTilerLoaded()) {
      const funcName = smooth ? "flyTo" : "jumpTo";
      controlMapTiler((map, lat2, lng2, funcName2) => {
        map[funcName2]({ "center": [lng2, lat2], "zoom": 16 });
      }, lat, lng, funcName);
      const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
      if (allianceOrRankingButton) {
        const canvas = document.querySelector("canvas.maplibregl-canvas");
        const ev = new MouseEvent("click", {
          "bubbles": true,
          "cancelable": true,
          "clientX": canvas.offsetWidth / 2,
          "clientY": canvas.offsetHeight / 2,
          "button": 0
        });
        canvas.dispatchEvent(ev);
      }
    } else {
      const randomTeleportBtn = document.querySelector(".mb-2>.btn-ghost");
      if (randomTeleportBtn !== void 0) {
        overrideRandom["data"] = coordsGeoCoordsToTileCoords(lat, lng, false);
        randomTeleportBtn.click();
      } else {
        const url = `https://wplace.live/?lat=${lat}&lng=${lng}&zoom=16`;
        window.location.href = url;
      }
    }
  }
  async function teleportToTileCoords(coordsTile, coordsPixel) {
    const geoCoords = coordsTileCoordsToGeoCoords(coordsTile, coordsPixel);
    await teleportToGeoCoords(geoCoords[0], geoCoords[1]);
  }
  function coordsTileCoordsToGeoCoords(coordsTile, coordsPixel, center = true) {
    const offset = center ? 0.5 : 0;
    const relX = (coordsTile[0] * 1e3 + coordsPixel[0] + offset) / (2048 * 1e3);
    const relY = 1 - (coordsTile[1] * 1e3 + coordsPixel[1] + offset) / (2048 * 1e3);
    return [
      360 * Math.atan(Math.exp((relY * 2 - 1) * Math.PI)) / Math.PI - 90,
      relX * 360 - 180
    ];
  }
  function coordsGeoCoordsToTileCoords(latitude, longitude, truncate = true) {
    const relX = (longitude + 180) / 360;
    const relY = (Math.log(Math.tan((90 + latitude) * Math.PI / 360)) / Math.PI + 1) / 2;
    const tileX = relX * 2048 * 1e3;
    const tileY = (1 - relY) * 2048 * 1e3;
    const coordsPixel = truncate ? [
      Math.floor(tileX % 1e3),
      Math.floor(tileY % 1e3)
    ] : [
      tileX % 1e3,
      tileY % 1e3
    ];
    return [
      [
        Math.floor(tileX / 1e3),
        Math.floor(tileY / 1e3)
      ],
      coordsPixel
    ];
  }
  function setZoom(zoom) {
    return controlMapTiler((map, zoom2) => {
      return map["setZoom"](zoom2);
    }, zoom);
  }
  var isMapFound = false;
  var mapFoundHandlers = [];
  function doAfterMapFound(func) {
    if (isMapFound) return func();
    mapFoundHandlers.push(func);
  }
  function panMap(offset) {
    controlMapTiler((map, offset2) => {
      map["panBy"](offset2, {
        "duration": 0
      });
    }, offset);
  }
  function getCurrentTileSize() {
    var tileSize = controlMapTiler((map) => {
      var source = map.getSource("pixel-art-layer");
      if (!source) return;
      return source.tileSize;
    });
    if (tileSize === null) {
      return window.innerWidth > 640 ? 550 : 400;
    }
    return tileSize;
  }

  // src/templateManager.js
  var _TemplateManager_instances, loadTemplate_fn, parseRusMarble_fn, parseOSU_fn;
  var TemplateManager = class {
    /** The constructor for the {@link TemplateManager} class.
     * @since 0.55.8
     */
    constructor(name2, version2, overlay) {
      __privateAdd(this, _TemplateManager_instances);
      this.name = name2;
      this.version = version2;
      this.overlay = overlay;
      this.templatesVersion = "1.0.0";
      this.userID = null;
      this.encodingBase = "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~";
      this.tileSize = 1e3;
      this.drawMult = testCanvasSize(5e3, 5e3) ? 5 : 4;
      this.drawMultCenter = this.drawMult - 1 >> 1;
      this.canvasTemplate = null;
      this.canvasTemplateZoomed = null;
      this.canvasTemplateID = "bm-canvas";
      this.canvasMainID = "div#map canvas.maplibregl-canvas";
      this.template = null;
      this.templatesArray = [];
      this.templatesJSON = null;
      this.tileProgress = /* @__PURE__ */ new Map();
      this.extraColorsBitmap = 0;
      this.completedColorsBitmapLo = 0;
      this.completedColorsBitmapHi = 0;
      this.userSettings = {};
      this.hideLockedColors = false;
      this.largestSeenSortID = 0;
    }
    /** Retrieves the pixel art canvas.
     * If the canvas has been updated/replaced, it retrieves the new one.
     * @param {string} selector - The CSS selector to use to find the canvas.
     * @returns {HTMLCanvasElement|null} The canvas as an HTML Canvas Element, or null if the canvas does not exist
     * @since 0.58.3
     * @deprecated Not in use since 0.63.25
     */
    getCanvas() {
      if (document.body.contains(this.canvasTemplate)) {
        return this.canvasTemplate;
      }
      document.getElementById(this.canvasTemplateID)?.remove();
      const canvasMain = document.querySelector(this.canvasMainID);
      const canvasTemplateNew = document.createElement("canvas");
      canvasTemplateNew.id = this.canvasTemplateID;
      canvasTemplateNew.className = "maplibregl-canvas";
      canvasTemplateNew.style.position = "absolute";
      canvasTemplateNew.style.top = "0";
      canvasTemplateNew.style.left = "0";
      canvasTemplateNew.style.height = `${canvasMain?.clientHeight * (window.devicePixelRatio || 1)}px`;
      canvasTemplateNew.style.width = `${canvasMain?.clientWidth * (window.devicePixelRatio || 1)}px`;
      canvasTemplateNew.height = canvasMain?.clientHeight * (window.devicePixelRatio || 1);
      canvasTemplateNew.width = canvasMain?.clientWidth * (window.devicePixelRatio || 1);
      canvasTemplateNew.style.zIndex = "8999";
      canvasTemplateNew.style.pointerEvents = "none";
      canvasMain?.parentElement?.appendChild(canvasTemplateNew);
      this.canvasTemplate = canvasTemplateNew;
      window.addEventListener("move", this.onMove);
      window.addEventListener("zoom", this.onZoom);
      window.addEventListener("resize", this.onResize);
      return this.canvasTemplate;
    }
    /** Creates the JSON object to store templates in
     * @returns {{ whoami: string, scriptVersion: string, schemaVersion: string, templates: Object }} The JSON object
     * @since 0.65.4
     */
    async createJSON() {
      return {
        "whoami": "BlueMarble",
        // Use BlueMarble for template compatibility
        "scriptVersion": this.version,
        // Version of userscript
        "schemaVersion": this.templatesVersion,
        // Version of JSON schema
        "templates": {}
        // The templates
      };
    }
    /** Creates the template from the inputed file blob
     * @param {File | ImageBitmap | ImageData} file - The file blob to create a template from
     * @param {string} name - The display name of the template
     * @param {Array<number, number, number, number>} coords - The coordinates of the top left corner of the template
     * @param {string} anchor - The anchor of the template
     * @since 0.65.77
     */
    async createTemplate(file, name2, coords2, anchor, options = {}) {
      if (!this.templatesJSON) {
        this.templatesJSON = await this.createJSON();
        console.log(`Creating JSON...`);
      }
      this.overlay.handleDisplayStatus(`Creating template at ${coords2.join(", ")}...`);
      const authorID = numberToEncoded(this.userID || 0, this.encodingBase);
      const template = new Template({
        displayName: name2,
        sortID: this.largestSeenSortID + 1,
        // Uncomment this to enable multiple templates (1/2)
        authorID,
        file,
        coords: coords2,
        tileSize: this.tileSize
      });
      this.largestSeenSortID++;
      template.shreadSize = this.drawMult;
      const { templateTiles, templateTilesBuffers } = await template.createTemplateTiles(anchor || this.getAnchor());
      const toggleStatus = this.getPaletteToggledStatus();
      for (const key of Object.keys(template.colorPalette)) {
        if (toggleStatus[key] !== void 0) {
          template.colorPalette[key].enabled = toggleStatus[key];
        }
      }
      if (this.isMemorySavingModeOn()) {
        template.chunked = {};
        Object.entries(templateTiles).forEach(([key, value]) => {
          template.chunked[key] = null;
          value.close();
        });
      } else {
        template.chunked = templateTiles;
      }
      template.chunkedBuffer = Object.fromEntries(Object.entries(
        templateTilesBuffers
      ).map(([key, value]) => [key, base64ToUint8(value)]));
      const storageKey = `${template.sortID} ${template.authorID}`;
      template.storageKey = storageKey;
      const templateEnabled = options?.enabled ?? true;
      this.templatesJSON.templates[storageKey] = {
        "name": template.displayName,
        // Display name of template
        "coords": coords2.join(", "),
        // The coords of the template
        "enabled": templateEnabled,
        "tiles": templateTilesBuffers,
        // Stores the chunked tile buffers
        "palette": template.colorPalette,
        // Persist palette and enabled flags
        "shreadSize": template.shreadSize
        // Record shread size of the created template
      };
      template.enabled = templateEnabled;
      if (options?.remote) {
        template.isRemote = true;
        template.remoteName = options.remoteName || template.displayName;
        template.remoteUpdatedAt = options.remoteUpdatedAt || null;
        template.remoteFlagsCheckedAt = options.remoteFlagsCheckedAt || null;
        template.remoteFlagsCheckedAtLocal = options.remoteFlagsCheckedAtLocal || null;
        template.remoteCoords = Array.isArray(options.remoteCoords) ? options.remoteCoords.map(Number) : null;
        template.remoteToTop = options.remoteToTop === true;
        template.remoteToTopAt = options.remoteToTopAt || null;
        template.remoteHighlighted = options.remoteHighlighted === true;
        template.remoteHighlightedAt = options.remoteHighlightedAt || null;
        template.remoteOrder = Number.isFinite(options.remoteOrder) ? options.remoteOrder : null;
        this.templatesJSON.templates[storageKey].remote = true;
        this.templatesJSON.templates[storageKey].remoteName = template.remoteName;
        this.templatesJSON.templates[storageKey].remoteUpdatedAt = template.remoteUpdatedAt;
        this.templatesJSON.templates[storageKey].remoteFlagsCheckedAt = template.remoteFlagsCheckedAt;
        this.templatesJSON.templates[storageKey].remoteFlagsCheckedAtLocal = template.remoteFlagsCheckedAtLocal;
        this.templatesJSON.templates[storageKey].remoteCoords = template.remoteCoords;
        this.templatesJSON.templates[storageKey].remoteToTop = template.remoteToTop;
        this.templatesJSON.templates[storageKey].remoteToTopAt = template.remoteToTopAt;
        this.templatesJSON.templates[storageKey].remoteHighlighted = template.remoteHighlighted;
        this.templatesJSON.templates[storageKey].remoteHighlightedAt = template.remoteHighlightedAt;
        this.templatesJSON.templates[storageKey].remoteOrder = template.remoteOrder;
      }
      this.templatesArray.push(template);
      this.clearTileProgress(template);
      const pixelCountFormatted = new Intl.NumberFormat().format(template.pixelCount);
      this.overlay.handleDisplayStatus(`Template created at ${coords2.join(", ")}! Total pixels: ${pixelCountFormatted}`);
      this.requestListRebuild();
      this.createOverlayOnMap(template.sortID);
      console.log(Object.keys(this.templatesJSON.templates).length);
      console.log(this.templatesJSON);
      console.log(this.templatesArray);
      await this.storeTemplates();
      return template;
    }
    requestListRebuild() {
      try {
        window.postMessage({ source: "blue-marble", bmEvent: "bm-rebuild-color-list" }, "*");
      } catch (_) {
      }
      try {
        window.postMessage({ source: "blue-marble", bmEvent: "bm-rebuild-template-list" }, "*");
      } catch (_) {
      }
    }
    requestEventRebuild() {
      if (!this.isEventEnabled()) return;
      try {
        const templateUI = document.querySelector("#bm-contain-eventlist");
        if (templateUI) {
          templateUI.style.display = "";
        }
        window.postMessage({ source: "blue-marble", bmEvent: "bm-rebuild-event-list" }, "*");
      } catch (_) {
      }
    }
    /** Stores the JSON object of the loaded templates into TamperMonkey (GreaseMonkey) storage.
     * @since 0.72.7
     */
    async storeTemplates() {
      await GM.setValue("bmTemplates", JSON.stringify(this.templatesJSON));
    }
    /** Deletes a template from the JSON object.
     * Also delete's the corrosponding {@link Template} class instance
     */
    async deleteTemplate(storageKey) {
      const targetTemplate = this.templatesArray.find((template) => template.storageKey === storageKey);
      if (targetTemplate === void 0) return;
      const removeIndex = this.templatesArray.indexOf(targetTemplate);
      this.templatesArray.splice(removeIndex, 1);
      const templates = this.templatesJSON?.templates;
      if (templates && templates?.[storageKey]) {
        delete templates[storageKey];
      }
      this.clearTileProgress(targetTemplate);
      removeLayer(null, targetTemplate.sortID);
      this.overlay.handleDisplayStatus(`Template ${targetTemplate.displayName} is deleted!`);
      await this.storeTemplates();
      this.requestListRebuild();
    }
    /** Disables the template from view
     */
    async disableTemplate() {
      if (!this.templatesJSON) {
        this.templatesJSON = await this.createJSON();
        console.log(`Creating JSON...`);
      }
    }
    /** Draws all templates on the specified tile.
     * This method handles the rendering of template overlays on individual tiles.
     * @param {File} tileBlob - The pixels that are placed on a tile
     * @param {Array<number>} tileCoords - The tile coordinates [x, y]
     * @since 0.65.77
     */
    async countTemplateStatus(tileBlob, tileCoords) {
      const timeStart = performance.now();
      const tileCoordsPadded = tileCoords[0].toString().padStart(4, "0") + "," + tileCoords[1].toString().padStart(4, "0");
      console.log(`Start checking touching templates...`, performance.now() - timeStart + " ms");
      const involvedTemplates = this.getInvolvedTemplates(tileCoords);
      if (involvedTemplates.length === 0) return;
      const currentMemorySavingMode = this.isMemorySavingModeOn();
      const templatesTilesToHandle = involvedTemplates.map((template) => {
        const matchingTiles = Object.keys(template.chunked).filter(
          (tile) => tile.startsWith(tileCoordsPadded)
        );
        if (matchingTiles.length === 0) return null;
        const tileKey = matchingTiles[0];
        const coords2 = tileKey.split(",");
        return {
          template,
          tileKey,
          tileCoords: [+coords2[0], +coords2[1]],
          pixelCoords: [+coords2[2], +coords2[3]]
        };
      }).filter(Boolean);
      console.log(templatesTilesToHandle, performance.now() - timeStart + " ms");
      const templateCount = templatesTilesToHandle?.length || 0;
      console.log(`templateCount = ${templateCount}`);
      const enabledTemplateCount = this.templatesArray.filter((t) => t.enabled).length;
      const errorMapOnlyEnabledColors = this.isErrorMapShown() && this.isErrorMapOnlyEnabledColorsShown();
      const displayedColors = errorMapOnlyEnabledColors ? new Set(this.getDisplayedColorsSorted()) : null;
      let paintedCount = 0;
      let wrongCount = 0;
      let requiredCount = 0;
      let paletteStats = {};
      let templateStats = {};
      const tileBitmap = await createImageBitmap(tileBlob);
      const isErrorMapShown = this.isErrorMapShown();
      const drawMultTemplate = this.drawMult;
      const drawMultCenterTemplate = this.drawMultCenter;
      const tileSize = this.tileSize;
      let canvas = new OffscreenCanvas(tileSize, tileSize);
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.beginPath();
      context.rect(0, 0, tileSize, tileSize);
      context.clip();
      context.clearRect(0, 0, tileSize, tileSize);
      context.drawImage(tileBitmap, 0, 0, tileSize, tileSize);
      tileBitmap.close();
      const tilePixels = context.getImageData(0, 0, tileSize, tileSize).data;
      for (const templateTile of templatesTilesToHandle) {
        const template = templateTile.template;
        const templateKey = template.storageKey;
        const templateTileBitmap = await template.getChunked(templateTile.tileKey, currentMemorySavingMode);
        console.log(`Template:`);
        console.log(templateTile);
        console.log(performance.now() - timeStart + " ms");
        const templateWidth = templateTileBitmap.width;
        const templateHeight = templateTileBitmap.height;
        let templateCanvas = new OffscreenCanvas(templateWidth, templateHeight);
        const templateContext = templateCanvas.getContext("2d", { willReadFrequently: true });
        templateContext.imageSmoothingEnabled = false;
        templateContext.clearRect(0, 0, templateWidth, templateHeight);
        templateContext.drawImage(templateTileBitmap, 0, 0);
        const templateData = templateContext.getImageData(0, 0, templateWidth, templateHeight).data;
        const errorWidth = templateWidth / drawMultTemplate;
        const errorHeight = templateHeight / drawMultTemplate;
        let errorCanvas = null;
        let errorContext = null;
        let errorImage = null;
        let errorData = null;
        const templateTileEnabled = templateTile.template.enabled ?? true;
        if (isErrorMapShown && templateTileEnabled) {
          errorCanvas = new OffscreenCanvas(errorWidth, errorHeight);
          errorContext = errorCanvas.getContext("2d", { willReadFrequently: true });
          errorContext.clearRect(0, 0, errorWidth, errorHeight);
          errorImage = errorContext.getImageData(0, 0, errorWidth, errorHeight);
          errorData = errorImage.data;
        }
        const offsetXResult = templateTile.pixelCoords[0];
        const offsetYResult = templateTile.pixelCoords[1];
        try {
          for (let yt = drawMultCenterTemplate, gyr = offsetYResult, ye = 0; yt < templateHeight; yt += drawMultTemplate, gyr++, ye++) {
            for (let xt = drawMultCenterTemplate, gxr = offsetXResult, xe = 0; xt < templateWidth; xt += drawMultTemplate, gxr++, xe++) {
              if (gxr < 0 || gyr < 0 || gxr >= tileSize || gyr >= tileSize) {
                continue;
              }
              const templatePixelCenter = (yt * templateWidth + xt) * 4;
              const templatePixelCenterRed = templateData[templatePixelCenter];
              const templatePixelCenterGreen = templateData[templatePixelCenter + 1];
              const templatePixelCenterBlue = templateData[templatePixelCenter + 2];
              const templatePixelCenterAlpha = templateData[templatePixelCenter + 3];
              const realPixelCenter = (gyr * tileSize + gxr) * 4;
              const realPixelRed = tilePixels[realPixelCenter];
              const realPixelCenterGreen = tilePixels[realPixelCenter + 1];
              const realPixelCenterBlue = tilePixels[realPixelCenter + 2];
              const realPixelCenterAlpha = tilePixels[realPixelCenter + 3];
              let isPainted = false;
              const errorIndex = (ye * errorWidth + xe) * 4;
              if (templatePixelCenterAlpha < 64) {
                try {
                  const key = rgbToMeta.has(`${realPixelRed},${realPixelCenterGreen},${realPixelCenterBlue}`) ? `${realPixelRed},${realPixelCenterGreen},${realPixelCenterBlue}` : "other";
                  if (realPixelCenterAlpha >= 64 && key !== "other") {
                    wrongCount++;
                  }
                } catch (ignored) {
                }
                continue;
              } else {
                requiredCount++;
              }
              let colorKey = `${templatePixelCenterRed},${templatePixelCenterGreen},${templatePixelCenterBlue}`;
              if (!rgbToMeta.has(colorKey)) colorKey = "other";
              const shouldThisColorInvolvedInErrorMap = !errorMapOnlyEnabledColors || displayedColors.has(colorKey);
              if (realPixelCenterAlpha < 64) {
                if (templatePixelCenterAlpha !== 0) {
                  if (isErrorMapShown && templateTileEnabled && shouldThisColorInvolvedInErrorMap) {
                    errorData[errorIndex] = 128;
                    errorData[errorIndex + 1] = 128;
                    errorData[errorIndex + 2] = 128;
                    errorData[errorIndex + 3] = 200;
                  }
                }
              } else if (realPixelRed === templatePixelCenterRed && realPixelCenterGreen === templatePixelCenterGreen && realPixelCenterBlue === templatePixelCenterBlue) {
                paintedCount++;
                isPainted = true;
                if (paletteStats[colorKey] === void 0) {
                  paletteStats[colorKey] = {
                    painted: 1,
                    paintedAndEnabled: +templateTileEnabled,
                    missing: 0,
                    // examples: [ ],
                    examplesEnabled: []
                  };
                } else {
                  paletteStats[colorKey].painted++;
                  if (templateTileEnabled) {
                    paletteStats[colorKey].paintedAndEnabled++;
                  }
                }
                if (templateStats[templateKey] === void 0) {
                  templateStats[templateKey] = {
                    painted: 1
                  };
                } else {
                  templateStats[templateKey].painted++;
                }
                if (isErrorMapShown && templateTileEnabled && shouldThisColorInvolvedInErrorMap) {
                  errorData[errorIndex] = 0;
                  errorData[errorIndex + 1] = 128;
                  errorData[errorIndex + 2] = 0;
                  errorData[errorIndex + 3] = 160;
                }
              } else {
                wrongCount++;
                if (isErrorMapShown && templateTileEnabled && shouldThisColorInvolvedInErrorMap) {
                  errorData[errorIndex] = 255;
                  errorData[errorIndex + 1] = 0;
                  errorData[errorIndex + 2] = 0;
                  errorData[errorIndex + 3] = 224;
                }
              }
              if (!isPainted) {
                let key = `${templatePixelCenterRed},${templatePixelCenterGreen},${templatePixelCenterBlue}`;
                if (!rgbToMeta.has(key)) key = "other";
                const example = [
                  // use this tile as example
                  tileCoords,
                  [gxr, gyr]
                ];
                if (paletteStats[key] === void 0) {
                  paletteStats[key] = {
                    painted: 0,
                    paintedAndEnabled: 0,
                    missing: 1,
                    // examples: [ example ],
                    examplesEnabled: []
                  };
                  if (templateTileEnabled) {
                    paletteStats[key].examplesEnabled.push(example);
                  }
                } else {
                  const exampleMax = this.userSettings?.smartPlace ?? false ? 1 << 20 : 1e4;
                  paletteStats[key].missing++;
                  if (templateTileEnabled) {
                    if (paletteStats[key].examplesEnabled.length < exampleMax) {
                      paletteStats[key].examplesEnabled.push(example);
                    } else if (Math.random() * paletteStats[key].examplesEnabled.length < exampleMax) {
                      const replaceIndex = Math.floor(Math.random() * exampleMax);
                      paletteStats[key].examplesEnabled[replaceIndex] = example;
                    }
                  }
                }
              }
            }
          }
          if (isErrorMapShown && templateTileEnabled) {
            errorContext.putImageData(errorImage, 0, 0);
            const errorBlob = await errorCanvas.convertToBlob({ type: "image/png" });
            addTemplateCanvas(template.sortID, templateTile.tileKey, [errorWidth, errorHeight], errorBlob, "error");
            cleanUpCanvas(errorCanvas);
            errorCanvas = null;
          }
        } catch (exception) {
          console.warn("Failed to compute per-tile painted/wrong stats:", exception);
        }
        cleanUpCanvas(templateCanvas);
        templateCanvas = null;
        if (currentMemorySavingMode) {
          templateTileBitmap.close();
        }
      }
      console.log("Saving per-tile stats...", performance.now() - timeStart + " ms");
      if (templateCount === 0) {
        if (this.tileProgress.has(tileCoordsPadded)) {
          this.tileProgress.delete(tileCoordsPadded);
        }
      } else {
        this.tileProgress.set(tileCoordsPadded, {
          painted: paintedCount,
          required: requiredCount,
          wrong: wrongCount,
          palette: paletteStats,
          template: templateStats
        });
      }
      let aggPainted = 0;
      const templateEnabledState = Object.fromEntries((this?.templatesArray ?? []).map((t) => [t.storageKey, t.enabled]));
      for (const stats of this.tileProgress.values()) {
        Object.entries(stats.template).forEach(([storageKey, content]) => {
          if (!templateEnabledState[storageKey]) return;
          aggPainted += content.painted || 0;
        });
      }
      const totalRequired = this.templatesArray.reduce((sum, t) => sum + (t.enabled ? t.requiredPixelCount || t.pixelCount || 0 : 0), 0);
      const paintedStr = new Intl.NumberFormat().format(aggPainted);
      const requiredStr = new Intl.NumberFormat().format(totalRequired);
      const wrongStr = new Intl.NumberFormat().format(totalRequired - aggPainted);
      this.overlay.handleDisplayStatus(
        `Displaying ${enabledTemplateCount} template${enabledTemplateCount == 1 ? "" : "s"}.
Painted ${paintedStr} / ${requiredStr} \u2022 Wrong ${wrongStr}`
      );
      console.log("Cleaning up...", performance.now() - timeStart + " ms");
      cleanUpCanvas(canvas);
      window.buildColorFilterList();
      window.buildTemplateFilterList();
      console.log("Finish...", performance.now() - timeStart + " ms");
      return tileBlob;
    }
    /** Add the template overlay layer to the map
     * @param {number?} sortID
     * @since 0.86.1
     */
    async createOverlayOnMap(sortID = null) {
      if (!this._overlayRebuildState) {
        this._overlayRebuildState = {
          timer: null,
          pendingSortID: void 0,
          promise: null,
          resolve: null,
          reject: null,
          running: false,
          needsRun: false
        };
      }
      const state = this._overlayRebuildState;
      const mergeSortId = (current, next) => {
        if (next === null) return null;
        if (current === void 0) return next;
        if (current === null) return null;
        return current === next ? current : null;
      };
      state.pendingSortID = mergeSortId(state.pendingSortID, sortID);
      if (state.running) {
        state.needsRun = true;
        return state.promise || Promise.resolve();
      }
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (!state.promise) {
        state.promise = new Promise((resolve, reject) => {
          state.resolve = resolve;
          state.reject = reject;
        });
      }
      state.timer = setTimeout(async () => {
        state.timer = null;
        state.running = true;
        const pending = state.pendingSortID;
        state.pendingSortID = void 0;
        try {
          await this._createOverlayOnMapInternal(pending);
          state.resolve?.();
        } catch (err) {
          state.reject?.(err);
        } finally {
          state.promise = null;
          state.resolve = null;
          state.reject = null;
          state.running = false;
          if (state.needsRun) {
            state.needsRun = false;
            this.createOverlayOnMap(state.pendingSortID ?? null);
          }
        }
      }, 100);
      return state.promise;
    }
    /** Add the template overlay layer to the map (no debounce)
     * @param {number?} sortID
     * @since 0.86.1
     */
    async _createOverlayOnMapInternal(sortID = null) {
      const timeStart = performance.now();
      console.log(`Start creating overlay for template ${sortID}...`, performance.now() - timeStart + " ms");
      const currentMemorySavingMode = this.isMemorySavingModeOn();
      const templates = (this.templatesArray ?? []).filter((t) => t.enabled && (sortID === null || t.sortID == sortID));
      for (const template of templates) {
        console.log(`Template:`);
        console.log(template);
        if (!template.enabled) return;
        const displayedColors = this.getDisplayedColorsSorted();
        const displayedColorSet = new Set(displayedColors);
        const hasColorDisabled = displayedColors.length !== Object.keys(this.getPaletteToggledStatus()).length;
        const allColorsDisabled = displayedColors.length === 0;
        if (allColorsDisabled) {
          removeLayer("overlay", template.sortID);
          continue;
        }
        ;
        const displayMode = this.getTemplateDisplayMode();
        const drawMultResult = this.getTemplateDrawSize(displayMode);
        const maskPoints = this.getTemplateMaskPoints(displayMode, drawMultResult, template);
        for (const tileKey of Object.keys(template.chunked)) {
          console.log(`Handling tile chunk ${tileKey}...`, performance.now() - timeStart + " ms");
          const coords2 = tileKey.split(",");
          const drawMultTemplate = template.shreadSize;
          const drawMultCenterTemplate = template.shreadSize - 1 >> 1;
          const templateTileBitmap = await template.getChunked(tileKey, currentMemorySavingMode);
          const originalWidth = templateTileBitmap.width / template.shreadSize;
          const originalHeight = templateTileBitmap.height / template.shreadSize;
          const resultWidth = originalWidth * drawMultResult;
          const resultHeight = originalHeight * drawMultResult;
          let resultCanvas = new OffscreenCanvas(resultWidth, resultHeight);
          const resultContext = resultCanvas.getContext("2d");
          resultContext.imageSmoothingEnabled = false;
          resultContext.beginPath();
          resultContext.rect(0, 0, resultWidth, resultHeight);
          resultContext.clip();
          resultContext.clearRect(0, 0, resultWidth, resultHeight);
          try {
            if (!hasColorDisabled && drawMultTemplate === drawMultResult) {
              resultContext.drawImage(templateTileBitmap, 0, 0);
            } else if (!allColorsDisabled) {
              console.log("Applying color filter...", performance.now() - timeStart + " ms");
              const templateWidth = templateTileBitmap.width;
              const templateHeight = templateTileBitmap.height;
              let templateCanvas = new OffscreenCanvas(templateWidth, templateHeight);
              const templateContext = templateCanvas.getContext("2d", { willReadFrequently: true });
              templateContext.imageSmoothingEnabled = false;
              templateContext.clearRect(0, 0, templateWidth, templateHeight);
              templateContext.drawImage(templateTileBitmap, 0, 0);
              const templateData = templateContext.getImageData(0, 0, templateWidth, templateHeight).data;
              const image = resultContext.getImageData(0, 0, resultWidth, resultHeight);
              const imageData = image.data;
              for (const [offsetX, offsetY] of maskPoints) {
                for (let yt = drawMultCenterTemplate, yr = offsetY; yt < templateHeight; yt += drawMultTemplate, yr += drawMultResult) {
                  for (let xt = drawMultCenterTemplate, xr = offsetX; xt < templateWidth; xt += drawMultTemplate, xr += drawMultResult) {
                    const templatePixelCenter = (yt * templateWidth + xt) * 4;
                    const templatePixelCenterRed = templateData[templatePixelCenter];
                    const templatePixelCenterGreen = templateData[templatePixelCenter + 1];
                    const templatePixelCenterBlue = templateData[templatePixelCenter + 2];
                    const templatePixelCenterAlpha = templateData[templatePixelCenter + 3];
                    if (templatePixelCenterAlpha < 1) {
                      continue;
                    }
                    let key = `${templatePixelCenterRed},${templatePixelCenterGreen},${templatePixelCenterBlue}`;
                    if (!rgbToMeta.has(`${templatePixelCenterRed},${templatePixelCenterGreen},${templatePixelCenterBlue}`)) key = "other";
                    if (displayedColorSet.has(key)) {
                      const realPixelCenter = (yr * resultWidth + xr) * 4;
                      imageData[realPixelCenter] = templatePixelCenterRed;
                      imageData[realPixelCenter + 1] = templatePixelCenterGreen;
                      imageData[realPixelCenter + 2] = templatePixelCenterBlue;
                      imageData[realPixelCenter + 3] = templatePixelCenterAlpha;
                    }
                    ;
                  }
                }
              }
              resultContext.putImageData(image, 0, 0);
            }
          } catch (exception) {
            console.warn("Failed to apply color filter:", exception);
            resultContext.drawImage(templateTileBitmap, 0, 0);
          }
          console.log("Exporting canvas...", performance.now() - timeStart + " ms");
          const resultBlob = await resultCanvas.convertToBlob({ type: "image/png" });
          doAfterMapFound(() => addTemplateCanvas(template.sortID, tileKey, [originalWidth, originalHeight], resultBlob, "overlay"));
          console.log("Cleaning up...", performance.now() - timeStart + " ms");
          cleanUpCanvas(resultCanvas);
          resultCanvas = null;
          if (currentMemorySavingMode) {
            templateTileBitmap.close();
          }
        }
        ;
      }
      console.log("Finish...", performance.now() - timeStart + " ms");
    }
    /** Imports the JSON object, and appends it to any JSON object already loaded
     * @param {string} json - The JSON string to parse
     */
    importJSON(json) {
      console.log(`Importing JSON...`);
      console.log(json);
      if (json?.whoami == "BlueMarble" || json?.whoami == "RusMarble") {
        this.templatesJSON = json;
        __privateMethod(this, _TemplateManager_instances, parseRusMarble_fn).call(this, json);
      }
    }
    /** Sets the `templatesShouldBeDrawn` boolean to a value.
     * @param {boolean} value - The value to set the boolean to
     * @since 0.73.7
     */
    // setTemplatesShouldBeDrawn(value) {
    //   this.templatesShouldBeDrawn = value;
    // }
    /** Gets the palette toggled status from the first appearance of the color as a temporary measure
     * @since 0.85.11
     */
    getPaletteToggledStatus() {
      const status = {};
      for (const template of this.templatesArray) {
        for (const [rgb, meta] of Object.entries(template.colorPalette)) {
          if (status[rgb]) {
            continue;
          }
          ;
          status[rgb] = meta.enabled;
        }
      }
      return status;
    }
    /** Gets the list of displayed colors, sorted by rgb
     * does not hide completed colors as that may become incomplete over time
     * @returns {string[]}
     * @since 0.85.30
     */
    getDisplayedColorsSorted() {
      const currentOnly = this.isOnlyCurrentColorShown();
      const hideLocked = this.extraColorsBitmap !== -1 && this.areLockedColorsHidden();
      const toggledStatus = this.getPaletteToggledStatus();
      const hideCompleted = this.areCompletedColorsHidden();
      const colors = [];
      if (currentOnly) {
        const currentColor = getCurrentColor();
        Object.entries(toggledStatus).forEach(([rgb, enabled]) => {
          const colorId = rgbToMeta.get(rgb).id;
          if (colorId !== currentColor) return;
          if (hideLocked && !this.isColorUnlocked(colorId)) return;
          if (hideCompleted && this.isColorCompleted(colorId)) return;
          colors.push(rgb);
        });
      } else {
        Object.entries(toggledStatus).forEach(([rgb, enabled]) => {
          const colorId = rgbToMeta.get(rgb).id;
          if (!enabled) return;
          if (hideLocked && !this.isColorUnlocked(colorId)) return;
          if (hideCompleted && this.isColorCompleted(colorId)) return;
          colors.push(rgb);
        });
      }
      return colors.sort();
    }
    /** Gets the list of ids of completed colors
     * does not hide completed colors as that may become incomplete over time
     * @returns {Set<number>}
     * @since 0.86.4
     */
    getCompletedColors() {
      this.getOverallPerColorProgress();
      const result = /* @__PURE__ */ new Set();
      for (let colorId = 0, mask = 1; colorId < 64; colorId++, mask <<= 1) {
        if (this.completedColorsBitmap & mask) result.add(colorId);
      }
      ;
      return result;
    }
    /** Gets the list of involved templates, sorted by sortID
     * @param {number[]} tileCoords
     * @returns {Template[]}
     * @since 0.85.30
     */
    getInvolvedTemplates(tileCoords) {
      const tileCoordsPadded = tileCoords[0].toString().padStart(4, "0") + "," + tileCoords[1].toString().padStart(4, "0");
      return this.templatesArray.filter((template) => {
        if (!template?.chunked) return false;
        if (template.tilePrefixes && template.tilePrefixes.size > 0) {
          return template.tilePrefixes.has(tileCoordsPadded);
        }
        return Object.keys(template.chunked).some((k) => k.startsWith(tileCoordsPadded));
      }).sort((a, b) => a.sortID - b.sortID);
    }
    /** Gets the key that indicates if the toggled status is unchanged, so we can skip redrawing the overlay
     * @param {number[]} tileCoords
     * @since 0.85.30
     */
    getTileCacheKey(tileCoords) {
      const displayedColors = this.getDisplayedColorsSorted();
      const involvedTemplates = this.getInvolvedTemplates(tileCoords);
      return this.getTileCacheKeyFromCalculated(displayedColors, involvedTemplates);
    }
    /** Gets the key that indicates if the toggled status is unchanged, so we can skip redrawing the overlay
     * @param {string[]} displayedColors
     * @param {Template[]} involvedTemplates
     * @returns {string}
     * @since 0.85.30
     */
    getTileCacheKeyFromCalculated(displayedColors, involvedTemplates) {
      return displayedColors.join(";") + "||" + involvedTemplates.map((t) => t.storageKey + "," + t.storageTimeString + "," + +(t.enabled ?? true)).join(";");
    }
    /** Gets the overall color progress in all template tiles
     * @since 0.86.4
     */
    getOverallPerColorProgress() {
      const paletteSum = {};
      (this.templatesArray ?? []).forEach((t) => {
        if (!t.enabled) return;
        if (!t?.colorPalette) return;
        for (const [rgb, meta] of Object.entries(t.colorPalette)) {
          paletteSum[rgb] = (paletteSum[rgb] ?? 0) + meta.count;
        }
      });
      const combinedProgress = {};
      for (const stats of this.tileProgress.values()) {
        Object.entries(stats.palette).forEach(([colorKey, content]) => {
          if (combinedProgress[colorKey] === void 0) {
            combinedProgress[colorKey] = Object.fromEntries(Object.entries(content));
            combinedProgress[colorKey].examplesEnabled = content.examplesEnabled.slice();
          } else {
            combinedProgress[colorKey].painted += content.painted;
            combinedProgress[colorKey].paintedAndEnabled += content.paintedAndEnabled;
            combinedProgress[colorKey].missing += content.missing;
            combinedProgress[colorKey].examplesEnabled.extend(content.examplesEnabled);
          }
        });
      }
      ;
      var completedColorsBitmapLo = 0;
      var completedColorsBitmapHi = 0;
      Object.entries(paletteSum).forEach(([rgb, count]) => {
        if ((combinedProgress[rgb]?.paintedAndEnabled ?? 0) >= count) {
          const colorId = rgbToMeta.get(rgb)?.id ?? 0;
          if (colorId < 32) {
            completedColorsBitmapLo |= 1 << colorId;
          } else {
            completedColorsBitmapHi |= 1 << colorId - 32;
          }
        }
      });
      if (completedColorsBitmapLo !== this.completedColorsBitmapLo || completedColorsBitmapHi !== this.completedColorsBitmapHi) {
        this.completedColorsBitmapLo = completedColorsBitmapLo;
        this.completedColorsBitmapHi = completedColorsBitmapHi;
        if (this.areCompletedColorsHidden()) {
          this.createOverlayOnMap();
          if (this.isErrorMapShown() && this.isErrorMapOnlyEnabledColorsShown()) {
            forceRefreshTiles();
          }
        }
      }
      return { paletteSum, combinedProgress };
    }
    /** Stores the JSON object of the user settings into TamperMonkey (GreaseMonkey) storage.
     * @since 0.85.17
     */
    async storeUserSettings() {
      await GM.setValue("bmUserSettings", JSON.stringify(this.userSettings));
    }
    /** Sets the `userSettings` object to a value.
     * @param {object} value - The value to set the object to
     * @since 0.85.17
     */
    setUserSettings(value) {
      this.userSettings = value;
    }
    /** A utility to check if hidden colors are set to be hidden.
     * @since 0.85.17
     */
    areLockedColorsHidden() {
      return this.userSettings?.hideLockedColors ?? false;
    }
    /** Sets the `hideLockedColors` boolean in the `userSettings` to a value.
     * @param {boolean} value - The value to set the boolean to
     * @since 0.85.17
     */
    async setHideLockedColors(value) {
      this.userSettings.hideLockedColors = value;
      await this.storeUserSettings();
    }
    /** A utility to get the current sort criteria.
     * @since 0.85.23
     */
    getSortBy() {
      const temp = this.userSettings?.sortBy ?? "total-desc";
      if (this.isValidSortBy(temp)) return temp;
      return "total-desc";
    }
    /** A utility to check if the sort criteria is valid.
     * @param {string} value - The sort criteria
     * @returns {boolean}
     * @since 0.85.23
     */
    isValidSortBy(value) {
      const parts = value.toLowerCase().split("-");
      if (parts.length !== 2) return false;
      if (sortByOptions[parts[0]] === void 0) return false;
      if (!["desc", "asc"].includes(parts[1])) return false;
      return true;
    }
    /** Sets the sort criteria to a value.
     * @param {string} value - The sort criteria
     * @returns {boolean}
     * @since 0.85.23
     */
    async setSortBy(value) {
      if (!this.isValidSortBy(value)) return false;
      this.userSettings.sortBy = value.toLowerCase();
      await this.storeUserSettings();
      return true;
    }
    /** A utility to check if hidden colors are set to be hidden.
     * @returns {boolean}
     * @since 0.85.26
     */
    isProgressBarEnabled() {
      return this.userSettings?.progressBarEnabled ?? true;
    }
    /** Sets the sort criteria to a value.
     * @param {boolean} value - The sort criteria
     * @since 0.85.23
     */
    async setProgressBarEnabled(value) {
      this.userSettings.progressBarEnabled = value;
      await this.storeUserSettings();
    }
    /** A utility to check if completed colors are set to be hidden.
     * @returns {boolean}
     * @since 0.85.27
     */
    areCompletedColorsHidden() {
      return this.userSettings?.hideCompletedColors ?? false;
    }
    /** Sets the `hideCompletedColors` boolean in the `userSettings` to a value.
     * @param {boolean} value - The value to set the boolean to
     * @since 0.85.27
     */
    async setHideCompletedColors(value) {
      this.userSettings.hideCompletedColors = value;
      await this.storeUserSettings();
    }
    /** A utility to check if memory-saving mode is on.
     * @returns {boolean}
     * @since 0.85.27
     */
    isMemorySavingModeOn() {
      return this.userSettings?.memorySavingMode ?? false;
    }
    /** Sets the `memorySavingMode` boolean in the `userSettings` to a value.
     * @param {boolean} value - The value to set the boolean to
     * @since 0.85.33
     */
    async setMemorySavingMode(value) {
      this.userSettings.memorySavingMode = value;
      await this.storeUserSettings();
      if (value) {
        this.templatesArray.forEach((template) => {
          if (!template?.chunked) return;
          const chunked = template.chunked;
          const temp = {};
          Object.entries(chunked).forEach(([key, value2]) => {
            temp[key] = null;
            if (value2 === null) return;
            value2.close();
          });
          template.chunked = temp;
        });
      }
    }
    /** A utility to get the current anchor.
     * @since 0.85.34
     * @returns {string}
     */
    getAnchor() {
      const temp = this.userSettings?.anchor ?? "lt";
      if (this.isValidAnchor(temp)) return temp.toLowerCase();
      return "lt";
    }
    /** A utility to check if the anchor is valid.
     * @param {string} value - The anchor
     * @returns {boolean}
     * @since 0.85.34
     */
    isValidAnchor(value) {
      if (value.length !== 2) return false;
      value = value.toLowerCase();
      return "lmr".includes(value[0]) && "tmb".includes(value[1]);
    }
    /** Sets the anchor to a value.
     * @param {string} value - The anchor
     * @since 0.85.34
     */
    async setAnchor(value) {
      if (!this.isValidAnchor(value)) return false;
      this.userSettings.anchor = value.toLowerCase();
      await this.storeUserSettings();
      return true;
    }
    /** A utility to check if events are enabled.
     * @returns {boolean}
     * @since 0.85.35
     */
    isEventEnabled() {
      return this.userSettings?.eventEnabled ?? false;
    }
    /** Sets the event enabled to a value.
     * @param {boolean} value - The value
     * @since 0.85.35
     */
    async setEventEnabled(value) {
      this.userSettings.eventEnabled = value;
      await this.storeUserSettings();
    }
    /** A utility to check if event claimed are shown.
     * @returns {boolean}
     * @since 0.85.35
     */
    isEventClaimedShown() {
      return this.userSettings?.eventClaimedShown ?? true;
    }
    /** Sets the event claimed shown to a value.
     * @param {boolean} value - The value
     * @since 0.85.35
     */
    async setEventClaimedShown(value) {
      this.userSettings.eventClaimedShown = value;
      await this.storeUserSettings();
    }
    /** A utility to check if event unavailable are shown.
     * @returns {boolean}
     * @since 0.85.35
     */
    isEventUnavailableShown() {
      return this.userSettings?.eventUnavailableShown ?? true;
    }
    /** Sets the event unavailable shown to a value.
     * @param {boolean} value - The value
     * @since 0.85.35
     */
    async setEventUnavailableShown(value) {
      this.userSettings.eventUnavailableShown = value;
      await this.storeUserSettings();
    }
    /** A utility to return the current event provider.
     * @returns {string}
     * @since 0.85.35
     */
    getEventProvider() {
      return this.userSettings?.eventProvider ?? "";
    }
    /** Sets the event provider to a value.
     * @param {string} value - The value
     * @since 0.85.35
     */
    async setEventProvider(value) {
      this.userSettings.eventProvider = value;
      await this.storeUserSettings();
    }
    /** A utility to check if only the currently selected color is shown.
     * @returns {boolean}
     * @since 0.85.37
     */
    isOnlyCurrentColorShown() {
      return this.userSettings?.onlyCurrentColorShown ?? false;
    }
    /** Sets the onlyCurrentColorShown to a value.
     * @param {boolean} value - The value
     * @since 0.85.37
     */
    async setOnlyCurrentColorShown(value) {
      this.userSettings.onlyCurrentColorShown = value;
      await this.storeUserSettings();
    }
    /** A utility to check if the theme is overridden.
     * @returns {boolean}
     * @since 0.85.40
     */
    isThemeOverridden() {
      return this.userSettings?.themeOverridden ?? false;
    }
    /** Sets the themeOverridden to a value.
     * @param {boolean} value - The value
     * @since 0.85.40
     */
    async setThemeOverridden(value) {
      this.userSettings.themeOverridden = value;
      await this.storeUserSettings();
    }
    /** A utility to return the current theme.
     * @returns {string}
     * @since 0.85.40
     */
    getCurrentTheme() {
      const temp = (this.userSettings?.currentTheme ?? Object.keys(themeList)[0]).toLowerCase();
      if (themeList[temp]) return temp;
      return Object.keys(themeList)[0];
    }
    /** Sets the current theme to a value.
     * @param {string} value - The value
     * @returns {boolean}
     * @since 0.85.40
     */
    async setCurrentTheme(value) {
      value = value.toLowerCase();
      if (!themeList[value]) return false;
      this.userSettings.currentTheme = value;
      await this.storeUserSettings();
      return true;
    }
    /** A utility to return the current layout theme.
     * @returns {string}
     * @since 0.85.47
     */
    getLayoutTheme() {
      return String(this.userSettings?.layoutTheme ?? "classic").toLowerCase();
    }
    /** Sets the current layout theme to a value.
     * @param {string} value - The value
     * @since 0.85.47
     */
    async setLayoutTheme(value) {
      this.userSettings.layoutTheme = String(value ?? "classic").toLowerCase();
      await this.storeUserSettings();
    }
    /** A utility to check if the status textbox is hidden.
     * @returns {boolean}
     * @since 0.85.41
     */
    isStatusHidden() {
      return this.userSettings?.hideStatus ?? false;
    }
    /** Sets the hideStatus to a value.
     * @param {boolean} value - The value
     * @since 0.85.41
     */
    async setStatusHidden(value) {
      this.userSettings.hideStatus = value;
      await this.storeUserSettings();
    }
    /** A utility to check if droplets are hidden
     * @returns {boolean}
     * @since 0.90.0
     */
    isDropletsHidden() {
      return this.userSettings?.hideDroplets ?? false;
    }
    /** Sets the hideDroplets to a value.
     * @param {boolean} value - The value
     * @since 0.90.0
     */
    async setDropletsHidden(value) {
      this.userSettings.hideDroplets = value;
      await this.storeUserSettings();
    }
    /** A utility to check if next level progress is hidden
     * @returns {boolean}
     * @since 0.90.0
     */
    isNextLevelHidden() {
      return this.userSettings?.hideNextLevel ?? false;
    }
    /** Sets the hideNextLevel to a value.
     * @param {boolean} value - The value
     * @since 0.90.0
     */
    async setNextLevelHidden(value) {
      this.userSettings.hideNextLevel = value;
      await this.storeUserSettings();
    }
    /** Returns the template display mode.
     * @returns {string}
     * @since 0.90.0
     */
    getTemplateDisplayMode() {
      const raw = String(this.userSettings?.templateDisplay ?? "").toLowerCase();
      if (raw === "cross-z") return "cross-z-9";
      if (raw === "dot" || raw === "cross" || raw === "cross-z-9" || raw === "cross-z-11") return raw;
      const legacy = this.userSettings?.legacyDisplay ?? this.userSettings?.isLegacyDisplay ?? false;
      return legacy ? "dot" : "cross";
    }
    /** Returns the draw size for the given template display mode.
     * @param {string} mode - The display mode
     * @returns {number}
     * @since 0.90.0
     */
    getTemplateDrawSize(mode) {
      if (mode === "dot") return 3;
      if (mode === "cross-z-11") return 11;
      if (mode === "cross-z-9") return 9;
      return this.drawMult;
    }
    /** Sets the template display mode.
     * @param {string} value - The value
     * @since 0.90.0
     */
    async setTemplateDisplayMode(value) {
      const raw = String(value ?? "").toLowerCase();
      const mode = raw === "dot" || raw === "cross" || raw === "cross-z-9" || raw === "cross-z-11" ? raw : "cross";
      this.userSettings.templateDisplay = mode;
      const isDot = mode === "dot";
      this.userSettings.legacyDisplay = isDot;
      this.userSettings.isLegacyDisplay = isDot;
      await this.storeUserSettings();
    }
    /** Returns the mask points for the current template display mode.
     * @param {string} mode - The display mode
     * @param {number} size - The mask size
     * @param {Template} template - The template instance
     * @returns {Array<Array<number>>}
     * @since 0.90.0
     */
    getTemplateMaskPoints(mode, size, template) {
      if (mode === "dot") {
        const center = size - 1 >> 1;
        return [[center, center]];
      }
      if (mode.startsWith("cross-z")) {
        const points = [];
        const inset = Math.max(1, Math.floor(size / 5));
        const min = inset;
        const max = size - 1 - inset;
        if (min > max) {
          const center = size - 1 >> 1;
          return [[center, center]];
        }
        const bandSize = max - min + 1;
        const edgeThickness = Math.min(bandSize, bandSize >= 5 ? 2 : 1);
        const diagThickness = Math.min(bandSize, bandSize >= 5 ? 3 : 2);
        for (let y = min; y <= max; y++) {
          for (let x = min; x <= max; x++) {
            const isTop = y >= min && y <= min + edgeThickness - 1;
            const isBottom = y <= max && y >= max - edgeThickness + 1;
            let isDiagonal = false;
            const diag = min + max - y;
            const offsetStart = -Math.floor(diagThickness / 2);
            const offsetEnd = Math.ceil(diagThickness / 2) - 1;
            for (let offset = offsetStart; offset <= offsetEnd; offset++) {
              if (x === diag + offset) {
                isDiagonal = true;
                break;
              }
            }
            if (isTop || isBottom || isDiagonal) {
              points.push([x, y]);
            }
          }
        }
        return points;
      }
      return template.customMaskPoints(size);
    }
    /** A utility to check if it uses the dot template display (legacy).
     * @returns {boolean}
     * @since 0.85.46
     */
    isLegacyDisplay() {
      return this.getTemplateDisplayMode() === "dot";
    }
    /** Sets the legacyDisplay to a value.
     * @param {boolean} value - The value
     * @since 0.85.46
     */
    async setLegacyDisplay(value) {
      await this.setTemplateDisplayMode(value ? "dot" : "cross");
    }
    /** A utility to determine whether the error map should be shown
     * @returns {boolean}
     * @since 0.85.46
     */
    isErrorMapShown() {
      return this.userSettings?.showErrorMap ?? false;
    }
    /** Sets the showErrorMap to a value.
     * @param {boolean} value - The value
     * @since 0.85.46
     */
    async setErrorMapShown(value) {
      this.userSettings.showErrorMap = value;
      await this.storeUserSettings();
    }
    /** A utility to deterine whether the error map only covers the enabled colors
     * @returns {boolean}
     * @since 0.86.14
     */
    isErrorMapOnlyEnabledColorsShown() {
      return this.userSettings?.showOnlyEnabledColorsErrorMap ?? false;
    }
    /** Sets the showOnlyEnabledColorsErrorMap to a value.
     * @param {boolean} value - The value
     * @since 0.86.14
     */
    async setErrorMapOnlyEnabledColorsShown(value) {
      this.userSettings.showOnlyEnabledColorsErrorMap = value;
      await this.storeUserSettings();
    }
    /** A utility to check if zoom buttons are shown
     * @returns {boolean}
     * @since 0.86.10
     */
    areIntegerZoomButtonsShown() {
      return this.userSettings?.showIntegerZoom ?? false;
    }
    /** Sets the showIntegerZoom to a value.
     * @param {boolean} value - The value
     * @since 0.86.10
     */
    async setIntegerZoomButtonsShown(value) {
      this.userSettings.showIntegerZoom = value;
      await this.storeUserSettings();
    }
    /** A utility to enable / disable arrow key keybinds
     * @returns {boolean}
     * @since 0.86.12
     */
    areKeybindsEnabled() {
      return this.userSettings?.enableKeybinds ?? false;
    }
    /** Sets the enableKeybinds to a value.
     * @param {boolean} value - The value
     * @since 0.86.12
     */
    async setKeybindsEnabled(value) {
      this.userSettings.enableKeybinds = value;
      await this.storeUserSettings();
    }
    /** A utility to check if chat is disabled.
     * @returns {boolean}
     * @since 0.88.1
     */
    isChatDisabled() {
      return this.userSettings?.chatDisabled ?? false;
    }
    /** Sets the chatDisabled flag.
     * @param {boolean} value - The value
     * @since 0.88.1
     */
    async setChatDisabled(value) {
      this.userSettings.chatDisabled = value;
      await this.storeUserSettings();
    }
    /** Whether the "+ Line" and "+ Circle" buttons are displayed
     * @returns {boolean}
     * @since 0.86.13
     */
    isLineTemplateButtonShown() {
      return this.userSettings?.lineTemplateButton ?? false;
    }
    /** Sets the lineTemplateButton to a value.
     * @param {boolean} value - The value
     * @since 0.86.13
     */
    async setLineTemplateButtonEnabled(value) {
      this.userSettings.lineTemplateButton = value;
      await this.storeUserSettings();
    }
    /** Sets the `extraColorsBitmap` to an updated mask, refresh the color filter if changed.
     * @param {number} value - The value to set the mask to
     * @since 0.85.17
     */
    updateExtraColorsBitmap(value) {
      if (this.extraColorsBitmap === value) return;
      this.extraColorsBitmap = value;
      window.buildColorFilterList();
      this.createOverlayOnMap();
    }
    /** A utility to check if a color is unlocked.
     * @param {number} color - The id of the color
     * @returns {boolean}
     * @since 0.85.17
     */
    isColorUnlocked(color) {
      if (this.extraColorsBitmap === -1) return true;
      if (color < 32) return true;
      const mask = 1 << color - 32;
      return (this.extraColorsBitmap & mask) !== 0;
    }
    /** A utility to check if a color is unlocked.
     * @param {number} color - The id of the color
     * @returns {boolean}
     * @since 0.86.4
     */
    isColorCompleted(color) {
      if (color < 32) {
        const mask = 1 << color;
        return (this.completedColorsBitmapLo & mask) !== 0;
      } else {
        const mask = 1 << color - 32;
        return (this.completedColorsBitmapHi & mask) !== 0;
      }
    }
    /** A utility clear all the tiles related to a template
     * @param {Template} template
     * @since 0.85.19
     */
    clearTileProgress(template) {
      template.tilePrefixes.forEach((prefix) => {
        this.tileProgress.delete(prefix);
      });
      this.completedColorsBitmapLo = 0;
      this.completedColorsBitmapHi = 0;
    }
  };
  _TemplateManager_instances = new WeakSet();
  /** Generates a {@link Template} class instance from the JSON object template
   */
  loadTemplate_fn = function() {
  };
  parseRusMarble_fn = async function(json) {
    console.log(`Parsing RusMarble...`);
    const templates = json.templates;
    console.log(`RusMarble length: ${Object.keys(templates).length}`);
    const currentMemorySavingMode = this.isMemorySavingModeOn();
    if (Object.keys(templates).length > 0) {
      for (const template in templates) {
        const templateKey = template;
        const templateValue = templates[template];
        console.log(templateKey);
        const templateCoords = templateValue.coords.split(",").map(Number);
        if (templates.hasOwnProperty(template)) {
          const templateKeyArray = templateKey.split(" ");
          const sortID = Number(templateKeyArray?.[0]);
          const authorID = templateKeyArray?.[1] || "0";
          const displayName = templateValue.name || `Template ${sortID || ""}`;
          const tilesbase64 = templateValue.tiles;
          const templateTiles = {};
          const templateTilesBuffer = {};
          let requiredPixelCount = 0;
          const paletteMap = /* @__PURE__ */ new Map();
          for (const tile in tilesbase64) {
            console.log(tile);
            if (tilesbase64.hasOwnProperty(tile)) {
              const encodedTemplateBase64 = tilesbase64[tile];
              const templateUint8Array = base64ToUint8(encodedTemplateBase64);
              const templateBlob = new Blob([templateUint8Array], { type: "image/png" });
              const templateBitmap = await createImageBitmap(templateBlob);
              if (currentMemorySavingMode) {
                templateTiles[tile] = null;
              } else {
                templateTiles[tile] = templateBitmap;
              }
              templateTilesBuffer[tile] = templateUint8Array;
              try {
                const w = templateBitmap.width;
                const h = templateBitmap.height;
                let c = new OffscreenCanvas(w, h);
                const cx = c.getContext("2d", { willReadFrequently: true });
                cx.imageSmoothingEnabled = false;
                cx.clearRect(0, 0, w, h);
                cx.drawImage(templateBitmap, 0, 0);
                const data = cx.getImageData(0, 0, w, h).data;
                cleanUpCanvas(c);
                c = null;
                for (let y = this.drawMultCenter; y < h; y += this.drawMult) {
                  for (let x = this.drawMultCenter; x < w; x += this.drawMult) {
                    const idx = (y * w + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const a = data[idx + 3];
                    if (a < 64) {
                      continue;
                    }
                    if (r === 222 && g === 250 && b === 206) {
                      continue;
                    }
                    requiredPixelCount++;
                    const key = Object.hasOwn(templates[templateKey].palette, `${r},${g},${b}`) ? `${r},${g},${b}` : "other";
                    paletteMap.set(key, (paletteMap.get(key) || 0) + 1);
                  }
                }
              } catch (e) {
                console.warn("Failed to count required pixels for imported tile", e);
              }
              if (currentMemorySavingMode) {
                templateBitmap.close();
              }
            }
          }
          const template2 = new Template({
            displayName,
            sortID: sortID || this.largestSeenSortID + 1 || 0,
            authorID: authorID || "",
            coords: templateCoords
          });
          if (template2.sortID > this.largestSeenSortID) {
            this.largestSeenSortID = template2.sortID;
          }
          template2.shreadSize = templateValue.shreadSize ?? this.drawMult;
          template2.chunked = templateTiles;
          template2.chunkedBuffer = templateTilesBuffer;
          template2.requiredPixelCount = requiredPixelCount;
          template2.enabled = templateValue.enabled ?? true;
          template2.isRemote = templateValue.remote === true;
          template2.remoteName = templateValue.remoteName ?? null;
          template2.remoteUpdatedAt = templateValue.remoteUpdatedAt ?? null;
          template2.remoteFlagsCheckedAt = templateValue.remoteFlagsCheckedAt ?? null;
          template2.remoteFlagsCheckedAtLocal = templateValue.remoteFlagsCheckedAtLocal ?? null;
          template2.remoteCoords = templateValue.remoteCoords ?? null;
          template2.remoteToTop = templateValue.remoteToTop === true;
          template2.remoteToTopAt = templateValue.remoteToTopAt ?? null;
          template2.remoteHighlighted = templateValue.remoteHighlighted === true;
          template2.remoteHighlightedAt = templateValue.remoteHighlightedAt ?? null;
          template2.remoteOrder = templateValue.remoteOrder ?? null;
          const paletteObj = {};
          for (const [key, count] of paletteMap.entries()) {
            paletteObj[key] = { count, enabled: true };
          }
          template2.colorPalette = paletteObj;
          try {
            Object.keys(templateTiles).forEach((k) => {
              template2.tilePrefixes?.add(k.split(",").slice(0, 2).join(","));
            });
          } catch (_) {
          }
          try {
            const persisted = templates?.[templateKey]?.palette;
            if (persisted) {
              for (const [rgb, meta] of Object.entries(persisted)) {
                if (!template2.colorPalette[rgb]) {
                  template2.colorPalette[rgb] = { count: meta?.count || 0, enabled: !!meta?.enabled };
                } else {
                  template2.colorPalette[rgb].enabled = !!meta?.enabled;
                }
              }
            }
          } catch (_) {
          }
          template2.storageKey = templateKey;
          this.templatesArray.push(template2);
          console.log(this.templatesArray);
          console.log(`^^^ This ^^^`);
        }
      }
      try {
        window.postMessage({ source: "blue-marble", bmEvent: "bm-rebuild-color-list" }, "*");
      } catch (_) {
      }
      try {
        window.postMessage({ source: "blue-marble", bmEvent: "bm-rebuild-template-list" }, "*");
      } catch (_) {
      }
      this.createOverlayOnMap();
    }
  };
  /** Parses the OSU! Place JSON object
   */
  parseOSU_fn = function() {
  };

  // src/apiManager.js
  var EASTER_EGG_USER_ID = 11728406;
  var _ApiManager_instances, setUpTimeout_fn, updateCharges_fn, askServerForMe_fn, applyUserData_fn, maybeTriggerEasterEgg_fn;
  var ApiManager = class {
    /** Constructor for ApiManager class
     * @param {TemplateManager} templateManager 
     * @since 0.11.34
     */
    constructor(templateManager2) {
      __privateAdd(this, _ApiManager_instances);
      this.templateManager = templateManager2;
      this.disableAll = false;
      this.coordsTilePixel = [];
      this.templateCoordsTilePixel = [];
      this.lastMe = null;
      this.lastMeUpdated = null;
      this.chargeInterval = null;
      this.tileCache = {};
      this.eventClaimed = null;
      this.lastFetchedTime = null;
      this.eventData = null;
      this.eventDataURL = null;
    }
    getCurrentCharges() {
      if (this.lastMe === null) {
        __privateMethod(this, _ApiManager_instances, askServerForMe_fn).call(this);
        return 0;
      }
      const charges = this.lastMe["charges"];
      const currentTime = Date.now();
      const timeDiff = currentTime - this.lastMeUpdated;
      const chargesDelta = timeDiff / charges["cooldownMs"];
      const currentCharges = charges["count"] + chargesDelta;
      const trueMax = charges["count"] > charges["max"] ? charges["count"] : charges["max"];
      if (currentCharges > trueMax) {
        return trueMax;
      }
      return currentCharges;
    }
    getFullRemainingTimeMs() {
      const currentCharges = this.getCurrentCharges();
      const charges = this.lastMe?.["charges"] ?? { "max": 0, "cooldownMs": 3e4 };
      if (currentCharges >= charges["max"]) {
        return 0;
      }
      return (charges["max"] - currentCharges) * charges["cooldownMs"];
    }
    getFullRemainingTimeFormatted() {
      return this.getTimeFormatted(this.getFullRemainingTimeMs());
    }
    getSuspendTimeMs() {
      const timeoutUntil = new Date(this.lastMe?.["timeoutUntil"] ?? 0).getTime();
      return Math.max(0, timeoutUntil - Date.now());
    }
    isSuspended() {
      return this.getSuspendTimeMs() > 0;
    }
    getSuspendTimeFormatted() {
      return this.getTimeFormatted(this.getSuspendTimeMs());
    }
    getTimeFormatted(remainingTimeMs, includeSeconds = true) {
      if (remainingTimeMs <= 0) {
        return includeSeconds ? "00:00" : "00";
      }
      const remainingTimeSeconds = Math.floor(remainingTimeMs / 1e3);
      const hours = Math.floor(remainingTimeSeconds / 3600);
      const minutes = Math.floor(remainingTimeSeconds % 3600 / 60).toString().padStart(2, "0");
      const seconds = (remainingTimeSeconds % 60).toString().padStart(2, "0");
      if (!includeSeconds) {
        if (hours > 0) return `${hours}:${minutes}`;
        return `${minutes}`;
      }
      if (hours > 0) return `${hours}:${minutes}:${seconds}`;
      return `${minutes}:${seconds}`;
    }
    /** Get the close button inside the pixel info view for anchoring
     * 
     * @since 0.87.4
    */
    getCloseButton() {
      return document.querySelector(
        ".flex.gap-2.px-3>button.btn-circle,.flex.gap-1\\.5.px-3>button.btn-circle"
      );
    }
    /** Get the container containing the three button, namely Paint, Favorite, and Share, for anchoring
     * 
     * @since 0.87.4
    */
    getPaintButtonContainer() {
      const anchorElement = this.getCloseButton();
      if (!anchorElement) return;
      return anchorElement.parentElement.parentElement.lastElementChild;
    }
    /** Update the texts and related functions shown on the pixel info overlay
     * 
     * @since 0.85.28
    */
    updateDisplayCoords() {
      const coordsTile = [this.coordsTilePixel[0], this.coordsTilePixel[1]];
      const coordsPixel = [this.coordsTilePixel[2], this.coordsTilePixel[3]];
      let displayCoords1 = document.getElementById("bm-display-coords1");
      let displayCoords2 = document.getElementById("bm-display-coords2");
      const displayCoords1Copy = document.getElementById("bm-display-coords1-copy");
      const displayCoords2Copy = document.getElementById("bm-display-coords2-copy");
      const displayCoordsBr = document.getElementById("bm-display-coords-br");
      if (displayCoords1Copy) displayCoords1Copy.remove();
      if (displayCoords2Copy) displayCoords2Copy.remove();
      const geoCoords = coordsTileCoordsToGeoCoords(coordsTile, coordsPixel);
      const text1 = `(Tl X: ${coordsTile[0]}, Tl Y: ${coordsTile[1]}, Px X: ${coordsPixel[0]}, Px Y: ${coordsPixel[1]})`;
      const text2 = `(${geoCoords[0].toFixed(5)}, ${geoCoords[1].toFixed(5)})`;
      const showCopiedToast = (anchor, message = "Copied!") => {
        const parent = anchor.parentElement;
        if (!parent) return;
        const existing = parent.querySelector(".bm-display-coords-toast");
        if (existing) existing.remove();
        const toast = document.createElement("span");
        toast.className = "bm-display-coords-toast";
        toast.textContent = message;
        anchor.insertAdjacentElement("afterend", toast);
        setTimeout(() => toast.remove(), 1200);
      };
      const attachCopyHandler = (element) => {
        if (!element || element.dataset.bmCopyAttached) return;
        element.dataset.bmCopyAttached = "true";
        element.addEventListener("click", () => {
          const content = element.dataset.text || "";
          if (!content) return;
          copyToClipboard(content);
          showCopiedToast(element);
        });
      };
      if (!displayCoords1) {
        const closeButton = this.getCloseButton();
        if (!closeButton) return;
        const coordRow = closeButton.parentElement;
        displayCoords1 = document.createElement("span");
        displayCoords1.id = "bm-display-coords1";
        displayCoords1.style = "margin-left: calc(var(--spacing)*3); font-size: small;";
        displayCoords1.className = "bm-display-coords-clickable";
        coordRow.insertAdjacentElement("afterend", displayCoords1);
        const br = document.createElement("br");
        br.id = "bm-display-coords-br";
        displayCoords1.insertAdjacentElement("afterend", br);
        displayCoords2 = document.createElement("span");
        displayCoords2.id = "bm-display-coords2";
        displayCoords2.style = "margin-left: calc(var(--spacing)*3); font-size: small;";
        displayCoords2.className = "bm-display-coords-clickable";
        br.insertAdjacentElement("afterend", displayCoords2);
      }
      if (displayCoords1 && displayCoords2) {
        displayCoords1.textContent = text1;
        displayCoords2.textContent = text2;
        displayCoords1.dataset.text = text1;
        displayCoords2.dataset.text = text2;
        if (displayCoordsBr && displayCoordsBr.tagName !== "BR") {
          displayCoordsBr.remove();
        }
        attachCopyHandler(displayCoords1);
        attachCopyHandler(displayCoords2);
      }
      __privateMethod(this, _ApiManager_instances, maybeTriggerEasterEgg_fn).call(this);
      this.updateAddLineTemplateButton();
      this.updateAddCircleTemplateButton();
    }
    /** Update the texts and related functions shown on the pixel info overlay
     * 
     * @since 0.86.13
    */
    updateAddLineTemplateButton() {
      if (this.templateManager.isLineTemplateButtonShown()) {
        let btnLineTemplate = document.getElementById("bm-create-line-template");
        const that = this;
        if (!btnLineTemplate) {
          const buttonContainer = this.getPaintButtonContainer();
          if (!buttonContainer) return;
          btnLineTemplate = document.createElement("span");
          btnLineTemplate.id = "bm-create-line-template";
          btnLineTemplate.textContent = "+ Line";
          btnLineTemplate.className = buttonContainer.querySelector("button").className;
          btnLineTemplate.classList.add("btn-soft");
          buttonContainer.appendChild(btnLineTemplate);
          btnLineTemplate.addEventListener("click", function() {
            if (!areOverlayCoordsFilledAndValid()) {
              alert(`Some coordinates textboxes are empty or invalid!`);
              return;
            }
            ;
            if (that.coordsTilePixel.length !== 4) {
              alert(`Coordinates are malformed! Did you try clicking on the canvas first?`);
              return;
            }
            ;
            const overlayCoords = getOverlayCoords();
            const coordsTile = [that.coordsTilePixel[0], that.coordsTilePixel[1]];
            const coordsPixel = [that.coordsTilePixel[2], that.coordsTilePixel[3]];
            const [[left, top], [width, height]] = calculateTopLeftAndSize(
              [coordsTile, coordsPixel],
              overlayCoords
            );
            const defaultDrawMult = that.templateManager.drawMult;
            if (!testCanvasSize(width * defaultDrawMult, height * defaultDrawMult)) {
              alert(`The line is too large for the browser to handle.`);
              return;
            }
            const x0 = coordsTile[0] % 2048 * 1e3 + coordsPixel[0] % 1e3;
            const y0 = coordsTile[1] % 2048 * 1e3 + coordsPixel[1] % 1e3;
            const isTopLeft = (x0 == left ^ y0 == top) == 0;
            const currentColor = getCurrentColor();
            const currentColorInfo = colorpalette[currentColor];
            const {
              imageData,
              offsetX,
              offsetY
            } = isTopLeft ? lineBitmap(
              [left, top],
              [left + width - 1, top + height - 1],
              currentColorInfo.rgb
            ) : lineBitmap(
              [left, top + height - 1],
              [left + width - 1, top],
              currentColorInfo.rgb
            );
            const tx1 = Math.floor(left / 1e3);
            const ty1 = Math.floor(top / 1e3);
            const px1 = left % 1e3;
            const py1 = top % 1e3;
            that.templateManager.createTemplate(
              imageData,
              `${currentColorInfo?.name ?? "Unknown Color"} Line`,
              [tx1, ty1, px1, py1],
              "lt"
            );
          });
        }
      }
    }
    /** Update the texts and related functions shown on the pixel info overlay
     * 
     * @since 0.86.16
    */
    updateAddCircleTemplateButton() {
      if (this.templateManager.isLineTemplateButtonShown()) {
        let btnCircleTemplate = document.getElementById("bm-create-circle-template");
        const that = this;
        if (!btnCircleTemplate) {
          const buttonContainer = this.getPaintButtonContainer();
          if (!buttonContainer) return;
          btnCircleTemplate = document.createElement("span");
          btnCircleTemplate.id = "bm-create-circle-template";
          btnCircleTemplate.textContent = "+ Circle";
          btnCircleTemplate.className = buttonContainer.querySelector("button").className;
          btnCircleTemplate.classList.add("btn-soft");
          buttonContainer.appendChild(btnCircleTemplate);
          btnCircleTemplate.addEventListener("click", function() {
            if (!areOverlayCoordsFilledAndValid()) {
              alert(`Some coordinates textboxes are empty or invalid!`);
              return;
            }
            ;
            if (that.coordsTilePixel.length !== 4) {
              alert(`Coordinates are malformed! Did you try clicking on the canvas first?`);
              return;
            }
            ;
            const overlayCoords = getOverlayCoords();
            const coordsTile = [that.coordsTilePixel[0], that.coordsTilePixel[1]];
            const coordsPixel = [that.coordsTilePixel[2], that.coordsTilePixel[3]];
            const [[left, top], [width, height]] = calculateTopLeftAndSize(
              [coordsTile, coordsPixel],
              overlayCoords
            );
            const { d, y } = midPointDistance([0, 0], [width - 1, height - 1]);
            const diameter = y * 2 + 1;
            const defaultDrawMult = that.templateManager.drawMult;
            if (!testCanvasSize(diameter * defaultDrawMult, diameter * defaultDrawMult)) {
              alert(`The line is too large for the browser to handle.`);
              return;
            }
            const x0 = overlayCoords[0][0] % 2048 * 1e3 + overlayCoords[1][0] % 1e3;
            const y0 = overlayCoords[0][1] % 2048 * 1e3 + overlayCoords[1][1] % 1e3;
            const x1 = coordsTile[0] % 2048 * 1e3 + coordsPixel[0] % 1e3;
            const y1 = coordsTile[1] % 2048 * 1e3 + coordsPixel[1] % 1e3;
            const currentColor = getCurrentColor();
            const currentColorInfo = colorpalette[currentColor];
            const {
              imageData,
              offsetX,
              offsetY
            } = circleBitmap(
              [x0, y0],
              [x1, y1],
              currentColorInfo.rgb
            );
            const tx1 = Math.floor(offsetX / 1e3);
            const ty1 = Math.floor(offsetY / 1e3);
            const px1 = offsetX % 1e3;
            const py1 = offsetY % 1e3;
            that.templateManager.createTemplate(
              imageData,
              `${currentColorInfo?.name ?? "Unknown Color"} Circle`,
              [tx1, ty1, px1, py1],
              "lt"
            );
          });
        }
      }
    }
    /** Update the download button in share dialog
     * 
     * @since 0.85.28
    */
    updateDownloadButton() {
      if (this.coordsTilePixel.length !== 4) return;
      const coordsTile = [this.coordsTilePixel[0], this.coordsTilePixel[1]];
      const coordsPixel = [this.coordsTilePixel[2], this.coordsTilePixel[3]];
      const models = document.querySelectorAll("dialog.modal > div");
      for (const element of models) {
        if (element.querySelector("input[readonly]") === null) continue;
        let downloadBtn = document.querySelector("#bm-download-coords");
        let downloadBtnDim = document.querySelector("#bm-download-coords-dim");
        let progress = document.querySelector("#bm-download-progress");
        let progressText = document.querySelector("#bm-download-progress-text");
        if (!downloadBtn) {
          const container = document.createElement("div");
          element.appendChild(container);
          const h3 = document.createElement("h3");
          h3.innerText = "Download as Template";
          h3.className = "mb-1 mt-5 flex items-center gap-1 text-xl font-semibold";
          container.appendChild(h3);
          const instruction = document.createElement("div");
          instruction.className = `bg-base-200 border-base-content/10 rounded-xl border-2 p-3`;
          instruction.style.fontSize = "small";
          instruction.innerText = [
            "Instruction to mark the rectangular range for downloading:",
            '1. Pick the first reference point (e.g. the Top Left Corner) and use the "Pin" icon to record the coordinates.',
            '2. Pick the second reference point, i.e. the opposite corner (e.g. the Bottom Right Corner), and click the "Share" button.'
          ].join("\n");
          container.appendChild(instruction);
          downloadBtnDim = document.createElement("span");
          downloadBtnDim.id = "bm-download-coords-dim";
          downloadBtnDim.style.fontSize = "small";
          container.appendChild(downloadBtnDim);
          container.appendChild(document.createElement("br"));
          const btnContainer = document.createElement("div");
          btnContainer.className = "mt-3 flex items-end justify-end gap-2";
          progress = document.createElement("progress");
          progress.id = "bm-download-progress";
          progress.max = "100";
          progress.value = "0";
          progress.hidden = true;
          btnContainer.appendChild(progress);
          progressText = document.createElement("span");
          progressText.id = "bm-download-progress-text";
          progressText.hidden = true;
          progressText.textContent = "0 / 0";
          btnContainer.appendChild(progressText);
          downloadBtn = document.createElement("button");
          downloadBtn.id = "bm-download-coords";
          downloadBtn.className = "btn btn-primary";
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          svg.setAttribute("viewBox", "0 -960 960 960");
          svg.setAttribute("fill", "currentColor");
          svg.setAttribute("class", "size-5");
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z");
          svg.appendChild(path);
          downloadBtn.appendChild(svg);
          downloadBtn.appendChild(document.createTextNode(" Download"));
          const that = this;
          downloadBtn.addEventListener("click", async function() {
            this.disabled = true;
            const coordsTile2 = [that.coordsTilePixel[0], that.coordsTilePixel[1]];
            const coordsPixel2 = [that.coordsTilePixel[2], that.coordsTilePixel[3]];
            if (!areOverlayCoordsFilledAndValid()) {
              alert(`Some coordinates textboxes are empty or invalid!`);
              return;
            }
            const overlayCoords = getOverlayCoords();
            const [[left, top], [width, height]] = calculateTopLeftAndSize(
              [coordsTile2, coordsPixel2],
              overlayCoords
            );
            const tx1 = Math.floor(left / 1e3);
            const ty1 = Math.floor(top / 1e3);
            const px1 = left % 1e3;
            const py1 = top % 1e3;
            const tx2 = Math.floor((left + width - 1) / 1e3);
            const ty2 = Math.floor((top + height - 1) / 1e3);
            const tw = tx2 - tx1 + 1;
            const th = ty2 - ty1 + 1;
            progress.max = tw * th;
            progress.value = 0;
            progress.hidden = false;
            progressText.textContent = `0 / ${progress.max}`;
            progressText.hidden = false;
            try {
              const resultCanvas = new OffscreenCanvas(width, height);
              const context = resultCanvas.getContext("2d");
              context.clearRect(0, 0, width, height);
              for (let ty = ty1; ty <= ty2; ty++) {
                for (let tx = tx1; tx <= tx2; tx++) {
                  const image = await downloadTile(tx % 2048, ty);
                  context.drawImage(
                    image,
                    tx * 1e3 - left,
                    ty * 1e3 - top
                  );
                  progress.value++;
                  progressText.textContent = `${progress.value} / ${progress.max}`;
                }
              }
              ;
              const blob = await resultCanvas.convertToBlob({ type: "image/png" });
              var a = document.createElement("a");
              a.href = URL.createObjectURL(blob, { type: "image/png" });
              a.setAttribute("download", `template_${tx1}_${ty1}_${px1}_${py1}_${(/* @__PURE__ */ new Date()).toISOString()}.png`);
              a.click();
              URL.revokeObjectURL(a.href);
            } catch (e) {
              alert(`Download Failed!`);
              throw e;
            } finally {
              progress.hidden = true;
              progressText.hidden = true;
              this.disabled = false;
            }
          });
          btnContainer.appendChild(downloadBtn);
          container.appendChild(btnContainer);
        }
        const buttonLines = [];
        if (areOverlayCoordsFilledAndValid()) {
          const overlayCoords = getOverlayCoords();
          const [[left, top], [width, height]] = calculateTopLeftAndSize(
            [coordsTile, coordsPixel],
            overlayCoords
          );
          const tx1 = Math.floor(left / 1e3);
          const ty1 = Math.floor(top / 1e3);
          const px1 = left % 1e3;
          const py1 = top % 1e3;
          const right = (left + width - 1) % (2048 * 1e3);
          const bottom = top + height - 1;
          const tx2 = Math.floor(right / 1e3);
          const ty2 = Math.floor(bottom / 1e3);
          const px2 = right % 1e3;
          const py2 = bottom % 1e3;
          buttonLines.push(`Top Left: (Tl X: ${tx1}, Tl Y: ${ty1}, Px X: ${px1}, Px Y: ${py1})`);
          buttonLines.push(`Bottom Right: (Tl X: ${tx2}, Tl Y: ${ty2}, Px X: ${px2}, Px Y: ${py2})`);
          buttonLines.push(`Image Size: ${width}\xC3\u2014${height}`);
          if (testCanvasSize(width, height)) {
            downloadBtn.disabled = false;
          } else {
            downloadBtn.disabled = true;
            buttonLines.push(`Too large for the browser to export.`);
          }
        } else {
          buttonLines.push(`Some coordinates textboxes are empty or invalid.`);
          downloadBtn.disabled = true;
        }
        downloadBtnDim.innerText = buttonLines.join("\n");
      }
    }
    /** Determines if the spontaneously received response is something we want.
     * Otherwise, we can ignore it.
     * Note: Due to aggressive compression, make your calls like `data['jsonData']['name']` instead of `data.jsonData.name`
     * 
     * @param {Overlay} overlay - The Overlay class instance
     * @since 0.11.1
    */
    spontaneousResponseListener(overlay) {
      __privateMethod(this, _ApiManager_instances, setUpTimeout_fn).call(this);
      window.addEventListener("message", async (event) => {
        const data = event.data;
        const dataJSON = data["jsonData"];
        if (!(data && data["source"] === "blue-marble")) {
          return;
        }
        if (!data["endpoint"]) {
          return;
        }
        const endpointText = data["endpoint"]?.split("?")[0].split("/").filter((s) => s && isNaN(Number(s))).filter((s) => s && !s.includes(".")).pop();
        console.log(`%cRus Marble%c: Recieved message about "%s"`, "color: cornflowerblue;", "", endpointText);
        switch (endpointText) {
          case "me":
            if (dataJSON["status"] && dataJSON["status"]?.toString()[0] != "2") {
              if (!(dataJSON["fallback"] ?? false)) {
                overlay.handleDisplayError(`You are not logged in!
Could not fetch userdata.`);
              }
              return;
            }
            __privateMethod(this, _ApiManager_instances, applyUserData_fn).call(this, dataJSON, Date.now());
            break;
          case "pixel":
            const coordsTile = data["endpoint"].split("?")[0].split("/").filter((s) => s && !isNaN(Number(s))).map((s) => Number(s));
            if ((data["jsonData"] ?? {})["painted"] !== void 0) {
              if (!coordsTile.length) {
                return;
              }
              const tileKey2 = coordsTile[0].toString().padStart(4, "0") + "," + coordsTile[1].toString().padStart(4, "0");
              if (this.tileCache[tileKey2]) {
                delete this.tileCache[tileKey2];
              }
              break;
            }
            const payloadExtractor = new URLSearchParams(data["endpoint"].split("?")[1]);
            const coordsPixel = [
              +payloadExtractor.get("x"),
              +payloadExtractor.get("y")
            ];
            if (this.coordsTilePixel.length && (!coordsTile.length || !coordsPixel.length)) {
              overlay.handleDisplayError(`Coordinates are malformed!
Did you try clicking the canvas first?`);
              return;
            }
            if (coordsTile[0] < 0 && coordsPixel[0] < 0) {
              coordsTile[0] += 2048;
              coordsPixel[0] += 1e3;
            } else if (coordsTile[0] >= 2048) {
              coordsTile[0] -= 2048;
            }
            this.coordsTilePixel = [...coordsTile, ...coordsPixel];
            this.updateDisplayCoords();
            this.updateDownloadButton();
            break;
          case "tiles":
            let tileCoordsTile = data["endpoint"].split("/");
            tileCoordsTile = [parseInt(tileCoordsTile[tileCoordsTile.length - 2]), parseInt(tileCoordsTile[tileCoordsTile.length - 1].replace(".png", ""))];
            const blobData = data["blobData"];
            const tileKey = tileCoordsTile[0].toString().padStart(4, "0") + "," + tileCoordsTile[1].toString().padStart(4, "0");
            const lastModified = data["lastModified"];
            const fullKey = this.templateManager.getTileCacheKey(tileCoordsTile);
            const errorMap = +this.templateManager.isErrorMapShown();
            const fullKeyChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["fullKey"] !== fullKey;
            const lastModifiedChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["lastModified"] !== lastModified;
            const errorMapChanged = !this.tileCache[tileKey] || this.tileCache[tileKey]["errorMap"] !== errorMap;
            console.log(this.tileCache[tileKey]);
            console.log(fullKey, lastModified, errorMap);
            console.log(fullKeyChanged, lastModifiedChanged, errorMapChanged);
            if (!fullKeyChanged && !lastModifiedChanged && !errorMapChanged) {
              console.log(`Unchanged tile: "${tileKey}"`);
            } else {
              const involvedTemplates = this.templateManager.getInvolvedTemplates(tileCoordsTile);
              if (involvedTemplates.length > 0 && (fullKeyChanged || lastModifiedChanged || errorMapChanged && errorMap)) {
                await this.templateManager.countTemplateStatus(blobData, tileCoordsTile);
              }
              this.tileCache[tileKey] = { lastModified, fullKey, errorMap };
            }
            break;
          case "random":
            const blobUUID_ = data["blobID"];
            const overrideCoords = overrideRandom["data"];
            const jsonData = overrideCoords === null ? dataJSON : {
              "pixel": {
                "x": overrideCoords[1][0],
                "y": overrideCoords[1][1]
              },
              "tile": {
                "x": overrideCoords[0][0],
                "y": overrideCoords[0][1]
              }
            };
            overrideRandom["data"] = null;
            window.postMessage({
              source: "blue-marble",
              blobID: blobUUID_,
              blobData: JSON.stringify(jsonData),
              blink: data["blink"]
            });
            break;
          case "claimed":
            this.eventClaimed = dataJSON["claimed"] ?? [];
            this.templateManager.requestEventRebuild();
            break;
          case "locations":
            this.eventClaimed = dataJSON.filter((entry) => entry?.["claimed"] ?? false).map((entry, index) => entry.id ?? index);
            this.eventData = dataJSON;
            this.eventDataURL = data["endpoint"];
            this.templateManager.requestEventRebuild();
            break;
          case "robots":
            this.disableAll = dataJSON["userscript"]?.toString().toLowerCase() == "false";
            break;
        }
      });
    }
  };
  _ApiManager_instances = new WeakSet();
  setUpTimeout_fn = function() {
    __privateMethod(this, _ApiManager_instances, updateCharges_fn).call(this);
    this.chargeInterval = setInterval(() => {
      __privateMethod(this, _ApiManager_instances, updateCharges_fn).call(this);
    }, 1e3);
  };
  updateCharges_fn = function() {
    if (this.lastMe === null) {
      __privateMethod(this, _ApiManager_instances, askServerForMe_fn).call(this);
      return;
    }
    const charges = this.lastMe["charges"];
    const currentCharges = Math.floor(this.getCurrentCharges());
    const maxCharges = charges["max"];
    const currentChargesStr = new Intl.NumberFormat().format(currentCharges);
    const maxChargesStr = new Intl.NumberFormat().format(maxCharges);
    const container = document.getElementById("bm-user-charges");
    const countdownElement = container?.querySelector('[data-role="countdown"]');
    const countElement = container?.querySelector('[data-role="charge-count"]');
    if (container && countdownElement && countElement) {
      countdownElement.textContent = this.getFullRemainingTimeFormatted();
      countElement.textContent = `(${currentChargesStr} / ${maxChargesStr})`;
    }
    ;
    const suspendContainer = document.getElementById("bm-user-suspend");
    const suspendCountdownElement = suspendContainer?.querySelector('[data-role="suspend-countdown"]');
    const suspendReasonContainer = document.getElementById("bm-user-suspend-reason");
    const suspendReasonElement = document.getElementById("bm-suspend-reason");
    if (suspendContainer && suspendCountdownElement && suspendReasonContainer && suspendReasonElement) {
      const isSuspended = this.isSuspended();
      suspendContainer.style.display = isSuspended ? "" : "none";
      suspendReasonContainer.style.display = isSuspended ? "" : "none";
      if (isSuspended) {
        suspendCountdownElement.textContent = this.getSuspendTimeFormatted();
        suspendReasonElement.textContent = (this.lastMe["suspensionReason"] ?? "Unknown").split("-").map((word) => {
          return word.charAt(0).toUpperCase() + word.slice(1);
        }).join(" ");
      }
    }
    ;
  };
  askServerForMe_fn = function() {
    const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
    const logoutButton = document.querySelector(".relative>.dropdown>.dropdown-content>section>button.btn");
    if (allianceOrRankingButton !== void 0 && logoutButton !== void 0) {
      const currentTime = Date.now();
      if (this.lastFetchedTime === null || currentTime - this.lastFetchedTime > 1e4) {
        fetch("https://backend.wplace.live/me", {
          "credentials": "include"
        }).then((response) => {
          return response.json();
        }).then((dataJSON) => {
          if (dataJSON["status"] && dataJSON["status"]?.toString()[0] != "2") {
            return;
          }
          consoleLog("Fetched user data", dataJSON);
          __privateMethod(this, _ApiManager_instances, applyUserData_fn).call(this, dataJSON, Date.now());
        });
        this.lastFetchedTime = currentTime;
      }
    }
  };
  applyUserData_fn = function(dataJSON, fetchTime) {
    if (dataJSON === null) return;
    const nextLevelPixels = Math.ceil(Math.pow(Math.floor(dataJSON["level"]) * Math.pow(30, 0.65), 1 / 0.65) - dataJSON["pixelsPainted"]);
    console.log(dataJSON["id"]);
    if (!!dataJSON["id"] || dataJSON["id"] === 0) {
      console.log(numberToEncoded(
        dataJSON["id"],
        "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~"
      ));
    }
    this.templateManager.userID = dataJSON["id"];
    this.lastMe = dataJSON;
    this.lastMeUpdated = fetchTime;
    this.templateManager.updateExtraColorsBitmap(dataJSON["extraColorsBitmap"] ?? 0);
    const unlockedColorsElement = document.getElementById("bm-checkbox-colors-unlocked")?.parentElement;
    if (unlockedColorsElement) {
      unlockedColorsElement.style.display = this.templateManager.extraColorsBitmap === -1 ? "none" : "";
    }
    const userNameElement = document.getElementById("bm-user-name");
    if (userNameElement) {
      userNameElement.textContent = dataJSON["name"];
    }
    const userDropletsElement = document.getElementById("bm-user-droplets");
    if (userDropletsElement) {
      userDropletsElement.textContent = new Intl.NumberFormat().format(dataJSON["droplets"]);
    }
    const nextPixelElement = document.getElementById("bm-user-nextpixel");
    const nextPixelPluralElement = document.getElementById("bm-user-nextpixel-plural");
    if (nextPixelElement && nextPixelPluralElement) {
      nextPixelElement.textContent = new Intl.NumberFormat().format(nextLevelPixels);
      nextPixelPluralElement.textContent = nextLevelPixels == 1 ? "" : "s";
    }
    const nextLevelElement = document.getElementById("bm-user-nextlevel");
    if (nextLevelElement) {
      nextLevelElement.textContent = Math.floor(dataJSON["level"]) + 1;
    }
  };
  maybeTriggerEasterEgg_fn = function() {
    const closeButton = this.getCloseButton();
    if (!closeButton) return;
    const infoRoot = closeButton.parentElement?.parentElement || closeButton.closest("dialog") || closeButton.closest(".modal") || closeButton.parentElement;
    if (!infoRoot) return;
    const elements = Array.from(infoRoot.querySelectorAll("*"));
    let targetElement = null;
    let matchedId = null;
    for (const element of elements) {
      const text = element.textContent || "";
      const match = text.match(/#\s*(\d{4,})/);
      if (!match) continue;
      matchedId = Number(match[1]);
      targetElement = element;
      break;
    }
    infoRoot.querySelectorAll(".bm-easter-egg").forEach((el) => el.classList.remove("bm-easter-egg"));
    if (matchedId !== EASTER_EGG_USER_ID || !targetElement) return;
    const animTarget = targetElement.closest("div") || targetElement;
    animTarget.classList.remove("bm-easter-egg");
    void animTarget.offsetWidth;
    animTarget.classList.add("bm-easter-egg");
    setTimeout(() => animTarget.classList.remove("bm-easter-egg"), 1400);
  };

  // src/main.js
  var name = GM_info.script.name.toString();
  var version = GM_info.script.version.toString();
  var consoleStyle = "color: cornflowerblue;";
  var CSS_BM_File = "http://localhost:8000/dist/RusMarble.user.css";
  var TEMPLATE_SYNC_BASE_URL = "http://localhost:8003";
  var CHAT_WS_URL = `${TEMPLATE_SYNC_BASE_URL.replace(/^http(s?):\/\//, (_, secure) => secure ? "wss://" : "ws://")}/ws/chat`;
  var TEMPLATE_UPDATE_POLL_MS = 5e3;
  var REMOTE_FLAGS_REFRESH_MS = 6e4;
  var NOTIFICATION_POLL_MS = 3e3;
  var NOTIFICATION_ROTATE_MS = 1e4;
  var chatSocket = null;
  var chatInitialized = false;
  var layoutThemeOptions = {
    classic: "Classic",
    white: "White",
    pink: "Pink",
    blue: "Blue",
    black: "Black",
    mint: "Mint",
    imperial: "Russian Imperial",
    tricolor: "Russian Tricolor"
  };
  var templateDisplayOptions = {
    cross: "Cross",
    "cross-z-9": "Cross (Z, 9x9)",
    "cross-z-11": "Cross (Z, 11x11)",
    dot: "Dot (Original)"
  };
  var normalizeLayoutTheme = (value) => {
    const key = String(value ?? "").toLowerCase();
    return layoutThemeOptions[key] ? key : "classic";
  };
  var normalizeTemplateDisplay = (value) => {
    const key = String(value ?? "").toLowerCase();
    return templateDisplayOptions[key] ? key : "cross";
  };
  var normalizeUpdatedAt = (value) => {
    if (value === void 0 || value === null) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? `n:${value}` : null;
    }
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) {
      return `n:${Number(text)}`;
    }
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      return `n:${parsed}`;
    }
    return `s:${text}`;
  };
  var applyLayoutTheme = (value) => {
    const overlay = document.getElementById("bm-overlay");
    if (!overlay) return;
    overlay.dataset.layoutTheme = normalizeLayoutTheme(value);
    const notificationContainer = document.getElementById("bm-notification-container");
    if (notificationContainer) {
      notificationContainer.dataset.layoutTheme = normalizeLayoutTheme(value);
    }
  };
  function inject(callback) {
    const script = document.createElement("script");
    script.setAttribute("bm-name", name);
    script.setAttribute("bm-cStyle", consoleStyle);
    script.textContent = `(${callback})();`;
    document.documentElement?.appendChild(script);
    script.remove();
  }
  function gmRequest(url, responseType = "json") {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType,
        onload: (response) => resolve(response),
        onerror: (err) => reject(err)
      });
    });
  }
  var templateUpdatePollId = null;
  var templateUpdatePollInFlight = false;
  var templateUpdatePendingCount = 0;
  var templateFlagSyncInFlight = false;
  function setTemplateUpdateBadge(count) {
    const badge = document.getElementById("bm-sync-templates-badge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.style.display = "inline-flex";
    } else {
      badge.textContent = "";
      badge.style.display = "none";
    }
  }
  async function pruneMissingRemoteTemplates(templateItems) {
    if (!Array.isArray(templateItems)) return;
    const serverNames = new Set(
      templateItems.map((entry) => typeof entry === "string" ? entry : entry?.name).filter((name2) => name2)
    );
    const missing = (templateManager.templatesArray ?? []).filter((template) => {
      if (!template) return false;
      const store = templateManager.templatesJSON?.templates?.[template.storageKey];
      const isRemote = template.isRemote === true || store?.remote === true;
      if (!isRemote) return false;
      const templateName = template.remoteName || template.displayName;
      return !!templateName && !serverNames.has(templateName);
    });
    for (const template of missing) {
      const templateName = template.remoteName || template.displayName || template.storageKey;
      consoleLog(
        `%c${name}%c: Remote template "%s" missing from server list. Deleting local copy.`,
        consoleStyle,
        "",
        templateName
      );
      await templateManager.deleteTemplate(template.storageKey);
    }
  }
  async function checkTemplateUpdates() {
    if (templateUpdatePollInFlight) return;
    templateUpdatePollInFlight = true;
    try {
      const listResponse = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/templates`, "json");
      const listData = listResponse.response ?? JSON.parse(listResponse.responseText || "{}");
      const templateItems = Array.isArray(listData) ? listData : Array.isArray(listData?.templates) ? listData.templates : [];
      await syncRemoteTemplateFlags(templateItems);
      await pruneMissingRemoteTemplates(templateItems);
      let changedCount = 0;
      if (Array.isArray(templateItems)) {
        for (const entry of templateItems) {
          const templateName = typeof entry === "string" ? entry : entry?.name;
          const updatedAt = typeof entry === "object" ? entry?.updated_at : null;
          if (!templateName) {
            continue;
          }
          const existingTemplate = (templateManager.templatesArray ?? []).find((t) => {
            if (!t) return false;
            return t.displayName === templateName || t.remoteName === templateName;
          });
          const existingUpdatedAt = templateManager.templatesJSON?.templates?.[existingTemplate?.storageKey]?.remoteUpdatedAt ?? existingTemplate?.remoteUpdatedAt ?? null;
          const flagsAppliedAt = templateManager.templatesJSON?.templates?.[existingTemplate?.storageKey]?.remoteFlagsAppliedAt ?? existingTemplate?.remoteFlagsAppliedAt ?? null;
          const normalizedUpdatedAt = normalizeUpdatedAt(updatedAt);
          const normalizedExistingUpdatedAt = normalizeUpdatedAt(existingUpdatedAt);
          const normalizedFlagsAppliedAt = normalizeUpdatedAt(flagsAppliedAt);
          if (normalizedUpdatedAt && normalizedFlagsAppliedAt && normalizedUpdatedAt === normalizedFlagsAppliedAt) {
            continue;
          }
          const isMissingLocal = !existingTemplate;
          const isChanged = isMissingLocal || normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt;
          if (isChanged) {
            const updateReasons = [];
            if (isMissingLocal) {
              updateReasons.push("missing-local");
            }
            if (normalizedUpdatedAt && normalizedUpdatedAt !== normalizedExistingUpdatedAt) {
              updateReasons.push("updated_at-changed");
            }
            const reasonText = updateReasons.length ? updateReasons.join(", ") : "unknown";
            console.log(
              `%c${name}%c: Template update flagged for "%s" (reason: %s). updated_at=%s, local_updated_at=%s, flags_applied_at=%s`,
              consoleStyle,
              "",
              templateName,
              reasonText,
              updatedAt,
              existingUpdatedAt,
              flagsAppliedAt
            );
            changedCount += 1;
          }
        }
      }
      if (changedCount !== templateUpdatePendingCount) {
        templateUpdatePendingCount = changedCount;
        setTemplateUpdateBadge(changedCount);
      }
    } catch (err) {
    } finally {
      templateUpdatePollInFlight = false;
    }
  }
  async function syncRemoteTemplateFlags(templateItems) {
    if (templateFlagSyncInFlight) return;
    if (!Array.isArray(templateItems) || templateItems.length === 0) return;
    templateFlagSyncInFlight = true;
    try {
      let anyChanged = false;
      for (const entry of templateItems) {
        const name2 = typeof entry === "string" ? entry : entry?.name;
        if (!name2) {
          continue;
        }
        const existingTemplate = (templateManager.templatesArray ?? []).find((t) => {
          if (!t) return false;
          const sameName = t.displayName === name2 || t.remoteName === name2;
          return sameName;
        });
        if (!existingTemplate) {
          continue;
        }
        const store = templateManager.templatesJSON?.templates?.[existingTemplate.storageKey];
        const isRemote = existingTemplate.isRemote === true || store?.remote === true;
        if (!isRemote) {
          continue;
        }
        const storedRemoteCoords = Array.isArray(store?.remoteCoords) ? store.remoteCoords : Array.isArray(existingTemplate.remoteCoords) ? existingTemplate.remoteCoords : null;
        const entryMeta = entry && typeof entry === "object" ? entry : null;
        const entryUpdatedAt = entryMeta?.updated_at ?? null;
        const prevFlagsCheckedAt = store?.remoteFlagsCheckedAt ?? existingTemplate.remoteFlagsCheckedAt ?? null;
        const normalizedEntryUpdatedAt = normalizeUpdatedAt(entryUpdatedAt);
        const normalizedPrevFlagsCheckedAt = normalizeUpdatedAt(prevFlagsCheckedAt);
        const fetchMeta = async (reason) => {
          if (reason) {
            consoleLog(
              `%c${name2}%c: Fetching template meta for "%s" (reason: %s)`,
              consoleStyle,
              "",
              name2,
              reason
            );
          }
          const safeName = encodeURIComponent(name2);
          const metaResponse = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/templates/${safeName}`, "json");
          return metaResponse.response ?? JSON.parse(metaResponse.responseText || "{}");
        };
        const entryHasMeta = !!entryMeta && (entryMeta?.to_top !== void 0 || entryMeta?.to_top_at !== void 0 || entryMeta?.highlighted !== void 0 || entryMeta?.highlighted_at !== void 0 || entryMeta?.order !== void 0);
        const lastFlagsCheckedMs = store?.remoteFlagsCheckedAtLocal ?? existingTemplate.remoteFlagsCheckedAtLocal ?? 0;
        const shouldThrottle = !entryHasMeta && lastFlagsCheckedMs && Date.now() - lastFlagsCheckedMs < REMOTE_FLAGS_REFRESH_MS;
        if (shouldThrottle) {
          continue;
        }
        if (!entryHasMeta && normalizedEntryUpdatedAt && normalizedPrevFlagsCheckedAt && normalizedEntryUpdatedAt === normalizedPrevFlagsCheckedAt) {
          continue;
        }
        let meta = entryHasMeta ? entryMeta : await fetchMeta("list entry missing flags/coords");
        let metaFetched = !entryHasMeta;
        const prevToTop = existingTemplate.remoteToTop ?? store?.remoteToTop ?? false;
        const prevToTopAt = existingTemplate.remoteToTopAt ?? store?.remoteToTopAt ?? null;
        const prevHighlighted = existingTemplate.remoteHighlighted ?? store?.remoteHighlighted ?? false;
        const prevHighlightedAt = existingTemplate.remoteHighlightedAt ?? store?.remoteHighlightedAt ?? null;
        const prevOrderRaw = Number.isFinite(existingTemplate.remoteOrder) ? existingTemplate.remoteOrder : Number(store?.remoteOrder);
        const prevOrder = Number.isFinite(prevOrderRaw) ? prevOrderRaw : null;
        const readMeta = (metaValue) => {
          const hasToTop = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, "to_top");
          const hasToTopAt = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, "to_top_at");
          const hasHighlighted = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, "highlighted");
          const hasHighlightedAt = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, "highlighted_at");
          const hasOrder = !!metaValue && Object.prototype.hasOwnProperty.call(metaValue, "order");
          const nextToTop2 = hasToTop ? metaValue.to_top === true : prevToTop;
          const nextToTopAt2 = hasToTopAt ? metaValue.to_top_at ?? null : hasToTop ? null : prevToTopAt;
          const nextHighlighted2 = hasHighlighted ? metaValue.highlighted === true : prevHighlighted;
          const nextHighlightedAt2 = hasHighlightedAt ? metaValue.highlighted_at ?? null : hasHighlighted ? null : prevHighlightedAt;
          const nextUpdatedAt2 = metaValue?.updated_at ?? entryMeta?.updated_at ?? null;
          const nextOrderRaw = hasOrder ? Number(metaValue?.order) : prevOrder;
          const nextOrder2 = Number.isFinite(nextOrderRaw) ? nextOrderRaw : null;
          const coordsMeta2 = Array.isArray(metaValue?.coords) ? metaValue.coords.map(Number) : null;
          return { nextToTop: nextToTop2, nextToTopAt: nextToTopAt2, nextHighlighted: nextHighlighted2, nextHighlightedAt: nextHighlightedAt2, nextUpdatedAt: nextUpdatedAt2, nextOrder: nextOrder2, coordsMeta: coordsMeta2 };
        };
        let {
          nextToTop,
          nextToTopAt,
          nextHighlighted,
          nextHighlightedAt,
          nextUpdatedAt,
          nextOrder,
          coordsMeta
        } = readMeta(meta);
        if (!coordsMeta && Array.isArray(storedRemoteCoords) && storedRemoteCoords.length === 4) {
          coordsMeta = storedRemoteCoords.map(Number);
        }
        let flagsChanged = prevToTop !== nextToTop || prevToTopAt !== nextToTopAt || prevHighlighted !== nextHighlighted || prevHighlightedAt !== nextHighlightedAt || prevOrder !== nextOrder;
        if (flagsChanged && nextUpdatedAt && !coordsMeta && !metaFetched) {
          meta = await fetchMeta("flags changed; coords missing in list meta");
          metaFetched = true;
          ({
            nextToTop,
            nextToTopAt,
            nextHighlighted,
            nextHighlightedAt,
            nextUpdatedAt,
            nextOrder,
            coordsMeta
          } = readMeta(meta));
          flagsChanged = prevToTop !== nextToTop || prevToTopAt !== nextToTopAt || prevHighlighted !== nextHighlighted || prevHighlightedAt !== nextHighlightedAt || prevOrder !== nextOrder;
        }
        if (Array.isArray(coordsMeta) && coordsMeta.length === 4) {
          const normalizedCoords = coordsMeta.map(Number);
          const prevRemoteCoords = Array.isArray(existingTemplate.remoteCoords) ? existingTemplate.remoteCoords : Array.isArray(store?.remoteCoords) ? store.remoteCoords : null;
          const coordsChanged = !prevRemoteCoords || prevRemoteCoords.length !== 4 || prevRemoteCoords.some((value, index) => Number(value) !== normalizedCoords[index]);
          if (coordsChanged) {
            existingTemplate.remoteCoords = normalizedCoords;
            if (store) {
              store.remoteCoords = normalizedCoords;
            }
            anyChanged = true;
          }
        }
        if (!flagsChanged) {
          continue;
        }
        const coordsMatch = !!coordsMeta && coordsMeta.length === 4 && Array.isArray(existingTemplate.coords) && existingTemplate.coords.length === 4 && coordsMeta.every((value, index) => Number(value) === Number(existingTemplate.coords[index]));
        existingTemplate.remoteToTop = nextToTop;
        existingTemplate.remoteToTopAt = nextToTopAt;
        existingTemplate.remoteHighlighted = nextHighlighted;
        existingTemplate.remoteHighlightedAt = nextHighlightedAt;
        existingTemplate.remoteOrder = nextOrder;
        if (flagsChanged && nextUpdatedAt && (coordsMatch || !coordsMeta)) {
          existingTemplate.remoteFlagsAppliedAt = nextUpdatedAt;
          if (store) {
            store.remoteFlagsAppliedAt = nextUpdatedAt;
          }
        }
        if (nextUpdatedAt && (!coordsMeta || coordsMatch)) {
          if (prevFlagsCheckedAt !== nextUpdatedAt) {
            existingTemplate.remoteFlagsCheckedAt = nextUpdatedAt;
            if (store) {
              store.remoteFlagsCheckedAt = nextUpdatedAt;
            }
            anyChanged = true;
          }
        }
        if (metaFetched) {
          const flagsCheckNow = Date.now();
          existingTemplate.remoteFlagsCheckedAtLocal = flagsCheckNow;
          if (store) {
            store.remoteFlagsCheckedAtLocal = flagsCheckNow;
          }
          anyChanged = true;
        }
        if (store) {
          store.remoteToTop = nextToTop;
          store.remoteToTopAt = nextToTopAt;
          store.remoteHighlighted = nextHighlighted;
          store.remoteHighlightedAt = nextHighlightedAt;
          store.remoteOrder = nextOrder;
        }
        if (flagsChanged) {
          anyChanged = true;
        }
      }
      if (anyChanged) {
        await templateManager.storeTemplates();
        if (typeof window.buildTemplateFilterList === "function") {
          window.buildTemplateFilterList();
        }
      }
    } catch (_) {
    } finally {
      templateFlagSyncInFlight = false;
    }
  }
  function startTemplateUpdatePolling() {
    if (templateUpdatePollId) return;
    templateUpdatePollId = setInterval(checkTemplateUpdates, TEMPLATE_UPDATE_POLL_MS);
    checkTemplateUpdates();
  }
  function resetTemplateUpdateBadge() {
    templateUpdatePendingCount = 0;
    setTemplateUpdateBadge(0);
  }
  var notificationPollId = null;
  var notificationRotateId = null;
  var notificationQueue = [];
  var notificationCurrent = null;
  var NOTIFICATION_SHOWN_STORAGE_KEY = "bmNotificationShownIds";
  var NOTIFICATION_SHOWN_MAX = 500;
  var notificationShownIds = /* @__PURE__ */ new Set();
  var notificationShownList = [];
  var notificationShownInitPromise = null;
  function loadNotificationShownIds() {
    if (notificationShownInitPromise) return notificationShownInitPromise;
    notificationShownInitPromise = GM.getValue(NOTIFICATION_SHOWN_STORAGE_KEY, "[]").then((raw) => {
      let list = [];
      try {
        list = Array.isArray(raw) ? raw : JSON.parse(raw ?? "[]");
      } catch (_) {
        list = [];
      }
      if (!Array.isArray(list)) return;
      notificationShownList = list.map((id) => normalizeNotificationId(id)).filter((id) => id);
      notificationShownList.forEach((id) => notificationShownIds.add(id));
    }).catch(() => {
    });
    return notificationShownInitPromise;
  }
  function persistNotificationShownIds() {
    if (notificationShownList.length > NOTIFICATION_SHOWN_MAX) {
      notificationShownList = notificationShownList.slice(-NOTIFICATION_SHOWN_MAX);
    }
    try {
      GM.setValue(NOTIFICATION_SHOWN_STORAGE_KEY, JSON.stringify(notificationShownList));
    } catch (_) {
    }
  }
  function normalizeNotificationId(id) {
    return id === void 0 || id === null ? null : String(id);
  }
  function trackNotificationShown(id) {
    const normalized = normalizeNotificationId(id);
    if (!normalized) return;
    if (notificationShownIds.has(normalized)) return;
    notificationShownIds.add(normalized);
    notificationShownList.push(normalized);
    persistNotificationShownIds();
  }
  function appendLinkedText(target, rawText, options = {}) {
    const { enableTeleport = false, shortenWplace = true } = options;
    const text = String(rawText ?? "");
    target.textContent = "";
    const urlRegex = /https?:\/\/[^\s)]+/g;
    let lastIndex = 0;
    let hasMatch = false;
    for (const match of text.matchAll(urlRegex)) {
      hasMatch = true;
      const matchText = match[0];
      const matchIndex = match.index ?? 0;
      if (matchIndex > lastIndex) {
        target.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
      }
      const link = document.createElement("a");
      let linkLabel = matchText;
      let parsedCoords = null;
      try {
        const parsed = new URL(matchText);
        if (shortenWplace && parsed.hostname.endsWith("wplace.live")) {
          const lat = Number(parsed.searchParams.get("lat"));
          const lng = Number(parsed.searchParams.get("lng"));
          const zoom = Number(parsed.searchParams.get("zoom"));
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            parsedCoords = {
              lat,
              lng,
              zoom: Number.isFinite(zoom) ? zoom : null
            };
            const shortLat = lat.toFixed(3);
            const shortLng = lng.toFixed(3);
            const zoomLabel = Number.isFinite(zoom) ? ` z${zoom.toFixed(2)}` : "";
            linkLabel = `wplace.live @ ${shortLat}, ${shortLng}${zoomLabel}`;
          }
        }
      } catch (_) {
      }
      link.href = matchText;
      link.textContent = linkLabel;
      link.title = matchText;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (enableTeleport && parsedCoords) {
        link.dataset.lat = String(parsedCoords.lat);
        link.dataset.lng = String(parsedCoords.lng);
        if (Number.isFinite(parsedCoords.zoom)) {
          link.dataset.zoom = String(parsedCoords.zoom);
        }
        link.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1) {
            return;
          }
          event.preventDefault();
          const lat = Number(link.dataset.lat);
          const lng = Number(link.dataset.lng);
          const zoom = Number(link.dataset.zoom);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
          doAfterMapFound(async () => {
            await teleportToGeoCoords(lat, lng);
            if (Number.isFinite(zoom)) {
              setZoom(zoom);
            }
          });
        });
      }
      target.appendChild(link);
      lastIndex = matchIndex + matchText.length;
    }
    if (!hasMatch) {
      target.textContent = text;
      return;
    }
    if (lastIndex < text.length) {
      target.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }
  function ensureNotificationContainer() {
    let container = document.getElementById("bm-notification-container");
    if (container) return container;
    container = document.createElement("div");
    container.id = "bm-notification-container";
    container.style.display = "none";
    container.dataset.layoutTheme = normalizeLayoutTheme(templateManager?.getLayoutTheme?.());
    const card = document.createElement("div");
    card.id = "bm-notification";
    const close = document.createElement("button");
    close.id = "bm-notification-close";
    close.type = "button";
    close.textContent = "\xD7";
    close.title = "Dismiss notification";
    close.addEventListener("click", () => {
      notificationCurrent = null;
      if (notificationQueue.length) {
        showNextNotification();
      } else {
        hideNotification();
        stopNotificationRotation();
      }
    });
    const text = document.createElement("span");
    text.id = "bm-notification-text";
    const meta = document.createElement("span");
    meta.id = "bm-notification-meta";
    card.appendChild(close);
    card.appendChild(text);
    card.appendChild(meta);
    container.appendChild(card);
    document.body?.appendChild(container);
    return container;
  }
  function renderNotification(notification) {
    const container = ensureNotificationContainer();
    const textEl = container.querySelector("#bm-notification-text");
    const metaEl = container.querySelector("#bm-notification-meta");
    if (!textEl || !metaEl) return;
    appendLinkedText(textEl, notification?.text ?? "", { enableTeleport: true, shortenWplace: true });
    const createdBy = notification?.created_by ? String(notification.created_by) : "";
    const createdAtRaw = notification?.created_at ? String(notification.created_at) : "";
    let createdAt = "";
    if (createdAtRaw) {
      const parsed = new Date(createdAtRaw);
      if (!Number.isNaN(parsed.getTime())) {
        createdAt = parsed.toLocaleString();
      }
    }
    const metaParts = [];
    if (createdBy) metaParts.push(`by ${createdBy}`);
    if (createdAt) metaParts.push(createdAt);
    if (metaParts.length > 0) {
      metaEl.textContent = metaParts.join(" \u2022 ");
      metaEl.style.display = "block";
    } else {
      metaEl.textContent = "";
      metaEl.style.display = "none";
    }
    container.style.display = "flex";
  }
  function hideNotification() {
    const container = document.getElementById("bm-notification-container");
    if (container) {
      container.style.display = "none";
    }
  }
  function showNextNotification() {
    if (!notificationQueue.length) {
      notificationCurrent = null;
      hideNotification();
      stopNotificationRotation();
      return;
    }
    const current = notificationQueue.shift();
    notificationCurrent = current;
    trackNotificationShown(current?.id);
    renderNotification(current);
  }
  function startNotificationRotation() {
    if (notificationRotateId) return;
    notificationRotateId = setInterval(showNextNotification, NOTIFICATION_ROTATE_MS);
    showNextNotification();
  }
  function stopNotificationRotation() {
    if (notificationRotateId) {
      clearInterval(notificationRotateId);
      notificationRotateId = null;
    }
  }
  async function fetchNotifications() {
    try {
      const response = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/notifications`, "json");
      const data = response.response ?? JSON.parse(response.responseText || "{}");
      const list = Array.isArray(data?.notifications) ? data.notifications : [];
      const cleaned = list.filter((item) => item && item.text && item.id !== void 0 && item.id !== null);
      const queuedIds = new Set(
        notificationQueue.map((item) => normalizeNotificationId(item?.id)).filter((id) => id)
      );
      const currentId = normalizeNotificationId(notificationCurrent?.id);
      let added = 0;
      for (const item of cleaned) {
        const id = normalizeNotificationId(item.id);
        if (!id) continue;
        if (id === currentId) continue;
        if (notificationShownIds.has(id)) continue;
        if (queuedIds.has(id)) continue;
        notificationQueue.push(item);
        queuedIds.add(id);
        added += 1;
      }
      if (notificationQueue.length) {
        startNotificationRotation();
        if (!notificationCurrent && added > 0) {
          showNextNotification();
        }
      } else if (!notificationCurrent) {
        hideNotification();
        stopNotificationRotation();
      }
    } catch (_) {
    }
  }
  function startNotificationPolling() {
    if (notificationPollId) return;
    loadNotificationShownIds().finally(() => {
      if (notificationPollId) return;
      notificationPollId = setInterval(fetchNotifications, NOTIFICATION_POLL_MS);
      fetchNotifications();
    });
  }
  function initChat() {
    const statusTextEl = document.getElementById("bm-chat-status-text");
    const messagesEl = document.getElementById("bm-chat-messages");
    const userInput = document.getElementById("bm-chat-user");
    const modCodeInput = document.getElementById("bm-chat-modcode");
    const textInput = document.getElementById("bm-chat-text");
    const replyBar = document.getElementById("bm-chat-reply");
    const replyLabel = document.getElementById("bm-chat-reply-label");
    const replyText = document.getElementById("bm-chat-reply-text");
    const replyClear = document.getElementById("bm-chat-reply-clear");
    const modTools = document.getElementById("bm-chat-mod-tools");
    const banTypeSelect = document.getElementById("bm-chat-ban-type");
    const banTargetInput = document.getElementById("bm-chat-ban-target");
    const chatDetails = document.getElementById("bm-contain-chat");
    if (!chatDetails) return;
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let replyToId = null;
    const messageCache = /* @__PURE__ */ new Map();
    const pendingReplies = [];
    const PENDING_REPLY_WINDOW_MS = 3e4;
    if (!messagesEl || !textInput) return;
    if (modCodeInput) {
      modCodeInput.style.display = "none";
    }
    const chatSummary = chatDetails?.querySelector("summary");
    if (chatSummary) {
      chatSummary.classList.add("bm-chat-summary");
      if (!chatSummary.querySelector(".bm-chat-status-light")) {
        const light = document.createElement("span");
        light.className = "bm-chat-status-light";
        light.title = "Chat status";
        chatSummary.appendChild(light);
      }
    }
    const setStatus = (text) => {
      if (statusTextEl) {
        statusTextEl.textContent = `Status: ${text}`;
      }
      if (!chatDetails) return;
      const lowered = String(text || "").toLowerCase();
      let nextState = null;
      if (lowered.includes("connecting") || lowered.includes("reconnecting")) {
        nextState = "connecting";
      } else if (lowered.includes("disconnected")) {
        nextState = "error";
      } else if (lowered === "connected") {
        nextState = "connected";
      } else if (lowered === "error") {
        nextState = "error";
      }
      if (!nextState) return;
      chatDetails.classList.remove("bm-chat-state-connected", "bm-chat-state-connecting", "bm-chat-state-error");
      if (nextState === "connecting") {
        chatDetails.classList.add("bm-chat-state-connecting");
      } else if (nextState === "connected") {
        chatDetails.classList.add("bm-chat-state-connected");
      } else {
        chatDetails.classList.add("bm-chat-state-error");
      }
    };
    const getModCode = () => modCodeInput?.value?.trim() || "";
    const clipText = (value, max = 120) => {
      const text = String(value ?? "");
      if (text.length <= max) return text;
      return `${text.slice(0, max - 3)}...`;
    };
    const normalizeUser = (value) => {
      const name2 = String(value ?? "").trim();
      return name2 || "anon";
    };
    const prunePendingReplies = (now = Date.now()) => {
      while (pendingReplies.length && now - pendingReplies[0].ts > PENDING_REPLY_WINDOW_MS) {
        pendingReplies.shift();
      }
    };
    const queuePendingReply = (user, text, replyId) => {
      pendingReplies.push({
        user: normalizeUser(user),
        text: String(text ?? ""),
        replyToId: String(replyId),
        ts: Date.now()
      });
    };
    const applyPendingReply = (payload) => {
      if (payload?.reply_to !== void 0 && payload?.reply_to !== null && payload?.reply_to !== "") return;
      const user = normalizeUser(payload?.user);
      const text = String(payload?.text ?? "");
      const now = Date.now();
      prunePendingReplies(now);
      const index = pendingReplies.findIndex((entry) => entry.user === user && entry.text === text);
      if (index === -1) return;
      payload.reply_to = pendingReplies[index].replyToId;
      pendingReplies.splice(index, 1);
    };
    const clearReply = () => {
      replyToId = null;
      if (replyBar) replyBar.style.display = "none";
    };
    const setReplyTo = (id) => {
      if (id === void 0 || id === null || id === "") return;
      replyToId = String(id);
      const cached = messageCache.get(replyToId);
      if (replyBar) {
        replyBar.style.display = "";
      }
      if (replyLabel) {
        replyLabel.textContent = cached?.user ? `Replying to ${cached.user}` : `Replying to #${replyToId}`;
      }
      if (replyText) {
        replyText.textContent = clipText(cached?.text || "");
      }
    };
    const isChatDisabled = () => templateManager?.isChatDisabled?.() ?? false;
    const moderateDelete = (messageId) => {
      const code = getModCode();
      if (!code) {
        setStatus("missing moderation code");
        return;
      }
      GM_xmlhttpRequest({
        method: "POST",
        url: `${TEMPLATE_SYNC_BASE_URL}/chat/moderate/delete`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ code, id: messageId }),
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            setStatus("moderation delete sent");
          } else {
            setStatus(`moderation failed (${response.status})`);
          }
        },
        onerror: () => setStatus("moderation error")
      });
    };
    const parseBanTarget = (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return null;
      const isMessageId = /^\d+$/.test(raw);
      return { raw, isMessageId };
    };
    const postModerationAction = (endpoint, payload) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${TEMPLATE_SYNC_BASE_URL}${endpoint}`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            setStatus("moderation ok");
          } else {
            setStatus(`moderation failed (${response.status})`);
          }
        },
        onerror: () => setStatus("moderation error")
      });
    };
    const moderateBan = (target, type, isUnban = false) => {
      const code = getModCode();
      if (!code) {
        setStatus("missing moderation code");
        return;
      }
      const parsed = parseBanTarget(target);
      if (!parsed) {
        setStatus("missing ban target");
        return;
      }
      const endpoint = type === "device" ? isUnban ? "/chat/moderate/unban_device" : "/chat/moderate/ban_device" : isUnban ? "/chat/moderate/unban" : "/chat/moderate/ban";
      const payload = { code };
      if (type === "device") {
        if (isUnban) {
          payload.device_id = parsed.raw;
        } else if (parsed.isMessageId) {
          const cached = messageCache.get(parsed.raw);
          if (!cached?.device_id) {
            setStatus("device id not found");
            return;
          }
          payload.device_id = cached.device_id;
          if (cached?.text) {
            payload.message = String(cached.text);
          }
        } else {
          payload.device_id = parsed.raw;
        }
      } else {
        if (isUnban) {
          payload.ip = parsed.raw;
        } else if (parsed.isMessageId) {
          payload.message_id = Number(parsed.raw);
          const cached = messageCache.get(parsed.raw);
          if (cached?.text) {
            payload.message = String(cached.text);
          }
        } else {
          payload.ip = parsed.raw;
        }
      }
      postModerationAction(endpoint, payload);
    };
    const fetchBans = () => {
      const code = getModCode();
      if (!code) {
        setStatus("missing moderation code");
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: `${TEMPLATE_SYNC_BASE_URL}/chat/moderate/banned?code=${encodeURIComponent(code)}`,
        onload: (response) => {
          let data = {};
          try {
            data = response.response ?? JSON.parse(response.responseText || "{}");
          } catch (_) {
            data = {};
          }
          const list = Array.isArray(data?.banned) ? data.banned : [];
          if (!list.length) {
            setStatus("no bans");
            return;
          }
          const lines = list.map((entry) => {
            const typeLabel = entry?.type || "unknown";
            const idLabel = entry?.identifier || entry?.ip || entry?.device_id || "";
            const ts = entry?.created_at ? ` @ ${entry.created_at}` : "";
            const msg = entry?.message ? ` \u2014 ${entry.message}` : "";
            return `${typeLabel}: ${idLabel}${ts}${msg}`;
          });
          alert(lines.join("\n"));
        },
        onerror: () => setStatus("moderation error")
      });
    };
    const ensureDeleteButton = (row) => {
      const messageId = row.getAttribute("data-msg-id");
      const messageIdNum = messageId ? Number(messageId) : NaN;
      const existing = row.querySelector(".bm-chat-delete");
      const code = getModCode();
      if (!code || !Number.isFinite(messageIdNum)) {
        if (existing) existing.remove();
        row.style.position = "";
        row.style.paddingRight = "";
        return;
      }
      if (existing) return;
      const btn = document.createElement("button");
      btn.className = "bm-chat-delete";
      btn.type = "button";
      btn.textContent = "\u2716";
      btn.title = "Delete message";
      row.style.position = "relative";
      row.style.paddingRight = "18px";
      btn.style.position = "absolute";
      btn.style.top = "2px";
      btn.style.right = "2px";
      btn.style.marginLeft = "0";
      btn.style.background = "transparent";
      btn.style.border = "1px solid var(--bm-border-strong)";
      btn.style.color = "var(--bm-accent-strong)";
      btn.style.borderRadius = "50%";
      btn.style.width = "14px";
      btn.style.height = "14px";
      btn.style.minWidth = "14px";
      btn.style.minHeight = "14px";
      btn.style.padding = "0";
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
      btn.style.fontSize = "9px";
      btn.style.lineHeight = "1";
      btn.addEventListener("click", () => moderateDelete(messageIdNum));
      row.appendChild(btn);
    };
    const renderModerationControls = () => {
      const rows = messagesEl.querySelectorAll(".bm-chat-message");
      rows.forEach(ensureDeleteButton);
      if (modTools) {
        modTools.style.display = getModCode() ? "flex" : "none";
      }
    };
    const appendMessage = (payload) => {
      applyPendingReply(payload);
      const user = payload?.user || "anon";
      const text = payload?.text || "";
      const ts = payload?.ts ? new Date(payload.ts) : /* @__PURE__ */ new Date();
      const line = document.createElement("div");
      line.className = "bm-chat-message";
      if (payload?.id !== void 0 && payload?.id !== null) {
        const messageId = String(payload.id);
        line.setAttribute("data-msg-id", messageId);
        messageCache.set(messageId, payload);
      }
      const replyId = payload?.reply_to;
      if (replyId !== void 0 && replyId !== null) {
        const replyBlock = document.createElement("div");
        replyBlock.className = "bm-chat-reply-inline";
        const replySource = messageCache.get(String(replyId));
        const replyTitle = document.createElement("span");
        replyTitle.className = "bm-chat-reply-title";
        replyTitle.textContent = replySource?.user ? `\u21AA Reply to ${replySource.user}` : `\u21AA Reply to #${replyId}`;
        const replySnippet = document.createElement("span");
        replySnippet.className = "bm-chat-reply-snippet";
        replySnippet.textContent = clipText(replySource?.text || `Message #${replyId}`);
        replyBlock.appendChild(replyTitle);
        replyBlock.appendChild(replySnippet);
        line.appendChild(replyBlock);
      }
      const row = document.createElement("div");
      row.className = "bm-chat-row";
      const meta = document.createElement("span");
      meta.className = "bm-chat-meta";
      const timeLabel = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      meta.textContent = `[${timeLabel}] ${user}: `;
      const body = document.createElement("span");
      body.className = "bm-chat-body";
      appendLinkedText(body, text, { enableTeleport: true, shortenWplace: true });
      row.appendChild(meta);
      row.appendChild(body);
      line.appendChild(row);
      messagesEl.appendChild(line);
      while (messagesEl.childElementCount > 200) {
        messagesEl.removeChild(messagesEl.firstChild);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
      ensureDeleteButton(line);
      line.addEventListener("dblclick", () => {
        const id = line.getAttribute("data-msg-id");
        if (id) {
          setReplyTo(id);
          textInput.focus();
        }
      });
    };
    const handleDeleted = (payload) => {
      const messageId = payload?.id;
      if (typeof messageId !== "number") return;
      const row = messagesEl.querySelector(`.bm-chat-message[data-msg-id="${messageId}"]`);
      if (row) row.remove();
      messageCache.delete(String(messageId));
      if (replyToId && String(messageId) === replyToId) {
        clearReply();
      }
    };
    const scheduleReconnect = () => {
      const delay = reconnectAttempts === 0 ? 2e3 : reconnectAttempts === 1 ? 4e3 : 1e4;
      reconnectAttempts = Math.min(reconnectAttempts + 1, 2);
      if (reconnectTimer) return;
      setStatus(`reconnecting in ${Math.round(delay / 1e3)}s`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
    const connect = () => {
      if (chatSocket && (chatSocket.readyState === WebSocket.OPEN || chatSocket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      setStatus("connecting");
      chatSocket = new WebSocket(CHAT_WS_URL);
      chatSocket.onopen = () => {
        reconnectAttempts = 0;
        setStatus("connected");
      };
      chatSocket.onclose = () => {
        setStatus("disconnected");
        scheduleReconnect();
      };
      chatSocket.onerror = () => {
        setStatus("error");
      };
      chatSocket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "chat") {
            appendMessage(payload);
          } else if (payload?.type === "chat_deleted") {
            handleDeleted(payload);
          }
        } catch (_) {
        }
      };
    };
    const sendMessage = () => {
      const text = textInput.value.trim();
      if (!text) return;
      const user = userInput?.value?.trim() || "anon";
      if (!chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
        setStatus("disconnected");
        return;
      }
      const payload = { user, text };
      if (replyToId) {
        payload.reply_to = replyToId;
        queuePendingReply(user, text, replyToId);
      }
      chatSocket.send(JSON.stringify(payload));
      textInput.value = "";
      clearReply();
    };
    const setChatEnabled = (enabled) => {
      chatDetails.style.display = enabled ? "" : "none";
      if (!enabled) {
        try {
          chatSocket?.close();
        } catch (_) {
        }
        return;
      }
      connect();
    };
    window.setChatEnabled = setChatEnabled;
    if (chatInitialized) {
      setChatEnabled(!isChatDisabled());
      return;
    }
    chatInitialized = true;
    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    modCodeInput?.addEventListener("input", () => {
      GM.setValue("bmChatModCode", modCodeInput.value.trim());
      renderModerationControls();
    });
    const banBtn = document.getElementById("bm-chat-ban-btn");
    const unbanBtn = document.getElementById("bm-chat-unban-btn");
    const bansBtn = document.getElementById("bm-chat-bans-btn");
    banBtn?.addEventListener("click", () => {
      moderateBan(banTargetInput?.value, banTypeSelect?.value || "ip", false);
    });
    unbanBtn?.addEventListener("click", () => {
      moderateBan(banTargetInput?.value, banTypeSelect?.value || "ip", true);
    });
    bansBtn?.addEventListener("click", () => {
      fetchBans();
    });
    replyClear?.addEventListener("click", () => {
      clearReply();
      textInput.focus();
    });
    userInput?.addEventListener("change", () => {
      GM.setValue("bmChatUser", userInput.value.trim());
    });
    GM.getValue("bmChatUser", "").then((savedUser) => {
      if (userInput && !userInput.value) {
        const fallback = document.getElementById("bm-user-name")?.textContent?.trim() || "";
        userInput.value = savedUser || fallback;
      }
    });
    GM.getValue("bmChatModCode", "").then((savedCode) => {
      if (modCodeInput && !modCodeInput.value) {
        modCodeInput.value = savedCode || "";
        renderModerationControls();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (!event.altKey || event.key.toLowerCase() !== "a") return;
      if (isChatDisabled()) return;
      const active = document.activeElement;
      if (active && active.tagName && ["INPUT", "TEXTAREA"].includes(active.tagName) && active !== textInput && active !== userInput && active !== modCodeInput) {
        return;
      }
      const chatDetails2 = document.getElementById("bm-contain-chat");
      if (chatDetails2 && chatDetails2.tagName === "DETAILS") {
        chatDetails2.open = true;
      }
      if (modCodeInput) {
        const isHidden = modCodeInput.style.display === "none";
        modCodeInput.style.display = isHidden ? "" : "none";
        if (isHidden) {
          modCodeInput.focus();
        } else {
          textInput.focus();
        }
      } else {
        textInput.focus();
      }
    });
    setChatEnabled(!isChatDisabled());
  }
  inject(() => {
    const script = document.currentScript;
    const name2 = script?.getAttribute("bm-name") || "Rus Marble";
    const consoleStyle2 = script?.getAttribute("bm-cStyle") || "";
    const fetchedBlobQueue = /* @__PURE__ */ new Map();
    window.addEventListener("message", (event) => {
      const { source, endpoint, blobID, blobData, blink } = event.data;
      const elapsed = Date.now() - blink;
      console.groupCollapsed(`%c${name2}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle2, "");
      console.log(`Blob fetch took %c${String(Math.floor(elapsed / 6e4)).padStart(2, "0")}:${String(Math.floor(elapsed / 1e3) % 60).padStart(2, "0")}.${String(elapsed % 1e3).padStart(3, "0")}%c MM:SS.mmm`, consoleStyle2, "");
      console.log(fetchedBlobQueue);
      console.groupEnd();
      if (source == "blue-marble" && !!blobID && !!blobData && !endpoint) {
        const callback = fetchedBlobQueue.get(blobID);
        if (typeof callback === "function") {
          callback(blobData);
        } else {
          consoleWarn(`%c${name2}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle2, "", blobID);
        }
        fetchedBlobQueue.delete(blobID);
      }
    });
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const blink = Date.now();
      const response = await originalFetch.apply(this, args);
      const cloned = response.clone();
      const endpointName = (args[0] instanceof Request ? args[0]?.url : args[0]) || "ignore";
      const contentType = cloned.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        console.log(`%c${name2}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle2, "");
        if (endpointName.endsWith("/tile/random")) {
          return new Promise((resolve) => {
            const blobUUID = crypto.randomUUID();
            fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
              resolve(new Response(blobProcessed, {
                headers: cloned.headers,
                status: cloned.status,
                statusText: cloned.statusText
              }));
              console.log(`%c${name2}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle2, "");
            });
            cloned.json().then((jsonData) => {
              window.postMessage({
                source: "blue-marble",
                endpoint: endpointName,
                blobID: blobUUID,
                jsonData,
                blink
              }, "*");
            }).catch((err) => {
              console.error(`%c${name2}%c: Failed to parse JSON: `, consoleStyle2, "", err);
            });
          });
        }
        if (endpointName.includes("/s0/pixel/") && endpointName.includes("?x=") && endpointName.includes("&y=") && cloned.status === 400) {
          return new Promise((resolve, reject) => {
            const cloned2 = response.clone();
            cloned2.text().then((text) => {
              const errorPrefix = '{"error":"Invalid x","status":400}';
              if (text.startsWith(errorPrefix)) {
                const fixedPayload = text.slice(errorPrefix.length);
                console.error("Fixed", fixedPayload);
                try {
                  const actualPayload = JSON.parse(fixedPayload);
                  console.error("actualPayload", actualPayload);
                  window.postMessage({
                    source: "blue-marble",
                    endpoint: endpointName,
                    jsonData: actualPayload,
                    blink
                  }, "*");
                  resolve(new Response(fixedPayload, {
                    headers: cloned.headers,
                    status: 200,
                    statusText: "OK"
                  }));
                } catch (err) {
                  console.error(`%c${name2}%c: Failed to parse JSON: `, consoleStyle2, "", err);
                  resolve(response);
                }
              } else {
                resolve(response);
              }
            }).catch((err) => {
              console.error(`%c${name2}%c: Failed to get Content: `, consoleStyle2, "", err);
              resolve(response);
            });
          });
        } else {
          cloned.json().then((jsonData) => {
            window.postMessage({
              source: "blue-marble",
              endpoint: endpointName,
              jsonData,
              blink
            }, "*");
          }).catch((err) => {
            console.error(`%c${name2}%c: Failed to parse JSON: `, consoleStyle2, "", err);
          });
        }
      } else if (contentType.includes("image/") && (!endpointName.includes("openfreemap") && !endpointName.includes("maps"))) {
        const blob = await cloned.blob();
        console.log(`%c${name2}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle2, "");
        window.postMessage({
          source: "blue-marble",
          endpoint: endpointName,
          lastModified: cloned.headers.get("Last-Modified"),
          blobData: blob,
          blink
        });
      }
      return response;
    };
    const hookedMapFuncs = {
      "values": Map.prototype.values
    };
    const hookedMapValues = function() {
      const temp = hookedMapFuncs.values.call(this);
      Array.from(temp).forEach((x) => {
        if (x && x["maps"] instanceof Set) {
          Array.from(x["maps"]).forEach((y) => {
            if (y && y["flyTo"]) document.head["__bmmap"] = y, restoreMapPrototype();
          });
        }
        ;
      });
      return temp;
    };
    const restoreMapPrototype = function() {
      for (const key in hookedMapFuncs) {
        Map.prototype[key] = hookedMapFuncs[key];
      }
    };
    Map.prototype.values = hookedMapValues;
  });
  GM_xmlhttpRequest({
    method: "GET",
    url: CSS_BM_File,
    onload: (response) => {
      if (response.status >= 200 && response.status < 300) {
        GM.addStyle(response.responseText);
      } else {
        consoleWarn(`%c${name}%c: Failed to load CSS (${response.status}) from ${CSS_BM_File}`, consoleStyle, "");
      }
    },
    onerror: (err) => {
      consoleWarn(`%c${name}%c: Failed to load CSS from ${CSS_BM_File}`, consoleStyle, "", err);
    }
  });
  var overlayMain = new Overlay(name, version);
  var templateManager = new TemplateManager(name, version, overlayMain);
  var apiManager = new ApiManager(templateManager);
  overlayMain.setApiManager(apiManager);
  GM.getValue("bmTemplates", "{}").then(async (storageTemplatesValue) => {
    const userSettingsValue = await GM.getValue("bmUserSettings", "{}");
    let userSettings;
    try {
      userSettings = JSON.parse(userSettingsValue);
    } catch {
      userSettings = {};
    }
    console.log(userSettings);
    console.log(Object.keys(userSettings).length);
    if (Object.keys(userSettings).length == 0) {
      const uuid = crypto.randomUUID();
      console.log(uuid);
      templateManager.setUserSettings({
        "uuid": uuid,
        "hideLockedColors": false,
        "progressBarEnabled": true,
        "hideCompletedColors": false,
        "sortBy": "total-desc",
        "anchor": "lt",
        // Top left
        "smartPlace": false,
        // Hidden in settings
        "memorySavingMode": false,
        "eventEnabled": false,
        "eventProvider": "",
        "eventClaimedShown": true,
        "eventUnavailableShown": true,
        "onlyCurrentColorShown": false,
        "themeOverridden": false,
        "currentTheme": "",
        "layoutTheme": "classic",
        "templateDisplay": "cross",
        "hideDroplets": false,
        "hideNextLevel": false,
        "hideStatus": false,
        "isLegacyDisplay": false,
        "showErrorMap": false,
        "showOnlyEnabledColorsErrorMap": false,
        // Hidden in settings
        "showIntegerZoom": false,
        "enableKeybinds": false,
        "lineTemplateButton": false,
        // Hidden in settings
        "chatDisabled": false
      });
      templateManager.storeUserSettings();
    } else {
      templateManager.setUserSettings(userSettings);
    }
    let storageTemplates;
    try {
      storageTemplates = JSON.parse(storageTemplatesValue);
    } catch {
      storageTemplates = {};
    }
    console.log(storageTemplates);
    templateManager.importJSON(storageTemplates);
    await buildOverlayMain();
    initChat();
    startTemplateUpdatePolling();
    startNotificationPolling();
    overlayMain.handleDrag("#bm-overlay", "#bm-bar-drag");
    const keysPressed = /* @__PURE__ */ new Set();
    let animationFrameId = null;
    const PAN_SPEED = 25;
    function panLoop() {
      if (!templateManager.areKeybindsEnabled()) {
        keysPressed.clear();
      }
      if (keysPressed.size === 0) {
        animationFrameId = null;
        return;
      }
      let dx = 0;
      let dy = 0;
      if (keysPressed.has("w") || keysPressed.has("arrowup")) dy -= 1;
      if (keysPressed.has("s") || keysPressed.has("arrowdown")) dy += 1;
      if (keysPressed.has("a") || keysPressed.has("arrowleft")) dx -= 1;
      if (keysPressed.has("d") || keysPressed.has("arrowright")) dx += 1;
      if (dx !== 0 || dy !== 0) {
        if (dx !== 0 && dy !== 0) {
          const length = Math.sqrt(dx * dx + dy * dy);
          dx /= length;
          dy /= length;
        }
        panMap([dx * PAN_SPEED, dy * PAN_SPEED]);
      }
      animationFrameId = requestAnimationFrame(panLoop);
    }
    document.addEventListener("keydown", (event) => {
      if (!templateManager.areKeybindsEnabled()) {
        return;
      }
      if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
        return;
      }
      const key = event.key.toLowerCase();
      const validKeys = ["w", "a", "s", "d"];
      if (!validKeys.includes(key) || keysPressed.has(key)) {
        return;
      }
      keysPressed.add(key);
      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(panLoop);
      }
    });
    document.addEventListener("keyup", (event) => {
      const key = event.key.toLowerCase();
      keysPressed.delete(key);
    });
    apiManager.spontaneousResponseListener(overlayMain);
    observeBlack();
    consoleLog(`%c${name}%c (${version}) userscript has loaded!`, "color: cornflowerblue;", "");
  });
  function createZoomButtons() {
    const zoom1 = document.getElementById("BM-zoom-1x");
    if (zoom1) return;
    const ref = Array.from(document.querySelectorAll(".gap-1>.btn[title]")).slice(-1)[0];
    if (!ref) return;
    const container = ref.parentNode;
    if (!container) return;
    const isShown = templateManager.areIntegerZoomButtonsShown();
    function createZoomButton(zoomLevel) {
      const zoomBtn = document.createElement("button");
      const label = zoomLevel === 0 ? "Min" : zoomLevel + "x";
      zoomBtn.id = `BM-zoom-${label}`;
      zoomBtn.textContent = label;
      zoomBtn.className = ref.className;
      zoomBtn.classList.add("bm-zoom-btn");
      if (!isShown) {
        zoomBtn.style.display = "none";
      }
      ;
      zoomBtn.onclick = function() {
        var actualZoomLevel = zoomLevel;
        if (zoomLevel === 0) {
          var currentTileSize = getCurrentTileSize();
          var epsilon = 1e-7;
          setZoom(Math.log2(8 * currentTileSize * currentTileSize) / 2 + epsilon);
          return;
        }
        setZoom(Math.log2(4e3 * actualZoomLevel / window["devicePixelRatio"]));
      };
      container.appendChild(zoomBtn);
    }
    ;
    [0, 1, 2, 3, 4, 5, 10, 25].forEach((zoom) => createZoomButton(zoom));
  }
  function observeBlack() {
    const observer = new MutationObserver((mutations, observer2) => {
      createZoomButtons();
      const black = document.querySelector("#color-1");
      if (!black) {
        return;
      }
      let move = document.querySelector("#bm-button-move");
      if (!move) {
        move = document.createElement("button");
        move.id = "bm-button-move";
        move.textContent = "Move \xE2\u2020\u2018";
        move.className = "btn btn-soft";
        move.onclick = function() {
          const roundedBox = this.parentNode.parentNode.parentNode.parentNode;
          const shouldMoveUp = this.textContent == "Move \xE2\u2020\u2018";
          roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? "bottom" : "top", shouldMoveUp ? "top" : "bottom");
          roundedBox.style.borderTopLeftRadius = shouldMoveUp ? "0px" : "var(--radius-box)";
          roundedBox.style.borderTopRightRadius = shouldMoveUp ? "0px" : "var(--radius-box)";
          roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? "var(--radius-box)" : "0px";
          roundedBox.style.borderBottomRightRadius = shouldMoveUp ? "var(--radius-box)" : "0px";
          this.textContent = shouldMoveUp ? "Move \xE2\u2020\u201C" : "Move \xE2\u2020\u2018";
        };
        const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector("h2");
        paintPixel.parentNode?.appendChild(move);
      }
      if (templateManager.userSettings?.smartPlace ?? false) {
        let paint = document.querySelector("#bm-button-paint");
        if (!paint) {
          paint = document.createElement("button");
          paint.id = "bm-button-paint";
          paint.textContent = "Paint";
          paint.className = "btn btn-soft";
          paint.onclick = function() {
            const currentCharges = Math.floor(apiManager.getCurrentCharges());
            if (currentCharges === 0) return;
            let examples = [];
            const toggleStatus = new Set(templateManager.getDisplayedColorsSorted());
            for (const stats of templateManager.tileProgress.values()) {
              Object.entries(stats.palette).forEach(([colorKey, content]) => {
                if (!toggleStatus.has(colorKey)) return;
                const colorId = rgbToMeta.get(colorKey).id;
                if (!templateManager.isColorUnlocked(colorId)) return;
                examples.extend(content.examplesEnabled.map((example) => [colorId, example]));
              });
            }
            ;
            let exampleCoord;
            if (examples.length === 0) return;
            try {
              const geoCoords = getCenterGeoCoords();
              const tileCoords = coordsGeoCoordsToTileCoords(geoCoords[0], geoCoords[1]);
              exampleCoord = [
                tileCoords[0][0] * templateManager.tileSize + tileCoords[1][0],
                tileCoords[0][1] * templateManager.tileSize + tileCoords[1][1]
              ];
            } catch {
              const example = examples[Math.floor(Math.random() * examples.length)][1];
              exampleCoord = [
                example[0][0] * templateManager.tileSize + example[1][0],
                example[0][1] * templateManager.tileSize + example[1][1]
              ];
            }
            ;
            if (examples.length <= currentCharges) {
            } else if (examples.length < 5e3) {
              examples = examples.sort(([color1, coord1], [color2, coord2]) => {
                const _coord1 = [
                  coord1[0][0] * templateManager.tileSize + coord1[1][0],
                  coord1[0][1] * templateManager.tileSize + coord1[1][1]
                ];
                const _coord2 = [
                  coord2[0][0] * templateManager.tileSize + coord2[1][0],
                  coord2[0][1] * templateManager.tileSize + coord2[1][1]
                ];
                const dist1 = Math.sqrt(Math.pow(_coord1[0] - exampleCoord[0], 2) + Math.pow(_coord1[1] - exampleCoord[1], 2)) * (1 + Math.random() * 0.2);
                const dist2 = Math.sqrt(Math.pow(_coord2[0] - exampleCoord[0], 2) + Math.pow(_coord2[1] - exampleCoord[1], 2)) * (1 + Math.random() * 0.2);
                return dist1 - dist2;
              }).slice(0, currentCharges);
            } else {
              const buckets = {};
              const resultExamples = [];
              examples.forEach(([color1, coord1]) => {
                const _coord1 = [
                  coord1[0][0] * templateManager.tileSize + coord1[1][0],
                  coord1[0][1] * templateManager.tileSize + coord1[1][1]
                ];
                const dist1 = Math.floor(Math.sqrt(Math.pow(_coord1[0] - exampleCoord[0], 2) + Math.pow(_coord1[1] - exampleCoord[1], 2)) * (1 + Math.random() * 0.2));
                if (buckets[dist1] === void 0) {
                  buckets[dist1] = [
                    [color1, coord1]
                  ];
                } else {
                  buckets[dist1].push(
                    [color1, coord1]
                  );
                }
              });
              const sortedDist = Object.keys(buckets).sort((a, b) => a - b);
              for (const dist of sortedDist) {
                resultExamples.extend(buckets[dist]);
                if (resultExamples.length >= currentCharges) break;
              }
              examples = resultExamples.slice(0, currentCharges);
            }
            const canvas = document.querySelector("canvas.maplibregl-canvas");
            teleportToTileCoords(examples[0][1][0], examples[0][1][1]);
            const wplaceBad = !isMapTilerLoaded();
            setTimeout(() => {
              let currentColorId = examples[0][0];
              document.getElementById("color-" + currentColorId).click();
              const refW = [
                examples[0][1][0][0] * templateManager.tileSize + examples[0][1][1][0],
                examples[0][1][0][1] * templateManager.tileSize + examples[0][1][1][1]
              ];
              const cliC = [canvas.offsetWidth / 2, canvas.offsetHeight / 2];
              const pxPerW = wplaceBad ? 512 * 2 ** (13 + 0) / 2048e3 : getPixelPerWplacePixel();
              for (let i = 0; i < examples.length; i++) {
                const [colorId, example] = examples[i];
                if (currentColorId !== colorId) {
                  currentColorId = colorId;
                  document.getElementById("color-" + colorId).click();
                }
                ;
                const exW = [
                  example[0][0] * templateManager.tileSize + example[1][0],
                  example[0][1] * templateManager.tileSize + example[1][1]
                ];
                const ev = new MouseEvent("click", {
                  "bubbles": true,
                  "cancelable": true,
                  "clientX": cliC[0] + (exW[0] - refW[0]) * pxPerW,
                  "clientY": cliC[1] + (exW[1] - refW[1]) * pxPerW,
                  "button": 0
                });
                canvas.dispatchEvent(ev);
              }
            }, wplaceBad ? 1e4 : 0);
          };
          const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector("h2");
          paintPixel.parentNode?.appendChild(paint);
        }
      }
      ;
      Array.from(black.parentNode.parentNode.getElementsByTagName("button")).forEach((button) => {
        if (button.parentElement.classList.contains("bm-hooked")) {
          return;
        }
        button.addEventListener("click", function() {
          if (templateManager.isOnlyCurrentColorShown()) {
            setTimeout(() => {
              templateManager.createOverlayOnMap();
              if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
                forceRefreshTiles();
              }
              ;
              buildColorFilterList();
            }, 0);
          }
          ;
        });
        button.parentElement.classList.add("bm-hooked");
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  var persistCoords = () => {
    try {
      const [[tx, ty], [px, py]] = getOverlayCoords();
      const data = { tx, ty, px, py };
      GM.setValue("bmCoords", JSON.stringify(data));
    } catch (_) {
    }
  };
  var teleportCoords = () => {
    try {
      const [[tx, ty], [px, py]] = getOverlayCoords();
      teleportToTileCoords([tx, ty], [px, py]);
    } catch (_) {
    }
  };
  async function buildOverlayMain() {
    let isMinimized = false;
    let savedCoords = {};
    const savedCoordsValue = await GM.getValue("bmCoords", "{}");
    try {
      savedCoords = JSON.parse(savedCoordsValue) || {};
    } catch {
      savedCoords = {};
    }
    overlayMain.addDiv({ "id": "bm-overlay", "style": "top: 10px; right: 75px;" }).addDiv({ "id": "bm-contain-header" }).addDiv({ "id": "bm-bar-drag" }).buildElement().addImg(
      { "alt": "Rus Marble Icon - Click to minimize/maximize", "src": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Flag_of_Russia.svg/960px-Flag_of_Russia.svg.png", "style": "cursor: pointer;" },
      (instance, img) => {
        img.addEventListener("click", () => {
          isMinimized = !isMinimized;
          const overlay = document.querySelector("#bm-overlay");
          const header = document.querySelector("#bm-contain-header");
          const dragBar = document.querySelector("#bm-bar-drag");
          const coordsContainer = document.querySelector("#bm-contain-coords");
          const coordsButton = document.querySelector("#bm-button-coords");
          const createButton = document.querySelector("#bm-button-create");
          const enableButton = document.querySelector("#bm-button-enable");
          const disableButton = document.querySelector("#bm-button-disable");
          const eventContainer = document.querySelector("#bm-contain-eventitem");
          const coordInputs = document.querySelectorAll("#bm-contain-coords input");
          const statusTextbox = document.getElementById(instance.outputStatusId);
          if (!isMinimized) {
            overlay.style.width = "auto";
            overlay.style.maxWidth = "300px";
            overlay.style.minWidth = "200px";
            overlay.style.padding = "10px";
          }
          const elementsToToggle = [
            "#bm-overlay h1",
            // Main title "Rus Marble"
            "#bm-contain-userinfo",
            // User information section (username, droplets, level)
            "#bm-overlay hr",
            // Visual separator lines
            "#bm-contain-automation > *:not(#bm-contain-coords)",
            // Automation section excluding coordinates
            "#bm-contain-buttons-action"
            // Action buttons container
          ];
          elementsToToggle.forEach((selector) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((element) => {
              element.style.display = isMinimized ? "none" : "";
            });
          });
          if (isMinimized) {
            if (coordsContainer) {
              coordsContainer.style.display = "none";
            }
            if (coordsButton) {
              coordsButton.style.display = "none";
            }
            if (createButton) {
              createButton.style.display = "none";
            }
            if (enableButton) {
              enableButton.style.display = "none";
            }
            if (disableButton) {
              disableButton.style.display = "none";
            }
            if (templateManager.isEventEnabled()) {
              eventContainer.style.display = "none";
            }
            if (!templateManager.isStatusHidden()) {
              statusTextbox.style.display = "none";
            }
            coordInputs.forEach((input) => {
              input.style.display = "none";
            });
            overlay.style.width = "60px";
            overlay.style.height = "76px";
            overlay.style.maxWidth = "60px";
            overlay.style.minWidth = "60px";
            overlay.style.padding = "8px";
            img.style.marginLeft = "3px";
            header.style.textAlign = "center";
            header.style.margin = "0";
            header.style.marginBottom = "0";
            if (dragBar) {
              dragBar.style.display = "";
              dragBar.style.marginBottom = "0.25em";
            }
          } else {
            if (coordsContainer) {
              coordsContainer.style.display = "";
              coordsContainer.style.flexDirection = "";
              coordsContainer.style.justifyContent = "";
              coordsContainer.style.alignItems = "";
              coordsContainer.style.gap = "";
              coordsContainer.style.textAlign = "";
              coordsContainer.style.margin = "";
            }
            if (coordsButton) {
              coordsButton.style.display = "";
            }
            if (createButton) {
              createButton.style.display = "";
              createButton.style.marginTop = "";
            }
            if (enableButton) {
              enableButton.style.display = "";
              enableButton.style.marginTop = "";
            }
            if (disableButton) {
              disableButton.style.display = "";
              disableButton.style.marginTop = "";
            }
            if (templateManager.isEventEnabled()) {
              eventContainer.style.display = "";
            } else {
              eventContainer.style.display = "none";
            }
            if (!templateManager.isStatusHidden()) {
              statusTextbox.style.display = "";
            } else {
              statusTextbox.style.display = "none";
            }
            coordInputs.forEach((input) => {
              input.style.display = "";
            });
            img.style.marginLeft = "";
            overlay.style.padding = "10px";
            header.style.textAlign = "";
            header.style.margin = "";
            header.style.marginBottom = "";
            if (dragBar) {
              dragBar.style.marginBottom = "0.5em";
            }
            overlay.style.width = "";
            overlay.style.height = "";
          }
          img.alt = isMinimized ? "Rus Marble Icon - Minimized (Click to maximize)" : "Rus Marble Icon - Maximized (Click to minimize)";
        });
      }
    ).buildElement().addHeader(1, { "textContent": name }).addSmall({ "textContent": ` v${version}` }).buildElement().buildElement().buildElement().addHr().buildElement().addDiv({ "id": "bm-contain-userinfo" }).addP({ "textContent": "Username: " }).addB({ "id": "bm-user-name" }).buildElement().buildElement().addP({ "id": "bm-user-charges" }, (_, element) => {
      element.setAttribute("aria-live", "polite");
    }).addText("Full Charges in ").addSpan({ "className": "bm-charge-countdown", "textContent": "--:--" }, (_, element) => {
      element.dataset.role = "countdown";
    }).buildElement().addText(" ").addSpan({ "className": "bm-charge-count", "textContent": "(0 / 0)" }, (_, element) => {
      element.dataset.role = "charge-count";
    }).buildElement().buildElement().addP({ "id": "bm-user-suspend", "style": "display: none;" }, (_, element) => {
      element.setAttribute("aria-live", "polite");
    }).addText("Suspension Expires in ").addSpan({ "className": "bm-suspend-countdown", "textContent": "--:--" }, (_, element) => {
      element.dataset.role = "suspend-countdown";
    }).buildElement().buildElement().addP({ "id": "bm-user-suspend-reason", "textContent": "Reason: ", "style": "display: none;" }).addB({ "id": "bm-suspend-reason", "textContent": "Unknown" }).buildElement().buildElement().addP({ "id": "bm-user-droplets-row", "textContent": "Droplets: " }, (_, element) => {
      if (templateManager.isDropletsHidden()) {
        element.style.display = "none";
      }
    }).addB({ "id": "bm-user-droplets" }).buildElement().buildElement().addP({ "id": "bm-user-nextlevel-row" }, (_, element) => {
      if (templateManager.isNextLevelHidden()) {
        element.style.display = "none";
      }
    }).addB({ "id": "bm-user-nextpixel", "textContent": "--" }).buildElement().addText(" more pixel").addSpan({ "id": "bm-user-nextpixel-plural", "textContent": "s" }).buildElement().addText(" to Lv. ").addB({ "id": "bm-user-nextlevel", "textContent": "--" }).buildElement().buildElement().buildElement().addHr().buildElement().addDiv({ "id": "bm-contain-automation" }).addDiv({ "id": "bm-contain-coords" }).addButton(
      { "id": "bm-button-coords", "className": "bm-help", "style": "margin-top: 0;", "innerHTML": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>' },
      (instance, button) => {
        button.onclick = () => {
          const coords2 = instance.apiManager?.coordsTilePixel;
          const emptyIfUndefined = (value) => value ?? "";
          if (coords2?.[0] === void 0) {
            instance.handleDisplayError("Coordinates are malformed! Did you try clicking on the canvas first?");
            return;
          }
          instance.updateInnerHTML("bm-input-tx", emptyIfUndefined(coords2?.[0]));
          instance.updateInnerHTML("bm-input-ty", emptyIfUndefined(coords2?.[1]));
          instance.updateInnerHTML("bm-input-px", emptyIfUndefined(coords2?.[2]));
          instance.updateInnerHTML("bm-input-py", emptyIfUndefined(coords2?.[3]));
          apiManager.updateDownloadButton();
          persistCoords();
        };
      }
    ).buildElement().addInput({ "type": "number", "id": "bm-input-tx", "placeholder": "Tl X", "min": 0, "max": 2047, "step": 1, "required": true, "value": savedCoords.tx ?? "" }, (instance, input) => {
      input.addEventListener("paste", (event) => {
        const clipboardText = (event.clipboardData || window.clipboardData).getData("text");
        const matchResult = [
          /^\s*([012]?\d{1,3}),\s*([012]?\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\s*$/,
          // comma-separated
          /^\s*([012]?\d{1,3})\s+([012]?\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*$/,
          // space-separated
          /^\s*\(?Tl X: ([012]?\d{1,3}), Tl Y: ([012]?\d{1,3}), Px X: (\d{1,3}), Px Y: (\d{1,3})\)?\s*$/
          // display format
        ].map((r) => r.exec(clipboardText)).filter((r) => r).pop();
        if (matchResult === void 0) {
          return;
        }
        let splitText = matchResult.slice(1).map(Number);
        let coords2 = selectAllCoordinateInputs(document);
        for (let i = 0; i < coords2.length; i++) {
          coords2[i].value = splitText[i];
        }
        apiManager.updateDownloadButton();
        persistCoords();
        event.preventDefault();
      });
      const handler = () => (apiManager.updateDownloadButton(), persistCoords());
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    }).buildElement().addInput({ "type": "number", "id": "bm-input-ty", "placeholder": "Tl Y", "min": 0, "max": 2047, "step": 1, "required": true, "value": savedCoords.ty ?? "" }, (instance, input) => {
      const handler = () => (apiManager.updateDownloadButton(), persistCoords());
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    }).buildElement().addInput({ "type": "number", "id": "bm-input-px", "placeholder": "Px X", "min": 0, "max": 2047, "step": 1, "required": true, "value": savedCoords.px ?? "" }, (instance, input) => {
      const handler = () => (apiManager.updateDownloadButton(), persistCoords());
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    }).buildElement().addInput({ "type": "number", "id": "bm-input-py", "placeholder": "Px Y", "min": 0, "max": 2047, "step": 1, "required": true, "value": savedCoords.py ?? "" }, (instance, input) => {
      const handler = () => (apiManager.updateDownloadButton(), persistCoords());
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    }).buildElement().addButton(
      { "id": "bm-button-teleport", "className": "bm-help", "style": "margin-top: 0;", "innerHTML": "\u2708\uFE0F", "title": "Teleport" },
      (instance, button) => {
        button.onclick = () => {
          teleportCoords();
        };
      }
    ).buildElement().buildElement().addDetails({ "id": "bm-checkbox-container", "textContent": "User Settings", "style": "max-width: 100%; white-space: nowrap; border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;" }).addDiv({ "id": "bm-user_setting-list", "style": "max-height: 125px; overflow-x: hidden; overflow-y: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px; margin-top: 3px;" }).addCheckbox({ "id": "bm-only-current-color-enabled", "textContent": "Show Current Color Only", "checked": templateManager.isOnlyCurrentColorShown() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setOnlyCurrentColorShown(checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Only the currently selected color will be shown.");
          buildColorFilterList();
        } else {
          instance.handleDisplayStatus("Color filter is restored.");
          buildColorFilterList();
        }
        ;
        templateManager.createOverlayOnMap();
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        }
        ;
        buildColorFilterList();
      });
    }).buildElement().addCheckbox({ "id": "bm-checkbox-colors-unlocked", "textContent": "Hide Locked Colors", "checked": templateManager.areLockedColorsHidden() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setHideLockedColors(checkbox.checked);
        buildColorFilterList();
        templateManager.createOverlayOnMap();
        if (checkbox.checked) {
          instance.handleDisplayStatus("Hidden all locked colors.");
        } else {
          instance.handleDisplayStatus("Restored all colors.");
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-checkbox-colors-completed", "textContent": "Hide Completed Colors", "checked": templateManager.areCompletedColorsHidden() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setHideCompletedColors(checkbox.checked);
        buildColorFilterList();
        templateManager.createOverlayOnMap();
        if (checkbox.checked) {
          instance.handleDisplayStatus("Hidden all completed colors.");
        } else {
          instance.handleDisplayStatus("Restored all colors.");
        }
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-show-error-map", "textContent": "Show Error Map", "checked": templateManager.isErrorMapShown() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setErrorMapShown(checkbox.checked);
        document.getElementById("bm-show-only-enabled-colors-on-error-map").parentElement.style.display = checkbox.checked ? "" : "none";
        if (checkbox.checked) {
          instance.handleDisplayStatus("Error Map is now Displayed.");
          apiManager.tileCache = {};
          forceRefreshTiles();
        } else {
          instance.handleDisplayStatus("Error Map is now Hidden.");
          removeLayer("error");
        }
        ;
      });
    }).buildElement().addCheckbox({ "id": "bm-show-only-enabled-colors-on-error-map", "textContent": "Only Enabled Colors on Error Map", "checked": templateManager.isErrorMapOnlyEnabledColorsShown() }, (instance, label, checkbox) => {
      label.style.paddingLeft = "1em";
      if (templateManager.isErrorMapShown()) {
        label.style.display = "";
      } else {
        label.style.display = "none";
      }
      checkbox.addEventListener("change", () => {
        templateManager.setErrorMapOnlyEnabledColorsShown(checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Error Map now only shows enabled colors.");
        } else {
          instance.handleDisplayStatus("Error Map now shows every pixel involved in the template.");
        }
        ;
        apiManager.tileCache = {};
        forceRefreshTiles();
      });
    }).buildElement().addDiv({ "className": "bm-setting-row" }).addSpan({ "textContent": "Layout Theme:" }).buildElement().addSelect({ "id": "bm-layout-theme" }, (instance, select) => {
      const currentLayoutTheme = normalizeLayoutTheme(templateManager.getLayoutTheme());
      Object.entries(layoutThemeOptions).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (value === currentLayoutTheme) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      select.addEventListener("change", async () => {
        const nextTheme = normalizeLayoutTheme(select.value);
        await templateManager.setLayoutTheme(nextTheme);
        applyLayoutTheme(nextTheme);
        instance.handleDisplayStatus(`Layout theme set to "${layoutThemeOptions[nextTheme]}".`);
      });
    }).buildElement().buildElement().addCheckbox({ "id": "bm-theme-override-enabled", "textContent": "Theme Override: ", "checked": templateManager.isThemeOverridden() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", async () => {
        await templateManager.setThemeOverridden(checkbox.checked);
        const select = document.getElementById("bm-theme-setting");
        select.disabled = !checkbox.checked;
        forceUpdateTheme();
      });
    }).addSelect({ "id": "bm-theme-setting" }, (instance, select) => {
      const currentTheme = templateManager.getCurrentTheme();
      Object.entries(themeList).forEach(([themeValue, [displayText, isDark]]) => {
        const option = document.createElement("option");
        option.value = themeValue;
        option.textContent = displayText;
        if (themeValue === currentTheme) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      select.addEventListener("change", async () => {
        await templateManager.setCurrentTheme(select.value);
        instance.handleDisplayStatus(`Changed the theme to "${themeList[select.value][0]}".`);
        forceUpdateTheme();
      });
    }).buildElement().buildElement().addCheckbox({ "id": "bm-event-enabled", "textContent": "Enable Event", "checked": templateManager.isEventEnabled() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setEventEnabled(checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Event Mode Enabled.");
          document.getElementById("bm-contain-eventitem").style.display = "";
          document.getElementById("bm-event-hide-claimed").parentElement.style.display = "";
          document.getElementById("bm-event-hide-unavailable").parentElement.style.display = "";
          apiManager.refreshEventData();
          buildEventList();
        } else {
          instance.handleDisplayStatus("Event Mode Disabled.");
          document.getElementById("bm-contain-eventitem").style.display = "none";
          document.getElementById("bm-event-hide-claimed").parentElement.style.display = "none";
          document.getElementById("bm-event-hide-unavailable").parentElement.style.display = "none";
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-event-hide-claimed", "textContent": "Hide Claimed Event Items", "checked": !templateManager.isEventClaimedShown() }, (instance, label, checkbox) => {
      label.style.paddingLeft = "1em";
      if (templateManager.isEventEnabled()) {
        label.style.display = "";
      } else {
        label.style.display = "none";
      }
      checkbox.addEventListener("change", () => {
        templateManager.setEventClaimedShown(!checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Hidden All Event Claimed Items.");
        } else {
          instance.handleDisplayStatus("Restored All Event Claimed Items.");
        }
        buildEventList();
      });
    }).buildElement().addCheckbox({ "id": "bm-event-hide-unavailable", "textContent": "Hide Unavailable Event Items", "checked": !templateManager.isEventUnavailableShown() }, (instance, label, checkbox) => {
      label.style.paddingLeft = "1em";
      if (templateManager.isEventEnabled()) {
        label.style.display = "";
      } else {
        label.style.display = "none";
      }
      checkbox.addEventListener("change", () => {
        templateManager.setEventUnavailableShown(!checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Hidden All Unavailable Event Items.");
        } else {
          instance.handleDisplayStatus("Restored All Unavailable Event Items.");
        }
        buildEventList();
      });
    }).buildElement().addDiv({ "className": "bm-setting-row" }).addSpan({ "textContent": "Template Display:" }).buildElement().addSelect({ "id": "bm-template-display" }, (instance, select) => {
      const currentDisplay = normalizeTemplateDisplay(templateManager.getTemplateDisplayMode());
      Object.entries(templateDisplayOptions).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        if (value === currentDisplay) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      select.addEventListener("change", async () => {
        const nextMode = normalizeTemplateDisplay(select.value);
        await templateManager.setTemplateDisplayMode(nextMode);
        if (nextMode === "dot") {
          instance.handleDisplayStatus("Switched to the Dot Template Display.");
        } else if (nextMode.startsWith("cross-z")) {
          instance.handleDisplayStatus("Switched to the Z-Cross Template Display.");
        } else {
          instance.handleDisplayStatus("Switched to the Cross Template Display.");
        }
        templateManager.createOverlayOnMap();
      });
    }).buildElement().buildElement().addCheckbox({ "id": "bm-show-zoom-buttons", "textContent": "Show Integer Zoom Buttons", "checked": templateManager.areIntegerZoomButtonsShown() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setIntegerZoomButtonsShown(checkbox.checked);
        const concernedElements = Array.from(document.getElementsByClassName("bm-zoom-btn"));
        if (checkbox.checked) {
          instance.handleDisplayStatus("Integer Zoom Buttons are now Displayed.");
          concernedElements.forEach((button) => button.style.display = "");
        } else {
          instance.handleDisplayStatus("Integer Zoom Buttons are now Hidden.");
          concernedElements.forEach((button) => button.style.display = "none");
        }
        ;
      });
    }).buildElement().addCheckbox({ "id": "bm-enable-keybinds", "textContent": "Enable WASD Keybinds", "checked": templateManager.areKeybindsEnabled() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setKeybindsEnabled(checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("WASD Keybinds are now Enabled.");
        } else {
          instance.handleDisplayStatus("WASD Keybinds are now Disabled.");
        }
        ;
      });
    }).buildElement().addCheckbox({ "id": "bm-chat-disabled", "textContent": "Disable Chat", "checked": templateManager.isChatDisabled() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setChatDisabled(checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Chat is now Disabled.");
        } else {
          instance.handleDisplayStatus("Chat is now Enabled.");
        }
        if (typeof window.setChatEnabled === "function") {
          window.setChatEnabled(!checkbox.checked);
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-enable-line-template", "textContent": "Shape Templates (Experimental)", "checked": templateManager.isLineTemplateButtonShown() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setLineTemplateButtonEnabled(checkbox.checked);
        if (checkbox.checked) {
          apiManager.updateAddLineTemplateButton();
          apiManager.updateAddCircleTemplateButton();
          instance.handleDisplayStatus("The Line and Circle Template Buttons are now Shown in Pixel Info.");
        } else {
          const btnLineTemplate = document.getElementById("bm-create-line-template");
          if (btnLineTemplate) {
            btnLineTemplate.remove();
          }
          const btnCircleTemplate = document.getElementById("bm-create-circle-template");
          if (btnCircleTemplate) {
            btnCircleTemplate.remove();
          }
          instance.handleDisplayStatus("The Line and Circle Template Buttons are now Hidden from Pixel Info.");
        }
        ;
      });
    }).buildElement().addCheckbox({ "id": "bm-progress-bar-enabled", "textContent": "Show Progress Bar", "checked": templateManager.isProgressBarEnabled() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setProgressBarEnabled(checkbox.checked);
        buildColorFilterList();
        if (checkbox.checked) {
          instance.handleDisplayStatus("Progress Bar Enabled.");
        } else {
          instance.handleDisplayStatus("Progress Bar Disabled.");
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-hide-user-droplets", "textContent": "Hide Droplets", "checked": templateManager.isDropletsHidden() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setDropletsHidden(checkbox.checked);
        const dropletsRow = document.getElementById("bm-user-droplets-row");
        if (dropletsRow) {
          dropletsRow.style.display = checkbox.checked ? "none" : "";
        }
        if (checkbox.checked) {
          instance.handleDisplayStatus("Droplets Hidden.");
        } else {
          instance.handleDisplayStatus("Droplets Restored.");
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-hide-user-nextlevel", "textContent": "Hide Next Level", "checked": templateManager.isNextLevelHidden() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setNextLevelHidden(checkbox.checked);
        const nextLevelRow = document.getElementById("bm-user-nextlevel-row");
        if (nextLevelRow) {
          nextLevelRow.style.display = checkbox.checked ? "none" : "";
        }
        if (checkbox.checked) {
          instance.handleDisplayStatus("Next Level Hidden.");
        } else {
          instance.handleDisplayStatus("Next Level Restored.");
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-status-hidden", "textContent": "Hide Status Display", "checked": templateManager.isStatusHidden() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setStatusHidden(checkbox.checked);
        if (checkbox.checked) {
          instance.handleDisplayStatus("Status Display Hidden.");
          document.getElementById(overlayMain.outputStatusId).style.display = "none";
        } else {
          instance.handleDisplayStatus("Status Display Restored.");
          document.getElementById(overlayMain.outputStatusId).style.display = "";
        }
      });
    }).buildElement().addCheckbox({ "id": "bm-memory-saving-enabled", "textContent": "Memory-Saving Mode (Experimental)", "checked": templateManager.isMemorySavingModeOn() }, (instance, label, checkbox) => {
      checkbox.addEventListener("change", () => {
        templateManager.setMemorySavingMode(checkbox.checked);
        buildColorFilterList();
        if (checkbox.checked) {
          instance.handleDisplayStatus("Memory Saving Mode Enabled. The Effect will be Fully Active After a Page Refresh.");
        } else {
          instance.handleDisplayStatus("Memory Saving Mode Disabled. The Effect will be Fully Active After a Page Refresh.");
        }
      });
    }).buildElement().buildElement().buildElement().addDetails({ "id": "bm-contain-colorfilter", "textContent": "Colors", "style": "border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;" }, (instance, summary, details) => {
      details.open = true;
    }).addP({ "textContent": "Sort Colors by ", "style": "font-size: small; margin-top: 3px; margin-left: 5px;" }).addSelect({ "id": "bm-color-sort" }, (instance, select) => {
      const order = [
        "Asc",
        "Desc"
      ];
      const currentSortBy = templateManager.getSortBy();
      Object.keys(sortByOptions).forEach((o) => {
        order.forEach((o2) => {
          const option = document.createElement("option");
          option.value = `${o.toLowerCase()}-${o2.toLowerCase()}`;
          option.textContent = `${o[0].toUpperCase() + o.slice(1).toLowerCase()} (${o2}.)`;
          if (option.value === currentSortBy) {
            option.selected = true;
          }
          select.appendChild(option);
        });
      });
      select.addEventListener("change", () => {
        templateManager.setSortBy(select.value);
        buildColorFilterList();
        const parts = select.value.split("-");
        instance.handleDisplayStatus(`Changed the sort criteria to "${parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase()}" in ${parts[1]}ending order.`);
      });
    }).buildElement().buildElement().addDiv({ "id": "bm-button-colors-container", "style": "display: flex; gap: 6px; margin-top: 3px; margin-bottom: 3px;" }).addButton({ "id": "bm-button-colors-enable-all", "textContent": "Enable All" }, (instance, button) => {
      button.onclick = () => {
        templateManager.templatesArray.forEach((t) => {
          if (!t?.colorPalette) {
            return;
          }
          Object.values(t.colorPalette).forEach((v) => v.enabled = true);
        });
        syncToggleList();
        templateManager.createOverlayOnMap();
        buildColorFilterList();
        instance.handleDisplayStatus("Enabled all colors");
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        }
        ;
      };
    }).buildElement().addButton({ "id": "bm-button-colors-disable-all", "textContent": "Disable All" }, (instance, button) => {
      button.onclick = () => {
        templateManager.templatesArray.forEach((t) => {
          if (!t?.colorPalette) {
            return;
          }
          Object.values(t.colorPalette).forEach((v) => v.enabled = false);
        });
        syncToggleList();
        removeLayer("overlay");
        templateManager.createOverlayOnMap();
        buildColorFilterList();
        instance.handleDisplayStatus("Disabled all colors");
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        }
        ;
      };
    }).buildElement().addButton({ "id": "bm-button-colors-disable-paid", "textContent": "Disable Paid" }, (instance, button) => {
      button.onclick = () => {
        templateManager.templatesArray.forEach((t) => {
          if (!t?.colorPalette) {
            return;
          }
          Object.entries(t.colorPalette).forEach(([rgb, value]) => {
            const meta = rgbToMeta.get(rgb);
            const colorId = Number(meta?.id);
            if (Number.isFinite(colorId) && colorId >= 32) {
              value.enabled = false;
            }
          });
        });
        syncToggleList();
        templateManager.createOverlayOnMap();
        buildColorFilterList();
        instance.handleDisplayStatus("Disabled paid colors");
        if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
          forceRefreshTiles();
        }
        ;
      };
    }).buildElement().buildElement().addDiv({ "id": "bm-colorfilter-list", "style": "max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;" }).buildElement().buildElement().addDetails({ "id": "bm-contain-templatefilter", "textContent": "Templates", "style": "border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;" }, (instance, summary, details) => {
      details.open = true;
    }).addDiv({ "id": "bm-contain-buttons-template", "style": "margin-bottom: 3px;" }).addInputFile({ "id": "bm-input-file-template", "textContent": "Select Img", "accept": "image/png, image/jpeg, image/webp, image/bmp, image/gif" }).addButton({ "id": "bm-button-create", "textContent": "Create", "style": "margin: 0 1ch;" }, (instance, button) => {
      button.onclick = async () => {
        const input = document.querySelector("#bm-input-file-template");
        const coordTlX = document.querySelector("#bm-input-tx");
        if (!coordTlX.checkValidity()) {
          coordTlX.reportValidity();
          instance.handleDisplayError("Coordinates are malformed! Did you try clicking on the canvas first?");
          return;
        }
        const coordTlY = document.querySelector("#bm-input-ty");
        if (!coordTlY.checkValidity()) {
          coordTlY.reportValidity();
          instance.handleDisplayError("Coordinates are malformed! Did you try clicking on the canvas first?");
          return;
        }
        const coordPxX = document.querySelector("#bm-input-px");
        if (!coordPxX.checkValidity()) {
          coordPxX.reportValidity();
          instance.handleDisplayError("Coordinates are malformed! Did you try clicking on the canvas first?");
          return;
        }
        const coordPxY = document.querySelector("#bm-input-py");
        if (!coordPxY.checkValidity()) {
          coordPxY.reportValidity();
          instance.handleDisplayError("Coordinates are malformed! Did you try clicking on the canvas first?");
          return;
        }
        if (!input?.files[0]) {
          instance.handleDisplayError(`No file selected!`);
          return;
        }
        await templateManager.createTemplate(
          input.files[0],
          input.files[0]?.name.replace(/\.[^/.]+$/, ""),
          [
            Number(coordTlX.value),
            Number(coordTlY.value),
            Number(coordPxX.value),
            Number(coordPxY.value)
          ],
          templateManager.getAnchor()
        );
        instance.handleDisplayStatus(`Drew to canvas!`);
      };
    }).buildElement().addButton({ "id": "bm-button-sync-templates", "textContent": "\u{1F504}" }, (instance, button) => {
      button.style.position = "relative";
      button.style.overflow = "visible";
      const badge = document.createElement("span");
      badge.id = "bm-sync-templates-badge";
      badge.className = "bm-sync-badge";
      badge.style.display = "none";
      button.appendChild(badge);
      button.onclick = async () => {
        try {
          instance.handleDisplayStatus("Syncing templates from server...");
          const listResponse = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/templates`, "json");
          const listData = listResponse.response ?? JSON.parse(listResponse.responseText || "{}");
          const templateItems = Array.isArray(listData) ? listData : Array.isArray(listData?.templates) ? listData.templates : [];
          if (!Array.isArray(templateItems) || templateItems.length === 0) {
            instance.handleDisplayStatus("No server templates found.");
            return;
          }
          let importedCount = 0;
          for (const entry of templateItems) {
            const name2 = typeof entry === "string" ? entry : entry?.name;
            const updatedAt = typeof entry === "object" ? entry?.updated_at : null;
            const listOrder = Number.isFinite(Number(entry?.order)) ? Number(entry?.order) : null;
            if (!name2) {
              continue;
            }
            const safeName = encodeURIComponent(name2);
            const existingTemplate = (templateManager.templatesArray ?? []).find((t) => {
              if (!t) return false;
              const sameName = t.displayName === name2 || t.remoteName === name2;
              return sameName;
            });
            const existingPalette = existingTemplate?.colorPalette ? { ...existingTemplate.colorPalette } : null;
            const existingUpdatedAt = templateManager.templatesJSON?.templates?.[existingTemplate?.storageKey]?.remoteUpdatedAt ?? existingTemplate?.remoteUpdatedAt ?? null;
            const normalizedExistingUpdatedAt = normalizeUpdatedAt(existingUpdatedAt);
            const normalizedUpdatedAt = normalizeUpdatedAt(updatedAt);
            if (normalizedExistingUpdatedAt && normalizedUpdatedAt && normalizedExistingUpdatedAt === normalizedUpdatedAt) {
              continue;
            }
            const metaResponse = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/templates/${safeName}`, "json");
            const meta = metaResponse.response ?? JSON.parse(metaResponse.responseText || "{}");
            const coords2 = Array.isArray(meta?.coords) ? meta.coords.map(Number) : null;
            if (!coords2 || coords2.length !== 4 || coords2.some((n) => !Number.isFinite(n))) {
              instance.handleDisplayStatus(`Skipped "${name2}": invalid coords.`);
              continue;
            }
            const metaUpdatedAt = meta?.updated_at ?? null;
            const toTop = meta?.to_top === true;
            const toTopAt = meta?.to_top_at ?? null;
            const highlighted = meta?.highlighted === true;
            const highlightedAt = meta?.highlighted_at ?? null;
            const metaOrder = Number(meta?.order);
            const order = Number.isFinite(metaOrder) ? metaOrder : listOrder;
            if (existingTemplate?.storageKey) {
              await templateManager.deleteTemplate(existingTemplate.storageKey);
            }
            const imageResponse = await gmRequest(`${TEMPLATE_SYNC_BASE_URL}/templates/${safeName}/image`, "blob");
            const imageBlob = imageResponse.response;
            const file = new File([imageBlob], `${name2}.png`, { type: imageBlob?.type || "image/png" });
            const created = await templateManager.createTemplate(
              file,
              name2,
              coords2,
              templateManager.getAnchor(),
              {
                remote: true,
                remoteName: name2,
                remoteCoords: coords2,
                remoteUpdatedAt: updatedAt || metaUpdatedAt,
                remoteToTop: toTop,
                remoteToTopAt: toTopAt,
                remoteHighlighted: highlighted,
                remoteHighlightedAt: highlightedAt,
                remoteOrder: Number.isFinite(order) ? order : null,
                enabled: false
              }
            );
            if (created) {
              if (existingPalette) {
                Object.entries(existingPalette).forEach(([rgb, meta2]) => {
                  if (created.colorPalette?.[rgb]) {
                    created.colorPalette[rgb].enabled = !!meta2?.enabled;
                  }
                });
              }
            }
            importedCount += 1;
          }
          syncToggleList();
          templateManager.createOverlayOnMap();
          buildTemplateFilterList();
          buildColorFilterList();
          instance.handleDisplayStatus(`Synced ${importedCount} template${importedCount === 1 ? "" : "s"}.`);
          resetTemplateUpdateBadge();
          checkTemplateUpdates();
        } catch (err) {
          consoleWarn(`%c${name}%c: Failed to sync server templates`, consoleStyle, "", err);
          instance.handleDisplayError("Failed to sync server templates.");
        }
      };
    }).buildElement().addSelect({ "id": "bm-template-anchor" }, (instance, select) => {
      const anchors = {
        "lt": "\u27D4",
        "mt": "\u2A2A",
        "rt": "\u14AC",
        "lm": "\uA70F",
        "mm": "\u22A1",
        "rm": "\uA70A",
        "lb": "\u013F",
        "mb": "\u2238",
        "rb": "\u27D3"
      };
      const anchorTextX = {
        "l": "Left",
        "m": "Center",
        "r": "Right"
      };
      const anchorTextY = {
        "t": "Top",
        "m": "Middle",
        "b": "Bottom"
      };
      const currentAnchor = templateManager.getAnchor();
      Object.entries(anchors).forEach(([anchor, displayText]) => {
        const option = document.createElement("option");
        option.value = anchor;
        option.textContent = displayText;
        if (anchor === currentAnchor) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      select.addEventListener("change", () => {
        templateManager.setAnchor(select.value);
        instance.handleDisplayStatus(`Changed the default template anchor to "${anchorTextY[select.value[1]]} ${anchorTextX[select.value[0]]}".`);
      });
    }).buildElement().buildElement().addDiv({ "id": "bm-templatefilter-list", "style": "max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;" }).buildElement().buildElement().addDetails({ "id": "bm-contain-chat", "textContent": "Chat", "style": "border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;" }, (instance, summary, details) => {
      details.open = false;
    }).addDiv({ "id": "bm-chat-status", "style": "display: flex; align-items: center; justify-content: flex-end; font-size: small; margin-bottom: 4px;" }).addSpan({ "className": "bm-chat-status-light", "title": "Chat status" }).buildElement().buildElement().addDiv({ "id": "bm-chat-mod-tools", "style": "display: none; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 4px;" }).addSelect({ "id": "bm-chat-ban-type", "style": "width: 8ch;" }, (instance, select) => {
      const optIp = document.createElement("option");
      optIp.value = "ip";
      optIp.textContent = "IP";
      const optDevice = document.createElement("option");
      optDevice.value = "device";
      optDevice.textContent = "Device";
      select.appendChild(optIp);
      select.appendChild(optDevice);
    }).buildElement().addInput({ "type": "text", "id": "bm-chat-ban-target", "placeholder": "IP / device id / msg id", "maxlength": 64, "style": "width: 18ch;" }).buildElement().addButton({ "id": "bm-chat-ban-btn", "textContent": "Ban", "style": "font-size: 11px; padding: 0 6px;" }).buildElement().addButton({ "id": "bm-chat-unban-btn", "textContent": "Unban", "style": "font-size: 11px; padding: 0 6px;" }).buildElement().addButton({ "id": "bm-chat-bans-btn", "textContent": "Bans", "style": "font-size: 11px; padding: 0 6px;" }).buildElement().buildElement().addDiv({ "id": "bm-chat-messages", "style": "max-height: 120px; overflow-y: auto; border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-bottom: 4px;" }).buildElement().addDiv({ "id": "bm-chat-reply", "style": "display: none; border-left: 3px solid var(--bm-chat-reply-border); padding: 4px 6px; margin-bottom: 4px; border-radius: 4px; background: var(--bm-chat-reply-bg);" }).addSpan({ "id": "bm-chat-reply-label", "textContent": "Replying to" }).buildElement().addSpan({ "id": "bm-chat-reply-text", "style": "display: block; font-size: 11px; color: var(--bm-muted);" }).buildElement().addButton({ "id": "bm-chat-reply-clear", "textContent": "\u2716", "style": "float: right; font-size: 10px; padding: 0 4px;" }).buildElement().buildElement().addDiv({ "id": "bm-chat-input-row", "style": "display: flex; gap: 4px; align-items: center;" }).addInput({ "type": "text", "id": "bm-chat-user", "placeholder": "User", "maxlength": 32, "style": "width: 8ch;" }).buildElement().addInput({ "type": "password", "id": "bm-chat-modcode", "placeholder": "Code", "maxlength": 64, "style": "width: 8ch; display: none;" }).buildElement().addInput({ "type": "text", "id": "bm-chat-text", "placeholder": "Message", "maxlength": 280, "style": "flex: 1;" }).buildElement().buildElement().buildElement().addDetails({ "id": "bm-contain-eventitem", "textContent": "Event", "style": "border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; display: none; margin-top: 4px;" }, (instance, summary, details) => {
      if (templateManager.isEventEnabled()) {
        details.style.display = "";
      }
      details.open = true;
    }).addButton({ "id": "bm-button-set-eventprovider", "textContent": "Set Data Provider", "style": "margin: 0 1ch;" }, (instance, button) => {
      button.onclick = () => {
        const currentProvider = templateManager.getEventProvider();
        const providerURL = prompt("Enter the event data provider JSON URL:", currentProvider === "" ? "https://wplace.samuelscheit.com/tiles/pumpkin.json" : currentProvider);
        if (!providerURL) {
          return;
        }
        const isUrl = ((content) => {
          try {
            return Boolean(new URL(content));
          } catch (e) {
            return false;
          }
        })(providerURL);
        if (!isUrl) {
          alert("The URL you entered is not valid!");
          return;
        }
        templateManager.setEventProvider(providerURL);
        buildEventList();
      };
    }).buildElement().addButton({ "id": "bm-button-refresh-event", "textContent": "Refresh Data", "style": "margin: 0 1ch;" }, (instance, button) => {
      button.onclick = () => buildEventList();
    }).buildElement().addDiv({ "id": "bm-eventitem-list", "style": "max-height: 125px; overflow: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px;" }).buildElement().buildElement().addTextarea({ "id": overlayMain.outputStatusId, "placeholder": `Status: Sleeping...
Version: ${version}`, "readOnly": true }, (instance, textarea) => {
      if (templateManager.isStatusHidden()) {
        textarea.style.display = "none";
      }
    }).buildElement().addDiv({ "id": "bm-contain-buttons-action" }).addDiv().addButton(
      { "id": "bm-button-convert", "className": "bm-help", "innerHTML": "\u{1F3A8}", "title": "Template Color Converter" },
      (instance, button) => {
        button.addEventListener("click", () => {
          window.open("https://pepoafonso.github.io/color_converter_wplace/", "_blank", "noopener noreferrer");
        });
      }
    ).buildElement().addButton(
      { "id": "bm-button-website", "className": "bm-help", "innerHTML": "\u{1F310}", "title": "Official Blue Marble Website" },
      (instance, button) => {
        button.addEventListener("click", () => {
          window.open("https://t.me/ruswplace", "_blank", "noopener noreferrer");
        });
      }
    ).buildElement().buildElement().addDiv({ "id": "bm-footer" }).addSmall({ "textContent": `by SwingTheVine | Forked by TWY`, "style": "margin-top: auto;" }).buildElement().buildElement().buildElement().buildElement().buildOverlay(document.body);
    applyLayoutTheme(templateManager.getLayoutTheme());
    window.syncToggleList = function syncToggleList2() {
      try {
        (templateManager.templatesArray ?? []).forEach((t) => {
          const key = t.storageKey;
          if (key && templateManager.templatesJSON?.templates?.[key]) {
            const templateJSON = templateManager.templatesJSON.templates[key];
            templateJSON.enabled = t.enabled;
            templateJSON.palette = t.colorPalette;
          }
        });
        templateManager.storeTemplates();
      } catch (_) {
      }
      ;
    };
    window.buildColorFilterList = function buildColorFilterList2() {
      const listContainer = document.querySelector("#bm-colorfilter-list");
      const toggleStatus = templateManager.getPaletteToggledStatus();
      const hideCompleted = templateManager.areCompletedColorsHidden();
      const hideLocked = templateManager.areLockedColorsHidden();
      listContainer.innerHTML = "";
      const { paletteSum, combinedProgress } = templateManager.getOverallPerColorProgress();
      if (!listContainer || !Object.keys(paletteSum).length) {
        if (listContainer) {
          listContainer.innerHTML = "<small>No template colors to display.</small>";
        }
        return;
      }
      const sortBy = templateManager.getSortBy();
      const sortByParts = sortBy.split("-");
      const keyFunction = sortByOptions[sortByParts[0]];
      const compareFunction = sortByParts[1] === "asc" ? (a, b) => keyFunction(a) - keyFunction(b) : (a, b) => keyFunction(b) - keyFunction(a);
      const paletteSumSorted = Object.entries(paletteSum).map(([rgb, count]) => [rgb, combinedProgress[rgb]?.paintedAndEnabled ?? 0, count]).sort(compareFunction);
      let hasColors = false;
      for (const [rgb, paintedCount, totalCount] of paletteSumSorted) {
        if (hideLocked && rgb === "other") continue;
        if (hideCompleted && paintedCount === totalCount) continue;
        let row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "6px";
        let swatch = document.createElement("div");
        swatch.style.width = "14px";
        swatch.style.height = "14px";
        swatch.style.border = "1px solid var(--bm-border-strong)";
        let colorName = "";
        let colorKey = "";
        const tMeta = rgbToMeta.get(rgb);
        if (rgb === "other") {
          swatch.style.background = "#888";
          colorName = "Other";
          colorKey = "other";
        } else if (rgb === "#deface") {
          swatch.style.background = "#deface";
          colorName = "Transparent";
          colorKey = "transparent";
        } else {
          const [r, g, b] = rgb.split(",").map(Number);
          swatch.style.background = `rgb(${r},${g},${b})`;
          try {
            if (tMeta && typeof tMeta.id === "number") {
              if (hideLocked && !templateManager.isColorUnlocked(tMeta.id)) continue;
              const displayName = tMeta?.name || `rgb(${r},${g},${b})`;
              if (tMeta.premium) {
                swatch.style.borderColor = "gold";
                swatch.style.boxShadow = "0 0 2px yellow";
              }
              colorName = `#${tMeta.id} ${displayName}`;
              colorKey = `${r},${g},${b}`;
            }
          } catch (ignored) {
          }
        }
        let label = document.createElement("span");
        label.style.fontSize = "12px";
        if (sortByParts[0] === "remaining" || hideCompleted && sortByParts[0] !== "painted") {
          const remainingLabelText = (totalCount - paintedCount).toLocaleString();
          label.textContent = `${colorName} \u2022 ${remainingLabelText} Left`;
        } else {
          const labelText = totalCount.toLocaleString();
          const paintedLabelText = paintedCount.toLocaleString();
          label.textContent = `${colorName} \u2022 ${paintedLabelText} / ${labelText}`;
        }
        if (templateManager.isProgressBarEnabled()) {
          const percentageProgress = paintedCount / (totalCount === 0 ? 1 : totalCount) * 100;
          row.style.background = `linear-gradient(to right, rgb(0, 128, 0, 0.8) 0%, rgb(0, 128, 0, 0.8) ${percentageProgress}%, transparent ${percentageProgress}%, transparent 100%)`;
        }
        const paletteEntry = combinedProgress[colorKey];
        let currentIndex = 0;
        swatch.addEventListener("click", () => {
          if ((paletteEntry?.examplesEnabled?.length ?? 0) > 0) {
            const examples = paletteEntry.examplesEnabled;
            const exampleIndex = currentIndex % examples.length;
            teleportToTileCoords(examples[exampleIndex][0], examples[exampleIndex][1]);
            ++currentIndex;
          }
        });
        if ((paletteEntry?.examplesEnabled?.length ?? 0) > 0) {
          swatch.style["cursor"] = "pointer";
        }
        ;
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        if (templateManager.isOnlyCurrentColorShown()) {
          toggle.checked = tMeta?.id === getCurrentColor();
          toggle.disabled = true;
        } else {
          toggle.checked = toggleStatus[rgb] ?? true;
        }
        toggle.addEventListener("change", () => {
          (templateManager.templatesArray ?? []).forEach((template) => {
            if (!template?.colorPalette) return;
            if (template.colorPalette[rgb] !== void 0) {
              template.colorPalette[rgb].enabled = toggle.checked;
            }
          });
          overlayMain.handleDisplayStatus(`${toggle.checked ? "Enabled" : "Disabled"} ${rgb}`);
          syncToggleList();
          templateManager.createOverlayOnMap();
          if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
            forceRefreshTiles();
          }
          ;
        });
        row.appendChild(toggle);
        row.appendChild(swatch);
        row.appendChild(label);
        listContainer.appendChild(row);
        hasColors = true;
      }
      if (!hasColors && listContainer) {
        if (hideLocked) {
          if (hideCompleted) {
            listContainer.innerHTML = "<small>All owned colors have been completed.</small>";
          } else {
            listContainer.innerHTML = "<small>Remaining colors are all locked.</small>";
          }
        } else {
          listContainer.innerHTML = "<small>All colors have been completed.</small>";
        }
      }
    };
    window.buildTemplateFilterList = function buildTemplateFilterList2() {
      const listContainer = document.querySelector("#bm-templatefilter-list");
      consoleLog(templateManager);
      if (templateManager.templatesArray?.length === 0) {
        if (listContainer) {
          listContainer.innerHTML = "<small>No templates to display.</small>";
        }
        return;
      }
      listContainer.innerHTML = "";
      const entries = templateManager.templatesArray;
      const entriesIndexed = entries.map((t, idx) => ({ t, idx }));
      entriesIndexed.sort((a, b) => {
        const aStore = templateManager.templatesJSON?.templates?.[a.t.storageKey] ?? {};
        const bStore = templateManager.templatesJSON?.templates?.[b.t.storageKey] ?? {};
        const aStoreRemote = aStore.remote === true;
        const bStoreRemote = bStore.remote === true;
        const aIsRemote = a.t.isRemote === true || aStoreRemote;
        const bIsRemote = b.t.isRemote === true || bStoreRemote;
        const aTopRaw = a.t.remoteToTop ?? aStore.remoteToTop ?? false;
        const bTopRaw = b.t.remoteToTop ?? bStore.remoteToTop ?? false;
        const aTop = aTopRaw === true || aTopRaw === "true";
        const bTop = bTopRaw === true || bTopRaw === "true";
        const aGroup = aTop ? 0 : aIsRemote ? 2 : 1;
        const bGroup = bTop ? 0 : bIsRemote ? 2 : 1;
        if (aGroup !== bGroup) return aGroup - bGroup;
        if (aGroup === 1) return a.idx - b.idx;
        const aOrderRaw = Number.isFinite(a.t.remoteOrder) ? a.t.remoteOrder : Number(aStore.remoteOrder);
        const bOrderRaw = Number.isFinite(b.t.remoteOrder) ? b.t.remoteOrder : Number(bStore.remoteOrder);
        const aOrderValue = Number.isFinite(aOrderRaw) ? aOrderRaw : Number.MAX_SAFE_INTEGER;
        const bOrderValue = Number.isFinite(bOrderRaw) ? bOrderRaw : Number.MAX_SAFE_INTEGER;
        if (aOrderValue !== bOrderValue) return aOrderValue - bOrderValue;
        return a.idx - b.idx;
      });
      const combinedTemplate = {};
      for (const stats of templateManager.tileProgress.values()) {
        Object.entries(stats.template).forEach(([storageKey, content]) => {
          if (combinedTemplate[storageKey] === void 0) {
            combinedTemplate[storageKey] = Object.fromEntries(Object.entries(content));
          } else {
            combinedTemplate[storageKey].painted += content.painted;
          }
        });
      }
      ;
      for (const entry of entriesIndexed) {
        const template = entry.t;
        let row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "6px";
        let removeButton = document.createElement("a");
        removeButton.title = "Remove template";
        removeButton.textContent = "\u{1F5D1}\uFE0F";
        removeButton.style.fontSize = "12px";
        removeButton.onclick = () => {
          if (confirm(`Remove template ${template?.displayName}?`)) {
            templateManager.deleteTemplate(template?.storageKey);
          }
        };
        let teleportButton = document.createElement("a");
        teleportButton.title = "Teleport to template";
        teleportButton.textContent = "\u2708\uFE0F";
        teleportButton.style.fontSize = "12px";
        teleportButton.onclick = () => {
          teleportToTileCoords(template.coords.slice(0, 2), template.coords.slice(2, 4));
        };
        let label = document.createElement("span");
        label.style.fontSize = "12px";
        const labelText = `${template.requiredPixelCount.toLocaleString()}`;
        const templateName = template["displayName"];
        const templateStore = templateManager.templatesJSON?.templates?.[template.storageKey] ?? {};
        const isRemote = template.isRemote === true || templateStore.remote === true;
        const isHighlighted = template.remoteHighlighted ?? templateStore.remoteHighlighted ?? false;
        const filledCount = combinedTemplate[template.storageKey]?.painted ?? 0;
        const filledLabelText = `${filledCount.toLocaleString()}`;
        const renameElement = document.createElement("span");
        renameElement.textContent = templateName;
        renameElement.className = "bm-templatename";
        renameElement.style.cursor = isRemote ? "not-allowed" : "text";
        renameElement.title = isRemote ? "Remote templates cannot be renamed." : "Click to rename.";
        renameElement.addEventListener("click", () => {
          if (isRemote) {
            overlayMain.handleDisplayStatus("Remote templates cannot be renamed.");
            return;
          }
          if (renameElement.dataset.editing === "true") {
            return;
          }
          renameElement.dataset.editing = "true";
          const currentName = template["displayName"];
          const input = document.createElement("input");
          input.type = "text";
          input.value = currentName;
          input.className = "bm-template-rename-input";
          let finished = false;
          const finish = (shouldSave) => {
            if (finished) {
              return;
            }
            finished = true;
            const nextName = input.value.trim();
            label.replaceChild(renameElement, input);
            renameElement.dataset.editing = "";
            if (!shouldSave || !nextName || nextName === currentName) {
              return;
            }
            template["displayName"] = nextName;
            renameElement.textContent = nextName;
            try {
              const templateJSON = templateManager.templatesJSON?.templates?.[template.storageKey];
              if (templateJSON) {
                templateJSON.name = nextName;
                templateManager.storeTemplates();
              }
            } catch (_) {
            }
            buildTemplateFilterList2();
          };
          label.replaceChild(input, renameElement);
          input.focus();
          input.select();
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            }
          });
          input.addEventListener("blur", () => finish(true));
        });
        if (isRemote) {
          row.classList.add("bm-template-remote");
          const badge = document.createElement("span");
          badge.className = "bm-remote-badge";
          badge.textContent = "REMOTE";
          label.appendChild(badge);
        }
        if (isHighlighted) {
          row.classList.add("bm-template-highlight");
          const badge = document.createElement("span");
          badge.className = "bm-highlight-badge";
          badge.textContent = "HIGHLIGHT";
          label.appendChild(badge);
        }
        label.appendChild(renameElement);
        label.appendChild(document.createTextNode(` \u2022 ${filledLabelText} / ${labelText}`));
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = template.enabled;
        toggle.addEventListener("change", () => {
          template.enabled = toggle.checked;
          overlayMain.handleDisplayStatus(`${toggle.checked ? "Enabled" : "Disabled"} ${templateName}`);
          if (toggle.checked) {
            templateManager.createOverlayOnMap(template.sortID);
          } else {
            templateManager.clearTileProgress(template);
            removeLayer(null, template.sortID);
          }
          syncToggleList();
          buildColorFilterList();
          forceRefreshTiles();
        });
        row.appendChild(toggle);
        row.appendChild(removeButton);
        row.appendChild(teleportButton);
        row.appendChild(label);
        listContainer.appendChild(row);
      }
    };
    window.buildEventList = function buildEventList2() {
      const listContainer = document.querySelector("#bm-eventitem-list");
      const showClaimed = templateManager.isEventClaimedShown();
      const showUnavailable = templateManager.isEventUnavailableShown();
      const provider = apiManager.eventDataURL ?? templateManager.getEventProvider();
      if (apiManager.eventClaimed === null) {
        listContainer.innerHTML = "<small>The event claimed items list is not loaded. Make sure you have clicked the ongoing Event button from the top left corner.</small>";
        return;
      }
      ;
      if (apiManager.eventData === null && (provider === null || provider == "")) {
        listContainer.innerHTML = "<small>Event data provider is not set.</small>";
        return;
      }
      ;
      const eventClaimedList = new Set(apiManager.eventClaimed);
      consoleLog("eventClaimedList", eventClaimedList);
      (apiManager.eventData === null ? fetch(provider, {
        "credentials": "include"
      }).then((response) => response.json()) : new Promise((resolve) => {
        const consumed = apiManager.eventData;
        apiManager.eventData = null;
        resolve(consumed);
      })).then((data) => {
        consoleLog("event Location data", data);
        if (typeof data !== "object") {
          listContainer.innerHTML = "<small>The event data provider does not provide a known format.</small>";
          return;
        }
        listContainer.textContent = "";
        let hasEntries = false;
        const dataSource = Array.isArray(data) ? data.map((entry, index) => [entry.id ?? index, entry]) : Object.entries(data);
        dataSource.forEach(([itemId, info]) => {
          itemId = Number(itemId);
          const isClaimed = eventClaimedList.has(itemId);
          if (isClaimed && !showClaimed) return;
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.alignItems = "center";
          row.style.gap = "6px";
          let coords2 = null;
          let coordStatus = "";
          if (typeof info === "object") {
            if (info["lat"] !== void 0 && info["lng"] !== void 0) {
              coords2 = [info["lat"], info["lng"]];
            } else if (info["latitude"] !== void 0 && info["longitude"] !== void 0) {
              coords2 = [info["latitude"], info["longitude"]];
            } else if (info["tileX"] !== void 0 && info["offsetX"] !== void 0 && info["tileY"] !== void 0 && info["offsetY"] !== void 0) {
              coords2 = coordsTileCoordsToGeoCoords(
                [info["tileX"], info["tileY"]],
                [info["offsetX"], info["offsetY"]]
              );
            }
            if (info["foundAt"] !== void 0) {
              const currentTimestamp = Date.now();
              const currentHour = currentTimestamp - currentTimestamp % 36e5;
              const foundTimestamp = new Date(info["foundAt"]).getTime();
              const foundHour = foundTimestamp - foundTimestamp % 36e5;
              if (currentHour !== foundHour) {
                coordStatus = "Expired \u2022 ";
                if (!showUnavailable) return;
              }
            }
          }
          if (coords2 !== null) {
            let teleportButton = document.createElement("a");
            teleportButton.title = "Teleport to event item";
            teleportButton.textContent = "\u2708\uFE0F";
            teleportButton.style.fontSize = "12px";
            teleportButton.onclick = () => {
              teleportToGeoCoords(coords2[0], coords2[1]);
              const mapMarkers = Array.from(
                document.querySelectorAll(".cursor-pointer.z-10")
                // z-10: not the pin (z-20)
              ).filter((x) => {
                if (x.style.opacity != 1) return false;
                const rect = x.getBoundingClientRect();
                const windowWidth = window.innerWidth || document.documentElement.clientWidth;
                const windowHeight = window.innerHeight || document.documentElement.clientHeight;
                return rect.top >= 0 && rect.bottom <= windowWidth && rect.left >= 0 && rect.right <= windowHeight;
              });
              if (mapMarkers.length === 1) {
                mapMarkers[0].click();
              }
              ;
            };
            row.appendChild(teleportButton);
          } else {
            coordStatus = "Unknown Coordinate Format \u2022 ";
          }
          let label = document.createElement("span");
          label.style.fontSize = "12px";
          label.textContent = `#${itemId} \u2022 ${coordStatus}${eventClaimedList.has(itemId) ? "Claimed" : "Unclaimed"}`;
          row.appendChild(label);
          listContainer.appendChild(row);
          hasEntries = true;
        });
        if (!hasEntries && listContainer) {
          listContainer.innerHTML = `<small>No ${showClaimed ? "" : "unclaimed "}items have ${showUnavailable ? "" : "recent "}data available.</small>`;
        }
      }).catch((err) => {
        listContainer.innerHTML = "<small>Failed fetching the event item info from the event data provider. Make sure the provider URL is a valid JSON resource and can be accessed with appropriate CORS.</small>";
      });
    };
    window.forceUpdateTheme = function forceUpdateTheme2() {
      if (templateManager.isThemeOverridden()) {
        setTheme(templateManager.getCurrentTheme());
      } else {
        setTheme(Object.keys(themeList)[0]);
      }
    };
    window.forceClickCenter = function forceClickCenter2() {
      if (!isMapTilerLoaded()) {
        if (!forceClickCenter2.clickCount) forceClickCenter2.clickCount = 0;
        if (forceClickCenter2.clickCount < 10) {
          const allianceOrRankingButton = document.querySelector(".flex>.btn.btn-square.relative.shadow-md");
          if (allianceOrRankingButton) {
            const canvas = document.querySelector("canvas.maplibregl-canvas");
            if (canvas) {
              const ev = new MouseEvent("click", {
                "bubbles": true,
                "cancelable": true,
                "clientX": canvas.offsetWidth / 2,
                "clientY": canvas.offsetHeight / 2,
                "button": 0
              });
              canvas.dispatchEvent(ev);
              ++forceClickCenter2.clickCount;
            }
            ;
          }
        }
        ;
        setTimeout(forceClickCenter2, 100);
      }
      ;
    };
    window.addEventListener("message", (event) => {
      if (event?.data?.bmEvent === "bm-rebuild-color-list") {
        try {
          buildColorFilterList();
        } catch (_) {
        }
      } else if (event?.data?.bmEvent === "bm-rebuild-template-list") {
        try {
          buildTemplateFilterList();
        } catch (_) {
        }
      } else if (event?.data?.bmEvent === "bm-rebuild-event-list") {
        try {
          buildEventList();
        } catch (_) {
        }
      }
    });
    setTimeout(() => {
      try {
        if (templateManager.templatesArray?.length > 0) {
          buildColorFilterList();
        }
        if (templateManager.templatesArray?.length > 0) {
          buildTemplateFilterList();
        }
      } catch (_) {
      }
      try {
        if (templateManager.isEventEnabled()) {
          buildEventList();
        }
      } catch (_) {
      }
      try {
        if (templateManager.isThemeOverridden()) {
          doAfterMapFound(forceUpdateTheme);
        }
      } catch (_) {
      }
      try {
        forceClickCenter();
      } catch (_) {
      }
    }, 0);
  }
})();
