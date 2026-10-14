import { useStore } from '../store';
import * as A from '../actions';

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color'].includes((t as HTMLInputElement).type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export function installShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    const s = useStore.getState();
    if (s.screen !== 'editor' || !s.project || s.exportOpen || document.querySelector('.backdrop')) return;
    if (isTyping(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const run = (fn: () => void) => { e.preventDefault(); fn(); };
    if (k === ' ') return run(() => s.setPlaying(!s.playing));
    if (mod && k === 'z') return run(() => (e.shiftKey ? s.redo() : s.undo()));
    if (mod && k === 'y') return run(() => s.redo());
    if (mod && k === 'b') return run(() => (e.shiftKey ? A.splitAtPlayhead() : A.splitAtPlayhead()));
    if (mod && k === 'c') return run(A.copySelection);
    if (mod && k === 'x') return run(A.cutSelection);
    if (mod && k === 'v') return run(A.paste);
    if (mod && k === 'd') return run(A.duplicateSelection);
    if (mod && k === 'a') return run(() => s.select(s.project!.tracks.flatMap(t => t.clips.map(c => c.id))));
    if (mod && k === 'e') return run(() => s.set('exportOpen', true));
    if (mod && k === 's') return run(() => A.saveNow());
    if (mod && (k === '=' || k === '+')) return run(() => s.set('pxPerSec', Math.min(2000, s.pxPerSec * 1.4)));
    if (mod && k === '-') return run(() => s.set('pxPerSec', Math.max(2, s.pxPerSec / 1.4)));
    if (mod) return;
    if (k === 'backspace' || k === 'delete') return run(() => A.deleteSelection());
    if (k === 'q') return run(() => A.deleteSide('left'));
    if (k === 'w') return run(() => A.deleteSide('right'));
    if (k === 'v') return run(A.toggleEnabled);
    if (k === 'm') return run(A.addMarker);
    if (k === 'p') return run(() => s.set('magnet', !s.magnet));
    if (k === 'n') return run(() => s.set('snapping', !s.snapping));
    if (k === 'i') return run(() => s.set('inUs', s.playheadUs));
    if (k === 'o') return run(() => s.set('outUs', s.playheadUs));
    if (k === 'x' && e.altKey) return run(() => { s.set('inUs', null); s.set('outUs', null); });
    if (k === 'arrowleft') return run(() => A.stepFrames(e.shiftKey ? -10 : -1));
    if (k === 'arrowright') return run(() => A.stepFrames(e.shiftKey ? 10 : 1));
    if (k === 'arrowup') return run(() => A.jumpCut(-1));
    if (k === 'arrowdown') return run(() => A.jumpCut(1));
    if (k === 'home') return run(() => s.seek(0));
    if (k === 'end') return run(() => s.seek(Infinity));
    if (k === 'escape') return run(() => s.select([]));
    if (k === 'k') return run(() => s.setPlaying(false));
    if (k === 'l') return run(() => s.setPlaying(true));
    if (k === 'j') return run(() => { s.setPlaying(false); A.stepFrames(-Math.round(s.project!.fps)); });
    if (e.shiftKey && k === 'z') return run(() => { /* fit handled in timeline button */ document.querySelector<HTMLButtonElement>('[aria-label="Ajuster à la fenêtre"]')?.click(); });
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
