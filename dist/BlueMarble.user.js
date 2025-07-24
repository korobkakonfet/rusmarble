// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.11.34
// @description  A userscript to automate and/or enhance the user experience on Wplace.live. Make sure to comply with the site's Terms of Service, and rules! This script is not affiliated with Wplace.live in any way, use at your own risk. This script is not affiliated with TamperMonkey. The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script. This script is provided "as is" under the MPL-2.0 license. The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication. The image is owned by NASA.
// @author       SwingTheVine
// @license      MPL-2.0
// @supportURL   https://discord.gg/tpeBPy46hf
// @homepageURL  https://github.com/SwingTheVine/Wplace-BlueMarble
// @icon         https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png
// @updateURL    https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @downloadURL  https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/BlueMarble.user.js
// @run-at       document-start
// @match        *://*.wplace.live/*
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @resource     CSS-Overlay https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/overlay.css
// ==/UserScript==

// Wplace  --> https://wplace.live
// License --> https://www.mozilla.org/en-US/MPL/2.0/

(()=>{var a=class{constructor(){}create(){let e=document.createElement("div");e.id="bm-overlay",e.style.top="10px",e.style.right="75px";let t=document.createElement("div");t.id="bm-bar-drag";let o=document.createElement("img");o.src="https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/src/assets/Favicon.png",o.alt="Blue Marble Icon";let c=document.createElement("h1");c.textContent="Blue Marble",e.appendChild(t),e.appendChild(o),e.appendChild(c),e.appendChild(document.createElement("hr")),document.body.appendChild(e),this.handleDrag(e,t)}handleDrag(e,t){let o=!1,c,s=0;t.addEventListener("mousedown",function(n){o=!0,c=n.clientX-e.getBoundingClientRect().left,s=n.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right="",t.classList.add("dragging")}),t.addEventListener("touchstart",function(n){o=!0;let i=n?.touches?.[0];i&&(c=i.clientX-e.getBoundingClientRect().left,s=i.clientY-e.getBoundingClientRect().top,document.body.style.userSelect="none",e.style.right="",t.classList.add("dragging"))},{passive:!1}),document.addEventListener("mousemove",function(n){o&&(e.style.left=n.clientX-c+"px",e.style.top=n.clientY-s+"px")}),document.addEventListener("touchmove",function(n){if(o){let i=n?.touches?.[0];if(!i)return;e.style.left=i.clientX-c+"px",e.style.top=i.clientY-s+"px",n.preventDefault()}},{passive:!1}),document.addEventListener("mouseup",function(){o=!1,document.body.style.userSelect="",t.classList.remove("dragging")}),document.addEventListener("touchend",function(){o=!1,document.body.style.userSelect="",t.classList.remove("dragging")}),document.addEventListener("touchcancel",function(){o=!1,document.body.style.userSelect="",t.classList.remove("dragging")})}};var d=class{constructor(){this.disableAll=!1}manageSpontaneousResponse(){window.addEventListener("message",e=>{let t=e.data;if(t&&t.source==="blue-marble")switch(t.endpoint){case"me":console.log(`${t.jsonData?.name} has ${t.jsonData?.droplets} droplets`),console.log(`Disable: ${t.jsonData?.name?.toString().toLowerCase()=="swingthevine"}`);break;case"robots":this.disableAll=t.jsonData?.userscript?.toString().toLowerCase()=="false"}})}};function r(l){let e=document.createElement("script");e.textContent=`(${l})();`,document.documentElement.appendChild(e),e.remove()}r(()=>{let l=window.fetch;window.fetch=async function(...e){let t=await l.apply(this,e),o=t.clone();if((o.headers.get("content-type")||"").includes("application/json")){let s=(e[0]instanceof Request?e[0]?.url:e[0])||"ignore";s=s.split("/").filter(Boolean).pop()||"ignore",console.log(`Sending JSON message about endpoint "${s}"`),o.json().then(n=>{console.log(`JSON: ${n}`),window.postMessage({source:"blue-marble",endpoint:s,jsonData:n},"*")}).catch(n=>{console.error("BM - Failed to parse JSON:",n)})}return t}});var u=GM_getResourceText("CSS-Overlay");GM_addStyle(u);var p=new a;p.create();var m=new d;m.manageSpontaneousResponse();console.log("Blue Marble userscript has loaded!");})();
