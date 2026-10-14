import { it, expect, describe } from 'vitest';
import { detectSilences, keepRanges, rmsDb, autoThreshold } from '../src/model/silence';
import { wordsToCues, fillerRanges, REEL_CUES } from '../src/model/captions';

const SR = 16000;
function signal(parts: [number, number][]): Float32Array { // [seconds, amplitude]
  const total = parts.reduce((s, p) => s + p[0], 0);
  const out = new Float32Array(Math.round(total * SR));
  let i = 0;
  for (const [d, amp] of parts) for (let k = 0; k < Math.round(d * SR); k++, i++) out[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR) + (Math.random() - 0.5) * 0.0005;
  return out;
}

describe('silence', () => {
  it('finds the gap between two speech parts and pads it', () => {
    const s = signal([[1, 0.3], [1.5, 0], [1, 0.3]]);
    const sil = detectSilences(s, SR, { thresholdDb: -40, minSilenceS: 0.4, padS: 0.1 });
    expect(sil).toHaveLength(1);
    expect(sil[0][0]).toBeCloseTo(1.1, 1);
    expect(sil[0][1]).toBeCloseTo(2.4, 1);
  });
  it('ignores short pauses', () => {
    const s = signal([[1, 0.3], [0.2, 0], [1, 0.3]]);
    expect(detectSilences(s, SR, { thresholdDb: -40, minSilenceS: 0.4 })).toHaveLength(0);
  });
  it('leading silence is removed without padding', () => {
    const s = signal([[0.8, 0], [1, 0.3]]);
    const sil = detectSilences(s, SR, { thresholdDb: -40, minSilenceS: 0.4, padS: 0.1 });
    expect(sil[0][0]).toBe(0);
  });
  it('keepRanges is the complement', () => {
    expect(keepRanges(5, [[1, 2], [3, 3.5]])).toEqual([[0, 1], [2, 3], [3.5, 5]]);
  });
  it('auto threshold sits between floor and speech', () => {
    const lv = rmsDb(signal([[1, 0.3], [1, 0.001]]), SR);
    const t = autoThreshold(lv);
    expect(t).toBeGreaterThan(-60); expect(t).toBeLessThan(-20);
  });
});

describe('captions', () => {
  const words = 'Salut la team aujourd’hui on parle du closing, et surtout des objections.'.split(' ').map((t, i) => ({ start: i * 0.4, end: i * 0.4 + 0.35, text: t }));
  it('groups words into short reel cues and breaks on punctuation', () => {
    const cues = wordsToCues(words, REEL_CUES);
    expect(cues.every(c => c.text.length <= 22 || c.words.length === 1)).toBe(true);
    expect(cues.some(c => c.text.endsWith('closing,'))).toBe(true);
    expect(cues[0].start).toBe(0);
  });
  it('glues French elisions split by the tokenizer', () => {
    const w = ['j', "'adore", 'ça'].map((t, i) => ({ start: i * 0.2, end: i * 0.2 + 0.15, text: t }));
    expect(wordsToCues(w, REEL_CUES)[0].text).toBe("j'adore ça");
  });
  it('detects fillers and repeats', () => {
    const w = [{ start: 0, end: 0.3, text: 'Euh,' }, { start: 0.4, end: 0.6, text: 'je' }, { start: 0.7, end: 0.9, text: 'je' }, { start: 1, end: 1.3, text: 'pense' }];
    const f = fillerRanges(w);
    expect(f.map(x => x.kind)).toEqual(['filler', 'repeat']);
  });
});
