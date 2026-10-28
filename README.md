# GameMusicApp

Compose game music on guitar: record or import a melody, get it as tab with notation, arrange tracks, play them with SoundFont or retro synth sounds, and export WAV/MIDI for Unity (and the score as a PDF).

- What the app should do: [REQUIREMENTS.md](REQUIREMENTS.md)
- Current state: milestone M0 (tech spike), see [docs/M0-spike-report.md](docs/M0-spike-report.md)

## Using the app

- **Start page:** create a new project, open a `.gmsong` file, or pick one of your recent projects.
- **Light and dark mode:** pick Light, Dark or System (follows the operating system) on the start page or under ☰ in the editor. In dark mode the score is drawn light on dark too.
- **Projects** are saved as `.gmsong` files (Ctrl+S); new ones go to `~/Documents/GameMusicApp/` by default. The recent list is kept in the app's settings folder (`~/.config/GameMusicApp/` on Linux). While a project has unsaved changes, a copy of them is kept there too (in `recovery/`), written a couple of seconds after each change. Saving, or closing without saving, removes it. If the app crashes or the computer goes off, the start page offers the changes under "Unsaved changes from last time": open them and save, or throw them away with ×.
- **Record / import:** in the tab editor, "● Record" in the top bar records your guitar (with a metronome count-in) or imports a WAV. Line up beat 1 on the waveform, let Basic Pitch transcribe it, check the result as tab and insert it into a track. Takes are saved in the project, so you can re-transcribe them later.
- **Sounds:** click a guitar, bass or keys track's sound in the track list to open its sound window. Pick a category (8-bit synth presets, your own presets, or an instrument family such as Piano, Guitar, Strings or Synth lead) and click a sound: it plays a note, and the track uses it. Any of the 128 General MIDI sounds works on any of these tracks, e.g. a piano on a guitar track. Try the sound on the on-screen keys, the computer keyboard (A–K, Z/X = octave) or a MIDI keyboard. Drum tracks use the drum kit or the 8-bit kit.
- **Retro sounds:** "★ Make it retro" gives every track an 8-bit sound by its role (and "↩ Original sounds" switches back). With an 8-bit sound, the sound window also shows the synth to shape it: pulse/triangle/saw/sine/noise, envelope, pitch sweep, vibrato and other wobbles, filter and bitcrusher. Your own sounds can be saved as presets (kept in `~/.config/GameMusicApp/presets/`) or exported as `.gminst` files. A master bitcrusher makes the whole mix lo-fi.
- **Tab editor:** click a string in the tab or move with the arrow keys, then type fret numbers. Bars always stay full: shortening a note adds rests, lengthening it uses up what follows. "+ Bar" and "+ Section" after the last bar extend the song. Edit and Bar menus hold copy/paste and bar commands; "?" (bottom right, or the ? key) lists all keyboard shortcuts. The eye on a track's card leaves the track out of the score to keep it clear (it still plays; click again or pick the track to show it). The layout (Notation + tab or Tab only, Screen or Pages, zoom, tracks left out, minimized drum grid or piano roll) is saved with the project; new projects start with the layout you used last (with every track shown).
- **Sections and parts:** a song is a row of sections (Verse, Chorus, …), and in each section every track plays one of its parts, or nothing. Sections with the same notes share a part, so changing a note in one verse changes it in every verse that plays that part. Notes written into a silent section become a new part, named after the section. A section that gets longer or shorter in the score (bars inserted or deleted, a section started inside it) gets its own copy of a part it shares, and the other sections keep theirs. Part names are shown over the bar where a part starts, when the part plays in more than one section or is named differently from its section. Projects saved before parts existed get them when opened: sections with the same notes on a track share one part.
- **Arrangement:** the "Arrangement" tab above the score (Ctrl+Tab switches) shows the song as a grid: sections from left to right, a lane per track, and in each cell the part that track plays there, in the part's color. The section bar above has the section's name and length (a shorter part repeats to fill it, a longer one is cut off), ◀ ▶ to move it, Duplicate (a repeat playing the same parts), Delete, Loop it and "Show in score"; "+" adds a section at the end. With the mouse: drag a part onto another section of its track to play it there, drag a section by its name to move it, and drag its right edge to change its length (Esc cancels). Play, loop and the metronome work as in the score, with a playhead over the grid.
- **Editing parts:** under the grid, the part of the selected cell is shown on its own, as tab and notes, and edited like the score (Enter jumps there from the grid, Esc back). Changes go into every section that plays the part; the cells playing it are outlined. Above its score: the part's name and color, "Duplicate" (a copy with the same notes and color, played nowhere yet, to build a variation on; the copy opens for editing), "▶ Play part" (Space in the part plays it from the cursor; Loop repeats the whole part), "Place in “…”" to play it in the selected section, "Own copy" to change it in this section only, and "Silence". A silent cell offers "+ New part here". The palette at the bottom lists every part of every track and how often it plays: click one to edit it, drag it onto a section to play it there, "+" at the end of a track's row makes a new empty part for it (as long as the selected section). Parts no section plays stay in the palette; × or "Delete unused parts" removes them.
- **Held notes, hammer-ons and slides:** T holds the note before the cursor through the cursor's beat (a tie, also across a bar line; on a rest it uses the chosen note length). H makes a hammer-on or pull-off and S a slide from the note at the cursor into the next note on that string. They're in the toolbar too (Hold, H/P, Slide), show as ties, "H"/"P" arcs and "sl." lines, and play legato: the next note isn't picked again. On SoundFont tracks this bends the whole track, so it's meant for single-note lines.
- **Playback:** Space plays from the cursor. "⟲ Loop" (L) repeats what you pick next to it: the whole song, a section or the selected bars (it stays put while you click around); "Metronome" (M) clicks along. Each track has M (mute) and S (solo). Zoom the score with − / + or Ctrl + mouse wheel.
- **Audio latency:** on Linux the app uses a small audio buffer (256 samples), so the MIDI keyboard sounds about 30 ms after a key press. If playback crackles, pick "Standard" under ☰ → MIDI keyboard and audio latency, and restart the app.
- **Tuning and capo:** "Tuning" on a guitar or bass track's card opens its tuning: pick a preset (Drop D, DADGAD, Open G, half or whole step down, …) or tune each string up or down by semitones (click a string to hear it, "▶ Strum" for all), and put a capo on a fret. Frets in the tab count from the capo, as players read them. For notes already written you choose: keep how they sound (the frets change, and a note its string can't reach moves to a free string) or keep the tab as it is. A tuning other than standard is listed under the song title, and the capo is noted over the first bar; recording and step input fret for the tuning and capo.
- **Page view and PDF:** "Pages" (bottom right, next to "Screen") shows the score on A4 pages, black on white as it is printed; you can edit and play it as usual. Export → PDF saves those pages as a PDF, with the tracks and staves shown in the score.
- **WAV export for Unity:** Export → WAV… exports the whole song, a section or a bar range at 48 or 44.1 kHz. "Cut at the end" makes the file exactly as long as its bars (with a 5 ms fade), so it loops without a gap when *Loop* is ticked on the Unity AudioSource; "Let notes ring out" adds a 1.5 s tail instead. Muted tracks are left out, so solo a track to export it on its own.
- **Sound effects:** the "Sound effects" tab (next to Arrangement) keeps your game's sound effects in the project, next to the song: jump, coin, laser, … Each one has its own name, sound, notes and tempo, and isn't part of the music. "+ New effect" starts one with an 8-bit sound and an empty bar; draw its notes in the piano roll and pick or shape its sound with the button next to its name (the same sound window as for tracks). ▶ plays one, "▶ Play all" plays them one after the other as they are exported, to hear if they fit together. "Duplicate" makes a copy to try a variation. "Export WAV…" (also under Export in the top bar) saves them all into a folder, one file each named after the effect (files with the same names are replaced, so exporting again updates them in your game), or only the one picked. Each file ends when its sound has faded, with a tiny fade; it can be mono (the default) and normalized to −1 dB.
- **Keys tracks:** "+ Keys" adds a track for keyboard parts (synth leads, pads, piano), shown in standard notation. When the cursor is on it, a piano roll opens under the score: drag to draw a note, click a note to remove it. "● Record MIDI" in the piano roll records what you play on a MIDI keyboard (one-bar count-in, metronome, the rest of the song plays along) and snaps it to the grid. "Step input" in the toolbar enters keys you play at the cursor with the chosen length, on any track (chords: press keys together; on guitar and bass the string and fret are chosen for you). MIDI keyboards are found automatically. "Import MIDI…" adds the tracks of a `.mid` file.
- **Drums:** "+ Drums" adds a drum track. Its bar at the cursor shows up as a step grid: click to add or remove hits (Shift+click = accent, Alt+click = ghost note), switch between 1/8, 1/16 and 1/32 steps, start from a pattern and repeat a bar into the following ones. Drums play the General MIDI kit, or an 8-bit kit after "★ Make it retro"; the pencil next to its sound shapes each drum of that kit. MIDI export puts drums on channel 10, as Unity and other tools expect.

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
