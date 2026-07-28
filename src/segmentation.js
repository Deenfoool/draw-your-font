import {
  backgroundDifferenceMask,
  bridgeShortGaps,
  clamp,
  closeMaskDirectional,
  componentsFromMask,
  filterPageComponents,
  mergeNearbyComponents,
  normalizeGrayRobust,
  openMask,
  orderComponentsIntoRows,
  selectBestPageSegmentation,
} from './recognition-engine.js';

const DEFAULTS = Object.freeze({
  thresholdDelta: 34,
  absoluteCap: 195,
  backgroundRadius: 34,
  minArea: 18,
  closeIterations: 1,
  openIterations: 0,
  mergeStrength: 55,
  maxComponents: 1200,
  autoMethod: true,
});

export { clamp };

export function rgbaToGrayscale(rgba, width, height) {
  if (!rgba || rgba.length !== width * height * 4) throw new Error('RGBA buffer size does not match image dimensions.');
  const gray = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
    gray[pixel] = (rgba[index] * 77 + rgba[index + 1] * 150 + rgba[index + 2] * 29) >> 8;
  }
  return gray;
}

export function normalizeContrast(gray, lowPercentile = 0.01, highPercentile = 0.99) {
  return normalizeGrayRobust(gray, lowPercentile, highPercentile);
}

export function boxBlur(gray, width, height, radius) {
  radius = Math.max(1, Math.round(radius));
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  const output = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * stride + x1 + 1]
        - integral[y0 * stride + x1 + 1]
        - integral[(y1 + 1) * stride + x0]
        + integral[y0 * stride + x0];
      output[y * width + x] = Math.round(sum / area);
    }
  }
  return output;
}

export function adaptiveBinarize(gray, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const normalized = normalizeGrayRobust(gray);
  const result = backgroundDifferenceMask(normalized, width, height, {
    thresholdDelta: opts.thresholdDelta,
    absoluteCap: opts.absoluteCap,
    backgroundRadius: opts.backgroundRadius,
  });
  return { mask: result.mask, normalized, localBackground: result.localBackground };
}

export function cleanMask(mask, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  let output = new Uint8Array(mask);
  if (opts.closeIterations) output = closeMaskDirectional(output, width, height, Math.min(3, opts.closeIterations));
  if (opts.openIterations) output = openMask(output, width, height, Math.min(3, opts.openIterations));
  return bridgeShortGaps(output, width, height, opts.closeIterations ? 1 : 0);
}

export function connectedComponents(mask, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  return componentsFromMask(mask, width, height, { minArea: opts.minArea, maxComponents: opts.maxComponents });
}

export function mergeComponents(components, options = {}) {
  return mergeNearbyComponents(components, { ...DEFAULTS, ...options });
}

export function filterLikelyGlyphs(components, width, height, options = {}) {
  return filterPageComponents(components, width, height, { ...DEFAULTS, ...options });
}

export function orderIntoRows(components) {
  return orderComponentsIntoRows(components);
}

export function segmentGrayscale(gray, width, height, options = {}) {
  if (!(gray instanceof Uint8Array) && !(gray instanceof Uint8ClampedArray)) throw new Error('Expected a Uint8 grayscale buffer.');
  if (gray.length !== width * height) throw new Error('Grayscale buffer size does not match dimensions.');
  const opts = { ...DEFAULTS, ...options };

  if (opts.autoMethod !== false) {
    const best = selectBestPageSegmentation(gray, width, height, opts);
    return {
      mask: best.mask,
      normalized: best.normalized,
      localBackground: best.localBackground,
      rawComponents: best.rawComponents,
      glyphs: best.glyphs,
      method: best.method,
      confidence: best.confidence,
      candidates: best.candidates,
      stats: {
        rawCount: best.rawComponents.length,
        glyphCount: best.glyphs.length,
        rowCount: best.glyphs.length ? Math.max(...best.glyphs.map(glyph => glyph.row)) + 1 : 0,
        inkPixels: best.mask.reduce((sum, value) => sum + value, 0),
        recognitionMethod: best.method,
        recognitionConfidence: best.confidence,
      },
    };
  }

  const threshold = adaptiveBinarize(gray, width, height, opts);
  const mask = cleanMask(threshold.mask, width, height, opts);
  const rawComponents = componentsFromMask(mask, width, height, { minArea: opts.minArea, maxComponents: opts.maxComponents });
  const merged = mergeNearbyComponents(rawComponents, opts);
  const glyphs = orderComponentsIntoRows(filterPageComponents(merged, width, height, opts));
  return {
    ...threshold,
    mask,
    rawComponents,
    glyphs,
    method: 'Ручные параметры',
    confidence: null,
    candidates: [],
    stats: {
      rawCount: rawComponents.length,
      glyphCount: glyphs.length,
      rowCount: glyphs.length ? Math.max(...glyphs.map(glyph => glyph.row)) + 1 : 0,
      inkPixels: mask.reduce((sum, value) => sum + value, 0),
    },
  };
}

function combineBoxes(group, id) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  let area = 0; let weightedX = 0; let weightedY = 0;
  const sourceIds = [];
  for (const box of group) {
    x0 = Math.min(x0, box.x0); y0 = Math.min(y0, box.y0);
    x1 = Math.max(x1, box.x1); y1 = Math.max(y1, box.y1);
    area += box.area;
    weightedX += box.cx * box.area;
    weightedY += box.cy * box.area;
    sourceIds.push(...(box.sourceIds || [box.id]));
  }
  return {
    id,
    x0, y0, x1, y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    area,
    cx: weightedX / area,
    cy: weightedY / area,
    sourceIds: [...new Set(sourceIds)],
  };
}

export function mergeBoxes(boxes, selectedIds) {
  const selected = new Set(selectedIds);
  const group = boxes.filter(box => selected.has(box.id));
  if (group.length < 2) return boxes;
  const remaining = boxes.filter(box => !selected.has(box.id));
  return orderComponentsIntoRows([...remaining, combineBoxes(group, -1)]);
}

function boundsFromMask(mask, imageWidth, box, xStart, xEnd, sourceIds, splitParentId, splitSide) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  let area = 0; let sumX = 0; let sumY = 0;
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      if (!mask[y * imageWidth + x]) continue;
      area += 1; sumX += x; sumY += y;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (!area) return null;
  return {
    id: -1,
    x0, y0, x1, y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    area,
    cx: sumX / area,
    cy: sumY / area,
    sourceIds,
    splitParentId,
    splitSide,
  };
}

export function splitBoxAtX(boxes, selectedId, cutX, mask, imageWidth, minArea = 3) {
  const box = boxes.find(item => item.id === selectedId);
  if (!box) return { boxes, split: false, reason: 'Символ не найден.' };
  const roundedCut = Math.round(cutX);
  if (roundedCut <= box.x0 || roundedCut >= box.x1) return { boxes, split: false, reason: 'Линия разделения должна проходить внутри рамки.' };
  const leftSources = (box.sourceIds || [box.id]).map(id => `${id}:L@${roundedCut}`);
  const rightSources = (box.sourceIds || [box.id]).map(id => `${id}:R@${roundedCut}`);
  const left = boundsFromMask(mask, imageWidth, box, box.x0, roundedCut, leftSources, box.id, 'left');
  const right = boundsFromMask(mask, imageWidth, box, roundedCut + 1, box.x1, rightSources, box.id, 'right');
  if (!left || !right || left.area < minArea || right.area < minArea) return { boxes, split: false, reason: 'По одной из сторон линии слишком мало чернил.' };
  const remaining = boxes.filter(item => item.id !== selectedId);
  return { boxes: orderComponentsIntoRows([...remaining, left, right]), split: true, reason: '' };
}

export function removeBoxes(boxes, selectedIds) {
  const selected = new Set(selectedIds);
  return orderComponentsIntoRows(boxes.filter(box => !selected.has(box.id)));
}

export const SEGMENTATION_DEFAULTS = DEFAULTS;
