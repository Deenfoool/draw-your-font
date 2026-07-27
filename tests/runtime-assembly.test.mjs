import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const assembly = await readFile('scripts/assemble-stage4.mjs', 'utf8');
assert.doesNotMatch(assembly, /source-parts\/cursive-font-v2\.js/);
assert.doesNotMatch(assembly, /source-parts\/cursive-app-v4\.js/);
assert.match(assembly, /src\/cursive-font-core\.js/);
assert.match(assembly, /src\/cursive-font\.js/);
assert.match(assembly, /cursive-app\.js/);
assert.match(assembly, /data-dyfr-cursive/);
assert.match(assembly, /Duplicate source part number/);
assert.match(assembly, /Missing or unordered source part/);
assert.match(assembly, /spawnSync\(process\.execPath, \['--check'/);

for (const file of ['src/cursive-font-core.js', 'src/cursive-font.js', 'cursive-app.js']) {
  const source = await readFile(file, 'utf8');
  assert.ok(source.length > 100, `${file} is unexpectedly empty`);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, `${file} syntax error: ${check.stderr}`);
}

const core = await readFile('src/cursive-font-core.js', 'utf8');
const wrapper = await readFile('src/cursive-font.js', 'utf8');
assert.match(core, /function buildGsub\(/);
assert.match(core, /function buildGpos\(/);
assert.match(wrapper, /restrictCursiveFeatureLookups/);
assert.match(wrapper, /\[1, 3, 5\]/);
assert.match(wrapper, /buildCoreCursiveFont/);

const stage4 = await readFile('stage4-app.js', 'utf8');
assert.match(stage4, /import '\.\/cursive-app\.js';/);
assert.match(stage4, /link\.href = '\.\/cursive\.css'/);
console.log('Runtime assembly regression test: PASS');
