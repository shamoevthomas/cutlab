// Speech recognition in a worker: Whisper (ONNX) through transformers.js, WebGPU when available, WASM otherwise.
// Models are downloaded once from Hugging Face and cached by the browser engine.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
(env.backends.onnx as any).wasm.wasmPaths = import.meta.env.DEV ? '/ort/' : new URL('../ort/', import.meta.url).href;
// ORT's pthread workers would re-run this bundled worker instead of its own entry point and hang:
// keep the CPU path single-threaded (the Mac uses WebGPU anyway).
const threads = 1;
(env.backends.onnx as any).wasm.numThreads = threads;
console.log('[asr] wasm from', (env.backends.onnx as any).wasm.wasmPaths, 'threads', threads);

type Req = { id: number; samples: Float32Array; model: string; language: string | null; device?: string };

let current: { model: string; device: string; asr: any } | null = null;

async function pickDevice(forced?: string): Promise<'webgpu' | 'wasm'> {
  if (forced === 'wasm' || forced === 'webgpu') return forced;
  const gpu = (navigator as any).gpu;
  if (!gpu) return 'wasm';
  const adapter = await gpu.requestAdapter().catch(() => null);
  // software adapters (no real GPU) are slower than WASM and can stall
  if (!adapter || adapter.isFallbackAdapter) return 'wasm';
  return 'webgpu';
}

async function load(model: string, onProgress: (p: any) => void, forced?: string, status?: (t: string) => void) {
  const device = await pickDevice(forced);
  if (current && current.model === model && current.device === device) return current.asr;
  const asr = await pipeline('automatic-speech-recognition', model, {
    device,
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'fp32', decoder_model_merged: 'q8' },
    progress_callback: (p: any) => { onProgress(p); if (p.status === 'ready') status?.('Initialisation du modèle…'); },
  } as any);
  current = { model, device, asr };
  return asr;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, samples, model, language, device } = e.data;
  const post = (m: any) => (self as any).postMessage({ id, ...m });
  try {
    console.log('[asr] request', model, 'device', device ?? 'auto', 'samples', samples.length);
    post({ type: 'status', text: 'Chargement du modèle…' });
    const t0 = performance.now();
    const asr = await load(model, (p: any) => {
      if (p.status === 'progress' && p.total) post({ type: 'download', file: p.file, loaded: p.loaded, total: p.total });
    }, device, (text) => post({ type: 'status', text }));
    console.log('[asr] model ready on', current!.device, Math.round(performance.now() - t0), 'ms, crossOriginIsolated =', (self as any).crossOriginIsolated);
    post({ type: 'status', text: `Transcription (${current!.device === 'webgpu' ? 'GPU' : 'CPU'})…` });
    const out = await asr(samples, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language ? { language, task: 'transcribe' } : {}),
    });
    console.log('[asr] transcribed', samples.length / 16000, 's in', Math.round(performance.now() - t0), 'ms');
    const words = (out.chunks ?? []).map((c: any) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3, text: String(c.text).trim() }));
    post({ type: 'done', words, text: out.text, device: current!.device });
  } catch (err: any) {
    post({ type: 'error', message: err?.message ?? String(err) });
  }
};
