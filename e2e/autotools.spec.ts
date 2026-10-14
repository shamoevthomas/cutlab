// Phase 2: silence removal and local Whisper captions on a real speech rush.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIX = path.resolve('e2e/fixtures');
const SHOTS = path.resolve('replica/test/shots');
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'cutlab-home-'));
  app = await electron.launch({ args: ['.', '--no-sandbox', ...(process.env.CUTLAB_TEST_INSECURE ? ['--ignore-certificate-errors'] : [])], env: { ...process.env, HOME: home } as any });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
});
test.afterAll(async () => { await app?.close(); });

test('auto-cut silences then auto captions (Whisper base, local)', async () => {
  test.setTimeout(600_000);
  await page.getByRole('button', { name: 'Créer un projet' }).click();
  await page.getByLabel('Nom').fill('Rush parole');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await app.evaluate(({ dialog }, f) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, path.join(FIX, 'rush.mp4'));
  await page.getByRole('button', { name: 'Importer' }).first().click();
  await page.getByRole('button', { name: 'Ajouter rush.mp4' }).click();
  const state = () => page.evaluate(() => (window as any).__cutlab.getState().project);
  const before = (await state()).tracks.find((t: any) => t.isMain).clips[0].durationUs;
  expect(before).toBeGreaterThan(10_000_000);

  // --- coupe des blancs
  await page.getByRole('button', { name: 'Coupe des blancs' }).click();
  await page.getByRole('button', { name: 'Analyser' }).click();
  const cutBtn = page.getByRole('button', { name: /Couper \d+ passage/ });
  await expect(cutBtn).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/07-autocut-dialog.png` });
  await cutBtn.click();
  const main = (await state()).tracks.find((t: any) => t.isMain);
  const after = main.clips.reduce((s: number, c: any) => s + c.durationUs, 0);
  console.log('clips after cut', main.clips.length, 'duration', after / 1e6, 'removed', (before - after) / 1e6);
  // reference (ffmpeg silencedetect -38 dB / 0.5 s): 5 pauses, 5.2 s in total, minus 0.12 s kept on each side
  expect(main.clips.length).toBe(6);
  expect((before - after) / 1e6).toBeGreaterThan(3.5);
  expect((before - after) / 1e6).toBeLessThan(5.3);

  // --- sous-titres auto
  await page.getByRole('tab', { name: 'Sous-titres' }).click();
  await page.getByRole('button', { name: 'Générer les sous-titres' }).click();
  await expect.poll(async () => (await state()).tracks.filter((t: any) => t.role === 'captions').flatMap((t: any) => t.clips).length, { timeout: 480_000, intervals: [2000] }).toBeGreaterThan(2);
  const caps = (await state()).tracks.filter((t: any) => t.role === 'captions').flatMap((t: any) => t.clips);
  console.log('captions:', caps.map((c: any) => `[${(c.startUs / 1e6).toFixed(2)}] ${c.text.content}`).join(' | '));
  const text = caps.map((c: any) => c.text.content).join(' ').toLowerCase();
  expect(text).toMatch(/[a-zàâéèêëîïôûùç]{3,}/);
  await page.evaluate((t) => (window as any).__cutlab.getState().seek(t), caps[1].startUs + 100_000);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/08-auto-captions.png` });
});
