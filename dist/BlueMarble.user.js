// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.11.0
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

(()=>{var l=class{constructor(){}create(){let e=document.createElement("div");e.id="bm-overlay",e.style.top="10px",e.style.right="75px";let t=document.createElement("div");t.id="bm-bar-drag";let n=document.createElement("img");n.src="https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png",n.alt="Blue Marble Icon";let s=document.createElement("h1");s.textContent="Blue Marble",e.appendChild(t),e.appendChild(n),e.appendChild(s),e.appendChild(document.createElement("hr")),document.body.appendChild(e),this.handleDrag(e,t)}handleDrag(e,t){let n=!1,s,d=0;t.addEventListener("mousedown",function(c){n=!0,s=c.clientX-e.getBoundingClientRect().left,d=c.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right="",t.classList.add("dragging")}),t.addEventListener("touchstart",function(c){n=!0;let o=c?.touches?.[0];o&&(s=o.clientX-e.getBoundingClientRect().left,d=o.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right="",t.classList.add("dragging"))},{passive:!1}),document.addEventListener("mousemove",function(c){n&&(e.style.left=c.clientX-s+"px",e.style.top=c.clientY-d+"px")}),document.addEventListener("touchmove",function(c){if(n){let o=c?.touches?.[0];if(!o)return;e.style.left=o.clientX-s+"px",e.style.top=o.clientY-d+"px",c.preventDefault()}},{passive:!1}),document.addEventListener("mouseup",function(){n=!1,document.body.style.userSelect="",t.classList.remove("dragging")}),document.addEventListener("touchend",function(){n=!1,document.body.style.userSelect="",t.classList.remove("dragging")}),document.addEventListener("touchcancel",function(){n=!1,document.body.style.userSelect="",t.classList.remove("dragging")})}};var i=GM_getResourceText("CSS-Overlay");GM_addStyle(i);console.log("Blue Marble script has loaded.");var u=new l;u.create();})();
