import {
  buildTrueTypeFont,
  createGlyphSet,
  parseSfntTables,
  validateTrueType,
  vectorizeGlyph,
} from './font-builder.js';

const FORM_NAMES = Object.freeze(['isol', 'init', 'medi', 'fina']);
const DEFAULTS = Object.freeze({
  enabled: false,
  connectionY: 0.76,
  tailLength: 0.34,
  thickness: 2.2,
  smoothness: 0.62,
});

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }
function isCyrillicLower(char) { return /^[а-яё]$/u.test(char); }
function cloneForm(value = {}) {
  return {
    offsetX: Number(value.offsetX || 0),
    offsetY: Number(value.offsetY || 0),
    scale: clamp(value.scale ?? 1, 0.55, 1.8),
  };
}

export function ensureCursiveProject(project) {
  if (!project || !Array.isArray(project.glyphs)) throw new Error('Проект шрифта не загружен.');
  const previous = project.cursive || {};
  const cursive = {
    enabled: Boolean(previous.enabled),
    connectionY: clamp(previous.connectionY ?? DEFAULTS.connectionY, 0.45, 0.94),
    tailLength: clamp(previous.tailLength ?? DEFAULTS.tailLength, 0.08, 0.8),
    thickness: clamp(previous.thickness ?? DEFAULTS.thickness, 1, 8),
    smoothness: clamp(previous.smoothness ?? DEFAULTS.smoothness, 0, 1),
    glyphs: { ...(previous.glyphs || {}) },
  };
  for (const glyph of project.glyphs) {
    const char = [...String(glyph.char || '').normalize('NFC')][0] || '';
    if (!char) continue;
    const old = cursive.glyphs[char] || {};
    const joinable = isCyrillicLower(char);
    cursive.glyphs[char] = {
      joinLeft: old.joinLeft == null ? joinable : Boolean(old.joinLeft),
      joinRight: old.joinRight == null ? joinable : Boolean(old.joinRight),
      entry: {
        x: clamp(old.entry?.x ?? 0.08, 0, 1),
        y: clamp(old.entry?.y ?? cursive.connectionY, 0, 1),
      },
      exit: {
        x: clamp(old.exit?.x ?? 0.92, 0, 1),
        y: clamp(old.exit?.y ?? cursive.connectionY, 0, 1),
      },
      forms: Object.fromEntries(FORM_NAMES.map((name) => [name, cloneForm(old.forms?.[name])])),
    };
  }
  project.cursive = cursive;
  return cursive;
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

export function generateCursiveFormMask(glyph, form = 'isol', cursive = DEFAULTS, glyphConfig = {}) {
  if (!FORM_NAMES.includes(form)) throw new Error(`Неизвестная форма ${form}.`);
  const addLeft = (form === 'medi' || form === 'fina') && glyphConfig.joinLeft !== false;
  const addRight = (form === 'init' || form === 'medi') && glyphConfig.joinRight !== false;
  const tail = Math.max(5, Math.round(glyph.width * clamp(cursive.tailLength ?? DEFAULTS.tailLength, 0.08, 0.8)));
  const leftPad = addLeft ? tail : 0; const rightPad = addRight ? tail : 0;
  const width = glyph.width + leftPad + rightPad; const height = glyph.height;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < glyph.height; y += 1) for (let x = 0; x < glyph.width; x += 1) {
    if (glyph.mask[y * glyph.width + x]) mask[y * width + x + leftPad] = 1;
  }
  const externalY = clamp(cursive.connectionY ?? DEFAULTS.connectionY, 0.45, 0.94) * (height - 1);
  const radius = clamp(cursive.thickness ?? DEFAULTS.thickness, 1, 8) / 2;
  const smooth = clamp(cursive.smoothness ?? DEFAULTS.smoothness, 0, 1);
  const entry = {
    x: leftPad + clamp(glyphConfig.entry?.x ?? 0.08, 0, 1) * Math.max(1, glyph.width - 1),
    y: clamp(glyphConfig.entry?.y ?? cursive.connectionY ?? DEFAULTS.connectionY, 0, 1) * (height - 1),
  };
  const exit = {
    x: leftPad + clamp(glyphConfig.exit?.x ?? 0.92, 0, 1) * Math.max(1, glyph.width - 1),
    y: clamp(glyphConfig.exit?.y ?? cursive.connectionY ?? DEFAULTS.connectionY, 0, 1) * (height - 1),
  };
  if (addLeft) {
    const start = { x: 0, y: externalY };
    const control = { x: entry.x * (0.32 + smooth * 0.34), y: externalY * (1 - smooth) + entry.y * smooth };
    drawQuadratic(mask, width, height, start, control, entry, radius);
    drawDisk(mask, width, height, 0, externalY, radius);
  }
  if (addRight) {
    const end = { x: width - 1, y: externalY };
    const control = { x: exit.x + (end.x - exit.x) * (0.66 - smooth * 0.34), y: exit.y * smooth + externalY * (1 - smooth) };
    drawQuadratic(mask, width, height, exit, control, end, radius);
    drawDisk(mask, width, height, width - 1, externalY, radius);
  }
  return { mask, width, height, externalY, entry, exit, leftPad, rightPad };
}

export function simulateCursiveForms(text, project) {
  const cursive = ensureCursiveProject(project);
  const chars = [...String(text || '').normalize('NFC')];
  return chars.map((char, index) => {
    const config = cursive.glyphs[char];
    if (!config) return { char, form: 'isol', connectedLeft: false, connectedRight: false };
    const previous = cursive.glyphs[chars[index - 1]];
    const next = cursive.glyphs[chars[index + 1]];
    const connectedLeft = Boolean(previous?.joinRight && config.joinLeft);
    const connectedRight = Boolean(config.joinRight && next?.joinLeft);
    const form = connectedLeft && connectedRight ? 'medi' : connectedRight ? 'init' : connectedLeft ? 'fina' : 'isol';
    return { char, form, connectedLeft, connectedRight };
  });
}

function createAtlas(project) {
  const sourceGlyphs = project.glyphs.filter((glyph) => glyph.char && glyph.mask?.some(Boolean));
  if (!sourceGlyphs.length) throw new Error('В проекте нет непустых подписанных символов.');
  const tileWidth = Math.max(...sourceGlyphs.map((glyph) => glyph.width)) + 4;
  const tileHeight = Math.max(...sourceGlyphs.map((glyph) => glyph.height)) + 4;
  const columns = Math.min(12, sourceGlyphs.length); const rows = Math.ceil(sourceGlyphs.length / columns);
  const width = columns * tileWidth; const height = rows * tileHeight; const mask = new Uint8Array(width * height);
  const boxes = []; const labels = [];
  sourceGlyphs.forEach((glyph, index) => {
    const ox = (index % columns) * tileWidth + 2; const oy = Math.floor(index / columns) * tileHeight + 2;
    for (let y = 0; y < glyph.height; y += 1) for (let x = 0; x < glyph.width; x += 1) if (glyph.mask[y * glyph.width + x]) mask[(oy + y) * width + ox + x] = 1;
    boxes.push({ x0: ox, y0: oy, x1: ox + glyph.width - 1, y1: oy + glyph.height - 1 }); labels.push(glyph.char);
  });
  return { width, height, mask, glyphs: boxes, labels, records: sourceGlyphs };
}

function transformVector(vector, adjustment = {}) {
  const scale = clamp(adjustment.scale ?? 1, 0.55, 1.8);
  const dx = Number(adjustment.offsetX || 0) * 8; const dy = Number(adjustment.offsetY || 0) * 8;
  const contours = vector.contours.map((contour) => contour.map((point) => ({ ...point, x: Math.round(point.x * scale + dx), y: Math.round(point.y * scale + dy) })));
  const points = contours.flat();
  const xMin = points.length ? Math.min(...points.map((p) => p.x)) : 0; const xMax = points.length ? Math.max(...points.map((p) => p.x)) : 0;
  const yMin = points.length ? Math.min(...points.map((p) => p.y)) : 0; const yMax = points.length ? Math.max(...points.map((p) => p.y)) : 0;
  return { ...vector, contours, xMin, xMax, yMin, yMax, advanceWidth: Math.max(120, Math.round(vector.advanceWidth * scale + dx)) };
}

function bytes(...values) { return Uint8Array.from(values); }
function concat(parts) { const size = parts.reduce((sum, part) => sum + part.length, 0); const out = new Uint8Array(size); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; }
function be16(value) { return bytes((value >>> 8) & 255, value & 255); }
function beS16(value) { return be16(value & 0xffff); }
function be32(value) { return bytes((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255); }
function ascii(value) { return Uint8Array.from([...value].map((char) => char.charCodeAt(0))); }
function align4(value) { return (value + 3) & ~3; }
function pad4(value) { if (!(value.length % 4)) return value; const out = new Uint8Array(align4(value.length)); out.set(value); return out; }
function checksum(value) { const data = pad4(value); const view = new DataView(data.buffer, data.byteOffset, data.byteLength); let sum = 0; for (let i = 0; i < data.length; i += 4) sum = (sum + view.getUint32(i, false)) >>> 0; return sum; }
function coverage(ids) { const sorted = [...new Set(ids)].sort((a, b) => a - b); return concat([be16(1), be16(sorted.length), ...sorted.map(be16)]); }

function singleSubstitution(mapping) {
  const pairs = [...mapping.entries()].sort((a, b) => a[0] - b[0]);
  const cov = coverage(pairs.map(([source]) => source));
  const headLength = 6 + pairs.length * 2;
  return concat([be16(2), be16(headLength), be16(pairs.length), ...pairs.map(([, target]) => be16(target)), cov]);
}

function chainContext({ backtrack = [], input = [], lookahead = [], lookupIndex }) {
  const back = backtrack.map(coverage); const inputs = input.map(coverage); const ahead = lookahead.map(coverage);
  const headerLength = 2 + 2 + back.length * 2 + 2 + inputs.length * 2 + 2 + ahead.length * 2 + 2 + 4;
  let offset = headerLength;
  const backOffsets = back.map((table) => { const current = offset; offset += table.length; return current; });
  const inputOffsets = inputs.map((table) => { const current = offset; offset += table.length; return current; });
  const aheadOffsets = ahead.map((table) => { const current = offset; offset += table.length; return current; });
  return concat([
    be16(3), be16(back.length), ...backOffsets.map(be16), be16(inputs.length), ...inputOffsets.map(be16),
    be16(ahead.length), ...aheadOffsets.map(be16), be16(1), be16(0), be16(lookupIndex),
    ...back, ...inputs, ...ahead,
  ]);
}

function lookup(type, subtable) { return concat([be16(type), be16(0), be16(1), be16(8), subtable]); }
function lookupList(lookups) { const header = 2 + lookups.length * 2; let offset = header; const offsets = lookups.map((item) => { const current = offset; offset += item.length; return current; }); return concat([be16(lookups.length), ...offsets.map(be16), ...lookups]); }
function langSys(featureIndices) { return concat([be16(0), be16(0xffff), be16(featureIndices.length), ...featureIndices.map(be16)]); }
function scriptTable(featureIndices) { const lang = langSys(featureIndices); return concat([be16(4), be16(0), lang]); }
function scriptList(featureIndices) {
  const a = scriptTable(featureIndices); const b = scriptTable(featureIndices); const header = 2 + 2 * 6;
  return concat([be16(2), ascii('DFLT'), be16(header), ascii('cyrl'), be16(header + a.length), a, b]);
}
function featureTable(indices) { return concat([be16(0), be16(indices.length), ...indices.map(be16)]); }
function featureList(features) {
  const tables = features.map((feature) => featureTable(feature.lookups)); const header = 2 + features.length * 6; let offset = header;
  const records = features.map((feature, index) => { const current = offset; offset += tables[index].length; return concat([ascii(feature.tag), be16(current)]); });
  return concat([be16(features.length), ...records, ...tables]);
}

function buildGsub(layout) {
  const rightBase = []; const leftBase = []; const initIds = []; const connectedPrevious = [];
  const baseToInit = new Map(); const initToMedi = new Map(); const baseToFina = new Map();
  for (const [char, forms] of Object.entries(layout.forms)) {
    const config = layout.config[char];
    if (config.joinRight) { rightBase.push(forms.isol); baseToInit.set(forms.isol, forms.init); connectedPrevious.push(forms.init, forms.medi); }
    if (config.joinLeft) { leftBase.push(forms.isol); initIds.push(forms.init); initToMedi.set(forms.init, forms.medi); baseToFina.set(forms.isol, forms.fina); }
  }
  const lookups = [
    lookup(1, singleSubstitution(baseToInit)),
    lookup(6, chainContext({ input: [rightBase], lookahead: [leftBase], lookupIndex: 0 })),
    lookup(1, singleSubstitution(initToMedi)),
    lookup(6, chainContext({ backtrack: [connectedPrevious], input: [initIds], lookupIndex: 2 })),
    lookup(1, singleSubstitution(baseToFina)),
    lookup(6, chainContext({ backtrack: [connectedPrevious], input: [leftBase], lookupIndex: 4 })),
  ];
  const scripts = scriptList([0, 1]);
  const features = featureList([{ tag: 'calt', lookups: [0, 1, 2, 3, 4, 5] }, { tag: 'rlig', lookups: [0, 1, 2, 3, 4, 5] }]);
  const list = lookupList(lookups); const header = 10;
  return concat([be32(0x00010000), be16(header), be16(header + scripts.length), be16(header + scripts.length + features.length), scripts, features, list]);
}

function anchor(x, y) { return concat([be16(1), beS16(Math.round(x)), beS16(Math.round(y))]); }
function buildCursiveSubtable(glyphs) {
  const records = glyphs.map((glyph, id) => ({ id, entry: glyph.cursiveEntry || null, exit: glyph.cursiveExit || null })).filter((record) => record.entry || record.exit);
  const cov = coverage(records.map((record) => record.id)); const headerLength = 6 + records.length * 4; let offset = headerLength + cov.length;
  const anchors = []; const offsets = [];
  for (const record of records) {
    let entryOffset = 0; let exitOffset = 0;
    if (record.entry) { const value = anchor(record.entry.x, record.entry.y); entryOffset = offset; offset += value.length; anchors.push(value); }
    if (record.exit) { const value = anchor(record.exit.x, record.exit.y); exitOffset = offset; offset += value.length; anchors.push(value); }
    offsets.push([entryOffset, exitOffset]);
  }
  return concat([be16(1), be16(headerLength), be16(records.length), ...offsets.flatMap(([entry, exit]) => [be16(entry), be16(exit)]), cov, ...anchors]);
}
function buildGpos(glyphs) {
  const scripts = scriptList([0]); const features = featureList([{ tag: 'curs', lookups: [0] }]); const list = lookupList([lookup(3, buildCursiveSubtable(glyphs))]); const header = 10;
  return concat([be32(0x00010000), be16(header), be16(header + scripts.length), be16(header + scripts.length + features.length), scripts, features, list]);
}

function buildKern(project, baseIds) {
  const pairs = [];
  for (const [key, raw] of Object.entries(project.kerning || {})) {
    const [left, right] = key.split('|'); if (!baseIds.has(left) || !baseIds.has(right)) continue;
    const value = Math.round(Number(raw) || 0); if (value) pairs.push({ left: baseIds.get(left), right: baseIds.get(right), value });
  }
  pairs.sort((a, b) => a.left - b.left || a.right - b.right);
  const count = pairs.length; const maxPower = count ? 2 ** Math.floor(Math.log2(count)) : 0;
  const body = concat([be16(count), be16(maxPower * 6), be16(count ? Math.log2(maxPower) : 0), be16(count * 6 - maxPower * 6), ...pairs.flatMap((pair) => [be16(pair.left), be16(pair.right), beS16(pair.value)])]);
  return concat([be16(0), be16(1), be16(0), be16(6 + body.length), be16(1), body]);
}

function rebuildSfnt(ttf, additions) {
  const parsed = parseSfntTables(ttf); const tables = new Map(parsed.tables.map((table) => [table.tag, new Uint8Array(table.bytes)]));
  for (const [tag, data] of additions) tables.set(tag, data);
  if (tables.has('head')) tables.get('head').fill(0, 8, 12);
  const tags = [...tables.keys()].sort(); const count = tags.length; const maxPower = 2 ** Math.floor(Math.log2(count)); const directoryLength = 12 + count * 16;
  let offset = directoryLength; const records = tags.map((tag) => { const data = tables.get(tag); const record = { tag, data, offset, checksum: checksum(data) }; offset += align4(data.length); return record; });
  const out = new Uint8Array(offset); const view = new DataView(out.buffer);
  view.setUint32(0, parsed.flavor, false); view.setUint16(4, count, false); view.setUint16(6, maxPower * 16, false); view.setUint16(8, Math.log2(maxPower), false); view.setUint16(10, count * 16 - maxPower * 16, false);
  records.forEach((record, index) => { const at = 12 + index * 16; out.set(ascii(record.tag), at); view.setUint32(at + 4, record.checksum, false); view.setUint32(at + 8, record.offset, false); view.setUint32(at + 12, record.data.length, false); out.set(record.data, record.offset); });
  const head = records.find((record) => record.tag === 'head'); view.setUint32(head.offset + 8, (0xb1b0afba - checksum(out)) >>> 0, false); return out;
}

export function parseSfntDirectory(bytesValue) { return parseSfntTables(bytesValue).tables.map(({ tag, offset, length, checksum: sum }) => ({ tag, offset, length, checksum: sum })); }

export function buildCursiveTrueTypeFont(project, options = {}) {
  const cursive = ensureCursiveProject(project); const atlas = createAtlas(project);
  const base = createGlyphSet(atlas, options); const glyphs = [...base.glyphs]; const baseIds = new Map(); const recordByChar = new Map(atlas.records.map((glyph) => [glyph.char, glyph]));
  base.entries.forEach((entry, index) => baseIds.set(entry.character, index + 2));
  const layout = { forms: {}, config: {}, baseIds: Object.fromEntries(baseIds) };
  for (const entry of base.entries) {
    const char = entry.character; const id = baseIds.get(char); const config = cursive.glyphs[char];
    if (!config || !isCyrillicLower(char) || (!config.joinLeft && !config.joinRight)) continue;
    const sourceGlyph = recordByChar.get(char); layout.forms[char] = { isol: id }; layout.config[char] = { joinLeft: config.joinLeft, joinRight: config.joinRight };
    for (const form of ['init', 'medi', 'fina']) {
      const generated = generateCursiveFormMask(sourceGlyph, form, cursive, config);
      let vector = vectorizeGlyph(generated, { x0: 0, y0: 0, x1: generated.width - 1, y1: generated.height - 1 }, char, { ...options, sideBearing: 0 });
      vector = transformVector(vector, config.forms[form]); vector.name = `${entry.glyph.name}.${form}`; vector.unicode = [];
      const connectionY = Math.round((1 - cursive.connectionY) * Number(options.glyphHeight || 700));
      if (form === 'medi' || form === 'fina') vector.cursiveEntry = { x: 0, y: connectionY };
      if (form === 'init' || form === 'medi') vector.cursiveExit = { x: vector.advanceWidth, y: connectionY };
      layout.forms[char][form] = glyphs.length; glyphs.push(vector);
    }
  }
  const plain = buildTrueTypeFont(glyphs, { familyName: project.font?.familyName || project.title, styleName: project.font?.styleName || 'Regular', ascent: project.font?.ascent, descent: project.font?.descent, version: '1.200' });
  const gsub = buildGsub(layout); const gpos = buildGpos(glyphs); const kern = buildKern(project, baseIds);
  const ttf = rebuildSfnt(plain, new Map([['GSUB', gsub], ['GPOS', gpos], ['kern', kern]]));
  return { ttf, glyphs, layout, tables: parseSfntDirectory(ttf).map((table) => table.tag) };
}

export function validateCursiveTrueType(bytesValue) {
  const errors = validateTrueType(bytesValue); let tags = [];
  try { tags = parseSfntDirectory(bytesValue).map((table) => table.tag); } catch (error) { errors.push(error.message); return errors; }
  for (const required of ['GSUB', 'GPOS', 'kern']) if (!tags.includes(required)) errors.push(`Нет таблицы ${required}.`);
  return errors;
}

export { FORM_NAMES };
