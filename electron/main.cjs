// CutLab desktop shell: filesystem, dialogs and the media:// protocol. The editor itself runs in the renderer.
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');

// bundled ffmpeg (unpacked from the asar archive in the packaged app)
let FFMPEG = null;
try { FFMPEG = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked'); } catch { /* optional */ }

/** Run ffmpeg; progress (0..1) is parsed from its stderr when the duration is known. */
function ffmpeg(args, durationS, onProgress) {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('ffmpeg indisponible'));
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => {
      const s = d.toString(); err = (err + s).slice(-4000);
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (m && durationS && onProgress) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / durationS));
    });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.split('\n').filter(Boolean).slice(-2).join(' ')))));
  });
}

const ROOT = path.join(app.getPath('videos'), 'CutLab');
const PROJECTS = path.join(ROOT, 'Projects');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } },
]);

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
  '.srt': 'text/plain', '.cube': 'text/plain', '.vtt': 'text/vtt', '.txt': 'text/plain' };

const toUrl = (p) => 'media://local/' + encodeURIComponent(p);
const fromUrl = (u) => decodeURIComponent(new URL(u).pathname.slice(1));

const DIST = path.join(__dirname, '..', 'dist');
/** app://cutlab/<file> serves the built interface (a real origin: fetch, workers, wasm and Cache Storage all work). */
async function handleApp(request) {
  const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
  try {
    const data = await fsp.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type, 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } });
  } catch { return new Response('not found', { status: 404 }); }
}

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
      lut: [{ name: 'LUT 3D', extensions: ['cube'] }],
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
  ipcMain.handle('files:write', async (_e, id, name, data) => {
    const file = path.join(projectDir(id), 'cache', path.basename(name));
    await atomicWrite(file, Buffer.from(data));
    return { name: path.basename(file), path: file, url: toUrl(file), mime: MIME[path.extname(file).toLowerCase()] || '', size: data.byteLength };
  });
  ipcMain.handle('media:transcode', async (e, input, id, durationS) => {
    const ext = path.extname(input).toLowerCase();
    const isImage = ['.heic', '.heif', '.tif', '.tiff', '.bmp'].includes(ext);
    const out = path.join(projectDir(id), 'cache', path.basename(input, ext) + (isImage ? '.png' : '.mp4'));
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const args = isImage ? ['-i', input, '-frames:v', '1', out]
      : ['-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out];
    await ffmpeg(args, durationS, (r) => e.sender.send('ffmpeg:progress', input, r));
    return { name: path.basename(input), path: out, url: toUrl(out), mime: isImage ? 'image/png' : 'video/mp4', size: fs.statSync(out).size };
  });
  ipcMain.handle('export:finalize', async (_e, file, opts) => {
    const ext = opts.mov ? '.mov' : path.extname(file);
    const tmp = file + '.tmp' + ext;
    const out = opts.mov ? file.replace(/\.[^.]+$/, '') + '.mov' : file;
    await ffmpeg(['-i', file, '-c:v', 'copy', ...(opts.aac ? ['-c:a', 'aac', '-b:a', '256k'] : ['-c:a', 'copy']), '-movflags', '+faststart', tmp]);
    await fsp.rename(tmp, out);
    if (out !== file) await fsp.rm(file, { force: true });
    return out;
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
  else win.loadURL('app://cutlab/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', handleApp);
  protocol.handle('media', handleMedia);
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
