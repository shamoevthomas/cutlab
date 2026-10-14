// Scene evaluation: what is visible at time t, with every animated value resolved.
// Pure function shared by preview and export, so both draw the same thing.
import type { Clip, Project, Track, Transition, Us, AnimPreset } from '../model/schema';
import { clipEnd, sourceTimeAt, valueAt } from '../model/ops';

export interface Layer {
  clip: Clip;
  track: Track;
  kind: 'video' | 'image' | 'text' | 'sticker';
  assetId?: string;
  sourceUs: Us;              // source time for video
  x: number; y: number; scale: number; rotation: number; opacity: number;
  flipH: boolean; flipV: boolean;
  wipe: number;              // 0 = none, else reveal fraction (left→right)
  textChars?: number;        // typewriter
  adjust: Adjust;
  chroma: { on: boolean; color: [number, number, number]; intensity: number; shadow: number };
  blend: Clip['blend'];
}

export interface Adjust {
  brightness: number; contrast: number; saturation: number; exposure: number;
  temperature: number; tint: number; vignette: number; highlights: number; shadows: number;
}

export const neutralAdjust = (): Adjust => ({ brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 0, tint: 0, vignette: 0, highlights: 0, shadows: 0 });

/** CutLab's own filter presets, expressed as adjust offsets (values in −100..100). */
export const FILTERS: Record<string, Partial<Adjust> & { label: string }> = {
  clair: { label: 'Clair', brightness: 12, contrast: -8, saturation: 6 },
  chaud: { label: 'Chaud', temperature: 35, saturation: 10, contrast: 6 },
  froid: { label: 'Froid', temperature: -35, tint: -6, contrast: 8 },
  cinema: { label: 'Cinéma', contrast: 22, saturation: -18, temperature: 10, vignette: 35, shadows: -10 },
  nb: { label: 'Noir & blanc', saturation: -100, contrast: 18 },
  nbDoux: { label: 'N&B doux', saturation: -100, contrast: -10, brightness: 6 },
  vintage: { label: 'Vintage', saturation: -30, temperature: 25, contrast: -12, vignette: 40, tint: 8 },
  vif: { label: 'Vif', saturation: 40, contrast: 14 },
  sombre: { label: 'Sombre', brightness: -18, contrast: 20, vignette: 30 },
  pastel: { label: 'Pastel', saturation: -20, brightness: 14, contrast: -20, tint: 10 },
  nuit: { label: 'Nuit', temperature: -45, brightness: -15, saturation: -10, contrast: 12 },
  dore: { label: 'Doré', temperature: 50, tint: 12, highlights: 12, saturation: 12 },
};

function adjustOf(c: Clip): Adjust {
  const out = neutralAdjust();
  for (const e of c.effects) {
    if (!e.enabled) continue;
    if (e.kind === 'adjust') for (const k of Object.keys(out) as (keyof Adjust)[]) out[k] += Number(e.params[k] ?? 0);
    if (e.kind === 'filter') {
      const f = FILTERS[String(e.params.preset)];
      const amt = Number(e.params.intensity ?? 100) / 100;
      if (f) for (const k of Object.keys(out) as (keyof Adjust)[]) out[k] += (Number((f as any)[k] ?? 0)) * amt;
    }
  }
  return out;
}

function chromaOf(c: Clip): Layer['chroma'] {
  const e = c.effects.find(x => x.kind === 'chroma' && x.enabled);
  if (!e) return { on: false, color: [0, 1, 0], intensity: 0, shadow: 0 };
  const hex = String(e.params.color ?? '#00ff00');
  const n = parseInt(hex.slice(1), 16);
  return { on: true, color: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255], intensity: Number(e.params.intensity ?? 50) / 100, shadow: Number(e.params.shadow ?? 0) / 100 };
}

function applyAnim(L: Layer, preset: AnimPreset, p: number) {
  // p: 0 = fully hidden side, 1 = at rest
  const e = 1 - Math.pow(1 - p, 3);
  switch (preset) {
    case 'fade': L.opacity *= p; break;
    case 'zoom': L.scale *= 0.6 + 0.4 * e; L.opacity *= p; break;
    case 'pop': L.scale *= p < 0.7 ? (p / 0.7) * 1.12 : 1.12 - 0.12 * ((p - 0.7) / 0.3); break;
    case 'slideUp': L.y -= (1 - e) * 0.35; L.opacity *= p; break;
    case 'slideLeft': L.x += (1 - e) * 0.6; L.opacity *= p; break;
    case 'typewriter': if (L.clip.text) L.textChars = Math.round(L.clip.text.content.length * p); break;
  }
}

function baseLayer(track: Track, c: Clip, t: Us, kind: Layer['kind']): Layer {
  const rel = t - c.startUs;
  const L: Layer = {
    clip: c, track, kind, assetId: c.assetId, sourceUs: sourceTimeAt(c, t),
    x: valueAt(c, 'x', rel), y: valueAt(c, 'y', rel), scale: valueAt(c, 'scale', rel),
    rotation: valueAt(c, 'rotation', rel), opacity: valueAt(c, 'opacity', rel),
    flipH: c.transform.flipH, flipV: c.transform.flipV, wipe: 0,
    adjust: adjustOf(c), chroma: chromaOf(c), blend: c.blend,
  };
  const d = Math.min(c.animDurUs, c.durationUs / 2);
  if (c.animIn !== 'none' && rel < d) applyAnim(L, c.animIn, rel / d);
  if (c.animOut !== 'none' && clipEnd(c) - t < d) applyAnim(L, c.animOut, (clipEnd(c) - t) / d);
  return L;
}

export function layerKind(p: Project, track: Track, c: Clip): Layer['kind'] | null {
  if (track.kind === 'audio' || track.kind === 'effect' || track.kind === 'filter' || track.kind === 'adjustment') return null;
  if (c.text) return 'text';
  const a = p.assets.find(x => x.id === c.assetId);
  if (!a) return null;
  if (a.kind === 'video') return 'video';
  if (a.kind === 'image') return 'image';
  if (a.kind === 'sticker') return 'sticker';
  return null;
}

function transitionAround(p: Project, c: Clip): { out?: Transition; in?: Transition } {
  return { out: p.transitions.find(x => x.fromClipId === c.id), in: p.transitions.find(x => x.toClipId === c.id) };
}

/** Visible layers at time t, bottom to top. */
export function evaluate(p: Project, t: Us): Layer[] {
  const layers: Layer[] = [];
  for (const track of p.tracks) {
    if (track.hidden || track.kind === 'audio') continue;
    for (let i = 0; i < track.clips.length; i++) {
      const c = track.clips[i];
      if (!c.enabled) continue;
      const kind = layerKind(p, track, c);
      if (!kind) continue;
      const { out: trOut, in: trIn } = transitionAround(p, c);
      const halfOut = trOut ? trOut.durationUs / 2 : 0;
      const halfIn = trIn ? trIn.durationUs / 2 : 0;
      const start = c.startUs - halfIn, end = clipEnd(c) + halfOut;
      if (t < start || t >= end) continue;
      // hold the edge frame while the transition overlaps beyond the clip
      const tc = Math.min(Math.max(t, c.startUs), clipEnd(c) - 1);
      const L = baseLayer(track, c, tc, kind);
      if (trIn && t < c.startUs + halfIn) {
        const pr = (t - (c.startUs - halfIn)) / (2 * halfIn);   // 0..1 across the transition
        applyTransitionIn(L, trIn.kind, pr);
      }
      if (trOut && t >= clipEnd(c) - halfOut) {
        const pr = (t - (clipEnd(c) - halfOut)) / (2 * halfOut);
        applyTransitionOut(L, trOut.kind, pr);
      }
      if (L.opacity > 0.001) layers.push(L);
    }
  }
  // the incoming clip of a transition must draw on top of the outgoing one: order within a track by start
  return layers;
}

function applyTransitionIn(L: Layer, kind: Transition['kind'], pr: number) {
  switch (kind) {
    case 'dissolve': L.opacity *= pr; break;
    case 'fadeBlack': L.opacity *= Math.max(0, (pr - 0.5) * 2); break;
    case 'slideLeft': L.x += 2 * (1 - pr); break;
    case 'zoom': L.scale *= 1.6 - 0.6 * pr; L.opacity *= pr; break;
    case 'wipe': L.wipe = Math.max(0.0001, pr); break;
  }
}
function applyTransitionOut(L: Layer, kind: Transition['kind'], pr: number) {
  switch (kind) {
    case 'dissolve': break; // incoming clip fades in on top
    case 'fadeBlack': L.opacity *= Math.max(0, 1 - pr * 2); break;
    case 'slideLeft': L.x -= 2 * pr; break;
    case 'zoom': L.scale *= 1 + 0.6 * pr; break;
    case 'wipe': break;
  }
}

export interface AudioSource { clip: Clip; assetId: string; gainDb: number; muted: boolean }

export function audioClips(p: Project): AudioSource[] {
  const out: AudioSource[] = [];
  for (const track of p.tracks) {
    if (track.kind !== 'audio' && track.kind !== 'video') continue;
    for (const c of track.clips) {
      if (!c.enabled || !c.assetId) continue;
      const a = p.assets.find(x => x.id === c.assetId);
      if (!a || !a.hasAudio || a.kind === 'image') continue;
      out.push({ clip: c, assetId: a.id, gainDb: c.volumeDb, muted: track.muted || (track.kind === 'video' && track.hidden && false) });
    }
  }
  return out;
}

export const TRANSITIONS: { kind: Transition['kind']; label: string }[] = [
  { kind: 'dissolve', label: 'Fondu enchaîné' },
  { kind: 'fadeBlack', label: 'Fondu au noir' },
  { kind: 'slideLeft', label: 'Glissement' },
  { kind: 'zoom', label: 'Zoom' },
  { kind: 'wipe', label: 'Volet' },
];
