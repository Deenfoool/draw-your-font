import assert from 'node:assert/strict';
import {
  applyRussianDescenderPreset,
  ensureCursiveProject,
  getRussianEntryClass,
  getRussianEntryMode,
  JOINING_GRAMMAR_VERSION,
  JOINING_PRESET,
  resolveConnectionRatio,
  RUSSIAN_LOWERCASE,
  RUSSIAN_SCHOOL_ENTRY_CLASS,
  simulateCursiveForms,
  validateRussianSchoolPreset,
} from '../src/cursive-font.js';

function glyph(char) {
  const width = 18;
  const height = 28;
  const mask = new Uint8Array(width * height);
  for (let y = 9; y <= 22; y += 1) mask[y * width + 8] = 1;
  return {
    id: `grammar-${char}`,
    char,
    width,
    height,
    mask,
    guides: { capY: 3, xHeightY: 8, baselineY: 23, descenderY: 27 },
    metrics: { leftSideBearing: 30, rightSideBearing: 30, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
  };
}

assert.deepEqual(validateRussianSchoolPreset(), { valid: true, missing: [], extra: [] });
assert.equal(RUSSIAN_LOWERCASE.length, 33);
assert.equal(Object.keys(RUSSIAN_SCHOOL_ENTRY_CLASS).length, 33);
assert.equal(new Set(RUSSIAN_LOWERCASE).size, 33);

const project = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Russian joining grammar',
  font: { familyName: 'Russian Joining Grammar', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: RUSSIAN_LOWERCASE.map(glyph),
  kerning: {},
};

const cursive = ensureCursiveProject(project);
assert.equal(cursive.joiningVersion, JOINING_GRAMMAR_VERSION);
assert.equal(cursive.joiningPreset, JOINING_PRESET);
assert.deepEqual(cursive.pairOverrides, {});

for (const char of ['и', 'п', 'ш', 'ю']) assert.equal(cursive.glyphs[char].entryClass, 'upper');
for (const char of ['в', 'е', 'ж', 'ч']) assert.equal(cursive.glyphs[char].entryClass, 'middle');
for (const char of ['а', 'д', 'л', 'о']) assert.equal(cursive.glyphs[char].entryClass, 'lower');
assert.equal(cursive.glyphs.с.entryClass, 'special');
assert.equal(getRussianEntryClass('о'), 'lower');
assert.equal(getRussianEntryMode('о'), 'oval-retrace');
assert.equal(getRussianEntryMode('с'), 'short-upper');

for (const config of Object.values(cursive.glyphs)) {
  assert.deepEqual(Object.keys(config.exitVariants), ['upper', 'middle', 'lower', 'special']);
  assert.ok(config.exitVariants.upper.y < config.exitVariants.special.y);
  assert.ok(config.exitVariants.special.y < config.exitVariants.middle.y);
  assert.ok(config.exitVariants.middle.y < config.exitVariants.lower.y);
  assert.ok(config.exitVariants.lower.y < config.baselineY);
}

const contextual = (text) => simulateCursiveForms(text, project).map((item) => item.contextualForm);
assert.deepEqual(contextual('ми'), ['init.u', 'fina']);
assert.deepEqual(contextual('ме'), ['init.m', 'fina']);
assert.deepEqual(contextual('мо'), ['init.l', 'fina']);
assert.deepEqual(contextual('мс'), ['init.s', 'fina']);
assert.deepEqual(contextual('мама'), ['init.l', 'medi.l', 'medi.l', 'fina']);
assert.deepEqual(contextual('ма ма'), ['init.l', 'fina', 'isol', 'init.l', 'fina']);
assert.deepEqual(simulateCursiveForms('мама', project).map((item) => item.form), ['init', 'medi', 'medi', 'fina']);

cursive.pairOverrides['м|о'] = { exitClass: 'upper', spacing: -12 };
let sequence = simulateCursiveForms('мо', project);
assert.equal(sequence[0].contextualForm, 'init.u');
assert.equal(sequence[0].pairKey, 'м|о');
assert.equal(sequence[0].pairOverride.spacing, -12);

ensureCursiveProject(project).pairOverrides['м|а'] = { connect: false };
sequence = simulateCursiveForms('ма', project);
assert.deepEqual(sequence.map((item) => item.contextualForm), ['isol', 'isol']);
delete ensureCursiveProject(project).pairOverrides['м|а'];

const eConfig = ensureCursiveProject(project).glyphs.е;
eConfig.entryClass = 'lower';
eConfig.exitVariants.upper = { x: 0.81, y: 0.44 };
assert.equal(ensureCursiveProject(project).glyphs.е.entryClass, 'lower');
assert.deepEqual(ensureCursiveProject(project).glyphs.е.exitVariants.upper, { x: 0.81, y: 0.44 });
assert.deepEqual(contextual('ме'), ['init.l', 'fina']);

applyRussianDescenderPreset(project);
assert.equal(ensureCursiveProject(project).glyphs.е.entryClass, 'lower');
assert.deepEqual(ensureCursiveProject(project).glyphs.е.exitVariants.upper, { x: 0.81, y: 0.44 });
assert.equal(ensureCursiveProject(project).pairOverrides['м|о'].spacing, -12);

const levels = ['upper', 'special', 'middle', 'lower'].map((joiningClass) => resolveConnectionRatio({ xHeightRatio: 0.38, baselineRatio: 0.82 }, joiningClass));
assert.ok(levels.every(Number.isFinite));
assert.ok(levels[0] < levels[1] && levels[1] < levels[2] && levels[2] < levels[3]);

console.log('Stage 11.1 Russian school joining grammar tests: PASS');
