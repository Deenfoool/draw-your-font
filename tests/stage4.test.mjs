import assert from 'node:assert/strict';
import { getTemplateCharset, planTemplatePages } from '../src/template.js';
import { MARKER_GRID, METADATA_MM, markerPattern, metadataMatrix, encodeTemplateMetadata, decodeTemplateMetadata } from '../src/template-code.js';
import { computeHomography, transformPoint, warpGrayscale, scanTemplatePage, summarizeScannedPages } from '../src/template-scanner.js';
import { autoKerning, autoMetrics, deserializeProject, projectFromScannedSummary, projectToFontSource, serializeProject, validateProject } from '../src/project.js';
import { buildTrueTypeFont, createGlyphSet, parseSfntTables, validateTrueType } from '../src/font-builder.js';
import { getWoff2DependencyInfo } from '../src/woff2-loader.js';

function fill(gray, width, x0, y0, x1, y1, value = 0) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(gray.length / width, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x += 1) gray[y * width + x] = value;
  }
}

function renderSyntheticPage(plan, pageIndex, width = 1050) {
  const height = Math.round(width * 297 / 210); const sx = width / 210; const sy = height / 297;
  const gray = new Uint8Array(width * height); gray.fill(255);
  const page = plan.pages[pageIndex];
  for (const marker of page.markers) {
    const pattern = markerPattern(marker.id); const moduleX = page.markerSize * sx / MARKER_GRID; const moduleY = page.markerSize * sy / MARKER_GRID;
    for (let row = 0; row < MARKER_GRID; row += 1) for (let column = 0; column < MARKER_GRID; column += 1) {
      if (pattern[row][column]) fill(gray, width, (marker.x * sx) + column * moduleX, (marker.y * sy) + row * moduleY, marker.x * sx + (column + 1) * moduleX, marker.y * sy + (row + 1) * moduleY, 0);
    }
  }
  const matrix = metadataMatrix(page.metadata);
  for (let row = 0; row < matrix.length; row += 1) for (let column = 0; column < matrix[row].length; column += 1) {
    if (matrix[row][column]) fill(gray, width, (METADATA_MM.x + column * METADATA_MM.cell) * sx, (METADATA_MM.y + row * METADATA_MM.cell) * sy, (METADATA_MM.x + (column + 1) * METADATA_MM.cell) * sx, (METADATA_MM.y + (row + 1) * METADATA_MM.cell) * sy, 0);
  }
  for (const cell of page.cells) {
    const cx = cell.centerX * sx; const baseline = cell.baseline * sy;
    fill(gray, width, cx - 4, baseline - 45, cx + 4, baseline + 2, 25);
    fill(gray, width, cx - 18, baseline - 6, cx + 18, baseline + 2, 25);
    if (cell.char === 'Ё' || cell.char === 'ё') {
      fill(gray, width, cx - 12, baseline - 58, cx - 7, baseline - 52, 20);
      fill(gray, width, cx + 7, baseline - 58, cx + 12, baseline - 52, 20);
    }
  }
  return { gray, width, height };
}

{
  const info = getWoff2DependencyInfo();
  assert.match(info.localModuleUrl, /\/vendor\/woff2-codec\.mjs$/);
  assert.match(info.localWasmUrl, /\/vendor\/woff2\.wasm$/);
  assert.doesNotMatch(info.localModuleUrl, /\/src\/vendor\//);
  assert.doesNotMatch(info.localWasmUrl, /\/src\/vendor\//);
}

{
  const meta = { version: 1, charsetId: 'ru-full', layoutId: 'balanced', pageIndex: 1, pageCount: 2, totalChars: 88 };
  const bits = encodeTemplateMetadata(meta);
  const decoded = decodeTemplateMetadata(bits);
  assert.equal(decoded.valid, true);
  assert.equal(decoded.pageIndex, 1);
  assert.equal(decoded.charsetId, 'ru-full');
  const broken = [...bits]; broken[20] ^= 1;
  assert.equal(decodeTemplateMetadata(broken).valid, false);
}

{
  const from = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
  const to = [{ x: 20, y: 30 }, { x: 180, y: 10 }, { x: 160, y: 260 }, { x: 5, y: 230 }];
  const h = computeHomography(from, to);
  from.forEach((point, index) => {
    const mapped = transformPoint(h, point.x, point.y);
    assert.ok(Math.abs(mapped.x - to[index].x) < 1e-6);
    assert.ok(Math.abs(mapped.y - to[index].y) < 1e-6);
  });
}

const chars = getTemplateCharset('ru-full');
const plan = planTemplatePages(chars, { layoutId: 'balanced', charsetId: 'ru-full', title: 'Stage 4 Test' });
const canonical = renderSyntheticPage(plan, 0);
let scan;
{
  const photoWidth = 1450; const photoHeight = 1100;
  const imageCorners = {
    tl: { x: 110, y: 90 }, tr: { x: 1280, y: 70 }, br: { x: 1320, y: 1020 }, bl: { x: 140, y: 1040 },
  };
  const rotations = [
    [imageCorners.tl, imageCorners.tr, imageCorners.br, imageCorners.bl],
    [imageCorners.tr, imageCorners.br, imageCorners.bl, imageCorners.tl],
    [imageCorners.br, imageCorners.bl, imageCorners.tl, imageCorners.tr],
    [imageCorners.bl, imageCorners.tl, imageCorners.tr, imageCorners.br],
  ];
  const canonicalCorners = [{ x: 0, y: 0 }, { x: canonical.width - 1, y: 0 }, { x: canonical.width - 1, y: canonical.height - 1 }, { x: 0, y: canonical.height - 1 }];
  for (let rotation = 0; rotation < rotations.length; rotation += 1) {
    const photoToCanonical = computeHomography(rotations[rotation], canonicalCorners);
    const photo = warpGrayscale(canonical.gray, canonical.width, canonical.height, photoToCanonical, photoWidth, photoHeight);
    const result = scanTemplatePage(photo, photoWidth, photoHeight, { activePlan: plan, outputWidth: 1050 });
    assert.equal(result.metadata.valid, true, `metadata rotation ${rotation * 90}`);
    assert.equal(result.metadata.pageIndex, 0);
    assert.equal(result.page.cells.length, 48);
    assert.equal(result.glyphs[0].char, 'А');
    assert.ok(result.glyphs[0].quality.inkCount > 10);
    assert.ok(result.confidence > 0.72);
    if (rotation === 1) scan = result;
  }
}

{
  const summary = summarizeScannedPages([scan], plan);
  assert.deepEqual(summary.missing, [2]);
  const project = projectFromScannedSummary(summary, { title: 'Stage 4 Test' });
  assert.equal(project.glyphs.length, 48);
  autoMetrics(project);
  const pairs = autoKerning(project);
  assert.ok(typeof pairs === 'object');
  const serialized = serializeProject(project);
  const restored = deserializeProject(serialized);
  assert.equal(validateProject(restored).length, 0);
  assert.deepEqual([...restored.glyphs[0].mask], [...project.glyphs[0].mask]);

  const source = projectToFontSource(restored);
  const glyphSet = createGlyphSet(source, { detail: 80, simplify: 0.5, glyphHeight: 700 });
  assert.ok(glyphSet.entries.length >= 40);
  const ttf = buildTrueTypeFont(glyphSet.glyphs, { familyName: 'Stage Four', styleName: 'Regular', kerning: { 'А|В': -55 } });
  assert.equal(validateTrueType(ttf).length, 0);
  assert.ok(parseSfntTables(ttf).tables.some((table) => table.tag === 'kern'));
}

console.log('All 6 stage 4 tests passed.');
