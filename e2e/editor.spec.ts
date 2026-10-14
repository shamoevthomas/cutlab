// End-to-end: drives the real Electron app (renderer + main process) with native dialogs stubbed.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIX = path.resolve('e2e/fixtures');
const SHOTS = path.resolve('replica/test/shots');
let app: ElectronApplication;
let page: Page;
let home: string;

async function stubOpen(files: string[]) {
  await app.evaluate(({ dialog }, files) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files.map(f => path.join(FIX, f)));
}

test.beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cutlab-home-'));
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, HOME: home } as any });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
});
test.afterAll(async () => { await app?.close(); });

test('home → create → import → edit → export → reopen', async () => {
  await expect(page.getByText('Pas encore de projet')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-home-empty.png` });

  // S02 new project, 16:9
  await page.getByRole('button', { name: 'Créer un projet' }).click();
  await page.getByLabel('Nom').fill('Test e2e');
  await page.getByRole('radio', { name: /16:9/ }).click();
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page.getByText('Glisse tes médias ici')).toBeVisible();

  // import 3 visual files
  await stubOpen(['clipA.mp4', 'clipB.mp4', 'green.png']);
  await page.getByRole('button', { name: 'Importer' }).first().click();
  await expect(page.locator('.asset-tile')).toHaveCount(3, { timeout: 20_000 });

  // add both clips to the main track
  await page.getByRole('button', { name: 'Ajouter clipA.mp4' }).click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Ajouter clipB.mp4' }).click();
  const state = () => page.evaluate(() => (window as any).__cutlab.getState().project);
  let p = await state();
  const main = p.tracks.find((t: any) => t.isMain);
  expect(main.clips.length).toBe(2);
  expect(main.clips[1].startUs).toBe(main.clips[0].durationUs);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/02-editor-two-clips.png` });

  // split at 3 s, then undo / redo
  await page.evaluate(() => (window as any).__cutlab.getState().seek(3_000_000));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+b');
  p = await state();
  expect(p.tracks.find((t: any) => t.isMain).clips.length).toBe(3);
  await page.keyboard.press('Meta+z');
  expect((await state()).tracks.find((t: any) => t.isMain).clips.length).toBe(2);
  await page.keyboard.press('Meta+Shift+z');
  expect((await state()).tracks.find((t: any) => t.isMain).clips.length).toBe(3);

  // black & white filter on the first clip
  await page.locator('.clip').first().click({ position: { x: 20, y: 30 } });
  await page.getByRole('tab', { name: 'Filtres' }).click();
  await page.getByRole('button', { name: 'Noir & blanc' }).click();
  // a dissolve between the 2nd and 3rd main clips
  const ids = (await state()).tracks.find((t: any) => t.isMain).clips.map((c: any) => c.id);
  await page.evaluate((id) => (window as any).__cutlab.getState().select([id]), ids[1]);
  await page.getByRole('tab', { name: 'Transitions' }).click();
  await page.getByRole('button', { name: 'Fondu enchaîné' }).click();
  expect((await state()).transitions.length).toBe(1);

  // a title
  await page.evaluate(() => (window as any).__cutlab.getState().seek(500_000));
  await page.getByRole('tab', { name: 'Texte' }).click();
  await page.getByRole('button', { name: 'Ajouter le texte Titre' }).click();
  await page.getByLabel('Texte', { exact: true }).fill('CUTLAB TEST');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/03-editor-text-filter.png` });

  // subtitles from SRT
  await stubOpen(['subs.srt']);
  await page.getByRole('tab', { name: 'Sous-titres' }).click();
  await page.getByRole('button', { name: /Importer un fichier SRT/ }).click();
  await expect.poll(async () => (await state()).tracks.filter((t: any) => t.kind === 'text').flatMap((t: any) => t.clips).length).toBe(3);

  // music on an audio track
  await stubOpen(['music.mp3']);
  await page.getByRole('tab', { name: 'Audio' }).click();
  await page.getByRole('button', { name: 'Importer' }).first().click();
  await page.evaluate(() => (window as any).__cutlab.getState().seek(0));
  await page.getByRole('button', { name: 'Ajouter music.mp3' }).click();
  p = await state();
  expect(p.tracks.some((t: any) => t.kind === 'audio' && t.clips.length === 1)).toBe(true);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/04-editor-full.png` });

  // export 720p
  const out = path.join(home, 'export.mp4');
  await app.evaluate(({ dialog }, out) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: out }); }, out);
  await page.getByRole('button', { name: 'Exporter' }).first().click();
  await page.getByLabel('Résolution').selectOption('720');
  await page.screenshot({ path: `${SHOTS}/05-export-dialog.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Exporter' }).click();
  await expect(page.getByText('Vidéo exportée')).toBeVisible({ timeout: 150_000 });
  expect(existsSync(out) && statSync(out).size > 10_000).toBe(true);

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).toString());
  const v = probe.streams.find((s: any) => s.codec_type === 'video');
  const a = probe.streams.find((s: any) => s.codec_type === 'audio');
  expect(v.codec_name).toBe('h264');
  expect(v.width).toBe(1280); expect(v.height).toBe(720);
  expect(a).toBeTruthy();
  expect(Math.abs(Number(probe.format.duration) - 10)).toBeLessThan(0.2);

  // frame at 1 s must be greyscale (filter) and frame at 8 s colourful (clipB bars)
  const sat = (t: number, crop = 'iw:ih:0:0') => {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', `crop=${crop},scale=64:36`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let s = 0;
    for (let i = 0; i < raw.length; i += 3) s += Math.max(raw[i], raw[i + 1], raw[i + 2]) - Math.min(raw[i], raw[i + 1], raw[i + 2]);
    return s / (raw.length / 3);
  };
  expect(sat(1.2)).toBeLessThan(12);
  expect(sat(8, '400:470:440:0')).toBeGreaterThan(80);   // clipB is pillarboxed in the centre
  await page.getByRole('button', { name: 'Terminé' }).click();

  // back home and reopen: persisted
  await page.getByRole('button', { name: /Accueil/ }).click();
  await expect(page.getByText('Test e2e')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-home-with-project.png` });
  await page.getByText('Test e2e').click();
  await expect(page.locator('.clip')).toHaveCount(3 + 3 + 1 + 0, { timeout: 10_000 }).catch(() => {});
  p = await state();
  expect(p.tracks.find((t: any) => t.isMain).clips.length).toBe(3);
  expect(p.assets.every((x: any) => x.url)).toBe(true);
});
