import assert from 'node:assert/strict';
import {
  extractTemplateGlyphsV2,
  removeKnownGuides,
  selectBestGlyphMask,
  selectBestPageSegmentation,
} from '../src/recognition-engine.js';

function paper(width, height) {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    gray[y * width + x] = Math.max(120, Math.round(244 - x * 0.24 - y * 0.05));
  }
  return gray;
}
function rect(gray, width, x0, y0, x1, y1, value) {
  const height = gray.length / width;
  for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y += 1) for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) gray[y * width + x] = value;
}

// 1. Multi-candidate selection keeps a thin glyph under uneven lighting.
{
  const width = 100, height = 120;
  const gray = paper(width, height);
  rect(gray, width, 42, 22, 47, 88, 58);
  rect(gray, width, 28, 56, 66, 61, 58);
  const result = selectBestGlyphMask(gray, width, height, {
    expectedChar: 'т',
    guides: { capY: 18, xHeightY: 35, baselineY: 90, descenderY: 108 },
    guideGeometry: { rows: [18, 35, 90, 108], columns: [50] },
  });
  assert.ok(result.quality.confidence >= 55, JSON.stringify(result.quality));
  assert.ok(result.quality.inkCount > 250);
  assert.ok(result.quality.candidates.length >= 6);
}

// 2. Known horizontal guide is removed, while a crossing vertical stroke is restored.
{
  const width = 80, height = 70;
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) mask[35 * width + x] = 1;
  for (let y = 10; y < 62; y += 1) mask[y * width + 39] = 1;
  const cleaned = removeKnownGuides(mask, width, height, { rows: [35], rowRadius: 0 }).mask;
  const rowInk = cleaned.slice(35 * width, 36 * width).reduce((sum, value) => sum + value, 0);
  assert.ok(rowInk < 15, `guide residue: ${rowInk}`);
  assert.equal(cleaned[34 * width + 39], 1);
  assert.equal(cleaned[36 * width + 39], 1);
}

// 3. Ё keeps both detached dots and the body.
{
  const width = 100, height = 120;
  const gray = new Uint8Array(width * height); gray.fill(240);
  rect(gray, width, 30, 42, 70, 96, 35);
  rect(gray, width, 35, 22, 42, 29, 35);
  rect(gray, width, 58, 22, 65, 29, 35);
  const result = selectBestGlyphMask(gray, width, height, {
    expectedChar: 'ё',
    guides: { capY: 18, xHeightY: 38, baselineY: 98, descenderY: 112 },
    guideGeometry: { rows: [18, 38, 98, 112], columns: [50] },
  });
  assert.ok(result.quality.components >= 3, JSON.stringify(result.quality));
  assert.ok(!result.quality.warnings.some(item => item.includes('Верхний знак')));
}

// 4. Template extraction uses known cell geometry and preserves a descender below baseline.
{
  const width = 420, height = 594;
  const gray = new Uint8Array(width * height); gray.fill(242);
  const sx = width / 210, sy = height / 297;
  const cell = {
    char: 'р', index: 0, row: 0, column: 0,
    x: 10, y: 34, width: 31.666, height: 31.75,
    drawingTop: 40, capLine: 44, xHeightLine: 49, baseline: 58, descenderLine: 63,
    centerX: 25.8,
  };
  const x = Math.round(cell.centerX * sx);
  rect(gray, width, x - 4, Math.round(47 * sy), x + 4, Math.round(64 * sy), 30);
  rect(gray, width, x - 12, Math.round(49 * sy), x + 12, Math.round(54 * sy), 30);
  const page = { pageIndex: 0, pageNumber: 1, cells: [cell] };
  const [glyph] = extractTemplateGlyphsV2({ gray, width, height }, page);
  assert.equal(glyph.char, 'р');
  assert.equal(glyph.source.recognitionVersion, 2);
  assert.ok(glyph.quality.confidence > 0);
  let below = 0;
  for (let y = Math.floor(glyph.guides.baselineY + 1); y < glyph.height; y += 1) for (let px = 0; px < glyph.width; px += 1) below += glyph.mask[y * glyph.width + px];
  assert.ok(below > 0, 'descender should remain below baseline');
}

// 5. Manual page selection rejects speckle and keeps two glyphs.
{
  const width = 180, height = 100;
  const gray = paper(width, height);
  rect(gray, width, 25, 25, 48, 78, 30);
  rect(gray, width, 105, 25, 128, 78, 35);
  gray[3 * width + 3] = 0;
  gray[9 * width + 160] = 0;
  const result = selectBestPageSegmentation(gray, width, height, { minArea: 10, closeIterations: 0 });
  assert.equal(result.glyphs.length, 2, JSON.stringify(result.candidates));
  assert.ok(result.confidence >= 50);
}

console.log('Recognition Engine 2.0 tests passed.');
