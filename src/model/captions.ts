// Turning recognised words into caption cues, and finding filler words.
export interface Word { start: number; end: number; text: string } // seconds

export interface CueOptions { maxChars: number; maxWords: number; maxGapS: number; maxDurS: number; upper: boolean }
export const REEL_CUES: CueOptions = { maxChars: 22, maxWords: 4, maxGapS: 0.6, maxDurS: 2.5, upper: false };
export const LONG_CUES: CueOptions = { maxChars: 42, maxWords: 10, maxGapS: 0.8, maxDurS: 4.5, upper: false };

const clean = (t: string) => t.replace(/\s+/g, ' ').trim();

export function wordsToCues(words: Word[], o: CueOptions): { start: number; end: number; text: string; words: Word[] }[] {
  const cues: { start: number; end: number; text: string; words: Word[] }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    let text = clean(cur.map(w => w.text).join(' ')).replace(/\s+([,.!?;:»])/g, '$1').replace(/([«])\s+/g, '$1').replace(/\s+(['’])/g, '$1').replace(/(['’])\s+/g, '$1');
    if (o.upper) text = text.toUpperCase();
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text, words: cur });
    cur = [];
  };
  for (const w0 of words) {
    const w = { ...w0, text: clean(w0.text) };
    if (!w.text) continue;
    if (cur.length) {
      const last = cur[cur.length - 1];
      const len = clean(cur.map(x => x.text).join(' ')).length + 1 + w.text.length;
      const breakPunct = /[.!?…]$/.test(last.text) || (/[,;:]$/.test(last.text) && cur.length >= 2);
      if (len > o.maxChars || cur.length >= o.maxWords || w.start - last.end > o.maxGapS || w.end - cur[0].start > o.maxDurS || breakPunct) flush();
    }
    cur.push(w);
  }
  flush();
  // avoid flicker: extend each cue to the next one when the gap is tiny
  for (let i = 0; i < cues.length - 1; i++) if (cues[i + 1].start - cues[i].end < 0.25) cues[i].end = cues[i + 1].start;
  return cues;
}

const FILLERS = new Set(['euh', 'heu', 'euuh', 'euhh', 'hum', 'hmm', 'hm', 'bah', 'ben', 'mmh', 'um', 'uh', 'erm', 'ah', 'eh']);
export const isFiller = (t: string) => FILLERS.has(t.toLowerCase().replace(/[^a-zàâäéèêëïîôöùûüç]/g, ''));

/** Words that are fillers, and immediate repeats of the same word ("je je"). */
export function fillerRanges(words: Word[]): { start: number; end: number; text: string; kind: 'filler' | 'repeat' }[] {
  const out: { start: number; end: number; text: string; kind: 'filler' | 'repeat' }[] = [];
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isFiller(w.text)) { out.push({ start: w.start, end: w.end, text: w.text, kind: 'filler' }); continue; }
    const next = words[i + 1];
    if (next && norm(w.text) && norm(w.text) === norm(next.text) && next.start - w.end < 0.6) out.push({ start: w.start, end: next.start, text: w.text, kind: 'repeat' });
  }
  return out;
}
