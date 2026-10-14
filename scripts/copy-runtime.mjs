// Copies the WebAssembly runtimes the app loads at run time from node_modules into public/
// (they are big and versioned with the packages, so they are not committed).
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const copy = (fromDir, toDir, filter) => {
  mkdirSync(join(root, toDir), { recursive: true });
  for (const f of readdirSync(join(root, fromDir)).filter(filter)) cpSync(join(root, fromDir, f), join(root, toDir, f));
};
copy('node_modules/onnxruntime-web/dist', 'public/ort', f => f.startsWith('ort-wasm-simd-threaded.jsep.'));
copy('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', () => true);
console.log('runtime wasm copied to public/');
