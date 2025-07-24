// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.10.0
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

(()=>{var i=class{constructor(){}create(){let e=document.createElement("div");e.id="bm-overlay",e.style.top="10px",e.style.right="75px";let d=document.createElement("div");d.id="bm-bar-drag";let t=document.createElement("img");t.src="https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png",t.alt="Blue Marble Icon";let c=document.createElement("h1");c.textContent="Blue Marble",e.appendChild(d),e.appendChild(t),e.appendChild(c),e.appendChild(document.createElement("hr")),document.body.appendChild(e),this.handleDrag(e,d)}handleDrag(e,d){let t=!1,c,o=0;d.addEventListener("mousedown",function(n){t=!0,c=n.clientX-e.getBoundingClientRect().left,o=n.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right="",e.classList.add("dragging")}),d.addEventListener("touchstart",function(n){t=!0;let s=n?.touches?.[0];s&&(c=s.clientX-e.getBoundingClientRect().left,o=s.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right="",e.classList.add("dragging"))},{passive:!1}),document.addEventListener("mousemove",function(n){t&&(e.style.left=n.clientX-c+"px",e.style.top=n.clientY-o+"px")}),document.addEventListener("touchmove",function(n){if(t){let s=n?.touches?.[0];if(!s)return;e.style.left=s.clientX-c+"px",e.style.top=s.clientY-o+"px",n.preventDefault()}},{passive:!1}),document.addEventListener("mouseup",function(){t=!1,document.body.style.userSelect="",e.classList.remove("dragging")}),document.addEventListener("touchend",function(){t=!1,document.body.style.userSelect="",e.classList.remove("dragging")}),document.addEventListener("touchcancel",function(){t=!1,document.body.style.userSelect="",e.classList.remove("dragging")})}};var l=GM_getResourceText("CSS-Overlay");GM_addStyle(l);console.log("Blue Marble script has loaded.");var a=new i;a.create();})();
