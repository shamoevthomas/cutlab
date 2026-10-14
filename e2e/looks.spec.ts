// Adjustment layer + LUT, filter previews, categorised transitions (iris), checked on the exported pixels.
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIX = path.resolve('e2e/fixtures');
const SHOTS = path.resolve('replica/test/shots');
let app: ElectronApplication;
let page: Page;
let home: string;
const stubOpen = (files: string[]) => app.evaluate(({ dialog }, files) => { (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files.map(f => path.join(FIX, f)));
const state = () => page.evaluate(() => (window as any).__cutlab.getState().project);
const seek = (us: number) => page.evaluate((t) => (window as any).__cutlab.getState().seek(t), us);
const select = (ids: string[]) => page.evaluate((ids) => (window as any).__cutlab.getState().select(ids), ids);

test.beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cutlab-home-'));
  app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, HOME: home } as any });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
});
test.afterAll(async () => { await app?.close(); });

test('adjustment layer with LUT, filters with previews, iris transition', async () => {
  test.setTimeout(300_000);
  await page.getByRole('button', { name: 'Créer un projet' }).click();
  await page.getByLabel('Nom').fill('Looks');
  await page.getByRole('radio', { name: /16:9/ }).click();
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await stubOpen(['blue.png', 'clipA.mp4']);
  await page.getByRole('button', { name: 'Importer' }).first().click();
  await expect(page.locator('.asset-tile')).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Ajouter blue.png' }).click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Ajouter clipA.mp4' }).click();
  const main = async () => (await state()).tracks.find((t: any) => t.isMain).clips;
  expect((await main()).length).toBe(2);

  // LUT on a new adjustment layer (nothing selected)
  await select([]); await seek(0);
  await page.getByRole('tab', { name: 'Réglages' }).click();
  await page.getByRole('button', { name: 'LUT', exact: true }).click();
  await stubOpen(['swap_rb.cube']);
  await page.getByRole('button', { name: /Importer une LUT/ }).click();
  await page.getByRole('button', { name: 'Appliquer' }).click();
  const adj = (await state()).tracks.find((t: any) => t.kind === 'adjustment');
  expect(adj.clips[0].effects[0].kind).toBe('lut');
  expect(adj.clips[0].durationUs).toBe(5_000_000);
  await page.screenshot({ path: `${SHOTS}/13-adjustment-lut.png` });

  // filter tab: real previews, black & white on clipA
  const [, clipA] = await main();
  await select([clipA.id]);
  await page.getByRole('tab', { name: 'Filtres' }).click();
  await page.getByRole('button', { name: 'Mono' }).click();
  await expect.poll(async () => page.locator('.filter-tile .ft-img').first().evaluate(e => getComputedStyle(e).backgroundImage), { timeout: 15_000 }).toContain('data:image/jpeg');
  await page.screenshot({ path: `${SHOTS}/14-filters-categories.png` });
  await page.getByRole('button', { name: 'Filtre Noir & blanc' }).click();

  // iris between the image and clipA
  const [img] = await main();
  await select([img.id]);
  await page.getByRole('tab', { name: 'Transitions' }).click();
  await page.getByRole('button', { name: 'Volets' }).click();
  await page.getByRole('button', { name: 'Transition Cercle' }).click();
  expect((await state()).transitions[0].kind).toBe('iris');
  await page.locator('.tr-iris').first().hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/15-transitions-categories.png` });

  // export and read pixels
  const out = path.join(home, 'looks.mp4');
  await app.evaluate(({ dialog }, f) => { (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: f }); }, out);
  await page.getByRole('button', { name: 'Exporter' }).first().click();
  await page.getByLabel('Résolution').selectOption('720');
  await page.getByRole('dialog').getByRole('button', { name: 'Exporter' }).click();
  await expect(page.getByText('Vidéo exportée')).toBeVisible({ timeout: 150_000 });
  const rgb = (t: number, x: number, y: number) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', `crop=8:8:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  const blueSwapped = rgb(1, 636, 356);
  console.log('t=1 centre', blueSwapped, '| t=3 corner', rgb(3, 20, 20), 'centre', rgb(3, 636, 356));
  expect(blueSwapped[0]).toBeGreaterThan(200); expect(blueSwapped[2]).toBeLessThan(40);   // blue image → red through the LUT
  const corner = rgb(3, 20, 20), centre = rgb(3, 636, 356);
  expect(corner[0]).toBeGreaterThan(180);                                                 // outside the iris: still the (red) image
  expect(Math.max(...centre) - Math.min(...centre)).toBeLessThan(25);                     // inside: clipA in black & white
});
