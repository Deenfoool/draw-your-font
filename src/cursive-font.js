import {
  applyRussianDescenderPreset as applyCoreRussianDescenderPreset,
  buildCursiveTrueTypeFont as buildCoreCursiveFont,
  DESCENDER_LETTERS,
  ensureCursiveProject as ensureCoreCursiveProject,
  FORM_NAMES,
  generateCursiveFormMask as generateCoreCursiveFormMask,
  getCursiveGlyphMetrics,
  parseSfntDirectory,
  validateCursiveTrueType as validateCoreCursiveFont,
} from './cursive-font-v3.js';

export { DESCENDER_LETTERS, FORM_NAMES, getCursiveGlyphMetrics, parseSfntDirectory };

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function sanitizeCursiveAnchors(project) {
  const cursive = ensureCoreCursiveProject(project);
  for (const glyph of project.glyphs || []) {
    const config = cursive.glyphs?.[glyph.char];
    if (!config) continue;
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
  }
  project.cursive = cursive;
  return cursive;
}

export function ensureCursiveProject(project) {
  return sanitizeCursiveAnchors(project);
}

export function applyRussianDescenderPreset(project) {
  applyCoreRussianDescenderPreset(project);
  return sanitizeCursiveAnchors(project);
}

export function generateCursiveFormMask(glyph, form = 'isol', cursive, glyphConfig = {}) {
  const metrics = getCursiveGlyphMetrics(glyph, glyphConfig);
  const highestAllowedY = Math.max(0, metrics.baselineRatio - 0.01);
  const safeConfig = {
    ...glyphConfig,
    entry: { ...glyphConfig.entry, y: clamp(glyphConfig.entry?.y ?? cursive?.connectionY ?? 0.76, 0, highestAllowedY) },
    exit: { ...glyphConfig.exit, y: clamp(glyphConfig.exit?.y ?? cursive?.connectionY ?? 0.76, 0, highestAllowedY) },
  };
  return generateCoreCursiveFormMask(glyph, form, cursive, safeConfig);
}

export function simulateCursiveForms(text, project) {
  const cursive = sanitizeCursiveAnchors(project);
  const chars = [...String(text || '').normalize('NFC')];
  return chars.map((char, index) => {
    const config = cursive.glyphs?.[char];
    if (!config) return { char, form: 'isol', connectedLeft: false, connectedRight: false };
    const previous = cursive.glyphs?.[chars[index - 1]];
    const next = cursive.glyphs?.[chars[index + 1]];
    const connectedLeft = Boolean(previous?.joinRight && config.joinLeft);
    const connectedRight = Boolean(config.joinRight && next?.joinLeft);
    const form = connectedLeft && connectedRight ? 'medi' : connectedRight ? 'init' : connectedLeft ? 'fina' : 'isol';
    return { char, form, connectedLeft, connectedRight };
  });
}

function align4(value) { return (value + 3) & ~3; }

function checksum(bytes) {
  const length = align4(bytes.length);
  const padded = length === bytes.length ? bytes : (() => { const out = new Uint8Array(length); out.set(bytes); return out; })();
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) sum = (sum + view.getUint32(offset, false)) >>> 0;
  return sum >>> 0;
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
      recordOffset,
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
    result.set(tag, { feature, lookups });
  }
  return result;
}

export function restrictCursiveFeatureLookups(ttfBytes) {
  const input = ttfBytes instanceof Uint8Array ? ttfBytes : new Uint8Array(ttfBytes);
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const features = featureLookupMap(bytes);
  for (const tag of ['calt', 'rlig']) {
    const record = features.get(tag);
    if (!record) throw new Error(`В GSUB отсутствует функция ${tag}.`);
    if (record.lookups.length < 6) throw new Error(`Функция ${tag} содержит неполный набор контекстных lookup.`);
    view.setUint16(record.feature + 2, 3, false);
    view.setUint16(record.feature + 4, 1, false);
    view.setUint16(record.feature + 6, 3, false);
    view.setUint16(record.feature + 8, 5, false);
  }

  const head = sfntRecord(bytes, 'head');
  const gsub = sfntRecord(bytes, 'GSUB');
  if (!head || !gsub) throw new Error('Не найдены таблицы head/GSUB для пересчёта контрольных сумм.');
  bytes.fill(0, head.offset + 8, head.offset + 12);
  view.setUint32(gsub.recordOffset + 4, checksum(bytes.slice(gsub.offset, gsub.offset + gsub.length)), false);
  view.setUint32(head.offset + 8, (0xb1b0afba - checksum(bytes)) >>> 0, false);
  return bytes;
}

export function readCursiveFeatureLookups(ttfBytes) {
  return Object.fromEntries([...featureLookupMap(ttfBytes).entries()].map(([tag, record]) => [tag, [...record.lookups]]));
}

export function buildCursiveTrueTypeFont(project, options = {}) {
  sanitizeCursiveAnchors(project);
  const built = buildCoreCursiveFont(project, options);
  built.ttf = restrictCursiveFeatureLookups(built.ttf);
  return built;
}

export function validateCursiveTrueType(ttfBytes) {
  const errors = validateCoreCursiveFont(ttfBytes);
  try {
    const lookups = readCursiveFeatureLookups(ttfBytes);
    for (const tag of ['calt', 'rlig']) {
      if (JSON.stringify(lookups[tag]) !== JSON.stringify([1, 3, 5])) errors.push(`Функция ${tag} должна ссылаться только на контекстные lookup 1, 3 и 5.`);
    }
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}
