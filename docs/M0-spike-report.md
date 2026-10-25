# M0 tech spike: report

| | |
|---|---|
| **Date** | 2026-10-25 |
| **Goal** | Prove every risky part of the chosen stack works on Linux and Windows before building the real app (REQUIREMENTS.md §8). |
| **Status** | Done except two checks. You confirmed playback, the synth switch and WAV export, and chose Basic Pitch for transcription. The Windows `.exe` builds and starts on CI. Still open: MIDI keyboard latency (waiting for a cable) and a hands-on test of the `.exe` by your friend. See [§4](#4-what-still-needs-you). |

## 1. What was built

A throwaway-quality but working Electron app with four tabs:

| Tab | What it proves |
|---|---|
| **Score & playback** | alphaTab renders our own song model as notation + tab or tab only. Click a note to select it. Play uses our own audio engine (SoundFont guitar + pulse-wave synth bass) with a cursor. Each track can switch between SoundFont and synth. Export WAV and MIDI. Buttons for a random edit and a 200-bar × 6-track stress test show re-render times. |
| **Record & import** | Mic recording with voice processing off, level meter with clipping warning, metronome with 1-bar count-in. WAV import (e.g. from Audacity). Play or save the take. |
| **MIDI keyboard** | Web MIDI input (hot-plugging), live synth/SoundFont sounds, latency readout. Computer keys A–K as fallback. |
| **Transcription lab** | Runs both candidate methods on the same take: a classic pitch tracker (McLeod pitch method via `pitchy`) and Spotify's Basic Pitch (TensorFlow.js in a Web Worker). Optional reference notes give an accuracy score. Results can be played and shown as quantized tab. |

## 2. Results verified so far

| Item | Result | How it was checked |
|---|---|---|
| Notation + tab rendering | ✅ Correct clefs (guitar treble 8vb, bass in bass clef 8vb); tab-only mode keeps rhythm stems | Browser preview, screenshots |
| Edit → re-render (NFR-10: < 200 ms) | ✅ Demo song 48–97 ms; 200 bars × 6 tracks 122–181 ms | "Random edit" timings (alphaTab paints off-screen parts lazily as you scroll) |
| Click hit-testing | ✅ Clicking a note reports track, bar, beat, string and fret | Browser preview |
| Playback + cursor | ✅ Cursor follows the beat across all tracks; playback stops at the end; sound confirmed by you | Browser preview, your test |
| Offline WAV render (PLAY-09) | ✅ 9.5 s of 48 kHz stereo rendered in 232 ms, SoundFont and synth tracks both audible in the signal, valid WAV header | Called the renderer directly in the page; WAV encoder unit test |
| MIDI export | ✅ Tempo, tracks, instruments and note timing survive a round trip | Unit test |
| Recording pipeline | ✅ 2 s captured, pitch detected correctly, level meter hits full scale | A generated 440 Hz tone fed in place of the microphone |
| Transcription, synthesized test melody (17 notes) | ✅ Pitch tracker 17/17 in ~0.2–0.35 s; Basic Pitch 17/17 + 1 extra note in 3.7 s (GPU backend, in a worker) | Transcription lab → "Use demo melody as test take" |
| Quantization + automatic fingering | ✅ The transcribed tab is identical to the hand-written demo tab (same notes, rhythm, strings and frets) | Transcription lab → "Show as tab" |
| Electron production build | ✅ Starts via the `app://` protocol, score renders (~65 ms), preload bridge works, no console errors | `npm run smoke` (headless) |
| Packaged Linux AppImage | ✅ Builds (128 MB) and passes the same smoke test, locally and on CI (score rendered in 54 ms, no errors) | `npm run dist:linux`, then smoke test on `release/linux-unpacked`; GitHub Actions on `ubuntu-latest` |
| Packaged Windows `.exe` | ✅ Installer and portable `.exe` build on CI. The unpacked app ran the smoke test for about 5 s and exited with 0 (passed). That first run couldn't rule out a missing exit code, so the check now treats one as a failure and also fails the build. | GitHub Actions on `windows-latest`, run for commit `9276de8` |
| Unit tests | ✅ 22 tests: timing, note parsing, comparison, single-note filter, pitch tracker on synthetic plucked notes, fret assignment, quantization, WAV, MIDI | `npm test` |

## 3. Findings and decisions

1. **alphaTab as a pure renderer works.** We build its score from our own model through its model API, draw our own cursor and selection, and use its layout bounds for hit-testing. → Keep this design (REQUIREMENTS.md §6.1).
2. **The own audio engine works.** Live playback uses SpessaSynth's AudioWorklet synth, which supports sample-exact scheduled notes. WAV export uses SpessaSynth's processor directly in JavaScript (deterministic, no Web Audio quirks), mixed with our oscillator voices in an OfflineAudioContext. The fallback (alphaTab's built-in player) isn't needed.
3. **Transcription: Basic Pitch is chosen.** Both methods were perfect on the synthesized test melody, and the pitch tracker was 10–20× faster there. On your real acoustic recordings, Basic Pitch worked better, which matters more than speed. → Use Basic Pitch with the single-note filter for M2. The pitch tracker stays in the code only as long as the lab needs it.
4. **Latency needs a real measurement.** The browser preview reported 10.7 ms base + 40 ms output latency, about 51 ms, right at the NFR-15 limit. If Electron shows the same on your machine, try starting it with `PULSE_LATENCY_MSEC=10 npm run dev`. Chromium talks to PipeWire through its PulseAudio layer, which should honor that variable.
5. **Problems found and fixed during the spike:**
   - TensorFlow.js 3.21 crashes inside Web Workers (it checks `!window`). Fixed with a one-line shim in the worker.
   - The live synth takes ownership of the SoundFont buffer it receives, which broke WAV export after playback. Fixed by giving each user its own copy.
   - alphaTab only renders into a visible container with a size. The headless smoke test therefore sets a screen size.
   - npm 12 blocks install scripts by default. esbuild's is approved in `package.json` (`allowScripts`).
6. **Licenses are all permissive:** alphaTab MPL-2.0, SpessaSynth Apache-2.0, Basic Pitch Apache-2.0, TensorFlow.js Apache-2.0, pitchy MIT, @tonejs/midi MIT, Electron MIT. The spike uses the small Sonivox SoundFont bundled with alphaTab (Apache-2.0). It sounds basic and its origin is mixed, so it should be replaced with GeneralUser GS before release (NFR-54). A `THIRD_PARTY_LICENSES` file (NFR-53) is still to do.
7. **Spike shortcuts, not to keep:** notes crossing a bar line are shortened instead of tied; no latency compensation for recordings; no project save/load; one voice per bar; default Electron icon; no Content Security Policy.

## 4. What still needs you

Your test on 2026-10-25:

| Check | Result |
|---|---|
| Sound: playback, SoundFont ⇄ synth switch | ✅ works |
| WAV export | ✅ works |
| Transcription on your recordings | ✅ Basic Pitch worked better than the pitch tracker → chosen |
| MIDI keyboard | ⏳ later (cable missing) |

Still open:

1. **MIDI keyboard.** Once you have the cable: MIDI keyboard tab → Connect. Play some notes and write down the "Estimated key → sound" value. Does it feel instant? If it's above 50 ms, try `PULSE_LATENCY_MSEC=10 npm run dev`.
2. **Windows, hands-on.** The `.exe` starts on a Windows CI machine, but nobody has listened to it yet. GitHub Actions builds `GameMusicApp-0.0.1-portable.exe` and `GameMusicApp-0.0.1-setup.exe` for every pull request and every push to `main` (download them under *Actions → Build → Artifacts*). Your friend should see the score and hear playback after double-clicking the portable `.exe`.

## 5. Next step

Start M1 (tab editor): the real song model with ties, voices and save/load, keyboard tab entry, and the mixer. The MIDI keyboard latency check can happen in parallel; it only affects M3.
