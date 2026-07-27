import {
  rgbaToGrayscale,
  segmentGrayscale,
  mergeBoxes,
  removeBoxes,
  splitBoxAtX,
  SEGMENTATION_DEFAULTS,
} from './src/segmentation.js';

const RU_UPPER = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
const RU_LOWER = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const DIGITS_AND_PUNCTUATION = '0123456789.,;:!?«»()-—';
const CHARSETS = {
  'ru-full': [...RU_UPPER, ...RU_LOWER, ...DIGITS_AND_PUNCTUATION],
  'ru-upper': [...RU_UPPER],
  'ru-lower': [...RU_LOWER],
};

const MAX_IMAGE_SIDE = 2200;

const elements = {
  fileInput: document.querySelector('#fileInput'),
  dropzone: document.querySelector('#dropzone'),
  fileMeta: document.querySelector('#fileMeta'),
  processButton: document.querySelector('#processButton'),
  resetSettings: document.querySelector('#resetSettings'),
  imageCanvas: document.querySelector('#imageCanvas'),
  emptyState: document.querySelector('#emptyState'),
  statusText: document.querySelector('#statusText'),
  statusDot: document.querySelector('#statusDot'),
  stats: document.querySelector('#stats'),
  glyphGrid: document.querySelector('#glyphGrid'),
  selectionInfo: document.querySelector('#selectionInfo'),
  mergeSelected: document.querySelector('#mergeSelected'),
  splitSelected: document.querySelector('#splitSelected'),
  removeSelected: document.querySelector('#removeSelected'),
  restoreDetection: document.querySelector('#restoreDetection'),
  exportManifest: document.querySelector('#exportManifest'),
  charsetSelect: document.querySelector('#charsetSelect'),
  customCharset: document.querySelector('#customCharset'),
  assignLabels: document.querySelector('#assignLabels'),
  viewTabs: [...document.querySelectorAll('[data-view]')],
  thresholdDelta: document.querySelector('#thresholdDelta'),
  absoluteCap: document.querySelector('#absoluteCap'),
  backgroundRadius: document.querySelector('#backgroundRadius'),
  minArea: document.querySelector('#minArea'),
  mergeStrength: document.querySelector('#mergeStrength'),
  closeMask: document.querySelector('#closeMask'),
};

const ctx = elements.imageCanvas.getContext('2d', { willReadFrequently: true });
const state = {
  fileName: '',
  sourceImageData: null,
  grayscale: null,
  analysis: null,
  originalGlyphs: [],
  glyphs: [],
  selectedIds: new Set(),
  labels: [],
  view: 'overlay',
  busy: false,
  pendingSplitId: null,
};

const sliderBindings = [
  ['thresholdDelta', 'thresholdDeltaValue'],
  ['absoluteCap', 'absoluteCapValue'],
  ['backgroundRadius', 'backgroundRadiusValue'],
  ['minArea', 'minAreaValue'],
  ['mergeStrength', 'mergeStrengthValue'],
];

for (const [inputId, outputId] of sliderBindings) {
  const input = document.querySelector(`#${inputId}`);
  const output = document.querySelector(`#${outputId}`);
  input.addEventListener('input', () => { output.value = input.value; });
}

function setStatus(message, mode = 'idle') {
  elements.statusText.textContent = message;
  elements.statusDot.className = `status-dot${mode === 'idle' ? '' : ` ${mode}`}`;
}

function setBusy(busy) {
  state.busy = busy;
  elements.processButton.disabled = busy || !state.sourceImageData;
  if (busy) setStatus('Обработка изображения…', 'busy');
}

function currentOptions() {
  return {
    thresholdDelta: Number(elements.thresholdDelta.value),
    absoluteCap: Number(elements.absoluteCap.value),
    backgroundRadius: Number(elements.backgroundRadius.value),
    minArea: Number(elements.minArea.value),
    mergeStrength: Number(elements.mergeStrength.value),
    closeIterations: elements.closeMask.checked ? 1 : 0,
    openIterations: 0,
  };
}

function resetControls() {
  elements.thresholdDelta.value = SEGMENTATION_DEFAULTS.thresholdDelta;
  elements.absoluteCap.value = SEGMENTATION_DEFAULTS.absoluteCap;
  elements.backgroundRadius.value = SEGMENTATION_DEFAULTS.backgroundRadius;
  elements.minArea.value = SEGMENTATION_DEFAULTS.minArea;
  elements.mergeStrength.value = SEGMENTATION_DEFAULTS.mergeStrength;
  elements.closeMask.checked = true;
  sliderBindings.forEach(([inputId, outputId]) => {
    document.querySelector(`#${outputId}`).value = document.querySelector(`#${inputId}`).value;
  });
}

function getCharset() {
  if (elements.charsetSelect.value === 'custom') return [...elements.customCharset.value.replace(/\s/g, '')];
  return CHARSETS[elements.charsetSelect.value] || [];
}

function assignLabelsFromCharset() {
  const charset = getCharset();
  state.labels = state.glyphs.map((_, index) => charset[index] || '');
  renderGlyphGrid();
  const difference = state.glyphs.length - charset.length;
  if (difference === 0) setStatus(`Количество рамок совпало с набором: ${charset.length}.`, 'ok');
  else if (difference > 0) setStatus(`Найдено на ${difference} рамок больше, чем символов в наборе. Проверьте лишние фрагменты.`, 'error');
  else setStatus(`Не хватает ${Math.abs(difference)} рамок. Проверьте пропущенные или объединённые буквы.`, 'error');
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return createImageBitmap(file);
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Браузер не смог открыть изображение.'));
    };
    image.src = url;
  });
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    setStatus('Выберите файл изображения.', 'error');
    return;
  }

  setStatus('Открываю фотографию…', 'busy');
  try {
    const bitmap = await decodeImage(file);
    const sourceWidth = bitmap.width || bitmap.naturalWidth;
    const sourceHeight = bitmap.height || bitmap.naturalHeight;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    elements.imageCanvas.width = width;
    elements.imageCanvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (typeof bitmap.close === 'function') bitmap.close();

    state.sourceImageData = ctx.getImageData(0, 0, width, height);
    state.grayscale = rgbaToGrayscale(state.sourceImageData.data, width, height);
    state.fileName = file.name;
    state.analysis = null;
    state.glyphs = [];
    state.originalGlyphs = [];
    state.labels = [];
    state.selectedIds.clear();
    state.pendingSplitId = null;
    elements.imageCanvas.classList.remove('is-splitting');

    elements.fileMeta.textContent = `${file.name} · ${sourceWidth}×${sourceHeight}${scale < 1 ? ` → ${width}×${height}` : ''}`;
    elements.emptyState.hidden = true;
    elements.processButton.disabled = false;
    elements.assignLabels.disabled = true;
    elements.exportManifest.disabled = true;
    elements.restoreDetection.disabled = true;
    renderStats();
    renderGlyphGrid();
    drawCurrentView();
    setStatus('Фото готово. Нажмите «Найти буквы».', 'ok');
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Не удалось открыть изображение.', 'error');
  }
}

async function processImage() {
  if (!state.grayscale || state.busy) return;
  setBusy(true);
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  try {
    const { width, height } = state.sourceImageData;
    const analysis = segmentGrayscale(state.grayscale, width, height, currentOptions());
    state.analysis = analysis;
    state.originalGlyphs = analysis.glyphs.map((glyph) => ({ ...glyph, sourceIds: [...glyph.sourceIds] }));
    state.glyphs = state.originalGlyphs.map((glyph) => ({ ...glyph, sourceIds: [...glyph.sourceIds] }));
    state.selectedIds.clear();
    state.pendingSplitId = null;
    elements.imageCanvas.classList.remove('is-splitting');
    state.labels = [];
    assignLabelsFromCharset();
    elements.assignLabels.disabled = false;
    elements.exportManifest.disabled = false;
    elements.restoreDetection.disabled = false;
    renderAll();

    if (analysis.stats.glyphCount === 0) {
      setStatus('Буквы не найдены. Уменьшите «Отделение чернил» или увеличьте максимальную яркость.', 'error');
    } else {
      setStatus(`Найдено ${analysis.stats.glyphCount} символов в ${analysis.stats.rowCount} строках.`, 'ok');
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Ошибка обработки изображения.', 'error');
  } finally {
    setBusy(false);
  }
}

function imageDataFromSingleChannel(channel, invert = false) {
  const imageData = ctx.createImageData(elements.imageCanvas.width, elements.imageCanvas.height);
  for (let i = 0, p = 0; i < channel.length; i += 1, p += 4) {
    const value = invert ? (channel[i] ? 0 : 255) : channel[i];
    imageData.data[p] = value;
    imageData.data[p + 1] = value;
    imageData.data[p + 2] = value;
    imageData.data[p + 3] = 255;
  }
  return imageData;
}

function drawBoxes() {
  if (!state.glyphs.length) return;
  const scaleAwareLine = Math.max(2, Math.round(Math.min(elements.imageCanvas.width, elements.imageCanvas.height) / 700));
  ctx.save();
  ctx.lineWidth = scaleAwareLine;
  ctx.font = `${Math.max(14, scaleAwareLine * 7)}px system-ui`;
  ctx.textBaseline = 'top';

  state.glyphs.forEach((glyph, index) => {
    const selected = state.selectedIds.has(glyph.id);
    ctx.strokeStyle = selected ? '#0ea5e9' : '#ef4444';
    ctx.fillStyle = selected ? '#0ea5e9' : '#ef4444';
    ctx.strokeRect(glyph.x0 - 1, glyph.y0 - 1, glyph.width + 2, glyph.height + 2);
    const text = `${index + 1}${state.labels[index] ? ` · ${state.labels[index]}` : ''}`;
    const metrics = ctx.measureText(text);
    const labelY = Math.max(0, glyph.y0 - Math.max(18, scaleAwareLine * 8));
    ctx.fillRect(glyph.x0 - 1, labelY, metrics.width + 8, Math.max(18, scaleAwareLine * 8));
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, glyph.x0 + 3, labelY + 1);
  });
  ctx.restore();
}

function drawCurrentView() {
  if (!state.sourceImageData) return;
  if (state.view === 'original' || !state.analysis) {
    ctx.putImageData(state.sourceImageData, 0, 0);
  } else if (state.view === 'mask') {
    ctx.putImageData(imageDataFromSingleChannel(state.analysis.mask, true), 0, 0);
  } else if (state.view === 'background') {
    ctx.putImageData(imageDataFromSingleChannel(state.analysis.localBackground), 0, 0);
  } else {
    ctx.putImageData(state.sourceImageData, 0, 0);
    drawBoxes();
  }
}

function renderStats() {
  const rowCount = state.glyphs.length ? Math.max(...state.glyphs.map((glyph) => glyph.row)) + 1 : 0;
  elements.stats.innerHTML = `<span><strong>${state.glyphs.length}</strong> символов</span><span><strong>${rowCount}</strong> строк</span>`;
}

function cropGlyphToCanvas(targetCanvas, glyph) {
  if (!state.analysis) return;
  const targetCtx = targetCanvas.getContext('2d');
  const size = 128;
  targetCanvas.width = size;
  targetCanvas.height = size;
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fillRect(0, 0, size, size);

  const pad = 12;
  const scale = Math.min((size - pad * 2) / glyph.width, (size - pad * 2) / glyph.height);
  const offsetX = (size - glyph.width * scale) / 2;
  const offsetY = (size - glyph.height * scale) / 2;
  targetCtx.fillStyle = '#111827';

  const mask = state.analysis.mask;
  const imageWidth = elements.imageCanvas.width;
  for (let y = glyph.y0; y <= glyph.y1; y += 1) {
    for (let x = glyph.x0; x <= glyph.x1; x += 1) {
      if (!mask[y * imageWidth + x]) continue;
      const drawX = Math.floor(offsetX + (x - glyph.x0) * scale);
      const drawY = Math.floor(offsetY + (y - glyph.y0) * scale);
      targetCtx.fillRect(drawX, drawY, Math.max(1, Math.ceil(scale)), Math.max(1, Math.ceil(scale)));
    }
  }
}

function renderGlyphGrid() {
  elements.glyphGrid.replaceChildren();
  if (!state.glyphs.length) {
    const empty = document.createElement('div');
    empty.className = 'results-empty';
    empty.textContent = state.analysis ? 'Символы не найдены. Измените параметры очистки.' : 'После анализа здесь появятся отдельные буквы.';
    elements.glyphGrid.append(empty);
    updateSelectionControls();
    return;
  }

  state.glyphs.forEach((glyph, index) => {
    const card = document.createElement('article');
    card.className = `glyph-card${state.selectedIds.has(glyph.id) ? ' is-selected' : ''}`;
    card.dataset.id = String(glyph.id);

    const number = document.createElement('span');
    number.className = 'glyph-number';
    number.textContent = String(index + 1);

    const preview = document.createElement('canvas');
    cropGlyphToCanvas(preview, glyph);

    const labelInput = document.createElement('input');
    labelInput.className = 'glyph-label';
    labelInput.value = state.labels[index] || '';
    labelInput.maxLength = 2;
    labelInput.placeholder = '—';
    labelInput.setAttribute('aria-label', `Подпись символа ${index + 1}`);
    labelInput.addEventListener('click', (event) => event.stopPropagation());
    labelInput.addEventListener('input', () => {
      state.labels[index] = [...labelInput.value][0] || '';
      if (labelInput.value !== state.labels[index]) labelInput.value = state.labels[index];
      drawCurrentView();
    });

    const meta = document.createElement('div');
    meta.className = 'glyph-meta';
    meta.innerHTML = `<span>строка ${glyph.row + 1}</span><span>${glyph.width}×${glyph.height}</span>`;

    card.append(number, preview, labelInput, meta);
    card.addEventListener('click', () => toggleSelection(glyph.id));
    elements.glyphGrid.append(card);
  });
  updateSelectionControls();
}

function toggleSelection(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  renderGlyphGrid();
  drawCurrentView();
}

function updateSelectionControls() {
  const count = state.selectedIds.size;
  elements.selectionInfo.textContent = count ? `Выбрано: ${count}` : 'Ничего не выбрано';
  elements.mergeSelected.disabled = count < 2;
  elements.splitSelected.disabled = count !== 1;
  elements.removeSelected.disabled = count < 1;
}

function renderAll() {
  renderStats();
  renderGlyphGrid();
  drawCurrentView();
}

function preserveLabelsBySource(previousGlyphs, previousLabels, nextGlyphs) {
  const labelBySource = new Map();
  previousGlyphs.forEach((glyph, index) => {
    for (const sourceId of glyph.sourceIds) {
      if (previousLabels[index]) labelBySource.set(sourceId, previousLabels[index]);
    }
  });
  return nextGlyphs.map((glyph) => {
    const labels = glyph.sourceIds.map((sourceId) => labelBySource.get(sourceId)).filter(Boolean);
    return labels[0] || '';
  });
}

function mergeSelectedGlyphs() {
  const oldGlyphs = state.glyphs;
  const oldLabels = state.labels;
  state.glyphs = mergeBoxes(state.glyphs, [...state.selectedIds]);
  state.labels = preserveLabelsBySource(oldGlyphs, oldLabels, state.glyphs);
  state.selectedIds.clear();
  state.pendingSplitId = null;
  elements.imageCanvas.classList.remove('is-splitting');
  renderAll();
  setStatus('Выбранные части объединены в один символ.', 'ok');
}

function beginSplitSelected() {
  if (state.selectedIds.size !== 1) return;
  state.pendingSplitId = [...state.selectedIds][0];
  elements.imageCanvas.classList.add('is-splitting');
  state.view = 'overlay';
  elements.viewTabs.forEach((item) => item.classList.toggle('is-active', item.dataset.view === 'overlay'));
  setStatus('Щёлкните внутри выбранной рамки по вертикали, где нужно разделить буквы.', 'busy');
  drawCurrentView();
}

function splitAtCanvasX(glyph, x) {
  const oldIndex = state.glyphs.findIndex((item) => item.id === glyph.id);
  const oldLabel = state.labels[oldIndex] || '';
  const outcome = splitBoxAtX(
    state.glyphs,
    glyph.id,
    x,
    state.analysis.mask,
    elements.imageCanvas.width,
    Math.max(3, Math.floor(currentOptions().minArea / 2)),
  );
  if (!outcome.split) {
    setStatus(outcome.reason, 'error');
    return;
  }
  const oldGlyphs = state.glyphs;
  const oldLabels = state.labels;
  state.glyphs = outcome.boxes;
  state.labels = preserveLabelsBySource(oldGlyphs, oldLabels, state.glyphs);
  state.glyphs.forEach((item, index) => {
    if (item.splitParentId === glyph.id && item.splitSide === 'left') state.labels[index] = oldLabel;
    if (item.splitParentId === glyph.id && item.splitSide === 'right') state.labels[index] = '';
  });
  state.pendingSplitId = null;
  elements.imageCanvas.classList.remove('is-splitting');
  state.selectedIds.clear();
  renderAll();
  setStatus('Рамка разделена на два символа.', 'ok');
}

function removeSelectedGlyphs() {
  const oldGlyphs = state.glyphs;
  const oldLabels = state.labels;
  state.glyphs = removeBoxes(state.glyphs, [...state.selectedIds]);
  state.labels = preserveLabelsBySource(oldGlyphs, oldLabels, state.glyphs);
  state.selectedIds.clear();
  state.pendingSplitId = null;
  elements.imageCanvas.classList.remove('is-splitting');
  renderAll();
  setStatus('Выбранные рамки удалены из разметки.', 'ok');
}

function restoreDetection() {
  state.glyphs = state.originalGlyphs.map((glyph) => ({ ...glyph, sourceIds: [...glyph.sourceIds] }));
  state.selectedIds.clear();
  state.pendingSplitId = null;
  elements.imageCanvas.classList.remove('is-splitting');
  assignLabelsFromCharset();
  renderAll();
  setStatus('Ручные правки сброшены.', 'ok');
}

function exportManifest() {
  if (!state.analysis) return;
  const manifest = {
    version: 1,
    source: {
      fileName: state.fileName,
      width: state.sourceImageData.width,
      height: state.sourceImageData.height,
    },
    charset: elements.charsetSelect.value,
    settings: currentOptions(),
    stats: {
      glyphCount: state.glyphs.length,
      rowCount: state.glyphs.length ? Math.max(...state.glyphs.map((glyph) => glyph.row)) + 1 : 0,
    },
    glyphs: state.glyphs.map((glyph, index) => ({
      index,
      char: state.labels[index] || '',
      row: glyph.row,
      column: glyph.column,
      box: { x0: glyph.x0, y0: glyph.y0, x1: glyph.x1, y1: glyph.y1 },
      area: glyph.area,
      sourceIds: glyph.sourceIds,
    })),
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${state.fileName.replace(/\.[^.]+$/, '') || 'font'}-segmentation.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus('Разметка сохранена в JSON.', 'ok');
}

function cancelSplit(message = 'Разделение отменено.') {
  if (state.pendingSplitId === null) return;
  state.pendingSplitId = null;
  elements.imageCanvas.classList.remove('is-splitting');
  setStatus(message, 'idle');
}

function selectBoxAtCanvasPoint(clientX, clientY) {
  if (state.view !== 'overlay' || !state.glyphs.length) return;
  const rect = elements.imageCanvas.getBoundingClientRect();
  const x = (clientX - rect.left) * (elements.imageCanvas.width / rect.width);
  const y = (clientY - rect.top) * (elements.imageCanvas.height / rect.height);
  if (state.pendingSplitId !== null) {
    const glyph = state.glyphs.find((item) => item.id === state.pendingSplitId);
    if (!glyph || x < glyph.x0 || x > glyph.x1 || y < glyph.y0 || y > glyph.y1) {
      setStatus('Щёлкните внутри выбранной рамки.', 'error');
      return;
    }
    splitAtCanvasX(glyph, x);
    return;
  }
  const matches = state.glyphs.filter((glyph) => x >= glyph.x0 && x <= glyph.x1 && y >= glyph.y0 && y <= glyph.y1);
  if (!matches.length) return;
  matches.sort((a, b) => a.width * a.height - b.width * b.height);
  toggleSelection(matches[0].id);
}

elements.fileInput.addEventListener('change', () => loadFile(elements.fileInput.files[0]));
elements.processButton.addEventListener('click', processImage);
elements.resetSettings.addEventListener('click', resetControls);
elements.assignLabels.addEventListener('click', assignLabelsFromCharset);
elements.mergeSelected.addEventListener('click', mergeSelectedGlyphs);
elements.splitSelected.addEventListener('click', beginSplitSelected);
elements.removeSelected.addEventListener('click', removeSelectedGlyphs);
elements.restoreDetection.addEventListener('click', restoreDetection);
elements.exportManifest.addEventListener('click', exportManifest);
elements.imageCanvas.addEventListener('click', (event) => selectBoxAtCanvasPoint(event.clientX, event.clientY));

elements.charsetSelect.addEventListener('change', () => {
  elements.customCharset.hidden = elements.charsetSelect.value !== 'custom';
  if (state.glyphs.length) assignLabelsFromCharset();
});
elements.customCharset.addEventListener('input', () => {
  if (elements.charsetSelect.value === 'custom' && state.glyphs.length) assignLabelsFromCharset();
});

elements.viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    elements.viewTabs.forEach((item) => item.classList.toggle('is-active', item === tab));
    drawCurrentView();
  });
});

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove('is-dragging');
  });
}
elements.dropzone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (event.key === 'Escape' && state.pendingSplitId !== null) {
    event.preventDefault();
    cancelSplit();
    return;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIds.size) {
    event.preventDefault();
    removeSelectedGlyphs();
  }
});

resetControls();
renderStats();
