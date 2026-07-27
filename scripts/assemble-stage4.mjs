import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
const directSources = [
  'src/cursive-font-core.js',
  'src/cursive-font-v3.js',
  'src/cursive-font.js',
  'cursive-app.js',
];

function partNumber(name) {
  const match = /^(\d+)(?:\.gz\.b64|\.txt)$/.exec(name);
  return match ? Number(match[1]) : null;
}

function validatePartSequence(partsDirectory, parts) {
  if (!parts.length) throw new Error(`No source parts found in ${partsDirectory}`);

  const numbers = parts.map((part) => part.number);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    throw new Error(`Duplicate source part number in ${partsDirectory}: ${numbers.join(', ')}`);
  }

  const startNumber = numbers[0];
  if (startNumber !== 0 && startNumber !== 1) {
    throw new Error(`Unsupported source part numbering in ${partsDirectory}: expected first part 0 or 1, got ${startNumber}`);
  }

  for (let index = 0; index < numbers.length; index += 1) {
    const expected = startNumber + index;
    if (numbers[index] !== expected) {
      throw new Error(`Missing or unordered source part in ${partsDirectory}: expected ${expected}, got ${numbers[index]}`);
    }
  }

  return { startNumber, numbers };
}

for (const [partsDirectory, outputPath] of targets) {
  const directory = resolve(root, partsDirectory);
  const parts = (await readdir(directory))
    .map((name) => ({ name, number: partNumber(name) }))
    .filter((part) => Number.isInteger(part.number))
    .sort((left, right) => left.number - right.number || left.name.localeCompare(right.name));

  const { startNumber } = validatePartSequence(partsDirectory, parts);
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
  console.log(`Assembled ${outputPath} (${source.length} bytes, ${parts.length} verified parts, numbering starts at ${startNumber}).`);
}

for (const relativePath of directSources) {
  const absolutePath = resolve(root, relativePath);
  const source = await readFile(absolutePath);
  if (!source.length) throw new Error(`Direct source is empty: ${relativePath}`);
  const syntax = spawnSync(process.execPath, ['--check', absolutePath], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(`Syntax check failed for ${relativePath}: ${syntax.stderr || syntax.stdout}`);
  const digest = createHash('sha256').update(source).digest('hex');
  console.log(`Verified ${relativePath} (${source.length} bytes, sha256 ${digest}).`);
}
