// CutLab desktop shell: filesystem, dialogs and the media:// protocol. The editor itself runs in the renderer.
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable } = require('node:stream');

const ROOT = path.join(app.getPath('videos'), 'CutLab');
const PROJECTS = path.join(ROOT, 'Projects');

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } },
]);

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
  '.srt': 'text/plain', '.vtt': 'text/vtt', '.txt': 'text/plain' };

const toUrl = (p) => 'media://local/' + encodeURIComponent(p);
const fromUrl = (u) => decodeURIComponent(new URL(u).pathname.slice(1));

/** media://local/<encoded absolute path>, with Range support so <video> can seek. */
function handleMedia(request) {
  const file = fromUrl(request.url);
  let stat;
  try { stat = fs.statSync(file); } catch { return new Response('not found', { status: 404 }); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' },
  });
}

async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, data);
  // keep 5 backups of project.json
  if (file.endsWith('project.json') && fs.existsSync(file)) {
    for (let i = 4; i >= 1; i--) {
      const a = `${file}.bak${i}`, b = `${file}.bak${i + 1}`;
      if (fs.existsSync(a)) await fsp.rename(a, b);
    }
    await fsp.copyFile(file, `${file}.bak1`);
  }
  await fsp.rename(tmp, file);
}

const projectDir = (id) => path.join(PROJECTS, id.replace(/[^a-zA-Z0-9-]/g, ''));

function registerIpc() {
  ipcMain.handle('projects:list', async () => {
    await fsp.mkdir(PROJECTS, { recursive: true });
    const out = [];
    for (const id of await fsp.readdir(PROJECTS)) {
      try {
        const p = JSON.parse(await fsp.readFile(path.join(PROJECTS, id, 'project.json'), 'utf8'));
        const cover = path.join(PROJECTS, id, 'cover.jpg');
        let durationUs = 0;
        for (const t of p.tracks) for (const c of t.clips) durationUs = Math.max(durationUs, c.startUs + c.durationUs);
        out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, durationUs, width: p.canvas.width, height: p.canvas.height,
          cover: fs.existsSync(cover) ? toUrl(cover) + '?v=' + fs.statSync(cover).mtimeMs : undefined });
      } catch { /* skip broken folder */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  ipcMain.handle('projects:load', async (_e, id) => {
    try { return JSON.parse(await fsp.readFile(path.join(projectDir(id), 'project.json'), 'utf8')); } catch { return null; }
  });
  ipcMain.handle('projects:save', async (_e, p, cover) => {
    const dir = projectDir(p.id);
    await atomicWrite(path.join(dir, 'project.json'), JSON.stringify(p));
    if (cover && cover.startsWith('data:image/jpeg;base64,')) await atomicWrite(path.join(dir, 'cover.jpg'), Buffer.from(cover.split(',')[1], 'base64'));
  });
  ipcMain.handle('projects:delete', async (_e, id) => {
    await shell.trashItem(projectDir(id)).catch(() => fsp.rm(projectDir(id), { recursive: true, force: true }));
  });
  ipcMain.handle('projects:folder', async (_e, id) => projectDir(id));
  ipcMain.handle('files:pick', async (e, accept) => {
    const filters = {
      media: [{ name: 'Médias', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'] }],
      audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
      srt: [{ name: 'Sous-titres', extensions: ['srt', 'vtt', 'txt'] }],
      font: [{ name: 'Polices', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    }[accept];
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile', 'multiSelections'], filters });
    if (r.canceled) return [];
    return r.filePaths.map((p) => ({ name: path.basename(p), path: p, url: toUrl(p), mime: MIME[path.extname(p).toLowerCase()] || '', size: fs.statSync(p).size }));
  });
  ipcMain.handle('files:resolve', async (_e, p) => (fs.existsSync(p) ? toUrl(p) : null));
  ipcMain.handle('files:readText', async (_e, p) => fsp.readFile(p, 'utf8'));
  ipcMain.handle('export:save', async (e, name, data) => {
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: path.join(app.getPath('videos'), name) });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, Buffer.from(data));
    return r.filePath;
  });
  ipcMain.on('files:reveal', (_e, p) => shell.showItemInFolder(p));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0e0f12', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  if (process.env.CUTLAB_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  protocol.handle('media', handleMedia);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
