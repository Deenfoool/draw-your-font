import {
  DEFAULT_CELL_OPTIONS,
  UPPER_ACCENT_CHARS,
  DESCENDER_CHARS,
  SMALL_PUNCTUATION,
  TWO_PART_PUNCTUATION,
  MULTI_COMPONENT_CHARS,
  clamp,
  normalizeGrayRobust,
  localStatistics,
  otsuThreshold,
  maskFromThreshold,
  backgroundDifferenceMask,
  sauvolaMask,
  wolfMask,
  bridgeShortGaps,
  closeMaskDirectional,
} from './base.js';
import { removeKnownGuides, componentsFromMask, intervalOverlap, intervalGap } from './components.js';

export function runResidue(mask, width, height) {
  let longRows = 0;
  let longColumns = 0;
  for (let y = 0; y < height; y += 1) {
    let run = 0; let maximum = 0;
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) { run += 1; maximum = Math.max(maximum, run); }
      else run = 0;
    }
    if (maximum >= width * 0.55) longRows += 1;
  }
  for (let x = 0; x < width; x += 1) {
    let run = 0; let maximum = 0;
    for (let y = 0; y < height; y += 1) {
      if (mask[y * width + x]) { run += 1; maximum = Math.max(maximum, run); }
      else run = 0;
    }
    if (maximum >= height * 0.65) longColumns += 1;
  }
  return { longRows, longColumns };
}

function maskBounds(mask, width, height) {
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1; let inkCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      inkCount += 1;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return inkCount ? { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, inkCount } : null;
}

function keepTemplateComponents(mask, width, height, expectedChar, guides = {}, options = {}) {
  const cellArea = width * height;
  const punctuation = SMALL_PUNCTUATION.has(expectedChar);
  const multiComponent = MULTI_COMPONENT_CHARS.has(expectedChar);
  const components = componentsFromMask(mask, width, height, {
    minArea: Math.max(1, Math.round(cellArea * (punctuation ? 0.00008 : 0.00015))),
    maxComponents: options.maxComponents || 64,
  });
  if (!components.length) return { mask: new Uint8Array(mask.length), components: [] };
  const sorted = [...components].sort((left, right) => right.area - left.area);
  const main = sorted[0];
  const kept = [];
  const baseline = Number.isFinite(guides.baselineY) ? guides.baselineY : height * 0.72;

  for (const component of components) {
    const borderLine = (component.width > width * 0.72 && component.height <= Math.max(2, height * 0.025))
      || (component.height > height * 0.75 && component.width <= Math.max(2, width * 0.025));
    if (borderLine) continue;
    if (component === main) { kept.push(component); continue; }

    const xOverlap = intervalOverlap(component.x0, component.x1, main.x0, main.x1) / Math.max(1, Math.min(component.width, main.width));
    const yOverlap = intervalOverlap(component.y0, component.y1, main.y0, main.y1) / Math.max(1, Math.min(component.height, main.height));
    const xGap = intervalGap(component.x0, component.x1, main.x0, main.x1);
    const yGap = intervalGap(component.y0, component.y1, main.y0, main.y1);
    const relativeArea = component.area / Math.max(1, main.area);

    const accent = component.cy < main.cy
      && xOverlap >= 0.10
      && yGap <= height * 0.24
      && relativeArea >= 0.006
      && relativeArea <= 0.58;
    const descender = component.cy >= baseline
      && xGap <= width * 0.22
      && yGap <= height * 0.18
      && relativeArea >= 0.006;
    const fragment = xGap <= width * 0.08
      && yGap <= height * 0.12
      && relativeArea >= 0.012;
    const punctuationPart = punctuation
      && relativeArea >= 0.015
      && xGap <= width * 0.35
      && yGap <= height * 0.35;
    const secondBody = multiComponent
      && relativeArea >= 0.04
      && yOverlap >= 0.24
      && xGap <= width * 0.38;
    if (accent || descender || fragment || punctuationPart || secondBody) kept.push(component);
  }

  if (UPPER_ACCENT_CHARS.has(expectedChar)) {
    for (const component of sorted.slice(1, 5)) {
      if (component.cy < main.y0
        && component.area >= Math.max(2, main.area * 0.005)
        && intervalGap(component.x0, component.x1, main.x0, main.x1) <= width * 0.12
        && !kept.includes(component)) kept.push(component);
    }
  }

  const output = new Uint8Array(mask.length);
  for (const component of kept) for (const index of component.pixels) output[index] = 1;
  return { mask: output, components: kept };
}

function inkContrast(gray, mask) {
  let inkSum = 0; let inkCount = 0; let paperSum = 0; let paperCount = 0;
  for (let index = 0; index < gray.length; index += 1) {
    if (mask[index]) { inkSum += gray[index]; inkCount += 1; }
    else { paperSum += gray[index]; paperCount += 1; }
  }
  if (!inkCount || !paperCount) return 0;
  return paperSum / paperCount - inkSum / inkCount;
}

export function scoreGlyphMask(gray, mask, width, height, context = {}) {
  const expectedChar = String(context.expectedChar || '');
  const guides = context.guides || {};
  const bbox = maskBounds(mask, width, height);
  const components = componentsFromMask(mask, width, height, { minArea: 1, maxComponents: 128, collectPixels: false });
  const warnings = [];
  if (!bbox) return { score: 0, confidence: 0, warnings: ['Пустая ячейка'], bbox: null, components: 0, inkCount: 0, areaRatio: 0, contrast: 0 };

  const areaRatio = bbox.inkCount / (width * height);
  const heightRatio = bbox.height / height;
  const widthRatio = bbox.width / width;
  const contrast = inkContrast(gray, mask);
  const residue = runResidue(mask, width, height);
  const punctuation = SMALL_PUNCTUATION.has(expectedChar);
  const expectedDescender = DESCENDER_CHARS.has(expectedChar);
  const expectedUpperAccent = UPPER_ACCENT_CHARS.has(expectedChar);
  const expectedMultiComponent = MULTI_COMPONENT_CHARS.has(expectedChar);
  const baseline = Number.isFinite(guides.baselineY) ? guides.baselineY : height * 0.72;
  let belowBaseline = 0;
  for (let y = Math.max(0, Math.floor(baseline + 1)); y < height; y += 1) {
    for (let x = 0; x < width; x += 1) belowBaseline += mask[y * width + x];
  }
  const belowRatio = belowBaseline / Math.max(1, bbox.inkCount);

  let score = 100;
  if (contrast < 18) { score -= 24; warnings.push('Слабый контраст чернил'); }
  else if (contrast < 32) { score -= 10; warnings.push('Чернила распознаны неуверенно'); }
  if (punctuation) {
    if (areaRatio < 0.0006) { score -= 35; warnings.push('Знак слишком маленький'); }
    if (areaRatio > 0.22) { score -= 25; warnings.push('Слишком много чернил или тень'); }
  } else {
    if (areaRatio < 0.006) { score -= 34; warnings.push('Слишком мало чернил'); }
    else if (areaRatio < 0.014) { score -= 12; warnings.push('Тонкие штрихи могли потеряться'); }
    if (areaRatio > 0.36) { score -= 30; warnings.push('Слишком много чернил или тень'); }
    else if (areaRatio > 0.28) { score -= 12; warnings.push('Маска выглядит слишком плотной'); }
    if (heightRatio < 0.16) { score -= 30; warnings.push('Символ слишком маленький'); }
    if (heightRatio > 0.96) { score -= 24; warnings.push('Символ касается верхней и нижней границы'); }
  }
  if (bbox.x0 <= 1 || bbox.x1 >= width - 2 || bbox.y0 <= 1 || bbox.y1 >= height - 2) { score -= 18; warnings.push('Штрих касается края ячейки'); }
  if (widthRatio > 0.96) { score -= 16; warnings.push('Возможно, захвачена рамка клетки'); }
  if (residue.longRows) { score -= Math.min(28, residue.longRows * 7); warnings.push('Возможно, осталась линия шаблона'); }
  if (residue.longColumns) { score -= Math.min(20, residue.longColumns * 6); warnings.push('Возможно, осталась вертикальная линия'); }

  const desiredComponents = expectedUpperAccent ? 3
    : expectedMultiComponent ? 2
      : TWO_PART_PUNCTUATION.has(expectedChar) ? 2
        : 1;
  if (components.length > desiredComponents + 3) {
    score -= Math.min(28, (components.length - desiredComponents - 3) * 4);
    warnings.push('Слишком много отдельных фрагментов');
  }
  if (expectedUpperAccent && components.length < 2) { score -= 16; warnings.push('Верхний знак Ё/Й мог потеряться'); }
  if (expectedMultiComponent && components.length < 2) { score -= 10; warnings.push('Вторая часть символа могла потеряться'); }
  if (expectedDescender && belowRatio < 0.018) { score -= 8; warnings.push('Нижний элемент мог потеряться'); }
  if (!expectedDescender && !punctuation && belowRatio > 0.38) { score -= 9; warnings.push('Необычно много чернил ниже базовой линии'); }

  return {
    score: clamp(Math.round(score), 0, 100),
    confidence: clamp(Math.round(score), 0, 100),
    warnings: [...new Set(warnings)],
    bbox,
    components: components.length,
    inkCount: bbox.inkCount,
    areaRatio,
    contrast,
    belowBaselineRatio: belowRatio,
    residue,
  };
}

export function candidateDefinitions(options, width, height) {
  const radius = clamp(
    Math.round(options.backgroundRadius ?? Math.min(width, height) * 0.16),
    6,
    Math.max(6, Math.round(Math.min(width, height) * 0.35)),
  );
  const delta = Number(options.thresholdDelta ?? 34);
  const cap = Number(options.absoluteCap ?? 205);
  return [
    { name: 'Локальный мягкий', type: 'background', delta: Math.max(10, delta - 9), radius, cap: Math.min(225, cap + 10) },
    { name: 'Локальный основной', type: 'background', delta, radius, cap },
    { name: 'Локальный строгий', type: 'background', delta: delta + 10, radius, cap: Math.max(155, cap - 8) },
    { name: 'Sauvola тонкие штрихи', type: 'sauvola', k: 0.18, radius, cap: Math.min(225, cap + 12) },
    { name: 'Sauvola основной', type: 'sauvola', k: 0.27, radius, cap: Math.min(218, cap + 5) },
    { name: 'Wolf тени', type: 'wolf', k: 0.42, radius, cap: Math.min(220, cap + 8) },
    { name: 'Otsu', type: 'otsu', cap: Math.min(220, cap + 8) },
  ];
}

export function buildCandidate(gray, width, height, definition, statisticsCache) {
  if (definition.type === 'otsu') {
    const threshold = otsuThreshold(gray);
    return { mask: maskFromThreshold(gray, threshold, definition.cap), localBackground: new Uint8Array(gray.length).fill(threshold), threshold };
  }
  const cacheKey = String(definition.radius);
  if (!statisticsCache.has(cacheKey)) statisticsCache.set(cacheKey, localStatistics(gray, width, height, definition.radius));
  const statistics = statisticsCache.get(cacheKey);
  if (definition.type === 'sauvola') return sauvolaMask(gray, width, height, { ...definition, absoluteCap: definition.cap, statistics });
  if (definition.type === 'wolf') return wolfMask(gray, width, height, { ...definition, absoluteCap: definition.cap, statistics });
  return backgroundDifferenceMask(gray, width, height, { ...definition, absoluteCap: definition.cap, statistics });
}

export function selectBestGlyphMask(grayInput, width, height, context = {}, options = {}) {
  const gray = normalizeGrayRobust(grayInput, 0.01, 0.99);
  const definitions = candidateDefinitions({ ...DEFAULT_CELL_OPTIONS, ...options }, width, height);
  const statisticsCache = new Map();
  const diagnostics = [];
  let best = null;
  for (const definition of definitions) {
    const thresholded = buildCandidate(gray, width, height, definition, statisticsCache);
    const guidesRemoved = removeKnownGuides(thresholded.mask, width, height, context.guideGeometry || {});
    let repaired = bridgeShortGaps(guidesRemoved.mask, width, height, options.repairGap ?? 3);
    if (options.closeIterations !== 0) repaired = closeMaskDirectional(repaired, width, height, 1);
    const filtered = keepTemplateComponents(repaired, width, height, context.expectedChar, context.guides, options);
    const quality = scoreGlyphMask(gray, filtered.mask, width, height, context);
    diagnostics.push({ method: definition.name, score: quality.score, warnings: quality.warnings, threshold: thresholded.threshold });
    if (!best
      || quality.score > best.quality.score
      || (quality.score === best.quality.score && quality.contrast > best.quality.contrast)) {
      best = {
        mask: filtered.mask,
        quality,
        method: definition.name,
        localBackground: thresholded.localBackground,
        removedGuides: guidesRemoved.removed,
      };
    }
  }
  best.quality.candidates = diagnostics.sort((left, right) => right.score - left.score);
  best.quality.method = best.method;
  return best;
}
