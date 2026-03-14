/**
 * primedl — relay.js
 * WebSocket bridge between the extension background and the local Rust server.
 *
 * Architecture:
 *   background.js  →  relay.js  →  ws://localhost:7421  →  primedl Rust app
 *
 * Features:
 * - Auto-reconnect with exponential backoff (max 30s)
 * - Message queue — detected streams are held if the server is not yet open
 * - Flush queue on reconnect
 * - Sends heartbeat every 20s to keep WS alive
 * - Emits connection status back to popup via chrome.runtime.sendMessage
 */

const PRIMEDL_WS_PORT = 7421;
const PRIMEDL_WS_URL = `ws://127.0.0.1:${PRIMEDL_WS_PORT}`;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let backoffMs = INITIAL_BACKOFF_MS;
let isConnected = false;

// Queue of messages to send once connected
const queue = [];

// ─── Connection management ─────────────────────────────────────────────────

function connect() {
	if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
		return;
	}

	try {
		ws = new WebSocket(PRIMEDL_WS_URL);
	} catch (e) {
		console.warn("[primedl/relay] WebSocket constructor failed:", e);
		scheduleReconnect();
		return;
	}

	ws.onopen = () => {
		console.log("[primedl/relay] Connected to primedl server");
		isConnected = true;
		backoffMs = INITIAL_BACKOFF_MS;

		// Broadcast connected status to popup
		broadcastStatus("connected");

		// Flush any queued messages
		while (queue.length > 0) {
			const msg = queue.shift();
			trySend(msg);
		}

		// Start heartbeat
		startHeartbeat();
	};

	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data);
			handleServerMessage(msg);
		} catch (e) {
			console.warn("[primedl/relay] Bad message from server:", e);
		}
	};

	ws.onerror = (err) => {
		// Chrome fires onerror then onclose — just let onclose handle reconnect
		console.warn("[primedl/relay] WebSocket error:", err?.message || err);
	};

	ws.onclose = () => {
		isConnected = false;
		ws = null;
		stopHeartbeat();
		broadcastStatus("disconnected");
		scheduleReconnect();
	};
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, backoffMs);

	// Exponential backoff up to max
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
		} catch (e) {
			console.warn("[primedl/relay] Send failed:", e);
		}
	}
	return false;
}

// ─── Handle messages coming FROM the Rust server ───────────────────────────

function handleServerMessage(msg) {
	switch (msg.type) {
		case "progress":
			// Forward download progress to popup/sidebar
			chrome.runtime.sendMessage({ primedlProgress: msg }).catch(() => {});
			break;
		case "download_complete":
			chrome.runtime.sendMessage({ primedlComplete: msg }).catch(() => {});
			break;
		case "download_error":
			chrome.runtime.sendMessage({ primedlError: msg }).catch(() => {});
			break;
		case "pong":
			// Heartbeat ack — no action needed
			break;
		default:
			console.log("[primedl/relay] Unknown server message:", msg);
	}
}

// ─── Broadcast status to extension pages (popup/sidebar) ──────────────────

function broadcastStatus(status) {
	chrome.runtime.sendMessage({ primedlStatus: status }).catch(() => {
		// Popup may not be open — ignore
	});
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Send a detected stream to the primedl Rust server.
 * If the server is not connected, the message is queued.
 *
 * @param {Object} payload
 * @param {string} payload.url - Stream or media URL
 * @param {Array}  payload.headers - Captured request/response headers
 * @param {string} payload.cookies - Netscape-format cookie string
 * @param {string} payload.cookieHeader - Cookie: header string
 * @param {string} payload.site - Hostname of the source tab
 * @param {string} payload.tabTitle - Tab title
 * @param {string} payload.type - Stream type (HLS, DASH, MP4, etc.)
 * @param {string} payload.category - stream | subtitles | files | custom
 * @param {number} payload.timestamp - Detection timestamp
 */
export async function sendDetection(payload) {
	const message = {
		type: "stream_detected",
		version: "1.0",
		...payload
	};

	if (isConnected) {
		const sent = trySend(message);
		if (!sent) {
			queue.push(message);
		}
	} else {
		// Queue and try to connect
		queue.push(message);
		connect();
	}
}

/**
 * Check if the relay is currently connected.
 */
export function isRelayConnected() {
	return isConnected;
}

/**
 * Manually trigger a reconnect attempt.
 */
export function reconnect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	backoffMs = INITIAL_BACKOFF_MS;
	connect();
}

// Start connecting immediately when the module loads
connect();
