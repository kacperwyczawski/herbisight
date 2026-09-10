# HerbiSight

![Mozilla Add-on Version](https://img.shields.io/amo/v/herbisight)

> [!NOTE]
> HerbiSight is a fork of [weedout-for-youtube](https://github.com/masteranza/weedout-for-youtube) ported to Firefox with added Facebook support.

HerbiSight is a Firefox extension for Desktop and Android that automatically removes or dims content labeled as AI from your YouTube feeds (including search, related videos, and Shorts) and Facebook feeds.

## What it does

- Uses official platform disclosure labels (YouTube "Made with AI" and Facebook "AI info") rather than heuristic AI detectors.
- **Independent 3-way controls**: Configure **Allow**, **Dim** (fade & tag), or **Block** (hide completely) separately for YouTube and Facebook.
- Optional auto-skip for labeled YouTube Shorts.
- Compatible with Firefox for Desktop and Firefox for Android.
- Caches verdicts locally and makes no analytics or tracking requests.

## Prerequisites

- [Bun](https://bun.sh/) (or Node.js)
- Firefox for Desktop or Firefox for Android

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

HerbiSight can only filter content that platforms officially label as AI. Unlabeled AI content still gets through.

## Disclaimer

- **Not an ad blocker**: HerbiSight does not block advertisements, circumvent paywalls, or interfere with platform monetization. It strictly acts on public platform AI disclosure tags according to your personal viewing preferences.
- **No affiliation**: HerbiSight is an independent open-source project and is not affiliated with, sponsored by, or endorsed by YouTube, Google, Facebook, Meta, or any of their affiliates or subsidiaries. All product and company names are trademarks™ or registered® trademarks of their respective holders.

## License & Privacy

- [MIT License](LICENSE)
- [Privacy Policy](PRIVACY.md)
