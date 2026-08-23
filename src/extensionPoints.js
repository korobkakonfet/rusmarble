/** @file Extension points: the seams where an alternate build can extend this one.
 *
 * Mainline owns a small, stable set of named hooks and calls them at fixed sites. This module
 * binds every one of them to a no-op, so the normal build behaves exactly as if the hooks were
 * not there and the bundler drops them. A build that wants to extend the script points
 * EXTENSIONS_MODULE at its own module (see build/build.js), which supplies real implementations
 * for the hooks it cares about and inherits the no-ops for the rest.
 *
 * The point is that extending the script does not mean editing this file's callers. Previously
 * an alternate build was a large git patch applied over src/ at build time; every hunk anchored
 * on context lines in the busiest files, so ordinary edits here broke it constantly and the
 * extending code only existed as diff text rather than as editable source.
 *
 * Adding a seam means adding a hook here plus its call site, once. Every hook must stay optional
 * and side-effect-free in this file: behaviour with these no-ops must be identical to having no
 * hooks at all.
 *
 * @since 0.87.80
 */

/** Extra user-settings keys an extension needs present. Merged into the defaults on first run.
 * @returns {object}
 */
export const defaultUserSettings = () => ({});

/** Called once after user settings load, before the UI is built.
 * Lets an extension apply query-parameter overrides.
 * @param {{templateManager: object, searchParams: URLSearchParams}} _ctx
 */
export const onUserSettingsLoaded = (_ctx) => {};

/** Whether a private build still has controls left to add to the observed panel.
 * ANDed into observeBlack's hasObservedControls() readiness check, so the panel is not treated
 * as complete until any additions are in place.
 * @param {object} _main the hostContext
 * @returns {boolean} true when nothing further is pending
 */
export const hasPanelControls = (_main) => true;

/** Called from observeBlack each time the observed panel is (re)synced, after the mainline
 * controls are in place. Lets a private build extend the same panel.
 *
 * `requeue` re-runs the sync later, and the anchor-retry accessors exist because the mainline
 * sync uses a bounded retry counter that an extension may also need to consume.
 * @param {{
 *   black: Element,
 *   requeue: () => void,
 *   getAnchorRetries: () => number,
 *   setAnchorRetries: (value: number) => void,
 *   main: object,
 * }} _ctx
 */
export const onPanelSync = (_ctx) => {};

/** Called from stopObserveBlack when the observed panel goes away, so any state tied to it can
 * be dropped.
 */
export const onPanelClosed = () => {};

/** Opens the "nearby templates" popup. apiManager owns the pixel-info DOM but not the template
 * data, so it calls back through here. No-op (and reports unhandled) in the public build.
 * @param {Element} _anchor
 * @param {number[]} _coords
 * @returns {boolean} whether an extension handled it
 */
export const openNearbyTemplates = (_anchor, _coords) => false;

/** Extra `bmControl` action kinds an extension understands.
 * `parse` turns a raw console action descriptor into a normalized action (or null to decline);
 * `execute` runs one it produced. Both are consulted only after mainline's own kinds miss.
 * @type {{parse: (info: object, ctx: object) => object|null, execute: (action: object, ctx: object) => Promise<any>|any}}
 */
export const controlActions = {
  parse: () => null,
  execute: () => { throw new Error('Unsupported RusMarble control action.'); },
};

/** Called once at the very end of overlay construction, for any final page-level wiring.
 * @param {{templateManager: object}} _ctx
 */
export const onOverlayReady = (_ctx) => {};

/** Called after the layout language is applied, so extensions can relabel their own UI.
 * @param {{language: string, host: object}} _ctx
 */
export const onLanguageChanged = (_ctx) => {};

/** Called at the start of every template-list rebuild, before the list is repopulated.
 * @param {{progressSnapshot: object|null, host: object}} _ctx
 */
export const onTemplateListBuild = (_ctx) => {};

/** Called once a template has been created, with the resulting Template instance.
 * @param {{template: object, host: object}} _ctx
 */
export const onTemplateCreated = (_ctx) => {};

/** Called just before the settings section is built, so extensions can contribute controls.
 * @param {{host: object}} _ctx
 */
export const onSettingsSectionBuild = (_ctx) => {};

/** Called once the map instance exists.
 * @param {{host: object}} _ctx
 */
export const onMapReady = (_ctx) => {};

/** True when an alternate implementation of this module is bundled. Lets mainline skip work
 * that only matters when extensions are present.
 */
export const hasExtensions = false;
