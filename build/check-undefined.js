/** Static check for identifiers that are used but never declared or imported.
 *
 * esbuild bundles happily past an undefined identifier — it becomes a runtime ReferenceError.
 * In this codebase those surface as swallowed catches (templates silently "disappearing"), so a
 * clean build proves very little. This walks each module's scopes and reports free variables
 * that are not imports, not declarations, and not known globals.
 *
 * Run: node build/check-undefined.js
 */
import fs from 'fs';
import path from 'path';
import * as acorn from 'acorn';
import { fileURLToPath } from 'url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const GLOBALS = new Set([
  'globalThis','window','document','navigator','location','history','console','fetch','Blob','File','FileReader',
  'URL','URLSearchParams','Headers','Request','Response','FormData','AbortController','WebSocket','Worker',
  'OffscreenCanvas','ImageData','ImageBitmap','createImageBitmap','Image','Audio','Path2D','DOMParser','XMLSerializer',
  'CompressionStream','DecompressionStream','TextEncoder','TextDecoder','indexedDB','IDBKeyRange','crypto','performance',
  'setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame',
  'queueMicrotask','requestIdleCallback','structuredClone','atob','btoa','alert','confirm','prompt','matchMedia',
  'Object','Array','String','Number','Boolean','Symbol','BigInt','Math','JSON','Date','RegExp','Error','TypeError',
  'RangeError','ReferenceError','SyntaxError','EvalError','URIError','AggregateError','Promise','Proxy','Reflect',
  'Map','Set','WeakMap','WeakSet','WeakRef','FinalizationRegistry','ArrayBuffer','SharedArrayBuffer','DataView',
  'Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array',
  'Float32Array','Float64Array','BigInt64Array','BigUint64Array','Intl','isNaN','isFinite','parseInt','parseFloat',
  'encodeURI','decodeURI','encodeURIComponent','decodeURIComponent','undefined','NaN','Infinity','eval','self',
  'localStorage','sessionStorage','BroadcastChannel','MessageChannel','MessagePort','WebAssembly','Buffer',
  'HTMLInputElement','HTMLImageElement','HTMLButtonElement','HTMLLabelElement','HTMLSelectElement',
  'HTMLTextAreaElement','HTMLAnchorElement','HTMLDivElement','DOMMatrix','WheelEvent','PointerEvent',
  'MouseEvent','KeyboardEvent','TouchEvent','DragEvent','__TEMPLATE_PIXEL_WORKER_SOURCE__',
  'CustomEvent','Event','EventTarget','MutationObserver','ResizeObserver','IntersectionObserver','Node','Element',
  'HTMLElement','HTMLCanvasElement','CanvasRenderingContext2D','getComputedStyle','DOMRect','Range','Text',
  // userscript + build-time injected
  'GM','GM_info','GM_xmlhttpRequest','GM_addStyle','unsafeWindow','module','require','process','__dirname',
  '__CSS_BM_FILE__','__TEMPLATE_SYNC_BASE_URL__','__CHAT_WS_URL__','__INLINE_CSS__',
]);

let failures = 0;

/** src/*.js plus src/exp/*.js (the private experimental modules), when present. */
const collectSources = () => {
  const files = fs.readdirSync(SRC)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.orig'))
    .map((f) => path.join(SRC, f));
  const expDir = path.join(SRC, 'exp');
  if (fs.existsSync(expDir)) {
    for (const f of fs.readdirSync(expDir)) {
      if (f.endsWith('.js')) files.push(path.join(expDir, f));
    }
  }
  return files;
};

for (const full of collectSources()) {
  const file = path.relative(SRC, full);
  const code = fs.readFileSync(full, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (error) {
    console.log(`PARSE FAIL ${file}: ${error.message}`);
    failures++;
    continue;
  }

  // Collect every declared/bound name anywhere in the module. This is deliberately flat rather
  // than scope-exact: it cannot produce false positives from shadowing, and it still catches the
  // case that actually bit us — a name referenced but declared nowhere at all.
  const declared = new Set();
  const used = new Map();

  const walk = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier': case 'ImportSpecifier':
        declared.add(node.local.name); break;
      case 'VariableDeclarator': case 'FunctionDeclaration': case 'ClassDeclaration':
      case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassExpression':
        break;
      default: break;
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' ||
         node.type === 'FunctionExpression' || node.type === 'ClassExpression') && node.id) {
      declared.add(node.id.name);
    }
    if (node.type === 'Identifier' && parent) {
      const isDeclSite =
        (parent.type === 'VariableDeclarator' && parent.id === node) ||
        (parent.type === 'Property' && parent.key === node && !parent.computed) ||
        (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
        (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed) ||
        (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) ||
        (parent.type === 'ExportSpecifier') || (parent.type === 'ImportSpecifier') ||
        (parent.type === 'LabeledStatement') || (parent.type === 'BreakStatement') ||
        (parent.type === 'ContinueStatement');
      if (!isDeclSite && !used.has(node.name)) used.set(node.name, node.loc.start.line);
    }
    // params + patterns bind names
    if (Array.isArray(node.params)) {
      const bind = (p) => {
        if (!p) return;
        if (p.type === 'Identifier') declared.add(p.name);
        else if (p.type === 'AssignmentPattern') bind(p.left);
        else if (p.type === 'RestElement') bind(p.argument);
        else if (p.type === 'ObjectPattern') p.properties.forEach((q) => bind(q.value || q.argument));
        else if (p.type === 'ArrayPattern') p.elements.forEach(bind);
      };
      node.params.forEach(bind);
    }
    if (node.type === 'VariableDeclarator') {
      const bind = (p) => {
        if (!p) return;
        if (p.type === 'Identifier') declared.add(p.name);
        else if (p.type === 'AssignmentPattern') bind(p.left);
        else if (p.type === 'RestElement') bind(p.argument);
        else if (p.type === 'ObjectPattern') p.properties.forEach((q) => bind(q.value || q.argument));
        else if (p.type === 'ArrayPattern') p.elements.forEach(bind);
      };
      bind(node.id);
    }
    if (node.type === 'CatchClause' && node.param) {
      if (node.param.type === 'Identifier') declared.add(node.param.name);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach((c) => walk(c, node));
      else if (child && typeof child.type === 'string') walk(child, node);
    }
  };
  walk(ast, null);

  const missing = [...used.entries()].filter(([name]) => !declared.has(name) && !GLOBALS.has(name));
  if (missing.length) {
    failures += missing.length;
    console.log(`\n${file}:`);
    for (const [name, line] of missing) console.log(`  line ${line}: '${name}' is used but never declared or imported`);
  }
}

console.log(failures ? `\n${failures} undefined identifier(s).` : '\nNo undefined identifiers.');
process.exit(failures ? 1 : 0);
