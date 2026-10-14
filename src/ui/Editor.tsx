import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Upload, Check, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { AssetPanel } from './AssetPanel';
import { Preview, activePlayer } from './Preview';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { saveNow } from '../actions';

export function Editor() {
  const project = useStore(s => s.project)!;
  const dirty = useStore(s => s.dirty);
  const lastSavedAt = useStore(s => s.lastSavedAt);
  const exportOpen = useStore(s => s.exportOpen);
  const [tlH, setTlH] = useState(() => Number(safeGet('cutlab.tlH')) || 320);
  const dragging = useRef(false);

  // autosave 2 s after the last change, with a fresh cover
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => saveNow(activePlayer?.snapshot()), 2000);
    return () => clearTimeout(t);
  }, [project, dirty]);

  // save before leaving / closing
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { saveNow(); e.preventDefault(); } };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) setTlH(Math.min(window.innerHeight - 300, Math.max(180, window.innerHeight - e.clientY))); };
    const up = () => { if (dragging.current) { dragging.current = false; safeSet('cutlab.tlH', String(tlH)); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [tlH]);

  const back = async () => { await saveNow(activePlayer?.snapshot()); useStore.getState().close(); };

  return (
    <div className="editor" style={{ ['--timeline-h' as any]: tlH + 'px' }}>
      <header className="topbar drag-region">
        <button className="btn ghost sm no-drag" onClick={back} title="Retour à l’accueil"><ChevronLeft size={14} /> Accueil</button>
        <span className="faint row no-drag" style={{ fontSize: 'var(--fs-sm)', gap: 4 }} aria-live="polite">
          {dirty ? <><Loader2 size={12} /> Modifications…</> : <><Check size={12} /> Enregistré automatiquement : {lastSavedAt?.toLocaleTimeString('fr-FR')}</>}
        </span>
        <div className="title no-drag">
          <input value={project.name} aria-label="Nom du projet" onChange={e => useStore.getState().edit(p => { p.name = e.target.value; }, { coalesce: 'name' })} />
        </div>
        <span className="grow" />
        <button className="btn primary no-drag" onClick={() => useStore.getState().set('exportOpen', true)}><Upload size={14} /> Exporter</button>
      </header>
      <div className="workspace">
        <AssetPanel />
        <Preview />
        <Inspector />
      </div>
      <div className="splitter" onPointerDown={() => { dragging.current = true; }} role="separator" aria-orientation="horizontal" aria-label="Redimensionner la timeline" />
      <Timeline />
      {exportOpen && <ExportDialog onClose={() => useStore.getState().set('exportOpen', false)} />}
    </div>
  );
}

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
