import {
  computeHomography,
  decodeRectifiedMetadata,
  resolveTemplatePlan,
  scanTemplatePage,
  warpGrayscale,
} from './template-scanner.js';
import { extractTemplateGlyphsV2 } from './recognition-engine.js';
import { A4_MM } from './template.js';

const HEIC_MODULE_URL = new URL('../vendor/heic-codec.mjs', import.meta.url).href;
const MAX_IMAGE_DIMENSION = 3200;
const MAX_IMAGE_PIXELS = 12_000_000;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function percentile(values, fraction) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  const target = Math.max(0, Math.min(values.length - 1, Math.floor(values.length * fraction)));
  let total = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    total += histogram[value];
    if (total > target) return value;
  }
  return 255;
}

export function normalizeGray(gray) {
  const low = percentile(gray, 0.015);
  const high = percentile(gray, 0.985);
  if (high - low < 12) return new Uint8Array(gray);
  const scale = 255 / (high - low);
  return Uint8Array.from(gray, value => clamp(Math.round((value - low) * scale), 0, 255));
}

export function strengthenDarkDetails(gray, width, height) {
  const normalized = normalizeGray(gray);
  const output = new Uint8Array(normalized.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minimum = 255;
      for (let dy = -1; dy <= 1; dy += 1) {
        const py = clamp(y + dy, 0, height - 1);
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = clamp(x + dx, 0, width - 1);
          minimum = Math.min(minimum, normalized[py * width + px]);
        }
      }
      output[y * width + x] = minimum;
    }
  }
  return output;
}

async function decodeWithImageBitmap(blob) {
  if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap недоступен.');
  const attempts = [
    () => createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none' }),
    () => createImageBitmap(blob, { imageOrientation: 'from-image' }),
    () => createImageBitmap(blob),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const bitmap = await attempt();
      if (bitmap.width > 0 && bitmap.height > 0) return bitmap;
      bitmap.close?.();
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Браузер не смог открыть изображение.');
}

async function decodeWithImageElement(blob) {
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('HTML-декодер недоступен.');
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Элемент Image не смог открыть файл.'));
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Изображение имеет нулевой размер.');
    return image;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

async function decodeWithWebCodecs(blob) {
  if (typeof ImageDecoder !== 'function') throw new Error('WebCodecs ImageDecoder недоступен.');
  const type = blob.type || 'image/jpeg';
  if (typeof ImageDecoder.isTypeSupported === 'function' && !(await ImageDecoder.isTypeSupported(type))) throw new Error(`WebCodecs не поддерживает ${type}.`);
  const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type });
  try {
    const { image } = await decoder.decode({ frameIndex: 0, completeFramesOnly: true });
    if (!image.displayWidth || !image.displayHeight) { image.close?.(); throw new Error('WebCodecs вернул пустой кадр.'); }
    return image;
  } finally { decoder.close?.(); }
}

async function decodeHeic(blob) {
  const module = await import(HEIC_MODULE_URL);
  const isHeic = module.isHeic || module.default?.isHeic;
  const heicTo = module.heicTo || module.default?.heicTo || module.default;
  if (typeof heicTo !== 'function') throw new Error('Локальный HEIC-декодер имеет неверный формат.');
  if (typeof isHeic === 'function' && !(await isHeic(blob))) throw new Error('Файл не распознан как HEIC/HEIF.');
  const bitmap = await heicTo({ blob, type: 'bitmap', options: { imageOrientation: 'from-image' } });
  if (!bitmap?.width || !bitmap?.height) throw new Error('HEIC-декодер вернул пустое изображение.');
  return bitmap;
}

function isProbablyHeic(file) {
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/i.test(name);
}

export async function decodeImageFile(file) {
  if (!(file instanceof Blob)) throw new Error('Передан не файл изображения.');
  if (!file.size) throw new Error('Файл пустой.');
  const errors = [];
  const decoders = isProbablyHeic(file)
    ? [decodeHeic, decodeWithImageBitmap, decodeWithImageElement, decodeWithWebCodecs]
    : [decodeWithImageBitmap, decodeWithImageElement, decodeWithWebCodecs, decodeHeic];
  for (const decoder of decoders) {
    try { return { source: await decoder(file), decoder: decoder.name }; }
    catch (error) { errors.push(`${decoder.name}: ${error?.message || error}`); }
  }
  throw new Error(`Изображение «${file.name || 'без имени'}» не удалось декодировать. ${errors.join(' | ')}`);
}

export function imageSourceToGray(source, options = {}) {
  if (typeof document === 'undefined') throw new Error('Canvas недоступен.');
  const sourceWidth = Number(source.displayWidth || source.naturalWidth || source.videoWidth || source.width || 0);
  const sourceHeight = Number(source.displayHeight || source.naturalHeight || source.videoHeight || source.height || 0);
  if (!sourceWidth || !sourceHeight) throw new Error('Не удалось определить размер изображения.');
  const maxDimension = Number(options.maxDimension || MAX_IMAGE_DIMENSION);
  const maxPixels = Number(options.maxPixels || MAX_IMAGE_PIXELS);
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight), Math.sqrt(maxPixels / (sourceWidth * sourceHeight)));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Не удалось создать 2D canvas.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(source, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) gray[index] = Math.round(rgba[pixel] * 0.299 + rgba[pixel + 1] * 0.587 + rgba[pixel + 2] * 0.114);
  source.close?.();
  return { gray, width, height, canvas, scale, sourceWidth, sourceHeight };
}

export async function decodeFileToGray(file, options = {}) {
  const decoded = await decodeImageFile(file);
  return { ...imageSourceToGray(decoded.source, options), decoder: decoded.decoder, file };
}

function enhanceScanResult(result, options = {}) {
  const glyphs = extractTemplateGlyphsV2(result.rectified, result.page, options);
  const confidence = glyphs.length ? Math.round(glyphs.reduce((sum, glyph) => sum + glyph.quality.confidence, 0) / glyphs.length) : 0;
  return {
    ...result,
    glyphs,
    recognition: {
      version: 2,
      confidence,
      high: glyphs.filter(glyph => glyph.quality.confidence >= 80).length,
      medium: glyphs.filter(glyph => glyph.quality.confidence >= 55 && glyph.quality.confidence < 80).length,
      low: glyphs.filter(glyph => glyph.quality.confidence < 55).length,
    },
  };
}

export function scanTemplateWithRetries(gray, width, height, options = {}) {
  const variants = [
    { name: 'original', gray },
    { name: 'normalized', gray: normalizeGray(gray) },
    { name: 'strengthened', gray: strengthenDarkDetails(gray, width, height) },
  ];
  const outputWidths = [...new Set([Number(options.outputWidth || 1260), 1680, 1050])];
  const failures = [];
  for (const variant of variants) {
    for (const outputWidth of outputWidths) {
      try {
        const scanned = scanTemplatePage(variant.gray, width, height, { ...options, outputWidth });
        const result = enhanceScanResult(scanned, options);
        return { ...result, recovery: { variant: variant.name, outputWidth, automatic: true } };
      } catch (error) { failures.push(`${variant.name}/${outputWidth}: ${error.message}`); }
    }
  }
  const error = new Error(`Автоматическое распознавание не удалось. ${failures.join(' | ')}`);
  error.code = 'AUTO_SCAN_FAILED';
  error.failures = failures;
  throw error;
}

function rotateCorners(corners, rotation) {
  const amount = ((rotation % 4) + 4) % 4;
  return corners.map((_, index) => corners[(index + amount) % 4]);
}

export function rectifyFromOuterCorners(gray, width, height, corners, outputWidth = 1260, rotation = 0) {
  if (!Array.isArray(corners) || corners.length !== 4) throw new Error('Нужно указать четыре угла листа.');
  const outputHeight = Math.round(outputWidth * A4_MM.height / A4_MM.width);
  const destination = [
    { x: 0, y: 0 }, { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 }, { x: 0, y: outputHeight - 1 },
  ];
  const source = rotateCorners(corners, rotation);
  const homography = computeHomography(destination, source);
  return { gray: warpGrayscale(gray, width, height, homography, outputWidth, outputHeight), width: outputWidth, height: outputHeight, homography, markers: [] };
}

export function scanTemplateFromManualCorners(gray, width, height, corners, options = {}) {
  const rotations = options.rotation === 'auto' || options.rotation == null ? [0, 1, 2, 3] : [Number(options.rotation) || 0];
  const attempts = [];
  for (const rotation of rotations) {
    const rectified = rectifyFromOuterCorners(gray, width, height, corners, Number(options.outputWidth || 1260), rotation);
    const metadata = decodeRectifiedMetadata(rectified.gray, rectified.width, rectified.height);
    attempts.push({ rotation, rectified, metadata });
    if (metadata.valid) {
      const plan = resolveTemplatePlan(metadata, options.activePlan || null);
      const page = plan.pages[metadata.pageIndex];
      if (!page) continue;
      return enhanceScanResult({ rectified, metadata, plan, page, confidence: 0.5, recovery: { automatic: false, manualCorners: true, rotation } }, options);
    }
  }
  const activePlan = options.activePlan;
  const pageIndex = Number(options.pageIndex);
  if (!activePlan || !Number.isInteger(pageIndex) || !activePlan.pages?.[pageIndex]) {
    const messages = attempts.map(attempt => attempt.metadata.error).filter(Boolean);
    throw new Error(`Машинный код страницы не прочитан. Выберите номер страницы вручную. ${messages.join(' ')}`);
  }
  const rotation = rotations[0] || 0;
  const rectified = rectifyFromOuterCorners(gray, width, height, corners, Number(options.outputWidth || 1260), rotation);
  const page = activePlan.pages[pageIndex];
  const metadata = { valid: false, recoveredManually: true, pageIndex, pageCount: activePlan.pageCount, totalChars: activePlan.characters.length, layoutId: activePlan.layout.id, charsetId: activePlan.charsetId };
  return enhanceScanResult({ rectified, metadata, plan: activePlan, page, confidence: 0.25, recovery: { automatic: false, manualCorners: true, rotation, manualPage: true } }, options);
}

export function getRecoveryDependencyInfo() {
  return { heicModuleUrl: HEIC_MODULE_URL, recognitionVersion: 2 };
}
