import {
  CONNECTION_TEMPLATE_VERSION,
  planConnectionTemplatePages,
} from './connection-template.js';
import { recognizeGlyphCell } from './recognition-v2.js';
import {
  decodeRectifiedMetadata,
  rectifyTemplatePage,
} from './template-scanner.js';
import { A4_MM } from './template.js';

const STORAGE_FORMAT = 'draw-your-font-connection-samples';
const STORAGE_VERSION = 1;

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function percentile(values, fraction) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  const target = Math.max(0, Math.min(values.length - 1, Math.floor(values.length * fraction)));
  let total = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    total += histogram[value];
    if (total > target) return value;
  }
  return 255;
}

function normalizeGray(gray) {
  const low = percentile(gray, 0.015);
  const high = percentile(gray, 0.985);
  if (high - low < 12) return new Uint8Array(gray);
  const scale = 255 / (high - low);
  return Uint8Array.from(gray, (value) => clamp(Math.round((value - low) * scale), 0, 255));
}

function strengthenDarkDetails(gray, width, height) {
  const normalized = normalizeGray(gray);
  const output = new Uint8Array(normalized.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minimum = 255;
      for (let dy = -1; dy <= 1; dy += 1) {
        const py = clamp(y + dy, 0, height - 1);
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = clamp(x + dx, 0, width - 1);
          minimum = Math.min(minimum, normalized[py * width + px]);
        }
      }
      output[y * width + x] = minimum;
    }
  }
  return output;
}

function suppressPrintedTarget(values, width, height, target, options = {}) {
  const output = new Uint8Array(values);
  const radius = Math.max(1, Number(target.radius || 1));
  const ringHalfWidth = Math.max(1, radius * Number(options.ringWidthRatio ?? 0.42));
  const centerRadius = Math.max(1, radius * Number(options.centerRadiusRatio ?? 0.28));
  const preserveInkBelow = Number(options.preserveInkBelow ?? 118);
  const outer = radius + ringHalfWidth + 1;
  const x0 = Math.max(0, Math.floor(target.x - outer));
  const x1 = Math.min(width - 1, Math.ceil(target.x + outer));
  const y0 = Math.max(0, Math.floor(target.y - outer));
  const y1 = Math.min(height - 1, Math.ceil(target.y + outer));
  let removed = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const distance = Math.hypot(x - target.x, y - target.y);
      const printed = Math.abs(distance - radius) <= ringHalfWidth || distance <= centerRadius;
      const index = y * width + x;
      if (printed && output[index] > preserveInkBelow) {
        output[index] = 255;
        removed += 1;
      }
    }
  }
  return { values: output, removed };
}

function countTargetInk(mask, width, height, target, radiusScale = 1.35) {
  const radius = Math.max(2, Number(target.radius || 1) * radiusScale);
  const x0 = Math.max(0, Math.floor(target.x - radius));
  const x1 = Math.min(width - 1, Math.ceil(target.x + radius));
  const y0 = Math.max(0, Math.floor(target.y - radius));
  const y1 = Math.min(height - 1, Math.ceil(target.y + radius));
  let count = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    if (Math.hypot(x - target.x, y - target.y) <= radius && mask[y * width + x]) count += 1;
  }
  return count;
}

function rleEncode(mask) {
  if (!mask.length) return '';
  const bytes = [];
  let value = mask[0] ? 1 : 0;
  let run = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const bit = mask[index] ? 1 : 0;
    if (bit === value && run < 0xffff) run += 1;
    else {
      bytes.push(value, run >> 8, run & 255);
      value = bit;
      run = 1;
    }
  }
  bytes.push(value, run >> 8, run & 255);
  if (typeof btoa === 'function') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function rleDecode(encoded, expectedLength) {
  if (!encoded) return new Uint8Array(expectedLength);
  const binary = typeof atob === 'function' ? atob(encoded) : Buffer.from(encoded, 'base64').toString('binary');
  const output = new Uint8Array(expectedLength);
  let offset = 0;
  for (let index = 0; index + 2 < binary.length; index += 3) {
    const value = binary.charCodeAt(index) ? 1 : 0;
    const run = (binary.charCodeAt(index + 1) << 8) | binary.charCodeAt(index + 2);
    output.fill(value, offset, Math.min(expectedLength, offset + run));
    offset += run;
  }
  if (offset !== expectedLength) throw new Error('Маска образца соединения повреждена.');
  return output;
}

export function resolveConnectionTemplatePlan(metadata, activePlan = null) {
  if (!metadata?.valid) throw new Error(metadata?.error || 'Машинный код страницы не распознан.');
  if (metadata.version !== CONNECTION_TEMPLATE_VERSION) throw new Error(`Ожидался шаблон соединений v${CONNECTION_TEMPLATE_VERSION}, получена версия ${metadata.version}.`);
  if (activePlan?.kind === 'connections'
    && activePlan.layout.id === metadata.layoutId
    && activePlan.pageCount === metadata.pageCount
    && activePlan.samples.length === metadata.totalChars) return activePlan;
  const plan = planConnectionTemplatePages({ title: 'Импортированные соединения' });
  if (plan.layout.id !== metadata.layoutId || plan.pageCount !== metadata.pageCount || plan.samples.length !== metadata.totalChars) {
    throw new Error('Страница не совпадает с текущей версией русского шаблона соединений.');
  }
  return plan;
}

export function extractConnectionSamplesFromRectified(rectified, page, options = {}) {
  const { gray, width, height } = rectified;
  const sx = width / A4_MM.width;
  const sy = height / A4_MM.height;
  const samples = [];
  for (const cell of page.cells) {
    const insetX = Number(options.insetX ?? 1.0);
    const insetY = Number(options.insetY ?? 0.65);
    const x0 = Math.max(0, Math.round((cell.x + insetX) * sx));
    const x1 = Math.min(width, Math.round((cell.x + cell.width - insetX) * sx));
    const y0 = Math.max(0, Math.round((cell.drawingTop + insetY) * sy));
    const y1 = Math.min(height, Math.round((cell.y + cell.height - insetY) * sy));
    const sampleWidth = Math.max(1, x1 - x0);
    const sampleHeight = Math.max(1, y1 - y0);
    const values = new Uint8Array(sampleWidth * sampleHeight);
    for (let y = 0; y < sampleHeight; y += 1) values.set(gray.slice((y0 + y) * width + x0, (y0 + y) * width + x1), y * sampleWidth);

    const target = {
      x: cell.target.x * sx - x0,
      y: cell.target.y * sy - y0,
      radius: cell.target.radius * (sx + sy) / 2,
    };
    const suppressed = suppressPrintedTarget(values, sampleWidth, sampleHeight, target, options);
    const guideRows = [cell.capLine, cell.xHeightLine, cell.baseline, cell.descenderLine]
      .map((millimeters) => Math.round(millimeters * sy) - y0)
      .filter((row) => row >= 0 && row < sampleHeight);
    const baselineY = cell.baseline * sy - y0;
    const xHeightY = cell.xHeightLine * sy - y0;
    const recognition = recognizeGlyphCell(suppressed.values, sampleWidth, sampleHeight, {
      char: cell.char,
      guideRows,
      guideRowRadius: Math.max(1, Math.round(sy * 0.23)),
      knownGuideRowCoverage: Number(options.knownGuideRowCoverage ?? 0.42),
      thresholdDelta: Number(options.inkDelta ?? 34),
      absoluteCap: Number(options.absoluteCap ?? 220),
      backgroundRadius: Number(options.backgroundRadius ?? Math.max(4, Math.round(Math.min(sampleWidth, sampleHeight) / 8))),
      mergeStrength: Number(options.mergeStrength ?? 72),
      baselineY,
      xHeightY,
      fixedCell: true,
    });
    const targetInk = countTargetInk(recognition.mask, sampleWidth, sampleHeight, target, Number(options.targetRadiusScale ?? 1.35));
    const warnings = [];
    if (!recognition.inkCount) warnings.push('Пустая ячейка');
    if (recognition.inkCount && targetInk < Math.max(2, Math.round(target.radius * 0.32))) warnings.push('Штрих не доведён до цели');
    if (recognition.bbox && (recognition.bbox.x0 <= 1 || recognition.bbox.y0 <= 1 || recognition.bbox.y1 >= sampleHeight - 2)) warnings.push('Штрих касается края');
    if (recognition.areaRatio > 0.46) warnings.push('Слишком много чернил или тень');
    for (const reason of recognition.confidence.reasons) if (!warnings.includes(reason)) warnings.push(reason);

    samples.push({
      id: `join-p${page.pageIndex + 1}-c${cell.index + 1}`,
      char: cell.char,
      targetClass: cell.targetClass,
      targetCode: cell.targetCode,
      sampleIndex: cell.sampleIndex,
      width: sampleWidth,
      height: sampleHeight,
      mask: recognition.mask,
      guides: {
        capY: cell.capLine * sy - y0,
        xHeightY,
        baselineY,
        descenderY: cell.descenderLine * sy - y0,
      },
      target,
      quality: {
        inkCount: recognition.inkCount,
        targetInk,
        reachedTarget: targetInk >= Math.max(2, Math.round(target.radius * 0.32)),
        areaRatio: recognition.areaRatio,
        bbox: recognition.bbox,
        warnings,
        removedTargetGuidePixels: suppressed.removed,
        threshold: recognition.threshold,
        background: recognition.background,
        confidence: recognition.confidence,
        recognition: {
          version: recognition.recognitionVersion,
          method: recognition.method,
          qualityScore: recognition.qualityScore,
          candidates: recognition.candidates,
        },
      },
      source: {
        type: 'connection-template',
        pageIndex: page.pageIndex,
        pageNumber: page.pageNumber,
        cellIndex: cell.index,
      },
    });
  }
  return samples;
}

export function scanConnectionTemplatePage(gray, width, height, options = {}) {
  const rectified = rectifyTemplatePage(gray, width, height, options);
  const metadata = decodeRectifiedMetadata(rectified.gray, rectified.width, rectified.height);
  const plan = resolveConnectionTemplatePlan(metadata, options.activePlan || null);
  if (metadata.pageIndex >= plan.pages.length) throw new Error('Номер страницы выходит за пределы шаблона соединений.');
  const page = plan.pages[metadata.pageIndex];
  const samples = extractConnectionSamplesFromRectified(rectified, page, options);
  return {
    rectified,
    metadata,
    plan,
    page,
    samples,
    confidence: Math.min(...rectified.markers.map((marker) => marker.confidence)),
  };
}

export function scanConnectionTemplateWithRetries(gray, width, height, options = {}) {
  const variants = [
    { name: 'original', gray },
    { name: 'normalized', gray: normalizeGray(gray) },
    { name: 'strengthened', gray: strengthenDarkDetails(gray, width, height) },
  ];
  const outputWidths = [...new Set([Number(options.outputWidth || 1260), 1680, 1050])];
  const failures = [];
  for (const variant of variants) {
    for (const outputWidth of outputWidths) {
      try {
        const result = scanConnectionTemplatePage(variant.gray, width, height, { ...options, outputWidth });
        return { ...result, recovery: { variant: variant.name, outputWidth, automatic: true } };
      } catch (error) {
        failures.push(`${variant.name}/${outputWidth}: ${error.message}`);
      }
    }
  }
  const error = new Error(`Шаблон соединений автоматически не распознан. ${failures.join(' | ')}`);
  error.code = 'CONNECTION_SCAN_FAILED';
  error.failures = failures;
  throw error;
}

export function summarizeConnectionTemplatePages(results, plan) {
  const byPage = new Map();
  const duplicates = [];
  for (const result of results) {
    const index = result.metadata.pageIndex;
    if (byPage.has(index)) duplicates.push(index + 1);
    else byPage.set(index, result);
  }
  const missing = [];
  for (let index = 0; index < plan.pageCount; index += 1) if (!byPage.has(index)) missing.push(index + 1);
  const samples = [...byPage.entries()].sort(([left], [right]) => left - right).flatMap(([, result]) => result.samples);
  const empty = samples.filter((sample) => !sample.quality.inkCount).map((sample) => `${sample.char}-${sample.targetClass}`);
  const unreached = samples.filter((sample) => sample.quality.inkCount && !sample.quality.reachedTarget).map((sample) => `${sample.char}-${sample.targetClass}`);
  const warnings = samples.filter((sample) => sample.quality.warnings.length).length;
  const completePages = !missing.length && !duplicates.length;
  return {
    byPage,
    missing,
    duplicates,
    samples,
    empty,
    unreached,
    warnings,
    completePages,
    complete: completePages && samples.length === plan.samples.length && !empty.length && !unreached.length,
  };
}

function serializedSample(sample) {
  return {
    id: sample.id,
    char: sample.char,
    targetClass: sample.targetClass,
    sampleIndex: sample.sampleIndex,
    width: sample.width,
    height: sample.height,
    mask: rleEncode(sample.mask),
    guides: { ...sample.guides },
    target: { ...sample.target },
    quality: sample.quality,
    source: sample.source,
  };
}

export function applyConnectionSamplesToProject(project, summary, options = {}) {
  if (!project || !Array.isArray(project.glyphs)) throw new Error('Проект шрифта не загружен.');
  const samples = Array.isArray(summary) ? summary : summary?.samples;
  if (!Array.isArray(samples) || !samples.length) throw new Error('Образцы соединений отсутствуют.');
  const records = {};
  for (const sample of samples) {
    if (!records[sample.char]) records[sample.char] = {};
    records[sample.char][sample.targetClass] = serializedSample(sample);
  }
  project.connectionTemplate = {
    format: STORAGE_FORMAT,
    version: STORAGE_VERSION,
    templateVersion: CONNECTION_TEMPLATE_VERSION,
    updatedAt: new Date().toISOString(),
    complete: Boolean(summary?.complete),
    pageCount: Number(options.pageCount || summary?.byPage?.size || 0),
    sourceFiles: [...(options.sourceFiles || [])],
    samples: records,
  };
  project.updatedAt = project.connectionTemplate.updatedAt;
  return project.connectionTemplate;
}

export function getConnectionSample(project, character, targetClass) {
  const stored = project?.connectionTemplate?.samples?.[character]?.[targetClass];
  if (!stored) return null;
  const width = Math.max(1, Math.round(stored.width || 1));
  const height = Math.max(1, Math.round(stored.height || 1));
  return {
    ...stored,
    width,
    height,
    mask: rleDecode(stored.mask, width * height),
    guides: { ...stored.guides },
    target: { ...stored.target },
  };
}

export function listConnectionSamples(project) {
  const output = [];
  for (const [character, targets] of Object.entries(project?.connectionTemplate?.samples || {})) {
    for (const targetClass of Object.keys(targets || {})) {
      const sample = getConnectionSample(project, character, targetClass);
      if (sample) output.push(sample);
    }
  }
  return output.sort((left, right) => Number(left.sampleIndex) - Number(right.sampleIndex));
}
