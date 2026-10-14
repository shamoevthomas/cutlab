import { create } from 'zustand';
import { produce, freeze } from 'immer';
import { Project, Us } from './model/schema';
import { projectDuration, snapFrame } from './model/ops';

const HISTORY_LIMIT = 200;

export type Panel = 'media' | 'audio' | 'text' | 'stickers' | 'effects' | 'transitions' | 'captions' | 'filters' | 'adjust';
export type Screen = 'home' | 'editor';

interface EditorState {
  screen: Screen;
  project: Project | null;
  past: Project[];
  future: Project[];
  dirty: boolean;
  lastSavedAt: Date | null;

  selection: string[];          // clip ids
  playheadUs: Us;
  playing: boolean;
  pxPerSec: number;             // timeline zoom
  magnet: boolean;
  snapping: boolean;
  linkage: boolean;
  panel: Panel;
  inUs: Us | null;
  outUs: Us | null;
  exportOpen: boolean;
  settingsOpen: boolean;
  toast: { kind: 'info' | 'success' | 'error'; text: string; id: number } | null;

  open(p: Project): void;
  close(): void;
  /** Apply an undoable change. */
  edit(fn: (draft: Project) => void, opts?: { coalesce?: string }): void;
  /** Apply a change that is not recorded in history (e.g. live drag); call commitFrom() when done. */
  live(fn: (draft: Project) => void): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  seek(t: Us): void;
  setPlaying(v: boolean): void;
  set<K extends keyof EditorState>(k: K, v: EditorState[K]): void;
  notify(kind: 'info' | 'success' | 'error', text: string): void;
  markSaved(): void;
}

let gestureBase: Project | null = null;
let lastCoalesce: { key: string; at: number } | null = null;

export const useStore = create<EditorState>((set, get) => ({
  screen: 'home',
  project: null,
  past: [],
  future: [],
  dirty: false,
  lastSavedAt: null,
  selection: [],
  playheadUs: 0,
  playing: false,
  pxPerSec: 60,
  magnet: true,
  snapping: true,
  linkage: true,
  panel: 'media',
  inUs: null,
  outUs: null,
  exportOpen: false,
  settingsOpen: false,
  toast: null,

  open: (p) => set({ project: freeze(p, true), past: [], future: [], screen: 'editor', selection: [], playheadUs: 0, playing: false, dirty: false, lastSavedAt: new Date(), inUs: null, outUs: null }),
  close: () => set({ project: null, screen: 'home', playing: false, past: [], future: [] }),

  edit: (fn, opts) => {
    const cur = get().project;
    if (!cur) return;
    const next = produce(cur, (d) => { fn(d); d.updatedAt = new Date().toISOString(); });
    if (next === cur) return;
    const now = Date.now();
    const coalesce = opts?.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < 800;
    lastCoalesce = opts?.coalesce ? { key: opts.coalesce, at: now } : null;
    const past = coalesce ? get().past : [...get().past, cur].slice(-HISTORY_LIMIT);
    const sel = get().selection.filter(id => next.tracks.some(t => t.clips.some(c => c.id === id)));
    set({ project: next, past, future: [], dirty: true, selection: sel });
  },
  live: (fn) => {
    const cur = get().project;
    if (!cur) return;
    set({ project: produce(cur, fn), dirty: true });
  },
  beginGesture: () => { gestureBase = get().project; },
  endGesture: () => {
    const base = gestureBase; gestureBase = null;
    const cur = get().project;
    if (base && cur && base !== cur) set({ past: [...get().past, base].slice(-HISTORY_LIMIT), future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
  },
  redo: () => {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true });
  },
  select: (ids, additive) => set({ selection: additive ? Array.from(new Set([...get().selection, ...ids])) : ids }),
  seek: (t) => {
    const p = get().project;
    const max = p ? projectDuration(p) : 0;
    const fps = p?.fps ?? 30;
    set({ playheadUs: Math.max(0, Math.min(snapFrame(t, fps), max)) });
  },
  setPlaying: (v) => set({ playing: v }),
  set: (k, v) => set({ [k]: v } as any),
  notify: (kind, text) => {
    const id = Date.now();
    set({ toast: { kind, text, id } });
    setTimeout(() => { if (get().toast?.id === id) set({ toast: null }); }, kind === 'error' ? 6000 : 3000);
  },
  markSaved: () => set({ dirty: false, lastSavedAt: new Date() }),
}));

export const selectedClipId = () => {
  const s = useStore.getState().selection;
  return s.length === 1 ? s[0] : null;
};
