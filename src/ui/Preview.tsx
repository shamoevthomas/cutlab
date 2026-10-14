import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useStore } from '../store';
import { Player } from '../engine/player';
import { renderText } from '../engine/compositor';
import { evaluate, Layer } from '../engine/scene';
import * as op from '../model/ops';
import { fmtTc } from './common';
import { RATIOS } from '../model/schema';

export let activePlayer: Player | null = null;

export function Preview() {
  const project = useStore(s => s.project)!;
  const playing = useStore(s => s.playing);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const player = new Player(canvasRef.current!);
    player.onMissing = (ids) => setMissing(ids.size > 0);
    activePlayer = player;
    // text rendered before a web font finished loading must be redrawn
    const onFonts = () => { player.comp.textures.clear(); player.needsRender = true; };
    document.fonts?.addEventListener?.('loadingdone', onFonts);
    return () => { document.fonts?.removeEventListener?.('loadingdone', onFonts); player.dispose(); activePlayer = null; };
  }, []);

  // fit the canvas into the stage
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const fit = () => {
      const pad = 16;
      const W = el.clientWidth - pad * 2, H = el.clientHeight - pad * 2;
      const s = Math.min(W / project.canvas.width, H / project.canvas.height);
      setBox({ w: Math.max(1, Math.floor(project.canvas.width * s)), h: Math.max(1, Math.floor(project.canvas.height * s)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.canvas.width, project.canvas.height]);

  const anyMissing = (missing && project.assets.some(a => !a.url)) || project.assets.some(a => !a.url && project.tracks.some(t => t.clips.some(c => c.assetId === a.id)));

  return (
    <section className="panel" aria-label="Lecteur">
      <div className="preview-head"><span className="grow">Lecteur</span><span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{project.canvas.width}×{project.canvas.height} · {project.fps} i/s</span></div>
      <div className="stage" ref={stageRef} onDoubleClick={() => stageRef.current?.requestFullscreen?.()}>
        <div style={{ position: 'relative', width: box.w, height: box.h }}>
          <canvas ref={canvasRef} style={{ width: box.w, height: box.h }} aria-label="Aperçu vidéo" />
          {!playing && <Handles scale={box.w / project.canvas.width} />}
          {anyMissing && <div className="missing-frame">Média introuvable : réimporte le fichier</div>}
        </div>
      </div>
      <Transport />
    </section>
  );
}

function Transport() {
  const project = useStore(s => s.project)!;
  const t = useStore(s => s.playheadUs);
  const playing = useStore(s => s.playing);
  const dur = op.projectDuration(project);
  const ratio = Object.entries(RATIOS).find(([, [w, h]]) => w === project.canvas.width && h === project.canvas.height)?.[0] ?? 'Perso';
  return (
    <div className="transport">
      <span className="mono tc">{fmtTc(t, project.fps)}</span>
      <span className="mono faint">/ {fmtTc(dur, project.fps)}</span>
      <span className="grow" />
      <button className="icon-btn" title="Début (Home)" aria-label="Aller au début" onClick={() => useStore.getState().seek(0)}><SkipBack size={16} /></button>
      <button className="icon-btn" style={{ color: 'var(--c-text)' }} title="Lecture / pause (espace)" aria-label={playing ? 'Pause' : 'Lecture'}
        onClick={() => useStore.getState().setPlaying(!playing)} disabled={!dur}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
      <button className="icon-btn" title="Fin (End)" aria-label="Aller à la fin" onClick={() => useStore.getState().seek(dur)}><SkipForward size={16} /></button>
      <span className="grow" />
      <select className="pill" value={ratio} aria-label="Format du projet" onChange={e => {
        const r = RATIOS[e.target.value];
        if (r) useStore.getState().edit(p => { p.canvas.width = r[0]; p.canvas.height = r[1]; });
      }}>
        {Object.keys(RATIOS).map(r => <option key={r} value={r}>{r}</option>)}
        {ratio === 'Perso' && <option value="Perso">Perso</option>}
      </select>
      <button className="icon-btn" title="Plein écran" aria-label="Plein écran" onClick={() => document.querySelector('.stage')?.requestFullscreen?.()}><Maximize size={15} /></button>
    </div>
  );
}

/** Natural size of a layer in project pixels, mirroring the compositor's fit rules. */
function layerSize(p: NonNullable<ReturnType<typeof useStore.getState>['project']>, L: Layer): [number, number] | null {
  if (L.clip.text) {
    const r = renderText(L.clip.text.content || ' ', L.clip.text.style, p.canvas.height, p.canvas.width);
    return [r.w, r.h];
  }
  const a = p.assets.find(x => x.id === L.assetId);
  if (!a || !a.width || !a.height) return null;
  if (a.kind === 'sticker') return [512, 512];
  const s = Math.min(p.canvas.width / a.width, p.canvas.height / a.height);
  return [a.width * s, a.height * s];
}

type HDrag = { mode: 'move' | 'scale' | 'rotate'; x0: number; y0: number; cx: number; cy: number; v0: { x: number; y: number; scale: number; rotation: number }; dist0: number; ang0: number };

function Handles({ scale }: { scale: number }) {
  const project = useStore(s => s.project)!;
  const selection = useStore(s => s.selection);
  const t = useStore(s => s.playheadUs);
  const [drag, setDrag] = useState<HDrag | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const ref = selection.length === 1 ? op.findClip(project, selection[0]) : null;
  const L = ref ? evaluate(project, t).find(l => l.clip.id === ref.clip.id) : undefined;

  useEffect(() => {
    if (!drag || !ref) return;
    const id = ref.clip.id;
    const move = (e: PointerEvent) => {
      const s = useStore.getState();
      const rel = Math.min(Math.max(s.playheadUs - ref.clip.startUs, 0), ref.clip.durationUs);
      s.live(p => {
        const c = op.findClip(p, id)?.clip; if (!c) return;
        if (drag.mode === 'move') {
          let nx = drag.v0.x + ((e.clientX - drag.x0) / scale) / (p.canvas.width / 2);
          let ny = drag.v0.y - ((e.clientY - drag.y0) / scale) / (p.canvas.height / 2);
          const sv = Math.abs(nx) < 0.02, sh = Math.abs(ny) < 0.02;
          if (sv) nx = 0; if (sh) ny = 0;
          setGuides({ v: sv, h: sh });
          op.setProp(c, 'x', rel, nx); op.setProp(c, 'y', rel, ny);
        } else if (drag.mode === 'scale') {
          const d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
          op.setProp(c, 'scale', rel, Math.max(0.01, drag.v0.scale * (d / Math.max(1, drag.dist0))));
        } else {
          const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
          let r = drag.v0.rotation + ((a - drag.ang0) * 180) / Math.PI;
          for (const snapA of [-180, -90, 0, 90, 180]) if (Math.abs(r - snapA) < 3) r = snapA;
          op.setProp(c, 'rotation', rel, Math.round(r * 10) / 10);
        }
      });
    };
    const up = () => { useStore.getState().endGesture(); setDrag(null); setGuides({ v: false, h: false }); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]);

  if (!ref || !L) return null;
  const size = layerSize(project, L);
  if (!size) return null;
  const w = size[0] * L.scale * scale, h = size[1] * L.scale * scale;
  const cx = (project.canvas.width / 2 + L.x * project.canvas.width / 2) * scale;
  const cy = (project.canvas.height / 2 - L.y * project.canvas.height / 2) * scale;

  const start = (mode: HDrag['mode']) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (ref.track.locked) return;
    const rect = (e.currentTarget as HTMLElement).closest('.overlay-box')!.parentElement!.getBoundingClientRect();
    const ccx = rect.left + cx, ccy = rect.top + cy;
    useStore.getState().beginGesture();
    setDrag({ mode, x0: e.clientX, y0: e.clientY, cx: ccx, cy: ccy, v0: { x: L.x, y: L.y, scale: L.scale, rotation: L.rotation },
      dist0: Math.hypot(e.clientX - ccx, e.clientY - ccy), ang0: Math.atan2(e.clientY - ccy, e.clientX - ccx) });
  };
  const corners: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
  return (
    <>
      {guides.v && <div className="guide" style={{ left: '50%', top: 0, bottom: 0, width: 1 }} />}
      {guides.h && <div className="guide" style={{ top: '50%', left: 0, right: 0, height: 1 }} />}
      <div className="overlay-box" style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${L.rotation}deg)` }}>
        <div className="body" onPointerDown={start('move')} />
        {corners.map(([x, y]) => <div key={`${x}${y}`} className="h" style={{ left: x * w - 5, top: y * h - 5, cursor: (x === y) ? 'nwse-resize' : 'nesw-resize' }} onPointerDown={start('scale')} />)}
        <div className="rot" onPointerDown={start('rotate')} title="Rotation" />
      </div>
    </>
  );
}
