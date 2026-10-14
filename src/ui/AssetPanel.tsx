import { useMemo, useState } from 'react';
import { Blend, Captions, Clapperboard, Film, Image as ImageIcon, Music, Plus, Search, Sliders, Sparkles, Sticker, Type, Upload, Wand2, AlertTriangle, Trash2 } from 'lucide-react';
import { useStore, Panel } from '../store';
import { addAssetAtPlayhead, addText, exportSubtitles, importFiles, importSubtitles, pickAndImport, relinkAsset } from '../actions';
import { pickedFromDrop } from './dropFiles';
import { fmtDur } from './common';
import { FILTERS, TRANSITIONS } from '../engine/scene';
import * as op from '../model/ops';
import { defaultTextStyle, uid, TextStyle } from '../model/schema';
import { makeSticker, STICKERS } from '../engine/stickers';
import { AutoCaptionsPanel } from './AutoTools';

const TABS: { id: Panel; label: string; icon: any }[] = [
  { id: 'media', label: 'Médias', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'text', label: 'Texte', icon: Type },
  { id: 'stickers', label: 'Stickers', icon: Sticker },
  { id: 'effects', label: 'Effets', icon: Sparkles },
  { id: 'transitions', label: 'Transitions', icon: Blend },
  { id: 'captions', label: 'Sous-titres', icon: Captions },
  { id: 'filters', label: 'Filtres', icon: Wand2 },
  { id: 'adjust', label: 'Réglages', icon: Sliders },
];

export function AssetPanel() {
  const panel = useStore(s => s.panel);
  return (
    <section className="panel" aria-label="Ressources">
      <div className="asset-tabs" role="tablist" aria-label="Catégories">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={panel === t.id} className="asset-tab" onClick={() => useStore.getState().set('panel', t.id)}>
            <t.icon size={17} />{t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ display: 'contents' }}>
        {panel === 'media' && <MediaTab kind="visual" />}
        {panel === 'audio' && <MediaTab kind="audio" />}
        {panel === 'text' && <TextTab />}
        {panel === 'stickers' && <StickerTab />}
        {panel === 'effects' && <Soon icon={Sparkles} title="Effets vidéo" text="Les effets (glitch, flou, zoom, secousse…) arrivent en phase 2. Les filtres et réglages couleur sont déjà disponibles." />}
        {panel === 'transitions' && <TransitionTab />}
        {panel === 'captions' && <CaptionTab />}
        {panel === 'filters' && <FilterTab />}
        {panel === 'adjust' && <Soon icon={Sliders} title="Calques de réglage" text="Les calques de réglage et les LUT arrivent en phase 2. En attendant, sélectionne un clip et ouvre l’onglet Réglages de l’inspecteur." />}
      </div>
    </section>
  );
}

function Soon({ icon: Icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <div className="asset-content" style={{ justifyContent: 'center' }}>
      <div className="empty"><Icon size={24} /><b>{title}</b><div style={{ fontSize: 'var(--fs-sm)' }}>{text}</div></div>
    </div>
  );
}

function MediaTab({ kind }: { kind: 'visual' | 'audio' }) {
  const project = useStore(s => s.project)!;
  const [q, setQ] = useState('');
  const [over, setOver] = useState(false);
  const [sub, setSub] = useState<'all' | 'video' | 'image'>('all');
  const used = useMemo(() => new Set(project.tracks.flatMap(t => t.clips.map(c => c.assetId))), [project.tracks]);
  const assets = project.assets.filter(a => !a.derived).filter(a => (kind === 'audio' ? a.kind === 'audio' : a.kind === 'video' || a.kind === 'image'))
    .filter(a => sub === 'all' || a.kind === sub)
    .filter(a => a.name.toLowerCase().includes(q.toLowerCase()));

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    if (e.dataTransfer.files.length) await importFiles(await pickedFromDrop(e.dataTransfer.files));
  };
  const removeAsset = (id: string) => {
    if (used.has(id)) { useStore.getState().notify('error', 'Ce média est utilisé dans la timeline'); return; }
    useStore.getState().edit(p => { p.assets = p.assets.filter(a => a.id !== id); });
  };

  return (
    <div className="asset-body">
      <nav className="subnav" aria-label="Filtrer">
        <button className="on" onClick={() => pickAndImport()}><Upload size={12} /> Importer</button>
        {kind === 'visual' && <>
          <button className={sub === 'all' ? 'on' : ''} onClick={() => setSub('all')}>Tout</button>
          <button className={sub === 'video' ? 'on' : ''} onClick={() => setSub('video')}>Vidéos</button>
          <button className={sub === 'image' ? 'on' : ''} onClick={() => setSub('image')}>Images</button>
        </>}
        {kind === 'audio' && <>
          <button className="on">Mes sons</button>
          <button onClick={() => useStore.getState().notify('info', 'Bibliothèque libre de droits : à brancher avec ta clé Pixabay/Freesound (phase 2)')}>Musique libre</button>
        </>}
      </nav>
      <div className="asset-content" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <div className="row">
          <button className="btn sm" onClick={() => pickAndImport()}><Plus size={13} /> Importer</button>
          <div className="row grow" style={{ position: 'relative' }}>
            <Search size={12} className="faint" style={{ position: 'absolute', left: 7 }} />
            <input className="input grow" style={{ height: 24, paddingLeft: 22 }} placeholder="Rechercher" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un média" />
          </div>
        </div>
        {assets.length === 0 ? (
          <div className={'dropzone' + (over ? ' over' : '')}>
            {kind === 'audio' ? <Music size={22} /> : <Clapperboard size={22} />}
            <div>{q ? 'Aucun résultat' : kind === 'audio' ? 'Glisse ici tes musiques et voix off' : 'Glisse ici tes vidéos et images'}</div>
            {!q && <button className="btn sm primary" onClick={() => pickAndImport()}>Importer</button>}
          </div>
        ) : kind === 'audio' ? (
          <div className="col" style={{ gap: 6 }}>
            {assets.map(a => (
              <div key={a.id} className="list-row" draggable onDragStart={e => e.dataTransfer.setData('application/x-cutlab-asset', a.id)}>
                <Music size={16} className="muted" />
                <div className="grow"><div className="ellipsis">{a.name}</div><div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{fmtDur(a.durationUs ?? 0)}{used.has(a.id) ? ' · ajouté' : ''}</div></div>
                <button className="icon-btn" aria-label={`Supprimer ${a.name}`} title="Retirer du projet" onClick={() => removeAsset(a.id)}><Trash2 size={13} /></button>
                <button className="icon-btn" aria-label={`Ajouter ${a.name}`} title="Ajouter à la tête de lecture" onClick={() => addAssetAtPlayhead(a.id)}><Plus size={14} /></button>
              </div>
            ))}
          </div>
        ) : (
          <div className="asset-grid">
            {assets.map(a => (
              <div key={a.id}>
                <div className={'asset-tile' + (!a.url ? ' missing' : '')} style={a.url && a.thumb ? { backgroundImage: `url(${a.thumb})` } : undefined}
                  draggable={!!a.url} onDragStart={e => e.dataTransfer.setData('application/x-cutlab-asset', a.id)}
                  onDoubleClick={() => a.url && addAssetAtPlayhead(a.id)} title={a.name}>
                  {!a.url ? <span><AlertTriangle size={14} /><br />Fichier introuvable<br /><button className="btn sm" style={{ marginTop: 4 }} onClick={() => relinkAsset(a.id)}>Reconnecter</button></span> : !a.thumb && (a.kind === 'image' ? <ImageIcon size={18} /> : <Film size={18} />)}
                  {used.has(a.id) && <span className="used">Ajouté</span>}
                  {a.kind === 'video' && <span className="dur mono">{fmtDur(a.durationUs ?? 0)}</span>}
                  {a.url && <button className="add" aria-label={`Ajouter ${a.name}`} title="Ajouter à la tête de lecture" onClick={() => addAssetAtPlayhead(a.id)}><Plus size={14} /></button>}
                </div>
                <div className="asset-name ellipsis">{a.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TEXT_PRESETS: { label: string; style: Partial<TextStyle>; content: string }[] = [
  { label: 'Texte simple', content: 'Texte', style: {} },
  { label: 'Titre', content: 'TITRE', style: { size: 120, bold: true } },
  { label: 'Contour', content: 'Contour', style: { strokeWidth: 6, strokeColor: '#000000', shadow: false } },
  { label: 'Bandeau', content: 'Bandeau', style: { bgOpacity: 85, bgColor: '#000000', size: 60, shadow: false } },
  { label: 'Fluo', content: 'Fluo', style: { color: '#3ee08f', strokeWidth: 5, strokeColor: '#06120b', shadow: false } },
  { label: 'Jaune', content: 'Jaune', style: { color: '#ffd23f', strokeWidth: 5, strokeColor: '#000000', shadow: false } },
  { label: 'Étiquette', content: 'Étiquette', style: { color: '#06120b', bgColor: '#ffffff', bgOpacity: 100, size: 56, shadow: false } },
  { label: 'Discret', content: 'Discret', style: { size: 44, bold: false, color: '#e6e6e6' } },
];

function TextTab() {
  return (
    <div className="asset-body">
      <nav className="subnav"><button className="on">Ajouter du texte</button></nav>
      <div className="asset-content">
        <div className="asset-grid">
          {TEXT_PRESETS.map(p => {
            const s = { ...defaultTextStyle(), ...p.style };
            return (
              <button key={p.label} className="preset" onClick={() => addText(p.content, p.style)} title={`Ajouter « ${p.label} »`} aria-label={`Ajouter le texte ${p.label}`}
                draggable onDragStart={e => e.dataTransfer.setData('text/plain', p.content)}>
                <span style={{ color: s.color, fontWeight: s.bold ? 700 : 400, WebkitTextStroke: s.strokeWidth ? `1px ${s.strokeColor}` : undefined, background: s.bgOpacity ? s.bgColor : undefined, padding: s.bgOpacity ? '2px 6px' : 0, borderRadius: 4 }}>{p.label}</span>
              </button>
            );
          })}
        </div>
        <div className="hint">Clique pour ajouter le texte à la tête de lecture, puis modifie-le dans l’inspecteur à droite.</div>
      </div>
    </div>
  );
}

function StickerTab() {
  const add = async (id: string) => {
    const s = useStore.getState();
    const asset = await makeSticker(id);
    let clipId = '';
    s.edit(p => {
      if (!p.assets.some(a => a.id === asset.id)) p.assets.push(asset);
      const c = op.addAssetClip(p, asset, s.playheadUs, { magnet: true });
      clipId = c.id;
    });
    s.select([clipId]);
  };
  return (
    <div className="asset-body">
      <nav className="subnav"><button className="on">Formes</button></nav>
      <div className="asset-content">
        <div className="asset-grid">
          {STICKERS.map(s => (
            <button key={s.id} className="preset" onClick={() => add(s.id)} title={s.label} aria-label={`Ajouter ${s.label}`}>
              <span dangerouslySetInnerHTML={{ __html: s.svg(48) }} />
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{s.label}</span>
            </button>
          ))}
        </div>
        <div className="hint">Formes dessinées par CutLab. Tes propres PNG transparents s’importent dans Médias.</div>
      </div>
    </div>
  );
}

function selectedVisualClips() {
  const s = useStore.getState();
  const p = s.project!;
  return s.selection.map(id => op.findClip(p, id)).filter(r => r && r.track.kind !== 'audio') as op.ClipRef[];
}

function TransitionTab() {
  const project = useStore(s => s.project)!;
  const selection = useStore(s => s.selection);
  const [dur, setDur] = useState(0.5);
  const ref = selection.length === 1 ? op.findClip(project, selection[0]) : null;
  const next = ref ? ref.track.clips[ref.index + 1] : undefined;
  const adjacent = ref && next && Math.abs(op.clipEnd(ref.clip) - next.startUs) < 1000;
  const current = ref && project.transitions.find(t => t.fromClipId === ref.clip.id);
  const apply = (kind: any, all = false) => {
    useStore.getState().edit(p => {
      const pairs: [string, string][] = [];
      for (const t of p.tracks) for (let i = 0; i < t.clips.length - 1; i++) {
        const a = t.clips[i], b = t.clips[i + 1];
        if (Math.abs(op.clipEnd(a) - b.startUs) > 1000) continue;
        if (all ? t.isMain : a.id === ref!.clip.id) pairs.push([a.id, b.id]);
      }
      for (const [from, to] of pairs) {
        const a = op.findClip(p, from)!.clip, b = op.findClip(p, to)!.clip;
        const d = Math.min(dur * 1e6, a.durationUs / 2, b.durationUs / 2);
        p.transitions = p.transitions.filter(x => x.fromClipId !== from);
        p.transitions.push({ id: uid(), fromClipId: from, toClipId: to, kind, durationUs: Math.round(d) });
      }
    });
  };
  return (
    <div className="asset-body">
      <nav className="subnav"><button className="on">Transitions</button></nav>
      <div className="asset-content">
        {!adjacent && <div className="hint">Sélectionne le clip <b>avant</b> la coupe : la transition se place entre lui et le clip suivant.</div>}
        <div className="asset-grid">
          {TRANSITIONS.map(t => (
            <button key={t.kind} className={'preset' + (current?.kind === t.kind ? ' on' : '')} disabled={!adjacent} onClick={() => apply(t.kind)} style={{ opacity: adjacent ? 1 : .5 }}>
              <Blend size={20} /> {t.label}
            </button>
          ))}
        </div>
        <label className="field"><span>Durée : {dur.toFixed(1)} s</span>
          <input type="range" min={0.1} max={2} step={0.1} value={dur} onChange={e => setDur(Number(e.target.value))} />
        </label>
        <div className="row">
          <button className="btn sm" disabled={!current} onClick={() => apply(current!.kind, true)}>Appliquer à toutes les coupes</button>
          {current && <button className="btn sm ghost" onClick={() => useStore.getState().edit(p => { p.transitions = p.transitions.filter(x => x.id !== current.id); })}>Retirer</button>}
        </div>
      </div>
    </div>
  );
}

function FilterTab() {
  useStore(s => s.selection); useStore(s => s.project);
  const refs = selectedVisualClips();
  const current = refs[0]?.clip.effects.find(e => e.kind === 'filter');
  const apply = (preset: string | null) => {
    if (!refs.length) { useStore.getState().notify('info', 'Sélectionne d’abord un clip dans la timeline'); return; }
    useStore.getState().edit(p => {
      for (const r of refs) {
        const c = op.findClip(p, r.clip.id)!.clip;
        c.effects = c.effects.filter(e => e.kind !== 'filter');
        if (preset) c.effects.push({ id: uid(), kind: 'filter', enabled: true, params: { preset, intensity: 100 } });
      }
    });
  };
  return (
    <div className="asset-body">
      <nav className="subnav"><button className="on">Filtres</button></nav>
      <div className="asset-content">
        <div className="asset-grid">
          <button className={'preset' + (!current ? ' on' : '')} onClick={() => apply(null)}>Aucun</button>
          {Object.entries(FILTERS).map(([id, f]) => (
            <button key={id} className={'preset' + (current?.params.preset === id ? ' on' : '')} onClick={() => apply(id)}>
              <span style={{ width: 44, height: 28, borderRadius: 4, ...filterSwatch(f) }} />{f.label}
            </button>
          ))}
        </div>
        <div className="hint">{refs.length ? `S’applique à ${refs.length > 1 ? `${refs.length} clips` : 'au clip sélectionné'}. Intensité réglable dans l’inspecteur.` : 'Sélectionne un clip pour appliquer un filtre.'}</div>
      </div>
    </div>
  );
}

function filterSwatch(f: any): React.CSSProperties {
  const sat = 1 + (f.saturation ?? 0) / 100, br = 1 + (f.brightness ?? 0) / 100, ct = 1 + (f.contrast ?? 0) / 100;
  const t = f.temperature ?? 0;
  const warm = t > 0 ? ` sepia(${Math.min(1, t / 80)})` : t < 0 ? ` hue-rotate(${t / 2}deg)` : '';
  return { background: 'linear-gradient(135deg,#d97a52,#3e8fe0 60%,#2fbf71)', filter: `saturate(${sat}) brightness(${br}) contrast(${ct})${warm}` };
}

function CaptionTab() {
  return (
    <div className="asset-body">
      <nav className="subnav"><button className="on">Sous-titres</button></nav>
      <div className="asset-content">
        <AutoCaptionsPanel />
        <hr style={{ border: 0, borderTop: '1px solid var(--c-border)', width: '100%' }} />
        <button className="btn" onClick={importSubtitles}><Upload size={14} /> Importer un fichier SRT / VTT</button>
        <button className="btn ghost" onClick={exportSubtitles}>Exporter les textes en SRT</button>
        <div className="hint">Chaque ligne devient un clip texte modifiable. Pour changer le style de tous : sélectionne-les (⇧-clic) puis modifie dans l’inspecteur.</div>
      </div>
    </div>
  );
}
