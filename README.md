# Weedout for YouTube

Weedout is a Safari extension for macOS that removes videos YouTube itself labels “Made with AI” from feeds, search, related videos, playlists, and Shorts before you click them.

The project is published so developers with an Apple Developer profile can inspect the implementation, fork it, and build it locally. The distributed app is available on the [Mac App Store](https://apps.apple.com/app/weedout-ai-for-youtube/id6804296217?mt=12).

## What it does

- Uses YouTube’s own disclosure labels rather than a blocklist or heuristic AI detector.
- Remove mode hides labeled videos; Dim mode fades and tags them for review.
- Optional auto-skip for labeled Shorts.
- Caches verdicts locally and makes no analytics or tracking requests.

## Build

1. Open `app/Weedout for YouTube/Weedout for YouTube.xcodeproj` in Xcode.
2. Select your own Apple Developer team for both targets in Signing & Capabilities.
3. Build and run the app once, then enable the extension in Safari → Settings → Extensions.
4. Allow the extension on `youtube.com`.

When editing the extension, sync the source into the generated Xcode project before rebuilding:

```sh
rsync -a --checksum extension/ "app/Weedout for YouTube/Weedout for YouTube Extension/Resources/"
```

## Honest limit

Weedout can only filter videos YouTube labels. Unlabeled AI content still gets through.

## Contributions

This repository is published for inspection, forking, and local builds. Pull requests are not accepted; please keep forks independent.
