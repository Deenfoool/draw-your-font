import assert from 'node:assert/strict';
import {
  applyConnectionSamplesToProject,
  getConnectionSample,
  listConnectionSamples,
  resolveConnectionTemplatePlan,
} from '../src/connection-template-scanner.js';
import { planConnectionTemplatePages } from '../src/connection-template.js';
import { deserializeProject, serializeProject } from '../src/project.js';

function sample(char, targetClass, sampleIndex) {
  const width = 8;
  const height = 6;
  const mask = new Uint8Array(width * height);
  for (let x = 1; x < width - 1; x += 1) mask[(height - 2) * width + x] = 1;
  mask[(height - 3) * width + width - 2] = 1;
  return {
    id: `sample-${char}-${targetClass}`,
    char,
    targetClass,
    sampleIndex,
    width,
    height,
    mask,
    guides: { capY: 1, xHeightY: 2, baselineY: 4, descenderY: 5 },
    target: { x: 6, y: 3, radius: 1 },
    quality: { inkCount: 7, targetInk: 2, reachedTarget: true, areaRatio: 7 / 48, bbox: { x0: 1, y0: 3, x1: 6, y1: 4 }, warnings: [] },
    source: { type: 'connection-template', pageIndex: 0, cellIndex: sampleIndex },
  };
}

const plan = planConnectionTemplatePages({ title: 'Storage test' });
const resolved = resolveConnectionTemplatePlan({ ...plan.pages[0].metadata, valid: true }, null);
assert.equal(resolved.kind, 'connections');
assert.equal(resolved.samples.length, 99);
assert.throws(() => resolveConnectionTemplatePlan({ ...plan.pages[0].metadata, version: 1, valid: true }, null), /v2/);

const project = {
  format: 'draw-your-font-project',
  version: 4,
  id: 'connection-storage-test',
  title: 'Connection storage test',
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
  glyphs: [],
  kerning: {},
  font: { familyName: 'Connection storage test', styleName: 'Regular', unitsPerEm: 1000, ascent: 800, descent: -200, lineGap: 120 },
  template: null,
  sourceFiles: [],
};
const samples = [sample('а', 'upper', 0), sample('а', 'middle', 1), sample('а', 'lower', 2), sample('б', 'upper', 3)];
const stored = applyConnectionSamplesToProject(project, { samples, complete: false, byPage: new Map([[0, {}]]) }, { sourceFiles: [{ name: 'page-1.jpg' }] });
assert.equal(stored.format, 'draw-your-font-connection-samples');
assert.equal(stored.templateVersion, 2);
assert.equal(stored.complete, false);
assert.equal(typeof stored.samples.а.upper.mask, 'string');
assert.ok(stored.samples.а.upper.mask.length > 0);

const decoded = getConnectionSample(project, 'а', 'middle');
assert.equal(decoded.char, 'а');
assert.equal(decoded.targetClass, 'middle');
assert.deepEqual([...decoded.mask], [...samples[1].mask]);
assert.equal(getConnectionSample(project, 'я', 'upper'), null);
assert.deepEqual(listConnectionSamples(project).map((item) => item.sampleIndex), [0, 1, 2, 3]);

const restored = deserializeProject(serializeProject(project));
assert.equal(restored.connectionTemplate.format, 'draw-your-font-connection-samples');
assert.equal(restored.connectionTemplate.sourceFiles[0].name, 'page-1.jpg');
assert.deepEqual([...getConnectionSample(restored, 'б', 'upper').mask], [...samples[3].mask]);

console.log('Stage 11.3 connection sample storage round-trip: PASS.');
