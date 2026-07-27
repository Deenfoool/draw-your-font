const MODULE_URLS = [
  'https://cdn.jsdelivr.net/npm/fonteditor-core@2.6.3/+esm',
  'https://esm.sh/fonteditor-core@2.6.3',
];
const WASM_URL = 'https://cdn.jsdelivr.net/npm/fonteditor-core@2.6.3/woff2/woff2.wasm';
let modulePromise = null;
let initPromise = null;

async function loadModule() {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    let lastError = null;
    for (const url of MODULE_URLS) {
      try {
        const mod = await import(url);
        if (typeof mod.createFont === 'function' && mod.woff2) return mod;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Не удалось загрузить браузерный кодек WOFF2${lastError ? `: ${lastError.message}` : ''}`);
  })();
  return modulePromise;
}

export async function initializeWoff2(onProgress) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    onProgress?.('Загружаю WOFF2-кодек…');
    const mod = await loadModule();
    if (!mod.woff2.isInited?.()) await mod.woff2.init(WASM_URL);
    if (!mod.woff2.isInited?.()) throw new Error('WOFF2-кодек не инициализировался.');
    return mod;
  })();
  return initPromise;
}

export async function encodeWoff2(ttfBytes, onProgress) {
  const mod = await initializeWoff2(onProgress);
  onProgress?.('Сжимаю WOFF2…');
  const input = ttfBytes.buffer.slice(ttfBytes.byteOffset, ttfBytes.byteOffset + ttfBytes.byteLength);
  const font = mod.createFont(input, { type: 'ttf' });
  const output = font.write({ type: 'woff2' });
  const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  const signature = String.fromCharCode(...bytes.slice(0, 4));
  if (signature !== 'wOF2') throw new Error('WOFF2-кодек вернул некорректный файл.');
  return bytes;
}

export function getWoff2DependencyInfo() {
  return { moduleUrls: [...MODULE_URLS], wasmUrl: WASM_URL };
}
