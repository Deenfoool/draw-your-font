import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import {
  buildCursiveTrueTypeFont,
  ensureCursiveProject,
  generateCursiveFormMask,
  parseSfntDirectory,
  simulateCursiveForms,
  validateCursiveTrueType,
} from '../src/cursive-font.js';

function glyph(char, seed = 0) {
  const width = 54;
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
  line(11 + seed, 55, 17 + seed, 26);
  line(17 + seed, 26, 27 + seed, 48);
  line(27 + seed, 48, 39 + seed, 25);
  line(39 + seed, 25, 44 + seed, 55);
  line(12 + seed, 54, 44 + seed, 54);
  return {
    id: `g-${char}`,
    char,
    width,
    height,
    mask,
    guides: { capY: 8, xHeightY: 25, baselineY: 57, descenderY: 67 },
    metrics: { leftSideBearing: 42, rightSideBearing: 42, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
  };
}

const project = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Cursive Test',
  font: { familyName: 'Cursive Test', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: [glyph('м'), glyph('а', 1), glyph('т', -1), glyph('А')],
  kerning: { 'А|А': -40 },
};

const cursive = ensureCursiveProject(project);
assert.equal(cursive.glyphs.м.joinLeft, true);
assert.equal(cursive.glyphs.А.joinLeft, false);
const medial = generateCursiveFormMask(project.glyphs[0], 'medi', cursive, cursive.glyphs.м);
assert.ok(medial.width > project.glyphs[0].width);
assert.ok(medial.mask.some(Boolean));
assert.ok(medial.mask[Math.round(medial.externalY) * medial.width], 'entry stroke must reach the left boundary');
assert.ok(medial.mask[Math.round(medial.externalY) * medial.width + medial.width - 1], 'exit stroke must reach the right boundary');
assert.deepEqual(simulateCursiveForms('мама', project).map(({ form }) => form), ['init', 'medi', 'medi', 'fina']);
assert.deepEqual(simulateCursiveForms('а', project).map(({ form }) => form), ['isol']);
assert.deepEqual(simulateCursiveForms('ма ма', project).map(({ form }) => form), ['init', 'fina', 'isol', 'init', 'fina']);

cursive.glyphs.т.joinRight = false;
assert.deepEqual(simulateCursiveForms('тата', project).map(({ form }) => form), ['isol', 'init', 'fina', 'isol']);
cursive.glyphs.т.joinRight = true;

const built = buildCursiveTrueTypeFont(project, { detail: 96, simplify: 0.4, glyphHeight: 700 });
assert.equal(validateCursiveTrueType(built.ttf).length, 0);
const tags = parseSfntDirectory(built.ttf).map(({ tag }) => tag);
assert.ok(tags.includes('GSUB'));
assert.ok(tags.includes('GPOS'));
assert.ok(tags.includes('kern'));
assert.ok(built.glyphs.some((glyph) => glyph.cursiveEntry));
assert.ok(built.glyphs.some((glyph) => glyph.cursiveExit));
assert.equal(built.layout.forms.м.init > built.layout.forms.м.isol, true);
assert.equal(built.layout.forms.м.medi > built.layout.forms.м.init, true);
assert.equal(built.layout.forms.м.fina > built.layout.forms.м.medi, true);

await writeFile('tests/.cursive-fixture.ttf', built.ttf);
await writeFile('tests/.cursive-layout.json', JSON.stringify(built.layout, null, 2));
console.log(`All 15 cursive tests passed. TTF ${built.ttf.length} bytes, ${built.glyphs.length} glyphs.`);
