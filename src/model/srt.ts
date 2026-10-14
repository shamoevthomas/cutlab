// SRT / VTT / timed TXT parsing and SRT writing.
export interface Cue { startUs: number; endUs: number; text: string }

const TS = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{1,3})/;
const toUs = (m: RegExpExecArray) => ((+(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4].padEnd(3, '0')) * 1000;

export function parseSubtitles(src: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = src.replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n/, '').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n').filter(l => l.trim() !== '');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const ma = TS.exec(a), mz = TS.exec(z);
    if (!ma || !mz) continue;
    const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (text) cues.push({ startUs: toUs(ma), endUs: toUs(mz), text });
  }
  return cues.sort((x, y) => x.startUs - y.startUs);
}

const fmt = (us: number) => {
  const ms = Math.round(us / 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export function writeSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${fmt(c.startUs)} --> ${fmt(c.endUs)}\n${c.text}\n`).join('\n');
}
