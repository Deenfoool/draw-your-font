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
  'src/russian-joining.js',
  'src/cursive-font.js',
  'src/font-library.js',
  'src/public-library-client.js',
  'src/recognition-v2.js',
  'cursive-app.js',
  'cursive-ui-polish.js',
  'ui-flow.js',
  'library-bridge.js',
  'library.js',
  'public-library.js',
  'server.mjs',
];

function partNumber(name) {
  const match = /^(\d+)(?:\.gz\.b64|\.txt)$/.exec(name);
  return match ? Number(match[1]) : null;
}

function validatePartSequence(partsDirectory, parts) {
  if (!parts.length) throw new Error(`No source parts found in ${partsDirectory}`);
  const numbers = parts.map((part) => part.number);
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) throw new Error(`Duplicate source part number in ${partsDirectory}: ${numbers.join(', ')}`);
  const startNumber = numbers[0];
  if (startNumber !== 0 && startNumber !== 1) throw new Error(`Unsupported source part numbering in ${partsDirectory}: expected first part 0 or 1, got ${startNumber}`);
  for (let index = 0; index < numbers.length; index += 1) {
    const expected = startNumber + index;
    if (numbers[index] !== expected) throw new Error(`Missing or unordered source part in ${partsDirectory}: expected ${expected}, got ${numbers[index]}`);
  }
  return { startNumber, numbers };
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Cannot patch app.js: ${label}`);
  return source.replace(search, replacement);
}

function patchRecognitionEngine(sourceBuffer) {
  let source = sourceBuffer.toString('utf8');
  source = replaceRequired(
    source,
    "} from './src/segmentation.js';",
    "} from './src/segmentation.js';\nimport { annotateGlyphConfidence, recognizeGrayscale } from './src/recognition-v2.js';",
    'segmentation import not found',
  );
  source = replaceRequired(
    source,
    'const analysis = segmentGrayscale(state.grayscale, width, height, currentOptions());',
    'const analysis = recognizeGrayscale(state.grayscale, width, height, { ...currentOptions(), expectedCount: getCharset().length });',
    'analysis call not found',
  );
  source = replaceRequired(
    source,
    "state.labels = state.glyphs.map((_, index) => charset[index] || '');\n  renderGlyphGrid();",
    "state.labels = state.glyphs.map((_, index) => charset[index] || '');\n  if (state.analysis) state.glyphs = annotateGlyphConfidence(state.glyphs, state.analysis.mask, state.sourceImageData.width, state.sourceImageData.height, state.labels);\n  renderGlyphGrid();",
    'label assignment not found',
  );
  source = replaceRequired(
    source,
    'function renderAll() {\n  renderStats();',
    "function renderAll() {\n  if (state.analysis && state.sourceImageData) state.glyphs = annotateGlyphConfidence(state.glyphs, state.analysis.mask, state.sourceImageData.width, state.sourceImageData.height, state.labels);\n  renderStats();",
    'renderAll function not found',
  );
  source = replaceRequired(
    source,
    "const text = `${index + 1}${state.labels[index] ? ` · ${state.labels[index]}` : ''}`;",
    "const confidence = glyph.confidence?.score;\n    const text = `${index + 1}${state.labels[index] ? ` · ${state.labels[index]}` : ''}${Number.isFinite(confidence) ? ` · ${confidence}%` : ''}`;",
    'overlay label not found',
  );
  source = replaceRequired(
    source,
    "meta.innerHTML = `<span>строка ${glyph.row + 1}</span><span>${glyph.width}×${glyph.height}</span>`;",
    "const confidence = glyph.confidence || { score: 0, level: 'review', reasons: [] };\n    meta.innerHTML = `<span>строка ${glyph.row + 1}</span><span>${glyph.width}×${glyph.height}</span><span class=\"glyph-confidence ${confidence.level}\" title=\"${confidence.reasons.join('. ')}\">${confidence.score}%</span>`;",
    'glyph metadata not found',
  );
  source = replaceRequired(
    source,
    "elements.stats.innerHTML = `<span><strong>${state.glyphs.length}</strong> символов</span><span><strong>${rowCount}</strong> строк</span>`;",
    "const quality = state.analysis?.qualityScore;\n  const method = state.analysis?.method;\n  const reviewCount = state.glyphs.filter(glyph => glyph.confidence?.level !== 'good').length;\n  elements.stats.innerHTML = `<span><strong>${state.glyphs.length}</strong> символов</span><span><strong>${rowCount}</strong> строк</span>${method ? `<span><strong>${method}</strong> метод</span>` : ''}${Number.isFinite(quality) ? `<span><strong>${Math.round(quality)}%</strong> качество</span>` : ''}${reviewCount ? `<span><strong>${reviewCount}</strong> проверить</span>` : ''}`;",
    'stats rendering not found',
  );
  source = replaceRequired(
    source,
    "sourceIds: glyph.sourceIds,\n    })),",
    "sourceIds: glyph.sourceIds,\n      confidence: glyph.confidence || null,\n    })),\n    recognition: { version: state.analysis.recognitionVersion || 1, method: state.analysis.method || 'adaptive', qualityScore: state.analysis.qualityScore ?? null, candidates: state.analysis.candidates || [] },",
    'manifest glyph export not found',
  );
  source += `\nif (!document.querySelector('link[data-dyfr-recognition-v2]')) {\n  const link = document.createElement('link');\n  link.rel = 'stylesheet';\n  link.href = './recognition-v2.css';\n  link.dataset.dyfrRecognitionV2 = '1';\n  document.head.append(link);\n}\n`;
  return Buffer.from(source, 'utf8');
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
  if (!encoded || encoded.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(encoded)) throw new Error(`Invalid base64 source stream in ${partsDirectory}`);
  let source;
  try { source = gunzipSync(Buffer.from(encoded, 'base64')); }
  catch (error) { throw new Error(`Cannot assemble ${outputPath} from ${partsDirectory}: ${error.message}`, { cause: error }); }
  if (outputPath === 'app.js') source = patchRecognitionEngine(source);
  if (outputPath === 'stage4-app.js') {
    source = Buffer.concat([source, Buffer.from(`
import './stage4-recovery-app.js';
import './cursive-app.js';
import './cursive-ui-polish.js';
import './ui-flow.js';
import './library-bridge.js';
if (!document.querySelector('link[data-dyfr-cursive]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './cursive.css';
  link.dataset.dyfrCursive = '1';
  document.head.append(link);
}
`, 'utf8')]);
  }
  const output = resolve(root, outputPath);
  await writeFile(output, source);
  if (outputPath.endsWith('.js')) {
    const syntax = spawnSync(process.execPath, ['--check', output], { encoding: 'utf8' });
    if (syntax.status !== 0) throw new Error(`Syntax check failed for assembled ${outputPath}: ${syntax.stderr || syntax.stdout}`);
  }
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
