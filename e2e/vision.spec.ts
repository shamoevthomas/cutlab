// Phase 3: on-device background removal and face-following reframe on a real interview clip.
import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchApp, FFMPEG } from './helpers';

const FIX = path.resolve('e2e/fixtures');
const SHOTS = path.resolve('replica/test/shots');
let app: ElectronApplication;
let page: Page;
let home: string;

test.beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cutlab-home-'));
  app = await launchApp(home);
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
});
test.afterAll(async () => { await app?.close(); });

const rgbAt = (file: string, t: number, x: number, y: number, w: number, h: number) => {
  const raw = execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=${w}:${h}:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [raw[0], raw[1], raw[2]];
};

test('background removal then auto-reframe to 9:16', async () => {
  test.setTimeout(400_000);
  await page.getByRole('button', { name: 'Créer un projet' }).click();
  await page.getByLabel('Nom').fill('Interview');
  await page.getByRole('radio', { name: /16:9/ }).click();
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await app.evaluate(({ dialog }, f) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, path.join(FIX, 'interview_wide.mp4'));
  await page.getByRole('button', { name: 'Importer' }).first().click();
  await page.getByRole('button', { name: 'Ajouter interview_wide.mp4' }).click();
  const state = () => page.evaluate(() => (window as any).__cutlab.getState().project);

  // ---- background removal
  await page.getByRole('tab', { name: 'Détourage' }).click();
  await page.getByRole('button', { name: 'Supprimer l’arrière-plan' }).click();
  await expect(page.getByText('Inverser (garder le fond)')).toBeVisible({ timeout: 300_000 });
  const p = await state();
  expect(p.assets.some((a: any) => a.derived === 'matte')).toBe(true);
  await page.evaluate(() => (window as any).__cutlab.getState().seek(2_000_000));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/09-background-removed.png` });

  const out = path.join(home, 'matte.mp4');
  await app.evaluate(({ dialog }, out) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: out }); }, out);
  await page.getByRole('button', { name: 'Exporter' }).first().click();
  await page.getByLabel('Résolution').selectOption('720');
  await page.getByRole('dialog').getByRole('button', { name: 'Exporter' }).click();
  await expect(page.getByText('Vidéo exportée')).toBeVisible({ timeout: 200_000 });
  await page.getByRole('button', { name: 'Terminé' }).click();
  // the padded blue-grey band on the left (x < 100) and the bright window (top right) are background → black now
  const band = rgbAt(out, 2, 10, 300, 60, 100);
  const windowArea = rgbAt(out, 2, 1000, 60, 120, 120);
  const shirt = rgbAt(out, 2, 380, 560, 60, 60);   // white shirt, centre-bottom
  console.log('band', band, 'window', windowArea, 'shirt', shirt);
  expect(Math.max(...band)).toBeLessThan(40);
  expect(Math.max(...windowArea)).toBeLessThan(60);
  expect(Math.min(...shirt)).toBeGreaterThan(120);

  // ---- auto reframe into 9:16
  await page.getByRole('tab', { name: 'Vidéo' }).click();
  await page.getByRole('button', { name: 'Passer en 9:16 et recadrer' }).click();
  await expect.poll(async () => (await state()).tracks.find((t: any) => t.isMain).clips[0].keyframes.filter((k: any) => k.property === 'x').length, { timeout: 120_000 }).toBeGreaterThan(0);
  const c = (await state()).tracks.find((t: any) => t.isMain).clips[0];
  const xs = c.keyframes.filter((k: any) => k.property === 'x').map((k: any) => k.value);
  const avg = xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
  console.log('reframe keyframes', xs.length, 'avg x', avg.toFixed(2), 'scale', c.transform.scale.toFixed(2));
  expect((await state()).canvas.height).toBe(1920);
  expect(avg).toBeGreaterThan(0.8);   // face sits ~0.3 of the width → frame shifted right
  expect(avg).toBeLessThan(1.7);
  await page.evaluate(() => (window as any).__cutlab.getState().seek(2_000_000));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/10-auto-reframe-916.png` });
});
