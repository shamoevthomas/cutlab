// Pure timeline operations. They mutate the project passed in (an immer draft in the store,
// a plain object in tests) and keep the invariants:
//  - clips on a track are sorted and never overlap
//  - the main video track (magnet on) has no gaps and starts at 0
import {
  Asset, AnimProp, Clip, Easing, Keyframe, Project, Track, TrackKind, Us,
  newClip, newTrack, uid, defaultTextStyle,
} from './schema';

export const MIN_CLIP_US = 33_334; // ~1 frame at 30 fps
export const IMAGE_DEFAULT_US = 3_000_000;
export const TEXT_DEFAULT_US = 3_000_000;

export const frameUs = (fps: number) => Math.round(1_000_000 / fps);
export const snapFrame = (t: Us, fps: number) => Math.round(t / frameUs(fps)) * frameUs(fps);

export function trackKindForAsset(a: Asset): TrackKind {
  if (a.kind === 'audio') return 'audio';
  if (a.kind === 'sticker') return 'sticker';
  return 'video';
}

export interface ClipRef { track: Track; clip: Clip; index: number; trackIndex: number }

export function findClip(p: Project, clipId: string): ClipRef | null {
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const track = p.tracks[ti];
    const index = track.clips.findIndex(c => c.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index], index, trackIndex: ti };
  }
  return null;
}

export const clipEnd = (c: Clip) => c.startUs + c.durationUs;

export function projectDuration(p: Project): Us {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function sortTrack(t: Track) { t.clips.sort((a, b) => a.startUs - b.startUs); }

/** Close every gap on the main track so clips play back to back from 0. */
export function compactMain(t: Track) {
  // array order is the play order on the magnet track; don't re-sort here
  let cursor = 0;
  for (const c of t.clips) { c.startUs = cursor; cursor += c.durationUs; }
}

export function mainTrack(p: Project): Track {
  let t = p.tracks.find(x => x.isMain);
  if (!t) { t = newTrack('video', true); p.tracks.unshift(t); }
  return t;
}

export function isFree(t: Track, start: Us, dur: Us, ignoreId?: string): boolean {
  const end = start + dur;
  return t.clips.every(c => c.id === ignoreId || clipEnd(c) <= start || c.startUs >= end);
}

/** Track of `kind` above the main track with room at [start, start+dur), or a new one. */
export function trackWithRoom(p: Project, kind: TrackKind, start: Us, dur: Us, magnet: boolean): Track {
  for (const t of p.tracks) {
    if (t.kind !== kind || t.locked) continue;
    if (t.isMain && magnet) continue;
    if (isFree(t, start, dur)) return t;
  }
  const t = newTrack(kind);
  p.tracks.push(t); // render order only matters for visual tracks; the UI shows audio below main
  return t;
}

/** Insert into the magnet main track: at the cut nearest to `atUs`, rippling what follows. */
export function insertIntoMain(t: Track, clip: Clip, atUs: Us) {
  sortTrack(t);
  let idx = t.clips.length;
  for (let i = 0; i < t.clips.length; i++) {
    const c = t.clips[i];
    if (atUs < c.startUs + c.durationUs / 2) { idx = i; break; }
  }
  t.clips.splice(idx, 0, clip);
  compactMain(t);
}

export function sourceDurationUs(a: Asset | undefined): Us {
  if (!a) return TEXT_DEFAULT_US;
  if (a.kind === 'image' || a.kind === 'sticker') return IMAGE_DEFAULT_US;
  return a.durationUs ?? IMAGE_DEFAULT_US;
}

export function addAssetClip(p: Project, asset: Asset, atUs: Us, opts: { magnet?: boolean; trackId?: string } = {}): Clip {
  const magnet = opts.magnet ?? true;
  const dur = sourceDurationUs(asset);
  const clip = newClip({ assetId: asset.id, startUs: Math.max(0, atUs), durationUs: dur, label: asset.name });
  const kind = trackKindForAsset(asset);
  let track = opts.trackId ? p.tracks.find(t => t.id === opts.trackId) : undefined;
  if (!track) {
    const main = mainTrack(p);
    if (kind === 'video' && (main.clips.length === 0 || magnet)) track = main;
  }
  if (track && track.isMain && magnet) { insertIntoMain(track, clip, atUs); return clip; }
  if (!track || !isFree(track, clip.startUs, dur)) track = trackWithRoom(p, kind, clip.startUs, dur, magnet);
  track.clips.push(clip);
  sortTrack(track);
  return clip;
}


export function addTextClip(p: Project, atUs: Us, content = 'Texte'): Clip {
  const clip = newClip({ startUs: Math.max(0, atUs), durationUs: TEXT_DEFAULT_US, text: { content, style: defaultTextStyle() }, label: content });
  const track = trackWithRoom(p, 'text', clip.startUs, clip.durationUs, true);
  track.clips.push(clip);
  sortTrack(track);
  return clip;
}

/** Split one clip at timeline time t. Returns the new right-hand clip. */
export function splitClip(p: Project, clipId: string, t: Us): Clip | null {
  const ref = findClip(p, clipId);
  if (!ref) return null;
  const { clip, track } = ref;
  if (t <= clip.startUs + MIN_CLIP_US || t >= clipEnd(clip) - MIN_CLIP_US) return null;
  const leftDur = t - clip.startUs;
  const right: Clip = structuredCloneSafe(clip);
  right.id = uid();
  right.startUs = t;
  right.durationUs = clip.durationUs - leftDur;
  right.inUs = clip.reverse ? clip.inUs : clip.inUs + Math.round(leftDur * clip.speed);
  if (clip.reverse) clip.inUs = clip.inUs + Math.round(right.durationUs * clip.speed);
  right.keyframes = clip.keyframes.filter(k => k.tUs >= leftDur).map(k => ({ ...k, id: uid(), tUs: k.tUs - leftDur }));
  clip.keyframes = clip.keyframes.filter(k => k.tUs < leftDur);
  right.fadeInUs = 0;
  clip.fadeOutUs = 0;
  clip.durationUs = leftDur;
  track.clips.splice(ref.index + 1, 0, right);
  // a transition that started from the left part now starts from the right part
  for (const tr of p.transitions) if (tr.fromClipId === clip.id) tr.fromClipId = right.id;
  return right;
}

/** Split every unlocked clip under the playhead (or only the given ones). */
export function splitAt(p: Project, t: Us, onlyIds?: string[]): string[] {
  const created: string[] = [];
  for (const track of p.tracks) {
    if (track.locked) continue;
    for (const c of [...track.clips]) {
      if (onlyIds && onlyIds.length && !onlyIds.includes(c.id)) continue;
      if (c.startUs < t && clipEnd(c) > t) {
        const r = splitClip(p, c.id, t);
        if (r) created.push(r.id);
      }
    }
  }
  return created;
}

export function deleteClips(p: Project, ids: string[], ripple = false) {
  for (const track of p.tracks) {
    if (track.locked) continue;
    const removed = track.clips.filter(c => ids.includes(c.id));
    if (!removed.length) continue;
    track.clips = track.clips.filter(c => !ids.includes(c.id));
    if (track.isMain) compactMain(track);
    else if (ripple) {
      for (const r of removed.sort((a, b) => b.startUs - a.startUs))
        for (const c of track.clips) if (c.startUs >= clipEnd(r)) c.startUs -= r.durationUs;
    }
  }
  p.transitions = p.transitions.filter(tr => !ids.includes(tr.fromClipId) && !ids.includes(tr.toClipId));
  pruneEmptyTracks(p);
}

export function pruneEmptyTracks(p: Project) {
  p.tracks = p.tracks.filter(t => t.isMain || t.clips.length > 0);
}

/** Q / W: delete the part of the clip left / right of t (ripple on the main track). */
export function deleteSide(p: Project, clipId: string, t: Us, side: 'left' | 'right') {
  const ref = findClip(p, clipId);
  if (!ref) return;
  const right = splitClip(p, clipId, t);
  if (!right) return;
  deleteClips(p, [side === 'left' ? ref.clip.id : right.id], true);
}

export interface SourceBounds { maxSourceUs: Us | null } // null = unlimited (image, text)

export function sourceBounds(p: Project, c: Clip): SourceBounds {
  const a = c.assetId ? p.assets.find(x => x.id === c.assetId) : undefined;
  if (!a || a.kind === 'image' || a.kind === 'sticker') return { maxSourceUs: null };
  return { maxSourceUs: a.durationUs ?? null };
}

/** Drag a clip edge by delta (µs, timeline time). Respects source length and neighbours. */
export function trimClip(p: Project, clipId: string, edge: 'start' | 'end', deltaUs: Us) {
  const ref = findClip(p, clipId);
  if (!ref) return;
  const { clip, track, index } = ref;
  const { maxSourceUs } = sourceBounds(p, clip);
  const prev = track.clips[index - 1];
  const next = track.clips[index + 1];
  if (edge === 'start') {
    let d = deltaUs;
    d = Math.min(d, clip.durationUs - MIN_CLIP_US);                       // keep a minimum
    if (maxSourceUs !== null) d = Math.max(d, -clip.inUs / clip.speed);    // can't go before source start
    if (!track.isMain && prev) d = Math.max(d, clipEnd(prev) - clip.startUs);
    if (!track.isMain) d = Math.max(d, -clip.startUs);
    clip.inUs += Math.round(d * clip.speed);
    clip.durationUs -= d;
    if (!track.isMain) clip.startUs += d;
    clip.keyframes = clip.keyframes.map(k => ({ ...k, tUs: k.tUs - d })).filter(k => k.tUs >= 0 && k.tUs <= clip.durationUs);
  } else {
    let d = deltaUs;
    d = Math.max(d, MIN_CLIP_US - clip.durationUs);
    if (maxSourceUs !== null) d = Math.min(d, (maxSourceUs - clip.inUs) / clip.speed - clip.durationUs);
    if (!track.isMain && next) d = Math.min(d, next.startUs - clipEnd(clip));
    clip.durationUs += d;
    clip.keyframes = clip.keyframes.filter(k => k.tUs <= clip.durationUs);
  }
  clip.durationUs = Math.round(clip.durationUs);
  if (track.isMain) compactMain(track);
}

/** Move a clip to a new start and/or track. Returns false if refused (overlap / kind mismatch). */
export function moveClip(p: Project, clipId: string, newStart: Us, targetTrackId?: string, magnet = true): boolean {
  const ref = findClip(p, clipId);
  if (!ref) return false;
  const { clip, track } = ref;
  const target = targetTrackId ? p.tracks.find(t => t.id === targetTrackId) : track;
  if (!target || target.locked) return false;
  if (!compatible(track.kind, target.kind)) return false;
  newStart = Math.max(0, Math.round(newStart));
  if (target.isMain && magnet) {
    track.clips.splice(ref.index, 1);
    if (track.isMain) compactMain(track);
    insertIntoMain(target, clip, newStart);
  } else {
    if (!isFree(target, newStart, clip.durationUs, clip.id)) return false;
    track.clips.splice(ref.index, 1);
    if (track.isMain && magnet) compactMain(track);
    clip.startUs = newStart;
    target.clips.push(clip);
    sortTrack(target);
  }
  pruneEmptyTracks(p);
  return true;
}

const compatible = (a: TrackKind, b: TrackKind) =>
  a === b || (['video', 'sticker'].includes(a) && ['video', 'sticker'].includes(b));

/** Change speed keeping the source range: the timeline length scales by 1/speed. */
export function setSpeed(p: Project, clipId: string, speed: number) {
  const ref = findClip(p, clipId);
  if (!ref) return;
  const { clip, track, index } = ref;
  speed = Math.min(100, Math.max(0.1, speed));
  const srcLen = clip.durationUs * clip.speed;
  let newDur = Math.round(srcLen / speed);
  const next = track.clips[index + 1];
  if (!track.isMain && next) newDur = Math.min(newDur, next.startUs - clip.startUs);
  const ratio = newDur / clip.durationUs;
  clip.keyframes = clip.keyframes.map(k => ({ ...k, tUs: Math.round(k.tUs * ratio) }));
  clip.speed = speed;
  clip.durationUs = Math.max(MIN_CLIP_US, newDur);
  if (track.isMain) compactMain(track);
}

/** Source time (µs into the asset) shown at timeline time t. */
export function sourceTimeAt(c: Clip, t: Us): Us {
  const rel = Math.min(Math.max(t - c.startUs, 0), c.durationUs);
  return c.reverse ? c.inUs + (c.durationUs - rel) * c.speed : c.inUs + rel * c.speed;
}

export function duplicateClip(p: Project, clipId: string): Clip | null {
  const ref = findClip(p, clipId);
  if (!ref) return null;
  const copy = structuredCloneSafe(ref.clip);
  copy.id = uid();
  copy.keyframes = copy.keyframes.map(k => ({ ...k, id: uid() }));
  if (ref.track.isMain) { ref.track.clips.splice(ref.index + 1, 0, copy); compactMain(ref.track); return copy; }
  copy.startUs = clipEnd(ref.clip);
  const track = isFree(ref.track, copy.startUs, copy.durationUs) ? ref.track : trackWithRoom(p, ref.track.kind, copy.startUs, copy.durationUs, true);
  track.clips.push(copy);
  sortTrack(track);
  return copy;
}

// ---------- keyframes ----------

const ease = (e: Easing, x: number) => {
  switch (e) {
    case 'easeIn': return x * x;
    case 'easeOut': return 1 - (1 - x) * (1 - x);
    case 'easeInOut': return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    default: return x;
  }
};

export function baseValue(c: Clip, prop: AnimProp): number {
  if (prop === 'volumeDb') return c.volumeDb;
  return c.transform[prop];
}

/** Animated value of `prop` at time relative to clip start. */
export function valueAt(c: Clip, prop: AnimProp, rel: Us): number {
  const ks = c.keyframes.filter(k => k.property === prop).sort((a, b) => a.tUs - b.tUs);
  if (!ks.length) return baseValue(c, prop);
  if (rel <= ks[0].tUs) return ks[0].value;
  const last = ks[ks.length - 1];
  if (rel >= last.tUs) return last.value;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (rel >= a.tUs && rel <= b.tUs) {
      const x = (rel - a.tUs) / Math.max(1, b.tUs - a.tUs);
      return a.value + (b.value - a.value) * ease(a.easing, x);
    }
  }
  return last.value;
}

const KF_TOLERANCE = 20_000;

export function keyframeAt(c: Clip, prop: AnimProp, rel: Us): Keyframe | undefined {
  return c.keyframes.find(k => k.property === prop && Math.abs(k.tUs - rel) <= KF_TOLERANCE);
}

/** Set a property at a time. If the property has keyframes, add/update one; otherwise set the base value. */
export function setProp(c: Clip, prop: AnimProp, rel: Us, value: number) {
  const hasKf = c.keyframes.some(k => k.property === prop);
  if (hasKf) {
    const k = keyframeAt(c, prop, rel);
    if (k) k.value = value;
    else c.keyframes.push({ id: uid(), property: prop, tUs: Math.round(rel), value, easing: 'linear' });
  } else if (prop === 'volumeDb') c.volumeDb = value;
  else (c.transform as any)[prop] = value;
}

export function toggleKeyframe(c: Clip, prop: AnimProp, rel: Us) {
  const k = keyframeAt(c, prop, rel);
  if (k) { c.keyframes = c.keyframes.filter(x => x !== k); return; }
  const value = valueAt(c, prop, rel);
  c.keyframes.push({ id: uid(), property: prop, tUs: Math.max(0, Math.min(c.durationUs, Math.round(rel))), value, easing: 'linear' });
}

function structuredCloneSafe<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

// ---------- snapping ----------

/** Snap t to the closest edge (clip edges, playhead, markers) within `tolUs`. */
export function snapTime(p: Project, t: Us, tolUs: Us, extra: Us[] = [], ignoreClipId?: string): { t: Us; snapped: boolean } {
  let best = t, bestD = tolUs + 1;
  const consider = (x: Us) => { const d = Math.abs(x - t); if (d < bestD) { bestD = d; best = x; } };
  consider(0);
  for (const tr of p.tracks) for (const c of tr.clips) { if (c.id === ignoreClipId) continue; consider(c.startUs); consider(clipEnd(c)); }
  for (const m of p.markers) consider(m.tUs);
  extra.forEach(consider);
  return bestD <= tolUs ? { t: best, snapped: true } : { t, snapped: false };
}
