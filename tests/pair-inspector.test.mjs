import assert from 'node:assert/strict';
import { ensureCursiveProject } from '../src/cursive-font.js';
import {
  inspectRussianPair,
  inspectRussianPairMatrix,
  PAIR_INSPECTOR_VERSION,
  PAIR_STATUSES,
} from '../src/pair-inspector.js';
import { RUSSIAN_LOWERCASE } from '../src/russian-joining.js';

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
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), radius);
    }
  };
  line(8 + seed, 55, 15 + seed, 24);
  line(15 + seed, 24, 25 + seed, 48);
  line(25 + seed, 48, 36 + seed, 23);
  line(36 + seed, 23, 41 + seed, 55);
  line(9 + seed, 55, 41 + seed, 55);
  return {
    id: `pair-${char}`,
    char,
    width,
    height,
    mask,
    guides: { capY: 7, xHeightY: 22, baselineY: 57, descenderY: 68 },
    metrics: { leftSideBearing: 36, rightSideBearing: 36, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
  };
}

const characters = ['л', 'а', 'м', 'о', 'н', 'ф', 'д', 'р', 'с'];
const project = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Pair Inspector Test',
  font: { familyName: 'Pair Inspector Test', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: characters.map((char, index) => glyph(char, (index % 3) - 1)),
  kerning: {},
};
const cursive = ensureCursiveProject(project);
cursive.enabled = true;

assert.equal(PAIR_INSPECTOR_VERSION, 1);
assert.deepEqual(PAIR_STATUSES, ['good', 'review', 'bad', 'missing', 'disconnected']);

for (const pair of ['ла', 'мо', 'но', 'оф', 'да', 'ро', 'со']) {
  const [left, right] = [...pair];
  const result = inspectRussianPair(project, left, right);
  assert.equal(result.pair, pair);
  assert.ok(['good', 'review', 'bad'].includes(result.status));
  assert.ok(Number.isFinite(result.score));
  assert.ok(Number.isFinite(result.metrics.verticalJump));
  assert.ok(Number.isFinite(result.metrics.seamDistance));
  assert.equal(result.metrics.exitClass, result.metrics.entryClass);
  if (['а', 'б', 'д', 'о', 'ф'].includes(right)) assert.match(result.metrics.entryProfile, /^ru-school-/);
}

const normal = inspectRussianPair(project, 'м', 'о');
assert.notEqual(normal.status, 'missing');
assert.notEqual(normal.status, 'disconnected');
assert.equal(normal.metrics.spacing, 0);

project.cursive.pairOverrides['м|о'] = { spacing: 40 };
const broken = inspectRussianPair(project, 'м', 'о');
assert.equal(broken.metrics.spacing, 40);
assert.ok(broken.metrics.seamDistance > normal.metrics.seamDistance + 20);
assert.equal(broken.status, 'bad');
assert.ok(broken.reasons.some((reason) => reason.includes('разрыв')));

delete project.cursive.pairOverrides['м|о'];
project.cursive.pairOverrides['м|о'] = { connect: false };
const disconnected = inspectRussianPair(project, 'м', 'о');
assert.equal(disconnected.status, 'disconnected');
assert.equal(disconnected.score, 0);

delete project.cursive.pairOverrides['м|о'];
const missing = inspectRussianPair(project, 'м', 'я');
assert.equal(missing.status, 'missing');

const matrix = inspectRussianPairMatrix(project, { characters: ['м', 'о', 'с'] });
assert.equal(matrix.version, 1);
assert.deepEqual(matrix.characters, ['м', 'о', 'с']);
assert.equal(matrix.total, 9);
assert.equal(matrix.pairs.length, 9);
assert.equal(Object.keys(matrix.byPair).length, 9);
assert.equal(Object.values(matrix.counts).reduce((sum, count) => sum + count, 0), 9);
assert.ok(matrix.inspected > 0);
assert.ok(matrix.averageScore >= 0 && matrix.averageScore <= 100);

const fullProject = {
  format: 'draw-your-font-project',
  version: 4,
  title: 'Full Russian Pair Matrix',
  font: { familyName: 'Full Russian Pair Matrix', styleName: 'Regular', ascent: 800, descent: -200 },
  glyphs: RUSSIAN_LOWERCASE.map((char, index) => glyph(char, (index % 3) - 1)),
  kerning: {},
};
ensureCursiveProject(fullProject).enabled = true;
const fullMatrix = inspectRussianPairMatrix(fullProject);
assert.equal(fullMatrix.characters.length, 33);
assert.equal(fullMatrix.total, 1089);
assert.equal(fullMatrix.pairs.length, 1089);
assert.equal(Object.keys(fullMatrix.byPair).length, 1089);
assert.equal(Object.values(fullMatrix.counts).reduce((sum, count) => sum + count, 0), 1089);
assert.equal(fullMatrix.counts.missing, 0);
assert.equal(fullMatrix.counts.disconnected, 0);
assert.equal(fullMatrix.inspected, 1089);
for (const result of fullMatrix.pairs) {
  assert.equal(result.pair.length, 2);
  assert.ok(['good', 'review', 'bad'].includes(result.status));
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.metrics);
  assert.ok(Number.isFinite(result.metrics.verticalJump));
  assert.ok(Number.isFinite(result.metrics.seamDistance));
}

console.log(`Stage 11.5 pair inspector tests: PASS. Full matrix ${fullMatrix.total} pairs, average ${fullMatrix.averageScore}.`);
