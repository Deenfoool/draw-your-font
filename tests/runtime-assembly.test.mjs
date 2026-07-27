import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const assembly = await readFile('scripts/assemble-stage4.mjs', 'utf8');
assert.doesNotMatch(assembly, /source-parts\/cursive-font-v2\.js/);
assert.doesNotMatch(assembly, /source-parts\/cursive-app-v4\.js/);
assert.match(assembly, /src\/cursive-font\.js/);
assert.match(assembly, /cursive-app\.js/);
assert.match(assembly, /data-dyfr-cursive/);
assert.match(assembly, /Duplicate source part number/);
assert.match(assembly, /Missing or unordered source part/);

const expected = new Map([
  ['src/cursive-font.js', '7c6bcf6867b11d6bd4fdc038daf47715c671bdbb3b1a5414682c77111de716b4'],
  ['cursive-app.js', '1f39268d2eaa053d57227380a703089ead7b63098c109276edc7298ecce62968'],
]);
for (const [file, digest] of expected) {
  const source = await readFile(file);
  assert.equal(createHash('sha256').update(source).digest('hex'), digest, `${file} integrity mismatch`);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, `${file} syntax error: ${check.stderr}`);
}

const stage4 = await readFile('stage4-app.js', 'utf8');
assert.match(stage4, /import '\.\/cursive-app\.js';/);
assert.match(stage4, /link\.href = '\.\/cursive\.css'/);
console.log('Runtime assembly regression test: PASS');
