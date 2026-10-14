// 3D LUTs (.cube) for colour grading: parsed once, uploaded to the GPU by the compositor.
import type { Asset } from '../model/schema';

export interface Lut { size: number; data: Uint8Array; title?: string } // RGBA8, r fastest

export function parseCube(text: string): Lut {
  let size = 0, title: string | undefined;
  const vals: number[] = [];
  let domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (key === 'LUT_3D_SIZE') { size = parseInt(parts[1], 10); continue; }
    if (key === 'LUT_1D_SIZE') throw new Error('LUT 1D non pris en charge (utilise une LUT 3D .cube)');
    if (key === 'DOMAIN_MIN') { domainMin = parts.slice(1, 4).map(Number); continue; }
    if (key === 'DOMAIN_MAX') { domainMax = parts.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]+$/.test(key)) continue;
    if (parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || vals.length !== size * size * size * 3) throw new Error('Fichier .cube invalide');
  const data = new Uint8Array(size * size * size * 4);
  for (let i = 0, j = 0; i < vals.length; i += 3, j += 4) {
    for (let k = 0; k < 3; k++) {
      const v = (vals[i + k] - domainMin[k]) / (domainMax[k] - domainMin[k] || 1);
      data[j + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    data[j + 3] = 255;
  }
  return { size, data, title };
}

const luts = new Map<string, Lut>();
const loading = new Set<string>();
export let lutVersion = 0;

/** LUT for an asset; starts loading it on first request (returns undefined until ready). */
export function getLut(a: Asset | undefined, onReady?: () => void): Lut | undefined {
  if (!a || a.kind !== 'lut' || !a.url) return undefined;
  const hit = luts.get(a.id);
  if (hit) return hit;
  if (!loading.has(a.id)) {
    loading.add(a.id);
    fetch(a.url).then(r => r.text()).then(t => { luts.set(a.id, parseCube(t)); lutVersion++; onReady?.(); })
      .catch(() => { /* unreadable: ignored */ }).finally(() => loading.delete(a.id));
  }
  return undefined;
}

export async function loadLut(a: Asset): Promise<Lut> {
  const hit = luts.get(a.id);
  if (hit) return hit;
  const l = parseCube(await (await fetch(a.url)).text());
  luts.set(a.id, l);
  return l;
}
