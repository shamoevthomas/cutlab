const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('cutlab', {
  kind: 'electron',
  listProjects: () => ipcRenderer.invoke('projects:list'),
  loadProject: (id) => ipcRenderer.invoke('projects:load', id),
  saveProject: (p, cover) => ipcRenderer.invoke('projects:save', p, cover),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  projectFolder: (id) => ipcRenderer.invoke('projects:folder', id),
  pickFiles: (accept) => ipcRenderer.invoke('files:pick', accept),
  resolve: (p) => ipcRenderer.invoke('files:resolve', p),
  readText: (p) => ipcRenderer.invoke('files:readText', p),
  saveExport: (name, data) => ipcRenderer.invoke('export:save', name, data),
  reveal: (p) => ipcRenderer.send('files:reveal', p),
  /** Absolute path of a File dropped from Finder. */
  pathForFile: (f) => webUtils.getPathForFile(f),
});
