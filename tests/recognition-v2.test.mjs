import assert from 'node:assert/strict';
import {
  annotateGlyphConfidence,
  assessGlyphConfidence,
  otsuBinarize,
  recognizeGlyphCell,
  recognizeGrayscale,
  sauvolaBinarize,
} from '../src/recognition-v2.js';
import { extractGlyphsFromRectified } from '../src/template-scanner.js';

const width = 180;
const height = 90;
const gray = new Uint8Array(width * height);
for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
  const shadow = Math.round(25 * (x / width) + 18 * (y / height));
  gray[y * width + x] = Math.min(255, 230 + shadow);
}

function inkRect(x0, y0, x1, y1, value = 42) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) gray[y * width + x] = value;
}

// Three synthetic handwritten glyphs with one-pixel breaks and a long guide.
for (const offset of [15, 70, 125]) {
  inkRect(offset, 20, offset + 3, 66);
  inkRect(offset + 25, 20, offset + 28, 66);
  inkRect(offset, 20, offset + 28, 23);
  inkRect(offset, 63, offset + 28, 66);
  gray[43 * width + offset] = 235;
  gray[43 * width + offset + 28] = 235;
}
for (let x = 0; x < width; x += 1) gray[76 * width + x] = 150;

const sauvola = sauvolaBinarize(gray, width, height);
const otsu = otsuBinarize(gray, width, height);
assert.equal(sauvola.mask.length, width * height);
assert.equal(otsu.mask.length, width * height);
assert.ok(sauvola.mask.some(Boolean));
assert.ok(otsu.mask.some(Boolean));

const result = recognizeGrayscale(gray, width, height, {
  expectedCount: 3,
  minArea: 10,
  mergeStrength: 48,
  absoluteCap: 210,
});
assert.equal(result.recognitionVersion, 2);
assert.ok(['adaptive', 'sauvola', 'otsu', 'hybrid'].includes(result.method));
assert.equal(result.candidates.length, 4);
assert.ok(result.candidates.every(candidate => Number.isFinite(candidate.qualityScore)));
assert.equal(result.stats.glyphCount, 3, JSON.stringify(result.candidates, null, 2));
assert.ok(result.qualityScore >= 50);
assert.ok(result.mask[76 * width + 5] === 0, 'long guide should be suppressed');

const labels = ['а', 'й', 'р'];
const annotated = annotateGlyphConfidence(result.glyphs, result.mask, width, height, labels);
assert.equal(annotated.length, 3);
assert.ok(annotated.every(glyph => glyph.confidence && Number.isInteger(glyph.confidence.score)));
assert.ok(annotated.every(glyph => ['good', 'review', 'bad'].includes(glyph.confidence.level)));

const tiny = assessGlyphConfidence({ x0: 1, y0: 1, x1: 2, y1: 2, width: 2, height: 2 }, new Uint8Array(width * height), width, height, 'р', { medianWidth: 25, medianHeight: 45 });
assert.equal(tiny.level, 'bad');
assert.ok(tiny.reasons.length >= 2);

function renderGuidedCell(char) {
  const cellWidth = 96;
  const cellHeight = 128;
  const data = new Uint8Array(cellWidth * cellHeight);
  for (let y = 0; y < cellHeight; y += 1) for (let x = 0; x < cellWidth; x += 1) {
    data[y * cellWidth + x] = Math.min(255, 232 + Math.round(x * 0.12 + y * 0.08));
  }
  const draw = (x0, y0, x1, y1, value = 38) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) data[y * cellWidth + x] = value;
  };
  for (const row of [28, 52, 86, 111]) for (let x = 0; x < cellWidth; x += 1) data[row * cellWidth + x] = 158;
  for (let y = 0; y < cellHeight; y += 1) data[y * cellWidth + 48] = 165;
  draw(29, 58, 33, 84);
  draw(63, 58, 67, 84);
  draw(29, 58, 67, 62);
  draw(29, 80, 67, 84);
  if ('ёйЁЙ'.includes(char)) {
    draw(35, 38, 40, 43);
    draw(56, 38, 61, 43);
  }
  if ('дрцщуфДРЦЩУФ'.includes(char)) draw(46, 82, 51, 106);
  data[70 * cellWidth + 31] = 235;
  return { data, width: cellWidth, height: cellHeight };
}

for (const char of ['ё', 'й', 'д', 'р', 'у', 'ф', 'щ', 'ц']) {
  const cell = renderGuidedCell(char);
  const recognized = recognizeGlyphCell(cell.data, cell.width, cell.height, {
    char,
    guideRows: [28, 52, 86, 111],
    guideColumns: [48],
    guideRowRadius: 1,
    guideColumnRadius: 0,
    baselineY: 86,
    xHeightY: 52,
    absoluteCap: 220,
  });
  assert.equal(recognized.recognitionVersion, 2);
  assert.ok(['adaptive', 'sauvola', 'otsu', 'hybrid'].includes(recognized.method));
  assert.ok(recognized.inkCount > 100, `${char}: ink should survive`);
  assert.equal(recognized.mask[28 * cell.width + 5], 0, `${char}: known horizontal guide should be removed`);
  assert.equal(recognized.mask[10 * cell.width + 48], 0, `${char}: known vertical guide should be removed`);
  if ('ёй'.includes(char)) assert.ok(!recognized.confidence.reasons.some(reason => reason.includes('Верхний знак')), `${char}: dots should survive`);
  if ('дрцщуф'.includes(char)) {
    assert.ok(!recognized.confidence.reasons.some(reason => reason.includes('Нижний элемент')), `${char}: descender should survive`);
    assert.equal(recognized.mask[100 * cell.width + 48], 1, `${char}: dark stroke aligned with the center guide should survive`);
  }
}

// The machine-readable template path must call the same four-candidate engine.
{
  const pageWidth = 210;
  const pageHeight = 297;
  const pageGray = new Uint8Array(pageWidth * pageHeight);
  pageGray.fill(244);
  const draw = (x0, y0, x1, y1, value = 35) => {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) pageGray[y * pageWidth + x] = value;
  };
  const cell = {
    index: 0,
    char: 'р',
    x: 60,
    y: 50,
    width: 70,
    height: 110,
    drawingTop: 50,
    centerX: 95,
    capLine: 62,
    xHeightLine: 78,
    baseline: 125,
    descenderLine: 145,
  };
  for (const row of [cell.capLine, cell.xHeightLine, cell.baseline, cell.descenderLine]) {
    for (let x = cell.x; x < cell.x + cell.width; x += 1) pageGray[row * pageWidth + x] = 160;
  }
  for (let y = cell.drawingTop; y < cell.y + cell.height; y += 1) pageGray[y * pageWidth + cell.centerX] = 166;
  draw(82, 88, 87, 145);
  draw(87, 88, 107, 93);
  draw(103, 92, 108, 122);
  draw(87, 118, 106, 123);

  const [glyph] = extractGlyphsFromRectified(
    { gray: pageGray, width: pageWidth, height: pageHeight },
    { pageIndex: 0, pageNumber: 1, cells: [cell] },
  );
  assert.equal(glyph.quality.recognition.version, 2);
  assert.ok(['adaptive', 'sauvola', 'otsu', 'hybrid'].includes(glyph.quality.recognition.method));
  assert.equal(glyph.quality.recognition.candidates.length, 4);
  assert.ok(glyph.quality.inkCount > 50);
  assert.ok(!glyph.quality.warnings.some(reason => reason.includes('Нижний элемент')));
}

console.log('Recognition Engine 2 unified deterministic tests: PASS');
