/**
 * primedl — components/cookies.js
 *
 * Backward-compatibility shim.
 * The full cookie implementation has moved to js/cookies/ module directory.
 *
 * background.js imports getCookiesForUrl from here — keeping this shim
 * means background.js does not need to change its import path.
 */
export { getCookiesForUrl } from "../cookies/index.js";
