import { it, expect } from 'vitest';
import { integratedLoudness } from '../src/model/loudness';

const sine = (amp: number, f = 997, s = 3, sr = 48000) => { const x = new Float32Array(s * sr); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / sr); return x; };

it('a 0 dBFS 997 Hz sine on one channel reads about -3 LUFS', () => {
  expect(integratedLoudness([sine(1)])).toBeCloseTo(-3.01, 0);
});
it('-20 dB quieter reads 20 LU lower, stereo adds 3 LU', () => {
  expect(integratedLoudness([sine(0.1)])).toBeCloseTo(-23.01, 0);
  expect(integratedLoudness([sine(0.1), sine(0.1)])).toBeCloseTo(-20.0, 0);
});
it('silence is -Infinity', () => {
  expect(integratedLoudness([new Float32Array(48000 * 2)])).toBe(-Infinity);
});
