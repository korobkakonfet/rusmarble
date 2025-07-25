/** The overlay for the Blue Marble script.
 * @description This class handles the overlay UI for the Blue Marble script.
 * @since 0.0.2
*/
export class Overlay {

  /** Constructor for the Overlay class.
   * @param {string} name - The name of the userscript
   * @param {string} version - The version of the userscript 
   * @since 0.0.2
   * @see {@link Overlay}
   */
  constructor(name, version) {
    this.name = name;
    this.version = version;
  }

  /** Creates and deploys the overlay element
   * @since 0.0.2
   */
  create() {

    const outputStatusId = 'bm-output-status'; // ID for status element

    const overlay = document.createElement('div'); // Creates a new <div> element for the overlay
    overlay.id = 'bm-overlay';
    overlay.style.top = '10px'; // Position from top of viewport
    overlay.style.right = '75px'; // Position from right of viewport

    const containerOverlayHeader = document.createElement('div');
    containerOverlayHeader.id = 'bm-contain-header';

    const barDrag = document.createElement('div'); // Drag bar for the overlay
    barDrag.id = 'bm-bar-drag';
    containerOverlayHeader.appendChild(barDrag); // Adds the drag bar to the overlay header container

    const barHeaderImage = document.createElement('img'); // Image in header
    barHeaderImage.src = 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png';
    barHeaderImage.alt = 'Blue Marble Icon';
    containerOverlayHeader.appendChild(barHeaderImage); // Adds the header image to the overlay header container

    const barHeader = document.createElement('h1'); // Header bar for the overlay
    barHeader.textContent = this.name;
    containerOverlayHeader.appendChild(barHeader); // Adds the header to the overlay header container

    const containerUserInfo = document.createElement('div'); // User info container
    containerUserInfo.id = 'bm-contain-userinfo';

    const userName = document.createElement('p'); // User name field
    userName.id = 'bm-user-name';
    userName.textContent = 'Username:';
    containerUserInfo.appendChild(userName); // Adds the username field to the user info container

    const userDroplets = document.createElement('p'); // User droplet field
    userDroplets.id = 'bm-user-droplets';
    userDroplets.textContent = 'Droplets:';
    containerUserInfo.appendChild(userDroplets); // Adds the droplet field to the user info container

    const userNextLevel = document.createElement('p'); // Amount to next level
    userNextLevel.id = 'bm-user-nextlevel';
    userNextLevel.textContent = 'Next level in...';
    containerUserInfo.appendChild(userNextLevel); // Adds the "amount to next level" field to the user info container

    const containerAutomation = document.createElement('div'); // Automated stuff container
    containerAutomation.id = 'bm-contain-automation';

    // Stealth Mode checkbox
    containerAutomation.appendChild(this.createInputCheckbox(
      'Stealth',
      'bm-input-stealth',
      true
    ));
    
    // Adds the help icon for stealth mode
    containerAutomation.appendChild(this.createQuestionBox(
      'bm-help-stealth',
      'Help: Waits for the website to make requests, instead of sending requests.',
      outputStatusId
    ));

    containerAutomation.appendChild(document.createElement('br')); // Line break

    // Possessed Mode checkbox
    containerAutomation.appendChild(this.createInputCheckbox(
      'Possessed',
      'bm-input-possessed',
      true
    ));

    // Adds the help icon for possessed mode
    containerAutomation.appendChild(this.createQuestionBox(
      'bm-help-possessed',
      'Help: Controls the website as if it were possessed.',
      outputStatusId
    ));

    containerAutomation.appendChild(document.createElement('br')); // Line break

    // Panic mode checkbox
    containerAutomation.appendChild(this.createInputCheckbox(
      'Panic',
      'bm-input-panic'
    ));

    // Adds the help icon for panic mode
    containerAutomation.appendChild(this.createQuestionBox(
      'bm-help-panic',
      'Help: Stops placing for a while if it detects a user nearby.',
      outputStatusId
    ));

    containerAutomation.appendChild(document.createElement('br')); // Line break

    const containerAutomationCoords = document.createElement('div'); // Coords container
    containerAutomationCoords.id = 'bm-contain-coords';

    const buttonCoords = document.createElement('button');
    buttonCoords.id = 'bm-button-coords';
    buttonCoords.className = 'bm-help';
    buttonCoords.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>';
    buttonCoords.onclick = () => {
      //this.updateInnerHTML(outputId, tooltip); // Update output element text with tooltip on click
    }
    containerAutomationCoords.appendChild(buttonCoords); // Adds the coordinate button to the automation container

    // Tile (x,y) and Pixel (x,y) input fields
    containerAutomationCoords.appendChild(this.createInputText('bm-input-tx', 'Tile X'));
    containerAutomationCoords.appendChild(this.createInputText('bm-input-ty', 'Tile Y'));
    containerAutomationCoords.appendChild(this.createInputText('bm-input-px', 'Pixel X'));
    containerAutomationCoords.appendChild(this.createInputText('bm-input-py', 'Pixel Y'));

    containerAutomation.appendChild(containerAutomationCoords); // Adds coord container to automation container

    containerAutomation.appendChild(document.createElement('br')); // Line break

    const outputStatus = document.createElement('textarea'); // Outputs bot status
    outputStatus.id = outputStatusId;
    outputStatus.readOnly = true; // Read-only input field
    outputStatus.placeholder = `Status: Sleeping...\nVersion: ${this.version}`; // Default text value
    containerAutomation.appendChild(outputStatus);

    // Construction of the overlay element
    overlay.appendChild(containerOverlayHeader); // Adds the overlay header container to the overlay
    overlay.appendChild(document.createElement('hr')); // Adds a horizontal line to the overlay
    overlay.appendChild(containerUserInfo); // Adds the user info container to the overlay
    overlay.appendChild(document.createElement('hr')); // Adds a horizontal line to the overlay
    overlay.appendChild(containerAutomation); // Adds the automation stuff container to the overlay
    document.body.appendChild(overlay); // Adds the overlay to the body of the webpage

    this.handleDrag(overlay, barDrag); // Starts handling the drag functionality
  }

  /** Updates the inner HTML of the element.
   * The element is discovered by it's id.
   * If the element is an <input>, it will modify the value attribute instead.
   * @param {string} id - The ID of the element to change
   * @param {string} html - The HTML/text to update with
   * @param {boolean} [doSafe] - (Optional) Should `textContent` be used instead of `innerHTML` to avoid XSS? False by default
   * @since 0.24.2
   */
  updateInnerHTML(id, html, doSafe=false) {

    const element = document.getElementById(id); // Retrieve the element
    if (!element) {return;} // Kills itself if the element does not exist

    // Input elements don't have innerHTML, so we modify the value attribute instead
    if (element instanceof HTMLInputElement) {
      element.value = html;
      return;
    } 

    if (doSafe) {
      element.textContent = html; // Populate element with plain-text HTML/text
    } else {
      element.innerHTML = html; // Populate element with HTML/text
    }
  }

  /** Creates a help icon.
   * When clicked, it will populate the text content of the outputId element with the tooltip.
   * On hover, it will generate a tooltip.
   * @param {string} id - ID of the help icon
   * @param {string} tooltip - Flavor message
   * @param {string} outputId - ID of the element to populate the text content with
   * @returns {HTMLButtonElement} HTML Button Element
   * @since 0.25.5
   */
  createQuestionBox(id, tooltip, outputId) {
    const questionBox = document.createElement('button');
    questionBox.id = id;
    questionBox.className = 'bm-help';
    questionBox.textContent = '?';
    questionBox.title = tooltip; // Tooltip on hover
    questionBox.onclick = () => {
      this.updateInnerHTML(outputId, tooltip); // Update output element text with tooltip on click
    }
    return questionBox;
  }

  /** Creates a text input field
   * @param {string} inputId - The ID for the text input
   * @param {string} [placeholder] - (Optional) The placeholder text of the input
   * @param {string} [text] - (Optional) The text content of the input
   * @param {boolean} [isReadOnly] - (Optional) Should the input be readOnly? False by default
   * @returns {HTMLInputElement} HTML Input Element
   * @since 0.30.3
   */
  createInputText(inputId, placeholder='', text='', isReadOnly=false) {
    const input = document.createElement('input');
    input.id = inputId;
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = text;
    input.readOnly = isReadOnly;
    return input;
  }

  /** Creates the checkbox input
   * @param {string} labelText - The text for the label
   * @param {string} checkboxId - The ID for the checkbox input
   * @param {boolean} [checkboxDefault] - (Optional) The default status of the checkbox (true = checked). False by default.
   * @returns {HTMLLabelElement} HTML Label Element with Input child
   * @since 0.27.1
   */
  createInputCheckbox(labelText, checkboxId, checkboxDefault=false) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = checkboxId;
    input.checked = checkboxDefault;
    label.prepend(input); // Adds the input as the first child of the label (before the text)
    return label;
  }

  /** Handles dragging of the overlay.
   * @param {HTMLElement} overlay - The overlay element to be moved.
   * @param {HTMLElement} barDrag - The element that acts as the drag handle.
   * @since 0.8.2
  */
  handleDrag(overlay, barDrag) {
    let isDragging = false;
    let offsetX, offsetY = 0;

    // What to do when the mouse is pressed down on the barDrag
    barDrag.addEventListener('mousedown', function(event) {
      isDragging = true;
      offsetX = event.clientX - overlay.getBoundingClientRect().left;
      offsetY = event.clientY - overlay.getBoundingClientRect().top;
      document.body.style.userSelect = 'none'; // Prevents text selection while dragging
      barDrag.classList.add('dragging'); // Adds a class to indicate a dragging state
    });

    // What to do when the touch starts on the barDrag
    barDrag.addEventListener('touchstart', function(event) {
      isDragging = true;
      const touch = event?.touches?.[0];
      if (!touch) {return;}
      offsetX = touch.clientX - overlay.getBoundingClientRect().left; // Distance between the left edge of the overlay, and the cursor
      offsetY = touch.clientY - overlay.getBoundingClientRect().top; // Distance between the top edge of the overlay, and the cursor
      document.body.style.userSelect = 'none'; // Prevents text selection while dragging
      barDrag.classList.add('dragging'); // Adds a class to indicate a dragging state
    }, { passive: false }); // Prevents scrolling from being captured

    // What to do when the mouse is moved while dragging
    document.addEventListener('mousemove', function(event) {
      if (isDragging) {
        overlay.style.left = (event.clientX - offsetX) + 'px'; // Binds the overlay to the left side of the screen, and sets it's position to the cursor
        overlay.style.top = (event.clientY - offsetY) + 'px'; // Binds the overlay to the top of the screen, and sets it's position to the cursor
        overlay.style.right = ''; // Destroys the right property to unbind the overlay from the right side of the screen
      }
    });

    // What to do when the touch moves while dragging
    document.addEventListener('touchmove', function(event) {
      if (isDragging) {
        const touch = event?.touches?.[0];
        if (!touch) {return;}
        overlay.style.left = (touch.clientX - offsetX) + 'px';
        overlay.style.top = (touch.clientY - offsetY) + 'px';
        event.preventDefault(); // prevent scrolling while dragging
      }
    }, { passive: false }); // Prevents scrolling from being captured

    // What to do when the mouse is released
    document.addEventListener('mouseup', function() {
      isDragging = false;
      document.body.style.userSelect = ''; // Restores text selection capability after dragging
      barDrag.classList.remove('dragging'); // Removes the dragging class
    });

    // What to do when the touch ends
    document.addEventListener('touchend', function() {
      isDragging = false;
      document.body.style.userSelect = ''; // Restores text selection capability after dragging
      barDrag.classList.remove('dragging'); // Removes the dragging class
    });

    // What to do when the touch is cancelled
    document.addEventListener('touchcancel', function() {
      isDragging = false;
      document.body.style.userSelect = ''; // Restores text selection capability after dragging
      barDrag.classList.remove('dragging'); // Removes the dragging class
    });
  }
}