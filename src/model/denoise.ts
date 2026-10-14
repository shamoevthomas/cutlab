// Spectral-gating noise reduction: learns the noise floor from the quietest moments,
// then attenuates each frequency bin that does not rise above it. Steady noise (hiss, hum,
// fan, room tone) goes; the voice stays.

function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export interface DenoiseOptions { strength: number; /* 0..1 */ }

export async function denoise(x: Float32Array, o: DenoiseOptions, onProgress?: (r: number) => void): Promise<Float32Array> {
  const N = 2048, H = N / 4;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const frames = Math.max(1, Math.ceil((x.length - N) / H) + 1);
  const bins = N / 2 + 1;
  // pass 1: magnitudes per frame (kept compact as Float32)
  const mags = new Float32Array(frames * bins);
  const energy = new Float64Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const s = f * H;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    let e = 0;
    for (let k = 0; k < bins; k++) { const m = Math.hypot(re[k], im[k]); mags[f * bins + k] = m; e += m * m; }
    energy[f] = e;
    if (f % 2000 === 0) { onProgress?.((f / frames) * 0.4); await new Promise(r => setTimeout(r)); }
  }
  // noise profile: mean spectrum of the 15 % quietest frames (that still contain signal)
  const order = Array.from(energy.keys()).filter(i => energy[i] > 0).sort((a, b) => energy[a] - energy[b]);
  const quiet = order.slice(0, Math.max(1, Math.floor(order.length * 0.15)));
  const noise = new Float64Array(bins);
  for (const f of quiet) for (let k = 0; k < bins; k++) noise[k] += mags[f * bins + k];
  for (let k = 0; k < bins; k++) noise[k] /= quiet.length;
  // pass 2: gains with time smoothing, overlap-add resynthesis
  const over = 1 + o.strength * 2.5;        // how far above the noise a bin must be to pass
  const floor = 1 - 0.9 * o.strength;       // never fully mute (keeps it natural)
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  const prevGain = new Float64Array(bins).fill(1);
  for (let f = 0; f < frames; f++) {
    const s = f * H;
    for (let i = 0; i < N; i++) { re[i] = (x[s + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const m = mags[f * bins + k];
      let g = m > 0 ? Math.max(0, 1 - (over * noise[k]) / m) : 0;
      g = Math.max(floor > 0 ? floor * 0.1 : 0, g);
      g = Math.max(g, 1 - o.strength);       // strength 0 = bypass
      g = 0.6 * g + 0.4 * prevGain[k];       // smooth over time against "musical noise"
      prevGain[k] = g;
      re[k] *= g; im[k] *= g;
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < N && s + i < x.length; i++) { out[s + i] += re[i] * win[i]; norm[s + i] += win[i] * win[i]; }
    if (f % 2000 === 0) { onProgress?.(0.4 + (f / frames) * 0.6); await new Promise(r => setTimeout(r)); }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  onProgress?.(1);
  return out;
}

/** 16-bit PCM WAV encoder. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const n = channels[0].length, ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(buf);
}

/** Downward expander: pulls the gaps between phrases down (after compression lifted them). */
export function gate(chs: Float32Array[], rate: number, depthDb = 12): Float32Array[] {
  const win = Math.round(rate * 0.01);
  const n = chs[0].length, frames = Math.ceil(n / win);
  const lv = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (const ch of chs) for (let i = f * win; i < Math.min(n, (f + 1) * win); i++) { s += ch[i] * ch[i]; c++; }
    lv[f] = 10 * Math.log10(s / Math.max(1, c) + 1e-12);
  }
  const sorted = Array.from(lv).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)], speech = sorted[Math.floor(sorted.length * 0.9)];
  const thr = Math.min(floor + 8, (floor + speech) / 2);
  const low = Math.pow(10, -depthDb / 20);
  // per-frame target gain, then attack 5 ms / release 120 ms smoothing at sample rate
  const out = chs.map(c => new Float32Array(c.length));
  let g = 1;
  const att = 1 - Math.exp(-1 / (rate * 0.005)), rel = 1 - Math.exp(-1 / (rate * 0.12));
  for (let i = 0; i < n; i++) {
    const target = lv[Math.floor(i / win)] > thr ? 1 : low;
    g += (target - g) * (target > g ? att : rel);
    for (let c = 0; c < chs.length; c++) out[c][i] = chs[c][i] * g;
  }
  return out;
}
