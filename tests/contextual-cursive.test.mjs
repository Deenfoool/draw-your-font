import assert from 'node:assert/strict';
import {
  buildCursiveTrueTypeFont,
  ensureCursiveProject,
  generateCursiveFormMask,
  readCursiveFeatureLookups,
  simulateCursiveForms,
  validateCursiveTrueType,
} from '../src/cursive-font.js';

function glyph(char, seed = 0) {
  const width = 48;
  const height = 72;
  const mask = new Uint8Array(width * height);
  const put = (x, y, radius = 2) => {
    for (let py = y - radius; py <= y + radius; py += 1) for (let px = x - radius; px <= x + radius; px += 1) {
      if (px >= 0 && py >= 0 && px < width && py < height && (px - x) ** 2 + (py - y) ** 2 <= radius ** 2 + 0.5) mask[py * width + px] = 1;
    }
  };
  const line = (x0, y0, x1, y1, radius = 2) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), radius);
    }
  };
  line(9 + seed, 55, 15 + seed, 24);
  line(15 + seed, 24, 25 + seed, 48);
  line(25 + seed, 48, 36 + seed, 23);
  line(36 + seed, 23, 41 + seed, 55);
  line(10 + seed, 55, 41 + seed, 55);
  return {
    id: `context-${char}`,
    char,
    width,
    height,
    mask,
    guides: { capY: 7, xHeightY: 22, baselineY: 57, descenderY: 68 },
    metrics: { leftSideBearing: 36, rightSideBearing: 36, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
  };
}

const characters = ['м', 'и', 'е', 'о', 'с'];
const project = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Contextual Russian Cursive',
  font: { familyName: 'Contextual Russian Cursive', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: characters.map((char, index) => glyph(char, (index % 3) - 1)),
  kerning: {},
};

const cursive = ensureCursiveProject(project);
cursive.enabled = true;
const source = project.glyphs.find((item) => item.char === 'м');
const config = cursive.glyphs.м;
const generated = Object.fromEntries(['upper', 'special', 'middle', 'lower'].map((joiningClass) => {
  const suffix = { upper: 'u', special: 's', middle: 'm', lower: 'l' }[joiningClass];
  return [joiningClass, generateCursiveFormMask(source, `medi.${suffix}`, cursive, config)];
}));

assert.ok(generated.upper.rightExternalY < generated.special.rightExternalY);
assert.ok(generated.special.rightExternalY < generated.middle.rightExternalY);
assert.ok(generated.middle.rightExternalY < generated.lower.rightExternalY);
assert.equal(generated.upper.leftExternalY, generated.lower.leftExternalY, 'left entry must not depend on the next letter');
for (const item of Object.values(generated)) {
  const leftY = Math.round(item.leftExternalY);
  const rightY = Math.round(item.rightExternalY);
  assert.ok(item.mask[leftY * item.width], `${item.targetClass} medial form must reach left boundary`);
  assert.ok(item.mask[rightY * item.width + item.width - 1], `${item.targetClass} medial form must reach right boundary`);
}

assert.deepEqual(simulateCursiveForms('миеос', project).map((item) => item.contextualForm), [
  'init.u', 'medi.m', 'medi.l', 'medi.s', 'fina',
]);

const built = buildCursiveTrueTypeFont(project, { detail: 96, simplify: 0.4, glyphHeight: 700 });
assert.deepEqual(validateCursiveTrueType(built.ttf), []);
assert.equal(built.layout.engine, 'russian-school-contextual-v1');
assert.deepEqual(built.layout.featureLookups, [1, 3, 5, 7, 9, 11, 13, 15, 17]);

const forms = built.layout.contextualForms.м;
assert.equal(forms.isol, built.layout.baseIds.м);
assert.deepEqual(Object.keys(forms.init), ['upper', 'middle', 'lower', 'special']);
assert.deepEqual(Object.keys(forms.medi), ['upper', 'middle', 'lower', 'special']);
assert.equal(new Set(Object.values(forms.init)).size, 4);
assert.equal(new Set(Object.values(forms.medi)).size, 4);
assert.ok(Number.isInteger(forms.fina));
assert.equal(forms.blocked, null);

for (const id of Object.values(forms.init)) {
  assert.ok(built.glyphs[id].cursiveExit);
  assert.equal(built.glyphs[id].cursiveEntry, undefined);
}
for (const id of Object.values(forms.medi)) {
  assert.ok(built.glyphs[id].cursiveEntry);
  assert.ok(built.glyphs[id].cursiveExit);
}
assert.ok(built.glyphs[forms.fina].cursiveEntry);
assert.equal(built.glyphs[forms.fina].cursiveExit, undefined);

const lookups = readCursiveFeatureLookups(built.ttf);
assert.deepEqual(lookups.calt, built.layout.featureLookups);
assert.deepEqual(lookups.rlig, built.layout.featureLookups);
assert.ok(lookups.calt.every((lookupIndex) => lookupIndex % 2 === 1));

cursive.pairOverrides['м|о'] = { spacing: 6 };
const spacingOnly = buildCursiveTrueTypeFont(project, { detail: 96, simplify: 0.4, glyphHeight: 700 });
assert.deepEqual(validateCursiveTrueType(spacingOnly.ttf), []);
assert.deepEqual(spacingOnly.layout.featureLookups, built.layout.featureLookups, 'Spacing-only override must not add GSUB rules.');
assert.equal(spacingOnly.layout.pairAdjustments.length, 10);
assert.ok(spacingOnly.layout.pairAdjustments.every((pair) => pair.pairKey === 'м|о' && pair.xAdvance !== 0));

cursive.pairOverrides['м|о'] = { exitClass: 'upper', spacing: 6 };
cursive.pairOverrides['е|с'] = { connect: false };
const overridden = buildCursiveTrueTypeFont(project, { detail: 96, simplify: 0.4, glyphHeight: 700 });
assert.deepEqual(validateCursiveTrueType(overridden.ttf), []);
assert.equal(overridden.layout.engine, 'russian-school-contextual-v1');
assert.deepEqual(overridden.layout.featureLookups, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]);
assert.ok(Number.isInteger(overridden.layout.contextualForms.е.blocked));
assert.equal(overridden.glyphs[overridden.layout.contextualForms.е.blocked].cursiveEntry, undefined);
assert.equal(overridden.glyphs[overridden.layout.contextualForms.е.blocked].cursiveExit, undefined);
assert.equal(overridden.layout.pairAdjustments.length, 10);
assert.ok(overridden.layout.pairAdjustments.every((pair) => pair.pairKey === 'м|о' && pair.xAdvance !== 0));
assert.ok(overridden.ttf.length > built.ttf.length);
const overriddenLookups = readCursiveFeatureLookups(overridden.ttf);
assert.deepEqual(overriddenLookups.calt, overridden.layout.featureLookups);
assert.deepEqual(overriddenLookups.rlig, overridden.layout.featureLookups);

console.log(`Stage 11.5 contextual cursive tests: PASS. ${built.glyphs.length}/${overridden.glyphs.length} glyphs, ${built.layout.featureLookups.length}/${overridden.layout.featureLookups.length} contextual lookups.`);
