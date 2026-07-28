const DB_NAME = 'draw-your-font-library';
const DB_VERSION = 1;
const STORE_NAME = 'fonts';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Ошибка IndexedDB.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Операция с библиотекой отменена.'));
    transaction.onerror = () => reject(transaction.error || new Error('Ошибка записи в библиотеку.'));
  });
}

export function makeLibraryId({ projectId = 'project', familyName = 'font', styleName = 'Regular', mode = 'standard' } = {}) {
  const clean = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_.-]+/gu, '').slice(0, 80) || 'font';
  return `${clean(projectId)}::${clean(familyName)}::${clean(styleName)}::${clean(mode)}`;
}

export function copyArrayBuffer(value) {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  throw new TypeError('Файл шрифта должен быть ArrayBuffer или TypedArray.');
}

async function fileToArrayBuffer(value) {
  if (value == null) return null;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.arrayBuffer();
  return copyArrayBuffer(value);
}

export function formatLibraryBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} КБ`;
  return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
}

export async function normalizeLibraryRecord(input = {}) {
  const now = new Date().toISOString();
  const familyName = String(input.familyName || 'Мой рукописный шрифт').trim() || 'Мой рукописный шрифт';
  const styleName = String(input.styleName || 'Regular').trim() || 'Regular';
  const mode = input.mode === 'connected' ? 'connected' : 'standard';
  const projectId = String(input.projectId || 'project');
  const files = {
    ttf: await fileToArrayBuffer(input.files?.ttf),
    woff: await fileToArrayBuffer(input.files?.woff),
    woff2: await fileToArrayBuffer(input.files?.woff2),
    zip: await fileToArrayBuffer(input.files?.zip),
    css: String(input.files?.css || ''),
  };
  if (!files.ttf && !files.woff2) throw new Error('Для библиотеки нужен готовый TTF или WOFF2.');
  const sizes = {
    ttf: files.ttf?.byteLength || 0,
    woff: files.woff?.byteLength || 0,
    woff2: files.woff2?.byteLength || 0,
    zip: files.zip?.byteLength || 0,
    css: new TextEncoder().encode(files.css).byteLength,
  };
  return {
    id: input.id || makeLibraryId({ projectId, familyName, styleName, mode }),
    projectId,
    familyName,
    styleName,
    baseName: String(input.baseName || 'my-handwriting'),
    mode,
    glyphCount: Math.max(0, Math.round(Number(input.glyphCount) || 0)),
    sampleText: String(input.sampleText || 'Съешь же ещё этих мягких французских булок, да выпей чаю.'),
    featureSettings: String(input.featureSettings || (mode === 'connected' ? '"rlig" 1, "calt" 1, "curs" 1' : 'normal')),
    projectJson: String(input.projectJson || ''),
    createdAt: input.createdAt || now,
    updatedAt: now,
    files,
    sizes,
    totalBytes: Object.values(sizes).reduce((sum, size) => sum + size, 0),
  };
}

export function openFontLibrary() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Этот браузер не поддерживает IndexedDB.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!store.indexNames.contains('updatedAt')) store.createIndex('updatedAt', 'updatedAt');
      if (!store.indexNames.contains('familyName')) store.createIndex('familyName', 'familyName');
      if (!store.indexNames.contains('mode')) store.createIndex('mode', 'mode');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть библиотеку шрифтов.'));
    request.onblocked = () => reject(new Error('Библиотека заблокирована другой открытой вкладкой.'));
  });
}

async function withStore(mode, operation) {
  const database = await openFontLibrary();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const completed = transactionDone(transaction);
    const store = transaction.objectStore(STORE_NAME);
    try {
      const result = await operation(store, transaction);
      await completed;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch {}
      try { await completed; } catch {}
      throw error;
    }
  } finally {
    database.close();
  }
}

export async function saveLibraryFont(input) {
  const normalized = await normalizeLibraryRecord(input);
  return withStore('readwrite', async store => {
    const previous = await requestToPromise(store.get(normalized.id));
    if (previous?.createdAt) normalized.createdAt = previous.createdAt;
    await requestToPromise(store.put(normalized));
    return normalized;
  });
}

export async function listLibraryFonts() {
  return withStore('readonly', async store => {
    const items = await requestToPromise(store.getAll());
    return items.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt), 'ru'));
  });
}

export async function getLibraryFont(id) {
  return withStore('readonly', store => requestToPromise(store.get(id)));
}

export async function deleteLibraryFont(id) {
  return withStore('readwrite', store => requestToPromise(store.delete(id)));
}

export async function clearFontLibrary() {
  return withStore('readwrite', store => requestToPromise(store.clear()));
}

export async function getFontLibraryStats() {
  const fonts = await listLibraryFonts();
  const storage = globalThis.navigator?.storage;
  let quota = null;
  let usage = null;
  let persistent = false;
  try {
    const estimate = await storage?.estimate?.();
    quota = estimate?.quota ?? null;
    usage = estimate?.usage ?? null;
    persistent = Boolean(await storage?.persisted?.());
  } catch {}
  return {
    count: fonts.length,
    libraryBytes: fonts.reduce((sum, item) => sum + (Number(item.totalBytes) || 0), 0),
    quota,
    usage,
    persistent,
  };
}

export async function requestPersistentLibraryStorage() {
  try { return Boolean(await globalThis.navigator?.storage?.persist?.()); } catch { return false; }
}
