# Architecture: CutLab (a personal rebuild of CapCut desktop's features)

CutLab is a working name: a local app for Thomas only. It is a desktop app with no server, no accounts and no payments. The skill's default web/SaaS stack (Next.js, Postgres, Stripe, Resend) does not fit, so each layer below is swapped for its local equivalent.

## Stack

| layer | choice | why |
| --- | --- | --- |
| desktop shell | Electron (macOS arm64 + x64) | Chromium inside gives WebGL2 + WebCodecs (hardware H.264/HEVC via VideoToolbox) on the Mac; same stack as Thomas's existing React/Vite projects |
| UI | React 18 + TypeScript + Vite | already used in ClosersLab |
| styling | CSS variables from `replica/design/tokens.json` | tokens from replica-design; no runtime cost |
| state | Zustand + immer patches | the timeline needs fast updates and an undo/redo stack built from patches |
| preview engine | WebGL2 compositor (own shaders) fed by `<video>` / WebCodecs `VideoDecoder` | GPU compositing of tracks, transforms, blend modes, filters, masks, chroma key, keyframes in real time |
| render / export | the **same** WebGL2 compositor, frame by frame, encoded with WebCodecs `VideoEncoder` → mp4/mov muxer; audio via `OfflineAudioContext` | the preview and the export share one code path, so the export matches what you see frame for frame |
| media probing, proxies, audio-only export, stabilise, loudness | ffmpeg / ffprobe (bundled `ffmpeg-static`) in the Electron main process | proven, every format, vidstab, loudnorm, afftdn/arnndn |
| storage | one folder per project: `project.json` + `media/` (copy mode) + `cache/` (proxies, thumbs, waveforms, transcripts) in `~/Movies/CutLab/` | personal desktop app: a document file is simpler and more portable than a database; autosave with `.bak` rotation |
| library index | SQLite (better-sqlite3) `library.db` | fast home screen, search across projects and assets |
| AI, local | whisper.cpp (Metal) for ASR with word timestamps; onnxruntime-node for matting (RVM / BiRefNet), upscale (Real-ESRGAN), face detection (reframe, tracking), RIFE (optical flow); DeepFilterNet / RNNoise for denoise; Demucs for vocal isolation | free, offline, private, runs well on Apple Silicon |
| AI, cloud (optional, own keys) | OpenAI or Anthropic (translation, highlights, script writer, Edit Pilot agent), ElevenLabs/OpenAI TTS, Veo/Sora/Seedance official APIs for generation | only official public APIs with Thomas's own keys, stored in the macOS Keychain |
| free content | Google Fonts, Pexels/Pixabay API (stock), Freesound/Pixabay music API, GIPHY API, CutLab's own presets (filters, effects, transitions, text animations, templates) | replaces CapCut's licensed libraries |
| tests | Vitest (engine, model), Playwright on Electron + on the web build in CI | |
| packaging | electron-builder → `.dmg`, self-signed or unsigned (personal use) | no App Store |

There is a single process model: an Electron main process (filesystem, ffmpeg, AI workers) and a renderer (UI + GPU engine), with a typed IPC bridge between them. There are no servers.

## Schema

The data lives in local documents rather than SQL tables. The source of truth is `src/model/schema.ts` (zod), mirrored below. The library index is SQLite, documented in `replica/schema.sql`.

Times are integer microseconds (`us`), which avoids float drift at 23.976/29.97 fps. Positions are canvas-normalised: (0,0) is the centre, and ±1 is the canvas half-width and half-height.

```ts
Project  { id, name, version, canvas: {width, height, background: {kind: color|blur|image, value}},
           fps: {num, den}, colorSpace: 'sdr'|'hdr', mediaMode: 'copy'|'link',
           assets: Asset[], tracks: Track[], transitions: Transition[], markers: Marker[],
           captionSets: CaptionSet[], createdAt, updatedAt }

Asset    { id, kind: 'video'|'image'|'audio'|'font'|'lut'|'sticker', path, proxyPath?,
           width?, height?, durationUs?, fps?, hasAudio, codec?, rotation?,
           waveform?: path, thumbs?: path, transcriptId?, aiGenerated?: boolean }

Track    { id, kind: 'video'|'audio'|'text'|'sticker'|'effect'|'filter'|'adjustment',
           isMain: boolean, locked, hidden, muted, clips: Clip[] }   // order in array = z-order

Clip     { id, assetId?, startUs, durationUs, inUs, speed: number, speedCurve?: Point[],
           reverse, freezeUs?, enabled, groupId?, compoundId?,
           transform: {x, y, scale, rotation, flipH, flipV, opacity}, crop: {l,t,r,b},
           blend: BlendMode, volumeDb, fadeInUs, fadeOutUs,
           keyframes: Keyframe[], effects: ClipEffect[],
           text?: TextContent, animation?: {in?, out?, loop?} }

Keyframe { id, property: string, tUs (relative to clip start), value: number,
           easing: 'linear'|'easeIn'|'easeOut'|'easeInOut'|'bezier', bezier?: [x1,y1,x2,y2] }

ClipEffect { id, kind: EffectKind, enabled, params: Record<string, number|string|boolean> }
  EffectKind = filter | adjust | hsl | curves | wheels | lut | mask | chroma | matte |
               stabilize | deflicker | upscale | retouch | relight | reframe | track |
               videoFx | denoise | voiceEnhance | voiceIsolate | voiceChanger | normalize

Transition { id, fromClipId, toClipId, kind, durationUs }
TextContent { text, runs: [{start, end, font, size, color, stroke, bg, shadow, bold, italic}],
              align, curve, bubble?, tts?: {voice, assetId} }
CaptionSet { id, language, sourceAssetId, words: [{t0Us, t1Us, text, speaker?}],
             styleTemplate, translationOf? }
Marker     { id, tUs, color, note?, kind: 'marker'|'beat', clipId? }
Preset     { id, kind, name, params }            // library-level, in library.db
ExportJob  { id, projectId, settings, status: queued|running|done|failed|cancelled, progress, output }
AIJob      { id, kind, input, status, progress, output, provider: 'local'|'openai'|... }
```

Hard constraints (enforced in the model layer and covered by tests):
- **No overlaps:** clips on a track never overlap. The magnet main track has no gaps.
- **Transitions:** a transition joins two adjacent clips on the same track, and its duration is at most min(clipA, clipB)/2.
- **Keyframes:** keyframe times stay inside the clip. Trimming re-bases them.
- **Asset deletion:** deleting an asset is refused while a clip uses it, unless that is confirmed.

## API

There is no HTTP. The API is the IPC bridge (`window.cutlab.*`), one row per call:

| call | does | flow |
| --- | --- | --- |
| `projects.list / create / open / save / rename / duplicate / delete` | project files + library index | S01 S02 |
| `media.import(paths, mode)` | copy or link, ffprobe, enqueue thumbs/waveform/proxy | F01 S04 |
| `media.proxy(assetId, res)` | ffmpeg 720p/540p proxy | S21 |
| `media.thumbs / waveform` | cached strips and peaks | S07 |
| `fs.pick(kind)` | file dialogs (media, font, lut, srt) | S04 S05h S05f |
| `export.start(settings) / cancel / progress` | render engine + muxer + file write | S19 F13 |
| `export.audio(settings)` | ffmpeg audio-only mix | F13 |
| `captions.transcribe(assetId, lang)` | whisper.cpp word timestamps | F01 F02 S05f |
| `captions.translate(setId, lang)` | LLM translation (own key) | S05f |
| `captions.importSrt / exportSrt` | SRT/TXT parse and write | F13 |
| `ai.matte(assetId)` | background removal → alpha video (ProRes 4444/WebM) | F04 |
| `ai.reframe(assetId, ratio)` | face/person track → crop keyframes | F15 |
| `ai.track(assetId, box)` | object tracker → path | F07 |
| `ai.upscale / stabilize / deflicker / opticalFlow` | rendered derivative asset | S08 |
| `ai.denoise / enhanceVoice / isolateVoice / normalize` | processed audio asset | S10 |
| `ai.tts(text, voice)` | audio asset | S25 |
| `ai.beats(assetId)` | beat times → markers | F03 |
| `ai.scenes(assetId)` | scene cuts | S07 |
| `ai.highlights(assetId)` | long → shorts candidates | F11 |
| `ai.dub(assetId, lang)` | ASR → translate → TTS (→ lip-sync) | F10 |
| `ai.generate(kind, prompt)` | video/image generation via official APIs | S14 S18 |
| `settings.get / set`, `keys.set(provider)` | preferences, Keychain | S21 |
| `publish.youtube / tiktok` | official upload APIs with own OAuth app | S20 |

Jobs: a local job queue in the main process (one heavy GPU/ML job at a time, ffmpeg jobs in parallel ×2), with progress events streamed to the UI.
Webhooks: none.

## The parts that bite

- **Preview = export:** one compositor for both. Export renders at the project resolution, never at proxy resolution, and switches proxies off while rendering.
- **Frame accuracy:** variable-frame-rate phone footage (iPhone `.MOV`) seeks inaccurately in `<video>`. Use WebCodecs decode with timestamps for export, and optionally conform VFR to CFR on import.
- **HEVC / HDR iPhone footage:** Chromium on macOS decodes HEVC through VideoToolbox. HDR (HLG/Dolby Vision) is tone-mapped to SDR unless the project is HDR.
- **Rotation metadata:** iPhone clips carry a rotation tag. Apply it in the probe step.
- **Audio sync:** sample-accurate mixing in `OfflineAudioContext` at 48 kHz. Speed changes keep pitch (WSOLA via a worklet).
- **Memory:** 4K frames on the GPU must be released immediately (`VideoFrame.close()`). Long projects need decoder pooling.
- **Undo:** every mutation goes through the store as an immer patch. Never mutate outside it.
- **Autosave:** debounced 2 s, atomic write (tmp + rename), keep 5 `.bak` files.
- **ML model sizes:** whisper large-v3-turbo ≈ 1.6 GB, matting ≈ 100 MB. Download on first use with a checksum, never bundled in the dmg.
- **Cloud AI:** API keys live in the Keychain only. Any upload to an API is explicit and shows its cost.
- **Licences:** only fonts, music and stock with licences that allow this use. No CapCut asset, ever.

## Build order

1. **Vertical slice (P1a):** S01 home, S02 new project, S03 shell, S04 import, S06 preview, S07 timeline (one video track, split, trim, delete), S19 export 1080p H.264 MP4. Proves import → edit → export end to end.
2. **Must-haves (P1b + P2):**
   - Multi-track timeline (magnet, snapping, linkage), copy/paste, undo/redo, zoom.
   - Transform and handles on canvas, keyframes.
   - Text with styling and animations, audio (volume, fades, extract).
   - Speed, transitions, filters, basic colour, chroma key.
   - Auto captions + caption styling + SRT, transcript editing with filler and silence removal.
   - Normalise loudness and denoise, background removal, auto reframe.
   - Export 4K/60, HEVC, MOV, with no watermark.
3. **Should-haves (P3):**
   - Proxies, shortcuts editor, markers, groups, freeze, reverse, voiceover.
   - Speed curves, HSL, curves, LUTs, adjustment layers, masks, blend modes, stabilise.
   - Effects, transitions set, text templates, bilingual captions, keyword highlight.
   - TTS, enhance voice, vocal isolation, beats, auto ducking, upscale, motion tracking.
   - Auto cut, long-to-shorts, scene detection.
4. **Could-haves (P4):**
   - Multicam, compound clips, colour wheels, optical flow, relight, retouch, deflicker.
   - Dubbing and lip-sync, script to video, generative AI, AI avatars, stickers and GIFs, templates browser.
   - Publishing to YouTube/TikTok, sync, smart search, Edit Pilot agent.
5. **Fixes from replica-entrepreneur:** after it runs (optional for a personal tool).
