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
];
const directSources = new Map([
  ['src/cursive-font.js', '7c6bcf6867b11d6bd4fdc038daf47715c671bdbb3b1a5414682c77111de716b4'],
  ['cursive-app.js', '1f39268d2eaa053d57227380a703089ead7b63098c109276edc7298ecce62968'],
]);

function partNumber(name) {
  const match = /^(\d+)(?:\.gz\.b64|\.txt)$/.exec(name);
  return match ? Number(match[1]) : null;
}

for (const [partsDirectory, outputPath] of targets) {
  const directory = resolve(root, partsDirectory);
  const parts = (await readdir(directory))
    .map((name) => ({ name, number: partNumber(name) }))
    .filter((part) => Number.isInteger(part.number))
    .sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));

  if (!parts.length) throw new Error(`No source parts found in ${partsDirectory}`);
  const numbers = parts.map((part) => part.number);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) throw new Error(`Duplicate source part number in ${partsDirectory}: ${numbers.join(', ')}`);
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) throw new Error(`Missing or unordered source part in ${partsDirectory}: expected ${index + 1}, got ${numbers[index]}`);
  }

  const chunks = await Promise.all(parts.map(({ name }) => readFile(resolve(directory, name), 'utf8')));
  const encoded = chunks.join('').replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(encoded)) {
    throw new Error(`Invalid base64 source stream in ${partsDirectory}`);
  }

  let source;
  try {
    source = gunzipSync(Buffer.from(encoded, 'base64'));
  } catch (error) {
    throw new Error(`Cannot assemble ${outputPath} from ${partsDirectory}: ${error.message}`, { cause: error });
  }
  if (outputPath === 'stage4-app.js') {
    source = Buffer.concat([source, Buffer.from(`
import './stage4-recovery-app.js';
import './cursive-app.js';
if (!document.querySelector('link[data-dyfr-cursive]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './cursive.css';
  link.dataset.dyfrCursive = '1';
  document.head.append(link);
}
`, 'utf8')]);
  }
  await writeFile(resolve(root, outputPath), source);
  console.log(`Assembled ${outputPath} (${source.length} bytes, ${parts.length} verified parts).`);
}

for (const [relativePath, expected] of directSources) {
  const source = await readFile(resolve(root, relativePath));
  const actual = createHash('sha256').update(source).digest('hex');
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${relativePath}: ${actual}`);
  console.log(`Verified ${relativePath} (${source.length} bytes).`);
}
