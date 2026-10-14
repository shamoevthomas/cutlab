// Scene evaluation: what is visible at time t, with every animated value resolved.
// Pure function shared by preview and export, so both draw the same thing.
import type { Clip, Project, Track, Transition, Us, AnimPreset } from '../model/schema';
import { clipEnd, sourceTimeAt, valueAt } from '../model/ops';

export interface Layer {
  clip: Clip;
  track: Track;
  kind: 'video' | 'image' | 'text' | 'sticker' | 'adjustment';
  assetId?: string;
  sourceUs: Us;              // source time for video
  x: number; y: number; scale: number; rotation: number; opacity: number;
  flipH: boolean; flipV: boolean;
  wipe: number;              // 0 = none, else reveal fraction
  wipeMode?: number;         // 0 left→right, 1 right→left, 2 top→bottom, 3 circle
  textChars?: number;        // typewriter
  adjust: Adjust;
  chroma: { on: boolean; color: [number, number, number]; intensity: number; shadow: number };
  blend: Clip['blend'];
  matte?: { assetId: string; offsetUs: number; invert: boolean };
  crop: { l: number; t: number; r: number; b: number };
  lut?: { assetId: string; amount: number };
}

export interface Adjust {
  brightness: number; contrast: number; saturation: number; exposure: number;
  temperature: number; tint: number; vignette: number; highlights: number; shadows: number;
}

export const neutralAdjust = (): Adjust => ({ brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 0, tint: 0, vignette: 0, highlights: 0, shadows: 0 });

/** CutLab's own filter presets, expressed as adjust offsets (values in −100..100). */
export type FilterDef = Partial<Adjust> & { label: string; cat: string };
export const FILTER_CATS = ['Tendance', 'Portrait', 'Paysage', 'Mono', 'Films', 'Rétro', 'Nuit'];
export const FILTERS: Record<string, FilterDef> = {
  clair: { label: 'Clair', cat: 'Tendance', brightness: 12, contrast: -8, saturation: 6 },
  vif: { label: 'Vif', cat: 'Tendance', saturation: 40, contrast: 14 },
  chaud: { label: 'Chaud', cat: 'Tendance', temperature: 35, saturation: 10, contrast: 6 },
  froid: { label: 'Froid', cat: 'Tendance', temperature: -35, tint: -6, contrast: 8 },
  dore: { label: 'Doré', cat: 'Tendance', temperature: 50, tint: 12, highlights: 12, saturation: 12 },
  peau: { label: 'Peau douce', cat: 'Portrait', brightness: 8, contrast: -10, temperature: 10, saturation: -6, highlights: 8 },
  rose: { label: 'Joues roses', cat: 'Portrait', tint: 14, temperature: 8, brightness: 6 },
  studio: { label: 'Studio', cat: 'Portrait', contrast: 16, shadows: 10, saturation: -8, vignette: 20 },
  pastel: { label: 'Pastel', cat: 'Portrait', saturation: -20, brightness: 14, contrast: -20, tint: 10 },
  nature: { label: 'Nature', cat: 'Paysage', saturation: 28, contrast: 10, temperature: -6, shadows: 8 },
  ocean: { label: 'Océan', cat: 'Paysage', temperature: -28, saturation: 20, contrast: 12 },
  desert: { label: 'Désert', cat: 'Paysage', temperature: 40, saturation: 14, contrast: 16, highlights: -8 },
  brume: { label: 'Brume', cat: 'Paysage', contrast: -28, brightness: 10, saturation: -15 },
  nb: { label: 'Noir & blanc', cat: 'Mono', saturation: -100, contrast: 18 },
  nbDoux: { label: 'N&B doux', cat: 'Mono', saturation: -100, contrast: -10, brightness: 6 },
  nbDur: { label: 'N&B contrasté', cat: 'Mono', saturation: -100, contrast: 45, vignette: 25 },
  sepia: { label: 'Sépia', cat: 'Mono', saturation: -85, temperature: 45, contrast: 8 },
  cinema: { label: 'Cinéma', cat: 'Films', contrast: 22, saturation: -18, temperature: 10, vignette: 35, shadows: -10 },
  tealOrange: { label: 'Bleu-orangé', cat: 'Films', temperature: 18, tint: -8, contrast: 20, saturation: 10, shadows: -12 },
  polar: { label: 'Polar', cat: 'Films', temperature: -20, saturation: -30, contrast: 24, vignette: 30 },
  epique: { label: 'Épique', cat: 'Films', contrast: 30, highlights: -10, shadows: -15, saturation: 6, vignette: 40 },
  vintage: { label: 'Vintage', cat: 'Rétro', saturation: -30, temperature: 25, contrast: -12, vignette: 40, tint: 8 },
  annees80: { label: 'Années 80', cat: 'Rétro', saturation: 35, tint: 18, contrast: 10, temperature: -10 },
  polaroid: { label: 'Polaroid', cat: 'Rétro', brightness: 10, contrast: -18, temperature: 20, saturation: -12, shadows: 15 },
  pellicule: { label: 'Pellicule', cat: 'Rétro', saturation: -15, contrast: 12, temperature: 12, vignette: 30, highlights: -6 },
  sombre: { label: 'Sombre', cat: 'Nuit', brightness: -18, contrast: 20, vignette: 30 },
  nuit: { label: 'Nuit', cat: 'Nuit', temperature: -45, brightness: -15, saturation: -10, contrast: 12 },
  neon: { label: 'Néon', cat: 'Nuit', saturation: 50, tint: 25, contrast: 18, temperature: -18 },
};

export function filterAdjust(preset: string, intensity = 100): Adjust {
  const out = neutralAdjust();
  const f = FILTERS[preset];
  if (f) for (const k of Object.keys(out) as (keyof Adjust)[]) out[k] += Number((f as any)[k] ?? 0) * intensity / 100;
  return out;
}

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

function lutOf(c: Clip): Layer['lut'] {
  const e = c.effects.find(x => x.kind === 'lut' && x.enabled);
  return e ? { assetId: String(e.params.lutAssetId), amount: Number(e.params.intensity ?? 100) / 100 } : undefined;
}

function matteOf(c: Clip): Layer['matte'] {
  const e = c.effects.find(x => x.kind === 'matte' && x.enabled);
  return e ? { assetId: String(e.params.maskAssetId), offsetUs: Number(e.params.maskStartUs ?? 0), invert: !!e.params.invert } : undefined;
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
    adjust: adjustOf(c), chroma: chromaOf(c), blend: c.blend, matte: matteOf(c), crop: c.crop ?? { l: 0, t: 0, r: 0, b: 0 }, lut: lutOf(c),
  };
  const d = Math.min(c.animDurUs, c.durationUs / 2);
  if (c.animIn !== 'none' && rel < d) applyAnim(L, c.animIn, rel / d);
  if (c.animOut !== 'none' && clipEnd(c) - t < d) applyAnim(L, c.animOut, (clipEnd(c) - t) / d);
  return L;
}

export function layerKind(p: Project, track: Track, c: Clip): Layer['kind'] | null {
  if (track.kind === 'adjustment') return 'adjustment';
  if (track.kind === 'audio' || track.kind === 'effect' || track.kind === 'filter') return null;
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

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const flashAmount = (pr: number) => 1 - Math.abs(2 * pr - 1);

function applyTransitionIn(L: Layer, kind: Transition['kind'], pr: number) {
  const e = ease(pr);
  switch (kind) {
    case 'dissolve': L.opacity *= pr; break;
    case 'fadeBlack': L.opacity *= Math.max(0, (pr - 0.5) * 2); break;
    case 'flash': L.opacity *= pr < 0.5 ? 0 : 1; L.adjust.exposure += 260 * flashAmount(pr); break;
    case 'slideLeft': L.x += 2 * (1 - e); break;
    case 'slideRight': L.x -= 2 * (1 - e); break;
    case 'slideUp': L.y -= 2 * (1 - e); break;
    case 'slideDown': L.y += 2 * (1 - e); break;
    case 'push': L.x += 2 * (1 - e); break;
    case 'zoom': L.scale *= 1.6 - 0.6 * e; L.opacity *= pr; break;
    case 'zoomOut': L.scale *= 0.5 + 0.5 * e; L.opacity *= pr; break;
    case 'spin': L.rotation += (1 - e) * -180; L.scale *= 0.4 + 0.6 * e; L.opacity *= Math.min(1, pr * 2); break;
    case 'wipe': L.wipe = Math.max(0.0001, pr); L.wipeMode = 0; break;
    case 'wipeRight': L.wipe = Math.max(0.0001, pr); L.wipeMode = 1; break;
    case 'wipeDown': L.wipe = Math.max(0.0001, pr); L.wipeMode = 2; break;
    case 'iris': L.wipe = Math.max(0.0001, pr); L.wipeMode = 3; break;
  }
}
function applyTransitionOut(L: Layer, kind: Transition['kind'], pr: number) {
  const e = ease(pr);
  switch (kind) {
    case 'fadeBlack': L.opacity *= Math.max(0, 1 - pr * 2); break;
    case 'flash': L.adjust.exposure += 260 * flashAmount(pr); break;
    case 'push': L.x -= 2 * e; break;
    case 'zoom': L.scale *= 1 + 0.6 * e; break;
    case 'zoomOut': L.scale *= 1 - 0.3 * e; break;
    case 'spin': L.rotation += e * 180; L.scale *= 1 - 0.6 * e; L.opacity *= Math.max(0, 1 - pr * 2); break;
    default: break; // the incoming clip covers the outgoing one
  }
}

export interface AudioSource { clip: Clip; assetId: string; gainDb: number; muted: boolean }

export function audioClips(p: Project): AudioSource[] {
  const out: AudioSource[] = [];
  for (const track of p.tracks) {
    if (track.kind !== 'audio' && track.kind !== 'video') continue;
    for (const c of track.clips) {
      if (!c.enabled || !c.assetId) continue;
      const a = p.assets.find(x => x.id === (c.audioAssetId ?? c.assetId));
      if (!a || !a.hasAudio || a.kind === 'image') continue;
      out.push({ clip: c, assetId: a.id, gainDb: c.volumeDb, muted: track.muted });
    }
  }
  return out;
}

export const TRANSITION_CATS = ['Classique', 'Glissement', 'Zoom', 'Volets'];
export const TRANSITIONS: { kind: Transition['kind']; label: string; cat: string }[] = [
  { kind: 'dissolve', label: 'Fondu enchaîné', cat: 'Classique' },
  { kind: 'fadeBlack', label: 'Fondu au noir', cat: 'Classique' },
  { kind: 'flash', label: 'Flash blanc', cat: 'Classique' },
  { kind: 'slideLeft', label: 'Glissement', cat: 'Glissement' },
  { kind: 'slideRight', label: 'Glissement droite', cat: 'Glissement' },
  { kind: 'slideUp', label: 'Glissement haut', cat: 'Glissement' },
  { kind: 'slideDown', label: 'Glissement bas', cat: 'Glissement' },
  { kind: 'push', label: 'Pousser', cat: 'Glissement' },
  { kind: 'zoom', label: 'Zoom', cat: 'Zoom' },
  { kind: 'zoomOut', label: 'Zoom arrière', cat: 'Zoom' },
  { kind: 'spin', label: 'Tourbillon', cat: 'Zoom' },
  { kind: 'wipe', label: 'Volet', cat: 'Volets' },
  { kind: 'wipeRight', label: 'Volet droite', cat: 'Volets' },
  { kind: 'wipeDown', label: 'Volet bas', cat: 'Volets' },
  { kind: 'iris', label: 'Cercle', cat: 'Volets' },
];
