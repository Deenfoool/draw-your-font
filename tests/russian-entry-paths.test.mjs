import assert from 'node:assert/strict';
import {
  buildRussianEntryPath,
  normalizeRussianEntryMode,
  RUSSIAN_ENTRY_MODES,
} from '../src/russian-entry-paths.js';
import { generateRussianContextualFormMask } from '../src/contextual-cursive-mask.js';

assert.deepEqual(RUSSIAN_ENTRY_MODES, ['standard', 'short-upper', 'oval-retrace', 'none']);
assert.equal(normalizeRussianEntryMode('oval-retrace'), 'oval-retrace');
assert.equal(normalizeRussianEntryMode('unknown'), 'standard');

const geometry = { glyphWidth: 60, xHeightY: 22, baselineY: 54, smoothness: 0.62 };
const start = { x: 0, y: 42 };
const entry = { x: 18, y: 38 };
const standard = buildRussianEntryPath('standard', start, entry, geometry);
const shortUpper = buildRussianEntryPath('short-upper', start, entry, geometry);
const oval = buildRussianEntryPath('oval-retrace', start, entry, geometry);

assert.equal(standard.segments.length, 1);
assert.equal(shortUpper.segments.length, 2);
assert.equal(oval.segments.length, 2);
assert.ok(oval.retracePoint);
assert.ok(oval.retracePoint.x > entry.x);
assert.equal(oval.segments[1].end.x, entry.x);
assert.equal(oval.segments[1].end.y, entry.y);
assert.equal(shortUpper.segments[0].role, 'short-upper-entry');
assert.equal(oval.segments[1].role, 'oval-retrace');

function createGlyph(char) {
  const width = 60;
  const height = 72;
  const mask = new Uint8Array(width * height);
  for (let y = 20; y <= 55; y += 1) {
    for (let x = 18; x <= 44; x += 1) {
      const dx = (x - 31) / 13;
      const dy = (y - 38) / 18;
      if (dx * dx + dy * dy <= 1 && dx * dx + dy * dy >= 0.48) mask[y * width + x] = 1;
    }
  }
  return {
    char,
    width,
    height,
    mask,
    guides: { capY: 7, xHeightY: 20, baselineY: 56, descenderY: 68 },
  };
}

const baseConfig = {
  joinLeft: true,
  joinRight: true,
  entryClass: 'lower',
  entry: { x: 0.3, y: 0.54 },
  exit: { x: 0.9, y: 0.7 },
  exitVariants: {
    upper: { x: 0.9, y: 0.42 },
    middle: { x: 0.9, y: 0.58 },
    lower: { x: 0.9, y: 0.72 },
    special: { x: 0.9, y: 0.5 },
  },
};
const cursive = { tailLength: 0.34, thickness: 2.2, smoothness: 0.62, connectionY: 0.76 };
const standardMask = generateRussianContextualFormMask(createGlyph('н'), 'fina', cursive, { ...baseConfig, entryMode: 'standard' });
const ovalMask = generateRussianContextualFormMask(createGlyph('о'), 'fina', cursive, { ...baseConfig, entryMode: 'oval-retrace' });
const specialMask = generateRussianContextualFormMask(createGlyph('с'), 'fina', cursive, { ...baseConfig, entryMode: 'short-upper' });

assert.equal(standardMask.entryMode, 'standard');
assert.equal(ovalMask.entryMode, 'oval-retrace');
assert.equal(specialMask.entryMode, 'short-upper');
assert.ok(ovalMask.retracePoint);
assert.equal(standardMask.retracePoint, null);
assert.notDeepEqual([...ovalMask.mask], [...standardMask.mask]);
assert.notDeepEqual([...specialMask.mask], [...standardMask.mask]);

console.log('Russian oval/retrace entry path tests: PASS');
