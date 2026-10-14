import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Blend, Captions, Clapperboard, Film, Image as ImageIcon, Music, Plus, Search, Sliders, Sparkles, Sticker, Type, Upload, Wand2, AlertTriangle, Trash2 } from 'lucide-react';
import { useStore, Panel } from '../store';
import { addAdjustmentLayer, importLuts, applyLut, listLooks, deleteLook, applyLook } from '../actions';
import { addAssetAtPlayhead, addText, exportSubtitles, importFiles, importSubtitles, pickAndImport, relinkAsset, CAPTION_STYLES, captionStyle, restyleCaptions } from '../actions';
import { Switch } from './common';
import { pickedFromDrop } from './dropFiles';
import { fmtDur } from './common';
import { FILTERS, FILTER_CATS, TRANSITIONS, TRANSITION_CATS } from '../engine/scene';
import { filterThumbs } from '../engine/thumbs';
import * as op from '../model/ops';
import { defaultTextStyle, uid, TextStyle } from '../model/schema';
import { makeSticker, STICKERS } from '../engine/stickers';
import { AutoCaptionsPanel, getCaptionStyle, setCaptionStyle } from './AutoTools';

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
      <div className="asset-tabs-wrap">
        <button className="tab-scroll l" aria-label="Onglets précédents" onClick={e => (e.currentTarget.nextElementSibling as HTMLElement).scrollBy({ left: -180, behavior: 'smooth' })}><ChevronLeft size={14} /></button>
        <div className="asset-tabs" role="tablist" aria-label="Catégories">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={panel === t.id} className="asset-tab" onClick={e => { useStore.getState().set('panel', t.id); e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}>
              <t.icon size={17} />{t.label}
            </button>
          ))}
        </div>
        <button className="tab-scroll r" aria-label="Onglets suivants" onClick={e => (e.currentTarget.previousElementSibling as HTMLElement).scrollBy({ left: 180, behavior: 'smooth' })}><ChevronRight size={14} /></button>
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
        {panel === 'adjust' && <AdjustTab />}
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
  const [cat, setCat] = useState(TRANSITION_CATS[0]);
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
      <nav className="subnav" aria-label="Catégories de transitions">
        {TRANSITION_CATS.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </nav>
      <div className="asset-content">
        {!adjacent && <div className="hint">Sélectionne le clip <b>avant</b> la coupe : la transition se place entre lui et le clip suivant.</div>}
        <div className="filter-grid">
          {TRANSITIONS.filter(t => t.cat === cat).map(t => (
            <button key={t.kind} className={'filter-tile' + (current?.kind === t.kind ? ' on' : '')} disabled={!adjacent} onClick={() => apply(t.kind)} style={{ opacity: adjacent ? 1 : .55 }} aria-label={`Transition ${t.label}`}>
              <span className={`ft-img tr-prev tr-${t.kind}`}><i /><b /></span>
              <span className="ellipsis">{t.label}</span>
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
  useStore(s => s.selection); const project = useStore(s => s.project)!;
  const refs = selectedVisualClips();
  const current = refs[0]?.clip.effects.find(e => e.kind === 'filter');
  const [cat, setCat] = useState(FILTER_CATS[0]);
  const [thumbs, setThumbs] = useState<Record<string, string> | null>(null);
  // preview image: the selected clip's thumbnail, else the first visual asset, else a built-in sample
  const sel = refs[0] && project.assets.find(a => a.id === refs[0].clip.assetId);
  const sample = sel?.thumb ?? project.assets.find(a => (a.kind === 'video' || a.kind === 'image') && a.thumb)?.thumb ?? SAMPLE;
  useEffect(() => { let alive = true; filterThumbs(sample).then(t => alive && setThumbs(t)).catch(() => {}); return () => { alive = false; }; }, [sample]);
  const apply = (preset: string | null) => {
    if (!refs.length) {
      if (preset) addAdjustmentLayer([{ id: uid(), kind: 'filter', enabled: true, params: { preset, intensity: 100 } }]);
      return;
    }
    useStore.getState().edit(p => {
      for (const r of refs) {
        const c = op.findClip(p, r.clip.id)!.clip;
        c.effects = c.effects.filter(e => e.kind !== 'filter');
        if (preset) c.effects.push({ id: uid(), kind: 'filter', enabled: true, params: { preset, intensity: 100 } });
      }
    });
  };
  const tile = (id: string, label: string) => (
    <button key={id} className={'filter-tile' + ((id === 'none' ? !current : current?.params.preset === id) ? ' on' : '')} onClick={() => apply(id === 'none' ? null : id)} aria-label={`Filtre ${label}`}>
      <span className="ft-img" style={thumbs ? { backgroundImage: `url(${thumbs[id]})` } : undefined} />
      <span className="ellipsis">{label}</span>
    </button>
  );
  return (
    <div className="asset-body">
      <nav className="subnav" aria-label="Catégories de filtres">
        {FILTER_CATS.map(c => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </nav>
      <div className="asset-content">
        <div className="filter-grid">
          {cat === FILTER_CATS[0] && tile('none', 'Aucun')}
          {Object.entries(FILTERS).filter(([, f]) => f.cat === cat).map(([id, f]) => tile(id, f.label))}
        </div>
        <div className="hint">{refs.length ? `S’applique ${refs.length > 1 ? `aux ${refs.length} clips sélectionnés` : 'au clip sélectionné'}. Intensité réglable dans l’inspecteur.` : 'Aucun clip sélectionné : le filtre s’ajoute sur un calque de réglage à la tête de lecture.'}</div>
      </div>
    </div>
  );
}

// neutral sample photo substitute (gradient landscape) when the project has no media yet
const SAMPLE = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb3e6"/><stop offset="1" stop-color="#f3c98b"/></linearGradient></defs><rect width="160" height="100" fill="url(#s)"/><circle cx="118" cy="34" r="12" fill="#ffe8a3"/><path d="M0 78 L40 50 L70 70 L105 42 L160 80 L160 100 L0 100Z" fill="#3c6e4f"/><path d="M0 88 L50 70 L90 86 L160 74 L160 100 L0 100Z" fill="#2c4f3a"/></svg>`);

function AdjustTab() {
  const [sub, setSub] = useState<'add' | 'looks' | 'lut'>('add');
  const project = useStore(s => s.project)!;
  useStore(s => s.selection);
  const [, force] = useState(0);
  const luts = project.assets.filter(a => a.kind === 'lut');
  const looks = listLooks();
  const target = useStore.getState().selection.length ? 'aux clips sélectionnés' : 'sur un nouveau calque de réglage';
  return (
    <div className="asset-body">
      <nav className="subnav" aria-label="Réglages">
        <button className={sub === 'add' ? 'on' : ''} onClick={() => setSub('add')}>Ajouter un réglage</button>
        <button className={sub === 'looks' ? 'on' : ''} onClick={() => setSub('looks')}>Mes réglages</button>
        <button className={sub === 'lut' ? 'on' : ''} onClick={() => setSub('lut')}>LUT</button>
      </nav>
      <div className="asset-content">
        {sub === 'add' && <>
          <div className="asset-grid">
            <button className="preset" onClick={() => addAdjustmentLayer()} aria-label="Ajouter un calque de réglage"><Sliders size={20} />Réglage personnalisé</button>
          </div>
          <div className="hint">Un calque de réglage colore tout ce qui est en dessous de lui dans la timeline, sur sa durée. Règle-le dans l’inspecteur à droite.</div>
        </>}
        {sub === 'looks' && (looks.length ? <div className="col" style={{ gap: 6 }}>
          {looks.map(l => (
            <div key={l.id} className="list-row">
              <Sliders size={14} className="muted" /><span className="grow ellipsis">{l.name}</span>
              <button className="icon-btn" aria-label={`Supprimer ${l.name}`} onClick={() => { deleteLook(l.id); force(n => n + 1); }}><Trash2 size={13} /></button>
              <button className="btn sm" onClick={() => applyLook(l)}>Appliquer</button>
            </div>
          ))}
          <div className="hint">S’applique {target}.</div>
        </div> : <div className="empty" style={{ padding: 20 }}><Sliders size={20} /><div style={{ fontSize: 'var(--fs-sm)' }}>Aucun réglage enregistré. Dans l’inspecteur (onglet Réglages), clique sur « Enregistrer ce réglage ».</div></div>)}
        {sub === 'lut' && <>
          <button className="btn" onClick={async () => { const a = await importLuts(); if (a.length) useStore.getState().notify('success', `${a.length} LUT importée${a.length > 1 ? 's' : ''}`); }}><Upload size={14} /> Importer une LUT (.cube)</button>
          {luts.length > 0 && <div className="col" style={{ gap: 6 }}>
            {luts.map(l => (
              <div key={l.id} className="list-row"><Wand2 size={14} className="muted" /><span className="grow ellipsis">{l.name}</span><button className="btn sm" onClick={() => applyLut(l.id)}>Appliquer</button></div>
            ))}
          </div>}
          <div className="hint">S’applique {target}. Intensité réglable dans l’inspecteur.</div>
        </>}
      </div>
    </div>
  );
}

function CaptionTab() {
  const [sub, setSub] = useState<'auto' | 'styles' | 'lyrics' | 'add'>('auto');
  return (
    <div className="asset-body">
      <nav className="subnav" aria-label="Sous-titres">
        <button className={sub === 'auto' ? 'on' : ''} onClick={() => setSub('auto')}>Sous-titres auto</button>
        <button className={sub === 'styles' ? 'on' : ''} onClick={() => setSub('styles')}>Modèles</button>
        <button className={sub === 'lyrics' ? 'on' : ''} onClick={() => setSub('lyrics')}>Paroles auto</button>
        <button className={sub === 'add' ? 'on' : ''} onClick={() => setSub('add')}>Ajouter</button>
      </nav>
      <div className="asset-content">
        {sub === 'auto' && <AutoCaptionsPanel />}
        {sub === 'lyrics' && <AutoCaptionsPanel lyrics />}
        {sub === 'styles' && <CaptionStyles />}
        {sub === 'add' && <>
          <button className="btn" onClick={() => {
            const p = useStore.getState().project!;
            addText('Nouveau sous-titre', { ...captionStyle(getCaptionStyle(), p.canvas.height > p.canvas.width) });
            useStore.getState().edit(d => { const id = useStore.getState().selection[0]; const r = op.findClip(d, id); if (r) r.clip.transform.y = d.canvas.height > d.canvas.width ? -0.45 : -0.72; });
          }}><Plus size={14} /> Ajouter un sous-titre à la main</button>
          <button className="btn" onClick={importSubtitles}><Upload size={14} /> Importer un fichier SRT / VTT</button>
          <button className="btn ghost" onClick={exportSubtitles}>Exporter les textes en SRT</button>
          <div className="hint">Chaque ligne devient un clip texte modifiable.</div>
        </>}
      </div>
    </div>
  );
}

function CaptionStyles() {
  const [cur, setCur] = useState(getCaptionStyle());
  const [upper, setUpper] = useState(false);
  const has = useStore(s => s.project?.tracks.some(t => t.role === 'captions'));
  const portrait = useStore(s => (s.project?.canvas.height ?? 0) > (s.project?.canvas.width ?? 1));
  return (
    <>
      <div className="asset-grid">
        {CAPTION_STYLES.map(c => {
          const s = captionStyle(c.id, portrait);
          return (
            <button key={c.id} className={'preset' + (cur === c.id ? ' on' : '')} onClick={() => { setCur(c.id); setCaptionStyle(c.id); if (has) restyleCaptions(c.id, upper); }}
              style={{ background: '#2a2f3a' }} aria-label={`Style ${c.label}`}>
              <span style={{ fontFamily: s.font, fontWeight: s.bold ? 700 : 400, color: s.color, fontSize: 17, padding: s.bgOpacity ? '1px 6px' : 0, borderRadius: 3,
                background: s.bgOpacity ? s.bgColor : undefined, WebkitTextStroke: s.strokeWidth ? `1.2px ${s.strokeColor}` : undefined, textShadow: s.shadow ? '0 1px 3px #000' : undefined }}>Abc</span>
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{c.label}</span>
            </button>
          );
        })}
      </div>
      <Switch label="Tout en majuscules" checked={upper} onChange={v => { setUpper(v); if (has) restyleCaptions(cur, v); }} />
      <div className="hint">{has ? 'Cliquer sur un modèle l’applique à tous les sous-titres auto.' : 'Le modèle choisi sera utilisé à la prochaine génération.'}</div>
    </>
  );
}
