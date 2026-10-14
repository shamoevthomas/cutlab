import { useState } from 'react';
import { FlipHorizontal, FlipVertical, AlignLeft, AlignCenter, AlignRight, Bold, Italic } from 'lucide-react';
import { useStore } from '../store';
import * as op from '../model/ops';
import type { AnimPreset, AnimProp, BlendMode, Clip, ClipEffect, Project } from '../model/schema';
import { uid, RATIOS } from '../model/schema';
import { SliderRow, Switch } from './common';
import { FILTERS, neutralAdjust } from '../engine/scene';
import { bridge } from '../bridge';

type Tab = 'basic' | 'text' | 'anim' | 'speed' | 'audio' | 'adjust' | 'chroma';

export function Inspector() {
  const project = useStore(s => s.project)!;
  const selection = useStore(s => s.selection);
  const refs = selection.map(id => op.findClip(project, id)).filter(Boolean) as op.ClipRef[];
  return (
    <section className="panel" aria-label="Inspecteur">
      {refs.length === 0 ? <ProjectDetails project={project} /> : refs.length === 1 ? <ClipInspector key={refs[0].clip.id} refItem={refs[0]} /> : <MultiInspector refs={refs} />}
    </section>
  );
}

function ProjectDetails({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  if (bridge.projectFolder && folder === null) bridge.projectFolder(project.id).then(setFolder);
  const ratio = Object.entries(RATIOS).find(([, [w, h]]) => w === project.canvas.width && h === project.canvas.height)?.[0] ?? `${project.canvas.width}×${project.canvas.height}`;
  return (
    <>
      <div className="preview-head" style={{ color: 'var(--c-accent)', fontWeight: 600 }}>Détails du projet</div>
      <div className="insp-body">
        <dl className="kv">
          <dt>Nom</dt><dd>{project.name}</dd>
          <dt>Emplacement</dt><dd>{folder ?? (bridge.kind === 'web' ? 'Navigateur (IndexedDB)' : '…')}</dd>
          <dt>Format</dt><dd>{ratio} · {project.canvas.width}×{project.canvas.height}</dd>
          <dt>Images / seconde</dt><dd>{project.fps} i/s</dd>
          <dt>Espace couleur</dt><dd>Rec. 709 SDR</dd>
          <dt>Médias importés</dt><dd>{bridge.kind === 'electron' ? 'Conservés à leur emplacement d’origine' : 'Copiés dans le navigateur'}</dd>
          <dt>Proxy</dt><dd>Désactivé (phase 2)</dd>
          <dt>Médias</dt><dd>{project.assets.length}</dd>
          <dt>Pistes</dt><dd>{project.tracks.length}</dd>
        </dl>
        {!editing ? <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setEditing(true)}>Modifier</button> : <ProjectSettingsForm project={project} onDone={() => setEditing(false)} />}
      </div>
    </>
  );
}

function ProjectSettingsForm({ project, onDone }: { project: Project; onDone: () => void }) {
  const [ratio, setRatio] = useState(Object.entries(RATIOS).find(([, [w, h]]) => w === project.canvas.width && h === project.canvas.height)?.[0] ?? '16:9');
  const [fps, setFps] = useState(project.fps);
  const [bg, setBg] = useState(project.canvas.background);
  const save = () => {
    useStore.getState().edit(p => {
      const [w, h] = RATIOS[ratio];
      p.canvas.width = w; p.canvas.height = h; p.fps = fps; p.canvas.background = bg;
    });
    onDone();
  };
  return (
    <div className="insp-section">
      <label className="field"><span>Format</span>
        <select className="input" value={ratio} onChange={e => setRatio(e.target.value)}>{Object.keys(RATIOS).map(r => <option key={r}>{r}</option>)}</select>
      </label>
      <label className="field"><span>Images par seconde</span>
        <select className="input" value={fps} onChange={e => setFps(Number(e.target.value))}>{[24, 25, 30, 50, 60].map(f => <option key={f} value={f}>{f}</option>)}</select>
      </label>
      <label className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Fond</span><input type="color" value={bg} onChange={e => setBg(e.target.value)} /></label>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" onClick={onDone}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button></div>
    </div>
  );
}

function MultiInspector({ refs }: { refs: op.ClipRef[] }) {
  const texts = refs.filter(r => r.clip.text);
  return (
    <>
      <div className="preview-head">{refs.length} clips sélectionnés</div>
      <div className="insp-body">
        {texts.length > 0 && <TextStyleEditor clipIds={texts.map(r => r.clip.id)} clip={texts[0].clip} />}
        {texts.length === 0 && <div className="hint">Sélectionne un seul clip pour voir toutes ses options. Avec plusieurs textes sélectionnés, tu peux changer leur style d’un coup.</div>}
      </div>
    </>
  );
}

function ClipInspector({ refItem }: { refItem: op.ClipRef }) {
  const { clip, track } = refItem;
  const project = useStore(s => s.project)!;
  const asset = project.assets.find(a => a.id === clip.assetId);
  const isText = !!clip.text;
  const isAudio = track.kind === 'audio';
  const isVideo = asset?.kind === 'video';
  const tabs: [Tab, string][] = [];
  if (isText) tabs.push(['text', 'Texte']);
  if (!isAudio) tabs.push(['basic', isText ? 'Position' : 'Vidéo']);
  if (!isAudio) tabs.push(['anim', 'Animation']);
  if (isVideo || isAudio) tabs.push(['audio', 'Audio']);
  if (isVideo || isAudio) tabs.push(['speed', 'Vitesse']);
  if (!isAudio && !isText) tabs.push(['adjust', 'Réglages']);
  if (isVideo || asset?.kind === 'image') tabs.push(['chroma', 'Détourage']);
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const cur = tabs.some(t => t[0] === tab) ? tab : tabs[0][0];
  return (
    <>
      <div className="insp-tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={cur === id} className="insp-tab" onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="insp-body" role="tabpanel">
        {cur === 'text' && <TextEditor clip={clip} />}
        {cur === 'basic' && <BasicTab clip={clip} />}
        {cur === 'anim' && <AnimTab clip={clip} />}
        {cur === 'audio' && <AudioTab clip={clip} />}
        {cur === 'speed' && <SpeedTab clip={clip} />}
        {cur === 'adjust' && <AdjustTab clip={clip} />}
        {cur === 'chroma' && <ChromaTab clip={clip} />}
      </div>
    </>
  );
}

// ---------- helpers ----------

const st = useStore.getState;
const editClip = (id: string, fn: (c: Clip) => void, coalesce?: string) =>
  st().edit(p => { const r = op.findClip(p, id); if (r) fn(r.clip); }, { coalesce });

function useRel(clip: Clip) {
  const t = useStore(s => s.playheadUs);
  const rel = Math.min(Math.max(t - clip.startUs, 0), clip.durationUs);
  const inside = t >= clip.startUs && t <= op.clipEnd(clip);
  return { rel, inside };
}

function PropSlider({ clip, prop, label, min, max, step = 1, unit, scale = 1, def }: { clip: Clip; prop: AnimProp; label: string; min: number; max: number; step?: number; unit?: string; scale?: number; def: number }) {
  const { rel, inside } = useRel(clip);
  const value = op.valueAt(clip, prop, rel) * scale;
  const has = clip.keyframes.some(k => k.property === prop);
  const on = !!op.keyframeAt(clip, prop, rel);
  return (
    <SliderRow label={label} min={min} max={max} step={step} unit={unit} value={value} defaultValue={def * scale}
      onChange={v => editClip(clip.id, c => op.setProp(c, prop, rel, v / scale), `${clip.id}:${prop}`)}
      keyframe={{ has, on, toggle: () => { if (!inside) { st().notify('info', 'Place la tête de lecture sur le clip pour poser une image clé'); return; } editClip(clip.id, c => op.toggleKeyframe(c, prop, rel)); } }} />
  );
}

// ---------- tabs ----------

function BasicTab({ clip }: { clip: Clip }) {
  return (
    <>
      <div className="insp-section">
        <h5>Transformation</h5>
        <PropSlider clip={clip} prop="scale" label="Échelle" min={1} max={400} unit="%" scale={100} def={1} />
        <PropSlider clip={clip} prop="x" label="Position X" min={-200} max={200} unit="" scale={100} def={0} />
        <PropSlider clip={clip} prop="y" label="Position Y" min={-200} max={200} unit="" scale={100} def={0} />
        <PropSlider clip={clip} prop="rotation" label="Rotation" min={-360} max={360} unit="°" def={0} />
        <div className="row">
          <button className="btn sm" aria-pressed={clip.transform.flipH} onClick={() => editClip(clip.id, c => { c.transform.flipH = !c.transform.flipH; })}><FlipHorizontal size={13} /> Miroir</button>
          <button className="btn sm" aria-pressed={clip.transform.flipV} onClick={() => editClip(clip.id, c => { c.transform.flipV = !c.transform.flipV; })}><FlipVertical size={13} /> Retourner</button>
          <button className="btn sm ghost" onClick={() => editClip(clip.id, c => { c.transform = { ...c.transform, x: 0, y: 0, scale: 1, rotation: 0 }; c.keyframes = c.keyframes.filter(k => !['x', 'y', 'scale', 'rotation'].includes(k.property)); })}>Réinitialiser</button>
        </div>
      </div>
      <div className="insp-section">
        <h5>Fusion</h5>
        <PropSlider clip={clip} prop="opacity" label="Opacité" min={0} max={100} unit="%" scale={100} def={1} />
        <label className="field"><span>Mode de fusion</span>
          <select className="input" value={clip.blend} onChange={e => editClip(clip.id, c => { c.blend = e.target.value as BlendMode; })}>
            {([['normal', 'Normal'], ['multiply', 'Produit'], ['screen', 'Superposition claire'], ['add', 'Ajout'], ['darken', 'Assombrir'], ['lighten', 'Éclaircir']] as const).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="hint">◆ pose une image clé à la tête de lecture : la valeur s’anime entre deux images clés.</div>
    </>
  );
}

const ANIMS: [AnimPreset, string][] = [['none', 'Aucune'], ['fade', 'Fondu'], ['zoom', 'Zoom'], ['pop', 'Pop'], ['slideUp', 'Monte'], ['slideLeft', 'Glisse'], ['typewriter', 'Machine à écrire']];

function AnimTab({ clip }: { clip: Clip }) {
  const list = ANIMS.filter(([a]) => a !== 'typewriter' || clip.text);
  return (
    <>
      <div className="insp-section"><h5>Entrée</h5>
        <div className="chips">{list.map(([a, l]) => <button key={a} className={'chip' + (clip.animIn === a ? ' on' : '')} onClick={() => editClip(clip.id, c => { c.animIn = a; })}>{l}</button>)}</div>
      </div>
      <div className="insp-section"><h5>Sortie</h5>
        <div className="chips">{list.filter(([a]) => a !== 'typewriter').map(([a, l]) => <button key={a} className={'chip' + (clip.animOut === a ? ' on' : '')} onClick={() => editClip(clip.id, c => { c.animOut = a; })}>{l}</button>)}</div>
      </div>
      <SliderRow label="Durée" min={0.1} max={3} step={0.1} unit=" s" value={clip.animDurUs / 1e6} defaultValue={0.5} onChange={v => editClip(clip.id, c => { c.animDurUs = Math.round(v * 1e6); }, clip.id + ':anim')} />
    </>
  );
}

function AudioTab({ clip }: { clip: Clip }) {
  return (
    <>
      <div className="insp-section"><h5>Volume</h5>
        <PropSlider clip={clip} prop="volumeDb" label="Volume" min={-60} max={20} step={0.5} unit=" dB" def={0} />
        <SliderRow label="Fondu entrée" min={0} max={Math.min(10, clip.durationUs / 2e6)} step={0.1} unit=" s" value={clip.fadeInUs / 1e6} defaultValue={0} onChange={v => editClip(clip.id, c => { c.fadeInUs = Math.round(v * 1e6); }, clip.id + ':fi')} />
        <SliderRow label="Fondu sortie" min={0} max={Math.min(10, clip.durationUs / 2e6)} step={0.1} unit=" s" value={clip.fadeOutUs / 1e6} defaultValue={0} onChange={v => editClip(clip.id, c => { c.fadeOutUs = Math.round(v * 1e6); }, clip.id + ':fo')} />
      </div>
      <div className="insp-section"><h5>Nettoyage <span className="badge">phase 3</span></h5>
        <div className="hint">Normaliser le volume (−14 LUFS), réduire le bruit, améliorer la voix, isoler la voix : traitements locaux prévus en phase 3.</div>
      </div>
    </>
  );
}

function SpeedTab({ clip }: { clip: Clip }) {
  const presets = [0.25, 0.5, 1, 1.5, 2, 3, 5];
  return (
    <>
      <div className="insp-section"><h5>Vitesse</h5>
        <SliderRow label="Vitesse" min={0.1} max={10} step={0.05} unit="x" value={clip.speed} defaultValue={1}
          onChange={v => st().edit(p => op.setSpeed(p, clip.id, v), { coalesce: clip.id + ':speed' })} />
        <div className="chips">{presets.map(s => <button key={s} className={'chip' + (Math.abs(clip.speed - s) < 1e-6 ? ' on' : '')} onClick={() => st().edit(p => op.setSpeed(p, clip.id, s))}>{s}x</button>)}</div>
        <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Durée : {(clip.durationUs / 1e6).toFixed(2)} s · la hauteur de la voix est conservée à l’aperçu.</div>
      </div>
      <Switch label="Lire à l’envers" checked={clip.reverse} onChange={v => editClip(clip.id, c => { c.reverse = v; })} />
      <div className="insp-section"><h5>Courbes de vitesse <span className="badge">phase 2</span></h5></div>
    </>
  );
}

function effect(clip: Clip, kind: ClipEffect['kind']) { return clip.effects.find(e => e.kind === kind); }

function setEffectParam(clipId: string, kind: ClipEffect['kind'], key: string, v: number | string | boolean, defaults: Record<string, any> = {}) {
  editClip(clipId, c => {
    let e = c.effects.find(x => x.kind === kind);
    if (!e) { e = { id: uid(), kind, enabled: true, params: { ...defaults } }; c.effects.push(e); }
    e.params[key] = v;
  }, `${clipId}:${kind}:${key}`);
}

const ADJ: [keyof ReturnType<typeof neutralAdjust>, string][] = [
  ['brightness', 'Luminosité'], ['contrast', 'Contraste'], ['saturation', 'Saturation'], ['exposure', 'Exposition'],
  ['temperature', 'Température'], ['tint', 'Teinte'], ['highlights', 'Hautes lum.'], ['shadows', 'Ombres'], ['vignette', 'Vignette'],
];

function AdjustTab({ clip }: { clip: Clip }) {
  const adj = effect(clip, 'adjust');
  const filt = effect(clip, 'filter');
  return (
    <>
      {filt && (
        <div className="insp-section"><h5>Filtre : {FILTERS[String(filt.params.preset)]?.label}
          <button className="btn sm ghost" onClick={() => editClip(clip.id, c => { c.effects = c.effects.filter(e => e.kind !== 'filter'); })}>Retirer</button></h5>
          <SliderRow label="Intensité" min={0} max={100} unit="%" value={Number(filt.params.intensity ?? 100)} defaultValue={100} onChange={v => setEffectParam(clip.id, 'filter', 'intensity', v)} />
        </div>
      )}
      <div className="insp-section"><h5>Réglages de base
        <button className="btn sm ghost" disabled={!adj} onClick={() => editClip(clip.id, c => { c.effects = c.effects.filter(e => e.kind !== 'adjust'); })}>Réinitialiser</button></h5>
        {ADJ.map(([k, l]) => (
          <SliderRow key={k} label={l} min={k === 'vignette' ? 0 : -100} max={100} value={Number(adj?.params[k] ?? 0)} defaultValue={0} onChange={v => setEffectParam(clip.id, 'adjust', k, v)} />
        ))}
      </div>
      <button className="btn sm" onClick={() => {
        const src = clip.effects.filter(e => e.kind === 'adjust' || e.kind === 'filter');
        st().edit(p => { for (const t of p.tracks) for (const c of t.clips) if (c.id !== clip.id && !c.text && t.kind !== 'audio') { c.effects = [...c.effects.filter(e => e.kind !== 'adjust' && e.kind !== 'filter'), ...src.map(e => ({ ...e, id: uid(), params: { ...e.params } }))]; } });
        st().notify('success', 'Réglages appliqués à tous les clips');
      }}>Appliquer à tous les clips</button>
      <div className="insp-section"><h5>Couleur avancée <span className="badge">phase 3</span></h5><div className="hint">TSL, courbes, roues chromatiques et LUT .cube.</div></div>
    </>
  );
}

function ChromaTab({ clip }: { clip: Clip }) {
  const e = effect(clip, 'chroma');
  const on = !!e?.enabled;
  return (
    <>
      <div className="insp-section"><h5>Incrustation (fond vert)</h5>
        <Switch label="Activer" checked={on} onChange={v => editClip(clip.id, c => {
          let x = c.effects.find(y => y.kind === 'chroma');
          if (!x) { x = { id: uid(), kind: 'chroma', enabled: v, params: { color: '#00ff00', intensity: 40, shadow: 20 } }; c.effects.push(x); }
          x.enabled = v;
        })} />
        {on && <>
          <label className="row" style={{ justifyContent: 'space-between' }}><span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Couleur à retirer</span>
            <input type="color" value={String(e!.params.color)} onChange={ev => setEffectParam(clip.id, 'chroma', 'color', ev.target.value)} aria-label="Couleur à retirer" /></label>
          <SliderRow label="Intensité" min={0} max={100} value={Number(e!.params.intensity)} defaultValue={40} onChange={v => setEffectParam(clip.id, 'chroma', 'intensity', v)} />
          <SliderRow label="Adoucir" min={0} max={100} value={Number(e!.params.shadow)} defaultValue={20} onChange={v => setEffectParam(clip.id, 'chroma', 'shadow', v)} />
        </>}
      </div>
      <div className="insp-section"><h5>Suppression du fond par IA <span className="badge">phase 3</span></h5>
        <div className="hint">Détourage automatique sans fond vert (modèle local sur ton Mac).</div>
      </div>
    </>
  );
}

function TextEditor({ clip }: { clip: Clip }) {
  return (
    <>
      <div className="insp-section"><h5>Contenu</h5>
        <textarea className="input" rows={3} value={clip.text!.content} aria-label="Texte"
          onChange={e => editClip(clip.id, c => { c.text!.content = e.target.value; c.label = e.target.value; }, clip.id + ':content')} />
      </div>
      <TextStyleEditor clipIds={[clip.id]} clip={clip} />
    </>
  );
}

const FONTS = ['Inter', 'Poppins', 'Montserrat', 'Bebas Neue', 'Anton', 'Oswald', 'Playfair Display', 'Roboto Mono', 'Georgia', 'Arial'];

function TextStyleEditor({ clipIds, clip }: { clipIds: string[]; clip: Clip }) {
  const s = clip.text!.style;
  const set = (patch: Partial<typeof s>, key: string) => st().edit(p => {
    for (const id of clipIds) { const r = op.findClip(p, id); if (r?.clip.text) Object.assign(r.clip.text.style, patch); }
  }, { coalesce: clipIds.join() + ':' + key });
  return (
    <>
      <div className="insp-section"><h5>Police</h5>
        <select className="input" value={s.font} onChange={e => set({ font: e.target.value }, 'font')} aria-label="Police">
          {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
        </select>
        <SliderRow label="Taille" min={10} max={300} value={s.size} defaultValue={72} onChange={v => set({ size: v }, 'size')} />
        <div className="row">
          <label className="row"><input type="color" value={s.color} onChange={e => set({ color: e.target.value }, 'color')} aria-label="Couleur du texte" /><span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Couleur</span></label>
          <span className="grow" />
          <button className="icon-btn" aria-pressed={s.bold} title="Gras" aria-label="Gras" onClick={() => set({ bold: !s.bold }, 'b')}><Bold size={14} /></button>
          <button className="icon-btn" aria-pressed={s.italic} title="Italique" aria-label="Italique" onClick={() => set({ italic: !s.italic }, 'i')}><Italic size={14} /></button>
          <button className="icon-btn" aria-pressed={s.align === 'left'} aria-label="Aligner à gauche" onClick={() => set({ align: 'left' }, 'a')}><AlignLeft size={14} /></button>
          <button className="icon-btn" aria-pressed={s.align === 'center'} aria-label="Centrer" onClick={() => set({ align: 'center' }, 'a')}><AlignCenter size={14} /></button>
          <button className="icon-btn" aria-pressed={s.align === 'right'} aria-label="Aligner à droite" onClick={() => set({ align: 'right' }, 'a')}><AlignRight size={14} /></button>
        </div>
      </div>
      <div className="insp-section"><h5>Contour</h5>
        <div className="row"><input type="color" value={s.strokeColor} onChange={e => set({ strokeColor: e.target.value }, 'sc')} aria-label="Couleur du contour" />
          <div className="grow"><SliderRow label="Épaisseur" min={0} max={20} value={s.strokeWidth} defaultValue={0} onChange={v => set({ strokeWidth: v }, 'sw')} /></div></div>
      </div>
      <div className="insp-section"><h5>Arrière-plan</h5>
        <div className="row"><input type="color" value={s.bgColor} onChange={e => set({ bgColor: e.target.value }, 'bc')} aria-label="Couleur de l’arrière-plan" />
          <div className="grow"><SliderRow label="Opacité" min={0} max={100} unit="%" value={s.bgOpacity} defaultValue={0} onChange={v => set({ bgOpacity: v }, 'bo')} /></div></div>
      </div>
      <Switch label="Ombre portée" checked={s.shadow} onChange={v => set({ shadow: v }, 'sh')} />
    </>
  );
}
