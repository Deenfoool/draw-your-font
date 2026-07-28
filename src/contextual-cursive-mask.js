import { getCursiveGlyphMetrics } from './cursive-font-v3.js';
import { resolveConnectionRatio } from './russian-joining.js';

const FORM_SUFFIX = Object.freeze({ upper: 'u', middle: 'm', lower: 'l', special: 's' });
const SUFFIX_CLASS = Object.freeze(Object.fromEntries(Object.entries(FORM_SUFFIX).map(([key, value]) => [value, key])));
const BASE_FORMS = new Set(['isol', 'init', 'medi', 'fina']);

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function parseContextualForm(value) {
  const [baseForm, suffix] = String(value || 'isol').split('.');
  if (!BASE_FORMS.has(baseForm)) throw new Error(`Неизвестная форма ${value}.`);
  const targetClass = suffix ? SUFFIX_CLASS[suffix] : null;
  if (suffix && !targetClass) throw new Error(`Неизвестный класс соединения ${suffix}.`);
  return { baseForm, targetClass };
}

function drawDisk(mask, width, height, x, y, radius) {
  const cx = Math.round(x); const cy = Math.round(y); const r = Math.max(1, Math.round(radius));
  for (let py = cy - r; py <= cy + r; py += 1) for (let px = cx - r; px <= cx + r; px += 1) {
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    if ((px - cx) ** 2 + (py - cy) ** 2 <= r ** 2 + 0.75) mask[py * width + px] = 1;
  }
}

function drawQuadratic(mask, width, height, start, control, end, radius) {
  const steps = Math.max(12, Math.ceil((Math.hypot(control.x - start.x, control.y - start.y) + Math.hypot(end.x - control.x, end.y - control.y)) * 2));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps; const mt = 1 - t;
    drawDisk(mask, width, height,
      mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
      radius);
  }
}

function remapDescenderMask(glyph, metrics) {
  const sourceLast = Math.max(1, glyph.height - 1);
  const baseline = metrics.baselineY;
  const scale = metrics.hasDescender ? metrics.descenderScale : 1;
  const outputLast = Math.max(Math.ceil(baseline + (sourceLast - baseline) * scale), Math.ceil(baseline + 1));
  const height = outputLast + 1;
  const mask = new Uint8Array(glyph.width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = y <= baseline ? y : baseline + (y - baseline) / Math.max(0.01, scale);
    const sy = Math.max(0, Math.min(glyph.height - 1, Math.round(sourceY)));
    for (let x = 0; x < glyph.width; x += 1) mask[y * glyph.width + x] = glyph.mask[sy * glyph.width + x] ? 1 : 0;
  }
  const mapY = (value) => value <= baseline ? value : baseline + (value - baseline) * scale;
  return {
    mask,
    width: glyph.width,
    height,
    capY: mapY(metrics.capY),
    xHeightY: mapY(metrics.xHeightY),
    baselineY: mapY(metrics.baselineY),
    descenderY: mapY(metrics.descenderY),
  };
}

export function generateRussianContextualFormMask(glyph, form = 'isol', cursive = {}, glyphConfig = {}) {
  const parsed = parseContextualForm(form);
  const { baseForm } = parsed;
  const addLeft = (baseForm === 'medi' || baseForm === 'fina') && glyphConfig.joinLeft !== false;
  const addRight = (baseForm === 'init' || baseForm === 'medi') && glyphConfig.joinRight !== false;
  const targetClass = addRight ? (parsed.targetClass || 'middle') : 'none';
  const metrics = getCursiveGlyphMetrics(glyph, glyphConfig);
  const remapped = remapDescenderMask(glyph, metrics);
  const tail = Math.max(5, Math.round(glyph.width * clamp(cursive.tailLength ?? 0.34, 0.08, 0.8)));
  const leftPad = addLeft ? tail : 0;
  const rightPad = addRight ? tail : 0;
  const width = remapped.width + leftPad + rightPad;
  const height = remapped.height;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < remapped.width; x += 1) {
    if (remapped.mask[y * remapped.width + x]) mask[y * width + x + leftPad] = 1;
  }

  const sourceLast = Math.max(1, glyph.height - 1);
  const leftExternalRatio = resolveConnectionRatio(metrics, glyphConfig.entryClass || 'middle', { fallback: cursive.connectionY ?? 0.76 });
  const selectedExit = glyphConfig.exitVariants?.[targetClass] || glyphConfig.exit || {};
  const rightExternalRatio = targetClass === 'none'
    ? resolveConnectionRatio(metrics, 'middle', { fallback: cursive.connectionY ?? 0.76 })
    : clamp(selectedExit.y ?? resolveConnectionRatio(metrics, targetClass), metrics.xHeightRatio, metrics.baselineRatio - 0.01);
  const leftExternalY = leftExternalRatio * sourceLast;
  const rightExternalY = rightExternalRatio * sourceLast;
  const radius = clamp(cursive.thickness ?? 2.2, 1, 8) / 2;
  const smooth = clamp(cursive.smoothness ?? 0.62, 0, 1);
  const entry = {
    x: leftPad + clamp(glyphConfig.entry?.x ?? 0.08, 0, 1) * Math.max(1, glyph.width - 1),
    y: clamp(glyphConfig.entry?.y ?? leftExternalRatio, 0, 1) * sourceLast,
  };
  const exit = {
    x: leftPad + clamp(selectedExit.x ?? glyphConfig.exit?.x ?? 0.92, 0, 1) * Math.max(1, glyph.width - 1),
    y: clamp(selectedExit.y ?? glyphConfig.exit?.y ?? rightExternalRatio, 0, 1) * sourceLast,
  };

  if (addLeft) {
    const start = { x: 0, y: leftExternalY };
    const control = {
      x: entry.x * (0.32 + smooth * 0.34),
      y: leftExternalY * (1 - smooth) + entry.y * smooth,
    };
    drawQuadratic(mask, width, height, start, control, entry, radius);
    drawDisk(mask, width, height, 0, leftExternalY, radius);
  }
  if (addRight) {
    const end = { x: width - 1, y: rightExternalY };
    const control = {
      x: exit.x + (end.x - exit.x) * (0.66 - smooth * 0.34),
      y: exit.y * smooth + rightExternalY * (1 - smooth),
    };
    drawQuadratic(mask, width, height, exit, control, end, radius);
    drawDisk(mask, width, height, width - 1, rightExternalY, radius);
  }

  return {
    mask,
    width,
    height,
    externalY: addRight ? rightExternalY : leftExternalY,
    leftExternalY,
    rightExternalY,
    entry,
    exit,
    leftPad,
    rightPad,
    targetClass,
    baseForm,
    capY: remapped.capY,
    xHeightY: remapped.xHeightY,
    baselineY: remapped.baselineY,
    descenderY: remapped.descenderY,
    hasDescender: metrics.hasDescender,
    descenderScale: metrics.descenderScale,
  };
}
