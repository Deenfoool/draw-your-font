import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const API = '/api/public-fonts';
const MAX_BODY = 26 * 1024 * 1024;
const LIMITS = { ttf: 6e6, woff: 6e6, woff2: 6e6, css: 256e3, zip: 14e6 };
const LICENSES = new Set(['OFL-1.1', 'CC0-1.0', 'CC-BY-4.0']);
const FILES = {
  ttf: ['ttf', 'font/ttf'], woff: ['woff', 'font/woff'], woff2: ['woff2', 'font/woff2'],
  css: ['css', 'text/css; charset=utf-8'], zip: ['zip', 'application/zip'],
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};
const PRIVATE_PREFIXES = ['/data/', '/node_modules/', '/tests/', '/scripts/', '/source-parts/', '/.git/', '/.github/', '/deploy/'];
const PRIVATE_FILES = new Set(['/server.mjs', '/package.json', '/Dockerfile', '/docker-compose.yml', '/README.md', '/LICENSE', '/THIRD_PARTY_NOTICES.md']);
const DEFAULT_MAX_PUBLIC_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_MAX_PUBLIC_FONTS = 10000;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--host') out.host = argv[++i];
    else if (argv[i] === '--data-dir') out.dataDir = argv[++i];
    else if (argv[i] === '--root') out.rootDir = argv[++i];
  }
  return out;
}

function fail(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function hash(value) { return createHash('sha256').update(String(value || '')).digest('hex'); }
function safeName(value) { return String(value || 'font').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'font'; }
function text(value, max, label, required = false) {
  const clean = String(value ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !clean) throw fail(`Поле «${label}» обязательно.`);
  if (clean.length > max) throw fail(`Поле «${label}» длиннее ${max} символов.`);
  return clean;
}
function publicMeta(meta) { const { ownerHash, ...rest } = meta; return rest; }
function sendJson(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendError(res, error) {
  const code = Number(error?.statusCode) || 500;
  if (code >= 500) console.error(error);
  sendJson(res, code, { error: error?.message || 'Внутренняя ошибка сервера.' });
}
async function readJson(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw fail('Публикация слишком большая.', 413);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw fail('Публикация слишком большая.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('Некорректный JSON.'); }
}
function decode(value, key) {
  if (!value) return null;
  if (typeof value !== 'string') throw fail(`Файл ${key.toUpperCase()} повреждён.`);
  const encoded = value.replace(/\s+/g, '');
  if (encoded.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(encoded)) throw fail(`Файл ${key.toUpperCase()} повреждён.`);
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw fail(`Файл ${key.toUpperCase()} пуст.`);
  if (bytes.length > LIMITS[key]) throw fail(`Файл ${key.toUpperCase()} превышает допустимый размер.`, 413);
  return bytes;
}
function signature(key, bytes) {
  if (!bytes) return;
  const sig = bytes.subarray(0, 4).toString('latin1');
  if (key === 'ttf' && !(bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) && sig !== 'OTTO') throw fail('TTF/OTF имеет неверную сигнатуру.');
  if (key === 'woff' && sig !== 'wOFF') throw fail('WOFF имеет неверную сигнатуру.');
  if (key === 'woff2' && sig !== 'wOF2') throw fail('WOFF2 имеет неверную сигнатуру.');
  if (key === 'zip' && sig !== 'PK\u0003\u0004') throw fail('ZIP имеет неверную сигнатуру.');
}
function normalize(payload) {
  if (!payload?.rightsConfirmed) throw fail('Подтвердите право на публикацию шрифта.');
  const license = text(payload.license, 24, 'Лицензия', true);
  if (!LICENSES.has(license)) throw fail('Выбрана неподдерживаемая лицензия.');
  const files = {};
  for (const key of ['ttf', 'woff', 'woff2', 'zip']) { files[key] = decode(payload.files?.[key], key); signature(key, files[key]); }
  const css = typeof payload.files?.css === 'string' ? payload.files.css : '';
  if (Buffer.byteLength(css) > LIMITS.css) throw fail('CSS превышает допустимый размер.', 413);
  files.css = css ? Buffer.from(css) : null;
  if (!files.ttf || !files.woff2) throw fail('Для публикации обязательны TTF и WOFF2.');
  return {
    familyName: text(payload.familyName, 100, 'Название шрифта', true), styleName: text(payload.styleName || 'Regular', 60, 'Начертание', true),
    authorName: text(payload.authorName, 80, 'Автор', true), description: text(payload.description, 500, 'Описание'), license,
    mode: payload.mode === 'connected' ? 'connected' : 'standard', glyphCount: Math.max(0, Math.min(5000, Math.round(Number(payload.glyphCount) || 0))),
    sampleText: text(payload.sampleText, 500, 'Текст предпросмотра'), featureSettings: text(payload.featureSettings || 'normal', 160, 'OpenType-настройки'),
    baseName: safeName(payload.baseName || payload.familyName), files,
  };
}
function sameOrigin(req) { const origin = req.headers.origin; if (!origin) return true; try { return new URL(origin).host === req.headers.host; } catch { return false; } }
function bearer(req) { const value = String(req.headers.authorization || ''); return value.startsWith('Bearer ') ? value.slice(7).trim() : ''; }
function limiter(trustProxy = false) {
  const buckets = new Map();
  return req => {
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const now = Date.now(), key = forwarded || String(req.socket.remoteAddress || 'unknown');
    const entries = (buckets.get(key) || []).filter(time => now - time < 15 * 60_000);
    if (entries.length >= 12) throw fail('Слишком много операций публикации. Повторите позже.', 429);
    entries.push(now); buckets.set(key, entries);
  };
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function metadata(dataDir, id) {
  try { return JSON.parse(await readFile(resolve(dataDir, id, 'metadata.json'), 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') throw fail('Публикация не найдена.', 404); throw error; }
}
async function catalogStats(dataDir) {
  const records = await list(dataDir);
  return { records, totalBytes: records.reduce((sum, item) => sum + (Number(item.totalBytes) || 0), 0) };
}
function itemBytes(item) { return Object.values(item.files || {}).reduce((sum, value) => sum + (value?.length || 0), 0); }
async function list(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const records = [];
  for (const entry of await readdir(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try { records.push(publicMeta(await metadata(dataDir, entry.name))); } catch {}
  }
  return records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
async function save(dataDir, id, item, ownerHash, previous = null) {
  const now = new Date().toISOString(), temp = resolve(dataDir, `.tmp-${id}-${randomUUID()}`), final = resolve(dataDir, id), backup = resolve(dataDir, `.backup-${id}-${randomUUID()}`);
  await mkdir(temp, { recursive: true });
  const availableFiles = [], sizes = {};
  try {
    for (const [key, bytes] of Object.entries(item.files)) {
      if (!bytes) continue;
      const [extension] = FILES[key];
      await writeFile(resolve(temp, `${key}.${extension}`), bytes); availableFiles.push(key); sizes[key] = bytes.length;
    }
    const record = { id, familyName: item.familyName, styleName: item.styleName, authorName: item.authorName, description: item.description, license: item.license,
      mode: item.mode, glyphCount: item.glyphCount, sampleText: item.sampleText, featureSettings: item.featureSettings, baseName: item.baseName,
      createdAt: previous?.createdAt || now, updatedAt: now, availableFiles, sizes, totalBytes: Object.values(sizes).reduce((sum, value) => sum + value, 0), ownerHash };
    await writeFile(resolve(temp, 'metadata.json'), `${JSON.stringify(record, null, 2)}\n`);
    const had = await exists(final); if (had) await rename(final, backup);
    try { await rename(temp, final); } catch (error) { if (had && await exists(backup)) await rename(backup, final).catch(() => {}); throw error; }
    if (had) await rm(backup, { recursive: true, force: true });
    return record;
  } catch (error) { await rm(temp, { recursive: true, force: true }).catch(() => {}); throw error; }
}
function validId(id) { if (!/^[a-z0-9][a-z0-9-]{7,100}$/.test(id || '')) throw fail('Некорректный идентификатор публикации.'); return id; }
function headers() {
  return {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  };
}
function authorized(req, ownerHash, adminToken) { const token = bearer(req); return token && (hash(token) === ownerHash || (adminToken && hash(token) === hash(adminToken))); }

export function createDrawYourFontServer(options = {}) {
  const rootDir = resolve(options.rootDir || ROOT), dataDir = resolve(options.dataDir || process.env.DYFR_DATA_DIR || resolve(rootDir, 'data/public-fonts'));
  const adminToken = options.adminToken || process.env.DYFR_ADMIN_TOKEN || '';
  const trustProxy = options.trustProxy ?? process.env.DYFR_TRUST_PROXY === '1';
  const maxPublicBytes = Number(options.maxPublicBytes || process.env.DYFR_MAX_PUBLIC_BYTES || DEFAULT_MAX_PUBLIC_BYTES);
  const maxPublicFonts = Number(options.maxPublicFonts || process.env.DYFR_MAX_PUBLIC_FONTS || DEFAULT_MAX_PUBLIC_FONTS);
  const rate = limiter(trustProxy);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      for (const [key, value] of Object.entries(headers())) res.setHeader(key, value);
      if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, service: 'draw-your-font-public-library' });
      if (url.pathname === API && req.method === 'GET') {
        const records = await list(dataDir), query = text(url.searchParams.get('q'), 100, 'Поиск').toLocaleLowerCase('ru-RU');
        const fonts = query ? records.filter(item => `${item.familyName} ${item.styleName} ${item.authorName} ${item.description}`.toLocaleLowerCase('ru-RU').includes(query)) : records;
        return sendJson(res, 200, { fonts, count: fonts.length });
      }
      if (url.pathname === API && req.method === 'POST') {
        if (!sameOrigin(req)) throw fail('Публикация разрешена только с этого сайта.', 403); rate(req);
        const item = normalize(await readJson(req));
        const usage = await catalogStats(dataDir);
        if (usage.records.length >= maxPublicFonts) throw fail('Общая библиотека достигла лимита количества шрифтов.', 507);
        if (usage.totalBytes + itemBytes(item) > maxPublicBytes) throw fail('На сервере недостаточно места для новой публикации.', 507);
        const id = `${safeName(item.familyName).slice(0, 42)}-${randomUUID().replace(/-/g, '').slice(0, 12)}`, token = randomBytes(32).toString('base64url');
        return sendJson(res, 201, { font: publicMeta(await save(dataDir, id, item, hash(token))), ownerToken: token });
      }
      const match = new RegExp(`^${API}/([^/]+)(?:/files/(ttf|woff|woff2|css|zip))?$`).exec(url.pathname);
      if (match) {
        const id = validId(match[1]), key = match[2] || null;
        if (key && (req.method === 'GET' || req.method === 'HEAD')) {
          const item = await metadata(dataDir, id); if (!item.availableFiles?.includes(key)) throw fail('Файл не найден.', 404);
          const [extension, mime] = FILES[key], path = resolve(dataDir, id, `${key}.${extension}`), info = await stat(path);
          const out = { 'Content-Type': mime, 'Content-Length': info.size, 'Cache-Control': 'public, max-age=3600' };
          if (url.searchParams.get('download') === '1') out['Content-Disposition'] = `attachment; filename="${item.baseName}.${extension}"`;
          res.writeHead(200, out); if (req.method === 'HEAD') return res.end(); return createReadStream(path).pipe(res);
        }
        if (!key && req.method === 'GET') return sendJson(res, 200, { font: publicMeta(await metadata(dataDir, id)) });
        if (!key && req.method === 'PUT') {
          if (!sameOrigin(req)) throw fail('Обновление разрешено только с этого сайта.', 403); rate(req);
          const previous = await metadata(dataDir, id); if (!authorized(req, previous.ownerHash, adminToken)) throw fail('Нет прав на обновление этой публикации.', 403);
          const item = normalize(await readJson(req));
          const usage = await catalogStats(dataDir);
          if (usage.totalBytes - (Number(previous.totalBytes) || 0) + itemBytes(item) > maxPublicBytes) throw fail('На сервере недостаточно места для обновления публикации.', 507);
          return sendJson(res, 200, { font: publicMeta(await save(dataDir, id, item, previous.ownerHash, previous)) });
        }
        if (!key && req.method === 'DELETE') {
          if (!sameOrigin(req)) throw fail('Удаление разрешено только с этого сайта.', 403); rate(req);
          const item = await metadata(dataDir, id); if (!authorized(req, item.ownerHash, adminToken)) throw fail('Нет прав на удаление этой публикации.', 403);
          await rm(resolve(dataDir, id), { recursive: true, force: true }); res.writeHead(204); return res.end();
        }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail('Метод не поддерживается.', 405);
      let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { throw fail('Некорректный адрес.'); }
      if (pathname === '/') pathname = '/index.html';
      const hasPrivateSegment = pathname.split('/').some(segment => segment.startsWith('.') && segment.length > 1);
      if (pathname.includes('\0') || hasPrivateSegment || PRIVATE_FILES.has(pathname) || PRIVATE_PREFIXES.some(prefix => pathname.startsWith(prefix))) throw fail('Файл не найден.', 404);
      const file = resolve(rootDir, `.${pathname}`), rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
      if (file !== rootDir && !file.startsWith(rootPrefix)) throw fail('Файл не найден.', 404);
      const info = await stat(file).catch(() => null); if (!info?.isFile()) throw fail('Файл не найден.', 404);
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': /\.(html|js|mjs|css)$/i.test(file) ? 'no-cache' : 'public, max-age=3600' });
      if (req.method === 'HEAD') return res.end(); createReadStream(file).pipe(res);
    } catch (error) { if (!res.headersSent) sendError(res, error); else res.destroy(error); }
  });
  server.dyfr = { rootDir, dataDir };
  return server;
}

async function start() {
  const options = args(process.argv.slice(2)), port = Number(options.port || process.env.PORT || 8000), host = options.host || process.env.HOST || '0.0.0.0';
  const server = createDrawYourFontServer(options); await mkdir(server.dyfr.dataDir, { recursive: true });
  server.listen(port, host, () => { console.log(`Draw Your Font RU: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`); console.log(`Public library data: ${server.dyfr.dataDir}`); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) start().catch(error => { console.error(error); process.exitCode = 1; });
