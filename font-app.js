import {
  createGlyphSet,
  buildTrueTypeFont,
  buildWoffFont,
  buildFontCss,
  buildStoredZip,
  validateTrueType,
} from './src/font-builder.js';
import { encodeWoff2, getWoff2DependencyInfo } from './src/woff2-loader.js';

const elements = {
  card: document.querySelector('#fontBuilder'),
  family: document.querySelector('#fontFamily'),
  style: document.querySelector('#fontStyle'),
  detail: document.querySelector('#fontDetail'),
  detailValue: document.querySelector('#fontDetailValue'),
  simplify: document.querySelector('#fontSimplify'),
  simplifyValue: document.querySelector('#fontSimplifyValue'),
  sideBearing: document.querySelector('#fontSideBearing'),
  sideBearingValue: document.querySelector('#fontSideBearingValue'),
  height: document.querySelector('#fontGlyphHeight'),
  heightValue: document.querySelector('#fontGlyphHeightValue'),
  build: document.querySelector('#fontBuild'),
  status: document.querySelector('#fontStatus'),
  progress: document.querySelector('#fontProgress'),
  sourceStats: document.querySelector('#fontSourceStats'),
  outputStats: document.querySelector('#fontOutputStats'),
  previewInput: document.querySelector('#fontPreviewInput'),
  preview: document.querySelector('#fontPreview'),
  css: document.querySelector('#fontCss'),
  downloadTtf: document.querySelector('#downloadTtf'),
  downloadWoff: document.querySelector('#downloadWoff'),
  downloadWoff2: document.querySelector('#downloadWoff2'),
  downloadCss: document.querySelector('#downloadCss'),
  downloadZip: document.querySelector('#downloadFontZip'),
};

const state = {
  building: false,
  outputs: null,
  previewFace: null,
  buildNumber: 0,
};

function setStatus(message, mode = 'idle') {
  elements.status.textContent = message;
  elements.status.dataset.mode = mode;
}

function safeBaseName(value) {
  return String(value || 'my-handwriting')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'my-handwriting';
}

function getSource() {
  return window.__drawYourFontSegmentation?.getFontSource?.() || null;
}

function sourceSummary() {
  const source = getSource();
  if (!source) return { source: null, labeled: 0, duplicates: [], empty: 0 };
  const labels = source.labels.map((label) => [...String(label || '')][0] || '');
  const counts = new Map();
  labels.filter(Boolean).forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([label]) => label);
  return { source, labeled: labels.filter(Boolean).length, duplicates, empty: labels.filter((label) => !label).length };
}

function refreshReadiness() {
  const summary = sourceSummary();
  const ready = summary.source && summary.labeled > 0 && !state.building;
  elements.build.disabled = !ready;
  if (!summary.source) {
    elements.sourceStats.innerHTML = '<strong>Нет разметки</strong><span>Загрузите фото, найдите буквы и проверьте подписи.</span>';
    if (!state.building) setStatus('Ожидание готовой разметки первого этапа.', 'idle');
    return;
  }
  const duplicateText = summary.duplicates.length ? ` · повторяются: ${summary.duplicates.join(' ')}` : '';
  elements.sourceStats.innerHTML = `<strong>${summary.labeled}</strong> подписанных символов · <strong>${summary.empty}</strong> без подписи${duplicateText}`;
  if (!state.building && !state.outputs) setStatus('Разметка готова. Можно собрать шрифт.', summary.labeled ? 'ok' : 'error');
}

function setBuilding(value) {
  state.building = value;
  elements.progress.hidden = !value;
  elements.build.disabled = value || !getSource();
  refreshReadiness();
}

function clearOutputs() {
  state.outputs = null;
  elements.outputStats.textContent = 'Шрифт ещё не собран.';
  elements.css.value = '';
  [elements.downloadTtf, elements.downloadWoff, elements.downloadWoff2, elements.downloadCss, elements.downloadZip]
    .forEach((button) => { button.disabled = true; });
}

async function installPreview(ttfBytes, familyName) {
  if (state.previewFace) {
    try { document.fonts.delete(state.previewFace); } catch {}
    state.previewFace = null;
  }
  const previewFamily = `DYFR Preview ${state.buildNumber}`;
  const buffer = ttfBytes.buffer.slice(ttfBytes.byteOffset, ttfBytes.byteOffset + ttfBytes.byteLength);
  const face = new FontFace(previewFamily, buffer);
  await face.load();
  document.fonts.add(face);
  state.previewFace = face;
  elements.preview.style.fontFamily = `'${previewFamily}', sans-serif`;
  elements.preview.dataset.family = familyName;
}

function updatePreviewText() {
  elements.preview.textContent = elements.previewInput.value || 'Съешь же ещё этих мягких французских булок, да выпей чаю. Ёжик, цифры 0123456789.';
}

function downloadBytes(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindDownload(button, key, extension, mime) {
  button.addEventListener('click', () => {
    if (!state.outputs?.[key]) return;
    downloadBytes(state.outputs[key], `${state.outputs.baseName}.${extension}`, mime);
  });
}

async function buildFont() {
  if (state.building) return null;
  const source = getSource();
  if (!source) { setStatus('Сначала завершите разметку символов.', 'error'); return null; }
  clearOutputs();
  setBuilding(true);
  state.buildNumber += 1;
  elements.progress.value = 0;
  elements.progress.max = 6;

  try {
    const familyName = elements.family.value.trim() || 'Мой рукописный шрифт';
    const styleName = elements.style.value.trim() || 'Regular';
    const baseName = safeBaseName(familyName);
    setStatus('Векторизую рукописные символы…', 'busy');
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const glyphSet = createGlyphSet(source, {
      detail: Number(elements.detail.value),
      simplify: Number(elements.simplify.value),
      sideBearing: Number(elements.sideBearing.value),
      glyphHeight: Number(elements.height.value),
    });
    elements.progress.value = 1;
    if (!glyphSet.entries.length) throw new Error('Не осталось ни одного уникального подписанного символа.');

    setStatus('Собираю таблицы TrueType…', 'busy');
    const ttf = buildTrueTypeFont(glyphSet.glyphs, { familyName, styleName, version: '1.000' });
    const ttfErrors = validateTrueType(ttf);
    if (ttfErrors.length) throw new Error(ttfErrors.join(' '));
    elements.progress.value = 2;

    setStatus('Создаю WOFF…', 'busy');
    const woff = await buildWoffFont(ttf);
    if (String.fromCharCode(...woff.slice(0, 4)) !== 'wOFF') throw new Error('Внутренняя проверка WOFF не пройдена.');
    elements.progress.value = 3;

    const woff2 = await encodeWoff2(ttf, (message) => setStatus(message, 'busy'));
    elements.progress.value = 4;

    const css = buildFontCss(familyName, baseName);
    const readme = `Шрифт: ${familyName} ${styleName}\nСимволов: ${glyphSet.entries.length}\nФорматы: TTF, WOFF, WOFF2\n\nПодключение: добавьте font.css рядом с файлами шрифта.\n`;
    const zip = buildStoredZip([
      { name: `${baseName}.ttf`, data: ttf },
      { name: `${baseName}.woff`, data: woff },
      { name: `${baseName}.woff2`, data: woff2 },
      { name: 'font.css', data: css },
      { name: 'README.txt', data: readme },
    ]);
    elements.progress.value = 5;

    await installPreview(ttf, familyName);
    updatePreviewText();
    elements.progress.value = 6;

    state.outputs = { ttf, woff, woff2, css, zip, baseName, familyName, styleName, glyphSet };
    elements.css.value = css;
    const contourCount = glyphSet.glyphs.reduce((sum, glyph) => sum + glyph.contours.length, 0);
    const pointCount = glyphSet.glyphs.reduce((sum, glyph) => sum + glyph.contours.reduce((subtotal, contour) => subtotal + contour.length, 0), 0);
    const duplicateNote = glyphSet.duplicates.length ? ` · пропущены повторы: ${glyphSet.duplicates.join(' ')}` : '';
    elements.outputStats.innerHTML = `<strong>${glyphSet.entries.length}</strong> символов · <strong>${contourCount}</strong> контуров · <strong>${pointCount}</strong> точек · TTF ${(ttf.length / 1024).toFixed(1)} КБ · WOFF2 ${(woff2.length / 1024).toFixed(1)} КБ${duplicateNote}`;
    [elements.downloadTtf, elements.downloadWoff, elements.downloadWoff2, elements.downloadCss, elements.downloadZip]
      .forEach((button) => { button.disabled = false; });
    setStatus('Шрифт собран, проверен и готов к скачиванию.', 'ok');
    return state.outputs;
  } catch (error) {
    console.error(error);
    const info = getWoff2DependencyInfo();
    const suffix = /woff2|кодек|fetch|import/i.test(error.message || '') ? ` Проверьте доступ к ${new URL(info.wasmUrl).hostname}.` : '';
    setStatus(`${error.message || 'Не удалось собрать шрифт.'}${suffix}`, 'error');
    return null;
  } finally {
    setBuilding(false);
  }
}

for (const [input, output] of [
  [elements.detail, elements.detailValue],
  [elements.simplify, elements.simplifyValue],
  [elements.sideBearing, elements.sideBearingValue],
  [elements.height, elements.heightValue],
]) {
  input.addEventListener('input', () => { output.value = input.value; clearOutputs(); refreshReadiness(); });
}

elements.family.addEventListener('input', () => { clearOutputs(); refreshReadiness(); });
elements.style.addEventListener('input', () => { clearOutputs(); refreshReadiness(); });
elements.previewInput.addEventListener('input', updatePreviewText);
elements.build.addEventListener('click', buildFont);
bindDownload(elements.downloadTtf, 'ttf', 'ttf', 'font/ttf');
bindDownload(elements.downloadWoff, 'woff', 'woff', 'font/woff');
bindDownload(elements.downloadWoff2, 'woff2', 'woff2', 'font/woff2');
elements.downloadCss.addEventListener('click', () => state.outputs && downloadBytes(state.outputs.css, 'font.css', 'text/css;charset=utf-8'));
elements.downloadZip.addEventListener('click', () => state.outputs && downloadBytes(state.outputs.zip, `${state.outputs.baseName}-font-package.zip`, 'application/zip'));
window.addEventListener('drawyourfont:segmentation-updated', () => { clearOutputs(); refreshReadiness(); });

window.__drawYourFontBuilder = {
  buildFont,
  getState: () => ({ building: state.building, outputs: state.outputs, source: sourceSummary() }),
};

updatePreviewText();
clearOutputs();
refreshReadiness();
