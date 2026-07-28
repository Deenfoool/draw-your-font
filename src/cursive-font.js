import {
  applyRussianDescenderPreset as applyCoreRussianDescenderPreset,
  DESCENDER_LETTERS,
  ensureCursiveProject as ensureCoreCursiveProject,
  FORM_NAMES,
  getCursiveGlyphMetrics,
  parseSfntDirectory,
  validateCursiveTrueType as validateCoreCursiveFont,
} from './cursive-font-v3.js';
import { buildRussianContextualCursiveFont } from './contextual-cursive-font.js';
import { generateRussianContextualFormMask } from './contextual-cursive-mask.js';
import {
  connectionRatioToFontLevel,
  createDefaultExitVariants,
  getRussianEntryClass,
  getRussianEntryMode,
  JOINING_CLASSES,
  JOINING_GRAMMAR_VERSION,
  JOINING_PRESET,
  JOINING_TARGET_CLASSES,
  normalizeJoiningClass,
  resolveConnectionRatio,
  resolveJoiningSequence,
  RUSSIAN_CONNECTION_LEVELS,
  RUSSIAN_LOWERCASE,
  RUSSIAN_SCHOOL_ENTRY_CLASS,
  sanitizePairOverrides,
  validateRussianSchoolPreset,
} from './russian-joining.js';

export {
  DESCENDER_LETTERS,
  FORM_NAMES,
  getCursiveGlyphMetrics,
  parseSfntDirectory,
  connectionRatioToFontLevel,
  createDefaultExitVariants,
  generateRussianContextualFormMask,
  getRussianEntryClass,
  getRussianEntryMode,
  JOINING_CLASSES,
  JOINING_GRAMMAR_VERSION,
  JOINING_PRESET,
  JOINING_TARGET_CLASSES,
  normalizeJoiningClass,
  resolveConnectionRatio,
  resolveJoiningSequence,
  RUSSIAN_CONNECTION_LEVELS,
  RUSSIAN_LOWERCASE,
  RUSSIAN_SCHOOL_ENTRY_CLASS,
  sanitizePairOverrides,
  validateRussianSchoolPreset,
};

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function cloneAdjustment(value = {}) {
  return {
    offsetX: Number(value?.offsetX || 0),
    offsetY: Number(value?.offsetY || 0),
    scale: clamp(value?.scale ?? 1, 0.55, 1.8),
  };
}

function cloneExitVariants(value = {}) {
  return Object.fromEntries(JOINING_TARGET_CLASSES.map((joiningClass) => {
    const point = value?.[joiningClass];
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return [joiningClass, {}];
    return [joiningClass, { x: Number(point.x), y: Number(point.y) }];
  }));
}

function cloneContextualForms(value = {}) {
  return {
    init: Object.fromEntries(JOINING_TARGET_CLASSES.map((joiningClass) => [joiningClass, cloneAdjustment(value?.init?.[joiningClass])])),
    medi: Object.fromEntries(JOINING_TARGET_CLASSES.map((joiningClass) => [joiningClass, cloneAdjustment(value?.medi?.[joiningClass])])),
    fina: cloneAdjustment(value?.fina),
  };
}

function captureJoiningState(cursive = {}) {
  return {
    joiningVersion: Number(cursive.joiningVersion) || JOINING_GRAMMAR_VERSION,
    joiningPreset: typeof cursive.joiningPreset === 'string' && cursive.joiningPreset ? cursive.joiningPreset : JOINING_PRESET,
    pairOverrides: sanitizePairOverrides(cursive.pairOverrides || {}),
    glyphs: Object.fromEntries(Object.entries(cursive.glyphs || {}).map(([char, config]) => [char, {
      entryClass: config?.entryClass,
      entryMode: config?.entryMode,
      exitVariants: cloneExitVariants(config?.exitVariants),
      contextualForms: cloneContextualForms(config?.contextualForms),
    }])),
  };
}

function sanitizeCursiveAnchors(project, preservedJoiningState = null) {
  const joiningState = preservedJoiningState || captureJoiningState(project?.cursive || {});
  const cursive = ensureCoreCursiveProject(project);
  cursive.joiningVersion = Math.max(JOINING_GRAMMAR_VERSION, Number(joiningState.joiningVersion) || 0);
  cursive.joiningPreset = joiningState.joiningPreset || JOINING_PRESET;
  cursive.pairOverrides = sanitizePairOverrides(joiningState.pairOverrides || {});

  for (const glyph of project.glyphs || []) {
    const config = cursive.glyphs?.[glyph.char];
    if (!config) continue;
    const saved = joiningState.glyphs?.[glyph.char] || {};
    const metrics = getCursiveGlyphMetrics(glyph, config);
    const highestAllowedY = Math.max(0, metrics.baselineRatio - 0.01);
    const fallbackY = clamp(cursive.connectionY, metrics.xHeightRatio, highestAllowedY);
    config.entry = {
      x: clamp(config.entry?.x ?? 0.08, 0, 1),
      y: clamp(config.entry?.y ?? fallbackY, 0, highestAllowedY),
    };
    config.exit = {
      x: clamp(config.exit?.x ?? 0.92, 0, 1),
      y: clamp(config.exit?.y ?? fallbackY, 0, highestAllowedY),
    };
    config.entryClass = getRussianEntryClass(glyph.char, saved.entryClass ? { entryClass: saved.entryClass } : config);
    config.entryMode = getRussianEntryMode(glyph.char, saved.entryMode ? { entryMode: saved.entryMode } : config);
    const variants = createDefaultExitVariants(metrics, config.exit, saved.exitVariants || {});
    config.exitVariants = Object.fromEntries(JOINING_TARGET_CLASSES.map((joiningClass) => [joiningClass, {
      x: clamp(variants[joiningClass].x, 0, 1),
      y: clamp(variants[joiningClass].y, metrics.xHeightRatio, highestAllowedY),
    }]));
    config.contextualForms = cloneContextualForms(saved.contextualForms || config.contextualForms);
  }
  project.cursive = cursive;
  return cursive;
}

export function ensureCursiveProject(project) {
  return sanitizeCursiveAnchors(project);
}

export function applyRussianDescenderPreset(project) {
  const joiningState = captureJoiningState(project?.cursive || {});
  applyCoreRussianDescenderPreset(project);
  return sanitizeCursiveAnchors(project, joiningState);
}

export function generateCursiveFormMask(glyph, form = 'isol', cursive, glyphConfig = {}) {
  const metrics = getCursiveGlyphMetrics(glyph, glyphConfig);
  const highestAllowedY = Math.max(0, metrics.baselineRatio - 0.01);
  const safeConfig = {
    ...glyphConfig,
    entry: { ...glyphConfig.entry, y: clamp(glyphConfig.entry?.y ?? cursive?.connectionY ?? 0.76, 0, highestAllowedY) },
    exit: { ...glyphConfig.exit, y: clamp(glyphConfig.exit?.y ?? cursive?.connectionY ?? 0.76, 0, highestAllowedY) },
  };
  return generateRussianContextualFormMask(glyph, form, cursive, safeConfig);
}

export function simulateCursiveForms(text, project) {
  const cursive = sanitizeCursiveAnchors(project);
  return resolveJoiningSequence(text, cursive.glyphs, { pairOverrides: cursive.pairOverrides });
}

function tagAt(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function sfntRecord(bytes, wantedTag) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, false);
  for (let index = 0; index < count; index += 1) {
    const recordOffset = 12 + index * 16;
    if (tagAt(bytes, recordOffset) !== wantedTag) continue;
    return {
      offset: view.getUint32(recordOffset + 8, false),
      length: view.getUint32(recordOffset + 12, false),
    };
  }
  return null;
}

function featureLookupMap(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gsub = sfntRecord(bytes, 'GSUB');
  if (!gsub) throw new Error('В связном шрифте отсутствует GSUB.');
  const featureList = gsub.offset + view.getUint16(gsub.offset + 6, false);
  const count = view.getUint16(featureList, false);
  const result = new Map();
  for (let index = 0; index < count; index += 1) {
    const record = featureList + 2 + index * 6;
    const tag = tagAt(bytes, record);
    const feature = featureList + view.getUint16(record + 4, false);
    const lookupCount = view.getUint16(feature + 2, false);
    const lookups = [];
    for (let lookupIndex = 0; lookupIndex < lookupCount; lookupIndex += 1) lookups.push(view.getUint16(feature + 4 + lookupIndex * 2, false));
    result.set(tag, { lookups });
  }
  return result;
}

export function readCursiveFeatureLookups(ttfBytes) {
  return Object.fromEntries([...featureLookupMap(ttfBytes).entries()].map(([tag, record]) => [tag, [...record.lookups]]));
}

export function buildCursiveTrueTypeFont(project, options = {}) {
  const cursive = sanitizeCursiveAnchors(project);
  const joiningState = captureJoiningState(cursive);
  const built = buildRussianContextualCursiveFont(project, options);
  const restored = sanitizeCursiveAnchors(project, joiningState);
  built.layout.joining = captureJoiningState(restored);
  return built;
}

export function validateCursiveTrueType(ttfBytes) {
  const errors = validateCoreCursiveFont(ttfBytes);
  try {
    const lookups = readCursiveFeatureLookups(ttfBytes);
    const calt = lookups.calt || [];
    const rlig = lookups.rlig || [];
    if (!calt.length) errors.push('Функция calt не содержит контекстных lookup.');
    if (!rlig.length) errors.push('Функция rlig не содержит контекстных lookup.');
    if (JSON.stringify(calt) !== JSON.stringify(rlig)) errors.push('Функции calt и rlig должны использовать одинаковую русскую грамматику соединений.');
    if (calt.some((lookupIndex) => lookupIndex % 2 !== 1)) errors.push('Функция calt должна ссылаться только на контекстные lookup.');
    if (rlig.some((lookupIndex) => lookupIndex % 2 !== 1)) errors.push('Функция rlig должна ссылаться только на контекстные lookup.');
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}
