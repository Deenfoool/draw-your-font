import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const API_PREFIX = '/api/public-fonts';
const MAX_JSON_BYTES = 26 * 1024 * 1024;
const MAX_FILES = {
  ttf: 6 * 1024 * 1024,
  woff: 6 * 1024 * 1024,
  woff2: 6 * 1024 * 1024,
  css: 256 * 1024,
  zip: 14 * 1024 * 1024,
};
const LICENSES = new Set(['OFL-1.1', 'CC0-1.0', 'CC-BY-4.0']);
const FILE_INFO = {
  ttf: { extension: 'ttf', mime: 'font/ttf' },
  woff: { extension: 'woff', mime: 'font/woff' },
  woff2: { extension: 'woff2', mime: 'font/woff2' },
  css: { extension: 'css', mime: 'text/css; charset=utf-8' },
  zip: { extension: 'zip', mime: 'application/zip' },
};
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

function parseArguments(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--port') output.port = Number(argv[++index]);
    else if (value === '--host') output.host = argv[++index];
    else if (value === '--data-dir') output.dataDir = argv[++index];
    else if (value === '--root') output.rootDir = argv[++index];
  }
  return output;
}

function cleanText(value, maxLength, field, required = false) {
  const text = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !text) throw Object.assign(new Error(`Поле «${field}» обязательно.`), { statusCode: 400 });
  if (text.length > maxLength) throw Object.assign(new Error(`Поле «${field}» длиннее ${maxLength} символов.`), { statusCode: 400 });
  return text;
}

function safeBaseName(value) {
  return String(value || 'font').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'font';
}

function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function publicMetadata(metadata) {
  const { ownerHash, ...record } = metadata;
  return record;
}

function json(response, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(body);
}

function errorResponse(response, error) {
  const status = Number(error?.statusCode) || 500;
  if (status >= 500) console.error(error);
  json(response, status, { error: error?.message || 'Внутренняя ошибка сервера.' });
}

async function readJsonBody(request) {
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > MAX_JSON_BYTES) throw Object.assign(new Error('Публикация слишком большая.'), { statusCode: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error('Публикация слишком большая.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Некорректный JSON.'), { statusCode: 400 });
  }
}

function decodeBase64(value, key) {
  if (typeof value !== 'string' || !value) return null;
  const encoded = value.replace(/\s+/g, '');
  if (encoded.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(encoded)) throw Object.assign(new Error(`Файл ${key.toUpperCase()} повреждён.`), { statusCode: 400 });
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw Object.assign(new Error(`Файл ${key.toUpperCase()} пуст.`), { statusCode: 400 });
  if (bytes.length > MAX_FILES[key]) throw Object.assign(new Error(`Файл ${key.toUpperCase()} превышает допустимый размер.`), { statusCode: 413 });
  return bytes;
}

function validateSignature(key, bytes) {
  if (!bytes) return;
  const signature = bytes.subarray(0, 4).toString('latin1');
  if (key === 'ttf' && !(bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) && signature !== 'OTTO') {
    throw Object.assign(new Error('TTF/OTF имеет неверную сигнатуру.'), { statusCode: 400 });
  }
  if (key === 'woff' && signature !== 'wOFF') throw Object.assign(new Error('WOFF имеет неверную сигнатуру.'), { statusCode: 400 });
  if (key === 'woff2' && signature !== 'wOF2') throw Object.assign(new Error('WOFF2 имеет неверную сигнатуру.'), { statusCode: 400 });
  if (key === 'zip' && signature !== 'PK\u0003\u0004') throw Object.assign(new Error('ZIP имеет неверную сигнатуру.'), { statusCode: 400 });
}

function normalizePublication(payload) {
  if (!payload?.rightsConfirmed) throw Object.assign(new Error('Подтвердите право на публикацию шрифта.'), { statusCode: 400 });
  const license = cleanText(payload.license, 24, 'Лицензия', true);
  if (!LICENSES.has(license)) throw Object.assign(new Error('Выбрана неподдерживаемая лицензия.'), { statusCode: 400 });
  const files = {};
  for (const key of ['ttf', 'woff', 'woff2', 'zip']) {
    files[key] = decodeBase64(payload.files?.[key], key);
    validateSignature(key, files[key]);
  }
  const cssText = typeof payload.files?.css === 'string' ? payload.files.css : '';
  if (Buffer.byteLength(cssText) > MAX_FILES.css) throw Object.assign(new Error('CSS превышает допустимый размер.'), { statusCode: 413 });
  files.css = cssText ? Buffer.from(cssText, 'utf8') : null;
  if (!files.ttf || !files.woff2) throw Object.assign(new Error('Для публикации обязательны TTF и WOFF2.'), { statusCode: 400 });
  return {
    familyName: cleanText(payload.familyName, 100, 'Название шрифта', true),
    styleName: cleanText(payload.styleName || 'Regular', 60, 'Начертание', true),
    authorName: cleanText(payload.authorName, 80, 'Автор', true),
    description: cleanText(payload.description, 500, 'Описание'),
    license,
    mode: payload.mode === 'connected' ? 'connected' : 'standard',
    glyphCount: Math.max(0, Math.min(5000, Math.round(Number(payload.glyphCount) || 0))),
    sampleText: cleanText(payload.sampleText, 500, 'Текст предпросмотра'),
    featureSettings: cleanText(payload.featureSettings || 'normal', 160, 'OpenType-настройки'),
    baseName: safeBaseName(payload.baseName || payload.familyName),
    files,
  };
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

function ownerToken(request) {
  const authorization = String(request.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function createRateLimiter() {
  const buckets = new Map();
  return function enforce(request) {
    const now = Date.now();
    const key = String(request.socket.remoteAddress || 'unknown');
    const bucket = (buckets.get(key) || []).filter(timestamp => now - timestamp < 15 * 60_000);
    if (bucket.length >= 12) throw Object.assign(new Error('Слишком много операций публикации. Повторите позже.'), { statusCode: 429 });
    bucket.push(now);
    buckets.set(key, bucket);
    if (buckets.size > 2000) for (const [address, timestamps] of buckets) if (!timestamps.some(timestamp => now - timestamp < 15 * 60_000)) buckets.delete(address);
  };
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function loadMetadata(dataDir, id) {
  try { return JSON.parse(await readFile(resolve(dataDir, id, 'metadata.json'), 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('Публикация не найдена.'), { statusCode: 404 });
    throw error;
  }
}

async function listMetadata(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const names = await readdir(dataDir, { withFileTypes: true });
  const records = [];
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try { records.push(publicMetadata(await loadMetadata(dataDir, entry.name))); } catch {}
  }
  return records.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function writePublication(dataDir, id, normalized, ownerHash, previous = null) {
  const now = new Date().toISOString();
  const tempDir = resolve(dataDir, `.tmp-${id}-${randomUUID()}`);
  const finalDir = resolve(dataDir, id);
  const backupDir = resolve(dataDir, `.backup-${id}-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const availableFiles = [];
  const sizes = {};
  try {
    for (const [key, bytes] of Object.entries(normalized.files)) {
      if (!bytes) continue;
      const info = FILE_INFO[key];
      await writeFile(resolve(tempDir, `${key}.${info.extension}`), bytes);
      availableFiles.push(key);
      sizes[key] = bytes.length;
    }
    const metadata = {
      id,
      familyName: normalized.familyName,
      styleName: normalized.styleName,
      authorName: normalized.authorName,
      description: normalized.description,
      license: normalized.license,
      mode: normalized.mode,
      glyphCount: normalized.glyphCount,
      sampleText: normalized.sampleText,
      featureSettings: normalized.featureSettings,
      baseName: normalized.baseName,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      availableFiles,
      sizes,
      totalBytes: Object.values(sizes).reduce((sum, value) => sum + value, 0),
      ownerHash,
    };
    await writeFile(resolve(tempDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    const exists = await pathExists(finalDir);
    if (exists) await rename(finalDir, backupDir);
    try { await rename(tempDir, finalDir); }
    catch (error) {
      if (exists && await pathExists(backupDir)) await rename(backupDir, finalDir).catch(() => {});
      throw error;
    }
    if (exists) await rm(backupDir, { recursive: true, force: true });
    return metadata;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function validateId(id) {
  if (!/^[a-z0-9][a-z0-9-]{7,100}$/.test(id || '')) throw Object.assign(new Error('Некорректный идентификатор публикации.'), { statusCode: 400 });
  return id;
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
}

export function createDrawYourFontServer(options = {}) {
  const rootDir = resolve(options.rootDir || MODULE_ROOT);
  const dataDir = resolve(options.dataDir || process.env.DYFR_DATA_DIR || resolve(rootDir, 'data/public-fonts'));
  const enforceRateLimit = createRateLimiter();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      Object.entries(securityHeaders()).forEach(([key, value]) => response.setHeader(key, value));

      if (url.pathname === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, service: 'draw-your-font-public-library' });

      if (url.pathname === API_PREFIX && request.method === 'GET') {
        const records = await listMetadata(dataDir);
        const query = cleanText(url.searchParams.get('q'), 100, 'Поиск').toLocaleLowerCase('ru-RU');
        const filtered = query ? records.filter(record => `${record.familyName} ${record.styleName} ${record.authorName} ${record.description}`.toLocaleLowerCase('ru-RU').includes(query)) : records;
        return json(response, 200, { fonts: filtered, count: filtered.length });
      }

      if (url.pathname === API_PREFIX && request.method === 'POST') {
        if (!sameOrigin(request)) throw Object.assign(new Error('Публикация разрешена только с этого сайта.'), { statusCode: 403 });
        enforceRateLimit(request);
        const normalized = normalizePublication(await readJsonBody(request));
        const id = `${safeBaseName(normalized.familyName).slice(0, 42)}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const token = randomBytes(32).toString('base64url');
        const metadata = await writePublication(dataDir, id, normalized, hashToken(token));
        return json(response, 201, { font: publicMetadata(metadata), ownerToken: token });
      }

      const match = new RegExp(`^${API_PREFIX}/([^/]+)(?:/files/(ttf|woff|woff2|css|zip))?$`).exec(url.pathname);
      if (match) {
        const id = validateId(match[1]);
        const fileKey = match[2] || null;
        if (fileKey && request.method === 'GET') {
          const metadata = await loadMetadata(dataDir, id);
          if (!metadata.availableFiles?.includes(fileKey)) throw Object.assign(new Error('Файл не найден.'), { statusCode: 404 });
          const info = FILE_INFO[fileKey];
          const filePath = resolve(dataDir, id, `${fileKey}.${info.extension}`);
          const fileStat = await stat(filePath);
          const headers = {
            'Content-Type': info.mime,
            'Content-Length': fileStat.size,
            'Cache-Control': 'public, max-age=3600',
          };
          if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${metadata.baseName}.${info.extension}"`;
          response.writeHead(200, headers);
          return createReadStream(filePath).pipe(response);
        }
        if (!fileKey && request.method === 'GET') return json(response, 200, { font: publicMetadata(await loadMetadata(dataDir, id)) });
        if (!fileKey && request.method === 'PUT') {
          if (!sameOrigin(request)) throw Object.assign(new Error('Обновление разрешено только с этого сайта.'), { statusCode: 403 });
          enforceRateLimit(request);
          const previous = await loadMetadata(dataDir, id);
          const token = ownerToken(request);
          if (!token || hashToken(token) !== previous.ownerHash) throw Object.assign(new Error('Нет прав на обновление этой публикации.'), { statusCode: 403 });
          const normalized = normalizePublication(await readJsonBody(request));
          const metadata = await writePublication(dataDir, id, normalized, previous.ownerHash, previous);
          return json(response, 200, { font: publicMetadata(metadata) });
        }
        if (!fileKey && request.method === 'DELETE') {
          if (!sameOrigin(request)) throw Object.assign(new Error('Удаление разрешено только с этого сайта.'), { statusCode: 403 });
          enforceRateLimit(request);
          const metadata = await loadMetadata(dataDir, id);
          const token = ownerToken(request);
          if (!token || hashToken(token) !== metadata.ownerHash) throw Object.assign(new Error('Нет прав на удаление этой публикации.'), { statusCode: 403 });
          await rm(resolve(dataDir, id), { recursive: true, force: true });
          response.writeHead(204);
          return response.end();
        }
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') throw Object.assign(new Error('Метод не поддерживается.'), { statusCode: 405 });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw Object.assign(new Error('Некорректный адрес.'), { statusCode: 400 }); }
      if (pathname === '/') pathname = '/index.html';
      if (pathname.startsWith('/data/') || pathname.startsWith('/.git/') || pathname.includes('\0')) throw Object.assign(new Error('Файл не найден.'), { statusCode: 404 });
      const filePath = resolve(rootDir, `.${pathname}`);
      const rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
      if (filePath !== rootDir && !filePath.startsWith(rootPrefix)) throw Object.assign(new Error('Файл не найден.'), { statusCode: 404 });
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat?.isFile()) throw Object.assign(new Error('Файл не найден.'), { statusCode: 404 });
      response.writeHead(200, {
        'Content-Type': STATIC_MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': fileStat.size,
        'Cache-Control': /\.(?:html|js|mjs|css)$/i.test(filePath) ? 'no-cache' : 'public, max-age=3600',
      });
      if (request.method === 'HEAD') return response.end();
      createReadStream(filePath).pipe(response);
    } catch (error) {
      if (!response.headersSent) errorResponse(response, error);
      else response.destroy(error);
    }
  });
  server.dyfr = { rootDir, dataDir };
  return server;
}

async function startFromCommandLine() {
  const args = parseArguments(process.argv.slice(2));
  const port = Number(args.port || process.env.PORT || 8000);
  const host = args.host || process.env.HOST || '0.0.0.0';
  const server = createDrawYourFontServer(args);
  await mkdir(server.dyfr.dataDir, { recursive: true });
  server.listen(port, host, () => {
    const shownHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Draw Your Font RU: http://${shownHost}:${port}`);
    console.log(`Public library data: ${server.dyfr.dataDir}`);
  });
}

const directEntry = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directEntry) startFromCommandLine().catch(error => { console.error(error); process.exitCode = 1; });
