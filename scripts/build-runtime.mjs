import './assemble-stage4.mjs';
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'vendor'), { recursive: true });
await build({
  entryPoints: [resolve(root, 'scripts/woff2-entry.js')],
  outfile: resolve(root, 'vendor/woff2-codec.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
});
await copyFile(resolve(root, 'node_modules/fonteditor-core/woff2/woff2.wasm'), resolve(root, 'vendor/woff2.wasm'));
console.log('Local WOFF2 runtime prepared.');
