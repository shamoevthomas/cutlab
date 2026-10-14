import { useEffect, useMemo, useState } from 'react';
import { Clapperboard, Copy, Film, Home as HomeIcon, Image, LayoutTemplate, Pencil, Plus, Scissors, Search, Sparkles, Trash2, Wand2, Captions, FolderOpen } from 'lucide-react';
import { bridge } from '../bridge';
import type { ProjectSummary } from '../bridge/types';
import { createProject, openProject } from '../actions';
import { useStore } from '../store';
import { Modal, fmtDur } from './common';
import { RATIOS, uid } from '../model/schema';
import { trashName } from '../platform';

const RATIO_LABELS: Record<string, string> = { '16:9': 'YouTube', '9:16': 'Reel / TikTok', '1:1': 'Carré', '4:5': 'Post', '4:3': 'Classique', '21:9': 'Cinéma' };

export function NewProjectModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState('9:16');
  const [fps, setFps] = useState(30);
  const go = () => { createProject(name.trim() || `Projet ${new Date().toLocaleDateString('fr-FR')}`, ratio, fps); onClose(); };
  return (
    <Modal title="Nouveau projet" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annuler</button>
      <button className="btn primary" onClick={go}>Créer</button>
    </>}>
      <label className="field"><span>Nom</span>
        <input className="input" value={name} placeholder="Ex. Reel objection prix" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
      </label>
      <div className="field"><span>Format</span>
        <div className="ratio-grid" role="radiogroup" aria-label="Format">
          {Object.keys(RATIOS).map(r => {
            const [w, h] = RATIOS[r]; const k = 28 / Math.max(w, h);
            return (
              <button key={r} role="radio" aria-checked={ratio === r} className={'ratio-opt' + (ratio === r ? ' on' : '')} onClick={() => setRatio(r)}>
                <i style={{ width: w * k, height: h * k }} />
                <b style={{ fontSize: 'var(--fs-sm)' }}>{r}</b>
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{RATIO_LABELS[r]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <label className="field"><span>Images par seconde</span>
        <select className="input" value={fps} onChange={e => setFps(Number(e.target.value))}>
          {[24, 25, 30, 50, 60].map(f => <option key={f} value={f}>{f} i/s</option>)}
        </select>
      </label>
    </Modal>
  );
}

export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const notify = useStore(s => s.notify);

  const refresh = () => bridge.listProjects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => { refresh(); }, []);

  const shown = useMemo(() => (projects ?? []).filter(p => p.name.toLowerCase().includes(q.toLowerCase())), [projects, q]);

  const duplicate = async (s: ProjectSummary) => {
    const p = await bridge.loadProject(s.id);
    if (!p) return;
    await bridge.saveProject({ ...p, id: uid(), name: p.name + ' (copie)', updatedAt: new Date().toISOString() }, s.cover);
    refresh();
  };

  const soon = (label: string) => () => notify('info', `${label} : prévu dans une prochaine phase`);

  return (
    <div className="home">
      <div className="home-drag drag-region" aria-hidden="true" />
      <aside>
        <div className="brand drag-region"><Clapperboard size={22} color="var(--c-accent)" /> Cut<b>Lab</b></div>
        <button className="nav-item active"><HomeIcon size={16} /> Accueil</button>
        <button className="nav-item" onClick={soon('Modèles')}><LayoutTemplate size={16} /> Modèles <span className="badge">bientôt</span></button>
        <div className="nav-title">Créer avec l’IA</div>
        <button className="nav-item" onClick={soon('Studio vidéo IA')}><Film size={16} /> Studio vidéo <span className="badge">bientôt</span></button>
        <button className="nav-item" onClick={soon('Studio image IA')}><Image size={16} /> Studio image <span className="badge">bientôt</span></button>
        <div className="nav-title">Gestion</div>
        <button className="nav-item" onClick={() => bridge.openDataFolder ? bridge.openDataFolder() : notify('info', 'Version navigateur : projets stockés dans le navigateur')}><FolderOpen size={16} /> Dossier des projets</button>
        <div className="grow" />
        <div className="faint" style={{ fontSize: 'var(--fs-xs)', padding: '0 10px' }}>Usage personnel · tout débloqué</div>
      </aside>
      <main>
        <button className="hero" onClick={() => setCreating(true)}><span className="plus"><Plus size={24} /></span> Créer un projet</button>
        <div className="tiles">
          <div className="tile" style={{ cursor: 'default' }}>
            <div className="row"><Sparkles size={18} color="var(--c-accent)" /><b>Assistant de montage</b><span className="badge">bientôt</span></div>
            <p>Décris le montage que tu veux, l’assistant le fait sur ta timeline.</p>
            <input className="input" disabled placeholder="Ex. coupe les blancs et ajoute des sous-titres" style={{ marginTop: 'auto' }} />
          </div>
          <button className="tile" onClick={() => setCreating(true)}><span className="ic"><Captions size={18} /></span><h4>Sous-titres auto</h4><p>Dans l’éditeur : onglet Sous-titres</p></button>
          <button className="tile" onClick={() => setCreating(true)}><span className="ic"><Scissors size={18} /></span><h4>Coupe des blancs</h4><p>Dans l’éditeur : barre de la timeline</p></button>
          <button className="tile" onClick={soon('Recadrage auto')}><span className="ic"><Wand2 size={18} /></span><h4>Recadrage 9:16</h4><p>Suit le visage</p></button>
          <button className="tile" onClick={soon('Vidéo longue → shorts')}><span className="ic"><Film size={18} /></span><h4>Long → shorts</h4><p>Repère les meilleurs moments</p></button>
        </div>

        <div className="section-h">
          <h3>Projets</h3>
          <div className="row">
            <div className="row" style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 8 }} className="faint" />
              <input className="input" style={{ paddingLeft: 26, width: 220 }} placeholder="Rechercher un projet" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un projet" />
            </div>
          </div>
        </div>

        {projects === null ? <div className="muted">Chargement…</div> : shown.length === 0 ? (
          <div className="empty">
            <Clapperboard size={28} />
            <div>{q ? 'Aucun projet ne correspond.' : 'Pas encore de projet. Crée le premier !'}</div>
            {!q && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={14} /> Nouveau projet</button>}
          </div>
        ) : (
          <div className="projects">
            {shown.map(p => (
              <div key={p.id} className="pcard" role="button" tabIndex={0} onClick={() => openProject(p.id)} onKeyDown={e => e.key === 'Enter' && openProject(p.id)}>
                <div className="thumb" style={p.cover ? { backgroundImage: `url(${p.cover})` } : undefined}>{!p.cover && <Film size={22} />}</div>
                <div className="meta">
                  <div className="ellipsis" style={{ fontWeight: 600 }}>{p.name}</div>
                  <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{fmtDur(p.durationUs)} · {p.width}×{p.height} · {new Date(p.updatedAt).toLocaleDateString('fr-FR')}</div>
                </div>
                <div className="menu row" style={{ gap: 2 }} onClick={e => e.stopPropagation()}>
                  <button className="icon-btn" style={{ background: 'rgba(0,0,0,.6)' }} title="Renommer" aria-label={`Renommer ${p.name}`} onClick={() => setRenaming(p)}><Pencil size={13} /></button>
                  <button className="icon-btn" style={{ background: 'rgba(0,0,0,.6)' }} title="Dupliquer" aria-label={`Dupliquer ${p.name}`} onClick={() => duplicate(p)}><Copy size={13} /></button>
                  <button className="icon-btn" style={{ background: 'rgba(0,0,0,.6)' }} title="Supprimer" aria-label={`Supprimer ${p.name}`} onClick={() => setDeleting(p)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
      {renaming && <RenameModal summary={renaming} onClose={() => { setRenaming(null); refresh(); }} />}
      {deleting && (
        <Modal title="Supprimer le projet ?" onClose={() => setDeleting(null)} footer={<>
          <button className="btn ghost" onClick={() => setDeleting(null)}>Annuler</button>
          <button className="btn danger" onClick={async () => { await bridge.deleteProject(deleting.id); setDeleting(null); refresh(); }}>Supprimer</button>
        </>}>
          <div>« {deleting.name} » {bridge.kind === 'electron' ? `ira dans ${trashName}.` : 'sera supprimé de ce navigateur.'} Tes fichiers vidéo d’origine ne sont pas touchés.</div>
        </Modal>
      )}
    </div>
  );
}

function RenameModal({ summary, onClose }: { summary: ProjectSummary; onClose: () => void }) {
  const [name, setName] = useState(summary.name);
  const save = async () => {
    const p = await bridge.loadProject(summary.id);
    if (p && name.trim()) await bridge.saveProject({ ...p, name: name.trim(), updatedAt: new Date().toISOString() });
    onClose();
  };
  return (
    <Modal title="Renommer" onClose={onClose} width={420} footer={<><button className="btn ghost" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Renommer</button></>}>
      <input className="input" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} aria-label="Nom du projet" />
    </Modal>
  );
}
