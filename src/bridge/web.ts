// Browser implementation: projects and imported media live in IndexedDB, so a reload keeps everything.
import type { Bridge, PickedFile, ProjectSummary } from './types';
import type { Project } from '../model/schema';
import { projectDuration } from '../model/ops';

const DB = 'cutlab';
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('projects');
      r.result.createObjectStore('media');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const urlCache = new Map<string, string>();

function pick(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = multiple; input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => { resolve(Array.from(input.files ?? [])); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

const ACCEPT = {
  media: 'video/*,image/*,audio/*,.mov,.mkv',
  audio: 'audio/*',
  srt: '.srt,.txt,.vtt',
  font: '.ttf,.otf,.woff,.woff2',
  lut: '.cube',
};

export async function storeFile(f: File): Promise<PickedFile> {
  const path = `idb:${crypto.randomUUID()}/${f.name}`;
  await tx('media', 'readwrite', s => s.put(f, path));
  const url = URL.createObjectURL(f);
  urlCache.set(path, url);
  return { name: f.name, path, url, mime: f.type, size: f.size };
}

export const webBridge: Bridge = {
  kind: 'web',
  async listProjects() {
    const all = await tx<Project[]>('projects', 'readonly', s => s.getAll() as IDBRequest<Project[]>);
    return all
      .map((p: any): ProjectSummary => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, durationUs: projectDuration(p), width: p.canvas.width, height: p.canvas.height, cover: p._cover }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async loadProject(id) { return (await tx<Project>('projects', 'readonly', s => s.get(id))) ?? null; },
  async saveProject(p, cover) {
    const prev: any = await tx('projects', 'readonly', s => s.get(p.id));
    await tx('projects', 'readwrite', s => s.put({ ...p, _cover: cover ?? prev?._cover }, p.id));
  },
  async deleteProject(id) { await tx('projects', 'readwrite', s => s.delete(id)); },
  async pickFiles(accept) {
    const files = await pick(ACCEPT[accept]);
    return Promise.all(files.map(storeFile));
  },
  async resolve(path) {
    if (urlCache.has(path)) return urlCache.get(path)!;
    if (!path.startsWith('idb:')) return path.startsWith('blob:') || path.startsWith('http') || path.startsWith('data:') ? path : null;
    const f = await tx<File | undefined>('media', 'readonly', s => s.get(path));
    if (!f) return null;
    const url = URL.createObjectURL(f);
    urlCache.set(path, url);
    return url;
  },
  async readText(path) {
    const url = await this.resolve(path);
    if (!url) throw new Error('fichier introuvable');
    return (await fetch(url)).text();
  },
  async writeFile(_projectId, name, data) {
    return storeFile(new File([data], name, { type: name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.wav') ? 'audio/wav' : '' }));
  },
  async saveExport(name, data) {
    const blob = new Blob([data], { type: name.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    return name;
  },
};
