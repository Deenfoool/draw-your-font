import assert from 'node:assert/strict';
import {
  annotateGlyphConfidence,
  assessGlyphConfidence,
  otsuBinarize,
  recognizeGrayscale,
  sauvolaBinarize,
} from '../src/recognition-v2.js';

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

console.log('Recognition Engine 2 deterministic tests: PASS');
