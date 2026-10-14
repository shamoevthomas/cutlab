// Filter previews: the selected clip's frame rendered through each filter with the real compositor.
import { Compositor } from './compositor';
import { FILTERS, filterAdjust, Layer } from './scene';
import { loadImage } from './media';

const cache = new Map<string, Record<string, string>>();

export async function filterThumbs(imageUrl: string): Promise<Record<string, string>> {
  const hit = cache.get(imageUrl);
  if (hit) return hit;
  const img = await loadImage(imageUrl);
  const W = 144, H = Math.max(2, Math.round((W * img.naturalHeight) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  const comp = new Compositor(canvas);
  comp.resize(W, H);
  const out: Record<string, string> = {};
  const base: Omit<Layer, 'adjust'> = {
    clip: {} as any, track: {} as any, kind: 'image', sourceUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
    flipH: false, flipV: false, wipe: 0, chroma: { on: false, color: [0, 1, 0], intensity: 0, shadow: 0 }, blend: 'normal', crop: { l: 0, t: 0, r: 0, b: 0 },
  };
  const src = { el: img, w: img.naturalWidth, h: img.naturalHeight, key: 'thumb', dynamic: false, fit: 'contain' as const };
  for (const id of ['none', ...Object.keys(FILTERS)]) {
    comp.render('#000000', [{ ...base, adjust: filterAdjust(id) } as Layer], () => src);
    out[id] = canvas.toDataURL('image/jpeg', 0.8);
  }
  comp.dispose();
  if (cache.size > 20) cache.clear();
  cache.set(imageUrl, out);
  return out;
}
