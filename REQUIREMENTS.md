# GameMusicApp: Requirements Specification

| | |
|---|---|
| **Document version** | 0.3 (ready for implementation) |
| **Date** | 2026-10-25 |
| **Status** | All open questions answered (see [§11](#11-decisions-from-the-qa-rounds)). |
| **Product name** | *GameMusicApp* (working title) |

---

## 1. Introduction

### 1.1 Purpose
This document describes what GameMusicApp must do so it can be designed, built and tested. It is the reference for implementation and for deciding what goes into which release.

### 1.2 Product vision
A desktop app for composing retro-style game music as a guitarist. You play a melody on your acoustic guitar into the microphone, or import a recording from Audacity, and get it back as editable guitar tab with standard notation. You add bass, drums and other instruments on separate tracks, by hand or with a MIDI keyboard. Everything is played back from the notes, either with standard MIDI instruments or with synthesizer instruments you design yourself for a retro sound. Finally you export WAV files that go straight into Unity.

### 1.3 Scope

**In scope**
- Recording guitar via microphone and automatically transcribing it to tab
- Importing WAV recordings (e.g. exported from Audacity) for transcription
- Manual tab entry and editing, and note entry with a MIDI keyboard
- Display as tab, with optional standard notation above it
- Multi-track songs (guitar, bass, drums, other instruments)
- Playback synthesized from the notes: General MIDI SoundFont instruments and a built-in synthesizer
- An instrument editor to design and save your own synthesizer sounds (e.g. 8-bit style)
- Export to WAV and MIDI
- Runs natively on Linux (CachyOS) and on Windows as an `.exe`

**Out of scope (for now)**
- Using recorded audio in the final mix. Everything you hear is synthesized from the notes (Q5). Recordings are kept only for transcription.
- Online collaboration. Project files are exchanged manually (Q6).
- Full DAW features (VST plugin hosting, audio editing)
- Accounts, cloud sync, telemetry
- macOS and mobile
- Translations: the UI is English only (Q14)
- Playing techniques (bends, slides, palm mutes) in the first version (Q9)
- Adaptive-music features (stems, loop tail handling, beat-sync data) in the first version (Q12)

### 1.4 Glossary

| Term | Meaning |
|---|---|
| **Tab** (tablature) | One line per string; numbers are frets. |
| **Standard notation** | Classic five-line staff with note heads. |
| **MIDI** | Note events (pitch, timing, velocity). Contains no audio. Also the protocol a MIDI keyboard uses to send notes to the computer. |
| **SoundFont (SF2/SF3)** | Bank of instrument samples used to turn MIDI notes into audio. |
| **General MIDI (GM)** | Standard set of 128 instruments + a drum kit that every GM SoundFont provides. |
| **Synthesizer** | Generates sound from simple building blocks (oscillators, envelopes, filters) instead of recorded samples. |
| **Oscillator** | Produces the basic waveform: pulse/square, triangle, sawtooth, sine or noise. |
| **Pulse wave / duty cycle** | Square-like wave typical of 8-bit consoles. The duty cycle (12.5 %, 25 %, 50 %) changes the tone from thin to hollow. |
| **Envelope (ADSR)** | How a sound's volume (or pitch, filter) changes over time: Attack, Decay, Sustain, Release. |
| **Filter** | Removes high or low frequencies. *Cutoff* sets where; *resonance* adds a peak at the cutoff. |
| **LFO** | Low-frequency oscillator: a slow wave that modulates something, e.g. pitch (vibrato) or volume (tremolo). |
| **Preset** | A saved instrument sound that can be reused in other songs. |
| **Chiptune** | Music made with, or imitating, the sound chips of old consoles. |
| **Bitcrusher** | Effect that lowers bit depth and sample rate, making any sound gritty and lo-fi. |
| **Transcription** | Converting recorded audio into notes. |
| **Onset** | The moment a note starts. |
| **Downbeat** | Beat 1 of a bar. |
| **Quantization** | Snapping note timing to a rhythmic grid (e.g. 1/16 notes). |
| **Stem** | Audio file containing only one track (or group of tracks). |
| **Count-in** | Metronome bar(s) played before recording starts. |

### 1.5 Existing tools, and why build this anyway

| Tool | Does well | Missing for this use case |
|---|---|---|
| **TuxGuitar** (free, open source) | Tab editor, notation, multi-track, MIDI playback, WAV/MIDI export | No audio-to-tab transcription, no synthesizer, dated UI |
| **Guitar Pro** (paid) | Best-in-class tab editing and sounds | No Linux version, paid |
| **MuseScore** (free) | Excellent notation, supports tab | Notation-first workflow, no transcription |
| **Spotify Basic Pitch** (free) | Audio → MIDI transcription | No tab, no editor, only produces MIDI |
| **Furnace** (free, open source) | Authentic chip sound for many consoles | Tracker interface (no tab, no notation), no transcription |

The new value is the **integrated loop: play guitar → tab → arrange → design retro sounds → game-ready WAV**.

---

## 2. Overall description

### 2.1 Users

| ID | User | Description |
|---|---|---|
| U1 | **Composer** (primary) | You: plays acoustic guitar, mostly clean single-note lines, at a fixed tempo. Records with a microphone, directly in the app or in Audacity. Owns a MIDI keyboard. Composes retro-style music for your own Unity game on CachyOS. |
| U2 | **Friend** | Uses Windows. Mainly opens and listens to your songs, and may use the app for their own projects. Runs the `.exe` without installing any developer tools. No online collaboration; files are exchanged manually. |

### 2.2 Main workflow
1. Create a song (title, tempo, time signature, key).
2. Add a guitar track and choose a tuning.
3. Record a melody with a metronome count-in, **or** import a WAV recorded in Audacity at a fixed tempo and set where beat 1 is.
4. The app transcribes it; you review and fix it in the tab editor.
5. Add a bass track (typed in or played on the MIDI keyboard) and a drum track (grid editor).
6. Choose sounds: standard MIDI instruments, synth presets, or your own instruments designed in the instrument editor. "Make it retro" switches the whole song to 8-bit-style sounds in one click.
7. Play it back and balance the tracks in the mixer.
8. Select a bar range (e.g. bars 1–16), export WAV, import into Unity.

### 2.3 Operating environment
- **Linux:** CachyOS (Arch-based), x86_64, PipeWire audio (incl. its PulseAudio/JACK compatibility).
- **Windows:** 10 and 11, x64.
- **Hardware:** typical desktop/laptop; built-in or USB microphone; USB MIDI keyboard (optional); headphones recommended; no GPU required.

### 2.4 Constraints
- **C1** Must run natively on Linux, not via Wine.
- **C2** The Windows build is an `.exe` that runs without installing Python, Java, .NET or other runtimes.
- **C3** Works fully offline.
- **C4** Uses only libraries whose licenses allow giving the app to others **and selling a game that uses the exported audio** (a commercial release is possible, Q7).
- **C5** UI language is English.

### 2.5 Assumptions (all confirmed)
- **A1** Export formats are MIDI and WAV (Q1).
- **A2** Input is a clean acoustic guitar recorded with a microphone, mostly single notes (Q2/Q3).
- **A3** Songs are game-music length: typically 30 s – 5 min, at most ~16 tracks.
- **A4** General MIDI SoundFont quality is acceptable (Q4).
- **A5** "Retro sound" means synthesizer instruments you can design yourself; no specific console needs to be emulated (Q16).
- **A6** Recordings imported from Audacity are played at a fixed tempo (Q15).

---

## 3. Functional requirements

**Priority:** **M** = Must (MVP) · **S** = Should (v1.0) · **C** = Could (later) · **W** = Won't (not in this version)

### 3.1 Project management (PRJ)

| ID | Requirement | Prio |
|---|---|---|
| PRJ-01 | Create, open, save and "save as" song projects. | M |
| PRJ-02 | A project is a single file (e.g. `.gmsong`: a zip containing `song.json` plus recorded/imported audio takes) that works identically on Linux and Windows. | M |
| PRJ-03 | Song properties: title, author, tempo (BPM), time signature, key signature. | M |
| PRJ-04 | Tempo and time-signature changes within a song. | S |
| PRJ-05 | Named section markers (e.g. "Intro", "Loop A", "Boss phase 2"). | S |
| PRJ-06 | Autosave, crash recovery, recent-files list. | S |
| PRJ-07 | The file format is versioned; newer app versions can open older files. | M |
| PRJ-08 | A project contains everything needed to play it: the synth instruments it uses are stored inside the file, so the song sounds identical on your friend's computer. | M |

### 3.2 Tracks (TRK)

| ID | Requirement | Prio |
|---|---|---|
| TRK-01 | A song has any number of tracks: add, delete, rename, reorder, duplicate. | M |
| TRK-02 | Track types: **Fretted** (guitar, bass, ukulele…), **Drums**, **Melodic** (piano, synth leads, pads… entered via piano roll or MIDI keyboard). | M (fretted, drums) / S (melodic) |
| TRK-03 | Fretted tracks: number of strings (4–8), tuning, capo, highest fret (default 20 for acoustic, 24 for electric). Tuning presets: E standard, E♭ standard, Drop D, D standard, DADGAD, Open G, Open D, 4- and 5-string bass standard. Custom tuning per string. | M |
| TRK-04 | Each track has an instrument: a SoundFont instrument (e.g. steel-string acoustic guitar, finger bass, standard drum kit) or a synth instrument ([§3.10](#310-synthesizer-and-retro-sound-syn)). The track type does not limit the choice (a guitar track can use a synth lead). Changing the instrument never changes the notes. | M (SoundFont) / S (synth) |
| TRK-05 | Per-track volume, pan, mute, solo. | M |
| TRK-06 | Per-track color; show/hide a track in the score view. | C |

### 3.3 Score display (VIEW)

| ID | Requirement | Prio |
|---|---|---|
| VIEW-01 | Fretted tracks are shown as tablature. | M |
| VIEW-02 | Standard notation is shown above the tab staff, showing the same notes. | M |
| VIEW-03 | Display mode toggle (globally and per track): notation + tab / tab only / notation only. | M (first two) / S (notation only) |
| VIEW-04 | Tab shows rhythm (stems, flags, beams below the tab) in tab-only mode too, so note lengths are readable without notation. | M |
| VIEW-05 | Shows bar lines and bar numbers, time and key signatures, tempo, rests, ties, dots and tuplets. | M |
| VIEW-06 | Shows technique symbols (H, P, slides, bend arrows, P.M., ×, vibrato). | C |
| VIEW-07 | Drum tracks are shown in percussion notation. | S |
| VIEW-08 | Show a single track, or several tracks stacked as a score. | S |
| VIEW-09 | Layouts: page view (wrapping lines) and continuous horizontal view. | M (one) / S (both) |
| VIEW-10 | Zoom in and out. | M |
| VIEW-11 | During playback a cursor follows the current beat and the view scrolls automatically. | M |
| VIEW-12 | Light and dark theme. | C |

### 3.4 Note editing (EDIT)

| ID | Requirement | Prio |
|---|---|---|
| EDIT-01 | Keyboard-driven tab entry like Guitar Pro / TuxGuitar: the cursor sits on a string at a beat. Typing a number enters that fret (two-digit frets supported). Arrow keys move between strings and beats. | M |
| EDIT-02 | Set note duration (whole to 1/64) via keys or toolbar, plus dotted notes, triplets/tuplets, rests and ties. | M |
| EDIT-03 | Chords: several notes on the same beat, on different strings. | M |
| EDIT-04 | Mouse: click to place the cursor or select a note; drag or shift-click to select a range. | M |
| EDIT-05 | Unlimited undo/redo. | M |
| EDIT-06 | Copy, cut, paste and delete notes, beats and bars; insert, delete and duplicate bars. | M |
| EDIT-07 | Bar validation: highlight bars that are too short or too long, with an option to auto-fill rests. | S |
| EDIT-08 | **MIDI keyboard step entry:** pressing a key enters that note at the cursor with the selected duration (chords by pressing several keys). On fretted tracks the string and fret are chosen automatically (same algorithm as TRN-06). | S |
| EDIT-09 | Move a note to a neighboring string while keeping its pitch (re-fingering). | S |
| EDIT-10 | Transpose a selection or track by semitones, keeping or re-optimizing the fingering. | S |
| EDIT-11 | Hear a note when it is entered or selected (audition). | S |
| EDIT-12 | Techniques: hammer-on/pull-off, slide, bend (amount + release), palm mute, dead/muted note. | C |
| EDIT-13 | More techniques: vibrato, let ring, natural harmonic, accent, ghost note, slide in/out. | C |
| EDIT-14 | Repeat signs and 1st/2nd endings. | C |
| EDIT-15 | Second voice per bar (e.g. fingerstyle bass line + melody). | C |
| EDIT-16 | Enter notes on the notation staff or an on-screen fretboard; tab is derived automatically. | C |
| EDIT-17 | Customizable keyboard shortcuts and a shortcut cheat sheet. | C |

### 3.5 Drums (DRUM)

| ID | Requirement | Prio |
|---|---|---|
| DRUM-01 | Grid / step-sequencer editor: rows = kit pieces (kick, snare, closed/open hi-hat, toms, crash, ride…), columns = steps (1/8, 1/16, triplets). | M |
| DRUM-02 | Copy, paste and repeat patterns across bars. | M |
| DRUM-03 | Dynamics per hit: at least normal / accent / ghost. | S |
| DRUM-04 | Drum tracks are also shown in percussion notation (see VIEW-07). | S |
| DRUM-05 | Small library of starter patterns (rock beat, half-time, four-on-the-floor, fills). | C |

### 3.6 Other instruments (INST)

| ID | Requirement | Prio |
|---|---|---|
| INST-01 | Bass tracks use the same tab editor as guitar (4/5/6 strings). | M |
| INST-02 | Piano-roll editor for melodic tracks (synth leads, pads, piano…), displayed in standard notation. | S |

### 3.7 Recording, MIDI input and audio import (REC)

**Recording guitar in the app**

| ID | Requirement | Prio |
|---|---|---|
| REC-01 | Select the audio input device and channel (built-in mic, USB mic, audio interface input). | M |
| REC-02 | Live input level meter with clipping warning. | M |
| REC-03 | OS/browser voice processing (echo cancellation, noise suppression, automatic gain control) is **disabled** so the unaltered guitar signal is recorded. | M |
| REC-04 | Metronome during recording, with a configurable count-in (0–2 bars) at the song tempo. | M |
| REC-05 | Recording starts at the cursor / selected bar and is aligned to the song's beat grid. | M |
| REC-06 | Existing tracks can play while recording (play along with drums and bass). | S |
| REC-07 | Latency compensation (manual offset and/or calibration routine) so recorded notes line up with the grid. | S |
| REC-08 | Every raw take (recorded or imported) is stored in the project and can be played back. | M |
| REC-09 | A stored take can be re-transcribed later with different settings. | S |
| REC-10 | A single take can be at least 10 minutes long. | M |
| REC-11 | Built-in chromatic tuner using the same input. | S |
| REC-12 | Recording without a metronome (free tempo), with tempo detection afterwards. | C |
| REC-13 | Punch-in: record over a selected bar range and replace only those bars. | C |

**Importing audio files**

| ID | Requirement | Prio |
|---|---|---|
| REC-20 | Import a WAV file (e.g. exported from Audacity) as a take for transcription. Supported: PCM 16/24-bit and 32-bit float; 44.1, 48 and 96 kHz; mono or stereo (mixed down to mono). | M |
| REC-21 | **Alignment step** after import: you enter the tempo the take was played at (typed in or tapped) and set the position of the first downbeat in a waveform view. The app suggests the downbeat from the first detected note. Metronome clicks play over the audio so you can check the alignment and nudge it. | M |
| REC-22 | Automatic tempo detection for imported files. | C |
| REC-23 | Other formats: FLAC, OGG, MP3. | C |
| REC-24 | Drag and drop an audio file onto a track to import it there. | C |

**MIDI keyboard**

| ID | Requirement | Prio |
|---|---|---|
| REC-30 | Detect connected MIDI keyboards and select the MIDI input device (hot-plugging supported). | S |
| REC-31 | Play the selected track's instrument live from the MIDI keyboard (velocity-sensitive). | S |
| REC-32 | **Real-time MIDI recording:** record what you play on the MIDI keyboard into a track, with metronome and count-in, quantized like transcription (TRN-05). On fretted tracks string and fret are assigned automatically. | S |
| REC-33 | Sustain pedal support during live playing and recording. | C |

### 3.8 Transcription (TRN)

| ID | Requirement | Prio |
|---|---|---|
| TRN-01 | Convert a take into note events (pitch, start, duration, velocity), entirely offline on the local machine. | M |
| TRN-02 | **Single-note lines (melodies, riffs) are the primary use case** and are optimized first. | M |
| TRN-03 | **Single-note mode** (default): at most one note sounds at a time. It corrects octave errors caused by the acoustic guitar's strong overtones (prefers the fundamental) and detects repeated notes of the same pitch as separate notes. | M |
| TRN-04 | Chords and arpeggios (polyphonic mode), as best effort. | C |
| TRN-05 | Quantize note starts and lengths to a selectable grid (1/4, 1/8, 1/16, 1/32, triplets) with adjustable strength. | M |
| TRN-06 | Automatically assign each note a string and fret: only positions that are playable in the track's tuning and capo, minimizing hand movement. | M |
| TRN-07 | Let the user set a preferred fret region (e.g. "around fret 5") for the automatic fingering. | S |
| TRN-08 | Restrict detection to the instrument's range (e.g. E2–C6 for a 20-fret guitar in standard tuning) and ignore very short or quiet artifacts such as string and room noise (configurable minimum length and threshold). | M |
| TRN-09 | Preview the result before inserting it: accept (insert into the track at the take's position), discard, or re-run with different settings. | M |
| TRN-10 | A/B listening: original recording vs. synthesized transcription, or both together. | S |
| TRN-11 | Transcription runs in the background with a progress indicator; the UI stays responsive and the job can be cancelled. | M |
| TRN-12 | Show the take's waveform aligned under the transcribed notes to make errors easy to spot. | C |
| TRN-13 | Detect techniques from audio (bends, slides, vibrato, hammer-ons). | W |

### 3.9 Playback (PLAY)

| ID | Requirement | Prio |
|---|---|---|
| PLAY-01 | Play, pause, stop, play from cursor; the space bar toggles play/pause. | M |
| PLAY-02 | Loop playback of a selected bar range. | M |
| PLAY-03 | All sound is synthesized from the notes: SoundFont instruments (a General MIDI SoundFont ships with the app) and synth instruments ([§3.10](#310-synthesizer-and-retro-sound-syn)). | M (SoundFont) / S (synth) |
| PLAY-04 | Load a custom SoundFont (`.sf2` / `.sf3`). | C |
| PLAY-05 | Mixer: per-track volume, pan, mute, solo, and a master volume. | M |
| PLAY-06 | Master level meter. | S |
| PLAY-07 | Metronome can be switched on during playback. | M |
| PLAY-08 | Playback speed 25–200 % without changing the song tempo (for practicing). | S |
| PLAY-09 | Playback sounds exactly like the WAV export (same audio engine, same mix, same effects). | M |
| PLAY-10 | Select the audio output device. | S |
| PLAY-11 | Techniques are audible: bends and slides as pitch bends, palm mutes and dead notes as muted sounds. | C |

### 3.10 Synthesizer and retro sound (SYN)
A built-in synthesizer lets you create and tweak your own instruments, aimed at retro / 8-bit-style sounds but not limited to them.

**Synth engine and instrument editor**

| ID | Requirement | Prio |
|---|---|---|
| SYN-01 | Synth instruments can be selected as the instrument of any track. | S |
| SYN-02 | **Instrument editor**, oscillator: waveform pulse (duty cycle 12.5 / 25 / 50 % or free), triangle, sawtooth, sine, noise; octave and fine tuning; mono or polyphonic with optional glide. | S |
| SYN-03 | Instrument editor, volume envelope (ADSR) and velocity sensitivity. | S |
| SYN-04 | Instrument editor, modulation: LFO for vibrato (pitch) and tremolo (volume) with rate, depth and delay; pitch envelope (e.g. falling pitch for drums and laser sounds); duty-cycle sweep. | S |
| SYN-05 | Instrument editor, filter: low-pass / high-pass with cutoff, resonance and an envelope amount. | S |
| SYN-06 | Changes in the editor are audible immediately while you play the instrument on the MIDI keyboard, the computer keyboard or an on-screen keyboard. | S |
| SYN-07 | A small visual display of the waveform and envelope shape. | C |
| SYN-08 | Second oscillator per instrument with mix level and detune (thicker sounds). | C |

**Presets**

| ID | Requirement | Prio |
|---|---|---|
| SYN-10 | Factory presets: 8-bit lead, 8-bit bass (triangle), pluck, pad, arpeggio-style lead, plus a synth drum kit. | S |
| SYN-11 | Save your own instruments as presets in a personal library and use them in any song. | S |
| SYN-12 | Export / import presets as files, e.g. to give them to your friend. | S |
| SYN-13 | "Randomize" button that creates a new random sound from the current one as a starting point. | C |

**Drums**

| ID | Requirement | Prio |
|---|---|---|
| SYN-20 | Synth drum kit: every kit piece (kick, snare, hi-hat, crash, toms) is a small synth sound (noise or tone, pitch sweep, decay) that can be edited like an instrument. | S |

**Effects and retro tools**

| ID | Requirement | Prio |
|---|---|---|
| SYN-30 | Bitcrusher effect per track and on the master: reduce bit depth (1–16 bit) and sample rate (e.g. 4–44 kHz). Works on any instrument, including SoundFont ones. | S |
| SYN-31 | **"Make it retro" preset:** one click assigns 8-bit-style synth presets to all tracks based on their role: lead → pulse 25 %, second guitar → pulse 12.5 %, bass → triangle, drums → synth drum kit. Fully reversible; notes are never changed. | S |
| SYN-32 | Echo / delay effect per track. | C |
| SYN-33 | Chords on a mono synth instrument can be played as fast arpeggios (classic chiptune trick), at a selectable speed. | C |
| SYN-34 | FM synthesis mode (the sound of 16-bit consoles like the Mega Drive / Genesis), with presets. | C |
| SYN-35 | Wavetable oscillator: draw your own single-cycle waveform. | C |
| SYN-36 | "Authentic mode": limit simultaneous voices like old consoles (e.g. 2 pulse, 1 triangle, 1 noise) and warn when a song exceeds that. | C |
| SYN-37 | Export a single synth sound as a short WAV, e.g. for retro sound effects in your game (jump, coin, hit). | C |

### 3.11 Export and import (EXP)

| ID | Requirement | Prio |
|---|---|---|
| EXP-01 | Export the full mix as WAV. | M |
| EXP-02 | Export range: whole song, selected bars, or a named section. | M |
| EXP-03 | Sample rate 44.1 kHz or 48 kHz; 16-bit. | M |
| EXP-04 | 24-bit and 32-bit float WAV. | S |
| EXP-05 | End of export: include the release tail, or cut exactly at the end of the range with a few-millisecond fade to avoid clicks. A hard cut at the bar line gives a basic loopable file for Unity. | M |
| EXP-06 | Normalize / peak-limit (e.g. to −1 dBFS). | S |
| EXP-07 | Export MIDI (`.mid`, type 1, one MIDI track per app track, tempo map included). | M |
| EXP-08 | Import MIDI files as new tracks. | S |
| EXP-09 | **Stems:** one WAV per track (or per selected track), all sample-aligned and the same length, for layered/adaptive music in Unity. | C |
| EXP-10 | **Seamless loop export:** notes still ringing after the loop end are mixed back onto the start, so even sounds with long tails loop without a gap or click. | C |
| EXP-11 | Export a JSON sidecar with tempo, time signature and section positions (in seconds and bars) so Unity scripts can sync gameplay to the beat. | C |
| EXP-12 | Import Guitar Pro files (`.gp3`/`.gp4`/`.gp5`/`.gpx`/`.gp`). | C |
| EXP-13 | Export OGG Vorbis (smaller files). | C |
| EXP-14 | Export MusicXML (for MuseScore) and print / PDF the tab. | C |

### 3.12 Settings (SET)

| ID | Requirement | Prio |
|---|---|---|
| SET-01 | Audio input/output device selection; buffer/latency setting where the platform allows it. | M |
| SET-02 | MIDI input device selection. | S |
| SET-03 | Default tuning, default export format, location of the personal preset library. | S |

---

## 4. Non-functional requirements (NFR)

### 4.1 Platforms and distribution

| ID | Requirement | Prio |
|---|---|---|
| NFR-01 | Runs natively on CachyOS / Arch Linux x86_64 with PipeWire. | M |
| NFR-02 | Runs on Windows 10 and 11 (x64). | M |
| NFR-03 | Windows: shipped as a portable single `.exe` and/or an installer. Needs no admin rights and no additional runtime installs. | M |
| NFR-04 | Linux: shipped as an AppImage (runs on any distro) and runnable from source. | M |
| NFR-05 | Linux: PKGBUILD for the AUR. | C |
| NFR-06 | Windows builds are produced by CI (GitHub Actions in the private repository), so no Windows PC is needed. | S |
| NFR-07 | macOS support. | W |

### 4.2 Performance

| ID | Requirement | Prio |
|---|---|---|
| NFR-10 | Editing feels instant: the view updates < 200 ms after an edit for a song with 200 bars × 6 tracks. | M |
| NFR-11 | Playback starts < 300 ms after pressing play. | M |
| NFR-12 | No audio dropouts during recording or playback on typical hardware, with up to 8 tracks including synth instruments and effects. | M |
| NFR-13 | Transcribing 60 s of audio takes ≤ 60 s on a mid-range CPU without GPU. | S |
| NFR-14 | WAV export of a 3-minute song with 8 tracks takes ≤ 30 s. | S |
| NFR-15 | Live playing from the MIDI keyboard: ≤ 50 ms from key press to sound (goal: ≤ 30 ms). | S |

### 4.3 Transcription quality
Initial targets, to be validated in milestone M0 against a test set of 5–10 of your own acoustic recordings:

| ID | Requirement | Prio |
|---|---|---|
| NFR-20 | **Primary target:** clean single-note acoustic guitar, recorded with a mic in a quiet room (live or imported WAV), up to 16th notes at 120 BPM: ≥ 90 % of notes with correct pitch and position after quantization. | S |
| NFR-21 | Clean chords and arpeggios: ≥ 75 % of notes correct. | C |
| NFR-22 | Every transcribed note can be fixed with the normal tab editor, with no special correction mode needed. | M |

### 4.4 Reliability and data

| ID | Requirement | Prio |
|---|---|---|
| NFR-30 | No data loss: saves are atomic (write a temp file, then rename); autosave per PRJ-06. | M |
| NFR-31 | Project data and presets are human-readable, documented, versioned JSON. | M |
| NFR-32 | Fully offline; no telemetry; audio never leaves the machine. | M |

### 4.5 Usability

| ID | Requirement | Prio |
|---|---|---|
| NFR-40 | All frequent editing operations have keyboard shortcuts. | M |
| NFR-41 | Clear error messages (e.g. "No microphone found", "Input is clipping – lower the gain"). | M |
| NFR-42 | A first-time user can enter a 4-bar riff by hand within 5 minutes without reading documentation. | S |
| NFR-43 | The recording dialog shows short tips for acoustic guitar: use headphones (keeps the metronome out of the mic), record in a quiet room, place the mic about 20–30 cm away pointing where the neck meets the body. | S |
| NFR-44 | The instrument editor is usable without synthesizer knowledge: every control has a tooltip explaining what it does to the sound. | S |

### 4.6 Maintainability and licensing

| ID | Requirement | Prio |
|---|---|---|
| NFR-50 | Source code lives in a private GitHub repository. | M |
| NFR-51 | Automated tests for the song model, fret assignment, quantization, file format, MIDI export and the synth engine. | M |
| NFR-52 | CI builds and tests on Linux and Windows for every push. | S |
| NFR-53 | All dependency licenses allow free redistribution of the app; listed in a `THIRD_PARTY_LICENSES` file. | M |
| NFR-54 | The bundled SoundFont's license explicitly allows using rendered audio in commercial products (e.g. GeneralUser GS, FluidR3_GM). | M |

---

## 5. Conceptual data model

```text
Song
├─ meta: title, author, formatVersion, createdAt, modifiedAt
├─ tempoMap:        [{ bar, bpm }]
├─ timeSignatures:  [{ bar, numerator, denominator }]
├─ keySignature
├─ markers:         [{ bar, name }]
├─ instruments: SynthPatch[]            (copies of all synth instruments used, see PRJ-08)
├─ tracks: Track[]
│   ├─ name, type (fretted | drums | melodic), color
│   ├─ instrument: { kind: soundfont, bank, preset } | { kind: synth, patchId } | { kind: synthKit, patchIds per kit piece }
│   ├─ effects: bitcrusher { bits, sampleRate }, echo { time, feedback, mix }
│   ├─ volume, pan, mute, solo
│   ├─ fretted only: stringCount, tuning [MIDI note per string], capo, maxFret
│   └─ bars: Bar[]
│       └─ beats: Beat[]
│           ├─ duration (value, dots, tuplet), isRest
│           ├─ beat effects (reserved for techniques, later)
│           └─ notes: Note[]
│               ├─ fretted:         string, fret   (pitch is derived from tuning + capo)
│               ├─ drums / melodic: pitch (MIDI note number)
│               ├─ velocity, tiedToPrevious
│               └─ note effects (reserved for techniques, later)
└─ takes: [{ id, source (mic | file), originalFileName, file, sampleRate,
             trackId, startBar, tempo, firstDownbeatOffset, latencyOffset, transcriptionSettings }]

SynthPatch
├─ id, name, formatVersion
├─ oscillator: waveform (pulse | triangle | saw | sine | noise), duty, octave, fineTune, (osc2 later)
├─ voice: mono | poly, glideTime
├─ ampEnvelope:   { attack, decay, sustain, release }, velocitySensitivity
├─ pitchEnvelope: { startOffsetSemitones, time }
├─ lfo:           { target (pitch | volume | duty | cutoff), rate, depth, delay }
└─ filter:        { type (lowpass | highpass), cutoff, resonance, envelopeAmount }
```

On disk:
- Songs: `my-song.gmsong` = zip { `song.json`, `audio/take-001.flac`, … }
- Presets: `my-lead.gminst` (JSON `SynthPatch`) in the personal preset library folder.

---

## 6. Technical architecture

### 6.1 Chosen stack: Electron + TypeScript (Q8)

The hardest parts of this app already exist as mature open-source libraries or browser features:

1. **Rendering standard notation + tab.** Music engraving is notoriously hard to write yourself. [alphaTab](https://www.alphatab.net/) renders notation, tab and percussion staves for multiple tracks and can show a playback cursor.
2. **Transcription.** [Spotify Basic Pitch](https://github.com/spotify/basic-pitch-ts) has an official TypeScript version running on TensorFlow.js. Classic pitch-tracking algorithms (YIN / pYIN) are small and well suited to single-note lines.
3. **Reliable audio and MIDI on Linux and Windows.** Electron bundles Chromium. Its audio stack works with PipeWire/PulseAudio and with Windows audio, and the Web MIDI API talks to USB MIDI keyboards on both.
4. **Synthesis.** Oscillators, envelopes, filters and a bitcrusher are straightforward with the Web Audio API. The same code renders offline to WAV.

The whole app is one language, and `electron-builder` produces both a Linux AppImage and a Windows `.exe`.

| Concern | Choice | License |
|---|---|---|
| App shell, packaging | Electron + electron-builder (AppImage / pacman for Linux; NSIS installer + portable `.exe` for Windows) | MIT |
| UI | TypeScript + React (or Svelte) | MIT |
| Notation/tab rendering, playback cursor | alphaTab (used for display only; playback comes from our own audio engine) | MPL-2.0 |
| Recording, metronome | Web Audio API (`getUserMedia` + AudioWorklet) | – |
| MIDI keyboard input | Web MIDI API (permission granted via Electron's permission handler) | – |
| WAV import | Web Audio `decodeAudioData` (or a small WAV parser for 24-bit/float edge cases) | – |
| Transcription | Basic Pitch (`@spotify/basic-pitch`) and/or a YIN/pYIN pitch tracker with onset detection, in a Web Worker. Pick in M0 by accuracy on your recordings. | Apache-2.0 / own code |
| Tuner | YIN / McLeod pitch method (e.g. `pitchy`) | MIT |
| **Audio engine** (playback + export) | Own code: schedules notes from the song model to instruments, then per-track effects, then the mixer. The same graph runs in real time (`AudioContext`) and offline for export (`OfflineAudioContext`), which guarantees PLAY-09. | – |
| SoundFont instruments | SpessaSynth (SF2/SF3 synthesizer for Web Audio, supports offline rendering). Verify in M0. | Apache-2.0 |
| Synth instruments + effects | Own AudioWorklet: oscillators, envelopes, LFO, filter, bitcrusher, echo | – |
| MIDI file export/import | `@tonejs/midi` | MIT |
| Song model, editing, quantization, fret assignment | Own code | – |
| SoundFont | GeneralUser GS or FluidR3_GM (licenses allow commercial use of rendered audio) | permissive |
| Project files | JSON + zip (e.g. `fflate`) | MIT |
| Tests, CI | Vitest, Playwright; GitHub Actions matrix (Linux + Windows) | – |

**Key design decisions**
- **Own song model as single source of truth.** alphaTab is a renderer, not an editor. Every edit changes our model ([§5](#5-conceptual-data-model)), which is then converted into an alphaTab score for display. Cursor, selection and click hit-testing are our own code, using alphaTab's layout position information.
- **Own audio engine instead of alphaTab's built-in player.** alphaTab's player only plays SoundFonts. The synthesizer, its live editing and the effects need SoundFont and synth voices to run through one mixer, live and offline. Our engine reports the playback position to alphaTab, which moves the cursor (sync to be verified in M0).
- **One fingering algorithm** for transcription, MIDI keyboard step entry and real-time MIDI recording.

### 6.2 Architecture overview

```text
 Recorder (mic) ──┐
                  ├─audio─▶ Transcription worker ──notes──▶  Song model   ◀──edits──── Editor UI
 WAV import ──────┘         pitch detection → single-note    + undo stack               tab / drum grid /
 (+ alignment step)         filter → quantize → frets              ▲  │                 piano roll /
                                                                   │  │                 instrument editor
 MIDI keyboard ───notes (step entry, real-time recording)──────────┘  │
       │                                                              ├──▶ alphaTab: notation + tab, cursor
       │                                                              ├──▶ MIDI exporter (.mid)
       └──live notes─────────────────────────────────────────────────▶└──▶ Audio engine ──▶ speakers
                                                                           SoundFont voices      │
                                                                           synth voices          └─▶ WAV export
                                                                           bitcrusher, mixer

 Main process (Node.js): file I/O, autosave, preset library, native menus and dialogs, settings. Talks to the UI via IPC.
```

### 6.3 Transcription pipeline
1. **Get audio:** either record (mono, 44.1/48 kHz, voice processing off, start aligned to the bar after the count-in) or import a WAV and align it (REC-21: tempo + first downbeat).
2. **Detect:** run the pitch detector chosen in M0. Basic Pitch (input resampled to 22.05 kHz) or YIN/pYIN pitch tracking with onset detection. Output: note events (onset in s, offset in s, MIDI pitch, amplitude).
3. **Filter:** drop notes outside the instrument range, shorter than the minimum length or below the threshold. In single-note mode, keep only one note at a time and fix octave errors (a note exactly one octave above its neighbors with a weak fundamental is usually an overtone).
4. **Align and quantize:** convert seconds to beats using the tempo, downbeat offset and latency offset, then snap to the grid.
5. **Build rhythm:** fill gaps with rests and split notes that cross bar lines into tied notes.
6. **Assign frets:** dynamic programming (Viterbi-style) over all playable (string, fret) options per note. Cost = fret jumps + distance from the preferred region, with a small bonus for open strings.
7. **Preview:** the user accepts and the notes are inserted into the track.

### 6.4 Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| **Python** + PySide6 (Qt) + basic-pitch + pyfluidsynth + mido | Python; strong audio/ML ecosystem | No good notation+tab renderer in Python, so alphaTab would end up embedded in a Qt WebEngine view anyway (two languages plus a bridge). Packaging Qt WebEngine + an ML runtime with PyInstaller is large and fragile. The `.exe` must be built on Windows. |
| **Tauri** (Rust + web UI) | Small binaries, modern | On Linux it uses the system WebKitGTK webview, where microphone access, Web Audio and Web MIDI are less reliable than in Chromium; Rust backend. |
| **C++ with JUCE** | Professional audio quality, lowest latency, could host VST instruments | Much more effort; notation/tab rendering would have to be written from scratch. |
| **Extend TuxGuitar** (Java) | Editor already exists | Old codebase; transcription and synthesizer still have to be built; Java distribution. |

Electron's downsides are a large download (~100–150 MB) and higher memory use. That is acceptable for a desktop music tool.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Acoustic guitar through a mic: strong overtones, body resonance, room and string noise | Octave errors, ghost notes | Single-note mode with octave correction (TRN-03); thresholds (TRN-08); recording tips (NFR-43); compare two detection methods in M0 |
| Imported WAVs are not aligned with the beat grid | Wrong rhythms after quantization | Alignment step (REC-21); you play to a fixed tempo in Audacity (A6) |
| Fingering is ambiguous (the same pitch exists on several strings) | Tab looks "wrong" even when pitches are right | Preferred fret region (TRN-07); re-fingering shortcut (EDIT-09) |
| Human timing produces messy rhythms after quantization | Strange note values | Metronome + count-in; adjustable grid and quantize strength; triplet detection off by default |
| Metronome bleeds into the mic | Ghost notes | Headphones (NFR-43); filter notes that match the click |
| alphaTab is not designed as an editor | Extra work for cursor/selection; re-render cost | Own model as source of truth; M0 verifies hit-testing, re-render speed and cursor sync |
| Own audio engine and synthesizer are extra work | Delays | Prototype in M0; synth starts small (one oscillator, ADSR, LFO, filter, bitcrusher), more only after v1.0 |
| Synthesizer scope creep (it's fun to build) | v1.0 never ships | Everything beyond SYN-01…31 is C; guitar → tab → WAV comes first (M1/M2) |
| MIDI keyboard latency too high in Chromium on Linux | Live playing feels sluggish | Measure in M0 (NFR-15); `latencyHint: "interactive"`, small PipeWire buffer size |
| Windows `.exe` built and tested without a Windows PC | Friend gets a broken build | CI on a Windows runner; the friend beta-tests each milestone |
| License problems (SoundFont, libraries) | Music can't be used in a commercial game | NFR-53, NFR-54 |

---

## 8. Release plan

The editor comes **before** transcription on purpose: transcription output always needs some correcting, so a solid editor has to exist first.

| Milestone | Content | Done when |
|---|---|---|
| **M0 Tech spike** | Electron window shows an alphaTab score from hard-coded data. The own audio engine plays it with a SoundFont voice and a square-wave synth voice, moves the alphaTab cursor, and renders both to a WAV offline. Record 10 s from the mic and import a WAV. The MIDI keyboard plays the synth voice (measure latency). Compare Basic Pitch vs. YIN/pYIN on 5–10 of your acoustic recordings. CI produces an AppImage and an `.exe`; your friend starts the `.exe`. | Every part works on both OSes. Transcription method and audio engine approach are decided. |
| **M1 Tab editor** | Song/track model, manual tab entry, notation + tab view with toggle, SoundFont playback, mixer, save/load, WAV and MIDI export | You can write a guitar melody by hand and export it |
| **M2 Record, import & transcribe** | Recording dialog, metronome/count-in, WAV import with alignment, single-note transcription, quantization, fret assignment, preview/accept | You can record or import an 8-bar melody and get usable tab |
| **M3 Band** | Bass, drum grid editor, piano roll, MIDI keyboard (live, step entry, real-time recording), sections, MIDI import | You can arrange a full song with guitar, bass, drums and keys |
| **M4 Synth** → **v1.0** | Synth engine, instrument editor, factory presets, personal preset library, synth drum kit, bitcrusher, "Make it retro" | You can design your own retro instruments and export a finished retro track for Unity |
| **M5 Later** | Techniques (editing + playback), stems, seamless loops with tail wrap, beat-sync JSON, FM synthesis, chip arpeggios, polyphonic transcription, sound-effect export, Guitar Pro import, themes, … | (open-ended) |

---

## 9. Acceptance scenarios for v1.0 (after M4)

1. On CachyOS, create a song at 120 BPM in 4/4, add an acoustic guitar track in standard tuning, and record an 8-bar single-note melody with the mic and a 1-bar count-in. Within a minute it appears as tab with notation above it. After fixing at most a few notes, it plays back correctly.
2. Import a WAV of a melody recorded in Audacity at 100 BPM, set the tempo and first downbeat, and transcribe it into tab.
3. Switch the view to "tab only". The rhythm is still readable.
4. Enter a 4-bar bass line by hand using only the computer keyboard.
5. Record a 4-bar synth pad part in real time with the MIDI keyboard; it is quantized and shown in notation.
6. Add a drum track and program a basic rock beat in the grid.
7. Click "Make it retro": the guitar becomes a pulse-wave lead, the bass a triangle, the drums a synth kit, and the song sounds like 8-bit console music. Click again to switch back to the SoundFont instruments.
8. Open the instrument editor, change the lead's waveform, envelope and vibrato while playing it on the MIDI keyboard, and hear each change immediately. Save it as a preset and use it in a second song.
9. Export bars 1–8 as a 48 kHz / 16-bit WAV, cut exactly at the end. In Unity, with *Loop* enabled on the AudioSource, it loops without a gap.
10. Export MIDI. It opens in another program (e.g. MuseScore or TuxGuitar) with the correct notes and tempo.
11. Your friend runs the `.exe` on Windows 11 without installing anything else, opens the project file from the scenarios above, and hears exactly the same result, including your custom synth instruments.

---

## 10. Suggestions beyond the original request

These are already in the requirements above. They are collected here because they matter especially for game music:

- **"Make it retro"** (SYN-31): one click to hear your song as 8-bit music, and one click back.
- **Bitcrusher** (SYN-30): cheap to build, and works on any instrument for a lo-fi sound.
- **MIDI keyboard for everything that isn't guitar** (EDIT-08, REC-32): bass lines, chords and pads are much faster to play in than to type.
- **Sound effects** (SYN-37, later): the same synth can make retro game sound effects (jump, coin, hit) and export them as WAV.
- **Sections** (PRJ-05 + EXP-02): export "intro" and "loop" as separate files, a classic game-music pattern (intro plays once, then the loop repeats).
- **Later, for adaptive music:** stems (EXP-09), seamless loops with long tails (EXP-10) and beat-sync data (EXP-11).
- **Tuner** (REC-11): reuses the pitch detection and saves you a separate app.

---

## 11. Decisions from the Q&A rounds

| # | Question | Answer | Consequence |
|---|---|---|---|
| Q1 | Export formats? | MIDI and WAV | EXP-01…07 |
| Q2 | Guitar type and recording setup? | Acoustic guitar, microphone; also import WAVs from Audacity | WAV import + alignment (REC-20/21) is Must; acoustic recording tips (NFR-43) |
| Q3 | Single notes or chords? | Mostly clean single notes | Single-note mode is the primary transcription target (TRN-02/03); polyphonic is C |
| Q4 | Sound quality? | General MIDI quality is fine; 8-bit / 16-bit sounds would be nice | Synthesizer section ([§3.10](#310-synthesizer-and-retro-sound-syn)) |
| Q5 | Recorded audio in the final mix? | No, everything is played from the notes (for a retro sound) | No audio tracks; takes are kept for transcription only |
| Q6 | Friend's role? | Mainly listens; may use it for own projects; no online collaboration | Self-contained project files (PRJ-08); preset export (SYN-12); no collaboration features |
| Q7 | Commercial release? | Possibly, at some point | Licenses must allow commercial use (C4, NFR-53/54) |
| Q8 | Tech stack? | Electron + TypeScript | [§6](#6-technical-architecture) |
| Q9 | Playing techniques in v1? | No | EDIT-12/13, VIEW-06, PLAY-11 moved to C |
| Q10 | Drum input? | Grid is fine | DRUM-01 |
| Q11 | MIDI keyboard? | Yes, owns one | MIDI keyboard live play, step entry, real-time recording (REC-30…32, EDIT-08) |
| Q12 | Adaptive music in v1? | No | Stems, tail-wrapped loops, beat-sync data moved to C (EXP-09…11) |
| Q13 | Private GitHub repo? | Yes | CI builds for Linux + Windows (NFR-06, NFR-52) |
| Q14 | UI language? | English | C5 |
| Q15 | Fixed tempo when recording in Audacity? | Yes | Alignment = tempo + first downbeat (REC-21); tempo detection stays C |
| Q16 | Which retro sound? | No specific console; wants to create and modify instruments with a synthesizer | Instrument editor and presets (SYN-02…13) |

---

## Document history

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-10-25 | Initial draft |
| 0.2 | 2026-10-25 | Answers to Q1–Q5 and Q8: acoustic guitar + mic, WAV import with alignment, single-note transcription as primary target, retro sound section, own audio engine, stack confirmed |
| 0.3 | 2026-10-25 | Answers to Q6, Q7, Q9–Q16: synthesizer with instrument editor and presets, MIDI keyboard input, techniques and adaptive-music features moved to later, milestones split into Band (M3) and Synth (M4) |
