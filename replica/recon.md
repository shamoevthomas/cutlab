# Recon map: CapCut (desktop macOS)

Scope: the whole desktop editor, A to Z, Pro features included (rebuilt, never unlocked).
For: Thomas only. Personal, internal use, never distributed. No paywall, everything on.
Date: 2026-10-14

## Ground rules applied

- **Public sources only.** Help center, resource pages, Mac App Store listing, third-party tutorials. The user may add screenshots of what he sees in his own app, used as layout reference only (`replica/screens/`, never shipped).
- **The CapCut binary is never opened.** No decompiling, no network logging.
- **Terms of Service (US, 2026-04-15) §5** forbid "reverse engineer, disassemble, decompile" and "determine ... source code, algorithms, methods or techniques embodied by the Services". So the clone studies only what the app *does* and how a user moves through it.
- **CapCut's internal draft file format is not used as a model.** Community docs describe its `draft_content.json`, but our data model is designed fresh from the observed features (section "Inferred data model").
- **CapCut libraries are excluded.** The Materials License Agreement (2026-01-22) §4 forbids using CapCut music, sounds, stickers, fonts, effects or templates "in any manner that competes with the Platform, including ... displaying ... (including thumbnails)" in another product. None of it enters the clone. It is replaced by free libraries and the user's own assets.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Terms of Service (US) | https://www.capcut.com/clause/terms-of-service | §5, §8, §9; updated 2026-04-15 |
| 2 | Materials License Agreement | https://www.capcut.com/clause/material-license-agreement | assets confined to CapCut |
| 3 | Mac App Store listing | https://apps.apple.com/us/app/capcut-photo-video-editor/id1500855883?platform=mac | v9.5.0, 4.8★ / 28k ratings, 1.1 GB |
| 4 | Pricing / plan changes | https://www.capcut.com/help/pricing-change , https://article.capcut.com/pricing | Free / Standard / Pro / Ultra / Teams |
| 5 | Standard vs Pro | https://capcut.com/resource/capcut-standard-vs-pro | Pro-gated list |
| 6 | CapCut Pro PC | https://www.capcut.com/resource/capcut-pro-pc | 18 Pro features; paywall at export |
| 7 | Desktop editor page | https://www.capcut.com/tools/desktop-video-editor | smart search, keyframe graph, Spaces |
| 8 | Desktop AI power | https://www.capcut.com/tools/desktop-ai-power | script to video, auto cut, transcript editing |
| 9 | How to use CapCut | https://capcut.com/resource/how-to-use-capcut | panels, inspector, timeline |
| 10 | Export help | https://www.capcut.com/help/export-videos-in-capcut | resolution, codec, formats |
| 11 | Auto captions / bilingual | https://www.capcut.com/help/bilingual-subtitles | captions flow |
| 12 | Subtitle import | https://www.capcut.com/help/how-to-import-subtitles | SRT/TXT |
| 13 | Transcript editing | https://www.capcut.com/tools/video-transcript-editing | fillers, pauses |
| 14 | Remove background | https://www.capcut.com/resource/how-to-remove-background-in-capcut | auto + custom |
| 15 | Chroma key | https://www.capcut.com/help/chroma-key-feature | intensity, shadow |
| 16 | Color grading | https://www.capcut.com/resource/capcut-color-grading | HSL, curves, wheels |
| 17 | Stabilizer | https://www.capcut.com/resource/capcut-stabilizer | 3 levels |
| 18 | Multicam | https://www.capcut.com/resource/multicam-editing-in-daVinci-resolve | 4/9 angles |
| 19 | Collaboration (Space) | https://www.capcut.com/resource/collaborate-on-capcut-online/ | roles, review links |
| 20 | Video translator | https://www.capcut.com/resource/translate-a-video | dubbing, lip-sync |
| 21 | Long video to shorts | https://www.capcut.com/tools/long-video-to-shorts | highlights, 9:16 |
| 22 | Auto reframe pricing | https://www.capcut.com/help/why-do-i-have-to-pay-for-auto-reframe | Pro since 2026-04 |
| 23 | Shortcuts | https://tutorialtactic.com/blog/capcut-shortcuts/ | full shortcut table |
| 24 | PC/Mac tutorial | https://primalvideo.com/guides/capcut-for-pc-mac-tutorial/ | project settings, flows |
| 25 | LUT import | https://www.sparklestock.com/docs/import-luts-in-capcut-desktop/ | .cube/.3dl |
| 26 | Settings / proxy | https://www.capcut.com/help/editing-not-match-displayed | proxy, hardware accel |
| 27 | Pro paywall | https://www.capcut.com/help/join-capcut-pro-for-exporting | export lock behaviour |
| 28 | Changelog aggregate | https://www.hooked.so/guides/capcut-updates | Seedance, Edit Pilot... |
| 29 | User's own app (screenshots) | n/a | pending; layout reference only |

## Core loop

Import a rush, cut it on a multi-track timeline, dress it up (captions, text, music, effects, color), then export an MP4 for TikTok/YouTube.

## Screens

| ID | screen | how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home / project list | app launch | open or create a project, AI tool shortcuts | Create project button, AI tool tiles, draft grid, draft menu | empty, filled, multi-select (guess), syncing (guess) |
| S02 | New project / project settings | S01 → Create, or editor → Modify | canvas and media handling | name, ratio, resolution, fps, SDR/HDR, copy vs link, proxy toggle | default, adapted to first clip |
| S03 | Editor shell | open a project | the editing page | top bar (menu, name, shortcuts, export), S04 + S05 + S06 + S07 | empty project, filled |
| S04 | Asset panel: Media | editor left, tab Media | local import, stock, AI media, smart search | import button, dropzone, grid, categories, search | empty, importing, filled |
| S05a | Asset panel: Audio | tab Audio | music, SFX, extracted audio | library grid, preview play, + add | loading, downloading, ready |
| S05b | Asset panel: Text | tab Text | add text, text templates, effects | default text, template grid | |
| S05c | Asset panel: Stickers | tab Stickers | stickers, GIF, AI stickers | grid, search, AI prompt | |
| S05d | Asset panel: Effects | tab Effects | video and body effects | categorized grid | |
| S05e | Asset panel: Transitions | tab Transitions | transitions | categorized grid | |
| S05f | Asset panel: Captions | tab Captions | auto, manual, import captions, lyrics | language picker, bilingual toggle, Generate, import | idle, generating, done, error |
| S05g | Asset panel: Filters | tab Filters | filters | categorized grid | |
| S05h | Asset panel: Adjustment | tab Adjustment | adjustment layer, LUTs, presets | add adjustment, import LUT, my presets | |
| S05i | Asset panel: Templates | tab Templates | template projects | grid (no search on desktop) | |
| S05j | Asset panel: AI avatars | tab AI avatars | presenter avatars | avatar grid, script, voice | |
| S06 | Player / preview | editor center | playback and on-canvas edits | transport, timecode, ratio menu, quality, fullscreen, handles, guides | playing, paused, proxy, caching, multicam grid |
| S07 | Timeline | editor bottom | arranging clips | toolbar, tracks, playhead, waveforms, thumbnails, markers, zoom | empty ("drag media here"), filled, selected, multi-select |
| S08 | Inspector: video clip | select a video clip | clip properties | tabs Video (Basic / Remove BG / Mask / Retouch), Audio, Speed, Animation, Adjustment, AI | per-tab |
| S09 | Inspector: text clip | select a text | text properties | tabs Text, Animation, Tracking, Text-to-speech | caption mode ("apply to all") |
| S10 | Inspector: audio clip | select an audio clip | audio properties | Basic, Voice changer, Speed, Beats | |
| S11 | Inspector: sticker / effect / filter / transition / adjustment | select one | parameters | intensity, duration, apply to all | |
| S12 | Keyframe graph panel | Alt+K | easing curves | lanes per property, bezier editor | |
| S13 | Transcript editor | clip menu → Transcript-based editing | edit video by editing text | transcript, filler/pause/repeat lists, one-click remove | transcribing, ready |
| S14 | Script to video | S01 tile | AI script → video | idea, style, duration, script editor, Generate | generating, done |
| S15 | Video translator | S01 tile / audio tab | translate + dub | from/to, lip-sync, review | processing, review |
| S16 | Long video to shorts | S01 tile | AI highlights to 9:16 | length setting, highlight list, per-clip template | processing, results |
| S17 | Auto cut | toolbar AI / S01 | auto edit on beats/speech/prompt | mode, prompt | processing, done |
| S18 | AI design (image canvas) | S01 tile | images: text-to-image, upscale, bg removal | canvas, prompt, tools | |
| S19 | Export dialog | Export button | render settings | cover, title, folder, video (res, bitrate, codec, format, fps, HDR), audio-only, captions export, copyright check, range | settings, exporting %, done, error |
| S20 | Post-export share | after export | publish | TikTok, YouTube, review link | |
| S21 | Settings | Menu → Settings | preferences | Draft (location, cache), Performance (proxy, HW enc/dec), defaults, language | |
| S22 | Shortcut editor | top bar / settings | keyboard map | list, rebind, reset | conflict |
| S23 | Multicam dialog | clips menu → Create Multi-Camera Clip | sync angles | sync method (auto/audio/marker) | |
| S24 | Voiceover recorder | timeline mic | record narration | input picker, countdown, level | recording |
| S25 | TTS voice picker | text inspector | pick a voice | language, voices, preview | |
| S26 | Space / cloud | S01 tab Space | cloud drafts, members | spaces list, invite, roles, review links | view-only lock |
| S27 | Sign-in | top-left | account | QR, Google, Facebook, TikTok | signed out/in |
| S28 | Pro paywall | Pro asset / export | upsell | badges, "requires Pro" banner | **skip: no paywall in the clone** |
| S29 | Misc modals | various | LUT import, caption import, copyright result, update prompt | file pickers, results | |

### Observed in the user's own app (macOS, v9.x, French UI, 2026-10-14)

Screenshots are in `replica/screens/`. They are layout reference only. Labels in the clone are written fresh.

**S01 Home** (`S01-accueil.png`)
- **Left sidebar, top:** an account card (plan, renewal date, upsell) above the nav entries Accueil and Modèles.
- **Left sidebar, sections:**
  - "Créer avec l'IA": Video Studio, Studio de conceptions.
  - "Gestion": Bibliothèque, Espaces (expandable).
  - Bottom: invite friends, then a promo card.
- **Main column:**
  - A full-width "Créer un projet" banner.
  - An **EditPilot** prompt card ("describe what you want to edit") with an input and a send button.
  - Four AI tiles: AI video, AI image, Extend video, Edit by description.
  - An "AI creative suite" row with two cards: video studio and design studio.
  - A **Projets** grid with toolbar search, grid/list toggle, trash and cloud.
- **Window top-right:** share, upload, feedback, settings.

**S03 Editor shell** (`S04-*.png`)
- **Title bar:** "Enregistré automatiquement : hh:mm:ss" (autosave time) on the left, project name centred.
- **Title bar, right:** layout menu, a second view toggle, Pro, Partager (share), Exporter (accent button).
- **Main area:** three panels above the timeline: assets (left, ~1/3), player (centre), inspector (right).

**Asset panel**
- **Tab row (scrollable with a chevron):** Multimédia, Son, Texte, Stickers, Effets, Transitions, Légendes, Filtres, Ajustement…
- **Each tab:** a left sub-nav (collapsible groups) and a content area with search + filter.
- **Multimédia** (S04)
  - Sub-nav: Importer › Fichiers multimédia / Sous-projets, Les tiennes (yours), Générer (AI badge), Espaces, Bibliothèque, a generation service entry.
  - Toolbar: Importer, Enregistrer (record), search, view mode, sort, filter.
  - "Tout" section with tiles. Each tile has an "Ajouté" (added) badge and a duration.
  - **Missing-media state:** red tile "Fichier multimédia perdu".
  - Bottom banner: "AI clip creator".
- **Son** (S05a)
  - Sub-nav: Importer, Les tiennes, Musique (genre list), Effets sonores.
  - Search with suggestions.
  - Track rows: cover, title, artist · duration, download button.
- **Texte** (S05b)
  - Sub-nav: Ajouter du texte (one "default text" tile), Les tiennes, Effets de texte, Modèle de texte, Légendes auto, local subtitles.
- **Stickers** (S05c)
  - Sub-nav: Les tiennes, Stickers › (AI generated, Trending, seasonal categories…), Formes (shapes).
  - 3-column grid. Tiles carry a Pro diamond and a download badge.
- **Effets** (S05d)
  - Sub-nav: Effets vidéo › categories, then Effets corporels (body effects).
  - Grid with thumbnail and name; Pro diamond and download badge.

**S06 Player**
- **Header:** "Lecteur-Timeline 01" with a menu.
- **Footer:** timecode current / total (accent / white), a display-grid toggle and play.
- **Footer, right:** a quality pill ("Maximale"), a zoom/scope button, a ratio pill ("Rapport"), fullscreen.
- **Missing-media frame:** "Media Not Found".

**S08 Inspector, nothing selected**
- **"Détails" (project):**
  - Identity and storage: name, path, colour space (Rec.709 SDR), imported media (keep at original location vs copy).
  - Behaviour: organise layers (on), proxy (off).
  - Timeline: timeline name, format (Original), resolution (Adapted), frame rate (30.00fps).
- **"Modifier" button:** opens S02.
- **New fact:** a project holds named **timelines** ("Timeline 01") and **sub-projects**.

**S07 Timeline**
- **Toolbar, left:** + (add), selection tool ▾, undo, redo, split, delete left, delete right, delete, marker.
- **Toolbar, right:** mic (voiceover), main-track magnet, snapping, linkage ▾, preview axis ▾, a fit/thumbnail toggle, zoom −, slider, zoom +.
- **Track headers:**
  - Video track: type icon, lock, eye, mute, more (…).
  - Main track: a "cover" edit button (pencil) in front of it.
  - Audio track: lock, mute, more.
- **Clips:** a header strip with the file name and duration. Detached audio sits on an audio track below.
- **Missing-media clips:** red.
- **Bottom-right:** floating **EditPilot** button and a selection-assist button.

## Flows

```
F01 Vertical reel with auto captions, export
    S01 -> S02 (9:16) -> S04 import -> S07 cut (Q/W, Cmd+B) -> S05f auto captions
    -> S09 style + apply to all -> S08 audio normalize/enhance -> S19 export 1080p MP4
    happy path clicks: ~14
    edge: no speech detected, mixed languages, very long rush (>1h), clip with no audio track

F02 Remove silences and filler words
    S07 clip menu -> S13 transcript -> remove pauses/fillers/repeats -> captions follow
    happy path clicks: ~5
    edge: overlapping speakers, music under voice, threshold too aggressive

F03 Music + beat sync
    S05a add music -> S10 auto beat -> S07 snap + split on beats -> fades, volume -25 dB
    happy path clicks: ~8
    edge: tempo changes, track shorter than video

F04 Remove background
    S08 Video > Remove BG -> auto | custom brush | chroma key -> place over background
    happy path clicks: ~4
    edge: hair, motion blur, green spill

F05 Keyframe zoom (Ken Burns)
    S08 Basic -> keyframe scale/position at start -> move playhead -> change scale -> S12 ease
    happy path clicks: ~6

F06 Speed ramp
    S08 Speed -> Curve preset or custom -> optical flow on
    happy path clicks: ~4

F07 Motion tracking
    select text/sticker -> S09 Tracking -> box the subject -> track
    happy path clicks: ~4
    edge: subject leaves frame, occlusion

F08 Color grade with LUT
    S05h import LUT -> adjustment layer over clips -> intensity -> HSL/curves/wheels -> save preset
    happy path clicks: ~7

F09 Script to video
    S01 -> S14 idea/style/duration -> generate script -> edit -> generate video -> S03 refine -> S19
    happy path clicks: ~6

F10 Translate / dub
    S15 upload -> from/to -> lip-sync -> review -> export
    happy path clicks: ~5

F11 Long video to shorts
    S16 upload -> length -> pick highlights -> per-clip captions/template -> export all
    happy path clicks: ~5

F12 Multicam edit
    select clips -> S23 sync -> S06 multicam grid -> switch angles while playing -> export
    happy path clicks: ~6
    edge: no common audio, different frame rates

F13 Export a range / audio only / captions only
    I/O -> S19 ; untick video + audio format ; caption export SRT/TXT

F14 Template
    S05i pick -> replace placeholders -> edit text -> S19

F15 Auto reframe
    S08 Basic > Auto reframe -> ratio, stabilisation, speed -> apply
    edge: two people, subject leaves frame

F16 Voiceover
    S07 mic -> S24 record -> new audio track
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary (Export), secondary, ghost, icon, danger | default, hover, pressed, disabled, loading | all |
| Tab bar (asset) | icon+label vertical/horizontal | active, hover | S04–S05j |
| Category sidebar | list | active | asset tabs |
| Asset tile | media, audio, text style, sticker, effect, transition, filter, template | idle, hover-preview, downloading, ready, selected, favourited | asset tabs |
| Search field | with filters | empty, typing, no results | S04, S05c |
| Slider + numeric field + keyframe diamond | 0–100, −100..100, dB, % | default, changed (reset icon), keyframed, on keyframe | inspector |
| Toggle / checkbox | | on, off, disabled | inspector, settings |
| Dropdown | ratio, resolution, fps, codec, language | open, closed | S02, S06, S19 |
| Colour picker | swatches, hex, eyedropper | | text, canvas, chroma |
| Inspector section | collapsible | expanded, collapsed | S08–S11 |
| Timeline track | main video, overlay, text, sticker, effect, filter, adjustment, audio | normal, locked, hidden, muted, drop-target | S07 |
| Timeline clip | video (thumbnails), audio (waveform), text, sticker, effect, transition handle | idle, hover, selected, trimming, dragging, disabled | S07 |
| Playhead / ruler / marker | colours | dragging | S07 |
| Timeline toolbar | left tools, right toggles | active, disabled | S07 |
| Transport | play, step, timecode | playing, paused | S06 |
| Canvas handles | move, scale, rotate, crop, mask shapes | | S06 |
| Context menu | clip, track, draft | | S07, S01 |
| Modal | small, large, full-screen | | S02, S19, S23, S24 |
| Progress | bar, ring, percentage | indeterminate, determinate, error | export, AI jobs |
| Toast | info, success, error | | all |
| Curve editor | speed curve, colour curve, keyframe bezier | | S08, S12 |
| Colour wheels | lift, gamma, gain | | S08 |
| Transcript row | word, filler, pause, repeat | selected, struck | S13 |

## Inferred data model (designed fresh, not CapCut's file format)

```
Project      id, name, canvas {w, h, ratio, background}, fps, color_space (sdr|hdr),
             media_mode (copy|link), duration_us, cover_path, created_at, updated_at
             evidence: S02 fields, S01 grid. confidence: high

Asset        id, project_id, kind (video|image|audio|font|lut|sticker|sfx),
             path, proxy_path, width, height, duration_us, fps, has_audio,
             waveform_path, thumbnails_path, transcript_id?, ai_generated
             evidence: S04 import, proxy setting. confidence: high

Track        id, project_id, kind (video|audio|text|sticker|effect|filter|adjustment),
             order, is_main, locked, hidden, muted
             evidence: S07. confidence: high

Clip         id, track_id, asset_id?, start_us (timeline), duration_us,
             in_us (source), speed, speed_curve?, reverse, freeze?,
             transform {x, y, scale, rotation, flip_h, flip_v, opacity},
             blend_mode, crop, volume_db, fade_in, fade_out, group_id, compound_id,
             enabled
             evidence: S08 Basic/Speed/Audio. confidence: high

Keyframe     id, clip_id, property, t_us (relative), value, easing (linear|in|out|bezier), bezier[4]
             evidence: S12, help keyframe page. confidence: high

ClipEffect   id, clip_id, kind (filter|effect|mask|chroma|bg_removal|stabilize|
             retouch|adjust|lut|relight|deflicker|voice_fx|denoise|...), params (json), order
             evidence: S08 tabs. confidence: high

Transition   id, from_clip_id, to_clip_id, kind, duration_us
             evidence: S05e. confidence: high

TextContent  clip_id, text, runs [{range, font, size, color, stroke, bg, shadow}],
             align, curve, bubble?, animation {in, out, loop}, template_id?,
             tracking_path_id?, tts {voice, audio_asset_id}
             evidence: S09. confidence: high

Caption set  id, project_id, language, source_asset_id, words [{t0, t1, text, speaker?}],
             style_template, translation_language?
             evidence: S05f, S13. confidence: medium

Marker       id, project_id|clip_id, t_us, color, note, kind (marker|beat)
             evidence: shortcuts M, auto beat. confidence: high

TrackingPath id, asset_id, keyframes [{t, box}]       confidence: medium
MulticamClip id, angles [asset_id, offset_us], sync_method, cuts [{t, angle}]  confidence: medium
Preset       id, kind (adjust|text|effect), params      confidence: medium
ExportJob    id, project_id, settings {res, fps, bitrate, codec, container, hdr,
             audio_format?, captions_format?, range}, status, progress, output_path
             evidence: S19. confidence: high
AIJob        id, kind (asr|tts|bg_matting|upscale|reframe|translate|gen_video|gen_image|...),
             input, output, status, provider              confidence: guess (implementation choice)
```

Relationships: Project 1-n Track, Track 1-n Clip, Clip 1-n Keyframe, Clip 1-n ClipEffect, Project 1-n Asset, Asset 1-n Clip, Project 1-n CaptionSet, Project 1-n ExportJob.

## Feature matrix

See `features.csv`. 168 rows. Must: 56, should: 56, could: 43, skip: 13. Every row with a Pro mark is rebuilt in the clone with no gating.

## Out of scope (cannot or should not be cloned)

- **CapCut's own libraries.** Music, sound effects, stickers, fonts, effects presets, filters presets, templates and stock footage. Licensed and confined to CapCut by the Materials License Agreement. The clone uses free libraries (Pixabay/Freesound-type, Google Fonts) plus the user's own files.
- **Its AI models** (Seedance, Seedream, its ASR/TTS/matting models). Rebuilt with open models or third-party APIs the user subscribes to.
- **The TikTok network and account system.** Direct posting is possible only through TikTok's and YouTube's official APIs, with his own developer keys.
- **Paywall, subscriptions, credits, diamond badges.** Pointless for a personal tool. Everything is on.
- **Multi-user Space with 30 members.** Personal use: replaced by a simple personal library/sync.

## Size

Screens 29 (+10 asset tabs), flows 16, entities 14.

Hard parts:
1. A real-time preview engine (GPU compositing of multi-track video, effects, keyframes, at 1080p/4K) and a render pipeline that matches it frame for frame.
2. The AI layer: matting, tracking, reframe, upscale, deflicker, optical flow, ASR, TTS, dubbing with lip-sync, generative video.
3. Timeline UX at professional quality: trimming, ripple/magnet, snapping, undo/redo across everything, long projects without lag.

Size: **XL.** The skill would say "rescope it". The user chose the whole app, so it is built in phases, each phase usable on its own:

- **P1 Core editor:** projects, import, timeline, preview, cut, text, audio, export.
- **P2 Creator essentials:** auto captions, silence/filler removal, keyframes, speed, transitions, filters, color, masks, chroma key.
- **P3 Pro AI:** background removal, auto reframe, tracking, denoise/voice isolation, TTS, upscale, stabilise, translate/dub.
- **P4 Advanced:** multicam, compound clips, LUTs, curves/wheels, templates, long-to-shorts, script-to-video, generative AI, publishing.
