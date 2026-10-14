import { bridge } from '../bridge';
import { storeFile } from '../bridge/web';
import type { PickedFile } from '../bridge/types';

/** Files dropped from the Finder / Explorer: on desktop keep their real path, in the browser store them. */
export async function pickedFromDrop(list: FileList): Promise<PickedFile[]> {
  const files = Array.from(list);
  const w = window as any;
  if (bridge.kind === 'electron' && w.cutlab?.pathForFile) {
    const out: PickedFile[] = [];
    for (const f of files) {
      const path = w.cutlab.pathForFile(f);
      const url = await bridge.resolve(path);
      if (url) out.push({ name: f.name, path, url, mime: f.type, size: f.size });
    }
    return out;
  }
  return Promise.all(files.map(storeFile));
}
