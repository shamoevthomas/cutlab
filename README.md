# CutLab

Personal video editor for Thomas. It rebuilds the features of CapCut desktop, Pro features included, with no paywall, no account and no watermark. Internal use only, never distributed. None of CapCut's code, assets or libraries is used.

## Install

### Windows

**Easiest:** download the installer built by GitHub.
1. On GitHub, open **Actions → build → the latest green run**.
2. Download **CutLab-Windows**. It contains:
   - `CutLab-Setup-x.y.z.exe`: the installer, with a desktop shortcut.
   - `CutLab-Portable-x.y.z.exe`: runs without installing.
3. The `.exe` is not signed, so the first time SmartScreen shows a warning. Click **More info → Run anyway**.

**From the code** (needs Node 20+ from https://nodejs.org and Git for Windows):

```powershell
git clone https://github.com/shamoevthomas/cutlab.git
cd cutlab
npm install
npm run electron        # opens the app
npm run dist:win        # makes the installer in release\
```

### macOS

The **CutLab-macOS** artifact on the same Actions page contains the `.dmg`. It is unsigned, so the first time you open it, right-click → Open.

From the code:

```bash
git clone https://github.com/shamoevthomas/cutlab.git && cd cutlab
npm install
npm run electron        # or: npm run dist:mac
```

### Where projects are stored

Projects are saved in your **Videos** folder:
- `C:\Users\<you>\Videos\CutLab\Projects` on Windows.
- `~/Movies/CutLab/Projects` on Mac.

Each project is its own folder, with `project.json`, the cover and 5 backups. Your video files stay where they are. The `CUTLAB_DATA_DIR` environment variable moves the data folder elsewhere.

## Develop

| command | what it does |
| --- | --- |
| `npm run dev` | web version in the browser (projects stored in the browser) |
| `npm run electron:dev` | desktop app with hot reload |
| `npm test` | unit tests (timeline model, subtitles) |
| `npx playwright test` (Windows / Mac) · `xvfb-run -a npx playwright test` (Linux) | end-to-end test in the real Electron app: import → edit → 720p export checked with ffprobe |
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
