// CutLab's own vector stickers (shapes), rasterised to PNG assets at 512 px.
import type { Asset } from '../model/schema';

const G = '#3ee08f';
export const STICKERS: { id: string; label: string; svg: (s: number) => string }[] = [
  { id: 'arrow', label: 'Flèche', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M10 45h55V25l30 25-30 25V55H10z" fill="#ffd23f" stroke="#000" stroke-width="4" stroke-linejoin="round"/></svg>` },
  { id: 'circle', label: 'Cercle', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#ff4d4d" stroke-width="8"/></svg>` },
  { id: 'check', label: 'Validé', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="${G}"/><path d="M28 52l15 15 30-32" fill="none" stroke="#06120b" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
  { id: 'cross', label: 'Refusé', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="#ff4d4d"/><path d="M32 32l36 36M68 32L32 68" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>` },
  { id: 'star', label: 'Étoile', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M50 6l13 28 30 3-23 20 7 30-27-16-27 16 7-30L7 37l30-3z" fill="#ffd23f" stroke="#000" stroke-width="3" stroke-linejoin="round"/></svg>` },
  { id: 'heart', label: 'Cœur', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M50 88S8 62 8 34a20 20 0 0 1 42-8 20 20 0 0 1 42 8c0 28-42 54-42 54z" fill="#ff4d6d"/></svg>` },
  { id: 'bubble', label: 'Bulle', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M12 14h76a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H40L22 88V70H12a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z" fill="#fff" stroke="#000" stroke-width="3"/></svg>` },
  { id: 'underline', label: 'Soulignement', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M6 60c20-8 40-10 88-6" fill="none" stroke="${G}" stroke-width="9" stroke-linecap="round"/></svg>` },
  { id: 'fire', label: 'Feu', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M50 6c6 18 26 26 26 50a26 26 0 0 1-52 0c0-12 6-20 12-26 0 10 4 16 10 18-4-16 0-30 4-42z" fill="#ff7a1a"/><path d="M50 50c4 8 12 12 12 22a12 12 0 0 1-24 0c0-8 6-12 12-22z" fill="#ffd23f"/></svg>` },
  { id: 'money', label: 'Euro', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="${G}"/><text x="50" y="68" font-size="52" font-weight="700" text-anchor="middle" fill="#06120b" font-family="Inter, Arial">€</text></svg>` },
  { id: 'phone', label: 'Téléphone', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><rect x="28" y="6" width="44" height="88" rx="8" fill="#16181d" stroke="#fff" stroke-width="3"/><rect x="33" y="16" width="34" height="62" rx="3" fill="${G}"/><circle cx="50" cy="86" r="3" fill="#fff"/></svg>` },
  { id: 'rect', label: 'Cadre', svg: s => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><rect x="8" y="20" width="84" height="60" rx="8" fill="none" stroke="#fff" stroke-width="6"/></svg>` },
];

export async function makeSticker(id: string): Promise<Asset> {
  const def = STICKERS.find(s => s.id === id)!;
  const size = 512;
  const blob = new Blob([def.svg(size)], { type: 'image/svg+xml' });
  const img = new Image();
  img.src = URL.createObjectURL(blob);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.drawImage(img, 0, 0, size, size);
  const url = c.toDataURL('image/png');
  return { id: 'sticker-' + id, kind: 'sticker', name: def.label, path: url, url, width: size / 2, height: size / 2, hasAudio: false, thumb: url };
}
