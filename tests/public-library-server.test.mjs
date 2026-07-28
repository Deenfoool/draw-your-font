import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDrawYourFontServer } from '../server.mjs';

const dataDir = await mkdtemp(join(tmpdir(), 'dyfr-public-library-'));
const adminToken = 'integration-admin-token-that-is-not-public';
const server = createDrawYourFontServer({ rootDir: resolve('.'), dataDir, adminToken, maxPublicFonts: 1, maxPublicBytes: 10 * 1024 * 1024 });
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const encode = bytes => Buffer.from(bytes).toString('base64');
const files = {
  ttf: encode([0, 1, 0, 0, 0, 10, 0, 128]),
  woff: encode(Buffer.from('wOFFtest')),
  woff2: encode(Buffer.from('wOF2test')),
  css: '@font-face{font-family:"Public Test";}',
  zip: encode([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
};
const publication = {
  familyName: 'Общий тестовый шрифт', styleName: 'Regular', authorName: 'Денис',
  description: 'Проверка серверного каталога.', license: 'OFL-1.1', rightsConfirmed: true,
  mode: 'connected', glyphCount: 88, sampleText: 'Дрожь, щука, цифра.',
  featureSettings: '"rlig" 1, "calt" 1, "curs" 1', baseName: 'public-test', files,
};

async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, options);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

try {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);

  const crossOrigin = await request('/api/public-fonts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify(publication),
  });
  assert.equal(crossOrigin.response.status, 403);

  const denied = await request('/api/public-fonts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ ...publication, rightsConfirmed: false }),
  });
  assert.equal(denied.response.status, 400);

  const created = await request('/api/public-fonts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(publication),
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body.ownerToken.length >= 30);
  assert.equal(created.body.font.familyName, publication.familyName);
  assert.equal(created.body.font.ownerHash, undefined);
  const id = created.body.font.id;
  const token = created.body.ownerToken;

  const quota = await request('/api/public-fonts', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ ...publication, familyName: 'Второй шрифт' }),
  });
  assert.equal(quota.response.status, 507);

  const listed = await request('/api/public-fonts?q=Денис');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.fonts[0].id, id);
  assert.equal(listed.body.fonts[0].ownerHash, undefined);

  const woff2 = await fetch(`${origin}/api/public-fonts/${id}/files/woff2`);
  assert.equal(woff2.status, 200);
  assert.equal(Buffer.from(await woff2.arrayBuffer()).subarray(0, 4).toString('latin1'), 'wOF2');
  assert.equal(woff2.headers.get('content-type'), 'font/woff2');

  const forbiddenUpdate = await request(`/api/public-fonts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer wrong' },
    body: JSON.stringify({ ...publication, description: 'Чужая правка' }),
  });
  assert.equal(forbiddenUpdate.response.status, 403);

  const updated = await request(`/api/public-fonts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...publication, description: 'Обновлённое описание.' }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.font.description, 'Обновлённое описание.');
  assert.equal(updated.body.font.id, id);

  const forbiddenDelete = await request(`/api/public-fonts/${id}`, {
    method: 'DELETE', headers: { Origin: origin, Authorization: 'Bearer wrong' },
  });
  assert.equal(forbiddenDelete.response.status, 403);

  const removedByAdmin = await request(`/api/public-fonts/${id}`, {
    method: 'DELETE', headers: { Origin: origin, Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(removedByAdmin.response.status, 204);

  const empty = await request('/api/public-fonts');
  assert.equal(empty.body.count, 0);
  for (const path of ['/data/public-fonts/secret', '/server.mjs', '/.env.example', '/node_modules/example', '/tests/example']) {
    const privatePath = await fetch(`${origin}${path}`);
    assert.equal(privatePath.status, 404, `${path} must remain private`);
  }
  console.log('Public library server API test: PASS');
} finally {
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(dataDir, { recursive: true, force: true });
}
