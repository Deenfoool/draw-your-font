import { parseSfntTables } from './font-builder.js';
import { JOINING_TARGET_CLASSES } from './russian-joining.js';

function bytes(...values) { return Uint8Array.from(values); }
function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
function be16(value) { return bytes((value >>> 8) & 255, value & 255); }
function beS16(value) { return be16(value & 0xffff); }
function be32(value) { return bytes((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255); }
function ascii(value) { return Uint8Array.from([...value].map((char) => char.charCodeAt(0))); }
function align4(value) { return (value + 3) & ~3; }
function pad4(value) {
  if (!(value.length % 4)) return value;
  const out = new Uint8Array(align4(value.length));
  out.set(value);
  return out;
}
function checksum(value) {
  const data = pad4(value);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let sum = 0;
  for (let index = 0; index < data.length; index += 4) sum = (sum + view.getUint32(index, false)) >>> 0;
  return sum;
}
function coverage(ids) {
  const sorted = [...new Set(ids)].sort((left, right) => left - right);
  return concat([be16(1), be16(sorted.length), ...sorted.map(be16)]);
}

function singleSubstitution(mapping) {
  const pairs = [...mapping.entries()].sort((left, right) => left[0] - right[0]);
  const covered = coverage(pairs.map(([source]) => source));
  const headLength = 6 + pairs.length * 2;
  return concat([be16(2), be16(headLength), be16(pairs.length), ...pairs.map(([, target]) => be16(target)), covered]);
}

function chainContext({ backtrack = [], input = [], lookahead = [], lookupIndex }) {
  const back = backtrack.map(coverage);
  const inputs = input.map(coverage);
  const ahead = lookahead.map(coverage);
  const headerLength = 2 + 2 + back.length * 2 + 2 + inputs.length * 2 + 2 + ahead.length * 2 + 2 + 4;
  let offset = headerLength;
  const backOffsets = back.map((table) => { const current = offset; offset += table.length; return current; });
  const inputOffsets = inputs.map((table) => { const current = offset; offset += table.length; return current; });
  const aheadOffsets = ahead.map((table) => { const current = offset; offset += table.length; return current; });
  return concat([
    be16(3),
    be16(back.length), ...backOffsets.map(be16),
    be16(inputs.length), ...inputOffsets.map(be16),
    be16(ahead.length), ...aheadOffsets.map(be16),
    be16(1), be16(0), be16(lookupIndex),
    ...back, ...inputs, ...ahead,
  ]);
}

function lookup(type, subtable) { return concat([be16(type), be16(0), be16(1), be16(8), subtable]); }
function lookupList(lookups) {
  const header = 2 + lookups.length * 2;
  let offset = header;
  const offsets = lookups.map((item) => { const current = offset; offset += item.length; return current; });
  return concat([be16(lookups.length), ...offsets.map(be16), ...lookups]);
}
function langSys(featureIndices) { return concat([be16(0), be16(0xffff), be16(featureIndices.length), ...featureIndices.map(be16)]); }
function scriptTable(featureIndices) {
  const language = langSys(featureIndices);
  return concat([be16(4), be16(0), language]);
}
function scriptList(featureIndices) {
  const defaultScript = scriptTable(featureIndices);
  const cyrillicScript = scriptTable(featureIndices);
  const header = 2 + 2 * 6;
  return concat([
    be16(2),
    ascii('DFLT'), be16(header),
    ascii('cyrl'), be16(header + defaultScript.length),
    defaultScript, cyrillicScript,
  ]);
}
function featureTable(indices) { return concat([be16(0), be16(indices.length), ...indices.map(be16)]); }
function featureList(features) {
  const tables = features.map((feature) => featureTable(feature.lookups));
  const header = 2 + features.length * 6;
  let offset = header;
  const records = features.map((feature, index) => {
    const current = offset;
    offset += tables[index].length;
    return concat([ascii(feature.tag), be16(current)]);
  });
  return concat([be16(features.length), ...records, ...tables]);
}

export function buildRussianContextualGsub(layout) {
  const lookups = [];
  const featureLookups = [];
  const connectedPrevious = [];
  const leftBaseByClass = Object.fromEntries(JOINING_TARGET_CLASSES.map((joiningClass) => [joiningClass, []]));

  for (const [character, forms] of Object.entries(layout.contextualForms || {})) {
    const config = layout.contextualConfig?.[character] || {};
    if (config.joinLeft && leftBaseByClass[config.entryClass]) leftBaseByClass[config.entryClass].push(forms.isol);
    for (const joiningClass of JOINING_TARGET_CLASSES) {
      const initial = forms.init?.[joiningClass];
      const medial = forms.medi?.[joiningClass];
      if (Number.isInteger(initial)) connectedPrevious.push(initial);
      if (Number.isInteger(medial)) connectedPrevious.push(medial);
    }
  }

  for (const joiningClass of JOINING_TARGET_CLASSES) {
    const mapping = new Map();
    const input = [];
    for (const forms of Object.values(layout.contextualForms || {})) {
      if (!Number.isInteger(forms.init?.[joiningClass])) continue;
      mapping.set(forms.isol, forms.init[joiningClass]);
      input.push(forms.isol);
    }
    const lookahead = leftBaseByClass[joiningClass];
    if (!mapping.size || !lookahead.length) continue;
    const substitutionIndex = lookups.length;
    lookups.push(lookup(1, singleSubstitution(mapping)));
    const contextIndex = lookups.length;
    lookups.push(lookup(6, chainContext({ input: [input], lookahead: [lookahead], lookupIndex: substitutionIndex })));
    featureLookups.push(contextIndex);
  }

  for (const joiningClass of JOINING_TARGET_CLASSES) {
    const mapping = new Map();
    const input = [];
    for (const forms of Object.values(layout.contextualForms || {})) {
      if (!Number.isInteger(forms.init?.[joiningClass]) || !Number.isInteger(forms.medi?.[joiningClass])) continue;
      mapping.set(forms.init[joiningClass], forms.medi[joiningClass]);
      input.push(forms.init[joiningClass]);
    }
    if (!mapping.size || !connectedPrevious.length) continue;
    const substitutionIndex = lookups.length;
    lookups.push(lookup(1, singleSubstitution(mapping)));
    const contextIndex = lookups.length;
    lookups.push(lookup(6, chainContext({ backtrack: [connectedPrevious], input: [input], lookupIndex: substitutionIndex })));
    featureLookups.push(contextIndex);
  }

  const finalMapping = new Map();
  const finalInput = [];
  for (const forms of Object.values(layout.contextualForms || {})) {
    if (!Number.isInteger(forms.fina)) continue;
    finalMapping.set(forms.isol, forms.fina);
    finalInput.push(forms.isol);
  }
  if (finalMapping.size && connectedPrevious.length) {
    const substitutionIndex = lookups.length;
    lookups.push(lookup(1, singleSubstitution(finalMapping)));
    const contextIndex = lookups.length;
    lookups.push(lookup(6, chainContext({ backtrack: [connectedPrevious], input: [finalInput], lookupIndex: substitutionIndex })));
    featureLookups.push(contextIndex);
  }

  if (!featureLookups.length) throw new Error('Недостаточно соединяемых букв для построения контекстной GSUB.');
  const scripts = scriptList([0, 1]);
  const features = featureList([
    { tag: 'calt', lookups: featureLookups },
    { tag: 'rlig', lookups: featureLookups },
  ]);
  const list = lookupList(lookups);
  const header = 10;
  return {
    bytes: concat([
      be32(0x00010000),
      be16(header),
      be16(header + scripts.length),
      be16(header + scripts.length + features.length),
      scripts, features, list,
    ]),
    featureLookups,
  };
}

function anchor(x, y) { return concat([be16(1), beS16(Math.round(x)), beS16(Math.round(y))]); }
function buildCursiveSubtable(glyphs) {
  const records = glyphs
    .map((glyph, id) => ({ id, entry: glyph.cursiveEntry || null, exit: glyph.cursiveExit || null }))
    .filter((record) => record.entry || record.exit);
  if (!records.length) throw new Error('Не найдены точки входа и выхода для таблицы GPOS curs.');
  const covered = coverage(records.map((record) => record.id));
  const headerLength = 6 + records.length * 4;
  let offset = headerLength + covered.length;
  const anchors = [];
  const offsets = [];
  for (const record of records) {
    let entryOffset = 0;
    let exitOffset = 0;
    if (record.entry) {
      const value = anchor(record.entry.x, record.entry.y);
      entryOffset = offset;
      offset += value.length;
      anchors.push(value);
    }
    if (record.exit) {
      const value = anchor(record.exit.x, record.exit.y);
      exitOffset = offset;
      offset += value.length;
      anchors.push(value);
    }
    offsets.push([entryOffset, exitOffset]);
  }
  return concat([
    be16(1), be16(headerLength), be16(records.length),
    ...offsets.flatMap(([entryOffset, exitOffset]) => [be16(entryOffset), be16(exitOffset)]),
    covered, ...anchors,
  ]);
}

export function buildRussianCursiveGpos(glyphs) {
  const scripts = scriptList([0]);
  const features = featureList([{ tag: 'curs', lookups: [0] }]);
  const list = lookupList([lookup(3, buildCursiveSubtable(glyphs))]);
  const header = 10;
  return concat([
    be32(0x00010000),
    be16(header),
    be16(header + scripts.length),
    be16(header + scripts.length + features.length),
    scripts, features, list,
  ]);
}

export function rebuildSfntWithTables(ttf, additions) {
  const parsed = parseSfntTables(ttf);
  const tables = new Map(parsed.tables.map((table) => [table.tag, new Uint8Array(table.bytes)]));
  for (const [tag, data] of additions) tables.set(tag, data);
  if (tables.has('head')) tables.get('head').fill(0, 8, 12);
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  const maxPower = 2 ** Math.floor(Math.log2(count));
  const directoryLength = 12 + count * 16;
  let offset = directoryLength;
  const records = tags.map((tag) => {
    const data = tables.get(tag);
    const record = { tag, data, offset, checksum: checksum(data) };
    offset += align4(data.length);
    return record;
  });
  const output = new Uint8Array(offset);
  const view = new DataView(output.buffer);
  view.setUint32(0, parsed.flavor, false);
  view.setUint16(4, count, false);
  view.setUint16(6, maxPower * 16, false);
  view.setUint16(8, Math.log2(maxPower), false);
  view.setUint16(10, count * 16 - maxPower * 16, false);
  records.forEach((record, index) => {
    const at = 12 + index * 16;
    output.set(ascii(record.tag), at);
    view.setUint32(at + 4, record.checksum, false);
    view.setUint32(at + 8, record.offset, false);
    view.setUint32(at + 12, record.data.length, false);
    output.set(record.data, record.offset);
  });
  const head = records.find((record) => record.tag === 'head');
  if (!head) throw new Error('В шрифте отсутствует таблица head.');
  view.setUint32(head.offset + 8, (0xb1b0afba - checksum(output)) >>> 0, false);
  return output;
}
