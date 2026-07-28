import assert from 'node:assert/strict';
import {
  copyArrayBuffer,
  formatLibraryBytes,
  makeLibraryId,
  normalizeLibraryRecord,
} from '../src/font-library.js';

const id = makeLibraryId({
  projectId: 'Project 42',
  familyName: 'Мой Шрифт!',
  styleName: 'Regular',
  mode: 'connected',
});
assert.equal(id, 'project-42::мой-шрифт::regular::connected');
assert.equal(id, makeLibraryId({ projectId: 'Project 42', familyName: 'Мой Шрифт!', styleName: 'Regular', mode: 'connected' }));

const source = new Uint8Array([0, 1, 2, 3, 4]);
const copied = copyArrayBuffer(source.subarray(1, 4));
assert.deepEqual([...new Uint8Array(copied)], [1, 2, 3]);
source[2] = 99;
assert.deepEqual([...new Uint8Array(copied)], [1, 2, 3], 'library must own an independent file copy');

const record = await normalizeLibraryRecord({
  projectId: 'p-1',
  familyName: 'Почерк Дениса',
  styleName: 'Regular',
  mode: 'connected',
  glyphCount: 96,
  projectJson: '{"format":"draw-your-font-project"}',
  files: {
    ttf: new Uint8Array([0, 1, 0, 0]),
    woff: new Uint8Array([119, 79, 70, 70]),
    woff2: new Uint8Array([119, 79, 70, 50]),
    zip: new Uint8Array([80, 75, 3, 4]),
    css: '@font-face{}',
  },
});
assert.equal(record.mode, 'connected');
assert.equal(record.glyphCount, 96);
assert.equal(record.sizes.ttf, 4);
assert.equal(record.sizes.woff2, 4);
assert.equal(record.files.css, '@font-face{}');
assert.ok(record.totalBytes >= 16);
assert.match(record.featureSettings, /calt/);
assert.match(record.id, /почерк-дениса/);

await assert.rejects(() => normalizeLibraryRecord({ familyName: 'Пустой', files: {} }), /TTF или WOFF2/);
assert.equal(formatLibraryBytes(0), '0 Б');
assert.equal(formatLibraryBytes(1536), '1.5 КБ');
assert.equal(formatLibraryBytes(2 * 1024 * 1024), '2.0 МБ');

console.log('Font library deterministic tests: PASS');
