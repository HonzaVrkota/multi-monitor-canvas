# Security Policy

## Supported versions

Multi-Monitor Canvas is in beta. Only the **latest 0.x release** receives security fixes.

| Version            | Supported |
| ------------------ | --------- |
| Latest 0.x release | Yes       |
| Older releases     | No        |

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public issues, discussions or
pull requests.

Instead, use GitHub Private Vulnerability Reporting:
<https://github.com/HonzaVrkota/multi-monitor-canvas/security/advisories/new>

Please include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the app version and your OS.

This is a hobby project maintained in spare time, so there is no guaranteed response time. Reports are handled on
a best-effort basis, and you will be credited in the release notes if you wish.

## Security posture

The app is designed to be safe to leave in front of a child:

- **No network access.** The app does not load remote content or contact any server.
- Renderer windows run with `contextIsolation: true`, `sandbox: true` and
  `nodeIntegration: false`.
- The preload script exposes only a **whitelist of IPC channels**; the main process
  **validates all input** received over IPC.
- A strict **Content Security Policy** restricts the renderer to local resources.
- Navigation and opening new windows are blocked.
- Files are written only when the user saves a drawing (PNG into `Pictures/Kresleni`).

Note: macOS builds are currently **unsigned**, and Windows builds may not be code-signed,
so your OS may show a warning on first launch. Only download releases from the official
[GitHub Releases](https://github.com/HonzaVrkota/multi-monitor-canvas/releases) page.
