import assert from 'node:assert/strict';
import { A4_MM, TEMPLATE_CHARSETS, getTemplateCharset, normalizeCustomCharset, planTemplatePages, validateTemplatePlan } from '../src/template.js';
import { buildJpegPdf, countPdfPages, validatePdfStructure } from '../src/pdf.js';

{
  const upper = getTemplateCharset('ru-upper');
  const lower = getTemplateCharset('ru-lower');
  assert.equal(upper.filter((char) => char === 'Ё').length, 1);
  assert.equal(lower.filter((char) => char === 'ё').length, 1);
  assert.equal(new Set(TEMPLATE_CHARSETS['ru-full']).size, TEMPLATE_CHARSETS['ru-full'].length);
  assert.equal(TEMPLATE_CHARSETS['ru-full'].join(''), [...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя', ...'0123456789', ...'.,;:!?«»()-—'].join(''));
  assert.ok(TEMPLATE_CHARSETS['ru-extended'].length > TEMPLATE_CHARSETS['ru-full'].length);
}
{
  assert.deepEqual(normalizeCustomCharset(' АА Е\u0308Ё\nБ '), ['А', 'Ё', 'Б']);
}
{
  const chars = getTemplateCharset('ru-full');
  const plan = planTemplatePages(chars, { layoutId: 'balanced', charsetId: 'ru-full', title: 'Тестовый шрифт' });
  assert.equal(plan.perPage, 48);
  assert.equal(plan.pageCount, 2);
  assert.deepEqual(plan.pages.flatMap((page) => page.cells.map((cell) => cell.char)), chars);
  assert.deepEqual(validateTemplatePlan(plan), []);
  for (const cell of plan.pages.flatMap((page) => page.cells)) {
    assert.ok(cell.x >= 0 && cell.y >= 0);
    assert.ok(cell.x + cell.width <= A4_MM.width + 1e-6);
    assert.ok(cell.y + cell.height <= A4_MM.height + 1e-6);
  }
}
{
  const chars = getTemplateCharset('ru-letters');
  const plan = planTemplatePages(chars, { layoutId: 'large', charsetId: 'ru-letters' });
  assert.equal(plan.perPage, 35);
  assert.equal(plan.pageCount, 2);
  assert.deepEqual(plan.pages.map((page) => [page.pageNumber, page.pageCount]), [[1, 2], [2, 2]]);
}
{
  assert.throws(() => planTemplatePages([], {}), /пуст/i);
}
{
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildJpegPdf([{ width: 10, height: 10, bytes: fakeJpeg }, { width: 10, height: 10, bytes: fakeJpeg }], { title: 'Тест PDF' });
  assert.equal(countPdfPages(pdf), 2);
  assert.deepEqual(validatePdfStructure(pdf), []);
  assert.ok(pdf.length > 800);
}
console.log('All 6 template/PDF tests passed.');
