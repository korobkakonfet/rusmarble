// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.8.0
// @description  A userscript to automate and/or enhance the user experience on Wplace.live. Make sure to comply with the site's Terms of Service, and rules! This script is not affiliated with Wplace.live in any way, use at your own risk. This script is not affiliated with TamperMonkey. The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script. This script is provided "as is" under the MPL-2.0 license. The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication. The image is owned by NASA.
// @author       SwingTheVine
// @license      MPL-2.0
// @supportURL   https://discord.gg/tpeBPy46hf
// @homepageURL  https://github.com/SwingTheVine/Wplace-BlueMarble
// @icon         https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png
// @updateURL    https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @downloadURL  https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @match        *://*.wplace.live/*
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @resource     CSS-Overlay https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/overlay.css
// ==/UserScript==

// Wplace  --> https://wplace.live
// License --> https://www.mozilla.org/en-US/MPL/2.0/

(()=>{var a=class{constructor(){}create(){let e=document.createElement("div");e.id="bm-overlay";let r=document.createElement("div");r.id="bm-bar-pan";let t=document.createElement("h1"),n=document.createElement("img");n.src="https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png",n.alt="Blue Marble Icon",t.appendChild(n),t.append("Blue Marble"),e.appendChild(r),e.appendChild(t),document.body.appendChild(e)}};var c=GM_getResourceText("CSS-Overlay");GM_addStyle(c);console.log("Blue Marble script has loaded.");var o=new a;o.create();})();
