import assert from 'node:assert/strict';
import {
  buildRussianContextualGsub,
  buildRussianCursiveGpos,
} from '../src/opentype-contextual-layout.js';

const classes = ['upper', 'middle', 'lower', 'special'];
let nextGlyphId = 20;
function forms(isol, entryClass) {
  const record = {
    isol,
    init: Object.fromEntries(classes.map((joiningClass) => [joiningClass, nextGlyphId++])),
    medi: Object.fromEntries(classes.map((joiningClass) => [joiningClass, nextGlyphId++])),
    fina: nextGlyphId++,
  };
  return { record, config: { joinLeft: true, joinRight: true, entryClass } };
}

const upper = forms(2, 'upper');
const middle = forms(3, 'middle');
const lower = forms(4, 'lower');
const special = forms(5, 'special');
const layout = {
  contextualForms: {
    и: upper.record,
    е: middle.record,
    о: lower.record,
    с: special.record,
  },
  contextualConfig: {
    и: upper.config,
    е: middle.config,
    о: lower.config,
    с: special.config,
  },
};

const built = buildRussianContextualGsub(layout);
assert.deepEqual(built.featureLookups, [1, 3, 5, 7, 9, 11, 13, 15, 17]);
const bytes = built.bytes;
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
assert.equal(view.getUint32(0, false), 0x00010000);
const scriptOffset = view.getUint16(4, false);
const featureOffset = view.getUint16(6, false);
const lookupOffset = view.getUint16(8, false);
assert.ok(scriptOffset >= 10);
assert.ok(featureOffset > scriptOffset);
assert.ok(lookupOffset > featureOffset && lookupOffset < bytes.length);

const featureCount = view.getUint16(featureOffset, false);
assert.equal(featureCount, 2);
for (let index = 0; index < featureCount; index += 1) {
  const record = featureOffset + 2 + index * 6;
  const tag = String.fromCharCode(...bytes.slice(record, record + 4));
  assert.ok(['calt', 'rlig'].includes(tag));
  const table = featureOffset + view.getUint16(record + 4, false);
  const count = view.getUint16(table + 2, false);
  assert.equal(count, 9);
  const lookupIds = [];
  for (let lookupIndex = 0; lookupIndex < count; lookupIndex += 1) lookupIds.push(view.getUint16(table + 4 + lookupIndex * 2, false));
  assert.deepEqual(lookupIds, built.featureLookups);
}

const lookupCount = view.getUint16(lookupOffset, false);
assert.equal(lookupCount, 18);
for (let index = 0; index < lookupCount; index += 1) {
  const lookup = lookupOffset + view.getUint16(lookupOffset + 2 + index * 2, false);
  assert.equal(view.getUint16(lookup, false), index % 2 === 0 ? 1 : 6);
  const subtable = lookup + view.getUint16(lookup + 6, false);
  assert.equal(view.getUint16(subtable, false), index % 2 === 0 ? 2 : 3);
}

const glyphs = Array.from({ length: nextGlyphId + 1 }, () => ({ contours: [] }));
for (let id = 20; id < nextGlyphId; id += 1) {
  glyphs[id] = {
    contours: [[]],
    cursiveEntry: id % 2 ? { x: id, y: 20 } : null,
    cursiveExit: { x: id + 1, y: 30 },
  };
}
const gpos = buildRussianCursiveGpos(glyphs);
const gposView = new DataView(gpos.buffer, gpos.byteOffset, gpos.byteLength);
assert.equal(gposView.getUint32(0, false), 0x00010000);
assert.ok(gpos.length > 100);

console.log(`Stage 11.2 contextual OpenType layout test: PASS. GSUB ${bytes.length} bytes, GPOS ${gpos.length} bytes.`);
