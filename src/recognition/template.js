import {
  DEFAULT_CELL_OPTIONS, UPPER_ACCENT_CHARS, DESCENDER_CHARS, SMALL_PUNCTUATION,
  clamp, percentile8, normalizeGrayRobust, closeMaskDirectional, openMask, bridgeShortGaps,
} from './base.js';
import { median, componentsFromMask, mergeNearbyComponents, filterPageComponents, orderComponentsIntoRows } from './components.js';
import { selectBestGlyphMask, candidateDefinitions, buildCandidate, runResidue } from './select.js';

function cropGray(gray, imageWidth, x0, y0, x1, y1) {
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const values = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) values.set(gray.slice((y0 + y) * imageWidth + x0, (y0 + y) * imageWidth + x1), y * width);
  return { gray: values, width, height };
}

export function extractTemplateGlyphsV2(rectified, page, options = {}) {
  const { gray, width, height } = rectified;
  const pageWidthMm = Number(options.pageWidthMm || 210);
  const pageHeightMm = Number(options.pageHeightMm || 297);
  const sx = width / pageWidthMm;
  const sy = height / pageHeightMm;
  const glyphs = [];
  for (const cell of page.cells) {
    const insetX = Number(options.insetX ?? 1.2);
    const insetY = Number(options.insetY ?? 0.75);
    const x0 = Math.max(0, Math.round((cell.x + insetX) * sx));
    const x1 = Math.min(width, Math.round((cell.x + cell.width - insetX) * sx));
    const y0 = Math.max(0, Math.round((cell.drawingTop + insetY) * sy));
    const y1 = Math.min(height, Math.round((cell.y + cell.height - insetY) * sy));
    const crop = cropGray(gray, width, x0, y0, x1, y1);
    const guides = {
      capY: cell.capLine * sy - y0,
      xHeightY: cell.xHeightLine * sy - y0,
      baselineY: cell.baseline * sy - y0,
      descenderY: cell.descenderLine * sy - y0,
    };
    const rows = [guides.capY, guides.xHeightY, guides.baselineY, guides.descenderY];
    const centerColumn = cell.centerX * sx - x0;
    const selected = selectBestGlyphMask(crop.gray, crop.width, crop.height, {
      expectedChar: cell.char,
      guides,
      guideGeometry: {
        rows,
        columns: [centerColumn],
        rowRadius: Math.max(1, Math.round(sy * 0.20)),
        columnRadius: Math.max(0, Math.round(sx * 0.08)),
      },
    }, options);
    glyphs.push({
      id: `p${page.pageIndex + 1}-c${cell.index + 1}`,
      char: cell.char,
      width: crop.width,
      height: crop.height,
      mask: selected.mask,
      guides,
      quality: {
        ...selected.quality,
        confidence: selected.quality.confidence,
        method: selected.method,
        background: percentile8(crop.gray, 0.82),
      },
      source: { type: 'template', pageIndex: page.pageIndex, pageNumber: page.pageNumber, cellIndex: cell.index, recognitionVersion: 2 },
    });
  }
  return glyphs;
}

function pageCandidateScore(mask, width, height, glyphs, rawComponents) {
  const ink = mask.reduce((sum, value) => sum + value, 0);
  const coverage = ink / Math.max(1, width * height);
  if (!glyphs.length) return 0;
  const areas = glyphs.map(item => item.area);
  const heights = glyphs.map(item => item.height);
  const medianArea = Math.max(1, median(areas));
  const medianHeight = Math.max(1, median(heights));
  const tiny = rawComponents.filter(item => item.area < medianArea * 0.04).length / Math.max(1, rawComponents.length);
  const unstableHeight = heights.filter(value => value < medianHeight * 0.35 || value > medianHeight * 2.8).length / glyphs.length;
  const residue = runResidue(mask, width, height);
  let score = 100;
  if (coverage < 0.001) score -= 60;
  else if (coverage < 0.004) score -= 22;
  if (coverage > 0.42) score -= 55;
  else if (coverage > 0.28) score -= 24;
  score -= tiny * 35;
  score -= unstableHeight * 28;
  score -= Math.min(30, residue.longRows * 2 + residue.longColumns * 2);
  if (glyphs.length > 600) score -= 25;
  return clamp(Math.round(score), 0, 100);
}

export function selectBestPageSegmentation(grayInput, width, height, options = {}) {
  const opts = { thresholdDelta: 34, absoluteCap: 195, backgroundRadius: 34, minArea: 18, mergeStrength: 55, closeIterations: 1, openIterations: 0, maxComponents: 1200, ...options };
  const gray = normalizeGrayRobust(grayInput);
  const definitions = candidateDefinitions(opts, width, height);
  const statisticsCache = new Map();
  const candidates = [];
  for (const definition of definitions) {
    const thresholded = buildCandidate(gray, width, height, definition, statisticsCache);
    let mask = thresholded.mask;
    if (opts.closeIterations) mask = closeMaskDirectional(mask, width, height, Math.min(2, opts.closeIterations));
    if (opts.openIterations) mask = openMask(mask, width, height, Math.min(2, opts.openIterations));
    mask = bridgeShortGaps(mask, width, height, 1);
    const rawComponents = componentsFromMask(mask, width, height, { minArea: Math.max(1, Math.round(opts.minArea * 0.45)), maxComponents: opts.maxComponents });
    const merged = mergeNearbyComponents(rawComponents, opts);
    const filtered = filterPageComponents(merged, width, height, opts);
    const glyphs = orderComponentsIntoRows(filtered);
    const score = pageCandidateScore(mask, width, height, glyphs, rawComponents);
    candidates.push({ method: definition.name, score, mask, glyphs, rawComponents, localBackground: thresholded.localBackground, normalized: gray });
  }
  candidates.sort((left, right) => right.score - left.score || Math.abs(left.glyphs.length - 88) - Math.abs(right.glyphs.length - 88));
  const best = candidates[0];
  return {
    ...best,
    confidence: best.score,
    candidates: candidates.map(candidate => ({ method: candidate.method, score: candidate.score, glyphCount: candidate.glyphs.length })),
  };
}

export const RECOGNITION_DEFAULTS = DEFAULT_CELL_OPTIONS;
export const RECOGNITION_CHARACTER_PROFILES = Object.freeze({
  upperAccents: [...UPPER_ACCENT_CHARS],
  descenders: [...DESCENDER_CHARS],
  punctuation: [...SMALL_PUNCTUATION],
});
