const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cutlab', {
  kind: 'electron',
  platform: process.platform,
  openDataFolder: () => ipcRenderer.send('files:openData'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  loadProject: (id) => ipcRenderer.invoke('projects:load', id),
  saveProject: (p, cover) => ipcRenderer.invoke('projects:save', p, cover),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  projectFolder: (id) => ipcRenderer.invoke('projects:folder', id),
  pickFiles: (accept) => ipcRenderer.invoke('files:pick', accept),
  resolve: (p) => ipcRenderer.invoke('files:resolve', p),
  readText: (p) => ipcRenderer.invoke('files:readText', p),
  saveExport: (name, data) => ipcRenderer.invoke('export:save', name, data),
  writeFile: (id, name, data) => ipcRenderer.invoke('files:write', id, name, data),
  transcode: (input, id, durationS, onProgress) => {
    const h = (_e, f, r) => { if (f === input) onProgress?.(r); };
    ipcRenderer.on('ffmpeg:progress', h);
    return ipcRenderer.invoke('media:transcode', input, id, durationS).finally(() => ipcRenderer.removeListener('ffmpeg:progress', h));
  },
  finalizeExport: (file, opts) => ipcRenderer.invoke('export:finalize', file, opts),
  reveal: (p) => ipcRenderer.send('files:reveal', p),
  /** Absolute path of a File dropped from Finder. */
  pathForFile: (f) => webUtils.getPathForFile(f),
});
