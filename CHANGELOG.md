# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the version is `0.x`, minor releases may contain breaking changes.

## [Unreleased]

## [0.1.0] - 2026-11-09

Initial public release (beta).

### Added

- One frameless fullscreen window per monitor, all sharing a single canvas, so a
  stroke can flow seamlessly from one monitor to the next.
- Strokes stored in global desktop coordinates; each window renders only its own
  viewport. Pointer capture keeps a stroke going across monitor borders.
- Pressure-sensitive pen input via Pointer Events (Windows Ink on Windows), with a
  toggle to turn pressure off.
- Eraser tool, including automatic erasing with the pen's eraser tip.
- 4 brush sizes and 12 colors; picking a color switches back from the eraser to
  drawing.
- Brush-size ring around the cursor.
- Undo of the last stroke (button or `Ctrl+Z`).
- Clear the whole canvas with a double-tap confirmation.
- Save the whole canvas (all monitors) as a PNG to `Pictures/Kresleni`.
- Toolbar on every monitor with shared settings; it can be hidden per monitor.
- Hold-to-quit button (about 1 s) and `Ctrl+Shift+Q` shortcut.
- Hot-plug support: connecting or disconnecting a monitor rebuilds the windows and
  keeps the drawing.
- Hardened Electron setup: context isolation, sandbox, no Node integration,
  whitelisted and validated IPC channels, Content Security Policy, navigation and
  new-window blocking.
- Automated smoke test with two simulated monitors.
- Windows packages: NSIS installer and portable `.exe`.
- macOS packages: universal `.dmg` and `.zip` (unsigned, experimental).
- Linux package: AppImage (X11 required).
- Continuous integration (lint, tests) and a tag-driven release workflow that
  creates draft GitHub releases.

### Known limitations

- Not yet verified on real Windows hardware with a pen tablet, pressure and
  multiple physical monitors.
- Monitors with different display scaling may show a small offset at the border.
- UI strings are currently in Czech only.

[Unreleased]: https://github.com/HonzaVrkota/multi-monitor-canvas/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HonzaVrkota/multi-monitor-canvas/releases/tag/v0.1.0
