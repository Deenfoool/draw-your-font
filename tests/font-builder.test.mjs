import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  maskToContours,
  createGlyphSet,
  buildTrueTypeFont,
  buildWoffFont,
  buildFontCss,
  buildStoredZip,
  parseSfntTables,
  validateTrueType,
} from '../src/font-builder.js';

function makeSource() {
  const width = 120;
  const height = 80;
  const mask = new Uint8Array(width * height);
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) mask[y * width + x] = 1;
  };
  rect(8, 15, 38, 65);
  rect(18, 30, 28, 50);
  rect(55, 18, 91, 65);
  for (let y = 31; y <= 49; y += 1) for (let x = 66; x <= 80; x += 1) mask[y * width + x] = 0;
  rect(60, 8, 66, 13);
  rect(80, 8, 86, 13);
  return {
    width,
    height,
    mask,
    glyphs: [
      { x0: 8, y0: 15, x1: 38, y1: 65 },
      { x0: 55, y0: 8, x1: 91, y1: 65 },
    ],
    labels: ['А', 'Ё'],
  };
}

{
  const width = 20;
  const height = 20;
  const mask = new Uint8Array(width * height);
  for (let y = 2; y <= 17; y += 1) for (let x = 2; x <= 17; x += 1) mask[y * width + x] = 1;
  for (let y = 7; y <= 12; y += 1) for (let x = 7; x <= 12; x += 1) mask[y * width + x] = 0;
  const contours = maskToContours(mask, width, height, { simplify: 0 });
  assert.equal(contours.length, 2);
  assert.ok(contours.every((contour) => contour.length >= 4));
}

const source = makeSource();
const glyphSet = createGlyphSet(source, { detail: 96, simplify: 0.4, sideBearing: 60 });
assert.equal(glyphSet.glyphs.length, 4);
assert.deepEqual(glyphSet.entries.map((entry) => entry.codepoint), [0x0401, 0x0410]);
assert.equal(glyphSet.duplicates.length, 0);

{
  const duplicate = createGlyphSet({ ...source, labels: ['А', 'А'] });
  assert.equal(duplicate.entries.length, 1);
  assert.deepEqual(duplicate.duplicates, ['А']);
}

const ttf = buildTrueTypeFont(glyphSet.glyphs, { familyName: 'Тестовый почерк', styleName: 'Regular', version: '1.000' });
assert.equal(validateTrueType(ttf).length, 0, validateTrueType(ttf).join('\n'));
const parsed = parseSfntTables(ttf);
assert.deepEqual(parsed.tables.map((table) => table.tag).sort(), ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
assert.ok(ttf.length > 500);

const woff = await buildWoffFont(ttf, { compress: false });
assert.equal(String.fromCharCode(...woff.slice(0, 4)), 'wOFF');
assert.equal(new DataView(woff.buffer, woff.byteOffset, woff.byteLength).getUint16(12, false), parsed.tables.length);

const css = buildFontCss('Тестовый почерк', 'test-handwriting');
assert.match(css, /format\('woff2'\)/);
assert.match(css, /test-handwriting\.ttf/);
const zip = buildStoredZip([
  { name: 'test-handwriting.ttf', data: ttf },
  { name: 'test-handwriting.woff', data: woff },
  { name: 'font.css', data: css },
]);
assert.equal(new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint32(0, true), 0x04034b50);
assert.ok(zip.length > ttf.length + woff.length);

const outputDir = path.resolve('tests/output');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'stage3-test.ttf'), ttf);
fs.writeFileSync(path.join(outputDir, 'stage3-test.woff'), woff);
fs.writeFileSync(path.join(outputDir, 'stage3-test.zip'), zip);
console.log('All 6 font builder tests passed.');
