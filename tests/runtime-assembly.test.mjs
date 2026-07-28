import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const assembly = await readFile('scripts/assemble-stage4.mjs', 'utf8');
assert.doesNotMatch(assembly, /source-parts\/cursive-font-v2\.js/);
assert.doesNotMatch(assembly, /source-parts\/cursive-app-v4\.js/);
for (const name of [
  'src/cursive-font-core.js', 'src/cursive-font-v3.js', 'src/cursive-font.js',
  'src/font-library.js', 'src/public-library-client.js', 'cursive-app.js',
  'cursive-ui-polish.js', 'ui-flow.js', 'library-bridge.js', 'library.js',
  'public-library.js', 'server.mjs',
]) assert.ok(assembly.includes(name), `${name} is missing from runtime verification`);
assert.match(assembly, /Duplicate source part number/);
assert.match(assembly, /Missing or unordered source part/);
assert.match(assembly, /startNumber !== 0 && startNumber !== 1/);
assert.match(assembly, /spawnSync\(process\.execPath, \['--check'/);

function partNumber(name) {
  const match = /^(\d+)(?:\.gz\.b64|\.txt)$/.exec(name);
  return match ? Number(match[1]) : null;
}

for (const directory of ['source-parts/app.js', 'source-parts/font-app.js', 'source-parts/stage4-app.js', 'source-parts/font-builder.js']) {
  const numbers = (await readdir(directory)).map(partNumber).filter(Number.isInteger).sort((a, b) => a - b);
  assert.ok(numbers.length > 0, `${directory} has no source parts`);
  assert.ok(numbers[0] === 0 || numbers[0] === 1, `${directory} must start at 0 or 1`);
  assert.equal(new Set(numbers).size, numbers.length, `${directory} has duplicate part numbers`);
  numbers.forEach((number, index) => assert.equal(number, numbers[0] + index, `${directory} has a missing part`));
}

const directJs = [
  'src/cursive-font-core.js', 'src/cursive-font-v3.js', 'src/cursive-font.js',
  'src/font-library.js', 'src/public-library-client.js', 'cursive-app.js',
  'cursive-ui-polish.js', 'ui-flow.js', 'library-bridge.js', 'library.js',
  'public-library.js', 'server.mjs',
];
for (const file of directJs) {
  const source = await readFile(file, 'utf8');
  assert.ok(source.length > 100, `${file} is unexpectedly empty`);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, `${file} syntax error: ${check.stderr}`);
}

const legacyCore = await readFile('src/cursive-font-core.js', 'utf8');
const descenderCore = await readFile('src/cursive-font-v3.js', 'utf8');
const wrapper = await readFile('src/cursive-font.js', 'utf8');
const libraryStorage = await readFile('src/font-library.js', 'utf8');
const publicClient = await readFile('src/public-library-client.js', 'utf8');
const app = await readFile('cursive-app.js', 'utf8');
const polish = await readFile('cursive-ui-polish.js', 'utf8');
const workflow = await readFile('ui-flow.js', 'utf8');
const libraryBridge = await readFile('library-bridge.js', 'utf8');
const libraryPage = await readFile('library.js', 'utf8');
const publicPage = await readFile('public-library.js', 'utf8');
const libraryHtml = await readFile('library.html', 'utf8');
const server = await readFile('server.mjs', 'utf8');
const templateApp = await readFile('template-app.js', 'utf8');
assert.match(legacyCore, /function buildGsub\(/);
assert.match(descenderCore, /DESCENDER_LETTERS/);
assert.match(descenderCore, /function vectorizeBaselineGlyph/);
assert.match(descenderCore, /baseline - point\.y/);
assert.match(descenderCore, /function buildGpos\(/);
assert.match(wrapper, /from '\.\/cursive-font-v3\.js'/);
assert.match(wrapper, /restrictCursiveFeatureLookups/);
assert.match(wrapper, /\[1, 3, 5\]/);
assert.match(app, /cursiveDescenderPreset/);
assert.match(polish, /cursiveDisclosureToggle/);
assert.match(polish, /canvas\.dataset\.lines/);
assert.match(workflow, /Как вам удобнее создать шрифт/);
assert.match(workflow, /scannerUnlocked/);
assert.match(templateApp, /drawyourfont:template-downloaded/);
assert.match(libraryStorage, /indexedDB\.open/);
assert.match(libraryStorage, /transactionDone/);
assert.match(libraryBridge, /Добавить в мою библиотеку/);
assert.match(libraryBridge, /Опубликовать в общей библиотеке/);
assert.match(libraryBridge, /publishFont/);
assert.match(libraryPage, /new FontFace/);
assert.match(publicPage, /listPublicFonts/);
assert.match(publicPage, /publicFileUrl/);
assert.match(publicClient, /buildPublicationPayload/);
assert.match(publicClient, /rememberPublicationOwnership/);
assert.match(libraryHtml, /Моя библиотека/);
assert.match(libraryHtml, /Общая библиотека/);
assert.match(server, /createDrawYourFontServer/);
assert.match(server, /validateSignature/);
assert.match(server, /MAX_JSON_BYTES/);

const stage4 = await readFile('stage4-app.js', 'utf8');
assert.match(stage4, /import '\.\/cursive-app\.js';/);
assert.match(stage4, /import '\.\/cursive-ui-polish\.js';/);
assert.match(stage4, /import '\.\/ui-flow\.js';/);
assert.match(stage4, /import '\.\/library-bridge\.js';/);
assert.match(stage4, /link\.href = '\.\/cursive\.css'/);
console.log('Runtime assembly, local library and shared library regression test: PASS');
