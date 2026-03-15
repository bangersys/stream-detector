/**
 * primedl — options.js
 * Options page logic. Reads/writes all preferences via chrome.storage.local.
 *
 * Theme handling is largely automatic:
 *  - uiTheme <select class="option"> is saved by the existing saveOptionStorage handler
 *  - theme.js (imported below) applies the change live via storage.onChanged
 *  - applyI18n() handles data-i18n-opt attributes on theme <option> elements
 */

import { getAllStorage, getStorage, saveOptionStorage, setStorage } from "./components/storage.js";
// Theme system — applies data-theme and listens for live changes
import "./components/theme.js";

const _ = chrome.i18n.getMessage;

// ─── Regex validator ──────────────────────────────────────────────────────
const regexValidator = () => {
	const input = document.getElementById("regexCommand");
	const warning = document.getElementById("regexWarning");
	if (!input || !warning) return;
	try {
		new RegExp(input.value);
		warning.style.display = "none";
	} catch {
		warning.style.display = "unset";
	}
};

// ─── Restore all option values from storage ───────────────────────────────
const restoreOptions = async () => {
	const options = document.getElementsByClassName("option");
	for (const option of options) {
		if (option.id === "customCommand") {
			const prefName = `customCommand${document.getElementById("copyMethod").value}`;
			document.getElementById("customCommand").value = (await getStorage(prefName)) || "";
		} else if (option.id === "regexCommand") {
			document.getElementById("regexCommand").value = (await getStorage("regexCommand")) ?? "";
			regexValidator();
		} else if (option.tagName.toLowerCase() === "textarea") {
			const val = await getStorage(option.id);
			if (val !== null) {
				document.getElementById(option.id).value = val.join("\n");
			}
		} else {
			const val = await getStorage(option.id);
			if (val !== null) {
				const el = document.getElementById(option.id);
				if (el.type === "checkbox" || el.type === "radio") {
					el.checked = val;
				} else {
					el.value = val;
				}
			}
		}
	}
};

// ─── i18n: fill all labels, options, tooltips, buttons ───────────────────
const applyI18n = async () => {
	const labels = document.getElementsByTagName("label");
	for (const label of labels) {
		if (label.htmlFor === "versionTag") {
			const ver = await getStorage("version");
			label.textContent = `v${ver}. ${_("tipHint")}`;
		} else if (label.htmlFor) {
			const msg = _(label.htmlFor);
			if (msg) label.textContent = `${msg}:`;
		}
	}

	// Standard <option> elements (copy method, cookie format)
	const selectOptions = document.getElementsByTagName("option");
	for (const opt of selectOptions) {
		if (!opt.textContent) {
			const msg = _(opt.value);
			if (msg) opt.textContent = msg;
		}
	}

	// Theme <option> elements use data-i18n-opt attribute for their i18n keys
	// (their value is the theme id, not an i18n key, so standard lookup doesn't apply)
	const themeOptions = document.querySelectorAll("option[data-i18n-opt]");
	for (const opt of themeOptions) {
		const key = opt.dataset.i18nOpt;
		if (key) {
			const msg = _(key);
			if (msg) opt.textContent = msg;
		}
	}

	// Tooltip spans — hover title on parent element
	const spans = document.getElementsByTagName("span");
	for (const span of spans) {
		if (span.id) {
			const msg = _(span.id);
			if (msg) span.parentElement.title = msg;
		}
	}

	const buttons = document.getElementsByTagName("button");
	for (const btn of buttons) {
		if (btn.id) {
			const msg = _(btn.id);
			if (msg) btn.textContent = msg;
		}
	}
};

// ─── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
	const options = document.getElementsByClassName("option");

	// Wire up all option change handlers
	for (const option of options) {
		if (option.id === "regexCommand") {
			option.oninput = () => regexValidator();
		}
		if (option.type !== "button") {
			option.onchange = (e) => saveOptionStorage(e, document.getElementsByClassName("option"));
		}
	}

	// ── Export settings ────────────────────────────────────────────────────
	document.getElementById("exportButton")?.addEventListener("click", async () => {
		const allStorage = await getAllStorage();

		// Strip non-setting keys
		delete allStorage.urlStorage;
		delete allStorage.urlStorageRestore;
		delete allStorage.version;
		delete allStorage.newline;
		delete allStorage.filterInput;

		const blob = new Blob([JSON.stringify(allStorage, null, 2)], {
			type: "application/json"
		});
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `primedl-settings-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(a.href);
		a.remove();
	});

	// ── Import settings ────────────────────────────────────────────────────
	document.getElementById("importButton")?.addEventListener("click", () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json";

		input.onchange = () => {
			const reader = new FileReader();
			const [file] = input.files;

			reader.onload = () => {
				let parsed;
				try {
					parsed = JSON.parse(reader.result);
				} catch {
					window.alert(_("importButtonFailure"));
					input.remove();
					return;
				}
				setStorage(parsed);
				restoreOptions();
				chrome.runtime.sendMessage({ options: true });
				input.remove();
			};

			if (file) reader.readAsText(file);
		};

		input.click();
	});

	// ── Reset ──────────────────────────────────────────────────────────────
	document.getElementById("resetButton")?.addEventListener("click", () => {
		if (window.confirm(_("resetButtonConfirm"))) {
			chrome.runtime.sendMessage({ reset: true });
		}
	});

	// ── Relay port live update ────────────────────────────────────────────
	document.getElementById("primedlRelayPort")?.addEventListener("change", async (e) => {
		const port = parseInt(e.target.value, 10);
		if (port >= 1024 && port <= 65535) {
			await setStorage({ primedlRelayPort: port });
			chrome.runtime.sendMessage({ options: true });
		}
	});

	// ── uiTheme: broadcast to open popups after save ──────────────────────
	// The saveOptionStorage handler already writes to chrome.storage.
	// theme.js in any open popup/sidebar picks up the change via onChanged.
	// We just need to update the localStorage cache here too so the options
	// page itself reflects the new theme immediately.
	document.getElementById("uiTheme")?.addEventListener("change", (e) => {
		try {
			localStorage.setItem("pd-theme", e.target.value);
		} catch (_) {}
		// Notify open popups
		chrome.runtime.sendMessage({ options: true }).catch(() => {});
	});

	await restoreOptions();
	await applyI18n();

	// Sync live changes from popup/sidebar
	chrome.runtime.onMessage.addListener((message) => {
		if (message.options) restoreOptions();
	});
});
