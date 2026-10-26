# GameMusicApp

Compose game music on guitar: record or import a melody, get it as tab with notation, arrange tracks, play them with SoundFont or retro synth sounds, and export WAV/MIDI for Unity.

- What the app should do: [REQUIREMENTS.md](REQUIREMENTS.md)
- Current state: milestone M0 (tech spike), see [docs/M0-spike-report.md](docs/M0-spike-report.md)

## Using the app

- **Start page:** create a new project, open a `.gmsong` file, or pick one of your recent projects.
- **Projects** are saved as `.gmsong` files (Ctrl+S); new ones go to `~/Documents/GameMusicApp/` by default. The recent list is kept in the app's settings folder (`~/.config/GameMusicApp/` on Linux).
- **Record / import:** in the tab editor, "● Record / import" records your guitar (with a metronome count-in) or imports a WAV. Line up beat 1 on the waveform, let Basic Pitch transcribe it, check the result as tab and insert it into a track. Takes are saved in the project, so you can re-transcribe them later.
- **Retro sounds:** "★ Make it retro" gives every track an 8-bit sound by its role (and "↩ Original sounds" switches back). Pick a synth preset per track or click "Edit sound…" to shape your own: pulse/triangle/saw/sine/noise, envelope, pitch sweep, vibrato and other wobbles, filter and bitcrusher. Try sounds on the on-screen keys, computer keys or a MIDI keyboard. Your own sounds can be saved as presets (kept in `~/.config/GameMusicApp/presets/`) or exported as `.gminst` files. A master bitcrusher makes the whole mix lo-fi.
- **Tab editor:** click a string in the tab or move with the arrow keys, then type fret numbers. Bars always stay full: shortening a note adds rests, lengthening it uses up what follows. "+ Bar" and "+ Section" after the last bar extend the song. All shortcuts are listed under the score.
- **Drums:** "+ Drums" adds a drum track. Its bar at the cursor shows up as a step grid: click to add or remove hits (Shift+click = accent, Alt+click = ghost note), switch between 1/8, 1/16 and 1/32 steps, start from a pattern and repeat a bar into the following ones. Drums play the General MIDI kit, or an 8-bit kit after "★ Make it retro"; "Edit sound…" shapes each drum of that kit. MIDI export puts drums on channel 10, as Unity and other tools expect.

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
