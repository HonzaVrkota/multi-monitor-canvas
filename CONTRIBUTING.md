# Contributing to Multi-Monitor Canvas

Thanks for your interest! Multi-Monitor Canvas is a small, simple drawing app for kids.
Bug reports, hardware test reports, ideas and pull requests are all welcome.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
Security issues: please see [SECURITY.md](SECURITY.md) and do **not** open a public issue.

## Getting started

Prerequisites: [Node.js](https://nodejs.org/) **20 or newer** and Git.

```sh
git clone https://github.com/HonzaVrkota/multi-monitor-canvas.git
cd multi-monitor-canvas
npm install
npm start          # run the app
npm test           # smoke test (two simulated monitors)
npm run lint       # ESLint
npm run format     # Prettier
```

On headless Linux (e.g. CI or WSL without a display) run the tests with Xvfb:

```sh
xvfb-run -a npx electron --no-sandbox test/smoke-main.js
```

Tip: the app opens a fullscreen window on every monitor. Quit with `Ctrl+Shift+Q`
or by holding the quit button for about a second.

## Project structure

| Path         | What it is                                                               |
| ------------ | ------------------------------------------------------------------------ |
| `main.js`    | Main process: one window per monitor, shared drawing state, IPC handlers |
| `preload.js` | The only bridge to the renderer: a whitelist of IPC channels             |
| `renderer/`  | UI: `index.html`, `renderer.js` (drawing and toolbar), `style.css`       |
| `test/`      | Smoke test that drives the app with simulated monitors                   |

## Conventions

- Code is formatted with **Prettier** and linted with **ESLint**. Run `npm run format`
  and `npm run lint` before committing.
- **Keep it simple and kid-safe.** No network access, no ads, no accounts, no complex
  menus, nothing that can lose a child's drawing by accident. Destructive actions
  (clear, quit) must require a deliberate gesture.
- Keep the security posture intact: `contextIsolation`, `sandbox`, no `nodeIntegration`,
  every new IPC channel whitelisted in `preload.js` and its input validated in `main.js`.
- UI strings are currently in **Czech**. Internationalization is planned; until then,
  please keep new strings short and easy to translate.
- Code, comments, commit messages and docs are in English.

## Hardware testing reports are especially welcome

The app is in beta and has mostly been tested automatically with simulated monitors.
If you try it on real hardware, please open a
[hardware report](https://github.com/HonzaVrkota/multi-monitor-canvas/issues/new?template=hardware_report.yml)
— even (especially!) when everything works. Useful details:

- OS and version
- Monitor layout (count, resolutions, arrangement)
- Display scaling per monitor (e.g. 100 % / 150 %)
- Tablet model and driver version, Windows Ink on/off
- Whether pressure works and whether strokes cross monitors smoothly

## Pull requests

1. For larger changes, please open an issue first so we can agree on the approach.
2. Fork the repo and create a branch from `main`.
3. Make your change; add or update tests where it makes sense.
4. Run `npm run lint` and `npm test`.
5. Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
6. Open a pull request and fill in the template, including which OS and monitor setup
   you tested on.

Small, focused pull requests are easier to review and get merged faster.

## Release process (maintainers)

1. Bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`).
2. Move the `[Unreleased]` entries in `CHANGELOG.md` to a new `## [X.Y.Z] - YYYY-MM-DD`
   section and update the link references at the bottom.
3. Commit, then tag and push:

   ```sh
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. The release workflow builds Windows, macOS and Linux packages and creates a
   **draft** GitHub release.
5. Review the draft (artifacts, release notes), then publish it.
