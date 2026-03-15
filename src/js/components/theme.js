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
 *   - Create src/css/themes/<name>.css with [data-theme="<name>"] overrides
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
			<span class="pd-compact-pill" id="pd-compact-streams">0</span>
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
			const rows = tbody.querySelectorAll("tr.urlEntry").length;
			compactStreamCount = rows;
			updateCompactCounts();
		});
		countObs.observe(tbody, { childList: true, subtree: false });
	}
}

/** Called by the cookie section when count updates — also called from here. */
function updateCompactCounts() {
	const streamsEl = document.getElementById("pd-compact-streams");
	const cookiesEl = document.getElementById("pd-compact-cookies");
	if (streamsEl) streamsEl.textContent = `${compactStreamCount} streams`;
	if (cookiesEl) cookiesEl.textContent = `${compactCookieCount} 🍪`;
}

/**
 * Update the compact header cookie count from outside (called by popup.js
 * cookie logic via a simple DOM event — no tight coupling).
 */
function syncCompactCookieCount(count) {
	compactCookieCount = count;
	updateCompactCounts();
}

// ─── Dashboard theme: always-open cookie panel + flag badges ─────────────

function initDashboard() {
	// Force the cookie panel open immediately
	const panel = document.getElementById("cookiePanel");
	const icon = document.getElementById("cookieToggleIcon");
	const btn = document.getElementById("cookieToggle");

	if (panel) panel.hidden = false;
	if (icon) icon.textContent = "▼";
	if (btn) btn.setAttribute("aria-expanded", "true");

	// Fire the existing cookie toggle logic once to load cookie data
	// (re-dispatch a click on the toggle which triggers loadCookieSection)
	// We do this with a tiny delay so popup.js finishes its own init first
	setTimeout(() => {
		// If the panel was already opened by popup.js, this is a no-op
		// If not, trigger it so cookie data loads
		if (!panel?.hidden) return;
		btn?.click();
	}, 50);

	// Set up MutationObserver to stamp flag badges on cookie table rows
	// The cookie panel content is populated by popup.js after the panel opens
	const cookiePanel = document.getElementById("cookiePanel");
	if (cookiePanel) {
		const flagObs = new MutationObserver(() => {
			stampCookieFlagBadges();
		});
		flagObs.observe(cookiePanel, { childList: true, subtree: true });
	}
}

/**
 * Stamp httpOnly / secure badges on cookie display rows.
 * Looks for elements that contain cookie data rendered by popup.js.
 * Non-destructive: skips rows that already have badges.
 */
function stampCookieFlagBadges() {
	// Cookie data is stored in urlList entries — the panel shows formatted text.
	// We scan for known text patterns in the panel's rendered content.
	// Since the cookie panel shows raw text (netscape/json/header format),
	// badge injection applies to the cookie TABLE if one is ever rendered,
	// or to individual cookie rows. Currently popup.js shows a textarea-like view,
	// so this is a progressive enhancement — badges appear when cookie rows exist.
	const rows = document.querySelectorAll("#cookiePanel tr");
	rows.forEach((row) => {
		if (row.dataset.flagged) return;
		row.dataset.flagged = "1";
		const text = row.textContent;
		const nameCell = row.querySelector("td:first-child");
		if (!nameCell) return;

		// Check for httpOnly and secure indicators in the row data
		// (These would come from the serialized cookie data)
		const isSecure =
			text.includes("TRUE") && row.cells.length >= 4 && row.cells[3]?.textContent === "TRUE";
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

		// Re-run layout-specific inits if switching to/from a layout theme
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

// ─── Exported helpers (for use by options.js if needed) ───────────────────

export { applyTheme, syncCompactCookieCount };
