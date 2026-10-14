// On-device vision with MediaPipe (bundled wasm + models, works offline):
// face detection for auto-reframe, person segmentation for background removal.
import { FilesetResolver, FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { loadVideo, seekVideo } from './media';

const base = () => new URL(import.meta.env.DEV ? '/' : './', location.href).href;
let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
const files = async () => (fileset ??= await FilesetResolver.forVisionTasks(base() + 'mediapipe'));

let faceDet: FaceDetector | null = null;
async function faceDetector() {
  if (faceDet) return faceDet;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      faceDet = await FaceDetector.createFromOptions(await files(), { baseOptions: { modelAssetPath: base() + 'models/face_detector.tflite', delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.4 });
      return faceDet;
    } catch (e) { if (delegate === 'CPU') throw e; }
  }
  throw new Error('détecteur indisponible');
}

let segmenter: ImageSegmenter | null = null;
async function personSegmenter() {
  if (segmenter) return segmenter;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      segmenter = await ImageSegmenter.createFromOptions(await files(), { baseOptions: { modelAssetPath: base() + 'models/selfie_segmenter.tflite', delegate }, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false });
      return segmenter;
    } catch (e) { if (delegate === 'CPU') throw e; }
  }
  throw new Error('segmentation indisponible');
}

export interface FaceSample { t: number; cx: number; cy: number; size: number; found: boolean } // source seconds, normalised 0..1

/** Sample the main face position every `stepS` over [startS, endS] of a video. */
export async function trackFaces(url: string, startS: number, endS: number, stepS: number, onProgress?: (r: number) => void): Promise<FaceSample[]> {
  const det = await faceDetector();
  const v = await loadVideo(url);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
  canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const out: FaceSample[] = [];
  const n = Math.max(1, Math.ceil((endS - startS) / stepS));
  for (let i = 0; i <= n; i++) {
    const t = Math.min(endS - 0.01, startS + i * stepS);
    await seekVideo(v, t);
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    const r = det.detect(canvas);
    let best: FaceSample = { t, cx: 0.5, cy: 0.5, size: 0, found: false };
    for (const d of r.detections) {
      const b = d.boundingBox; if (!b) continue;
      const size = (b.width * b.height) / (canvas.width * canvas.height);
      if (size > best.size) best = { t, cx: (b.originX + b.width / 2) / canvas.width, cy: (b.originY + b.height / 2) / canvas.height, size, found: true };
    }
    out.push(best);
    onProgress?.(i / n);
  }
  v.removeAttribute('src'); v.load();
  return out;
}

/** Fill gaps (no face) with neighbours, then smooth so the virtual camera does not shake. */
export function smoothPath(samples: FaceSample[], smoothing: number): number[] {
  const xs = samples.map(s => (s.found ? s.cx : NaN));
  // fill gaps
  let last = xs.find(x => !Number.isNaN(x)) ?? 0.5;
  for (let i = 0; i < xs.length; i++) { if (Number.isNaN(xs[i])) xs[i] = last; else last = xs[i]; }
  // median of 5 removes single-frame false detections
  const med = xs.map((_, i) => { const w = xs.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b); return w[Math.floor(w.length / 2)]; });
  // forward + backward exponential smoothing (zero lag)
  const a = Math.min(0.95, Math.max(0.05, 1 - smoothing));
  const f = [...med]; for (let i = 1; i < f.length; i++) f[i] = f[i - 1] + a * (f[i] - f[i - 1]);
  const b = [...f]; for (let i = b.length - 2; i >= 0; i--) b[i] = b[i + 1] + a * (b[i] - b[i + 1]);
  return b;
}

// ---------- background removal: renders a grey-scale matte video (white = person) ----------

export async function renderMatte(url: string, startS: number, endS: number, fps: number, onProgress: (r: number) => void, signal?: AbortSignal): Promise<{ data: Uint8Array; width: number; height: number }> {
  const seg = await personSegmenter();
  const v = await loadVideo(url);
  const W = Math.min(720, v.videoWidth) & ~1, H = Math.round((W * v.videoHeight) / v.videoWidth) & ~1;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const og = out.getContext('2d')!;
  const img = og.createImageData(W, H);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let err: Error | null = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e as Error; } });
  const cfg = { codec: 'avc1.640028', width: W, height: H, bitrate: 2_000_000, framerate: fps, avc: { format: 'avc' } } as any;
  enc.configure((await VideoEncoder.isConfigSupported(cfg)).supported ? cfg : { ...cfg, codec: 'avc1.42003e' });
  const n = Math.max(1, Math.round((endS - startS) * fps));
  let prev: Float32Array | null = null;
  try {
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('annulé', 'AbortError');
      if (err) throw err;
      const t = startS + i / fps;
      await seekVideo(v, t + 0.0005);
      sg.drawImage(v, 0, 0, W, H);
      const res = seg.segmentForVideo(src, Math.round(t * 1000) + 1);
      const mask = res.confidenceMasks?.[0];
      const conf = mask ? mask.getAsFloat32Array() : new Float32Array(W * H);
      // the model's mask may be smaller than the frame: sample it
      const mw = mask?.width ?? W, mh = mask?.height ?? H;
      const cur = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cur[y * W + x] = conf[Math.floor((y * mh) / H) * mw + Math.floor((x * mw) / W)];
      mask?.close();
      // light temporal smoothing against flicker
      if (prev) for (let k = 0; k < cur.length; k++) cur[k] = cur[k] * 0.7 + prev[k] * 0.3;
      prev = cur;
      for (let k = 0; k < cur.length; k++) {
        const a = Math.max(0, Math.min(255, Math.round(((cur[k] - 0.25) / 0.5) * 255)));
        img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = a; img.data[k * 4 + 3] = 255;
      }
      og.putImageData(img, 0, 0);
      const frame = new VideoFrame(out, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();
      while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 1));
      if (i % 3 === 0) onProgress(i / n);
    }
    await enc.flush();
    muxer.finalize();
    return { data: new Uint8Array(target.buffer), width: W, height: H };
  } finally {
    try { enc.close(); } catch { /* closed */ }
    v.removeAttribute('src'); v.load();
  }
}
