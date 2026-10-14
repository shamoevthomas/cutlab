import { ReactNode, useEffect, useRef } from 'react';
import { Diamond, RotateCcw, X } from 'lucide-react';

export function fmtTc(us: number, fps: number) {
  const totalFrames = Math.round((us / 1e6) * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

export function fmtDur(us: number) {
  const s = Math.round(us / 1e6);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function Modal({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, button:not([data-close])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')).filter(x => !(x as any).disabled);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref} style={width ? { width } : undefined}>
        <header><span className="grow">{title}</span><button className="icon-btn" data-close aria-label="Fermer" onClick={onClose}><X size={16} /></button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export interface SliderProps {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  defaultValue?: number;
  onChange: (v: number) => void;
  onCommitStart?: () => void; onCommitEnd?: () => void;
  keyframe?: { has: boolean; on: boolean; toggle: () => void };
}

export function SliderRow({ label, value, min, max, step = 1, unit = '', defaultValue, onChange, onCommitStart, onCommitEnd, keyframe }: SliderProps) {
  const changed = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-6;
  const shown = Math.round(value / step) * step;
  return (
    <div className="slider-row">
      <label title={label}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} aria-valuetext={`${shown}${unit}`}
        onPointerDown={onCommitStart} onPointerUp={onCommitEnd} onKeyDown={onCommitStart} onKeyUp={onCommitEnd}
        onChange={e => onChange(Number(e.target.value))} aria-label={label} />
      <input type="number" value={Number(shown.toFixed(step < 1 ? 2 : 0))} step={step} min={min} max={max} aria-label={`${label} (valeur)`}
        onFocus={onCommitStart} onBlur={onCommitEnd}
        onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v))); }} />
      <button className={'reset' + (changed ? ' show' : '')} title="Réinitialiser" aria-label={`Réinitialiser ${label}`} onClick={() => { onCommitStart?.(); onChange(defaultValue!); onCommitEnd?.(); }}><RotateCcw size={12} /></button>
      {keyframe ? (
        <button className={'kf' + (keyframe.on ? ' on' : keyframe.has ? ' has' : '')} title={keyframe.on ? 'Supprimer l’image clé' : 'Ajouter une image clé'} aria-pressed={keyframe.on} aria-label={`Image clé ${label}`} onClick={keyframe.toggle}>
          <Diamond size={13} fill={keyframe.on ? 'currentColor' : 'none'} />
        </button>
      ) : <span />}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{label}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}
