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

	// Internal — managed by background.js
	urlStorageRestore: [],
	urlStorage: [],
};

export default defaults;