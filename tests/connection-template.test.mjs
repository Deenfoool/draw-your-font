import assert from 'node:assert/strict';
import {
  CONNECTION_TARGETS,
  CONNECTION_TEMPLATE_VERSION,
  planConnectionTemplatePages,
  renderConnectionTemplatePage,
  validateConnectionTemplatePlan,
} from '../src/connection-template.js';
import { metadataFromMatrix, metadataMatrix } from '../src/template-code.js';
import { RUSSIAN_LOWERCASE } from '../src/russian-joining.js';

const plan = planConnectionTemplatePages({ title: 'Проверка соединений' });
assert.equal(plan.kind, 'connections');
assert.equal(plan.version, CONNECTION_TEMPLATE_VERSION);
assert.equal(plan.characters.length, 33);
assert.deepEqual(plan.characters, RUSSIAN_LOWERCASE);
assert.deepEqual(CONNECTION_TARGETS.map((target) => target.id), ['upper', 'middle', 'lower']);
assert.equal(plan.samples.length, 99);
assert.equal(plan.pageCount, 3);
assert.equal(plan.pages[0].cells.length, 42);
assert.equal(plan.pages[1].cells.length, 42);
assert.equal(plan.pages[2].cells.length, 15);
assert.deepEqual(validateConnectionTemplatePlan(plan), []);

for (let charIndex = 0; charIndex < plan.characters.length; charIndex += 1) {
  const samples = plan.samples.slice(charIndex * 3, charIndex * 3 + 3);
  assert.deepEqual(samples.map((sample) => sample.char), Array(3).fill(plan.characters[charIndex]));
  assert.deepEqual(samples.map((sample) => sample.targetClass), ['upper', 'middle', 'lower']);
}

for (const page of plan.pages) {
  const decoded = metadataFromMatrix(metadataMatrix(page.metadata));
  assert.equal(decoded.valid, true);
  assert.equal(decoded.version, CONNECTION_TEMPLATE_VERSION);
  assert.equal(decoded.pageIndex, page.pageIndex);
  assert.equal(decoded.pageCount, plan.pageCount);
  assert.equal(decoded.totalChars, 99);
  for (let index = 0; index < page.cells.length; index += 3) {
    const group = page.cells.slice(index, index + 3);
    if (group.length === 3 && group.every((cell) => cell.char === group[0].char)) {
      assert.ok(group[0].targetY < group[1].targetY);
      assert.ok(group[1].targetY < group[2].targetY);
    }
  }
  for (const cell of page.cells) {
    assert.ok(cell.targetY > cell.capLine);
    assert.ok(cell.targetY < cell.baseline);
    assert.ok(cell.targetX > cell.x + cell.width * 0.75);
    assert.equal(cell.target.x, cell.targetX);
    assert.equal(cell.target.y, cell.targetY);
  }
}

class FakeContext {
  constructor() {
    this.canvas = { width: 0, height: 0 };
    this.text = [];
    this.arcs = [];
  }
  save() {}
  restore() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  setLineDash() {}
  fillText(value) { this.text.push(String(value)); }
  arc(x, y, radius) { this.arcs.push({ x, y, radius }); }
}

const context = new FakeContext();
const rendered = renderConnectionTemplatePage(context, plan.pages[0], { dpi: 72, showGuides: true });
assert.equal(context.canvas.width, rendered.widthPx);
assert.equal(context.canvas.height, rendered.heightPx);
assert.ok(rendered.widthPx > 590 && rendered.widthPx < 600);
assert.ok(rendered.heightPx > 835 && rendered.heightPx < 850);
assert.ok(context.text.some((value) => value.includes('одним движением')));
assert.ok(context.text.some((value) => value.includes('В - верхнее')));
assert.ok(context.text.some((value) => value.includes('а → В')));
assert.equal(context.arcs.length, plan.pages[0].cells.length * 2);

console.log('Stage 11.3 connection calibration template tests: PASS. 99 samples on 3 A4 pages.');
