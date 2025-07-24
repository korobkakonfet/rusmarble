// ==UserScript==
// @name         Blue Marble
// @namespace    https://github.com/SwingTheVine/
// @version      0.2.1
// @description  A userscript to automate and/or enhance the user experience on Wplace.live. Make sure to comply with the site's Terms of Service, and rules! This script is not affiliated with Wplace.live in any way, use at your own risk. This script is not affiliated with TamperMonkey. The author of this userscript is not responsible for any damages, issues, loss of data, or punishment that may occur as a result of using this script. This script is provided "as is" under the MPL-2.0 license. The "Blue Marble" icon is licensed under CC0 1.0 Universal (CC0 1.0) Public Domain Dedication. The image is owned by NASA.
// @author       SwingTheVine
// @license      MPL-2.0
// @supportURL   https://discord.gg/tpeBPy46hf
// @homepageURL  https://github.com/SwingTheVine/Wplace-BlueMarble
// @icon         https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/Favicon.png
// @updateURL    https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/BlueMarble.user.js
// @downloadURL  https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/BlueMarble.user.js
// @match        *://*.wplace.live/*
// @link         https://wplace.live
// @link         https://www.mozilla.org/en-US/MPL/2.0/
// ==/UserScript==

(()=>{var t=class{constructor(e){this.text=e,this.element=null}create(){let e=document.createElement("div");e.textContent=this.text,Object.assign(e.style,{position:"fixed",top:"10px",right:"10px",backgroundColor:"rgba(0,0,0,0.7)",color:"white",padding:"10px",borderRadius:"8px",zIndex:"9999",fontFamily:"sans-serif"}),document.body.appendChild(e),this.element=e}updateText(e){this.element&&(this.element.textContent=e)}};console.log("Blue Marble script has loaded.");var o=new t("Blue Marble");o.create();setTimeout(()=>{o.updateText("Updated text")},5e3);})();
