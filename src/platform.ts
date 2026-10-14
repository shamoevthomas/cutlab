// Platform differences the interface cares about: shortcut labels, window chrome, OS names.
const fromBridge = (window as any).cutlab?.platform as string | undefined;
const ua = navigator.userAgent;
export const platform: 'darwin' | 'win32' | 'linux' =
  (fromBridge as any) ?? (/Mac/.test(ua) ? 'darwin' : /Windows/.test(ua) ? 'win32' : 'linux');
export const isMac = platform === 'darwin';
export const isWindows = platform === 'win32';

/** Mac-style shortcut text → Windows/Linux text (⌘ → Ctrl, ⇧ → Maj, ⌥ → Alt). */
export function kb(s: string): string {
  if (isMac) return s;
  return s.replace(/⇧⌘/g, 'Ctrl+Maj+').replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Maj+').replace(/⌥/g, 'Alt+');
}

export const fileManagerName = isMac ? 'le Finder' : isWindows ? 'l’Explorateur' : 'le gestionnaire de fichiers';
export const trashName = isMac ? 'la corbeille du Mac' : isWindows ? 'la Corbeille de Windows' : 'la corbeille';
