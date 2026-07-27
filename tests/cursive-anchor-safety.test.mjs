import assert from 'node:assert/strict';
import {
  ensureCursiveProject,
  generateCursiveFormMask,
  getCursiveGlyphMetrics,
} from '../src/cursive-font.js';

const width = 40;
const height = 80;
const mask = new Uint8Array(width * height);
for (let y = 22; y <= 62; y += 1) {
  mask[y * width + 10] = 1;
  mask[y * width + 28] = 1;
}
for (let x = 10; x <= 28; x += 1) mask[62 * width + x] = 1;
for (let y = 62; y <= 76; y += 1) mask[y * width + 20] = 1;

const glyph = {
  id: 'g-r',
  char: 'р',
  width,
  height,
  mask,
  guides: { capY: 8, xHeightY: 25, baselineY: 60, descenderY: 76 },
  metrics: { leftSideBearing: 42, rightSideBearing: 42, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
};
const project = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Anchor Safety',
  font: { familyName: 'Anchor Safety', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: [glyph],
  kerning: {},
};

let cursive = ensureCursiveProject(project);
cursive.glyphs.р.baselineY = 0.70;
cursive.glyphs.р.entry.y = 0.95;
cursive.glyphs.р.exit.y = 0.99;

cursive = ensureCursiveProject(project);
const metrics = getCursiveGlyphMetrics(glyph, cursive.glyphs.р);
const ceiling = metrics.baselineRatio - 0.01;
assert.ok(cursive.glyphs.р.entry.y <= ceiling, `entry ${cursive.glyphs.р.entry.y} is below baseline ${metrics.baselineRatio}`);
assert.ok(cursive.glyphs.р.exit.y <= ceiling, `exit ${cursive.glyphs.р.exit.y} is below baseline ${metrics.baselineRatio}`);

const medial = generateCursiveFormMask(glyph, 'medi', cursive, cursive.glyphs.р);
assert.ok(medial.entry.y < medial.baselineY);
assert.ok(medial.exit.y < medial.baselineY);
assert.ok(medial.mask.slice((Math.floor(medial.baselineY) + 1) * medial.width).some(Boolean), 'the real descender must remain below baseline');

console.log('Cursive anchor safety test: PASS');
