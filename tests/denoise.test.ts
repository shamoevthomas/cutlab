import { it, expect } from 'vitest';
import { denoise, encodeWav } from '../src/model/denoise';

const SR = 48000;
function noisySpeechLike(): { clean: Float32Array; noisy: Float32Array } {
  const n = SR * 4;
  const clean = new Float32Array(n), noisy = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const on = (t > 0.5 && t < 1.5) || (t > 2.2 && t < 3.4);     // "words" with gaps
    clean[i] = on ? 0.3 * Math.sin(2 * Math.PI * 300 * t) + 0.15 * Math.sin(2 * Math.PI * 900 * t) : 0;
    noisy[i] = clean[i] + 0.04 * rnd();
  }
  return { clean, noisy };
}
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };

it('removes most of the steady noise in the gaps and keeps the signal', async () => {
  const { clean, noisy } = noisySpeechLike();
  const out = await denoise(noisy, { strength: 0.8 });
  const gapBefore = rms(noisy, 1.7 * SR, 2.1 * SR), gapAfter = rms(out, 1.7 * SR, 2.1 * SR);
  expect(gapAfter).toBeLessThan(gapBefore * 0.35);                 // > 9 dB less noise
  const sigBefore = rms(clean, 0.7 * SR, 1.3 * SR), sigAfter = rms(out, 0.7 * SR, 1.3 * SR);
  expect(sigAfter / sigBefore).toBeGreaterThan(0.85);              // voice level kept
});

it('strength 0 is a bypass', async () => {
  const { noisy } = noisySpeechLike();
  const out = await denoise(noisy, { strength: 0 });
  let d = 0; for (let i = 4096; i < noisy.length - 4096; i++) d = Math.max(d, Math.abs(out[i] - noisy[i]));
  expect(d).toBeLessThan(1e-3);
});

it('writes a valid WAV header', () => {
  const w = encodeWav([new Float32Array(10), new Float32Array(10)], 48000);
  expect(new TextDecoder().decode(w.slice(0, 4))).toBe('RIFF');
  expect(w.length).toBe(44 + 40);
});

it('gate pulls gaps down and leaves phrases', async () => {
  const { gate } = await import('../src/model/denoise');
  const { noisy } = noisySpeechLike();
  const [out] = gate([noisy], SR, 12);
  expect(rms(out, 1.7 * SR, 2.1 * SR)).toBeLessThan(rms(noisy, 1.7 * SR, 2.1 * SR) * 0.4);
  expect(rms(out, 0.7 * SR, 1.3 * SR)).toBeGreaterThan(rms(noisy, 0.7 * SR, 1.3 * SR) * 0.95);
});
