import { createHash } from 'node:crypto';
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
  ['source-parts/cursive-font-v2.js', 'src/cursive-font.js'],
  ['source-parts/cursive-app-v3.js', 'cursive-app.js'],
];
const expectedSha256 = new Map([
  ['src/cursive-font.js', '3f06335a69cc08cab9bec6c4f50925c9b6ff70c9b7fbd88bb4a5600ebf86b857'],
  ['cursive-app.js', '3df5c18bfb07cf946a31f0ff9365bbdccffeb816f4a63cac1602d9df89612822'],
]);

for (const [partsDirectory, outputPath] of targets) {
  const directory = resolve(root, partsDirectory);
  const parts = (await readdir(directory)).filter((name) => /^(?:\d+)(?:\.gz\.b64|\.txt)$/.test(name)).sort();
  if (!parts.length) throw new Error(`No source parts found in ${partsDirectory}`);
  const encoded = (await Promise.all(parts.map((name) => readFile(resolve(directory, name), 'utf8')))).join('').replace(/\s+/g, '');
  let source = gunzipSync(Buffer.from(encoded, 'base64'));
  if (outputPath === 'stage4-app.js') {
    source = Buffer.concat([source, Buffer.from("\nimport './stage4-recovery-app.js';\nimport './cursive-app.js';\n", 'utf8')]);
  }
  const expected = expectedSha256.get(outputPath);
  if (expected) {
    const actual = createHash('sha256').update(source).digest('hex');
    if (actual !== expected) throw new Error(`SHA-256 mismatch for ${outputPath}: ${actual}`);
  }
  await writeFile(resolve(root, outputPath), source);
  console.log(`Assembled ${outputPath} (${source.length} bytes).`);
}
