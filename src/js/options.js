/**
 * primedl — options.js
 */

import { getAllStorage, getStorage, saveOptionStorage, setStorage } from "./components/storage.js";
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

// ─── Restore all options from storage ────────────────────────────────────
const restoreOptions = async () => {
	for (const option of document.getElementsByClassName("option")) {
		if (option.id === "customCommand") {
			const prefName = `customCommand${document.getElementById("copyMethod")?.value}`;
			option.value = (await getStorage(prefName)) || "";
		} else if (option.id === "regexCommand") {
			option.value = (await getStorage("regexCommand")) ?? "";
			regexValidator();
		} else if (option.tagName.toLowerCase() === "textarea") {
			const val = await getStorage(option.id);
			if (val !== null) option.value = val.join("\n");
		} else {
			const val = await getStorage(option.id);
			if (val !== null) {
				if (option.type === "checkbox" || option.type === "radio") {
					option.checked = val;
				} else {
					option.value = val;
				}
			}
		}
	}
};

// ─── i18n ─────────────────────────────────────────────────────────────────
const applyI18n = async () => {
	for (const label of document.getElementsByTagName("label")) {
		if (label.htmlFor === "versionTag") {
			const ver = await getStorage("version");
			label.textContent = `v${ver}. ${_("tipHint")}`;
		} else if (label.htmlFor) {
			const msg = _(label.htmlFor);
			if (msg) label.textContent = `${msg}:`;
		}
	}
	// Standard <option> i18n (value = key)
	for (const opt of document.getElementsByTagName("option")) {
		if (!opt.textContent && !opt.dataset.i18nOpt) {
			const msg = _(opt.value);
			if (msg) opt.textContent = msg;
		}
	}
	// Theme <option> elements use data-i18n-opt (value is theme id, not i18n key)
	for (const opt of document.querySelectorAll("option[data-i18n-opt]")) {
		const msg = _(opt.dataset.i18nOpt);
		if (msg) opt.textContent = msg;
	}
	// Tooltip spans
	for (const span of document.getElementsByTagName("span")) {
		if (span.id) {
			const msg = _(span.id);
			if (msg) span.parentElement.title = msg;
		}
	}
	// Buttons
	for (const btn of document.getElementsByTagName("button")) {
		if (btn.id) {
			const msg = _(btn.id);
			if (msg) btn.textContent = msg;
		}
	}
};

// ─── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
	// Wire all .option change handlers
	for (const option of document.getElementsByClassName("option")) {
		if (option.id === "regexCommand") {
			option.oninput = () => regexValidator();
		}
		if (option.type !== "button") {
			option.onchange = (e) => saveOptionStorage(e, document.getElementsByClassName("option"));
		}
	}

	// Export settings
	document.getElementById("exportButton")?.addEventListener("click", async () => {
		const all = await getAllStorage();
		delete all.urlStorage;
		delete all.urlStorageRestore;
		delete all.version;
		delete all.newline;
		delete all.filterInput;
		const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `primedl-settings-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(a.href);
		a.remove();
	});

	// Import settings
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

	// Reset
	document.getElementById("resetButton")?.addEventListener("click", () => {
		if (window.confirm(_("resetButtonConfirm"))) {
			chrome.runtime.sendMessage({ reset: true });
		}
	});

	// Relay port live update
	document.getElementById("primedlRelayPort")?.addEventListener("change", async (e) => {
		const port = parseInt(e.target.value, 10);
		if (port >= 1024 && port <= 65535) {
			await setStorage({ primedlRelayPort: port });
			chrome.runtime.sendMessage({ options: true });
		}
	});

	// Theme change — update localStorage cache for FOUC prevention
	document.getElementById("uiTheme")?.addEventListener("change", (e) => {
		try {
			localStorage.setItem("pd-theme", e.target.value);
		} catch (_) {}
		chrome.runtime.sendMessage({ options: true }).catch(() => {});
	});

	await restoreOptions();
	await applyI18n();

	chrome.runtime.onMessage.addListener((message) => {
		if (message.options) restoreOptions();
	});
});
