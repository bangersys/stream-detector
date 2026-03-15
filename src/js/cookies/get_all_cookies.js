/**
 * primedl — cookies/get_all_cookies.js
 *
 * Ported and adapted from kairi003/Get-cookies.txt-LOCALLY (MIT).
 * Source: https://github.com/kairi003/Get-cookies.txt-LOCALLY
 *
 * Handles three things our naive getAll() missed:
 *
 * 1. partitionKey (Chrome 119+ CHIPS)
 *    Cookies set inside iframes are stored under a partition key tied to the
 *    top-level site. A plain getAll({ url }) misses all of them. We run two
 *    queries — one with and one without partitionKey — and merge the results.
 *    For Chrome < 119 the partitioned query is wrapped in try/catch so it
 *    degrades gracefully.
 *
 * 2. storeId / cookieStoreId (Firefox container tabs)
 *    Firefox Multi-Account Containers give each container its own cookie
 *    store. Without passing the right storeId you only see the default store,
 *    missing container-specific cookies entirely.
 *
 * 3. incognito: "split" mode
 *    When the manifest declares incognito: "split", each incognito window
 *    gets its own isolated extension + cookie store. In that mode we return
 *    undefined as storeId so the browser picks the correct store from context.
 */

/**
 * Get all cookies matching the given criteria, including partitioned cookies
 * (Chrome 119+) and container-tab cookies (Firefox).
 *
 * @param {chrome.cookies.GetAllDetails} details
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
export async function getAllCookies(details) {
	// Clone to avoid mutating the caller's object
	const opts = { ...details };

	// Only auto-resolve storeId when querying a specific URL/domain.
	// When exporting ALL cookies (no url, no domain), storeId should be
	// undefined so Chrome/Firefox query every store.
	if (opts.storeId === undefined && (opts.url || opts.domain)) {
		opts.storeId = await getCurrentCookieStoreId();
	}

	// Separate partitionKey from the rest of the details so we can run
	// two distinct queries: one with it, one without
	const { partitionKey, ...detailsWithoutPartitionKey } = opts;

	// Partitioned query — Chrome 119+. If partitionKey was provided, run it
	// in a promise chain so we can catch() the error on older Chrome.
	// On Chrome < 119 or Firefox, this query throws and we catch to [].
	const cookiesWithPartitionKey = partitionKey
		? await Promise.resolve()
				.then(() => chrome.cookies.getAll(opts))
				.catch(() => [])
		: [];

	// Standard query — always runs, works on all Chrome and Firefox versions
	const cookies = await chrome.cookies.getAll(detailsWithoutPartitionKey);

	// Merge and deduplicate by (name, domain, path) triple.
	// The same cookie may appear in both result sets.
	const merged = [...cookies, ...cookiesWithPartitionKey];
	return deduplicateCookies(merged);
}

/**
 * Deduplicate cookies by (name + domain + path) composite key.
 * When the same cookie appears in both the standard and partitioned query,
 * the partitioned version wins (it's more specific / later in the array).
 *
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {chrome.cookies.Cookie[]}
 */
function deduplicateCookies(cookies) {
	const seen = new Map();
	for (const cookie of cookies) {
		const key = `${cookie.name}::${cookie.domain}::${cookie.path}`;
		seen.set(key, cookie); // later value overwrites — partitioned wins
	}
	return [...seen.values()];
}

/**
 * Resolve the correct cookie store ID for the currently active tab.
 *
 * Rules:
 * - incognito: "split" → return undefined (browser picks the store from context)
 * - Firefox → read tab.cookieStoreId (container tab support)
 * - Chrome  → find the store whose tabIds include the active tab's id
 *
 * @returns {Promise<string | undefined>}
 */
async function getCurrentCookieStoreId() {
	// In split incognito mode the browser already knows which store to use
	// from the extension process context — passing undefined is correct.
	if (chrome.runtime.getManifest().incognito === "split") {
		return undefined;
	}

	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab) return undefined;

	// Firefox exposes tab.cookieStoreId directly (container tab ID)
	if (tab.cookieStoreId) {
		return tab.cookieStoreId;
	}

	// Chrome: find the cookie store that owns this tab
	try {
		const stores = await chrome.cookies.getAllCookieStores();
		return stores.find((store) => store.tabIds.includes(tab.id))?.id;
	} catch {
		return undefined;
	}
}
