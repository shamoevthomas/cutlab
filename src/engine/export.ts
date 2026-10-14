// Export: renders every frame with the same compositor as the preview, encodes with WebCodecs
// (hardware H.264/HEVC through VideoToolbox on the Mac) and muxes into MP4.
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Asset, Project, Us } from '../model/schema';
import { clipEnd, projectDuration, valueAt } from '../model/ops';
import { Compositor, renderText, TexSource } from './compositor';
import { evaluate, audioClips, Layer } from './scene';
import { decodeAudio, loadImage, loadVideo, seekVideo } from './media';
import { dbToGain } from './player';

export interface ExportSettings {
  height: 720 | 1080 | 1440 | 2160;
  fps: number;
  codec: 'h264' | 'hevc';
  quality: 'low' | 'recommended' | 'high' | 'custom';
  bitrateMbps?: number;
  rangeStartUs?: Us;
  rangeEndUs?: Us;
  includeAudio: boolean;
}

export interface ExportProgress { phase: 'audio' | 'video' | 'finalizing'; done: number; total: number }

const BPP = { low: 0.05, recommended: 0.1, high: 0.18 };

export function outputSize(p: Project, height: number): [number, number] {
  // the setting is the short side, like editors' "1080p" for both 16:9 and 9:16
  const short = Math.min(p.canvas.width, p.canvas.height);
  const s = height / short;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return [even(p.canvas.width * s), even(p.canvas.height * s)];
}

export function bitrateFor(w: number, h: number, fps: number, s: ExportSettings): number {
  if (s.quality === 'custom' && s.bitrateMbps) return s.bitrateMbps * 1e6;
  return Math.round(w * h * fps * BPP[s.quality === 'custom' ? 'recommended' : s.quality]);
}

async function pickVideoConfig(w: number, h: number, fps: number, bitrate: number, codec: ExportSettings['codec']) {
  const big = w * h > 1920 * 1088;
  const candidates = codec === 'hevc'
    ? [big ? 'hvc1.1.6.L153.B0' : 'hvc1.1.6.L123.B0', 'hev1.1.6.L153.B0']
    : [big ? 'avc1.640033' : 'avc1.640028', big ? 'avc1.4d0033' : 'avc1.4d0028', 'avc1.42003e'];
  for (const c of candidates) {
    for (const hw of ['prefer-hardware', 'no-preference'] as const) {
      const cfg: VideoEncoderConfig = { codec: c, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: 'quality', avc: c.startsWith('avc') ? { format: 'avc' } : undefined } as any;
      const r = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
      if (r?.supported) return { cfg: r.config!, mux: (codec === 'hevc' ? 'hevc' : 'avc') as 'hevc' | 'avc' };
    }
  }
  if (codec === 'hevc') throw new Error('HEVC non pris en charge sur cette machine : choisis H.264');
  throw new Error('Aucun encodeur vidéo compatible');
}

async function pickAudioConfig(): Promise<{ cfg: AudioEncoderConfig; mux: 'aac' | 'opus' } | null> {
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']] as const) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 };
    const r = await AudioEncoder.isConfigSupported(cfg).catch(() => null);
    if (r?.supported) return { cfg, mux };
  }
  return null;
}

/** Mix every audible clip into one stereo 48 kHz buffer. */
export async function mixAudio(p: Project, startUs: Us, endUs: Us): Promise<AudioBuffer | null> {
  const sr = 48000;
  const len = Math.max(1, Math.ceil(((endUs - startUs) / 1e6) * sr));
  const ctx = new OfflineAudioContext(2, len, sr);
  let any = false;
  for (const a of audioClips(p)) {
    if (a.muted) continue;
    const c = a.clip;
    if (clipEnd(c) <= startUs || c.startUs >= endUs) continue;
    const asset = p.assets.find(x => x.id === a.assetId)!;
    let buf = await decodeAudio(asset);
    if (!buf) continue;
    if (c.reverse) buf = reversed(ctx, buf);
    any = true;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = c.speed;
    const gain = ctx.createGain();
    src.connect(gain).connect(ctx.destination);
    const clipStartS = (c.startUs - startUs) / 1e6;
    // volume (with keyframes) and fades, sampled every 20 ms
    const step = 20_000;
    for (let t = Math.max(c.startUs, startUs); t <= Math.min(clipEnd(c), endUs); t += step) {
      const rel = t - c.startUs;
      let g = dbToGain(valueAt(c, 'volumeDb', rel));
      if (c.fadeInUs && rel < c.fadeInUs) g *= rel / c.fadeInUs;
      if (c.fadeOutUs && clipEnd(c) - t < c.fadeOutUs) g *= (clipEnd(c) - t) / c.fadeOutUs;
      gain.gain.setValueAtTime(g, Math.max(0, (t - startUs) / 1e6));
    }
    const srcOffset = c.reverse ? buf.duration - (c.inUs + c.durationUs * c.speed) / 1e6 : c.inUs / 1e6;
    const skip = Math.max(0, -clipStartS);              // clip starts before the range
    const when = Math.max(0, clipStartS);
    const dur = (Math.min(clipEnd(c), endUs) - Math.max(c.startUs, startUs)) / 1e6;
    src.start(when, Math.max(0, srcOffset + skip * c.speed), dur * c.speed);
  }
  if (!any) return null;
  return ctx.startRendering();
}

function reversed(ctx: BaseAudioContext, b: AudioBuffer) {
  const r = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const src = b.getChannelData(ch), dst = r.getChannelData(ch);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return r;
}

export async function exportProject(
  p: Project, s: ExportSettings,
  onProgress: (pr: ExportProgress) => void,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const start = s.rangeStartUs ?? 0;
  const end = s.rangeEndUs ?? projectDuration(p);
  if (end <= start) throw new Error('Rien à exporter : la timeline est vide');
  const [W, H] = outputSize(p, s.height);
  const bitrate = bitrateFor(W, H, s.fps, s);
  const video = await pickVideoConfig(W, H, s.fps, bitrate, s.codec);
  const audioCfg = s.includeAudio ? await pickAudioConfig() : null;

  onProgress({ phase: 'audio', done: 0, total: 1 });
  const mixed = audioCfg ? await mixAudio(p, start, end) : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: video.mux, width: W, height: H, frameRate: s.fps },
    audio: mixed && audioCfg ? { codec: audioCfg.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encError: Error | null = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encError = e as Error; } });
  venc.configure(video.cfg);

  if (mixed && audioCfg) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { encError = e as Error; } });
    aenc.configure(audioCfg.cfg);
    const CH = 4800; // 100 ms
    const L = mixed.getChannelData(0), R = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : L;
    for (let i = 0; i < mixed.length; i += CH) {
      const n = Math.min(CH, mixed.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }

  // ---------- video ----------
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas);
  comp.resize(W, H);
  // the compositor maps project-space layers to the output size: scale positions/sizes with the canvas
  const scaleProj: Project = { ...p, canvas: { ...p.canvas, width: W, height: H } };
  const videos = new Map<string, HTMLVideoElement>();
  const mattes = new Map<string, HTMLVideoElement>();
  const images = new Map<string, HTMLImageElement>();
  const assetOf = (id?: string) => p.assets.find(a => a.id === id) as Asset | undefined;

  const total = Math.max(1, Math.round(((end - start) / 1e6) * s.fps));
  const frameDur = 1e6 / s.fps;
  try {
    for (let f = 0; f < total; f++) {
      if (signal.aborted) throw new DOMException('Export annulé', 'AbortError');
      if (encError) throw encError;
      const t = start + f * frameDur;
      const layers = evaluate(p, t);
      // prepare sources
      for (const L of layers) {
        const a = assetOf(L.assetId);
        if (!a) continue;
        if (L.kind === 'video') {
          let v = videos.get(L.clip.id);
          if (!v) { v = await loadVideo(a.url); videos.set(L.clip.id, v); }
          await seekVideo(v, L.sourceUs / 1e6 + 0.0005);
          if (L.matte) {
            const ma = assetOf(L.matte.assetId);
            let mv = mattes.get(L.clip.id);
            if (!mv && ma) { mv = await loadVideo(ma.url); mattes.set(L.clip.id, mv); }
            if (mv) await seekVideo(mv, (L.sourceUs - L.matte.offsetUs) / 1e6 + 0.0005);
          }
        } else if ((L.kind === 'image' || L.kind === 'sticker') && !images.has(a.id)) {
          images.set(a.id, await loadImage(a.url));
        }
      }
      const source = (L: Layer): TexSource | null => {
        if (L.kind === 'text' && L.clip.text) {
          const content = L.textChars !== undefined ? L.clip.text.content.slice(0, L.textChars) : L.clip.text.content;
          if (!content) return null;
          const r = renderText(content, L.clip.text.style, scaleProj.canvas.height, scaleProj.canvas.width);
          return { el: r.canvas as TexImageSource, w: r.w, h: r.h, key: 'txt:' + r.key, dynamic: false, fit: 'natural' };
        }
        if (L.kind === 'video') {
          const v = videos.get(L.clip.id);
          return v ? { el: v, w: v.videoWidth, h: v.videoHeight, key: 'v:' + L.clip.id, dynamic: true, fit: 'contain' } : null;
        }
        const a = assetOf(L.assetId);
        const img = a && images.get(a.id);
        if (!img) return null;
        // stickers keep their pixel size relative to the project resolution
        const k = a!.kind === 'sticker' ? W / p.canvas.width : 1;
        return { el: img, w: img.naturalWidth * k, h: img.naturalHeight * k, key: 'img:' + a!.id, dynamic: false, fit: a!.kind === 'sticker' ? 'natural' : 'contain' };
      };
      const maskSource = (L: Layer): TexSource | null => {
        const mv = mattes.get(L.clip.id);
        return mv ? { el: mv, w: mv.videoWidth, h: mv.videoHeight, key: 'm:' + L.clip.id, dynamic: true, fit: 'contain' } : null;
      };
      comp.render(p.canvas.background, layers, source, maskSource);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(f * frameDur), duration: Math.round(frameDur) });
      venc.encode(frame, { keyFrame: f % (s.fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 1));
      if (f % 5 === 0) onProgress({ phase: 'video', done: f, total });
    }
    onProgress({ phase: 'finalizing', done: total, total });
    await venc.flush();
    if (encError) throw encError;
    muxer.finalize();
    return new Uint8Array(target.buffer);
  } finally {
    try { venc.close(); } catch { /* closed */ }
    for (const v of [...videos.values(), ...mattes.values()]) { v.removeAttribute('src'); v.load(); }
    comp.dispose();
  }
}
