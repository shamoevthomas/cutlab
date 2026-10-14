# CutLab

Personal video editor for Thomas. It rebuilds the features of CapCut desktop, Pro features included, with no paywall, no account and no watermark. Internal use only, never distributed. None of CapCut's code, assets or libraries is used.

## Install on the Mac (first time)

```bash
# Node 20+ required: https://nodejs.org
cd capcut-clone
npm install
npm run electron        # builds the interface, then opens the app
```

`npm run dist:mac` makes a `.dmg` in `dist/`. It is unsigned, so the first time you open it you need right-click → Open.

Projects are saved in `~/Movies/CutLab/Projects/` (one folder per project, `project.json` + cover + 5 backups). Your video files stay where they are.

## Develop

| command | what it does |
| --- | --- |
| `npm run dev` | web version in the browser (projects stored in the browser) |
| `npm run electron:dev` | desktop app with hot reload |
| `npm test` | unit tests (timeline model, subtitles) |
| `xvfb-run -a npx playwright test` (Linux) / `npx playwright test` (Mac) | end-to-end test in the real Electron app: import → edit → 720p export checked with ffprobe |
| `npm run tokens` | regenerates `src/styles/tokens.css` from `replica/design/tokens.json` |

## Architecture

The full architecture is in `replica/architecture.md`.

- **Code layout:**
  - `src/model`: project, timeline operations (pure, tested), SRT.
  - `src/engine`: WebGL2 compositor, preview player, WebCodecs export, media probing.
  - `src/ui`: home, editor, timeline, inspector, asset panels, export.
  - `electron/`: window, file system, `media://` protocol with seeking support, dialogs.
- **Preview and export share the same renderer:** what you see is what gets exported.

## Phases

The feature list and progress are in `replica/features.csv` (`python3 ~/.claude/skills/replica-diff/parity.py replica/features.csv`).

- **P1 (done):** projects, import, multi-track timeline, preview, text, filters, adjustments, chroma key, transitions, keyframes, speed, SRT, MP4 export up to 4K/60.
- **P2:** auto captions (local Whisper), silence and filler-word removal, proxies, effects, LUTs, speed curves, free music library.
- **P3:** AI background removal, auto reframe, tracking, noise reduction / voice / normalisation, TTS, upscaling, stabilisation.
- **P4:** multicam, templates, long video to shorts, translation/dubbing, generative AI, YouTube/TikTok publishing, editing assistant.
