import { useState } from 'react';
import { Scissors, Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { Modal, SliderRow, Switch, fmtDur } from './common';
import { ASR_MODELS, LANGUAGES, AsrProgress, TRANSLATE_TO } from '../engine/asr';
import { generateCaptions, CaptionStyle, planAutoCut, applyAutoCut, CutPlan } from '../actions';
import * as op from '../model/ops';

function safeGet(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

function ProgressView({ p }: { p: AsrProgress }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row"><Loader2 size={14} className="spin" /> <span className="grow">{p.text}</span>{p.ratio !== undefined && <b>{Math.round(p.ratio * 100)}%</b>}</div>
      <div className="progress"><div style={{ width: p.ratio !== undefined ? `${p.ratio * 100}%` : '35%', opacity: p.ratio !== undefined ? 1 : .5 }} /></div>
    </div>
  );
}

export function getCaptionStyle(): CaptionStyle { return (safeGet('cutlab.capStyle', 'reel') as CaptionStyle); }
export function setCaptionStyle(v: CaptionStyle) { safeSet('cutlab.capStyle', v); }

export function AutoCaptionsPanel({ lyrics = false }: { lyrics?: boolean }) {
  const [language, setLanguage] = useState<string>(safeGet('cutlab.lang', 'french'));
  const [model, setModel] = useState(safeGet('cutlab.asrModel', ASR_MODELS[0].id));
  const [bilingual, setBilingual] = useState<string>('none');
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState<AsrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasCaptions = useStore(s => s.project?.tracks.some(t => t.role === 'captions'));
  const run = async () => {
    setError(null);
    safeSet('cutlab.lang', language); safeSet('cutlab.asrModel', model);
    setBusy({ phase: 'audio', text: 'Préparation…' });
    try {
      const n = await generateCaptions({ model, language: language === 'auto' ? null : language, style: getCaptionStyle(), upper: false,
        translateTo: bilingual === 'none' ? null : bilingual, replace, lyrics }, setBusy);
      useStore.getState().notify('success', `${n} ${lyrics ? 'lignes de paroles' : 'sous-titres'} créés`);
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };
  return (
    <div className="col" style={{ gap: 12, flex: 1 }}>
      <label className="field"><span>{lyrics ? 'Langue de la chanson' : 'Langue source'}</span>
        <select className="input" value={language} onChange={e => setLanguage(e.target.value)} disabled={!!busy}>
          {LANGUAGES.map(([v, l]) => <option key={l} value={v ?? 'auto'}>{l}</option>)}
        </select></label>
      {!lyrics && <label className="field"><span>Sous-titres bilingues</span>
        <select className="input" value={bilingual} onChange={e => setBilingual(e.target.value)} disabled={!!busy}>
          <option value="none">Aucun</option>
          {TRANSLATE_TO.map(([v, l]) => <option key={v} value={v}>{l} (2e ligne)</option>)}
        </select></label>}
      <label className="field"><span>Précision</span>
        <select className="input" value={model} onChange={e => setModel(e.target.value)} disabled={!!busy}>
          {ASR_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select></label>
      <div className="hint">Style : celui choisi dans « Modèles ». Transcrit le son de la timeline tel qu’il est (coupes comprises) : fais la coupe des blancs d’abord.</div>
      <span className="grow" />
      {busy && <ProgressView p={busy} />}
      {error && <div role="alert" style={{ color: 'var(--c-danger)', fontSize: 'var(--fs-sm)' }}>{error}</div>}
      <div className="row" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 10 }}>
        <label className="row grow" style={{ fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} disabled={!hasCaptions} /> Supprimer les sous-titres actuels</label>
        <button className="btn primary" onClick={run} disabled={!!busy}>Générer</button>
      </div>
    </div>
  );
}

export function AutoCutModal({ onClose }: { onClose: () => void }) {
  const project = useStore(s => s.project)!;
  const selection = useStore(s => s.selection);
  const main = project.tracks.find(t => t.isMain)!;
  const selected = selection.filter(id => { const r = op.findClip(project, id); return r && r.clip.assetId && r.track.kind !== 'text'; });
  const [scope, setScope] = useState<'selection' | 'main'>(selected.length ? 'selection' : 'main');
  const [auto, setAuto] = useState(true);
  const [thr, setThr] = useState(-38);
  const [minS, setMinS] = useState(0.5);
  const [pad, setPad] = useState(0.12);
  const [fillers, setFillers] = useState(false);
  const [busy, setBusy] = useState<AsrProgress | null>(null);
  const [plans, setPlans] = useState<CutPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = scope === 'selection' ? selected : main.clips.filter(c => c.assetId).map(c => c.id);

  const analyse = async () => {
    setError(null); setPlans(null);
    setBusy({ phase: 'audio', text: 'Analyse…' });
    try {
      setPlans(await planAutoCut(ids, { thresholdDb: auto ? 'auto' : thr, minSilenceS: minS, padS: pad, fillers, model: safeGet('cutlab.asrModel', ASR_MODELS[0].id), language: safeGet('cutlab.lang', 'french') }, setBusy));
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };
  const total = plans?.reduce((t, p) => t + p.removedUs, 0) ?? 0;
  const count = plans?.reduce((t, p) => t + p.count, 0) ?? 0;
  return (
    <Modal title={<span className="row"><Scissors size={16} /> Coupe des blancs</span>} onClose={onClose} width={480} footer={<>
      <button className="btn ghost" onClick={onClose}>Fermer</button>
      {plans && count > 0 ? <button className="btn primary" onClick={() => { applyAutoCut(plans); useStore.getState().notify('success', `${count} passages retirés (−${fmtDur(total)})`); onClose(); }}>Couper {count} passage{count > 1 ? 's' : ''}</button>
        : <button className="btn primary" disabled={!!busy || !ids.length} onClick={analyse}>Analyser</button>}
    </>}>
      <div className="chips" role="radiogroup" aria-label="Portée">
        <button role="radio" aria-checked={scope === 'selection'} className={'chip' + (scope === 'selection' ? ' on' : '')} disabled={!selected.length} onClick={() => { setScope('selection'); setPlans(null); }}>Clips sélectionnés ({selected.length})</button>
        <button role="radio" aria-checked={scope === 'main'} className={'chip' + (scope === 'main' ? ' on' : '')} onClick={() => { setScope('main'); setPlans(null); }}>Toute la piste principale</button>
      </div>
      <Switch label="Seuil de silence automatique (recommandé)" checked={auto} onChange={v => { setAuto(v); setPlans(null); }} />
      {!auto && <SliderRow label="Seuil" min={-70} max={-15} unit=" dB" value={thr} defaultValue={-38} onChange={v => { setThr(v); setPlans(null); }} />}
      <SliderRow label="Blanc minimum" min={0.2} max={3} step={0.05} unit=" s" value={minS} defaultValue={0.5} onChange={v => { setMinS(v); setPlans(null); }} />
      <SliderRow label="Marge gardée" min={0} max={0.5} step={0.01} unit=" s" value={pad} defaultValue={0.12} onChange={v => { setPad(v); setPlans(null); }} />
      <Switch label="Retirer aussi les « euh » et mots répétés (Whisper, expérimental)" checked={fillers} onChange={v => { setFillers(v); setPlans(null); }} />
      {busy && <ProgressView p={busy} />}
      {plans && <div className="row" style={{ gap: 8 }}><b>{count}</b> passage{count > 1 ? 's' : ''} à retirer · <b>−{fmtDur(total)}</b> <span className="muted">({(total / 1e6).toFixed(1)} s)</span></div>}
      {plans && count === 0 && <div className="muted">Aucun blanc trouvé avec ces réglages.</div>}
      {error && <div role="alert" style={{ color: 'var(--c-danger)' }}>{error}</div>}
      <div className="hint">Rien n’est coupé avant que tu cliques sur « Couper ». Tout reste annulable (⌘Z).</div>
    </Modal>
  );
}
