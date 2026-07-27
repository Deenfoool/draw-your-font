import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ['source-parts/app.js', 'app.js'],
  ['source-parts/font-app.js', 'font-app.js'],
  ['source-parts/stage4-app.js', 'stage4-app.js'],
  ['source-parts/font-builder.js', 'src/font-builder.js'],
];

for (const [partsDirectory, outputPath] of targets) {
  const directory = resolve(root, partsDirectory);
  const parts = (await readdir(directory)).filter((name) => /^(?:\d+)(?:\.gz\.b64|\.txt)$/.test(name)).sort();
  if (!parts.length) throw new Error(`No source parts found in ${partsDirectory}`);
  const encoded = (await Promise.all(parts.map((name) => readFile(resolve(directory, name), 'utf8')))).join('').replace(/\s+/g, '');
  let source = gunzipSync(Buffer.from(encoded, 'base64'));
  if (outputPath === 'stage4-app.js') {
    source = Buffer.concat([source, Buffer.from("\nimport './stage4-recovery-app.js';\n", 'utf8')]);
  }
  await writeFile(resolve(root, outputPath), source);
  console.log(`Assembled ${outputPath} (${source.length} bytes).`);
}
