# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Always build with `npm run build` (production). Never use `build:dev` unless explicitly asked.**

```bash
npm run build          # Production build (minified, CSS mangled, console dropped)
npm run build:dev      # Development build (no obfuscation, no console removal)
npm run build:prod     # Explicit production build
npm run patch          # Bump patch version in package.json + README, then build
npm run build:wasm     # Compile .wat WASM sources to .wasm binaries
npm run test:png       # Test template PNG processing
npm run benchmark      # Run benchmarks
```

## Architecture

This is a **Tampermonkey/Greasemonkey userscript** for [wplace.live](https://wplace.live). The build pipeline is entirely custom (no Webpack/Vite):

1. `build/compile-wasm.js` — compiles `.wat` → `.wasm` binary assets under `src/`
2. `build/update-version.js` — syncs `package.json` version into `src/RusMarble.meta.js`
3. `esbuild` bundles `src/main.js` (entry point) + all `.css` files into `dist/`
4. `terser` minifies/obfuscates the bundled JS
5. `build/cssMangler.js` renames `bm-` prefixed CSS selectors to short names, using a stable map at `dist/RusMarble.user.css.map.json`
6. The `src/RusMarble.meta.js` banner is prepended to the final `dist/RusMarble.user.js`

Build-time constants injected via `esbuild`'s `define`:
- `__CSS_BM_FILE__` — URL to CSS file (local dev vs. GitHub raw)
- `__TEMPLATE_SYNC_BASE_URL__` — backend URL (`https://wplace.zaebal.me` in prod)
- `__CHAT_WS_URL__` — WebSocket URL for chat
- `__INLINE_CSS__` — the compiled CSS string inlined into the JS bundle

### Key source modules

| File | Role |
|------|------|
| `src/main.js` | Entry point; wires everything together; ~9000 lines |
| `src/Overlay.js` | Main UI overlay on the map |
| `src/apiManager.js` | Wplace API calls (place pixel, get canvas state) |
| `src/templateManager.js` | Load/manage overlay templates |
| `src/templateSync.js` | Remote template sync with the backend |
| `src/templateCreationUi.js` | UI for creating templates from images |
| `src/archiveTemplateUi.js` | UI for archiving/restoring templates |
| `src/mapComments.js` | Map annotation/comment overlay |
| `src/userSettings.js` | Persistent user settings (via `GM.getValue`/`GM.setValue`) |
| `src/utilsMaptiler.js` | MapTiler map interaction helpers |
| `src/utils.js` | General utilities |
| `src/layoutI18n.js` | UI localization strings |
| `src/Template.js` | Template data model and palette conversion |
| `src/templateChunkUtils.js` | Chunk-based template diffing/pixel finding |
| `src/templateNearestWasm.js` | WASM-accelerated nearest-pixel search |
| `src/templatePaletteWasm.js` | WASM-accelerated palette conversion |
| `src/templateSampleExtractWasm.js` | WASM-accelerated image sampling |
| `src/polyfill.js` | Browser polyfills |
| `src/bookmarklet.js` | Standalone bookmarklet variant (built separately) |

### CSS class naming

All custom CSS classes use the `bm-` prefix (e.g. `bm-overlay`, `bm-panel`). The CSS mangler renames these to short hashes in production builds. The mapping is persisted in `dist/RusMarble.user.css.map.json` so selector names stay stable across local incremental builds. GitHub CI builds regenerate the map from scratch.

### Version bumping

`npm run patch` calls `npm version patch` (updates `package.json`), increments a patch counter badge in `docs/README.md`, then runs a full build. Do not manually edit the version in `src/RusMarble.meta.js` — `build/update-version.js` syncs it from `package.json` automatically on every build.

### Dev vs. production differences

In `--dev` mode: no terser obfuscation, `console.*` calls preserved, CSS points to `localhost:8000`, template sync points to `localhost:8003`. In production: console dropped, dead code removed, all URLs point to remote servers.
