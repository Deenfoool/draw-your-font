import assert from 'node:assert/strict';
import {
  buildRussianContextualGsub,
  buildRussianCursiveGpos,
} from '../src/opentype-contextual-layout.js';

const classes = ['upper', 'middle', 'lower', 'special'];
let nextGlyphId = 20;
function forms(isol, entryClass, blocked = null) {
  const record = {
    isol,
    init: Object.fromEntries(classes.map((joiningClass) => [joiningClass, nextGlyphId++])),
    medi: Object.fromEntries(classes.map((joiningClass) => [joiningClass, nextGlyphId++])),
    fina: nextGlyphId++,
    blocked,
  };
  return { record, config: { joinLeft: true, joinRight: true, entryClass } };
}

const upper = forms(2, 'upper');
const middle = forms(3, 'middle', nextGlyphId++);
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
  pairOverrides: {},
};

function inspectGsub(built, expectedFeatureLookups) {
  assert.deepEqual(built.featureLookups, expectedFeatureLookups);
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
    assert.equal(count, expectedFeatureLookups.length);
    const lookupIds = [];
    for (let lookupIndex = 0; lookupIndex < count; lookupIndex += 1) lookupIds.push(view.getUint16(table + 4 + lookupIndex * 2, false));
    assert.deepEqual(lookupIds, built.featureLookups);
  }

  const lookupCount = view.getUint16(lookupOffset, false);
  assert.equal(lookupCount, expectedFeatureLookups.length * 2);
  for (let index = 0; index < lookupCount; index += 1) {
    const lookup = lookupOffset + view.getUint16(lookupOffset + 2 + index * 2, false);
    assert.equal(view.getUint16(lookup, false), index % 2 === 0 ? 1 : 6);
    const subtable = lookup + view.getUint16(lookup + 6, false);
    assert.equal(view.getUint16(subtable, false), index % 2 === 0 ? 2 : 3);
  }
  return bytes;
}

const defaultLookups = [1, 3, 5, 7, 9, 11, 13, 15, 17];
const built = buildRussianContextualGsub(layout);
const bytes = inspectGsub(built, defaultLookups);

const spacingOnly = buildRussianContextualGsub({
  ...layout,
  pairOverrides: { 'и|о': { spacing: 8 } },
});
const spacingOnlyBytes = inspectGsub(spacingOnly, defaultLookups);
assert.equal(spacingOnlyBytes.length, bytes.length, 'Spacing-only overrides must not create GSUB rules.');

const overridden = buildRussianContextualGsub({
  ...layout,
  pairOverrides: {
    'и|о': { exitClass: 'middle' },
    'е|с': { connect: false },
  },
});
const overrideBytes = inspectGsub(overridden, [...defaultLookups, 19, 21]);
assert.ok(overrideBytes.length > bytes.length);

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

const pairGpos = buildRussianCursiveGpos(glyphs, [
  { first: 20, second: 21, xAdvance: 64 },
  { first: 20, second: 22, xAdvance: -18 },
  { first: 23, second: 24, xAdvance: 32 },
]);
const pairView = new DataView(pairGpos.buffer, pairGpos.byteOffset, pairGpos.byteLength);
const pairFeatureOffset = pairView.getUint16(6, false);
const pairLookupOffset = pairView.getUint16(8, false);
assert.equal(pairView.getUint16(pairFeatureOffset, false), 2, 'GPOS should expose curs and kern features.');
assert.equal(pairView.getUint16(pairLookupOffset, false), 2, 'GPOS should contain cursive and pair-positioning lookups.');
const cursiveLookup = pairLookupOffset + pairView.getUint16(pairLookupOffset + 2, false);
const kernLookup = pairLookupOffset + pairView.getUint16(pairLookupOffset + 4, false);
assert.equal(pairView.getUint16(cursiveLookup, false), 3);
assert.equal(pairView.getUint16(kernLookup, false), 2);
assert.ok(pairGpos.length > gpos.length);

console.log(`Stage 11.5 contextual OpenType layout test: PASS. GSUB ${bytes.length}/${overrideBytes.length} bytes, GPOS ${gpos.length}/${pairGpos.length} bytes.`);
