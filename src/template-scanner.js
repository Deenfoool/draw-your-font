import { A4_MM, getLayout, getTemplateCharset, planTemplatePages } from './template.js';
import { MARKER_GRID, METADATA_COLUMNS, METADATA_MM, METADATA_ROWS, decodeMarkerMatrix, metadataFromMatrix } from './template-code.js';

const PAGE_GEOMETRY = Object.freeze({ marginX: 10, marginTop: 10, marginBottom: 9, markerSize: 7 });

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function key(x, y) { return `${x},${y}`; }

export function rgbaToGray(rgba, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) gray[i] = Math.round(rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114);
  return gray;
}

export function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-10) throw new Error('Не удалось вычислить перспективу страницы.');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let j = column; j <= n; j += 1) a[column][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let j = column; j <= n; j += 1) a[row][j] -= factor * a[column][j];
    }
  }
  return a.map((row) => row[n]);
}

export function computeHomography(from, to) {
  if (from.length !== 4 || to.length !== 4) throw new Error('Для перспективы нужны четыре точки.');
  const matrix = [];
  const vector = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const u = to[i].x;
    const v = to[i].y;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); vector.push(v);
  }
  const h = solveLinearSystem(matrix, vector);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function transformPoint(h, x, y) {
  const denominator = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / denominator, y: (h[3] * x + h[4] * y + h[5]) / denominator };
}

function bilinear(gray, width, height, x, y) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 255;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1); const y1 = Math.min(height - 1, y0 + 1);
  const dx = x - x0; const dy = y - y0;
  const a = gray[y0 * width + x0] * (1 - dx) + gray[y0 * width + x1] * dx;
  const b = gray[y1 * width + x0] * (1 - dx) + gray[y1 * width + x1] * dx;
  return Math.round(a * (1 - dy) + b * dy);
}

export function warpGrayscale(gray, width, height, homography, outputWidth, outputHeight) {
  const out = new Uint8Array(outputWidth * outputHeight);
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const source = transformPoint(homography, x, y);
      out[y * outputWidth + x] = bilinear(gray, width, height, source.x, source.y);
    }
  }
  return out;
}

function componentCandidates(gray, width, height, bounds, threshold = 155) {
  const x0 = clamp(Math.floor(bounds.x0), 0, width - 1); const y0 = clamp(Math.floor(bounds.y0), 0, height - 1);
  const x1 = clamp(Math.ceil(bounds.x1), x0 + 1, width); const y1 = clamp(Math.ceil(bounds.y1), y0 + 1, height);
  const localWidth = x1 - x0; const localHeight = y1 - y0;
  const visited = new Uint8Array(localWidth * localHeight);
  const candidates = [];
  const minDim = Math.min(width, height);
  const minSide = Math.max(7, minDim * 0.012);
  const maxSide = minDim * 0.11;
  const queueX = new Int32Array(localWidth * localHeight);
  const queueY = new Int32Array(localWidth * localHeight);

  for (let ly = 0; ly < localHeight; ly += 1) for (let lx = 0; lx < localWidth; lx += 1) {
    const li = ly * localWidth + lx;
    if (visited[li] || gray[(ly + y0) * width + lx + x0] >= threshold) continue;
    let head = 0; let tail = 0;
    queueX[tail] = lx; queueY[tail++] = ly; visited[li] = 1;
    let area = 0; let minX = lx; let maxX = lx; let minY = ly; let maxY = ly;
    let tl = { score: Infinity, x: lx, y: ly }; let tr = { score: -Infinity, x: lx, y: ly };
    let br = { score: -Infinity, x: lx, y: ly }; let bl = { score: Infinity, x: lx, y: ly };
    while (head < tail) {
      const x = queueX[head]; const y = queueY[head++]; area += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const sum = x + y; const diff = x - y;
      if (sum < tl.score) tl = { score: sum, x, y };
      if (diff > tr.score) tr = { score: diff, x, y };
      if (sum > br.score) br = { score: sum, x, y };
      if (diff < bl.score) bl = { score: diff, x, y };
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dy) continue;
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= localWidth || ny >= localHeight) continue;
        const ni = ny * localWidth + nx;
        if (!visited[ni] && gray[(ny + y0) * width + nx + x0] < threshold) { visited[ni] = 1; queueX[tail] = nx; queueY[tail++] = ny; }
      }
    }
    const boxWidth = maxX - minX + 1; const boxHeight = maxY - minY + 1;
    if (boxWidth < minSide || boxHeight < minSide || boxWidth > maxSide || boxHeight > maxSide) continue;
    const ratio = boxWidth / boxHeight;
    const density = area / (boxWidth * boxHeight);
    if (ratio < 0.55 || ratio > 1.8 || density < 0.18 || density > 0.98) continue;
    const translate = (p) => ({ x: p.x + x0, y: p.y + y0 });
    candidates.push({
      area, density, box: { x0: minX + x0, y0: minY + y0, x1: maxX + x0, y1: maxY + y0 },
      quad: [translate(tl), translate(tr), translate(br), translate(bl)],
      center: { x: (minX + maxX) / 2 + x0, y: (minY + maxY) / 2 + y0 },
      shapeScore: Math.abs(Math.log(ratio)) + Math.abs(density - 0.62),
    });
  }
  return candidates;
}

function sampleMarkerWithQuad(gray, width, height, quad) {
  const source = Array.from({ length: 4 }, (_, index) => ({ x: index === 1 || index === 2 ? MARKER_GRID : 0, y: index >= 2 ? MARKER_GRID : 0 }));
  const h = computeHomography(source, quad);
  const values = [];
  for (let row = 0; row < MARKER_GRID; row += 1) for (let column = 0; column < MARKER_GRID; column += 1) {
    let sum = 0; let count = 0;
    for (const oy of [0.28, 0.42, 0.58, 0.72]) for (const ox of [0.28, 0.42, 0.58, 0.72]) {
      const p = transformPoint(h, column + ox, row + oy);
      sum += bilinear(gray, width, height, p.x, p.y); count += 1;
    }
    values.push(sum / count);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.2)];
  const high = sorted[Math.floor(sorted.length * 0.8)];
  const threshold = low + (high - low) * 0.5;
  const matrix = Array.from({ length: MARKER_GRID }, (_, row) => values.slice(row * MARKER_GRID, (row + 1) * MARKER_GRID).map((value) => value < threshold ? 1 : 0));
  return { matrix, decoded: decodeMarkerMatrix(matrix), threshold, contrast: high - low };
}

function sampleMarker(gray, width, height, candidate) {
  const box = candidate.box;
  const padX = Math.max(0.5, (box.x1 - box.x0 + 1) * 0.025);
  const padY = Math.max(0.5, (box.y1 - box.y0 + 1) * 0.025);
  const boxQuad = [
    { x: box.x0 - padX, y: box.y0 - padY },
    { x: box.x1 + padX, y: box.y0 - padY },
    { x: box.x1 + padX, y: box.y1 + padY },
    { x: box.x0 - padX, y: box.y1 + padY },
  ];
  const samples = [sampleMarkerWithQuad(gray, width, height, candidate.quad), sampleMarkerWithQuad(gray, width, height, boxQuad)];
  return samples.sort((a, b) => (b.decoded.confidence - a.decoded.confidence) || (b.contrast - a.contrast))[0];
}

export function debugTemplateMarkerCandidates(gray, width, height) {
  const marginX = width * 0.38; const marginY = height * 0.31;
  const regions = [
    { x0: 0, y0: 0, x1: marginX, y1: marginY },
    { x0: width - marginX, y0: 0, x1: width, y1: marginY },
    { x0: width - marginX, y0: height - marginY, x1: width, y1: height },
    { x0: 0, y0: height - marginY, x1: marginX, y1: height },
  ];
  return regions.map((region) => componentCandidates(gray, width, height, region)
    .map((candidate) => ({ ...candidate, sample: sampleMarker(gray, width, height, candidate) }))
    .sort((a, b) => (b.sample.decoded.confidence - a.sample.decoded.confidence) || (a.shapeScore - b.shapeScore)));
}

export function detectTemplateMarkers(gray, width, height) {
  const groups = debugTemplateMarkerCandidates(gray, width, height);
  const found = [];
  for (const group of groups) {
    const candidates = group.filter((candidate) => candidate.sample.decoded.confidence >= 0.72);
    if (!candidates.length) throw new Error('Не найдены все четыре угловые метки. Используйте новый шаблон этапа 4 и снимите лист целиком.');
    found.push(candidates[0]);
  }
  const byId = new Map();
  for (const marker of found) {
    const id = marker.sample.decoded.id;
    if (!byId.has(id) || marker.sample.decoded.confidence > byId.get(id).sample.decoded.confidence) byId.set(id, marker);
  }
  if (byId.size !== 4) throw new Error('Угловые метки распознаны неоднозначно. Разверните лист и исключите блики.');
  return [0, 1, 2, 3].map((id) => ({ id, ...byId.get(id), confidence: byId.get(id).sample.decoded.confidence }));
}

function canonicalMarkerCenters(outputWidth, outputHeight) {
  const sx = outputWidth / A4_MM.width; const sy = outputHeight / A4_MM.height;
  const s = PAGE_GEOMETRY.markerSize;
  return [
    { x: (PAGE_GEOMETRY.marginX + s / 2) * sx, y: (PAGE_GEOMETRY.marginTop + s / 2) * sy },
    { x: (A4_MM.width - PAGE_GEOMETRY.marginX - s / 2) * sx, y: (PAGE_GEOMETRY.marginTop + s / 2) * sy },
    { x: (A4_MM.width - PAGE_GEOMETRY.marginX - s / 2) * sx, y: (A4_MM.height - PAGE_GEOMETRY.marginBottom - s / 2) * sy },
    { x: (PAGE_GEOMETRY.marginX + s / 2) * sx, y: (A4_MM.height - PAGE_GEOMETRY.marginBottom - s / 2) * sy },
  ];
}

export function rectifyTemplatePage(gray, width, height, options = {}) {
  const outputWidth = Number(options.outputWidth || 1260);
  const outputHeight = Math.round(outputWidth * A4_MM.height / A4_MM.width);
  const markers = detectTemplateMarkers(gray, width, height);
  const destination = canonicalMarkerCenters(outputWidth, outputHeight);
  const source = markers.map((marker) => marker.center);
  const homography = computeHomography(destination, source);
  const rectified = warpGrayscale(gray, width, height, homography, outputWidth, outputHeight);
  return { gray: rectified, width: outputWidth, height: outputHeight, markers, homography };
}

export function decodeRectifiedMetadata(gray, width, height) {
  const sx = width / A4_MM.width; const sy = height / A4_MM.height;
  const matrix = [];
  for (let row = 0; row < METADATA_ROWS; row += 1) {
    const values = [];
    for (let column = 0; column < METADATA_COLUMNS; column += 1) {
      const cx = (METADATA_MM.x + (column + 0.5) * METADATA_MM.cell) * sx;
      const cy = (METADATA_MM.y + (row + 0.5) * METADATA_MM.cell) * sy;
      let sum = 0; let count = 0;
      const radius = Math.max(1, Math.round(METADATA_MM.cell * sx * 0.18));
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        const x = clamp(Math.round(cx + dx), 0, width - 1); const y = clamp(Math.round(cy + dy), 0, height - 1);
        sum += gray[y * width + x]; count += 1;
      }
      values.push(sum / count);
    }
    matrix.push(values);
  }
  const flat = matrix.flat(); const sorted = [...flat].sort((a, b) => a - b);
  const threshold = (sorted[Math.floor(sorted.length * 0.22)] + sorted[Math.floor(sorted.length * 0.78)]) / 2;
  return { ...metadataFromMatrix(matrix.map((row) => row.map((value) => value < threshold ? 1 : 0))), matrix, threshold };
}

function closeMask(mask, width, height) {
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let ink = 0;
    for (let dy = -1; dy <= 1 && !ink; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) { ink = 1; break; }
    }
    dilated[y * width + x] = ink;
  }
  const eroded = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let all = 1;
    for (let dy = -1; dy <= 1 && all; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !dilated[ny * width + nx]) { all = 0; break; }
    }
    eroded[y * width + x] = all;
  }
  return eroded;
}

function filterCellComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length); const out = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0; let tail = 0; queue[tail++] = start; visited[start] = 1;
    const pixels = []; let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    while (head < tail) {
      const index = queue[head++]; pixels.push(index);
      const x = index % width; const y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] && !visited[ni]) { visited[ni] = 1; queue[tail++] = ni; }
      }
    }
    const componentWidth = maxX - minX + 1; const componentHeight = maxY - minY + 1;
    const isGuide = (componentWidth > width * 0.62 && componentHeight <= Math.max(3, height * 0.035)) || (componentHeight > height * 0.65 && componentWidth <= Math.max(3, width * 0.035));
    const minimumArea = Math.max(2, Math.round(width * height * 0.00045));
    if (!isGuide && pixels.length >= minimumArea) pixels.forEach((index) => { out[index] = 1; });
  }
  return out;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

export function extractGlyphsFromRectified(rectified, page, options = {}) {
  const { gray, width, height } = rectified;
  const sx = width / A4_MM.width; const sy = height / A4_MM.height;
  const glyphs = [];
  for (const cell of page.cells) {
    const insetX = Number(options.insetX ?? 1.2);
    const insetY = Number(options.insetY ?? 0.75);
    const x0 = Math.max(0, Math.round((cell.x + insetX) * sx));
    const x1 = Math.min(width, Math.round((cell.x + cell.width - insetX) * sx));
    const y0 = Math.max(0, Math.round((cell.drawingTop + insetY) * sy));
    const y1 = Math.min(height, Math.round((cell.y + cell.height - insetY) * sy));
    const glyphWidth = Math.max(1, x1 - x0); const glyphHeight = Math.max(1, y1 - y0);
    const values = new Uint8Array(glyphWidth * glyphHeight);
    for (let y = 0; y < glyphHeight; y += 1) values.set(gray.slice((y0 + y) * width + x0, (y0 + y) * width + x1), y * glyphWidth);
    const background = percentile(values, 0.82);
    const threshold = clamp(background - Number(options.inkDelta ?? 34), 70, 205);
    let mask = Uint8Array.from(values, (value) => value < threshold ? 1 : 0);

    const guideRows = [cell.capLine, cell.xHeightLine, cell.baseline, cell.descenderLine]
      .map((mm) => Math.round(mm * sy) - y0).filter((row) => row >= 0 && row < glyphHeight);
    const rowRadius = Math.max(1, Math.round(sy * 0.23));
    for (const row of guideRows) for (let y = Math.max(0, row - rowRadius); y <= Math.min(glyphHeight - 1, row + rowRadius); y += 1) {
      let run = 0;
      for (let x = 0; x < glyphWidth; x += 1) run += mask[y * glyphWidth + x];
      if (run > glyphWidth * 0.48) for (let x = 0; x < glyphWidth; x += 1) mask[y * glyphWidth + x] = 0;
    }
    const center = Math.round(cell.centerX * sx) - x0;
    const columnRadius = Math.max(0, Math.round(sx * 0.12));
    for (let x = Math.max(0, center - columnRadius); x <= Math.min(glyphWidth - 1, center + columnRadius); x += 1) {
      let run = 0; for (let y = 0; y < glyphHeight; y += 1) run += mask[y * glyphWidth + x];
      if (run > glyphHeight * 0.55) for (let y = 0; y < glyphHeight; y += 1) mask[y * glyphWidth + x] = 0;
    }
    mask = closeMask(filterCellComponents(mask, glyphWidth, glyphHeight), glyphWidth, glyphHeight);

    let inkCount = 0; let minX = glyphWidth; let maxX = -1; let minY = glyphHeight; let maxY = -1;
    for (let y = 0; y < glyphHeight; y += 1) for (let x = 0; x < glyphWidth; x += 1) if (mask[y * glyphWidth + x]) {
      inkCount += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const bbox = inkCount ? { x0: minX, y0: minY, x1: maxX, y1: maxY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
    const areaRatio = inkCount / (glyphWidth * glyphHeight);
    const warnings = [];
    if (!inkCount) warnings.push('Пустая ячейка');
    if (bbox && (bbox.x0 <= 1 || bbox.x1 >= glyphWidth - 2 || bbox.y0 <= 1 || bbox.y1 >= glyphHeight - 2)) warnings.push('Штрих касается края');
    if (bbox && bbox.height < glyphHeight * 0.18) warnings.push('Символ слишком маленький');
    if (bbox && bbox.height > glyphHeight * 0.94) warnings.push('Символ слишком высокий');
    if (areaRatio > 0.42) warnings.push('Слишком много чернил или тень');
    glyphs.push({
      id: `p${page.pageIndex + 1}-c${cell.index + 1}`,
      char: cell.char,
      width: glyphWidth,
      height: glyphHeight,
      mask,
      guides: {
        capY: cell.capLine * sy - y0,
        xHeightY: cell.xHeightLine * sy - y0,
        baselineY: cell.baseline * sy - y0,
        descenderY: cell.descenderLine * sy - y0,
      },
      quality: { inkCount, areaRatio, bbox, warnings, threshold, background },
      source: { type: 'template', pageIndex: page.pageIndex, pageNumber: page.pageNumber, cellIndex: cell.index },
    });
  }
  return glyphs;
}

export function resolveTemplatePlan(metadata, activePlan = null) {
  if (!metadata?.valid) throw new Error(metadata?.error || 'Машинный код страницы не распознан.');
  if (activePlan && activePlan.layout.id === metadata.layoutId && activePlan.pageCount === metadata.pageCount && activePlan.characters.length === metadata.totalChars) return activePlan;
  if (metadata.charsetId === 'custom') throw new Error('Для собственного набора сначала восстановите проект или создайте тот же шаблон в генераторе.');
  const characters = getTemplateCharset(metadata.charsetId);
  if (characters.length !== metadata.totalChars) throw new Error('Набор символов страницы не совпадает с текущей версией шаблона.');
  return planTemplatePages(characters, { layoutId: metadata.layoutId, charsetId: metadata.charsetId, title: 'Импортированный шаблон' });
}

export function scanTemplatePage(gray, width, height, options = {}) {
  const rectified = rectifyTemplatePage(gray, width, height, options);
  const metadata = decodeRectifiedMetadata(rectified.gray, rectified.width, rectified.height);
  const plan = resolveTemplatePlan(metadata, options.activePlan || null);
  if (metadata.pageIndex >= plan.pages.length) throw new Error('Номер страницы выходит за пределы шаблона.');
  const page = plan.pages[metadata.pageIndex];
  const glyphs = extractGlyphsFromRectified(rectified, page, options);
  return { rectified, metadata, plan, page, glyphs, confidence: Math.min(...rectified.markers.map((marker) => marker.confidence)) };
}

export function summarizeScannedPages(results, plan) {
  const byPage = new Map();
  const duplicates = [];
  for (const result of results) {
    const index = result.metadata.pageIndex;
    if (byPage.has(index)) duplicates.push(index + 1);
    else byPage.set(index, result);
  }
  const missing = [];
  for (let i = 0; i < plan.pageCount; i += 1) if (!byPage.has(i)) missing.push(i + 1);
  const glyphs = [...byPage.entries()].sort(([a], [b]) => a - b).flatMap(([, result]) => result.glyphs);
  const empty = glyphs.filter((glyph) => !glyph.quality.inkCount).map((glyph) => glyph.char);
  const warnings = glyphs.filter((glyph) => glyph.quality.warnings.length).length;
  return { byPage, missing, duplicates, glyphs, empty, warnings, complete: !missing.length && !duplicates.length };
}
