/**
 * primedl — relay.js
 * WebSocket bridge between the extension background and the local Rust server.
 *
 * Architecture:
 *   background.js  →  relay.js  →  ws://127.0.0.1:7421  →  primedl Rust app
 *
 * Connection strategy:
 * - Does NOT auto-connect on load — waits for either a stream detection
 *   event (sendDetection) or an explicit reconnect() call
 * - Checks primedlRelayEnabled from storage before ever opening a socket
 * - Once connected, auto-reconnects with exponential backoff (max 30s)
 * - Queues detected streams while disconnected and flushes on reconnect
 * - Sends a heartbeat every 20s to keep the socket alive
 * - Broadcasts connection status to popup/sidebar via runtime.sendMessage
 *
 * Why no auto-connect on load:
 *   new WebSocket() when the server is not running always produces a red
 *   ERR_CONNECTION_REFUSED in the browser console — this is a browser-level
 *   network error that CANNOT be suppressed by JS. By only connecting when
 *   there is actually something to send, we avoid console spam for users
 *   who have not started the primedl app yet.
 */

const PRIMEDL_WS_URL = "ws://127.0.0.1:7421";
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 2_000;

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let backoffMs = INITIAL_BACKOFF_MS;
let isConnected = false;
let isEnabled = true; // mirrors primedlRelayEnabled from storage
let hasLoggedWaiting = false; // only log "connecting" once per cycle

// Queue of pending detections — flushed on successful connect
const queue = [];

// ─── Read relay-enabled state from storage ─────────────────────────────────
// Inline helper to avoid a circular dependency on storage.js

async function getRelayEnabled() {
	return new Promise((resolve) =>
		chrome.storage.local.get("primedlRelayEnabled", (val) => {
			// Default to true if not yet written
			resolve(val.primedlRelayEnabled !== false);
		})
	);
}

// ─── Connection management ─────────────────────────────────────────────────

function connect() {
	// Already open or connecting — nothing to do
	if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
		return;
	}

	// Relay is disabled in settings — don't touch the network
	if (!isEnabled) {
		return;
	}

	// Log that we are attempting, but only once per waiting cycle so we
	// don't spam. The browser emits its own ERR_CONNECTION_REFUSED when the
	// server is not up — we intentionally do NOT add another warn on top.
	if (!hasLoggedWaiting) {
		console.log("[primedl/relay] Connecting to primedl server at", PRIMEDL_WS_URL);
		hasLoggedWaiting = true;
	}

	try {
		ws = new WebSocket(PRIMEDL_WS_URL);
	} catch {
		// Constructor threw synchronously (invalid URL, etc.) — retry later
		scheduleReconnect();
		return;
	}

	ws.onopen = () => {
		console.log("[primedl/relay] Connected ✓");
		isConnected = true;
		hasLoggedWaiting = false; // reset so next disconnect cycle logs once
		backoffMs = INITIAL_BACKOFF_MS;

		broadcastStatus("connected");

		// Flush any streams that were detected while disconnected
		while (queue.length > 0) {
			const msg = queue.shift();
			trySend(msg);
		}

		startHeartbeat();
	};

	ws.onmessage = (event) => {
		try {
			handleServerMessage(JSON.parse(event.data));
		} catch {
			// Malformed JSON — ignore silently
		}
	};

	ws.onerror = () => {
		// The browser already shows ERR_CONNECTION_REFUSED in red when the
		// server is not running. Adding our own console.warn here just
		// doubles the noise — so we intentionally leave this handler empty.
		// The onclose handler below will schedule the reconnect.
	};

	ws.onclose = () => {
		isConnected = false;
		ws = null;
		stopHeartbeat();
		broadcastStatus("disconnected");

		// Only schedule reconnect if the relay is still enabled
		if (isEnabled) {
			scheduleReconnect();
		}
	};
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, backoffMs);

	// Exponential backoff — doubles each attempt up to MAX_BACKOFF_MS (30s)
	backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
}

function startHeartbeat() {
	stopHeartbeat();
	heartbeatTimer = setInterval(() => {
		trySend({ type: "heartbeat", ts: Date.now() });
	}, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

function trySend(payload) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		try {
			ws.send(JSON.stringify(payload));
			return true;
		} catch {
			// Socket closed mid-send — onclose will handle reconnect
		}
	}
	return false;
}

// ─── Clean intentional disconnect ─────────────────────────────────────────

function disconnect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	stopHeartbeat();
	if (ws) {
		ws.onclose = null; // suppress reconnect loop on intentional close
		ws.close();
		ws = null;
	}
	isConnected = false;
	hasLoggedWaiting = false;
	broadcastStatus("disconnected");
}

// ─── Handle messages FROM the Rust server ─────────────────────────────────

function handleServerMessage(msg) {
	switch (msg.type) {
		case "progress":
			chrome.runtime.sendMessage({ primedlProgress: msg }).catch(() => {});
			break;
		case "download_complete":
			chrome.runtime.sendMessage({ primedlComplete: msg }).catch(() => {});
			break;
		case "download_error":
			chrome.runtime.sendMessage({ primedlError: msg }).catch(() => {});
			break;
		case "pong":
			// Heartbeat ack — nothing to do
			break;
		default:
			console.log("[primedl/relay] Unknown message type:", msg.type);
	}
}

// ─── Broadcast status to extension pages ──────────────────────────────────

function broadcastStatus(status) {
	chrome.runtime.sendMessage({ primedlStatus: status }).catch(() => {
		// Popup/sidebar may not be open — ignore
	});
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Send a detected stream payload to the primedl Rust server.
 *
 * If the relay is disabled in settings this is a no-op.
 * If the server is not yet connected, the payload is queued and will be
 * sent as soon as the connection is established.
 *
 * The first call to this function triggers the first connection attempt —
 * this is why we do not auto-connect on module load.
 */
export async function sendDetection(payload) {
	// Re-read enabled state each time in case the user toggled it
	isEnabled = await getRelayEnabled();
	if (!isEnabled) return;

	const message = {
		type: "stream_detected",
		version: "1.0",
		...payload
	};

	if (isConnected) {
		if (!trySend(message)) {
			queue.push(message);
		}
	} else {
		// Queue then trigger the lazy first connection
		queue.push(message);
		connect();
	}
}

/**
 * Update relay enabled state and connect/disconnect accordingly.
 * Called by background.js when the primedlRelayEnabled setting changes.
 */
export async function setRelayEnabled(enabled) {
	isEnabled = enabled;
	if (enabled) {
		backoffMs = INITIAL_BACKOFF_MS;
		connect();
	} else {
		disconnect();
	}
}

/**
 * Manually trigger a reconnect attempt (e.g. from a popup button).
 */
export function reconnect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	backoffMs = INITIAL_BACKOFF_MS;
	hasLoggedWaiting = false;
	connect();
}

/**
 * Whether the relay is currently live-connected to the primedl server.
 */
export function isRelayConnected() {
	return isConnected;
}

// ─── NO auto-connect on module load ───────────────────────────────────────
// Connection is lazy — triggered by the first sendDetection() call,
// or explicitly via reconnect() / setRelayEnabled(true).
// This keeps the console clean when primedl is not running.
