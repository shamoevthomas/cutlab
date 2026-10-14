// CutLab project model. Times are integer microseconds. Positions are canvas-normalised:
// (0,0) is the centre, x/y = ±1 is the canvas half-width/half-height.

export type Us = number;
export const US = 1_000_000;

export type TrackKind = 'video' | 'audio' | 'text' | 'sticker' | 'effect' | 'filter' | 'adjustment';
export type AssetKind = 'video' | 'image' | 'audio' | 'font' | 'lut' | 'sticker';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  path: string;          // absolute path (desktop) or blob: url (web)
  url: string;           // url the renderer can load
  width?: number;
  height?: number;
  durationUs?: Us;
  hasAudio: boolean;
  thumb?: string;        // data url
}

export interface Transform {
  x: number; y: number; scale: number; rotation: number;
  flipH: boolean; flipV: boolean; opacity: number;
}

export interface Keyframe {
  id: string;
  property: AnimProp;
  tUs: Us;               // relative to clip start (timeline time)
  value: number;
  easing: Easing;
}
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volumeDb';

export interface TextStyle {
  font: string; size: number; color: string; bold: boolean; italic: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string; strokeWidth: number;
  bgColor: string; bgOpacity: number;
  shadow: boolean;
}

export interface ClipEffect {
  id: string;
  kind: 'adjust' | 'filter' | 'chroma' | 'mask';
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export type AnimPreset = 'none' | 'fade' | 'zoom' | 'slideUp' | 'slideLeft' | 'pop' | 'typewriter';

export interface Clip {
  id: string;
  assetId?: string;      // media clips
  startUs: Us;           // position on the timeline
  durationUs: Us;        // length on the timeline (after speed)
  inUs: Us;              // source in-point
  speed: number;
  reverse: boolean;
  enabled: boolean;
  transform: Transform;
  blend: BlendMode;
  volumeDb: number;
  fadeInUs: Us;
  fadeOutUs: Us;
  keyframes: Keyframe[];
  effects: ClipEffect[];
  text?: { content: string; style: TextStyle; words?: CaptionWord[] }; // words: relative to clip start
  animIn: AnimPreset;
  animOut: AnimPreset;
  animDurUs: Us;
  label?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  role?: 'captions';      // auto-captions track: regenerating replaces it
  isMain: boolean;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  clips: Clip[];          // sorted by startUs, never overlapping
}

export interface Transition {
  id: string;
  fromClipId: string;
  toClipId: string;
  kind: 'dissolve' | 'fadeBlack' | 'slideLeft' | 'zoom' | 'wipe';
  durationUs: Us;
}

export interface Marker { id: string; tUs: Us; color: string; note?: string; kind: 'marker' | 'beat' }

export interface CaptionWord { t0Us: Us; t1Us: Us; text: string }

export interface Project {
  id: string;
  name: string;
  version: 1;
  canvas: { width: number; height: number; background: string };
  fps: number;
  assets: Asset[];
  tracks: Track[];       // index 0 = bottom of the stack (main video), last = top
  transitions: Transition[];
  markers: Marker[];
  createdAt: string;
  updatedAt: string;
}

export const RATIOS: Record<string, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '4:3': [1440, 1080],
  '21:9': [2560, 1080],
};

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

export const defaultTransform = (): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1 });

export const defaultTextStyle = (): TextStyle => ({
  font: 'Inter', size: 72, color: '#ffffff', bold: true, italic: false, align: 'center',
  strokeColor: '#000000', strokeWidth: 0, bgColor: '#000000', bgOpacity: 0, shadow: true,
});

export function newProject(name: string, ratio = '16:9', fps = 30): Project {
  const [width, height] = RATIOS[ratio] ?? RATIOS['16:9'];
  const now = new Date().toISOString();
  return {
    id: uid(), name, version: 1, canvas: { width, height, background: '#000000' }, fps,
    assets: [], tracks: [newTrack('video', true)], transitions: [], markers: [],
    createdAt: now, updatedAt: now,
  };
}

export function newTrack(kind: TrackKind, isMain = false): Track {
  return { id: uid(), kind, isMain, locked: false, hidden: false, muted: false, clips: [] };
}

export function newClip(partial: Partial<Clip> & Pick<Clip, 'startUs' | 'durationUs'>): Clip {
  return {
    id: uid(), inUs: 0, speed: 1, reverse: false, enabled: true, transform: defaultTransform(),
    blend: 'normal', volumeDb: 0, fadeInUs: 0, fadeOutUs: 0, keyframes: [], effects: [],
    animIn: 'none', animOut: 'none', animDurUs: 500_000, ...partial,
  };
}
