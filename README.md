# HerbiSight for YouTube

> **Note:** HerbiSight for YouTube is a fork of [weedout-for-youtube](https://github.com/weedout-for-youtube) ported to Firefox.

HerbiSight is a Firefox extension that automatically removes videos YouTube labels as “Made with AI” from your feeds, search results, related videos, playlists, and Shorts before you click them.

## What it does

- Uses YouTube’s own disclosure labels rather than a blocklist or heuristic AI detector.
- **Remove mode** hides labeled videos completely; **Dim mode** fades and tags them for review.
- Optional auto-skip for labeled Shorts.
- Caches verdicts locally and makes no analytics or tracking requests.

## Prerequisites

- [Bun](https://bun.sh/) (or Node.js)
- Firefox (version 109.0 or higher)

## Development & Build

### 1. Install dependencies

```sh
bun install
```

### 2. Run locally in Firefox

Launch a fresh Firefox instance with HerbiSight automatically installed and live-reloading enabled:

```sh
bun run dev
```

Alternatively, you can load it manually:
1. Open `about:debugging` in Firefox.
2. Click **This Firefox** → **Load Temporary Add-on...**.
3. Select `extension/manifest.json`.

### 3. Lint the extension

Validate the manifest and code against Mozilla's Add-on guidelines:

```sh
bun run lint
```

### 4. Build extension package

Package the extension into a distribution archive in `dist/`:

```sh
bun run build
```

## Honest Limit

HerbiSight can only filter videos YouTube labels. Unlabeled AI content still gets through.

## License

[MIT License](LICENSE)
