# CutLab components

All components use the tokens in `tokens.json`, exposed as CSS variables (`src/styles/tokens.css`, generated with `npm run tokens`). Icons come from Lucide (MIT). The UI font is Inter (OFL). Every label is written fresh, in French.

```
Button
  variants  primary (Exporter), secondary, ghost, icon, danger
  sizes     sm 24px, md 30px, lg 36px
  states    default, hover, active, focus-visible (2px ring accent), disabled, loading (spinner, label kept)
  tokens    primary: bg accent, text on-accent; secondary: bg surface-3; radius md; type base/600
  a11y      real <button>, aria-label on icon buttons, title = tooltip with shortcut
  used on   all

IconButton (toolbar)
  sizes     28px square, 16px icon
  states    default, hover (surface-3), active/toggled (accent icon), disabled (text-faint)
  a11y      aria-pressed for toggles (magnet, snapping, linkage)
  used on   S06, S07

Tabs (asset rail)
  layout    horizontal icon+label row on top of the asset panel
  states    active (accent text + 2px underline), hover, focus-visible
  a11y      role=tablist / tab / tabpanel, arrow keys move focus
  used on   S04–S05j, S08–S11 inspector tabs

AssetTile
  variants  media (thumb + duration), audio (waveform + name + play), text style, effect/filter/transition (preview thumb)
  states    idle, hover (shows + add button), dragging, selected (accent border), processing (spinner), error (danger badge)
  a11y      button; Enter adds at playhead; draggable with keyboard alternative (+ button)
  used on   asset tabs

Slider row
  parts     label, range input, numeric field, reset icon, keyframe diamond
  states    default, changed (reset visible), keyframed (diamond filled), on-keyframe (diamond accent)
  a11y      <input type=range> with aria-valuetext in units (%, dB, °)
  used on   S08–S11

Select / Dropdown
  states    closed, open, focus, disabled
  a11y      native <select> (fast, accessible)
  used on   S02, S06 ratio, S19

Toggle
  states    on (accent), off (surface-3), disabled
  a11y      <input type=checkbox role=switch>
  used on   inspector, settings, export

Modal
  sizes     sm 420, md 560, lg 760
  states    open (fade + scale, motion base), closing
  a11y      role=dialog, aria-modal, focus trap, Esc closes, focus returns to the opener
  used on   S02, S19, S23, S24

TimelineTrack
  variants  main video (64px), overlay video, audio, text, sticker, effect, filter, adjustment (48px)
  parts     header (lock, hide/mute), lane
  states    normal, locked (hatched), hidden/muted (dimmed), drop-target (accent outline)
  used on   S07

TimelineClip
  variants  video (thumbnail strip), audio (waveform), text/sticker/effect (coloured bar + label)
  states    idle, hover (trim handles), selected (2px selection border), trimming, dragging (ghost + snap line), disabled (striped, 40% opacity)
  a11y      focusable; arrows nudge by one frame, Delete removes, Cmd+B splits
  used on   S07

Playhead / Ruler
  parts     white line with a top handle; ruler ticks adapt to zoom, timecode labels in mono
  used on   S07

Transport
  parts     play/pause, timecode current / total (mono), ratio menu, fullscreen
  used on   S06

CanvasHandles
  parts     bounding box, 4 corner scale handles, rotate handle, centre snap guides
  states    hidden (nothing selected), shown, dragging
  used on   S06

ContextMenu
  a11y      role=menu, arrow keys, Esc
  used on   S07 clip, S01 draft

Progress
  variants  bar (export), inline ring (asset processing)
  states    determinate, indeterminate, error
  used on   S19, AI jobs

Toast
  variants  info, success, error
  a11y      role=status (aria-live polite), error = role=alert
  used on   all

EmptyState
  parts     icon, one line, one action
  used on   S01 (no project), S04 (no media), S07 (timeline empty: "Glisse tes médias ici")
```
