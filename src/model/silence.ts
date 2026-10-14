// Silence detection on raw PCM: the "remove pauses" half of auto-cut.
export interface SilenceOptions {
  thresholdDb: number;   // below this RMS level (dBFS) a window is silent; 'auto' handled by caller
  minSilenceS: number;   // shorter pauses are kept
  padS: number;          // speech kept around each cut so words are not clipped
  windowS: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { thresholdDb: -38, minSilenceS: 0.5, padS: 0.12, windowS: 0.02 };

/** RMS level per window, in dBFS. */
export function rmsDb(samples: Float32Array, sampleRate: number, windowS = 0.02): Float32Array {
  const win = Math.max(1, Math.round(sampleRate * windowS));
  const n = Math.ceil(samples.length / win);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * win, b = Math.min(samples.length, a + win);
    for (let j = a; j < b; j++) s += samples[j] * samples[j];
    const rms = Math.sqrt(s / Math.max(1, b - a));
    out[i] = rms > 0 ? 20 * Math.log10(rms) : -120;
  }
  return out;
}

/** Threshold that adapts to the recording: a margin above the noise floor, capped below speech. */
export function autoThreshold(levels: Float32Array): number {
  const sorted = Array.from(levels).filter(v => v > -119).sort((a, b) => a - b);
  if (!sorted.length) return -50;
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const speech = sorted[Math.floor(sorted.length * 0.9)];
  return Math.max(floor + 10, Math.min(speech - 18, -30));
}

/** Silent ranges [startS, endS] after applying min length and padding. */
export function detectSilences(samples: Float32Array, sampleRate: number, o: Partial<SilenceOptions> = {}): [number, number][] {
  const opt = { ...DEFAULT_SILENCE, ...o };
  const lv = rmsDb(samples, sampleRate, opt.windowS);
  const total = samples.length / sampleRate;
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= lv.length; i++) {
    const silent = i < lv.length && lv[i] < opt.thresholdDb;
    if (silent && start < 0) start = i;
    if (!silent && start >= 0) {
      let a = start * opt.windowS, b = Math.min(total, i * opt.windowS);
      if (b - a >= opt.minSilenceS) {
        // keep a little air, except at the very start/end of the clip
        if (a > 0) a += opt.padS;
        if (b < total) b -= opt.padS;
        if (b - a > 0.05) out.push([a, b]);
      }
      start = -1;
    }
  }
  return out;
}

/** Complement of `remove` inside [0, total]. */
export function keepRanges(total: number, remove: [number, number][]): [number, number][] {
  const r = [...remove].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of r) {
    if (a > cur) out.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < total) out.push([cur, total]);
  return out.filter(([a, b]) => b - a > 0.04);
}
