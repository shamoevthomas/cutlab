// Client side of speech recognition + audio helpers for auto-cut.
import type { Project, Asset } from '../model/schema';
import type { Word } from '../model/captions';
import { projectDuration } from '../model/ops';
import { mixAudio } from './export';
import { decodeAudio } from './media';

export const ASR_MODELS = [
  { id: 'onnx-community/whisper-base_timestamped', label: 'Rapide (base, ~200 Mo)' },
  { id: 'onnx-community/whisper-small_timestamped', label: 'Précis (small, ~600 Mo)' },
  { id: 'onnx-community/whisper-large-v3-turbo_timestamped', label: 'Très précis (large v3 turbo, ~1,6 Go, GPU conseillé)' },
];

export const LANGUAGES: [string | null, string][] = [['french', 'Français'], ['english', 'Anglais'], ['spanish', 'Espagnol'], ['german', 'Allemand'], ['italian', 'Italien'], ['portuguese', 'Portugais'], ['arabic', 'Arabe'], [null, 'Détection auto']];

export const LANG_CODES: Record<string, string> = { french: 'fr', english: 'en', spanish: 'es', german: 'de', italian: 'it', portuguese: 'pt', arabic: 'ar' };
export const TRANSLATE_TO: [string, string][] = [['en', 'Anglais'], ['fr', 'Français'], ['es', 'Espagnol'], ['de', 'Allemand'], ['it', 'Italien'], ['ar', 'Arabe']];

export interface AsrProgress { phase: 'audio' | 'download' | 'transcribe'; text: string; ratio?: number }

let worker: Worker | null = null;
let seq = 0;

export async function resampleMono(buf: AudioBuffer, startS = 0, endS = buf.duration, rate = 16000): Promise<Float32Array> {
  const len = Math.max(1, Math.ceil((endS - startS) * rate));
  const ctx = new OfflineAudioContext(1, len, rate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0, startS, endS - startS);
  return (await ctx.startRendering()).getChannelData(0);
}

/** Mono 16 kHz audio of the whole timeline as heard (cuts, volumes, mutes applied). */
export async function timelineAudio16k(p: Project): Promise<Float32Array | null> {
  const mixed = await mixAudio(p, 0, projectDuration(p));
  return mixed ? resampleMono(mixed) : null;
}

export async function transcribe(samples: Float32Array, model: string, language: string | null, onProgress: (p: AsrProgress) => void): Promise<Word[]> {
  worker ??= new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const files = new Map<string, [number, number]>();
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'download') {
        files.set(m.file, [m.loaded, m.total]);
        let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
        onProgress({ phase: 'download', text: `Téléchargement du modèle (une seule fois) : ${Math.round(l / 1e6)} / ${Math.round(t / 1e6)} Mo`, ratio: t ? l / t : 0 });
      } else if (m.type === 'status') onProgress({ phase: 'transcribe', text: m.text });
      else if (m.type === 'done') { worker!.removeEventListener('message', onMsg); resolve(m.words); }
      else if (m.type === 'error') { worker!.removeEventListener('message', onMsg); reject(new Error(m.message)); }
    };
    worker!.addEventListener('message', onMsg);
    const copy = samples.slice();
    let device: string | undefined;
    try { device = localStorage.getItem('cutlab.asrDevice') ?? undefined; } catch { /* ignore */ }
    worker!.postMessage({ id, samples: copy, model, language, device }, [copy.buffer]);
  });
}

/** Raw samples of one asset's audio (first channel) for silence detection. */
export async function assetSamples(a: Asset): Promise<{ data: Float32Array; rate: number } | null> {
  const b = await decodeAudio(a);
  if (!b) return null;
  if (b.numberOfChannels === 1) return { data: b.getChannelData(0), rate: b.sampleRate };
  const L = b.getChannelData(0), R = b.getChannelData(1), out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = (L[i] + R[i]) / 2;
  return { data: out, rate: b.sampleRate };
}

/** Local translation (opus-mt via transformers.js, same worker). */
export function translateTexts(texts: string[], from: string, to: string, onProgress: (p: AsrProgress) => void): Promise<string[]> {
  worker ??= new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  const files = new Map<string, [number, number]>();
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'download') {
        files.set(m.file, [m.loaded, m.total]);
        let l = 0, t = 0; for (const [a, b] of files.values()) { l += a; t += b; }
        onProgress({ phase: 'download', text: `Téléchargement du traducteur : ${Math.round(l / 1e6)} / ${Math.round(t / 1e6)} Mo`, ratio: t ? l / t : 0 });
      } else if (m.type === 'status') onProgress({ phase: 'transcribe', text: m.text });
      else if (m.type === 'done') { worker!.removeEventListener('message', onMsg); resolve(m.texts); }
      else if (m.type === 'error') { worker!.removeEventListener('message', onMsg); reject(new Error(m.message)); }
    };
    worker!.addEventListener('message', onMsg);
    worker!.postMessage({ id, kind: 'translate', texts, from, to });
  });
}
