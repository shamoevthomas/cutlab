// ProRes import via ffmpeg, noise reduction, crop, MOV/AAC export, missing media + relink.
import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchApp, FFMPEG, FFPROBE } from './helpers';

const FIX = path.resolve('e2e/fixtures');
const SHOTS = path.resolve('replica/test/shots');
let app: ElectronApplication;
let page: Page;
let home: string;

async function launch() {
  app = await launchApp(home);
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
}
const stubOpen = (files: string[]) => app.evaluate(({ dialog }, files) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
const stubSave = (file: string) => app.evaluate(({ dialog }, f) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
const state = () => page.evaluate(() => (window as any).__cutlab.getState().project);
function volume(file: string, ss: number, t: number): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  return Number(/mean_volume: (-?[\d.]+)/.exec(r.stderr.toString())![1]);
}

test.beforeAll(async () => { home = mkdtempSync(path.join(tmpdir(), 'cutlab-home-')); await launch(); });
test.afterAll(async () => { await app?.close(); });

test('ProRes, noise reduction, crop, MOV export, relink', async () => {
  test.setTimeout(400_000);
  await page.getByRole('button', { name: 'Créer un projet' }).click();
  await page.getByLabel('Nom').fill('Polish');
  await page.getByRole('radio', { name: /16:9/ }).click();
  await page.getByRole('button', { name: 'Créer', exact: true }).click();

  // a copy of the noisy rush we can delete later to test relinking
  const movable = path.join(home, 'rush_noisy_copy.mp4');
  copyFileSync(path.join(FIX, 'rush_noisy.mp4'), movable);
  await stubOpen([path.join(FIX, 'prores.mov'), movable]);
  await page.getByRole('button', { name: 'Importer' }).first().click();
  await expect(page.locator('.asset-tile')).toHaveCount(2, { timeout: 60_000 });
  const pr = (await state()).assets.find((a: any) => a.name === 'prores.mov');
  expect(pr.path.endsWith('.mp4')).toBe(true);   // converted by ffmpeg
  expect(pr.width).toBe(320);

  // noisy rush on the timeline, clean its sound
  await page.getByRole('button', { name: 'Ajouter rush_noisy_copy.mp4' }).click();
  await page.locator('.insp-tab', { hasText: 'Audio' }).click();
  await page.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText('appliqué')).toBeVisible({ timeout: 120_000 });
  expect((await state()).tracks.find((t: any) => t.isMain).clips[0].audioAssetId).toBeTruthy();

  // crop to 1:1 (rush is 9:16 inside a 16:9 project)
  await page.locator('.insp-tab', { hasText: 'Vidéo' }).click();
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  const crop = (await state()).tracks.find((t: any) => t.isMain).clips[0].crop;
  expect(crop.t).toBeGreaterThan(0.1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/11-crop-and-clean-audio.png` });

  // MOV export with AAC audio
  const out = path.join(home, 'polish.mp4');
  await stubSave(out);
  await page.getByRole('button', { name: 'Exporter' }).first().click();
  await page.getByLabel('Résolution').selectOption('720');
  await page.getByRole('dialog').getByLabel('Format du fichier').selectOption('mov');
  await page.getByRole('dialog').getByRole('button', { name: 'Exporter' }).click();
  await expect(page.getByText('Vidéo exportée')).toBeVisible({ timeout: 200_000 });
  await page.getByRole('button', { name: 'Terminé' }).click();
  const mov = path.join(home, 'polish.mov');
  const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mov]).toString());
  expect(probe.format.format_name).toContain('mov');
  expect(probe.streams.find((s: any) => s.codec_type === 'audio').codec_name).toBe('aac');
  // noise in the 1.8 s pause (6.2–7.9 s) must be much lower than in the source
  const before = volume(path.join(FIX, 'rush_noisy.mp4'), 6.4, 1.2), after = volume(mov, 6.4, 1.2);
  console.log('noise in pause: before', before, 'dB, after', after, 'dB');
  expect(after).toBeLessThan(before - 8);
  // crop: the 1:1 square is 720 px wide in a 1280 frame → columns at x=200 are black, centre is not
  const px = (x: number) => [...execFileSync(FFMPEG, ['-v', 'error', '-ss', '2', '-i', mov, '-frames:v', '1', '-vf', `crop=4:4:${x}:358,scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  expect(Math.max(...px(200))).toBeLessThan(20);
  expect(Math.max(...px(640))).toBeGreaterThan(40);

  // relink: delete the file, reopen → missing; reconnect → back
  await page.getByRole('button', { name: /Accueil/ }).click();
  rmSync(movable, { maxRetries: 20, retryDelay: 250 });   // Windows may hold the file a moment longer
  await page.getByText('Polish').click();
  await expect(page.getByText('Fichier introuvable').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/12-missing-media.png` });
  await stubOpen([path.join(FIX, 'rush_noisy.mp4')]);
  await page.getByRole('button', { name: 'Reconnecter' }).click();
  await expect(page.getByText('Fichier introuvable')).toHaveCount(0, { timeout: 20_000 });
  expect((await state()).assets.filter((a: any) => !a.url)).toHaveLength(0);
});
