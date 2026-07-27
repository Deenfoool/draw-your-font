const LOCAL_MODULE_URL = './vendor/woff2-codec.mjs';
const LOCAL_WASM_URL = './vendor/woff2.wasm';
let modulePromise = null;
let initPromise = null;
let selectedSource = null;

async function loadModule() {
  if (modulePromise) return modulePromise;
  modulePromise = import(LOCAL_MODULE_URL)
    .then((mod) => {
      if (typeof mod.createFont !== 'function' || !mod.woff2) throw new Error('Локальный WOFF2-модуль имеет неверный формат.');
      selectedSource = LOCAL_MODULE_URL;
      return mod;
    })
    .catch((error) => {
      modulePromise = null;
      throw new Error(`Локальный WOFF2-кодек не найден: ${error.message}. Выполните npm run build:runtime.`);
    });
  return modulePromise;
}

export async function initializeWoff2(onProgress) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    onProgress?.('Инициализирую локальный WOFF2-кодек…');
    const mod = await loadModule();
    if (!mod.woff2.isInited?.()) await mod.woff2.init(LOCAL_WASM_URL);
    if (!mod.woff2.isInited?.()) throw new Error('WOFF2-кодек не инициализировался.');
    return mod;
  })().catch((error) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

export async function encodeWoff2(ttfBytes, onProgress) {
  const mod = await initializeWoff2(onProgress);
  onProgress?.('Сжимаю WOFF2…');
  const input = ttfBytes.buffer.slice(ttfBytes.byteOffset, ttfBytes.byteOffset + ttfBytes.byteLength);
  const font = mod.createFont(input, { type: 'ttf' });
  const output = font.write({ type: 'woff2' });
  const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'wOF2') throw new Error('WOFF2-кодек вернул некорректный файл.');
  return bytes;
}

export function getWoff2DependencyInfo() {
  return {
    localModuleUrl: LOCAL_MODULE_URL,
    localWasmUrl: LOCAL_WASM_URL,
    selectedSource,
    runtimeAutonomous: selectedSource === LOCAL_MODULE_URL,
  };
}
