/**
 * primedl — components/defaults.js
 * Default values written to chrome.storage.local on first run.
 * All keys are written only if not already present (non-destructive).
 */
const defaults = {
	// Detection prefs
	disablePref: false,
	subtitlePref: false,
	filePref: true,
	downloadDirectPref: false,
	autoDownloadPref: false,
	fileSizePref: false,
	fileSizeAmount: "1",
	manifestPref: false,

	// Copy/command prefs
	copyMethod: "url",
	userCommand1: "",
	userCommand2: "",
	userCommand3: "",
	regexCommandPref: false,
	regexCommand: "",
	regexReplace: "",

	// Custom detection
	customExtPref: false,
	customExtEntries: [],
	customCtPref: false,
	customCtEntries: [],

	// Header/output prefs
	headersPref: true,
	titlePref: true,
	filenamePref: false,
	timestampPref: false,
	fileExtension: "ts",

	// Tool-specific
	streamlinkOutput: "file",
	downloaderPref: false,
	downloaderCommand: "",
	multithreadPref: true,
	multithreadAmount: "4",
	proxyPref: false,
	proxyCommand: "",
	customCommandPref: false,
	customCommand: "",

	// Filter/blacklist
	blacklistPref: false,
	blacklistEntries: [],

	// Session
	noRestorePref: false,
	recentPref: false,
	recentAmount: "5",

	// Notifications
	notifDetectPref: true,
	notifPref: false,

	// UI state
	tabThis: true,

	// primedl relay settings
	primedlRelayEnabled: true,
	primedlRelayPort: 7421,

	// Cookie export
	cookieExportFormat: "netscape",

	// ─── UI Theme ─────────────────────────────────────────────────────────
	// Pluggable theme key. Corresponds to the CSS [data-theme] selector.
	// Valid values: "default" | "terminal" | "clean-card" | "compact" |
	//               "dashboard" | "brutalist"
	// New themes can be added without changing this file — just ensure
	// theme.js and the CSS files are updated accordingly.
	uiTheme: "terminal",

	// Internal — managed by background.js
	urlStorageRestore: [],
	urlStorage: []
};

export default defaults;
