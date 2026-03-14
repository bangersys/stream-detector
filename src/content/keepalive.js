/**
 * primedl — keepalive.js (content script)
 *
 * Chrome MV3 service workers die after 30s idle / 5min hard limit.
 * This content script keeps the background service worker alive by
 * maintaining a persistent port connection, reconnecting every ~295s
 * (just under the 5-minute hard kill).
 *
 * Pattern from wOxxOm (stack overflow #66618269) — the most reliable
 * cross-version approach, works Chrome 99+.
 *
 * On Firefox (MV2 non-persistent background), this is a harmless no-op
 * since Firefox handles background event script lifecycle differently.
 */

(function keepAlive() {
	// Only needed on Chrome (service worker background)
	// On Firefox, chrome.runtime.connect still works but the background
	// script lifecycle is managed differently — this doesn't hurt either way.

	let port = null;

	function connect() {
		try {
			port = chrome.runtime.connect({ name: "primedl-keepalive" });

			port.onDisconnect.addListener(() => {
				// Port disconnected — service worker may have been terminated.
				// Wait a tick then reconnect.
				port = null;
				setTimeout(connect, 100);
			});

			// Schedule a proactive reconnect just before the 5-min hard kill
			// Chrome 104+ fixed SW kill with open ports, but we still
			// reconnect to be safe on older versions.
			setTimeout(() => {
				if (port) {
					port.disconnect();
					// onDisconnect listener above will call connect() again
				}
			}, 295_000); // 295s = 5min - 5s buffer
		} catch {
			// Extension context may be invalidated (e.g. after update)
			// — stop trying
		}
	}

	connect();
})();
