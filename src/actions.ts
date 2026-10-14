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
