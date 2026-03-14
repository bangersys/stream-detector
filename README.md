# primedl — Browser Extension

Stream detection and cookie relay extension for the [primedl](https://github.com/primedl) downloader.

## What it does

- Detects **HLS** (`.m3u8`), **DASH** (`.mpd`), **HDS** (`.f4m`), **MSS** (`.ism/manifest`) streams on any webpage
- Detects direct media files: MP4, TS, WebM, AAC, MP3, OGG, and more
- Detects subtitle files: VTT, SRT, TTML, DFXP
- Captures cookies, User-Agent, Referer and other headers automatically
- Forwards detected streams + cookies to the local **primedl** Rust app via WebSocket
- Assembles ready-made CLI commands for **yt-dlp**, **FFmpeg**, **Streamlink**, **hlsdl**, **N_m3u8DL-RE**
- Supports custom file extensions and Content-Type headers
- URL blacklist, per-tab / session / previous-session views

## Supported browsers

| Browser | Manifest | Status |
|---|---|---|
| Firefox 89+ | MV2 | ✅ Fully supported |
| Chrome / Brave / Edge 99+ | MV3 | ✅ Supported |

## How it connects to primedl

When the primedl desktop app is running, the extension sends detected streams to it over a local WebSocket connection (`ws://127.0.0.1:7421` by default). The Rust app handles all downloading — the extension only sniffs and relays.

The popup shows a **● primedl connected** / **○ primedl offline** indicator in the bottom bar.

## Building

Requires [Bun](https://bun.sh) >= 1.1.

```bash
# Install deps (just BiomeJS for linting)
bun install

# Build Firefox extension → dist/
bun run build:firefox

# Build Chrome extension → dist-chrome/
bun run build:chrome

# Build both
bun run build

# Watch mode (Firefox)
bun run dev

# Lint + format
bun run check
```

## Loading in browser

**Firefox:** `about:debugging` → This Firefox → Load Temporary Add-on → select `dist/manifest.json`

**Chrome / Brave / Edge:** `chrome://extensions` → Enable Developer mode → Load unpacked → select `dist-chrome/`

## Options

| Option | Description |
|---|---|
| Disable detection | Pause all stream sniffing |
| Ignore subtitles | Don't capture subtitle URLs |
| Ignore direct media files | Only capture stream manifests |
| Auto-download files | Automatically save non-manifest files |
| Include additional headers | Attach UA, Cookie, Referer to copied commands |
| primedl relay | Enable/disable sending to the local Rust server |
| primedl relay port | Port the Rust server listens on (default: 7421) |

## Architecture

```
Browser tab
  └── content/keepalive.js        ← keeps Chrome MV3 SW alive
  └── webRequest listeners        ← intercept all network requests
        ↓ stream URL detected
  └── background.js
        ├── cookies.js            ← extract cookies for the tab
        ├── relay.js              ← WebSocket bridge → ws://127.0.0.1:7421
        └── chrome.storage.local  ← persist URL list

popup.html / sidebar.html         ← UI to view/copy/manage detected URLs
options.html                      ← all preferences
```

## WebSocket message format

When a stream is detected, the extension sends:

```json
{
  "type": "stream_detected",
  "version": "1.0",
  "url": "https://example.com/video.m3u8",
  "filename": "video.m3u8",
  "type": "HLS",
  "category": "stream",
  "site": "example.com",
  "tabTitle": "Example Video",
  "tabUrl": "https://example.com/watch",
  "timestamp": 1710000000000,
  "headers": [
    { "name": "user-agent", "value": "Mozilla/5.0 ..." },
    { "name": "referer", "value": "https://example.com/" },
    { "name": "cookie", "value": "session=abc123" }
  ],
  "cookies": "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\tsession\tabc123",
  "cookieHeader": "session=abc123"
}
```

The Rust server responds with progress events:

```json
{ "type": "progress", "url": "...", "percent": 45, "speed": "2.3 MB/s" }
{ "type": "download_complete", "url": "...", "path": "/downloads/video.mp4" }
{ "type": "download_error", "url": "...", "error": "Connection refused" }
```

## Locales

Available: English, German, Japanese, Korean, Russian, Slovak.

To add a translation: copy `src/_locales/en/messages.json` to `src/_locales/<lang>/messages.json` and translate the `message` values. Open a pull request.

## Credits

Built on top of [54ac/stream-detector](https://github.com/54ac/stream-detector) (MPL-2.0) with significant modifications for the primedl project.