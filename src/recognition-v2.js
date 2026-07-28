import {
  SEGMENTATION_DEFAULTS,
  adaptiveBinarize,
  cleanMask,
  connectedComponents,
  filterLikelyGlyphs,
  mergeComponents,
  normalizeContrast,
  orderIntoRows,
} from './segmentation.js';

const METHODS = Object.freeze(['adaptive', 'sauvola', 'otsu', 'hybrid']);
const DESCENDERS = new Set([...'дрцщуфДРЦЩУФ']);
const DIACRITICS = new Set([...'ёйЁЙ']);

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function integralImages(gray, width, height) {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  const square = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    let rowSquare = 0;
    for (let x = 0; x < width; x += 1) {
      const value = gray[y * width + x];
      row += value;
      rowSquare += value * value;
      const target = (y + 1) * stride + x + 1;
      sum[target] = sum[target - stride] + row;
      square[target] = square[target - stride] + rowSquare;
    }
  }
  return { sum, square, stride };
}

function rectangle(integral, stride, x0, y0, x1, y1) {
  return integral[(y1 + 1) * stride + x1 + 1]
    - integral[y0 * stride + x1 + 1]
    - integral[(y1 + 1) * stride + x0]
    + integral[y0 * stride + x0];
}

export function sauvolaBinarize(gray, width, height, options = {}) {
  const normalized = normalizeContrast(gray);
  const radius = Math.max(4, Math.round(options.sauvolaRadius || Math.min(width, height) / 55));
  const k = Number.isFinite(options.sauvolaK) ? options.sauvolaK : 0.22;
  const { sum, square, stride } = integralImages(normalized, width, height);
  const mask = new Uint8Array(gray.length);
  const localBackground = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = rectangle(sum, stride, x0, y0, x1, y1) / area;
      const variance = Math.max(0, rectangle(square, stride, x0, y0, x1, y1) / area - mean * mean);
      const deviation = Math.sqrt(variance);
      const threshold = mean * (1 + k * (deviation / 128 - 1));
      const index = y * width + x;
      localBackground[index] = clamp(Math.round(mean), 0, 255);
      if (normalized[index] < threshold && normalized[index] <= (options.absoluteCap ?? 220)) mask[index] = 1;
    }
  }
  return { mask, normalized, localBackground };
}

export function otsuBinarize(gray, width, height, options = {}) {
  const normalized = normalizeContrast(gray);
  const histogram = new Uint32Array(256);
  normalized.forEach(value => { histogram[value] += 1; });
  const total = normalized.length;
  let allSum = 0;
  for (let i = 0; i < 256; i += 1) allSum += i * histogram[i];
  let backgroundWeight = 0, backgroundSum = 0, bestVariance = -1, threshold = 128;
  for (let i = 0; i < 256; i += 1) {
    backgroundWeight += histogram[i];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += i * histogram[i];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (allSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = i; }
  }
  threshold = Math.min(threshold, options.absoluteCap ?? 210);
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) if (normalized[i] <= threshold) mask[i] = 1;
  return { mask, normalized, localBackground: new Uint8Array(total).fill(threshold), threshold };
}

function suppressGuideLines(mask, width, height, options = {}) {
  if (options.suppressGuideLines === false) return new Uint8Array(mask);
  const out = new Uint8Array(mask);
  const rowLimit = Math.max(12, Math.floor(width * 0.72));
  const columnLimit = Math.max(12, Math.floor(height * 0.72));
  const rows = new Set();
  const columns = new Set();
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) count += mask[y * width + x];
    if (count >= rowLimit) rows.add(y);
  }
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) count += mask[y * width + x];
    if (count >= columnLimit) columns.add(x);
  }
  // Remove only thin isolated guide pixels. Intersections with real strokes survive
  // when ink continues at least two pixels perpendicular to the detected line.
  for (const y of rows) for (let x = 0; x < width; x += 1) {
    const verticalInk = (y > 1 && mask[(y - 2) * width + x]) || (y + 2 < height && mask[(y + 2) * width + x]);
    if (!verticalInk) out[y * width + x] = 0;
  }
  for (const x of columns) for (let y = 0; y < height; y += 1) {
    const horizontalInk = (x > 1 && mask[y * width + x - 2]) || (x + 2 < width && mask[y * width + x + 2]);
    if (!horizontalInk) out[y * width + x] = 0;
  }
  return out;
}

function directionalRepair(mask, width, height) {
  const out = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const i = y * width + x;
    if (mask[i]) continue;
    const horizontal = mask[i - 1] && mask[i + 1];
    const vertical = mask[i - width] && mask[i + width];
    const diagonalA = mask[i - width - 1] && mask[i + width + 1];
    const diagonalB = mask[i - width + 1] && mask[i + width - 1];
    if (horizontal || vertical || diagonalA || diagonalB) out[i] = 1;
  }
  return out;
}

function runMask(mask, normalized, localBackground, width, height, options, method) {
  const cleanedGuides = suppressGuideLines(mask, width, height, options);
  const repaired = options.repairStrokes === false ? cleanedGuides : directionalRepair(cleanedGuides, width, height);
  const cleaned = cleanMask(repaired, width, height, { ...options, closeIterations: 0 });
  const rawComponents = connectedComponents(cleaned, width, height, options);
  const merged = mergeComponents(rawComponents, options);
  const filtered = filterLikelyGlyphs(merged, width, height, options);
  const glyphs = orderIntoRows(filtered, options);
  return {
    method, mask: cleaned, normalized, localBackground, rawComponents, glyphs,
    stats: {
      rawCount: rawComponents.length,
      glyphCount: glyphs.length,
      rowCount: glyphs.length ? Math.max(...glyphs.map(glyph => glyph.row)) + 1 : 0,
      inkPixels: cleaned.reduce((sum, value) => sum + value, 0),
    },
  };
}

function borderTouchRatio(glyphs, width, height) {
  if (!glyphs.length) return 1;
  const marginX = Math.max(2, width * 0.005), marginY = Math.max(2, height * 0.005);
  return glyphs.filter(g => g.x0 <= marginX || g.y0 <= marginY || g.x1 >= width - 1 - marginX || g.y1 >= height - 1 - marginY).length / glyphs.length;
}

function candidateScore(candidate, width, height, expectedCount) {
  const imageArea = width * height;
  const inkRatio = candidate.stats.inkPixels / imageArea;
  const count = candidate.stats.glyphCount;
  let score = 100;
  if (expectedCount > 0) score -= Math.min(70, Math.abs(count - expectedCount) * (65 / expectedCount + 1.5));
  else if (!count) score -= 80;
  if (inkRatio < 0.002) score -= 55;
  if (inkRatio > 0.38) score -= 70;
  score -= borderTouchRatio(candidate.glyphs, width, height) * 30;
  const fragmentation = candidate.stats.rawCount / Math.max(1, count);
  if (fragmentation > 5) score -= Math.min(30, (fragmentation - 5) * 3);
  if (candidate.stats.rowCount > Math.max(20, Math.ceil(count / 2))) score -= 20;
  return clamp(score, 0, 100);
}

export function recognizeGrayscale(gray, width, height, options = {}) {
  const opts = { ...SEGMENTATION_DEFAULTS, suppressGuideLines: true, repairStrokes: true, ...options };
  const expectedCount = Math.max(0, Number(opts.expectedCount) || 0);
  const candidates = [];
  const adaptive = adaptiveBinarize(gray, width, height, opts);
  candidates.push(runMask(adaptive.mask, adaptive.normalized, adaptive.localBackground, width, height, opts, 'adaptive'));
  const sauvola = sauvolaBinarize(gray, width, height, opts);
  candidates.push(runMask(sauvola.mask, sauvola.normalized, sauvola.localBackground, width, height, opts, 'sauvola'));
  const otsu = otsuBinarize(gray, width, height, opts);
  candidates.push(runMask(otsu.mask, otsu.normalized, otsu.localBackground, width, height, opts, 'otsu'));
  const hybridMask = new Uint8Array(gray.length);
  for (let i = 0; i < hybridMask.length; i += 1) hybridMask[i] = adaptive.mask[i] && sauvola.mask[i] ? 1 : 0;
  candidates.push(runMask(hybridMask, adaptive.normalized, adaptive.localBackground, width, height, opts, 'hybrid'));
  candidates.forEach(candidate => { candidate.qualityScore = candidateScore(candidate, width, height, expectedCount); });
  candidates.sort((a, b) => b.qualityScore - a.qualityScore || Math.abs(a.stats.glyphCount - expectedCount) - Math.abs(b.stats.glyphCount - expectedCount));
  const best = candidates[0];
  return { ...best, candidates: candidates.map(({ method, qualityScore, stats }) => ({ method, qualityScore, stats })), recognitionVersion: 2 };
}

function glyphInkStats(glyph, mask, imageWidth) {
  let ink = 0, top = 0, bottom = 0, left = 0, right = 0;
  const quarterX = Math.max(1, Math.floor(glyph.width / 4));
  const quarterY = Math.max(1, Math.floor(glyph.height / 4));
  for (let y = glyph.y0; y <= glyph.y1; y += 1) for (let x = glyph.x0; x <= glyph.x1; x += 1) {
    if (!mask[y * imageWidth + x]) continue;
    ink += 1;
    if (y < glyph.y0 + quarterY) top += 1;
    if (y > glyph.y1 - quarterY) bottom += 1;
    if (x < glyph.x0 + quarterX) left += 1;
    if (x > glyph.x1 - quarterX) right += 1;
  }
  return { ink, fill: ink / Math.max(1, glyph.width * glyph.height), top, bottom, left, right };
}

export function assessGlyphConfidence(glyph, mask, imageWidth, imageHeight, char = '', context = {}) {
  const stats = glyphInkStats(glyph, mask, imageWidth);
  const reasons = [];
  let score = 100;
  if (stats.fill < 0.025) { score -= 45; reasons.push('Слишком мало чернил'); }
  else if (stats.fill < 0.055) { score -= 18; reasons.push('Очень тонкие штрихи'); }
  if (stats.fill > 0.72) { score -= 35; reasons.push('Возможно захвачена тень или сетка'); }
  const margin = Math.max(2, Math.round(Math.min(imageWidth, imageHeight) * 0.004));
  if (glyph.x0 <= margin || glyph.y0 <= margin || glyph.x1 >= imageWidth - 1 - margin || glyph.y1 >= imageHeight - 1 - margin) {
    score -= 25; reasons.push('Рамка касается края изображения');
  }
  const medianHeight = context.medianHeight || glyph.height;
  const medianWidth = context.medianWidth || glyph.width;
  if (glyph.height < medianHeight * 0.42) { score -= 28; reasons.push('Глиф заметно ниже остальных'); }
  if (glyph.width > medianWidth * 2.4) { score -= 30; reasons.push('Возможно объединены соседние буквы'); }
  if (glyph.width < medianWidth * 0.22 && !'.,;:!'.includes(char)) { score -= 20; reasons.push('Глиф необычно узкий'); }
  if (DIACRITICS.has(char) && stats.top < Math.max(2, stats.ink * 0.035)) { score -= 22; reasons.push(`Верхний знак «${char}» мог потеряться`); }
  if (DESCENDERS.has(char) && stats.bottom < Math.max(2, stats.ink * 0.08)) { score -= 18; reasons.push(`Нижний элемент «${char}» требует проверки`); }
  score = clamp(Math.round(score), 0, 100);
  return { score, level: score >= 82 ? 'good' : score >= 58 ? 'review' : 'bad', reasons };
}

export function annotateGlyphConfidence(glyphs, mask, imageWidth, imageHeight, labels = []) {
  const heights = glyphs.map(g => g.height).sort((a, b) => a - b);
  const widths = glyphs.map(g => g.width).sort((a, b) => a - b);
  const middle = Math.floor(glyphs.length / 2);
  const context = { medianHeight: heights[middle] || 1, medianWidth: widths[middle] || 1 };
  return glyphs.map((glyph, index) => ({ ...glyph, confidence: assessGlyphConfidence(glyph, mask, imageWidth, imageHeight, labels[index] || '', context) }));
}

export const RECOGNITION_METHODS = METHODS;
