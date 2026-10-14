import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark, Copy, Eye, EyeOff, Lock, LockOpen, Magnet, Maximize2, Mic, MousePointer2, Redo2, Scissors, Trash2, Undo2,
  Volume2, VolumeX, ZoomIn, ZoomOut, ArrowLeftToLine, ArrowRightToLine, Link2, Crosshair, Blend,
} from 'lucide-react';
import { useStore } from '../store';
import * as op from '../model/ops';
import type { Clip, Project, Track } from '../model/schema';
import { buildPeaks, buildStrip, getPeaks, getStrip, PEAKS_PER_SEC } from '../engine/media';
import { addAssetAtPlayhead, addMarker, deleteSelection, deleteSide, duplicateSelection, importFiles, splitAtPlayhead, copySelection, paste, toggleEnabled } from '../actions';
import { fmtDur } from './common';
import { AutoCutModal } from './AutoTools';

const LEFT_PAD = 12;     // px before t=0
const SNAP_PX = 8;

type Drag =
  | { kind: 'move'; clipId: string; startX: number; startY: number; origStart: number; dxUs: number; trackId: string; moved: boolean }
  | { kind: 'trim'; clipId: string; edge: 'start' | 'end'; startX: number; lastDelta: number }
  | { kind: 'scrub' };

export function Timeline() {
  const project = useStore(s => s.project)!;
  const pxPerSec = useStore(s => s.pxPerSec);
  const selection = useStore(s => s.selection);
  const magnet = useStore(s => s.magnet);
  const snapping = useStore(s => s.snapping);
  const linkage = useStore(s => s.linkage);
  const past = useStore(s => s.past.length);
  const future = useStore(s => s.future.length);
  const inUs = useStore(s => s.inUs), outUs = useStore(s => s.outUs);
  const st = useStore.getState;

  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [blade, setBlade] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; clipId: string } | null>(null);
  const [autoCut, setAutoCut] = useState(false);
  const [, force] = useState(0);
  const [width, setWidth] = useState(800);

  const usToPx = (us: number) => LEFT_PAD + (us / 1e6) * pxPerSec;
  const pxToUs = (px: number) => Math.max(0, ((px - LEFT_PAD) / pxPerSec) * 1e6);

  const duration = op.projectDuration(project);
  const contentW = Math.max(width, usToPx(duration) + 400);

  // display order: overlays (top→down), main, audio
  const rows = useMemo(() => {
    const visual = project.tracks.filter(t => t.kind !== 'audio' && !t.isMain).reverse();
    const main = project.tracks.filter(t => t.isMain);
    const audio = project.tracks.filter(t => t.kind === 'audio');
    return [...visual, ...main, ...audio];
  }, [project.tracks]);
  const rowH = (t: Track) => (t.isMain ? 64 : 48);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keep the playhead visible while playing
  useEffect(() => useStore.subscribe((s, prev) => {
    if (!s.playing || s.playheadUs === prev.playheadUs) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = LEFT_PAD + (s.playheadUs / 1e6) * s.pxPerSec;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80;
  }), []);

  // build thumbnails / waveforms in the background
  useEffect(() => {
    for (const a of project.assets) {
      if (!a.url) continue;
      buildStrip(a, () => force(n => n + 1));
      buildPeaks(a, () => force(n => n + 1));
    }
  }, [project.assets]);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const el = scrollRef.current!;
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + el.scrollLeft;
      const tAtMouse = pxToUs(mouseX);
      const next = Math.min(2000, Math.max(2, pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      st().set('pxPerSec', next);
      requestAnimationFrame(() => { el.scrollLeft = LEFT_PAD + (tAtMouse / 1e6) * next - (e.clientX - rect.left); });
    }
  };

  const fit = () => {
    const w = (scrollRef.current?.clientWidth ?? 800) - LEFT_PAD - 60;
    st().set('pxPerSec', Math.min(2000, Math.max(2, w / Math.max(1, duration / 1e6))));
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const snap = (t: number, ignoreId?: string, extra: number[] = []) => {
    if (!snapping) return { t, snapped: false };
    return op.snapTime(project, t, (SNAP_PX / pxPerSec) * 1e6, [st().playheadUs, ...extra], ignoreId);
  };

  const xFromEvent = (e: { clientX: number }) => {
    const el = scrollRef.current!;
    return e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
  };

  const trackAtY = (clientY: number): Track | null => {
    const lanes = scrollRef.current?.querySelectorAll<HTMLElement>('[data-track]');
    if (!lanes) return null;
    for (const l of lanes) {
      const r = l.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return project.tracks.find(t => t.id === l.dataset.track) ?? null;
    }
    return null;
  };

  // ---------- pointer interactions ----------
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const p = st().project!;
      if (drag.kind === 'scrub') { st().seek(snap(pxToUs(xFromEvent(e))).t); return; }
      if (drag.kind === 'move') {
        const ref = op.findClip(p, drag.clipId); if (!ref) return;
        const dxUs = ((e.clientX - drag.startX) / pxPerSec) * 1e6;
        let start = Math.max(0, drag.origStart + dxUs);
        // snap either edge
        const s1 = snap(start, drag.clipId), s2 = snap(start + ref.clip.durationUs, drag.clipId);
        if (s1.snapped) { start = s1.t; setSnapAt(s1.t); }
        else if (s2.snapped) { start = s2.t - ref.clip.durationUs; setSnapAt(s2.t); }
        else setSnapAt(null);
        const over = trackAtY(e.clientY);
        const moved = drag.moved || Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3;
        setDrag({ ...drag, dxUs: start - drag.origStart, trackId: over && compatible(ref.track, over) ? over.id : drag.trackId, moved });
      }
      if (drag.kind === 'trim') {
        const ref = op.findClip(p, drag.clipId); if (!ref) return;
        let delta = ((e.clientX - drag.startX) / pxPerSec) * 1e6;
        const edgeT = drag.edge === 'start' ? ref.clip.startUs + (delta - drag.lastDelta) : op.clipEnd(ref.clip) + (delta - drag.lastDelta);
        const s = snap(edgeT, drag.clipId);
        if (s.snapped) { delta += s.t - edgeT; setSnapAt(s.t); } else setSnapAt(null);
        const step = delta - drag.lastDelta;
        if (Math.abs(step) < 1) return;
        st().live(d => op.trimClip(d, drag.clipId, drag.edge, step));
        setDrag({ ...drag, lastDelta: delta });
      }
    };
    const up = () => {
      if (drag.kind === 'move' && drag.moved) {
        st().edit(d => {
          const ok = op.moveClip(d, drag.clipId, drag.origStart + drag.dxUs, drag.trackId, magnet);
          if (!ok) { // overlap: put it on a free track of the same kind
            const ref = op.findClip(d, drag.clipId)!;
            const t = op.trackWithRoom(d, ref.track.kind, drag.origStart + drag.dxUs, ref.clip.durationUs, magnet);
            op.moveClip(d, drag.clipId, drag.origStart + drag.dxUs, t.id, magnet);
          }
        });
      }
      if (drag.kind === 'trim') st().endGesture();
      setDrag(null); setSnapAt(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, pxPerSec, snapping, magnet, project]);

  const onClipDown = (e: React.PointerEvent, track: Track, c: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (blade) {
      const t = snap(pxToUs(xFromEvent(e))).t;
      st().edit(d => { op.splitClip(d, c.id, t); });
      return;
    }
    const sel = st().selection;
    if (e.shiftKey || e.metaKey) st().select(sel.includes(c.id) ? sel.filter(x => x !== c.id) : [...sel, c.id]);
    else if (!sel.includes(c.id)) st().select([c.id]);
    if (track.locked) return;
    setDrag({ kind: 'move', clipId: c.id, startX: e.clientX, startY: e.clientY, origStart: c.startUs, dxUs: 0, trackId: track.id, moved: false });
  };

  const onTrimDown = (e: React.PointerEvent, track: Track, c: Clip, edge: 'start' | 'end') => {
    e.stopPropagation();
    if (track.locked) return;
    st().select([c.id]);
    st().beginGesture();
    setDrag({ kind: 'trim', clipId: c.id, edge, startX: e.clientX, lastDelta: 0 });
  };

  const onLaneDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    st().select([]);
    st().seek(pxToUs(xFromEvent(e)));
    setDrag({ kind: 'scrub' });
  };

  // ---------- drag & drop from the asset panel / Finder ----------
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-cutlab-asset') && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    const tr = trackAtY(e.clientY);
    setDropTrack(tr?.id ?? null);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropTrack(null);
    const t = snap(pxToUs(xFromEvent(e))).t;
    const tr = trackAtY(e.clientY);
    const assetId = e.dataTransfer.getData('application/x-cutlab-asset');
    if (assetId) {
      const asset = project.assets.find(a => a.id === assetId);
      const ok = tr && asset && kindFits(tr, asset.kind) && !tr.isMain;
      addAssetAtPlayhead(assetId, t, ok ? tr!.id : undefined);
      return;
    }
    if (e.dataTransfer.files.length) {
      const { pickedFromDrop } = await import('./dropFiles');
      const files = await pickedFromDrop(e.dataTransfer.files);
      st().seek(t);
      await importFiles(files, true);
    }
  };

  const sel1 = selection.length === 1 ? op.findClip(project, selection[0]) : null;
  const playhead = useStore(s => s.playheadUs);
  const canSplit = project.tracks.some(t => t.clips.some(c => c.startUs < playhead && op.clipEnd(c) > playhead));

  return (
    <div className="timeline" onContextMenu={e => e.preventDefault()}>
      <div className="tl-toolbar" role="toolbar" aria-label="Outils de la timeline">
        <button className="icon-btn" aria-pressed={!blade} title="Sélection (A)" aria-label="Outil sélection" onClick={() => setBlade(false)}><MousePointer2 size={16} /></button>
        <button className="icon-btn" aria-pressed={blade} title="Lame : clic pour couper (B)" aria-label="Outil lame" onClick={() => setBlade(true)}><Scissors size={16} /></button>
        <span className="sep" />
        <button className="icon-btn" disabled={!past} title="Annuler (⌘Z)" aria-label="Annuler" onClick={() => st().undo()}><Undo2 size={16} /></button>
        <button className="icon-btn" disabled={!future} title="Rétablir (⇧⌘Z)" aria-label="Rétablir" onClick={() => st().redo()}><Redo2 size={16} /></button>
        <span className="sep" />
        <button className="icon-btn" disabled={!canSplit} title="Couper à la tête de lecture (⌘B)" aria-label="Couper" onClick={splitAtPlayhead}><SplitIcon /></button>
        <button className="icon-btn" disabled={!canSplit} title="Supprimer à gauche (Q)" aria-label="Supprimer à gauche" onClick={() => deleteSide('left')}><ArrowLeftToLine size={16} /></button>
        <button className="icon-btn" disabled={!canSplit} title="Supprimer à droite (W)" aria-label="Supprimer à droite" onClick={() => deleteSide('right')}><ArrowRightToLine size={16} /></button>
        <button className="icon-btn" disabled={!selection.length} title="Supprimer (⌫)" aria-label="Supprimer" onClick={() => deleteSelection()}><Trash2 size={16} /></button>
        <button className="icon-btn" disabled={!selection.length} title="Dupliquer (⌘D)" aria-label="Dupliquer" onClick={duplicateSelection}><Copy size={16} /></button>
        <button className="icon-btn" title="Repère (M)" aria-label="Ajouter un repère" onClick={addMarker}><Bookmark size={16} /></button>
        <span className="sep" />
        <button className="btn sm ghost" title="Coupe automatique des blancs" onClick={() => setAutoCut(true)} disabled={!project.tracks.some(t => t.clips.some(c => c.assetId))}><Scissors size={14} /> Coupe des blancs</button>
        <span className="grow" />
        {sel1 && <span className="faint mono" style={{ fontSize: 'var(--fs-xs)', marginRight: 8 }}>{fmtDur(sel1.clip.durationUs)}</span>}
        <button className="icon-btn" disabled title="Voix off : phase 3" aria-label="Enregistrer une voix off"><Mic size={16} /></button>
        <span className="sep" />
        <button className="icon-btn" aria-pressed={magnet} title="Aimant piste principale (P)" aria-label="Aimant piste principale" onClick={() => st().set('magnet', !magnet)}><Magnet size={16} /></button>
        <button className="icon-btn" aria-pressed={snapping} title="Magnétisme (N)" aria-label="Magnétisme" onClick={() => st().set('snapping', !snapping)}><Crosshair size={16} /></button>
        <button className="icon-btn" aria-pressed={linkage} title="Lier audio et vidéo" aria-label="Liaison" onClick={() => st().set('linkage', !linkage)}><Link2 size={16} /></button>
        <span className="sep" />
        <button className="icon-btn" title="Dézoomer (⌘−)" aria-label="Dézoomer" onClick={() => st().set('pxPerSec', Math.max(2, pxPerSec / 1.4))}><ZoomOut size={16} /></button>
        <input className="tl-zoom" type="range" min={0} max={100} aria-label="Zoom de la timeline"
          value={Math.round((Math.log(pxPerSec / 2) / Math.log(1000)) * 100)}
          onChange={e => st().set('pxPerSec', 2 * Math.pow(1000, Number(e.target.value) / 100))} />
        <button className="icon-btn" title="Zoomer (⌘+)" aria-label="Zoomer" onClick={() => st().set('pxPerSec', Math.min(2000, pxPerSec * 1.4))}><ZoomIn size={16} /></button>
        <button className="icon-btn" title="Ajuster (⇧Z)" aria-label="Ajuster à la fenêtre" onClick={fit}><Maximize2 size={16} /></button>
      </div>

      <div className="tl-main">
        <div className="tl-headers" ref={headersRef}>
          <div style={{ height: 'var(--l-ruler)', borderBottom: '1px solid var(--c-border)' }} />
          <div style={{ transform: `translateY(${-(scrollRef.current?.scrollTop ?? 0)}px)` }}>
            {rows.map(t => (
              <div key={t.id} className="track-h" style={{ height: rowH(t) }}>
                <span className="kind">{trackName(t)}</span>
                <button className="icon-btn" title={t.locked ? 'Déverrouiller' : 'Verrouiller'} aria-label={t.locked ? 'Déverrouiller la piste' : 'Verrouiller la piste'} aria-pressed={t.locked}
                  onClick={() => st().edit(d => { const x = d.tracks.find(y => y.id === t.id)!; x.locked = !x.locked; })}>{t.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
                {t.kind !== 'audio' && <button className="icon-btn" title={t.hidden ? 'Afficher' : 'Masquer'} aria-label={t.hidden ? 'Afficher la piste' : 'Masquer la piste'} aria-pressed={t.hidden}
                  onClick={() => st().edit(d => { const x = d.tracks.find(y => y.id === t.id)!; x.hidden = !x.hidden; })}>{t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>}
                {(t.kind === 'audio' || t.kind === 'video') && <button className="icon-btn" title={t.muted ? 'Réactiver le son' : 'Couper le son'} aria-label={t.muted ? 'Réactiver le son de la piste' : 'Couper le son de la piste'} aria-pressed={t.muted}
                  onClick={() => st().edit(d => { const x = d.tracks.find(y => y.id === t.id)!; x.muted = !x.muted; })}>{t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}
              </div>
            ))}
          </div>
        </div>

        <div className="tl-scroll" ref={scrollRef} onWheel={onWheel} onDragOver={onDragOver} onDragLeave={() => setDropTrack(null)} onDrop={onDrop}
          onScroll={() => force(n => n + 1)} style={{ cursor: blade ? 'crosshair' : undefined }}>
          <div style={{ width: contentW, position: 'relative', minHeight: '100%' }}>
            <Ruler pxPerSec={pxPerSec} width={contentW} fps={project.fps} onDown={e => { st().seek(snap(pxToUs(xFromEvent(e))).t); setDrag({ kind: 'scrub' }); }} />
            {inUs !== null && outUs !== null && <div className="inout" style={{ left: usToPx(inUs), width: usToPx(outUs) - usToPx(inUs) }} />}
            {project.markers.map(m => <div key={m.id} className="marker" style={{ left: usToPx(m.tUs), background: m.color }} title="Repère (clic droit pour supprimer)"
              onContextMenu={e => { e.preventDefault(); st().edit(d => { d.markers = d.markers.filter(x => x.id !== m.id); }); }} />)}
            <div onPointerDown={onLaneDown} style={{ position: 'relative' }}>
              {rows.map(t => (
                <div key={t.id} data-track={t.id} className={'track-lane' + (t.isMain ? ' main' : '') + (t.locked ? ' locked' : '') + (dropTrack === t.id ? ' drop' : '')} style={{ height: rowH(t) }}>
                  {t.clips.map((c, i) => (
                    <ClipView key={c.id} project={project} track={t} clip={c} next={t.clips[i + 1]}
                      selected={selection.includes(c.id)} usToPx={usToPx}
                      drag={drag?.kind === 'move' && drag.clipId === c.id && drag.moved ? drag : null}
                      onDown={e => onClipDown(e, t, c)} onTrim={(e, edge) => onTrimDown(e, t, c, edge)}
                      onCtx={e => { e.preventDefault(); e.stopPropagation(); if (!selection.includes(c.id)) st().select([c.id]); setCtx({ x: e.clientX, y: e.clientY, clipId: c.id }); }} />
                  ))}
                </div>
              ))}
              {project.tracks.every(t => !t.clips.length) && <div className="tl-empty">Glisse tes médias ici ou clique sur « + » dans le panneau Médias</div>}
            </div>
            <Playhead usToPx={usToPx} />
            {snapAt !== null && <div className="snapline" style={{ left: usToPx(snapAt) }} />}
          </div>
        </div>
      </div>
      {ctx && <ClipMenu at={ctx} onClose={() => setCtx(null)} />}
      {autoCut && <AutoCutModal onClose={() => setAutoCut(false)} />}
    </div>
  );
}

function compatible(from: Track, to: Track) {
  if (to.locked) return false;
  if (from.kind === to.kind) return true;
  return ['video', 'sticker'].includes(from.kind) && ['video', 'sticker'].includes(to.kind);
}
function kindFits(t: Track, assetKind: string) {
  if (assetKind === 'audio') return t.kind === 'audio';
  return t.kind === 'video' || t.kind === 'sticker';
}
function trackName(t: Track) {
  if (t.isMain) return 'Principale';
  return { video: 'Vidéo', audio: 'Audio', text: 'Texte', sticker: 'Sticker', effect: 'Effet', filter: 'Filtre', adjustment: 'Réglage' }[t.kind];
}

function SplitIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1v14" /><path d="M2 4h4v8H2M14 4h-4v8h4" /></svg>;
}

function Playhead({ usToPx }: { usToPx: (us: number) => number }) {
  const t = useStore(s => s.playheadUs);
  return <div className="playhead" style={{ left: usToPx(t) }} />;
}

function Ruler({ pxPerSec, width, fps, onDown }: { pxPerSec: number; width: number; fps: number; onDown: (e: React.PointerEvent) => void }) {
  // pick a label step that keeps ~90px between labels
  const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = steps.find(s => s * pxPerSec >= 90) ?? 3600;
  const minor = step / 5;
  const ticks: JSX.Element[] = [];
  const n = Math.ceil((width - LEFT_PAD) / (minor * pxPerSec));
  for (let i = 0; i <= n && i < 4000; i++) {
    const s = i * minor;
    const x = LEFT_PAD + s * pxPerSec;
    const major = i % 5 === 0;
    ticks.push(<div key={i} className="tick" style={{ left: x, height: major ? 10 : 5 }} />);
    if (major) ticks.push(<div key={'l' + i} className="lab" style={{ left: x }}>{label(s, step, fps)}</div>);
  }
  return <div className="tl-ruler" onPointerDown={e => { e.stopPropagation(); onDown(e); }}>{ticks}</div>;
}
function label(s: number, step: number, fps: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  if (step < 1) return `${base}:${String(Math.round((s % 1) * fps)).padStart(2, '0')}`;
  return base;
}

function ClipView({ project, track, clip, next, selected, usToPx, drag, onDown, onTrim, onCtx }: {
  project: Project; track: Track; clip: Clip; next?: Clip; selected: boolean; usToPx: (us: number) => number;
  drag: Extract<Drag, { kind: 'move' }> | null;
  onDown: (e: React.PointerEvent) => void; onTrim: (e: React.PointerEvent, edge: 'start' | 'end') => void; onCtx: (e: React.MouseEvent) => void;
}) {
  const asset = clip.assetId ? project.assets.find(a => a.id === clip.assetId) : undefined;
  const left = usToPx(clip.startUs + (drag?.dxUs ?? 0));
  const w = Math.max(4, usToPx(op.clipEnd(clip)) - usToPx(clip.startUs));
  const kind = clip.text ? 'text' : track.kind === 'audio' ? 'audio' : asset?.kind === 'sticker' ? 'sticker' : 'video';
  const strip = asset ? getStrip(asset) : undefined;
  const missing = asset && !asset.url;
  const tr = next ? project.transitions.find(x => x.fromClipId === clip.id && x.toClipId === next.id) : undefined;
  const style: React.CSSProperties = { left, width: w, zIndex: drag ? 10 : undefined, opacity: drag ? 0.85 : undefined };
  if (drag && drag.trackId !== track.id) style.transform = 'translateY(-6px)';
  const h = track.isMain ? 64 : 48;
  return (
    <div className={`clip ${kind}` + (selected ? ' sel' : '') + (!clip.enabled ? ' disabled' : '') + (missing ? ' missing' : '')} style={style}
      onPointerDown={onDown} onContextMenu={onCtx} title={clip.label}>
      <div className="lab">{clip.text ? clip.text.content : clip.label}{clip.speed !== 1 ? ` · ${clip.speed}x` : ''}{missing ? ' · fichier introuvable' : ''}</div>
      {kind === 'video' && asset?.kind === 'video' && strip && <Strip strip={strip} clip={clip} durUs={asset.durationUs ?? 1} w={w} h={h - 18} />}
      {kind === 'video' && asset?.kind === 'image' && asset.thumb && <div className="strip" style={{ backgroundImage: `url(${asset.thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />}
      {(kind === 'audio' || asset?.kind === 'video') && asset && <Wave assetId={asset.id} clip={clip} w={w} audio={kind === 'audio'} />}
      {selected && clip.keyframes.map(k => <div key={k.id} className="kfdot" style={{ left: (k.tUs / clip.durationUs) * w }} />)}
      <div className="trim l" onPointerDown={e => onTrim(e, 'start')} />
      <div className="trim r" onPointerDown={e => onTrim(e, 'end')} />
      {tr && <div className="trans" style={{ right: -9 }} title="Transition (clic droit sur le clip pour la retirer)"><Blend size={12} /></div>}
    </div>
  );
}

function Strip({ strip, clip, durUs, w, h }: { strip: string[]; clip: Clip; durUs: number; w: number; h: number }) {
  // one tile every ~(h*16/9) px, picking the frame nearest to the source time
  const tileW = Math.max(30, Math.round(h * 16 / 9));
  const n = Math.max(1, Math.ceil(w / tileW));
  const tiles = [];
  for (let i = 0; i < n && i < 200; i++) {
    const rel = ((i + 0.5) / n) * clip.durationUs;
    const src = op.sourceTimeAt(clip, clip.startUs + rel);
    const idx = Math.min(strip.length - 1, Math.max(0, Math.floor((src / durUs) * strip.length)));
    tiles.push(<div key={i} style={{ width: tileW, backgroundImage: `url(${strip[idx]})` }} />);
  }
  return <div className="strip">{tiles}</div>;
}

function Wave({ assetId, clip, w, audio }: { assetId: string; clip: Clip; w: number; audio: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = getPeaks(assetId);
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks || !peaks.length) return;
    const W = Math.min(4000, Math.ceil(w)), H = c.clientHeight || 30;
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.fillStyle = audio ? 'rgba(170,255,215,.75)' : 'rgba(170,220,255,.45)';
    const gain = Math.pow(10, clip.volumeDb / 20);
    for (let x = 0; x < W; x++) {
      const src = op.sourceTimeAt(clip, clip.startUs + (x / W) * clip.durationUs);
      const v = Math.min(1, (peaks[Math.floor((src / 1e6) * PEAKS_PER_SEC)] ?? 0) * gain);
      const hh = Math.max(1, v * H);
      g.fillRect(x, H - hh, 1, hh);
    }
  }, [peaks, w, clip.inUs, clip.durationUs, clip.speed, clip.volumeDb, clip.reverse, audio]);
  if (!peaks || !peaks.length) return null;
  return <canvas ref={ref} className="wave" style={audio ? { height: '75%' } : { height: '35%' }} />;
}

function ClipMenu({ at, onClose }: { at: { x: number; y: number; clipId: string }; onClose: () => void }) {
  const st = useStore.getState;
  const p = useStore(s => s.project)!;
  const ref = op.findClip(p, at.clipId);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); };
  }, [onClose]);
  if (!ref) return null;
  const next = ref.track.clips[ref.index + 1];
  const tr = next && p.transitions.find(x => x.fromClipId === ref.clip.id);
  const item = (label: string, kb: string, fn: () => void, disabled = false) => (
    <button disabled={disabled} onPointerDown={e => e.stopPropagation()} onClick={() => { fn(); onClose(); }}><span>{label}</span><span className="faint">{kb}</span></button>
  );
  const asset = p.assets.find(a => a.id === ref.clip.assetId);
  return (
    <div className="ctx" role="menu" style={{ left: Math.min(at.x, window.innerWidth - 220), top: Math.min(at.y, window.innerHeight - 320) }} onPointerDown={e => e.stopPropagation()}>
      {item('Couper ici', '⌘B', splitAtPlayhead)}
      {item('Copier', '⌘C', copySelection)}
      {item('Coller', '⌘V', paste)}
      {item('Dupliquer', '⌘D', duplicateSelection)}
      <hr />
      {item(ref.clip.enabled ? 'Désactiver le clip' : 'Activer le clip', 'V', toggleEnabled)}
      {item('Lire à l’envers', '', () => st().edit(d => { const r = op.findClip(d, at.clipId)!; r.clip.reverse = !r.clip.reverse; }), !asset || asset.kind !== 'video')}
      {item('Séparer l’audio', '', () => st().edit(d => {
        const r = op.findClip(d, at.clipId)!;
        const a = d.assets.find(x => x.id === r.clip.assetId)!;
        const t = op.trackWithRoom(d, 'audio', r.clip.startUs, r.clip.durationUs, true);
        t.clips.push({ ...JSON.parse(JSON.stringify(r.clip)), id: crypto.randomUUID(), label: a.name + ' (audio)', keyframes: [] });
        op.sortTrack(t);
        r.clip.volumeDb = -60;
      }), !asset || asset.kind !== 'video' || ref.track.kind === 'audio')}
      {tr && item('Retirer la transition', '', () => st().edit(d => { d.transitions = d.transitions.filter(x => x.id !== tr.id); }))}
      <hr />
      {item('Supprimer', '⌫', () => deleteSelection())}
    </div>
  );
}
