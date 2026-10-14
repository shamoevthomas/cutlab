// Shared by the end-to-end specs: bundled ffmpeg/ffprobe (same on Windows, macOS, Linux) and app launch.
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const FFMPEG: string = require('ffmpeg-static');
export const FFPROBE: string = require('ffprobe-static').path;

/** Launch the built app with its data folder redirected to `dataDir`. */
export function launchApp(dataDir: string) {
  const extra = process.env.CUTLAB_TEST_INSECURE ? ['--ignore-certificate-errors'] : [];
  return electron.launch({ args: ['.', '--no-sandbox', ...extra], env: { ...process.env, CUTLAB_DATA_DIR: dataDir } as any });
}
