# Privacy Policy for HerbiSight

**Last updated:** September 10, 2026

HerbiSight is committed to protecting user privacy. This policy outlines how data is handled.

## 1. Zero Data Collection

HerbiSight **does not collect, transmit, store, or share any personal data, browsing history, or user identifiers**.

## 2. How the Extension Operates

- **Local Processing**: All detection and filtering logic executes locally within your browser on supported platforms (YouTube and Facebook).
- **Local Storage**: The extension stores user preferences (filtering modes) and cached video verdict flags locally on your device using Firefox's `browser.storage.local` API. This data never leaves your device and can be cleared at any time via the extension popup ("Reset data").
- **Network Requests**: The extension only issues standard requests to YouTube's own internal API endpoint (`/youtubei/v1/next`) to retrieve video disclosure metadata when browsing YouTube. On Facebook, all detection is performed entirely in-memory within the local DOM. No third-party servers, external APIs, analytics, or tracking services are used.

## 3. Third-Party Services

HerbiSight does not integrate with any analytics providers, telemetry platforms, advertising networks, or third-party servers.

## 4. Contact

If you have questions regarding this privacy policy, you can reach out via GitHub:
- [https://github.com/kacperwyczawski/herbisight/issues](https://github.com/kacperwyczawski/herbisight/issues)
