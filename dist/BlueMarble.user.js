// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.8.5
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

(()=>{var c=class{constructor(){}create(){let e=document.createElement("div");e.id="bm-overlay",e.style.top="10px",e.style.right="75px";let n=document.createElement("div");n.id="bm-bar-pan";let t=document.createElement("img");t.src="https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png",t.alt="Blue Marble Icon";let o=document.createElement("h1");o.textContent="Blue Marble",e.appendChild(n),e.appendChild(t),e.appendChild(o),document.body.appendChild(e),this.handleDrag(e,n)}handleDrag(e,n){let t=!1,o,a=0;n.addEventListener("mousedown",function(l){t=!0,o=l.clientX-e.getBoundingClientRect().left,a=l.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right=""}),document.addEventListener("mousemove",function(l){t&&(e.style.left=l.clientX-o+"px",e.style.top=l.clientY-a+"px")}),document.addEventListener("mouseup",function(){t=!1,document.body.style.userSelect=""})}};var s=GM_getResourceText("CSS-Overlay");GM_addStyle(s);console.log("Blue Marble script has loaded.");var d=new c;d.create();})();
