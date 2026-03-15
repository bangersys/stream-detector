/**
 * primedl — fouc.js
 *
 * Flash-of-unstyled-content prevention. Reads the cached theme key from
 * localStorage and applies it as a data-theme attribute on <html> before
 * any CSS is painted, eliminating the brief flash of the default palette.
 *
 * MUST be a separate static file — Chrome MV3's CSP blocks ALL inline
 * <script> tags regardless of content or intent. Loading as an external
 * <script src="fouc.js"> (no defer, no async, no type="module") is the
 * only CSP-compliant way to run synchronous code this early in <head>.
 *
 * This file must NOT be bundled as an ES module entry point. It is copied
 * verbatim by build.ts via STATIC_FILES and referenced from popup.html,
 * sidebar.html, and options.html as the very first script in <head>.
 *
 * Do not add imports, exports, or any async code here.
 */
try {
	const theme = localStorage.getItem("pd-theme") || "terminal";
	document.documentElement.dataset.theme = theme;
} catch (_) {
	// localStorage may be unavailable in some sandboxed contexts — not fatal.
	// theme.js will apply the correct theme from chrome.storage after load.
}
