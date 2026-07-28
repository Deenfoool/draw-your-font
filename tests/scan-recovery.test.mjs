import assert from 'node:assert/strict';
import { getTemplateCharset, planTemplatePages } from '../src/template.js';
import { MARKER_GRID, METADATA_MM, markerPattern, metadataMatrix } from '../src/template-code.js';
import { computeHomography, warpGrayscale } from '../src/template-scanner.js';
import {
  getRecoveryDependencyInfo,
  normalizeGray,
  scanTemplateFromManualCorners,
  scanTemplateWithRetries,
  strengthenDarkDetails,
} from '../src/scan-recovery.js';

function fill(gray, width, x0, y0, x1, y1, value = 0) {
  const height = gray.length / width;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x += 1) gray[y * width + x] = value;
  }
}

function renderSyntheticPage(plan, pageIndex, width = 1050, black = 0, white = 255) {
  const height = Math.round(width * 297 / 210);
  const sx = width / 210;
  const sy = height / 297;
  const gray = new Uint8Array(width * height);
  gray.fill(white);
  const page = plan.pages[pageIndex];
  for (const marker of page.markers) {
    const pattern = markerPattern(marker.id);
    const moduleX = page.markerSize * sx / MARKER_GRID;
    const moduleY = page.markerSize * sy / MARKER_GRID;
    for (let row = 0; row < MARKER_GRID; row += 1) for (let column = 0; column < MARKER_GRID; column += 1) {
      if (pattern[row][column]) fill(gray, width, marker.x * sx + column * moduleX, marker.y * sy + row * moduleY, marker.x * sx + (column + 1) * moduleX, marker.y * sy + (row + 1) * moduleY, black);
    }
  }
  const matrix = metadataMatrix(page.metadata);
  for (let row = 0; row < matrix.length; row += 1) for (let column = 0; column < matrix[row].length; column += 1) {
    if (matrix[row][column]) fill(gray, width, (METADATA_MM.x + column * METADATA_MM.cell) * sx, (METADATA_MM.y + row * METADATA_MM.cell) * sy, (METADATA_MM.x + (column + 1) * METADATA_MM.cell) * sx, (METADATA_MM.y + (row + 1) * METADATA_MM.cell) * sy, black);
  }
  for (const cell of page.cells) {
    const cx = cell.centerX * sx;
    const baseline = cell.baseline * sy;
    fill(gray, width, cx - 4, baseline - 44, cx + 4, baseline + 2, black);
    fill(gray, width, cx - 18, baseline - 7, cx + 18, baseline + 2, black);
  }
  return { gray, width, height };
}

function assertRecognitionV2(result) {
  assert.equal(result.recognition?.version, 2);
  assert.ok(Number.isInteger(result.recognition.confidence));
  assert.equal(result.recognition.high + result.recognition.medium + result.recognition.low, result.glyphs.length);
  assert.ok(result.glyphs.every(glyph => glyph.source?.recognitionVersion === 2));
  assert.ok(result.glyphs.every(glyph => Number.isInteger(glyph.quality?.confidence)));
}

const plan = planTemplatePages(getTemplateCharset('ru-full'), { layoutId: 'balanced', charsetId: 'ru-full', title: 'Recovery Test' });

{
  const gray = Uint8Array.from([170, 175, 180, 220, 225, 230]);
  const normalized = normalizeGray(gray);
  assert.ok(normalized[0] < 30);
  assert.ok(normalized.at(-1) > 225);
  const strengthened = strengthenDarkDetails(Uint8Array.from([
    255, 255, 255,
    255, 80, 255,
    255, 255, 255,
  ]), 3, 3);
  assert.equal(strengthened[0], 0);
}

{
  const washed = renderSyntheticPage(plan, 0, 1050, 178, 232);
  const result = scanTemplateWithRetries(washed.gray, washed.width, washed.height, { activePlan: plan, outputWidth: 1050 });
  assert.equal(result.metadata.pageIndex, 0);
  assert.equal(result.glyphs[0].char, 'А');
  assert.notEqual(result.recovery.variant, 'original');
  assertRecognitionV2(result);
}

{
  const canonical = renderSyntheticPage(plan, 0, 1050, 10, 245);
  const photoWidth = 1320;
  const photoHeight = 1000;
  const photoCorners = [{ x: 120, y: 70 }, { x: 1190, y: 95 }, { x: 1240, y: 930 }, { x: 80, y: 900 }];
  const canonicalCorners = [{ x: 0, y: 0 }, { x: canonical.width - 1, y: 0 }, { x: canonical.width - 1, y: canonical.height - 1 }, { x: 0, y: canonical.height - 1 }];
  const photoToCanonical = computeHomography(photoCorners, canonicalCorners);
  const photo = warpGrayscale(canonical.gray, canonical.width, canonical.height, photoToCanonical, photoWidth, photoHeight);
  fill(photo, photoWidth, 60, 40, 260, 250, 245);
  assert.throws(() => scanTemplateWithRetries(photo, photoWidth, photoHeight, { activePlan: plan, outputWidth: 1050 }), /Автоматическое распознавание/);
  const result = scanTemplateFromManualCorners(photo, photoWidth, photoHeight, photoCorners, { activePlan: plan, pageIndex: 0, rotation: 'auto', outputWidth: 1050 });
  assert.equal(result.page.pageIndex, 0);
  assert.equal(result.glyphs.length, 48);
  assert.equal(result.glyphs[0].char, 'А');
  assert.equal(result.recovery.manualCorners, true);
  assertRecognitionV2(result);
}

{
  const info = getRecoveryDependencyInfo();
  assert.match(info.heicModuleUrl, /\/vendor\/heic-codec\.mjs$/);
  assert.doesNotMatch(info.heicModuleUrl, /\/src\/vendor\//);
  assert.equal(info.recognitionVersion, 2);
}

console.log('All scan recovery tests passed with Recognition Engine 2.0.');
