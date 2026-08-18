import assert from 'node:assert/strict';
import { planConnectionTemplatePages } from '../src/connection-template.js';
import {
  extractConnectionSamplesFromRectified,
  summarizeConnectionTemplatePages,
} from '../src/connection-template-scanner.js';
import { A4_MM } from '../src/template.js';

const width = 1260;
const height = Math.round(width * A4_MM.height / A4_MM.width);
const gray = new Uint8Array(width * height).fill(248);
const sx = width / A4_MM.width;
const sy = height / A4_MM.height;
const plan = planConnectionTemplatePages({ title: 'Scanner fixture', characters: ['а'] });
const page = plan.pages[0];

function setPixel(x, y, value) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  gray[py * width + px] = Math.min(gray[py * width + px], value);
}

function disk(x, y, radius, value) {
  const r = Math.max(1, Math.round(radius));
  for (let py = Math.round(y) - r; py <= Math.round(y) + r; py += 1) {
    for (let px = Math.round(x) - r; px <= Math.round(x) + r; px += 1) {
      if ((px - x) ** 2 + (py - y) ** 2 <= r ** 2 + 0.7) setPixel(px, py, value);
    }
  }
}

function line(x0, y0, x1, y1, radius, value) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.7));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    disk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, value);
  }
}

function printedLine(y, x0, x1) {
  for (let x = Math.round(x0); x <= Math.round(x1); x += 2) setPixel(x, y, 181);
}

function printedTarget(target) {
  const radius = target.radius * (sx + sy) / 2;
  const centerX = target.x * sx;
  const centerY = target.y * sy;
  const steps = 96;
  for (let index = 0; index < steps; index += 1) {
    const angle = index / steps * Math.PI * 2;
    disk(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, 1.1, 170);
  }
  disk(centerX, centerY, 1.2, 170);
}

for (const cell of page.cells) {
  const left = (cell.x + 1) * sx;
  const right = (cell.x + cell.width - 1) * sx;
  printedLine(cell.capLine * sy, left, right);
  printedLine(cell.xHeightLine * sy, left, right);
  printedLine(cell.baseline * sy, left, right);
  printedLine(cell.descenderLine * sy, left, right);
  printedTarget(cell.target);

  const startX = (cell.x + 4.2) * sx;
  const baseline = cell.baseline * sy;
  const bodyTop = cell.xHeightLine * sy + 4;
  const bodyRight = (cell.x + cell.width * 0.48) * sx;
  const targetX = cell.target.x * sx;
  const targetY = cell.target.y * sy;
  const ink = 24;
  const radius = 2.2;

  line(startX, baseline - 1, startX + 11, bodyTop, radius, ink);
  line(startX + 11, bodyTop, bodyRight - 10, baseline - 8, radius, ink);
  line(bodyRight - 10, baseline - 8, bodyRight, bodyTop + 5, radius, ink);
  line(bodyRight, bodyTop + 5, bodyRight + 6, baseline - 2, radius, ink);
  line(bodyRight + 6, baseline - 2, targetX, targetY, radius, ink);
  disk(targetX, targetY, radius + 0.6, ink);
}

const samples = extractConnectionSamplesFromRectified({ gray, width, height }, page, {
  insetX: 1,
  insetY: 0.65,
  preserveInkBelow: 110,
});
assert.equal(samples.length, 3);
assert.deepEqual(samples.map((sample) => sample.targetClass), ['upper', 'middle', 'lower']);
for (const sample of samples) {
  assert.ok(sample.quality.inkCount > 90, `${sample.targetClass}: handwritten ink disappeared`);
  assert.ok(sample.quality.removedTargetGuidePixels > 5, `${sample.targetClass}: printed target was not removed`);
  assert.ok(sample.quality.targetInk > 2, `${sample.targetClass}: dark stroke at target disappeared`);
  assert.equal(sample.quality.reachedTarget, true, `${sample.targetClass}: target was not reached`);
  assert.ok(sample.mask.some(Boolean));
  assert.equal(sample.quality.recognition.version, 2);
}

const result = {
  metadata: { pageIndex: 0 },
  page,
  samples,
};
const summary = summarizeConnectionTemplatePages([result], plan);
assert.equal(summary.completePages, true);
assert.equal(summary.samples.length, 3);
assert.deepEqual(summary.empty, []);
assert.deepEqual(summary.unreached, []);
assert.equal(summary.complete, true);

console.log('Stage 11.3 synthetic connection scanner test: PASS. Printed guides removed, handwritten targets preserved.');
