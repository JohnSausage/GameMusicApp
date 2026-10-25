# GameMusicApp

Compose game music on guitar: record or import a melody, get it as tab with notation, arrange tracks, play them with SoundFont or retro synth sounds, and export WAV/MIDI for Unity.

- What the app should do: [REQUIREMENTS.md](REQUIREMENTS.md)
- Current state: milestone M0 (tech spike), see [docs/M0-spike-report.md](docs/M0-spike-report.md)

## Development

Requires Node.js 22.12 or newer (developed with Node 26 / npm 12).

```bash
npm install
```

```bash
npm run dev
```

Starts the Electron app with live reload.

```bash
npm run dev:web
```

Runs the UI in a normal browser at http://localhost:5173 (file saving falls back to downloads).

```bash
npm test
```

```bash
npm run typecheck
```

## Building

```bash
npm run dist:linux
```

Creates `release/GameMusicApp-<version>-x86_64.AppImage`.

The Windows installer and portable `.exe` are built by GitHub Actions for every pull request and every push to `main` (`.github/workflows/build.yml`); download them from the run's artifacts. To build another branch, use *Actions → Build → Run workflow*. `npm run dist:win` works on Windows.

```bash
npm run smoke
```

Starts the last build headless, checks that the UI and score render without errors, and quits.
