const OWNERSHIP_KEY = 'dyfr:public-font-ownership:v1';
const API = '/api/public-fonts';

function readOwnership() {
  try { return JSON.parse(localStorage.getItem(OWNERSHIP_KEY) || '{}'); } catch { return {}; }
}

function writeOwnership(value) {
  try { localStorage.setItem(OWNERSHIP_KEY, JSON.stringify(value)); } catch {}
}

function bytesToBase64(value) {
  if (value == null) return '';
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Ошибка сервера ${response.status}.`);
  return payload;
}

export function publicationKey(build) {
  return [build.project?.id || 'project', build.familyName, build.styleName, build.mode].join('|').normalize('NFC');
}

export function getPublicationOwnership(key) {
  return readOwnership()[key] || null;
}

export function getOwnerTokenForPublicId(id) {
  return Object.values(readOwnership()).find(item => item?.id === id)?.token || '';
}

export function rememberPublicationOwnership(key, id, token) {
  const ownership = readOwnership();
  ownership[key] = { id, token, updatedAt: new Date().toISOString() };
  writeOwnership(ownership);
}

export function forgetPublicationOwnership(key) {
  const ownership = readOwnership();
  delete ownership[key];
  writeOwnership(ownership);
}

export function buildPublicationPayload(build, form) {
  const { outputs } = build;
  return {
    familyName: build.familyName,
    styleName: build.styleName,
    baseName: outputs.baseName,
    mode: build.mode,
    glyphCount: build.glyphCount,
    sampleText: document.querySelector('#fontPreviewInput')?.value || '',
    featureSettings: build.mode === 'connected' ? '"rlig" 1, "calt" 1, "curs" 1' : 'normal',
    authorName: form.authorName,
    description: form.description,
    license: form.license,
    rightsConfirmed: Boolean(form.rightsConfirmed),
    files: {
      ttf: bytesToBase64(outputs.ttf),
      woff: bytesToBase64(outputs.woff),
      woff2: bytesToBase64(outputs.woff2),
      css: typeof outputs.css === 'string' ? outputs.css : '',
      zip: bytesToBase64(outputs.zip),
    },
  };
}

export async function publishFont(build, form) {
  const key = publicationKey(build);
  const existing = getPublicationOwnership(key);
  const payload = buildPublicationPayload(build, form);
  if (existing?.id && existing?.token) {
    const response = await fetch(`${API}/${encodeURIComponent(existing.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${existing.token}` },
      body: JSON.stringify(payload),
    });
    if (response.status !== 404) {
      const result = await parseResponse(response);
      return { ...result, updated: true, key };
    }
    forgetPublicationOwnership(key);
  }
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await parseResponse(response);
  rememberPublicationOwnership(key, result.font.id, result.ownerToken);
  return { ...result, updated: false, key };
}

export async function listPublicFonts(query = '') {
  const url = new URL(API, location.origin);
  if (query) url.searchParams.set('q', query);
  return parseResponse(await fetch(url));
}

export async function deletePublicFont(id) {
  const ownership = readOwnership();
  const entry = Object.entries(ownership).find(([, item]) => item?.id === id);
  const token = entry?.[1]?.token || '';
  if (!token) throw new Error('На этом устройстве нет ключа владельца публикации.');
  await parseResponse(await fetch(`${API}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }));
  if (entry) {
    delete ownership[entry[0]];
    writeOwnership(ownership);
  }
}

export function publicFileUrl(id, key, download = false) {
  return `${API}/${encodeURIComponent(id)}/files/${encodeURIComponent(key)}${download ? '?download=1' : ''}`;
}

export const PUBLIC_LICENSE_LABELS = {
  'OFL-1.1': 'SIL Open Font License 1.1',
  'CC0-1.0': 'CC0 1.0, без ограничений',
  'CC-BY-4.0': 'CC BY 4.0, с указанием автора',
};
