import { useMemo, useRef, useState } from 'react';
import { Download, CheckCircle2, FolderOpen } from 'lucide-react';
import { useStore } from '../store';
import { Modal, fmtDur } from './common';
import { exportProject, ExportSettings, outputSize, bitrateFor, ExportProgress } from '../engine/export';
import { projectDuration } from '../model/ops';
import { bridge } from '../bridge';
import { fileManagerName } from '../platform';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(s => s.project)!;
  const inUs = useStore(s => s.inUs), outUs = useStore(s => s.outUs);
  const [name, setName] = useState(project.name);
  const [s, setS] = useState<ExportSettings>({ height: 1080, fps: project.fps, codec: 'h264', quality: 'recommended', includeAudio: true });
  const [mov, setMov] = useState(false);
  const [useRange, setUseRange] = useState(inUs !== null && outUs !== null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(0);

  const range = useRange && inUs !== null && outUs !== null ? [inUs, outUs] : [0, projectDuration(project)];
  const [W, H] = outputSize(project, s.height);
  const br = bitrateFor(W, H, s.fps, s);
  const sizeMb = useMemo(() => ((br + (s.includeAudio ? 192_000 : 0)) * ((range[1] - range[0]) / 1e6)) / 8 / 1e6, [br, range, s.includeAudio]);

  const run = async () => {
    setError(null); setDone(null);
    abort.current = new AbortController();
    started.current = performance.now();
    try {
      const { data, audioCodec } = await exportProject(project, { ...s, rangeStartUs: range[0], rangeEndUs: range[1] }, setProgress, abort.current.signal);
      let path = await bridge.saveExport(`${name || 'export'}.${mov ? 'mov' : 'mp4'}`, data);
      // QuickTime and many apps can't read Opus in MP4: re-encode the audio track to AAC (video is copied)
      if (path && bridge.finalizeExport && (audioCodec === 'opus' || mov)) {
        setProgress({ phase: 'finalizing', done: 1, total: 1 });
        path = await bridge.finalizeExport(path, { aac: audioCodec === 'opus', mov });
      }
      setProgress(null);
      if (path) setDone(path);
    } catch (e: any) {
      setProgress(null);
      if (e?.name !== 'AbortError') setError(e?.message ?? String(e));
    }
  };

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const elapsed = (performance.now() - started.current) / 1000;
  const eta = progress && progress.done > 10 ? (elapsed / progress.done) * (progress.total - progress.done) : null;

  return (
    <Modal title="Exporter" onClose={() => { abort.current?.abort(); onClose(); }} width={520} footer={
      progress ? <button className="btn" onClick={() => abort.current?.abort()}>Annuler</button>
        : done ? <>
          {bridge.reveal && <button className="btn ghost" onClick={() => bridge.reveal!(done)}><FolderOpen size={14} /> Afficher dans {fileManagerName}</button>}
          <button className="btn primary" onClick={onClose}>Terminé</button></>
          : <><button className="btn ghost" onClick={onClose}>Annuler</button><button className="btn primary" disabled={range[1] <= range[0]} onClick={run}><Download size={14} /> Exporter</button></>
    }>
      {done ? (
        <div className="row" style={{ gap: 10 }}><CheckCircle2 color="var(--c-accent)" /> <div><b>Vidéo exportée</b><div className="muted ellipsis" style={{ fontSize: 'var(--fs-sm)', maxWidth: 420 }}>{done}</div></div></div>
      ) : progress ? (
        <div className="col" style={{ gap: 8 }}>
          <div className="row"><span className="grow">{progress.phase === 'audio' ? 'Mixage audio…' : progress.phase === 'video' ? `Rendu des images ${progress.done} / ${progress.total}` : 'Finalisation…'}</span><b>{pct}%</b></div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
          {eta !== null && <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Environ {Math.ceil(eta)} s restantes</span>}
        </div>
      ) : <>
        <label className="field"><span>Nom du fichier</span><input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="row" style={{ gap: 12 }}>
          <label className="field grow"><span>Résolution</span>
            <select className="input" value={s.height} onChange={e => setS({ ...s, height: Number(e.target.value) as any })}>
              <option value={720}>720p</option><option value={1080}>1080p</option><option value={1440}>2K</option><option value={2160}>4K</option>
            </select></label>
          <label className="field grow"><span>Images / s</span>
            <select className="input" value={s.fps} onChange={e => setS({ ...s, fps: Number(e.target.value) })}>
              {[24, 25, 30, 50, 60].map(f => <option key={f} value={f}>{f}</option>)}
            </select></label>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <label className="field grow"><span>Qualité (débit)</span>
            <select className="input" value={s.quality} onChange={e => setS({ ...s, quality: e.target.value as any })}>
              <option value="low">Légère</option><option value="recommended">Recommandée</option><option value="high">Haute</option><option value="custom">Personnalisée</option>
            </select></label>
          {s.quality === 'custom' && <label className="field" style={{ width: 120 }}><span>Mb/s</span><input className="input" type="number" min={1} max={200} value={s.bitrateMbps ?? 12} onChange={e => setS({ ...s, bitrateMbps: Number(e.target.value) })} /></label>}
          <label className="field grow"><span>Codec</span>
            <select className="input" value={s.codec} onChange={e => setS({ ...s, codec: e.target.value as any })}>
              <option value="h264">H.264 (compatible partout)</option><option value="hevc">HEVC / H.265 (plus léger)</option>
            </select></label>
        </div>
        {bridge.finalizeExport && <label className="field"><span>Format</span>
          <select className="input" value={mov ? 'mov' : 'mp4'} onChange={e => setMov(e.target.value === 'mov')} aria-label="Format du fichier">
            <option value="mp4">MP4</option><option value="mov">MOV (QuickTime)</option>
          </select></label>}
        <label className="row"><input type="checkbox" checked={s.includeAudio} onChange={e => setS({ ...s, includeAudio: e.target.checked })} /> Inclure le son</label>
        <label className="row" style={{ opacity: inUs !== null && outUs !== null ? 1 : .5 }}>
          <input type="checkbox" disabled={inUs === null || outUs === null} checked={useRange} onChange={e => setUseRange(e.target.checked)} />
          Exporter seulement la zone entrée / sortie (I / O)
        </label>
        <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>{mov ? 'MOV' : 'MP4'} · {W}×{H} · {(br / 1e6).toFixed(1)} Mb/s · {fmtDur(range[1] - range[0])} · ≈ {sizeMb < 1 ? '<1' : Math.round(sizeMb)} Mo · sans filigrane</div>
        {error && <div style={{ color: 'var(--c-danger)' }} role="alert">{error}</div>}
      </>}
    </Modal>
  );
}
