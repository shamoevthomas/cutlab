// Integrated loudness (ITU-R BS.1770-4 / EBU R128), for "normalise loudness".
// Input must be 48 kHz (the app decodes all audio at 48 kHz).

function biquad(x: Float32Array, b: number[], a: number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

const SHELF_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
const SHELF_A = [1, -1.69065929318241, 0.73248077421585];
const HP_B = [1, -2, 1];
const HP_A = [1, -1.99004745483398, 0.99007225036621];

/** Integrated loudness in LUFS of one or more 48 kHz channels (-Infinity for silence). */
export function integratedLoudness(channels: Float32Array[], sampleRate = 48000): number {
  if (sampleRate !== 48000) throw new Error('loudness expects 48 kHz audio');
  const weighted = channels.map(c => biquad(biquad(c, SHELF_B, SHELF_A), HP_B, HP_A));
  const block = Math.round(0.4 * sampleRate), step = Math.round(0.1 * sampleRate);
  const len = weighted[0]?.length ?? 0;
  const powers: number[] = [];
  for (let s = 0; s + block <= len; s += step) {
    let z = 0;
    for (const ch of weighted) { let acc = 0; for (let i = s; i < s + block; i++) acc += ch[i] * ch[i]; z += acc / block; }
    powers.push(z);
  }
  if (!powers.length) return -Infinity;
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter(p => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter(p => lufs(p) > rel);
  return lufs(mean(gated.length ? gated : abs));
}

export const LOUDNESS_TARGETS: [number, string][] = [[-14, '−14 LUFS · YouTube, Instagram, TikTok'], [-16, '−16 LUFS · podcast'], [-23, '−23 LUFS · télé (EBU R128)']];
