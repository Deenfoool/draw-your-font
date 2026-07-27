import assert from 'node:assert/strict';
import {
  adaptiveBinarize,
  mergeBoxes,
  orderIntoRows,
  removeBoxes,
  splitBoxAtX,
  segmentGrayscale,
} from '../src/segmentation.js';

function canvas(width, height, background = 235) {
  const pixels = new Uint8Array(width * height);
  pixels.fill(background);
  return pixels;
}

function rect(pixels, width, x0, y0, x1, y1, value = 25) {
  const height = pixels.length / width;
  for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) {
      pixels[y * width + x] = value;
    }
  }
}

function gradientPaper(width, height) {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shadow = Math.round(238 - (x / width) * 55 - (y / height) * 18);
      pixels[y * width + x] = shadow;
    }
  }
  return pixels;
}

function addDeterministicNoise(pixels) {
  let seed = 123456789;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = ((seed >>> 24) % 7) - 3;
    pixels[i] = Math.max(0, Math.min(255, pixels[i] + noise));
  }
}

const options = {
  thresholdDelta: 24,
  absoluteCap: 205,
  backgroundRadius: 20,
  minArea: 10,
  closeIterations: 0,
  mergeStrength: 62,
};

// 1. Adaptive threshold must survive a strong paper shadow.
{
  const width = 180;
  const height = 90;
  const pixels = gradientPaper(width, height);
  addDeterministicNoise(pixels);
  rect(pixels, width, 18, 25, 35, 67, 34);
  rect(pixels, width, 72, 25, 89, 67, 40);
  rect(pixels, width, 124, 25, 141, 67, 45);
  const result = adaptiveBinarize(pixels, width, height, options);
  assert.ok(result.mask.reduce((sum, value) => sum + value, 0) > 1500, 'ink should be detected across the shadow');
}

// 2. Detached Cyrillic-style accent must merge with its base, not neighbours.
{
  const width = 210;
  const height = 100;
  const pixels = gradientPaper(width, height);
  rect(pixels, width, 20, 34, 42, 78, 30);
  rect(pixels, width, 82, 34, 104, 78, 30);
  rect(pixels, width, 88, 20, 94, 25, 30);
  rect(pixels, width, 146, 34, 168, 78, 30);
  const result = segmentGrayscale(pixels, width, height, options);
  assert.equal(result.stats.glyphCount, 3, `expected 3 glyphs, got ${result.stats.glyphCount}`);
  assert.equal(result.stats.rowCount, 1);
  assert.ok(result.glyphs[1].sourceIds.length >= 2, 'accent should be merged into the middle glyph');
}

// 3. Ordering must be stable across two rows.
{
  const boxes = [
    { id: 0, x0: 80, y0: 70, x1: 95, y1: 95, width: 16, height: 26, area: 200, cx: 87, cy: 82, sourceIds: [0] },
    { id: 1, x0: 15, y0: 15, x1: 30, y1: 40, width: 16, height: 26, area: 200, cx: 22, cy: 27, sourceIds: [1] },
    { id: 2, x0: 50, y0: 15, x1: 65, y1: 40, width: 16, height: 26, area: 200, cx: 57, cy: 27, sourceIds: [2] },
    { id: 3, x0: 20, y0: 70, x1: 35, y1: 95, width: 16, height: 26, area: 200, cx: 27, cy: 82, sourceIds: [3] },
  ];
  const ordered = orderIntoRows(boxes);
  assert.deepEqual(ordered.map((box) => box.sourceIds[0]), [1, 2, 3, 0]);
  assert.deepEqual(ordered.map((box) => box.row), [0, 0, 1, 1]);
}

// 4. Isolated speckle noise must be filtered.
{
  const width = 160;
  const height = 90;
  const pixels = canvas(width, height);
  rect(pixels, width, 20, 25, 42, 70, 25);
  rect(pixels, width, 80, 25, 102, 70, 25);
  pixels[4 * width + 5] = 0;
  pixels[8 * width + 130] = 0;
  const result = segmentGrayscale(pixels, width, height, options);
  assert.equal(result.stats.glyphCount, 2);
}

// 5. Manual merge and delete must preserve reading order.
{
  const boxes = [
    { id: 0, x0: 10, y0: 20, x1: 20, y1: 60, width: 11, height: 41, area: 150, cx: 15, cy: 40, sourceIds: [0] },
    { id: 1, x0: 22, y0: 20, x1: 30, y1: 60, width: 9, height: 41, area: 130, cx: 26, cy: 40, sourceIds: [1] },
    { id: 2, x0: 60, y0: 20, x1: 75, y1: 60, width: 16, height: 41, area: 180, cx: 67, cy: 40, sourceIds: [2] },
  ];
  const merged = mergeBoxes(boxes, [0, 1]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].sourceIds.sort(), [0, 1]);
  const removed = removeBoxes(merged, [0]);
  assert.equal(removed.length, 1);
  assert.deepEqual(removed[0].sourceIds, [2]);
}

// 6. Two detached dots of Ё must survive filtering and join the base glyph.
{
  const width = 120;
  const height = 100;
  const pixels = canvas(width, height);
  rect(pixels, width, 42, 36, 72, 82, 25);
  rect(pixels, width, 46, 20, 52, 26, 25);
  rect(pixels, width, 62, 20, 68, 26, 25);
  const result = segmentGrayscale(pixels, width, height, options);
  assert.equal(result.stats.glyphCount, 1);
  assert.ok(result.glyphs[0].sourceIds.length >= 3, 'both dots must be merged into Ё');
}

// 7. A manually chosen vertical cut must split an over-merged box.
{
  const width = 100;
  const height = 80;
  const mask = new Uint8Array(width * height);
  for (let y = 20; y <= 60; y += 1) {
    for (let x = 10; x <= 28; x += 1) mask[y * width + x] = 1;
    for (let x = 55; x <= 75; x += 1) mask[y * width + x] = 1;
  }
  const boxes = [{
    id: 0, x0: 10, y0: 20, x1: 75, y1: 60, width: 66, height: 41,
    area: 1640, cx: 42, cy: 40, sourceIds: [0], row: 0, column: 0,
  }];
  const outcome = splitBoxAtX(boxes, 0, 42, mask, width, 5);
  assert.equal(outcome.split, true);
  assert.equal(outcome.boxes.length, 2);
  assert.equal(outcome.boxes[0].x1, 28);
  assert.equal(outcome.boxes[1].x0, 55);
}

console.log('All 7 segmentation tests passed.');
