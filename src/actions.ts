import { integratedLoudness } from './model/loudness';
import { timelineAudio16k, transcribe, assetSamples, resampleMono, AsrProgress } from './engine/asr';
import { wordsToCues, fillerRanges, REEL_CUES, LONG_CUES, Word } from './model/captions';
import { detectSilences, autoThreshold, rmsDb } from './model/silence';
import { decodeAudio } from './engine/media';
// User-level actions shared by menus, shortcuts and panels.
import { useStore } from './store';
import { bridge } from './bridge';
import * as op from './model/ops';
import { probe } from './engine/media';
import type { Asset, Track, TrackKind } from './model/schema';
import { newProject, uid, newTrack, newClip, defaultTextStyle } from './model/schema';
import { parseSubtitles, writeSrt } from './model/srt';
import type { PickedFile } from './bridge/types';

const st = () => useStore.getState();

export async function importFiles(files: PickedFile[], addToTimeline = false): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const f of files) {
    try { out.push(await probe(f)); }
    catch (e: any) { st().notify('error', e?.message ?? `Import impossible : ${f.name}`); }
  }
  if (!out.length) return out;
  st().edit(p => {
    p.assets.push(...out);
    if (addToTimeline) {
      let at = st().playheadUs;
      for (const a of out) { const c = op.addAssetClip(p, a, at, { magnet: st().magnet }); at = op.clipEnd(c); }
    }
  });
  st().notify('success', out.length > 1 ? `${out.length} médias importés` : `${out[0].name} importé`);
  return out;
}

export async function pickAndImport(addToTimeline = false) {
  const files = await bridge.pickFiles('media');
  if (files.length) await importFiles(files, addToTimeline);
}

export function addAssetAtPlayhead(assetId: string, at?: number, trackId?: string) {
  const s = st();
  const asset = s.project?.assets.find(a => a.id === assetId);
  if (!asset) return;
  let clipId = '';
  s.edit(p => { clipId = op.addAssetClip(p, asset, at ?? s.playheadUs, { magnet: s.magnet, trackId }).id; });
  s.select([clipId]);
}

export function addText(content = 'Texte', style?: Partial<import('./model/schema').TextStyle>) {
  const s = st();
  let id = '';
  s.edit(p => {
    const c = op.addTextClip(p, s.playheadUs, content);
    if (style) Object.assign(c.text!.style, style);
    id = c.id;
  });
  s.select([id]);
}

export function splitAtPlayhead() {
  const s = st();
  const ids = s.selection.length ? s.selection : undefined;
  s.edit(p => { op.splitAt(p, s.playheadUs, ids); });
}

export function deleteSelection(ripple = false) {
  const s = st();
  if (!s.selection.length) return;
  s.edit(p => op.deleteClips(p, s.selection, ripple));
  s.select([]);
}

export function deleteSide(side: 'left' | 'right') {
  const s = st();
  const p = s.project;
  if (!p) return;
  const t = s.playheadUs;
  // selected clip under the playhead, else the main-track clip under it
  let target = s.selection.find(id => { const r = op.findClip(p, id); return r && r.clip.startUs < t && op.clipEnd(r.clip) > t; });
  if (!target) target = op.mainTrack(p as any).clips.find(c => c.startUs < t && op.clipEnd(c) > t)?.id;
  if (!target) return;
  const ref = op.findClip(p, target)!;
  s.edit(d => op.deleteSide(d, target!, t, side));
  if (side === 'left' && ref.track.isMain) s.seek(ref.clip.startUs);
}

export function duplicateSelection() {
  const s = st();
  const ids: string[] = [];
  s.edit(p => { for (const id of s.selection) { const c = op.duplicateClip(p, id); if (c) ids.push(c.id); } });
  s.select(ids);
}

let clipboard: { clips: any[]; kinds: TrackKind[] } | null = null;
export function copySelection() {
  const p = st().project;
  if (!p) return;
  const refs = st().selection.map(id => op.findClip(p, id)).filter(Boolean) as op.ClipRef[];
  if (!refs.length) return;
  const t0 = Math.min(...refs.map(r => r.clip.startUs));
  clipboard = { clips: refs.map(r => ({ ...JSON.parse(JSON.stringify(r.clip)), startUs: r.clip.startUs - t0 })), kinds: refs.map(r => r.track.kind) };
  st().notify('info', 'Copié');
}
export function cutSelection() { copySelection(); deleteSelection(); }
export function paste() {
  if (!clipboard) return;
  const s = st();
  const ids: string[] = [];
  s.edit(p => {
    clipboard!.clips.forEach((src, i) => {
      const c = { ...JSON.parse(JSON.stringify(src)), id: uid(), startUs: s.playheadUs + src.startUs };
      const kind = clipboard!.kinds[i];
      if (kind === 'video' && s.magnet) {
        op.insertIntoMain(op.mainTrack(p), c, c.startUs);
      } else {
        const t = op.trackWithRoom(p, kind, c.startUs, c.durationUs, s.magnet);
        t.clips.push(c); op.sortTrack(t);
      }
      ids.push(c.id);
    });
  });
  s.select(ids);
}

export function toggleEnabled() {
  const s = st();
  s.edit(p => { for (const id of s.selection) { const r = op.findClip(p, id); if (r) r.clip.enabled = !r.clip.enabled; } });
}

export function addMarker() {
  const s = st();
  s.edit(p => { p.markers.push({ id: uid(), tUs: s.playheadUs, color: '#3ee08f', kind: 'marker' }); });
}

export function jumpCut(dir: 1 | -1) {
  const s = st();
  const p = s.project;
  if (!p) return;
  const cuts = new Set<number>([0, op.projectDuration(p)]);
  for (const t of p.tracks) for (const c of t.clips) { cuts.add(c.startUs); cuts.add(op.clipEnd(c)); }
  const sorted = [...cuts].sort((a, b) => a - b);
  const t = s.playheadUs;
  const next = dir > 0 ? sorted.find(x => x > t + 1) : [...sorted].reverse().find(x => x < t - 1);
  if (next !== undefined) s.seek(next);
}

export function stepFrames(n: number) {
  const s = st();
  if (!s.project) return;
  s.set('playing', false);
  s.seek(s.playheadUs + n * op.frameUs(s.project.fps));
}

export async function importSubtitles() {
  const files = await bridge.pickFiles('srt');
  if (!files.length) return;
  const text = await bridge.readText(files[0].path);
  const cues = parseSubtitles(text);
  if (!cues.length) { st().notify('error', 'Aucun sous-titre lisible dans ce fichier'); return; }
  st().edit(p => {
    const tracks: Track[] = [];
    for (const cue of cues) {
      const dur = Math.max(op.MIN_CLIP_US, cue.endUs - cue.startUs);
      let tr = tracks.find(t => op.isFree(t, cue.startUs, dur));
      if (!tr) { tr = newTrack('text'); tracks.push(tr); }
      const c = newClip({ startUs: cue.startUs, durationUs: dur, label: cue.text,
        text: { content: cue.text, style: { ...defaultTextStyle(), size: 54, strokeWidth: 4, shadow: false } } });
      c.transform.y = -0.72;
      tr.clips.push(c);
    }
    p.tracks.push(...tracks);
  });
  st().notify('success', `${cues.length} sous-titres importés`);
}

export async function exportSubtitles() {
  const p = st().project;
  if (!p) return;
  const cues = p.tracks.filter(t => t.kind === 'text').flatMap(t => t.clips).filter(c => c.text)
    .map(c => ({ startUs: c.startUs, endUs: op.clipEnd(c), text: c.text!.content })).sort((a, b) => a.startUs - b.startUs);
  if (!cues.length) { st().notify('error', 'Aucun texte à exporter'); return; }
  const path = await bridge.saveExport(`${p.name}.srt`, new TextEncoder().encode(writeSrt(cues)));
  if (path) st().notify('success', 'Sous-titres exportés');
}

export async function createProject(name: string, ratio: string, fps: number) {
  const p = newProject(name || 'Sans titre', ratio, fps);
  await bridge.saveProject(p);
  st().open(p);
}

export async function openProject(id: string) {
  const p = await bridge.loadProject(id);
  if (!p) { st().notify('error', 'Projet introuvable'); return; }
  // re-resolve asset urls (media:// on desktop, blob: in the browser)
  for (const a of p.assets) a.url = (await bridge.resolve(a.path)) ?? '';
  st().open(p);
}

let saving: Promise<void> | null = null;
export async function saveNow(cover?: string) {
  const s = st();
  if (!s.project) return;
  const p = s.project;
  await saving;
  saving = bridge.saveProject(p, cover).then(() => { if (st().project === p) st().markSaved(); })
    .catch((e) => st().notify('error', 'Sauvegarde impossible : ' + (e?.message ?? e)));
  await saving;
}

// ---------- phase 2: auto captions & auto-cut ----------

export type CaptionStyle = 'reel' | 'classic' | 'band' | 'yellow';
export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: 'reel', label: 'Reel (3-4 mots, gros)' },
  { id: 'classic', label: 'Classique (phrases)' },
  { id: 'band', label: 'Bandeau noir' },
  { id: 'yellow', label: 'Jaune contour' },
];

function captionStyle(id: CaptionStyle, portrait: boolean) {
  const base = { ...defaultTextStyle(), shadow: false };
  switch (id) {
    case 'reel': return { ...base, size: portrait ? 78 : 64, bold: true, strokeWidth: 7, strokeColor: '#000000', font: 'Poppins' };
    case 'classic': return { ...base, size: portrait ? 54 : 46, bold: true, strokeWidth: 4, strokeColor: '#000000' };
    case 'band': return { ...base, size: portrait ? 52 : 44, bold: true, bgColor: '#000000', bgOpacity: 80 };
    case 'yellow': return { ...base, size: portrait ? 72 : 60, bold: true, color: '#ffd23f', strokeWidth: 7, strokeColor: '#000000', font: 'Poppins' };
  }
}

export async function generateCaptions(opts: { model: string; language: string | null; style: CaptionStyle; upper: boolean }, onProgress: (p: AsrProgress) => void) {
  const p = st().project;
  if (!p) return 0;
  onProgress({ phase: 'audio', text: 'Préparation du son de la timeline…' });
  const samples = await timelineAudio16k(p);
  if (!samples) throw new Error('Aucun son dans la timeline');
  const words = await transcribe(samples, opts.model, opts.language, onProgress);
  if (!words.length) throw new Error('Aucune parole détectée');
  const portrait = p.canvas.height > p.canvas.width;
  const cues = wordsToCues(words, { ...(opts.style === 'reel' || opts.style === 'yellow' ? REEL_CUES : LONG_CUES), upper: opts.upper });
  const style = captionStyle(opts.style, portrait);
  st().edit(d => {
    d.tracks = d.tracks.filter(t => t.role !== 'captions');
    const tracks: Track[] = [];
    for (const cue of cues) {
      const start = Math.round(cue.start * 1e6), dur = Math.max(op.MIN_CLIP_US, Math.round((cue.end - cue.start) * 1e6));
      let tr = tracks.find(t => op.isFree(t, start, dur));
      if (!tr) { tr = { ...newTrack('text'), role: 'captions' }; tracks.push(tr); }
      const c = newClip({ startUs: start, durationUs: dur, label: cue.text,
        text: { content: cue.text, style: { ...style }, words: cue.words.map(w => ({ t0Us: Math.round((w.start - cue.start) * 1e6), t1Us: Math.round((w.end - cue.start) * 1e6), text: w.text })) } });
      c.transform.y = portrait ? -0.45 : -0.72;
      tr.clips.push(c);
    }
    d.tracks.push(...tracks);
  });
  return cues.length;
}

export interface CutPlan { clipId: string; removeSrc: [number, number][]; removedUs: number; count: number }

/** Find silences (and optionally fillers) in the given clips without changing anything. */
export async function planAutoCut(clipIds: string[], o: { thresholdDb: number | 'auto'; minSilenceS: number; padS: number; fillers: boolean; model: string; language: string | null },
  onProgress: (p: AsrProgress) => void): Promise<CutPlan[]> {
  const p = st().project!;
  const plans: CutPlan[] = [];
  for (const id of clipIds) {
    const ref = op.findClip(p, id);
    const a = ref && p.assets.find(x => x.id === ref.clip.assetId);
    if (!ref || !a || a.kind === 'image') continue;
    onProgress({ phase: 'audio', text: `Analyse du son : ${a.name}` });
    const s = await assetSamples(a);
    if (!s) continue;
    const c = ref.clip;
    const s0 = c.inUs / 1e6, s1 = (c.inUs + c.durationUs * c.speed) / 1e6;
    const slice = s.data.subarray(Math.floor(s0 * s.rate), Math.ceil(s1 * s.rate));
    const thr = o.thresholdDb === 'auto' ? autoThreshold(rmsDb(slice, s.rate)) : o.thresholdDb;
    const remove: [number, number][] = detectSilences(slice, s.rate, { thresholdDb: thr, minSilenceS: o.minSilenceS, padS: o.padS })
      .map(([x, y]) => [Math.round((s0 + x) * 1e6), Math.round((s0 + y) * 1e6)]);
    if (o.fillers) {
      const buf = await decodeAudio(a);
      if (buf) {
        const pcm = await resampleMono(buf, s0, s1);
        const words: Word[] = await transcribe(pcm, o.model, o.language, onProgress);
        for (const f of fillerRanges(words)) remove.push([Math.round((s0 + f.start) * 1e6), Math.round((s0 + f.end) * 1e6)]);
      }
    }
    const merged = mergeRanges(remove);
    plans.push({ clipId: id, removeSrc: merged, count: merged.length, removedUs: Math.round(merged.reduce((t, [x, y]) => t + (y - x), 0) / c.speed) });
  }
  return plans;
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const s = [...r].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const x of s) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([...x] as [number, number]); }
  return out;
}

export function applyAutoCut(plans: CutPlan[]) {
  st().edit(d => { for (const pl of plans) op.cutSourceRanges(d, pl.clipId, pl.removeSrc); });
  st().select([]);
}

// ---------- loudness ----------

/** Set each clip's volume so its loudness hits the target (LUFS). Returns the measured values. */
export async function normalizeClips(clipIds: string[], target: number): Promise<{ id: string; measured: number; gainDb: number }[]> {
  const p = st().project!;
  const out: { id: string; measured: number; gainDb: number }[] = [];
  for (const id of clipIds) {
    const ref = op.findClip(p, id);
    const a = ref && p.assets.find(x => x.id === ref.clip.assetId);
    if (!ref || !a) continue;
    const buf = await decodeAudio(a);
    if (!buf) continue;
    const c = ref.clip;
    const s0 = Math.floor((c.inUs / 1e6) * buf.sampleRate), s1 = Math.ceil(((c.inUs + c.durationUs * c.speed) / 1e6) * buf.sampleRate);
    const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i).subarray(s0, s1));
    const measured = integratedLoudness(chans, buf.sampleRate);
    if (!Number.isFinite(measured)) continue;
    const gainDb = Math.max(-60, Math.min(20, Math.round((target - measured) * 10) / 10));
    out.push({ id, measured, gainDb });
  }
  st().edit(d => { for (const r of out) { const ref = op.findClip(d, r.id); if (ref) { ref.clip.volumeDb = r.gainDb; ref.clip.keyframes = ref.clip.keyframes.filter(k => k.property !== 'volumeDb'); } } });
  return out;
}

// ---------- phase 3: auto-reframe & background removal ----------

export type ReframeSpeed = 'slow' | 'normal' | 'fast';

/** Fill the canvas with the clip and animate X so the main face stays centred. */
export async function autoReframe(clipId: string, o: { speed: ReframeSpeed; zoom: number }, onProgress: (r: number) => void) {
  const { trackFaces, smoothPath } = await import('./engine/vision');
  const p = st().project!;
  const ref = op.findClip(p, clipId);
  const a = ref && p.assets.find(x => x.id === ref.clip.assetId);
  if (!ref || !a || a.kind !== 'video' || !a.width || !a.height) throw new Error('Sélectionne un clip vidéo');
  const c = ref.clip;
  const s0 = c.inUs / 1e6, s1 = (c.inUs + c.durationUs * c.speed) / 1e6;
  const step = 0.25;
  const samples = await trackFaces(a.url, s0, s1, step, onProgress);
  if (!samples.some(s => s.found)) throw new Error('Aucun visage détecté dans ce clip');
  const xs = smoothPath(samples, { slow: 0.92, normal: 0.8, fast: 0.55 }[o.speed]);
  const W = p.canvas.width, H = p.canvas.height;
  const contain = Math.min(W / a.width, H / a.height), cover = Math.max(W / a.width, H / a.height);
  const scale = (cover / contain) * o.zoom;
  const shownW = a.width * contain * scale;
  const maxOff = Math.max(0, (shownW - W) / 2);
  st().edit(d => {
    const cc = op.findClip(d, clipId)!.clip;
    cc.keyframes = cc.keyframes.filter(k => k.property !== 'x' && k.property !== 'scale');
    cc.transform.scale = scale;
    cc.transform.y = 0;
    let lastX = Infinity;
    samples.forEach((s, i) => {
      const off = Math.max(-maxOff, Math.min(maxOff, -(xs[i] - 0.5) * shownW));
      const x = off / (W / 2);
      const rel = Math.round(((s.t - s0) / c.speed) * 1e6);
      if (rel < 0 || rel > cc.durationUs) return;
      // keep only keyframes that move the frame noticeably (≥ 0.5 % of the width)
      if (Math.abs(x - lastX) < 0.01 && i !== samples.length - 1) return;
      cc.keyframes.push({ id: uid(), property: 'x', tUs: rel, value: x, easing: 'easeInOut' });
      lastX = x;
    });
    if (!cc.keyframes.some(k => k.property === 'x')) cc.transform.x = 0;
  });
  return samples.filter(s => s.found).length / samples.length;
}

/** Person segmentation → matte video stored with the project → used as the clip's alpha. */
export async function removeBackground(clipId: string, onProgress: (r: number) => void, signal?: AbortSignal) {
  const { renderMatte } = await import('./engine/vision');
  const p = st().project!;
  const ref = op.findClip(p, clipId);
  const a = ref && p.assets.find(x => x.id === ref.clip.assetId);
  if (!ref || !a || a.kind !== 'video') throw new Error('Sélectionne un clip vidéo');
  const c = ref.clip;
  const s0 = c.inUs / 1e6, s1 = (c.inUs + c.durationUs * c.speed) / 1e6;
  const { data, width, height } = await renderMatte(a.url, s0, s1, Math.min(30, p.fps), onProgress, signal);
  const file = await bridge.writeFile(p.id, `matte-${a.id.slice(0, 8)}-${Math.round(s0 * 1000)}.mp4`, data);
  const matte: Asset = { id: uid(), kind: 'video', name: `Détourage ${a.name}`, path: file.path, url: file.url, width, height, durationUs: Math.round((s1 - s0) * 1e6), hasAudio: false, derived: 'matte' };
  st().edit(d => {
    d.assets.push(matte);
    const cc = op.findClip(d, clipId)!.clip;
    cc.effects = cc.effects.filter(e => e.kind !== 'matte');
    cc.effects.push({ id: uid(), kind: 'matte', enabled: true, params: { maskAssetId: matte.id, maskStartUs: c.inUs, invert: false } });
  });
}
