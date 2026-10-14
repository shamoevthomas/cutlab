// Media probing, thumbnails, decoded audio and waveforms, done in the renderer.
import type { Asset, AssetKind } from '../model/schema';
import { uid } from '../model/schema';
import type { PickedFile } from '../bridge/types';

export function kindFromFile(f: { name: string; mime: string }): AssetKind | null {
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  if (f.mime.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
  if (f.mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (f.mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return 'image';
  return null;
}

const once = (el: EventTarget, ev: string, timeoutMs = 15000) => new Promise<void>((res, rej) => {
  const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), timeoutMs);
  el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
  el.addEventListener('error', () => { clearTimeout(t); rej(new Error('média illisible')); }, { once: true });
});

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous'; v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url;
  await once(v, 'loadeddata');
  return v;
}

export async function seekVideo(v: HTMLVideoElement, sec: number) {
  const target = Math.max(0, Math.min(sec, (v.duration || 0) - 0.001));
  if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2) return;
  const p = once(v, 'seeked');
  v.currentTime = target;
  await p;
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous'; img.src = url;
  await img.decode();
  return img;
}

function snapshot(src: CanvasImageSource, w: number, h: number, maxW = 240): string {
  const scale = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

export async function probe(f: PickedFile): Promise<Asset> {
  const kind = kindFromFile(f);
  if (!kind) throw new Error(`format non pris en charge : ${f.name}`);
  const base: Asset = { id: uid(), kind, name: f.name, path: f.path, url: f.url, hasAudio: kind !== 'image' };
  if (kind === 'video') {
    const v = await loadVideo(f.url);
    base.width = v.videoWidth; base.height = v.videoHeight;
    base.durationUs = Math.round(v.duration * 1e6);
    await seekVideo(v, Math.min(1, v.duration / 3));
    base.thumb = snapshot(v, v.videoWidth, v.videoHeight);
    v.removeAttribute('src'); v.load();
  } else if (kind === 'image') {
    const img = await loadImage(f.url);
    base.width = img.naturalWidth; base.height = img.naturalHeight;
    base.thumb = snapshot(img, img.naturalWidth, img.naturalHeight);
  } else {
    const a = document.createElement('audio');
    a.preload = 'metadata'; a.src = f.url;
    await once(a, 'loadedmetadata');
    base.durationUs = Math.round(a.duration * 1e6);
  }
  return base;
}

// ---------- thumbnail strips (timeline) ----------

const strips = new Map<string, string[]>();
const stripJobs = new Map<string, Promise<string[]>>();
export const STRIP_FRAMES = 12;

export function getStrip(asset: Asset): string[] | undefined { return strips.get(asset.id); }

export function buildStrip(asset: Asset, onDone: () => void): void {
  if (asset.kind !== 'video' || strips.has(asset.id) || stripJobs.has(asset.id)) return;
  const job = (async () => {
    const v = await loadVideo(asset.url);
    const out: string[] = [];
    for (let i = 0; i < STRIP_FRAMES; i++) {
      await seekVideo(v, (v.duration * (i + 0.5)) / STRIP_FRAMES);
      out.push(snapshot(v, v.videoWidth, v.videoHeight, 120));
    }
    v.removeAttribute('src'); v.load();
    return out;
  })();
  stripJobs.set(asset.id, job);
  job.then(s => { strips.set(asset.id, s); onDone(); }).catch(() => {}).finally(() => stripJobs.delete(asset.id));
}

// ---------- decoded audio + waveform peaks ----------

const audioBuffers = new Map<string, Promise<AudioBuffer | null>>();
let decodeCtx: OfflineAudioContext | null = null;

export function decodeAudio(asset: Asset): Promise<AudioBuffer | null> {
  if (!asset.hasAudio) return Promise.resolve(null);
  let p = audioBuffers.get(asset.id);
  if (!p) {
    p = (async () => {
      try {
        const buf = await (await fetch(asset.url)).arrayBuffer();
        decodeCtx ??= new OfflineAudioContext(2, 1, 48000);
        return await decodeCtx.decodeAudioData(buf);
      } catch { return null; }   // a video with no audio track lands here
    })();
    audioBuffers.set(asset.id, p);
  }
  return p;
}

const peaks = new Map<string, Float32Array>();
export const PEAKS_PER_SEC = 50;

export function getPeaks(assetId: string) { return peaks.get(assetId); }

export function buildPeaks(asset: Asset, onDone: () => void) {
  if (peaks.has(asset.id) || !asset.hasAudio) return;
  peaks.set(asset.id, new Float32Array(0)); // mark in progress
  decodeAudio(asset).then(b => {
    if (!b) { peaks.delete(asset.id); return; }
    const n = Math.ceil(b.duration * PEAKS_PER_SEC);
    const out = new Float32Array(n);
    const ch = b.getChannelData(0);
    const step = b.sampleRate / PEAKS_PER_SEC;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const s0 = Math.floor(i * step), s1 = Math.min(ch.length, Math.floor((i + 1) * step));
      for (let s = s0; s < s1; s += 4) { const v = Math.abs(ch[s]); if (v > m) m = v; }
      out[i] = m;
    }
    peaks.set(asset.id, out);
    onDone();
  });
}
