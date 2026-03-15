/**
 * primedl — components/theme.js
 *
 * Pluggable theme system. Side-effect import: importing this module activates
 * the theme engine with zero additional function calls from popup.js.
 *
 * Responsibilities:
 *   1. Apply the saved uiTheme token (data-theme on <html>) immediately,
 *      using localStorage as a synchronous cache to prevent FOUC.
 *   2. Manage .pd-tab-active CSS classes on tab labels (cross-browser,
 *      no :has() dependency — works on Firefox 89+).
 *   3. Inject theme-specific DOM elements:
 *        compact  → #pd-compact-header (site + stream/cookie counts)
 *        dashboard → auto-expand cookie panel + flag badges on cookie items
 *   4. Observe DOM mutations to stamp data-stream-type on type cells and
 *      keep compact/dashboard counts live.
 *   5. Listen for chrome.storage changes so switching theme in Options
 *      instantly updates all open popups/sidebars without reload.
 *
 * Adding a new theme:
 *   - Create src/css/themes/<n>.css with [data-theme="<n>"] overrides
 *   - Add <link> for the CSS file in popup.html, sidebar.html
 *   - Add uiTheme option value + i18n key in options.html / messages.json
 *   - If the theme needs injected DOM, add a case in initThemeDOM() below
 *   - Zero other changes required anywhere
 */

import { getStorage } from "./storage.js";

// ─── Constants ────────────────────────────────────────────────────────────

const STORAGE_KEY = "uiTheme";
const LS_CACHE_KEY = "pd-theme"; // localStorage key for FOUC prevention
const DEFAULT_THEME = "default";

// Themes that need extra DOM injected after load
const LAYOUT_THEMES = new Set(["compact", "dashboard"]);

// ─── Core: read + apply theme ─────────────────────────────────────────────

/**
 * Read theme from chrome.storage, apply data-theme attribute,
 * and update the localStorage cache for next-open FOUC prevention.
 */
async function applyTheme() {
	const theme = (await getStorage(STORAGE_KEY)) || DEFAULT_THEME;
	setThemeAttribute(theme);
	try {
		localStorage.setItem(LS_CACHE_KEY, theme);
	} catch (_) {
		// localStorage blocked — not fatal
	}
	return theme;
}

/**
 * Write data-theme on <html> immediately. Called both from applyTheme()
 * and from the storage change listener for live switching.
 */
function setThemeAttribute(theme) {
	document.documentElement.dataset.theme = theme || DEFAULT_THEME;
}

// ─── Tab active class management (Firefox 89+ compat) ────────────────────

/**
 * Add/remove .pd-tab-active on .tab-label elements based on radio state.
 * Themes use .tab-label.pd-tab-active in CSS instead of :has(input:checked).
 */
function initTabActiveClasses() {
	const tabRow = document.querySelector(".tab-row");
	if (!tabRow) return;

	const updateActive = () => {
		tabRow.querySelectorAll(".tab-label").forEach((label) => {
			const radio = label.querySelector("input[type='radio']");
			label.classList.toggle("pd-tab-active", radio?.checked ?? false);
		});
	};

	tabRow.addEventListener("change", updateActive);
	updateActive(); // set initial state
}

// ─── Stream type attribute stamping ──────────────────────────────────────

/**
 * Set data-stream-type on the first <td> of every stream row.
 * CSS themes target this for color-coded type labels.
 * Uses MutationObserver so popup.js needs zero changes.
 */
function initStreamTypeObserver() {
	const tbody = document.getElementById("popupUrlList");
	if (!tbody) return;

	const stampRow = (row) => {
		if (row.nodeType !== 1 || row.tagName !== "TR") return;
		const firstCell = row.querySelector("td:first-child");
		if (firstCell && !firstCell.dataset.streamType && firstCell.textContent.trim()) {
			firstCell.dataset.streamType = firstCell.textContent.trim();
		}
	};

	// Stamp any rows already in the DOM
	tbody.querySelectorAll("tr").forEach(stampRow);

	// Watch for new rows inserted by createList()
	const obs = new MutationObserver((mutations) => {
		for (const m of mutations) {
			m.addedNodes.forEach(stampRow);
		}
	});

	obs.observe(tbody, { childList: true });
}

// ─── Compact theme: injected header ──────────────────────────────────────

let compactStreamCount = 0;
let compactCookieCount = 0;

function injectCompactHeader() {
	if (document.getElementById("pd-compact-header")) return;

	const container = document.getElementById("container");
	if (!container) return;

	const header = document.createElement("div");
	header.id = "pd-compact-header";
	header.innerHTML = `
		<span id="pd-compact-site">—</span>
		<span id="pd-compact-counts">
			<span class="pd-compact-pill" id="pd-compact-streams">0 streams</span>
			<span class="pd-compact-pill" id="pd-compact-cookies">0 🍪</span>
		</span>
	`;

	// Insert before first child of container (above the tab row)
	container.insertBefore(header, container.firstChild);

	// Read current tab hostname for the site label
	chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
		const url = tabs?.[0]?.url;
		if (url) {
			try {
				const host = new URL(url).hostname;
				const siteEl = document.getElementById("pd-compact-site");
				if (siteEl) siteEl.textContent = host || "—";
			} catch (_) {}
		}
	});

	// Watch tbody for row count changes
	const tbody = document.getElementById("popupUrlList");
	if (tbody) {
		const countObs = new MutationObserver(() => {
			compactStreamCount = tbody.querySelectorAll("tr.urlEntry").length;
			updateCompactCounts();
		});
		countObs.observe(tbody, { childList: true, subtree: false });
	}

	// ── FIX P0: listen for cookie count updates dispatched by popup.js ────
	// popup.js calls updateCookieCount() which dispatches pd:cookiecount.
	// We catch it here to keep the compact header pill in sync.
	document.addEventListener("pd:cookiecount", (e) => {
		compactCookieCount = e.detail ?? 0;
		updateCompactCounts();
	});
}

function updateCompactCounts() {
	const streamsEl = document.getElementById("pd-compact-streams");
	const cookiesEl = document.getElementById("pd-compact-cookies");
	if (streamsEl) streamsEl.textContent = `${compactStreamCount} streams`;
	if (cookiesEl) cookiesEl.textContent = `${compactCookieCount} 🍪`;
}

// ─── Dashboard theme: always-open cookie panel ───────────────────────────

/**
 * FIX P2 + P3: Use event-based init instead of a fragile 50ms setTimeout.
 *
 * popup.js dispatches "pd:popup-ready" (with window.__pdPopupReady = true)
 * at the very end of its DOMContentLoaded handler, after all event listeners
 * are wired. We listen for that event before clicking the toggle, which
 * ensures popup.js's toggleCookiePanel() runs and sets cookiePanelOpen = true
 * correctly — fixing the state desync identified in the QA report.
 *
 * The window.__pdPopupReady guard handles the edge case where chrome.storage
 * is slow and popup.js dispatches pd:popup-ready before initThemeDOM() runs.
 */
function initDashboard() {
	const open = () => {
		const panel = document.getElementById("cookiePanel");
		const btn = document.getElementById("cookieToggle");
		// Let popup.js own the state — trigger via click so cookiePanelOpen
		// is set correctly inside toggleCookiePanel()
		if (panel?.hidden) {
			btn?.click();
		}
		setupCookiePanelObserver();
	};

	// Guard: if popup.js already finished init before we got here, open now
	if (window.__pdPopupReady) {
		open();
	} else {
		document.addEventListener("pd:popup-ready", open, { once: true });
	}
}

/**
 * Set up a MutationObserver on the cookie panel for future badge stamping.
 *
 * NOTE: The cookie panel currently shows format/export controls only — it
 * does not render a table of individual cookies. stampCookieFlagBadges()
 * therefore finds zero <tr> elements and is a true no-op in the current UI.
 * The observer and CSS badge classes (pd-flag-httponly, pd-flag-secure) are
 * kept as forward scaffolding for when a cookie list view is added to the
 * dashboard layout. The httpOnly property is available in JSON format output
 * but cannot be parsed from the Netscape or header formats.
 */
function setupCookiePanelObserver() {
	const cookiePanel = document.getElementById("cookiePanel");
	if (!cookiePanel) return;

	const flagObs = new MutationObserver(() => {
		stampCookieFlagBadges();
	});
	flagObs.observe(cookiePanel, { childList: true, subtree: true });
}

/**
 * Stamp secure badges on cookie table rows (forward scaffolding only).
 * Currently no-op: the cookie panel renders text/controls, not a <tr> table.
 * Will become active when a cookie list view is added to the dashboard layout.
 */
function stampCookieFlagBadges() {
	const rows = document.querySelectorAll("#cookiePanel tr");
	rows.forEach((row) => {
		if (row.dataset.flagged) return;
		row.dataset.flagged = "1";
		const nameCell = row.querySelector("td:first-child");
		if (!nameCell) return;

		// Secure flag: column index 3 in Netscape format is the "secure" boolean
		const isSecure = row.cells.length >= 4 && row.cells[3]?.textContent?.trim() === "TRUE";
		if (isSecure) {
			const badge = document.createElement("span");
			badge.className = "pd-flag-badge pd-flag-secure";
			badge.textContent = "secure";
			nameCell.appendChild(badge);
		}
	});
}

// ─── Storage change listener (live theme switching) ───────────────────────

function initStorageListener() {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes[STORAGE_KEY]) return;

		const newTheme = changes[STORAGE_KEY].newValue || DEFAULT_THEME;
		setThemeAttribute(newTheme);

		try {
			localStorage.setItem(LS_CACHE_KEY, newTheme);
		} catch (_) {}

		// Re-run layout-specific inits if switching to a layout theme
		if (LAYOUT_THEMES.has(newTheme)) {
			initThemeDOM(newTheme);
		}
	});
}

// ─── Per-theme DOM initialization ─────────────────────────────────────────

function initThemeDOM(theme) {
	switch (theme) {
		case "compact":
			injectCompactHeader();
			break;
		case "dashboard":
			initDashboard();
			break;
		default:
			break;
	}
}

// ─── Bootstrap: runs immediately on import ────────────────────────────────

(async () => {
	// Apply theme from storage (also sets localStorage cache)
	const theme = await applyTheme();

	// Wait for DOM to be ready before touching elements
	if (document.readyState === "loading") {
		await new Promise((resolve) =>
			document.addEventListener("DOMContentLoaded", resolve, { once: true })
		);
	}

	// Common inits for all themes
	initTabActiveClasses();
	initStreamTypeObserver();
	initStorageListener();

	// Layout-specific inits
	initThemeDOM(theme);
})();

// applyTheme exported for options.js; syncCompactCookieCount removed —
// compact cookie count is now driven by the pd:cookiecount DOM event.
export { applyTheme };
