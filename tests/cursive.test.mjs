import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import {
  applyRussianDescenderPreset,
  buildCursiveTrueTypeFont,
  DESCENDER_LETTERS,
  ensureCursiveProject,
  generateCursiveFormMask,
  getCursiveGlyphMetrics,
  parseSfntDirectory,
  readCursiveFeatureLookups,
  simulateCursiveForms,
  validateCursiveTrueType,
} from '../src/cursive-font.js';
import { deserializeProject, serializeProject } from '../src/project.js';

const DESCENDERS = new Set(DESCENDER_LETTERS);

function glyph(char, seed = 0) {
  const width = 54;
  const height = 78;
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
  line(11 + seed, 57, 17 + seed, 26);
  line(17 + seed, 26, 27 + seed, 48);
  line(27 + seed, 48, 39 + seed, 25);
  line(39 + seed, 25, 44 + seed, 57);
  line(12 + seed, 56, 44 + seed, 56);
  if (DESCENDERS.has(char)) {
    line(24 + seed, 55, 24 + seed, 73, 2);
    line(24 + seed, 73, 31 + seed, 69, 2);
  }
  return {
    id: `g-${char}`,
    char,
    width,
    height,
    mask,
    guides: { capY: 8, xHeightY: 25, baselineY: 59, descenderY: 73 },
    metrics: { leftSideBearing: 42, rightSideBearing: 42, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
  };
}

const characters = [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', 'А'];
const project = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Cursive Descender Test',
  font: { familyName: 'Cursive Descender Test', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: characters.map((char, index) => glyph(char, (index % 3) - 1)),
  kerning: { 'А|А': -40 },
};

const cursive = ensureCursiveProject(project);
assert.equal(cursive.glyphs.м.joinLeft, true);
assert.equal(cursive.glyphs.А.joinLeft, false);
for (const char of DESCENDER_LETTERS) assert.equal(cursive.glyphs[char].hasDescender, true, `${char} must be a descender by default`);
assert.equal(cursive.glyphs.а.hasDescender, false);

const rGlyph = project.glyphs.find((item) => item.char === 'р');
const rConfig = cursive.glyphs.р;
const rMetrics = getCursiveGlyphMetrics(rGlyph, rConfig);
assert.ok(rMetrics.baselineY < rMetrics.descenderY);
const rIsolated = generateCursiveFormMask(rGlyph, 'isol', cursive, rConfig);
assert.ok(rIsolated.mask.some(Boolean));
assert.ok(rIsolated.mask.slice((Math.floor(rIsolated.baselineY) + 1) * rIsolated.width).some(Boolean), 'р must retain ink below baseline');
const originalHeight = rIsolated.height;
rConfig.descenderScale = 1.5;
const stretched = generateCursiveFormMask(rGlyph, 'isol', cursive, rConfig);
assert.ok(stretched.height > originalHeight, 'descender scaling must increase canvas height');
assert.equal(Math.round(stretched.baselineY), Math.round(rIsolated.baselineY), 'baseline must stay fixed when descender grows');
rConfig.descenderScale = 1;

const medial = generateCursiveFormMask(project.glyphs.find((item) => item.char === 'м'), 'medi', cursive, cursive.glyphs.м);
assert.ok(medial.width > project.glyphs.find((item) => item.char === 'м').width);
assert.ok(medial.mask[Math.round(medial.leftExternalY) * medial.width], 'entry stroke must reach the left boundary');
assert.ok(medial.mask[Math.round(medial.rightExternalY) * medial.width + medial.width - 1], 'exit stroke must reach the right boundary');
assert.deepEqual(simulateCursiveForms('мама', project).map(({ form }) => form), ['init', 'medi', 'medi', 'fina']);
assert.deepEqual(simulateCursiveForms('дрожь', project).map(({ form }) => form), ['init', 'medi', 'medi', 'medi', 'fina']);
assert.deepEqual(simulateCursiveForms('а', project).map(({ form }) => form), ['isol']);
assert.deepEqual(simulateCursiveForms('ма ма', project).map(({ form }) => form), ['init', 'fina', 'isol', 'init', 'fina']);

ensureCursiveProject(project).glyphs.т.joinRight = false;
assert.deepEqual(simulateCursiveForms('тата', project).map(({ form }) => form), ['isol', 'init', 'fina', 'isol']);
ensureCursiveProject(project).glyphs.т.joinRight = true;

const liveCursive = ensureCursiveProject(project);
liveCursive.enabled = true;
liveCursive.glyphs.м.entry = { x: 0.17, y: 0.72 };
liveCursive.glyphs.м.forms.medi.offsetX = 3;
liveCursive.glyphs.м.contextualForms.medi.lower.offsetX = 5;
liveCursive.glyphs.р.baselineY = 0.75;
liveCursive.glyphs.р.descenderScale = 1.25;
liveCursive.pairOverrides['м|о'] = { exitClass: 'upper', spacing: 6 };
liveCursive.pairOverrides['т|а'] = { connect: false };
applyRussianDescenderPreset(project);
ensureCursiveProject(project).glyphs.р.descenderScale = 1.25;
const restored = deserializeProject(serializeProject(project));
assert.equal(restored.cursive.enabled, true);
assert.deepEqual(restored.cursive.glyphs.м.entry, { x: 0.17, y: 0.72 });
assert.equal(restored.cursive.glyphs.м.forms.medi.offsetX, 3);
assert.equal(restored.cursive.glyphs.м.contextualForms.medi.lower.offsetX, 5);
assert.equal(restored.cursive.glyphs.р.hasDescender, true);
assert.equal(restored.cursive.glyphs.р.descenderScale, 1.25);
assert.deepEqual(restored.cursive.pairOverrides['м|о'], { exitClass: 'upper', spacing: 6 });
assert.deepEqual(restored.cursive.pairOverrides['т|а'], { connect: false });
assert.deepEqual(simulateCursiveForms('дрожь', restored).map(({ form }) => form), ['init', 'medi', 'medi', 'medi', 'fina']);
assert.deepEqual(simulateCursiveForms('мо', restored).map(({ contextualForm }) => contextualForm), ['init.u', 'fina']);
assert.deepEqual(simulateCursiveForms('та', restored).map(({ form }) => form), ['isol', 'isol']);

const built = buildCursiveTrueTypeFont(restored, { detail: 96, simplify: 0.4, glyphHeight: 700 });
assert.equal(validateCursiveTrueType(built.ttf).length, 0);
const tags = parseSfntDirectory(built.ttf).map(({ tag }) => tag);
assert.ok(tags.includes('GSUB'));
assert.ok(tags.includes('GPOS'));
assert.ok(tags.includes('kern'));
const featureLookups = readCursiveFeatureLookups(built.ttf);
assert.deepEqual(featureLookups.calt, featureLookups.rlig);
assert.equal(featureLookups.calt.length, 11);
assert.ok(featureLookups.calt.every((lookupIndex) => lookupIndex % 2 === 1));
assert.equal(built.layout.engine, 'russian-school-contextual-v1');
assert.ok(built.glyphs.some((item) => item.cursiveEntry));
assert.ok(built.glyphs.some((item) => item.cursiveExit));
assert.equal(built.layout.forms.м.init > built.layout.forms.м.isol, true);
assert.equal(built.layout.forms.м.medi > built.layout.forms.м.init, true);
assert.equal(built.layout.forms.м.fina > built.layout.forms.м.medi, true);
assert.equal(new Set(Object.values(built.layout.contextualForms.м.init)).size, 4);
assert.equal(new Set(Object.values(built.layout.contextualForms.м.medi)).size, 4);
assert.ok(Number.isInteger(built.layout.contextualForms.т.blocked));
assert.equal(built.layout.pairAdjustments.length, 10);

const rId = built.layout.forms.р.isol;
const aId = built.layout.forms.а.isol;
assert.ok(built.glyphs[rId].yMin < -80, `р must descend below baseline, got ${built.glyphs[rId].yMin}`);
assert.ok(built.glyphs[rId].yMin < built.glyphs[aId].yMin - 40, 'р must descend materially lower than а');
assert.ok(built.layout.metrics.inkBottom <= built.glyphs[rId].yMin);
assert.ok(built.layout.metrics.descent <= built.layout.metrics.inkBottom - 20);
assert.equal(built.layout.vertical.р.hasDescender, true);
assert.equal(built.layout.vertical.а.hasDescender, false);

const interfaceSource = await readFile('cursive-app.js', 'utf8');
assert.match(interfaceSource, /cursiveHasDescender/);
assert.match(interfaceSource, /cursiveDescenderScale/);
assert.match(interfaceSource, /cursiveBaseline/);
assert.match(interfaceSource, /applyRussianDescenderPreset/);
assert.match(interfaceSource, /py - generated\.baselineY/);
assert.match(interfaceSource, /дрожь · друг · щука · цифра/);
assert.match(interfaceSource, /contextualForm/);
assert.match(interfaceSource, /fontFeatureSettings = '"rlig" 1, "calt" 1, "curs" 1'/);

await writeFile('tests/.cursive-fixture.ttf', built.ttf);
await writeFile('tests/.cursive-layout.json', JSON.stringify(built.layout, null, 2));
console.log(`Cursive/contextual/descender/override tests passed. TTF ${built.ttf.length} bytes, ${built.glyphs.length} glyphs, descent ${built.layout.metrics.descent}.`);
