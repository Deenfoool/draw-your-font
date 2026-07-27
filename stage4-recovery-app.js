import {
  decodeFileToGray,
  scanTemplateFromManualCorners,
  scanTemplateWithRetries,
} from './src/scan-recovery.js';
import {
  projectFromScannedSummary,
  serializeProject,
} from './src/project.js';
import { summarizeScannedPages } from './src/template-scanner.js';

const state = {
  scans: [],
  failures: [],
  installing: false,
};

function byId(id) { return document.getElementById(id); }
function setStatus(text, mode = 'busy') {
  const node = byId('scanStatus');
  if (!node) return;
  node.textContent = text;
  node.dataset.mode = mode;
}

function grayToCanvas(gray, width, height, maxWidth = 760) {
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const context = source.getContext('2d');
  const image = context.createImageData(width, height);
  for (let i = 0; i < gray.length; i += 1) {
    const p = i * 4;
    image.data[p] = image.data[p + 1] = image.data[p + 2] = gray[i];
    image.data[p + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  if (width <= maxWidth) return source;
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = Math.round(height * maxWidth / width);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function renderResults(results, failures) {
  const container = byId('scanPages');
  if (!container) return;
  container.replaceChildren();
  for (const result of results) {
    const card = document.createElement('article');
    card.className = 'scan-page-card';
    const heading = document.createElement('strong');
    heading.textContent = `Страница ${result.metadata.pageIndex + 1}${result.recovery?.manualCorners ? ' · углы исправлены вручную' : ''}`;
    const canvas = grayToCanvas(result.rectified.gray, result.rectified.width, result.rectified.height, 520);
    const note = document.createElement('small');
    const warnings = result.glyphs.filter((glyph) => glyph.quality.warnings.length).length;
    note.textContent = `${result.glyphs.length} ячеек · предупреждений: ${warnings}`;
    card.append(heading, canvas, note);
    container.append(card);
  }
  for (const failure of failures) {
    const card = document.createElement('article');
    card.className = 'scan-page-card scan-page-error';
    const title = document.createElement('strong');
    title.textContent = failure.file;
    const message = document.createElement('small');
    message.textContent = failure.error;
    card.append(title, message);
    container.append(card);
  }
}

function renderReport(summary, failures) {
  const report = byId('scanReport');
  if (!report) return;
  const parts = [];
  if (summary.missing.length) parts.push(`Не хватает страниц: ${summary.missing.join(', ')}.`);
  if (summary.duplicates.length) parts.push(`Повторные страницы: ${summary.duplicates.join(', ')}.`);
  if (summary.empty.length) parts.push(`Пустые символы: ${summary.empty.slice(0, 24).join(' ')}${summary.empty.length > 24 ? '…' : ''}.`);
  if (summary.warnings) parts.push(`Символов с предупреждениями: ${summary.warnings}.`);
  if (failures.length) parts.push(`Не обработано файлов: ${failures.map((item) => item.file).join(', ')}.`);
  if (!parts.length) parts.push('Все страницы распознаны, пустых ячеек и предупреждений нет.');
  report.textContent = parts.join(' ');
}

function createManualCornerDialog(decoded, file, activePlan) {
  return new Promise((resolve, reject) => {
    const host = byId('scanPages');
    if (!host) return reject(new Error('Панель ручной коррекции не найдена.'));
    host.replaceChildren();
    const panel = document.createElement('section');
    panel.className = 'manual-corner-panel';
    const title = document.createElement('h3');
    title.textContent = `Укажите четыре угла листа: ${file.name}`;
    const help = document.createElement('p');
    help.textContent = 'Перетащите точки на внешние углы бумаги. Программа попробует все четыре поворота. Если машинный код размыт, выберите номер страницы и поворот вручную.';

    const display = grayToCanvas(decoded.gray, decoded.width, decoded.height, 900);
    display.className = 'manual-corner-canvas';
    const context = display.getContext('2d');
    const base = document.createElement('canvas');
    base.width = display.width;
    base.height = display.height;
    base.getContext('2d').drawImage(display, 0, 0);
    const scaleX = decoded.width / display.width;
    const scaleY = decoded.height / display.height;
    const marginX = display.width * 0.045;
    const marginY = display.height * 0.045;
    const points = [
      { x: marginX, y: marginY, label: '1' },
      { x: display.width - marginX, y: marginY, label: '2' },
      { x: display.width - marginX, y: display.height - marginY, label: '3' },
      { x: marginX, y: display.height - marginY, label: '4' },
    ];
    let dragging = -1;

    function draw() {
      context.clearRect(0, 0, display.width, display.height);
      context.drawImage(base, 0, 0);
      context.lineWidth = Math.max(2, display.width / 350);
      context.strokeStyle = '#00a7c4';
      context.fillStyle = 'rgba(0,167,196,.2)';
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
      context.fill();
      context.stroke();
      context.font = `bold ${Math.max(16, display.width / 34)}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const point of points) {
        context.beginPath();
        context.fillStyle = '#fff';
        context.arc(point.x, point.y, Math.max(11, display.width / 65), 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#00a7c4';
        context.stroke();
        context.fillStyle = '#111827';
        context.fillText(point.label, point.x, point.y);
      }
    }

    function pointerPosition(event) {
      const rect = display.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * display.width / rect.width, y: (event.clientY - rect.top) * display.height / rect.height };
    }
    display.addEventListener('pointerdown', (event) => {
      const p = pointerPosition(event);
      dragging = points.reduce((best, point, index) => {
        const distance = Math.hypot(point.x - p.x, point.y - p.y);
        return distance < best.distance ? { index, distance } : best;
      }, { index: -1, distance: Infinity }).index;
      display.setPointerCapture(event.pointerId);
    });
    display.addEventListener('pointermove', (event) => {
      if (dragging < 0) return;
      const p = pointerPosition(event);
      points[dragging].x = Math.min(display.width, Math.max(0, p.x));
      points[dragging].y = Math.min(display.height, Math.max(0, p.y));
      draw();
    });
    display.addEventListener('pointerup', () => { dragging = -1; });
    display.addEventListener('pointercancel', () => { dragging = -1; });

    const controls = document.createElement('div');
    controls.className = 'manual-corner-controls';
    const pageLabel = document.createElement('label');
    pageLabel.textContent = 'Страница ';
    const pageSelect = document.createElement('select');
    pageSelect.innerHTML = '<option value="">Определить по коду</option>';
    for (let index = 0; index < (activePlan?.pages?.length || 0); index += 1) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = String(index + 1);
      pageSelect.append(option);
    }
    pageLabel.append(pageSelect);
    const rotationLabel = document.createElement('label');
    rotationLabel.textContent = 'Поворот ';
    const rotationSelect = document.createElement('select');
    rotationSelect.innerHTML = '<option value="auto">Определить автоматически</option><option value="0">0°</option><option value="1">90° вправо</option><option value="2">180°</option><option value="3">270° вправо</option>';
    rotationLabel.append(rotationSelect);
    const apply = document.createElement('button');
    apply.className = 'primary-button';
    apply.type = 'button';
    apply.textContent = 'Применить углы';
    const cancel = document.createElement('button');
    cancel.className = 'secondary-button';
    cancel.type = 'button';
    cancel.textContent = 'Пропустить файл';
    controls.append(pageLabel, rotationLabel, apply, cancel);

    apply.addEventListener('click', () => {
      try {
        const corners = points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
        const pageIndex = pageSelect.value === '' ? NaN : Number(pageSelect.value);
        resolve(scanTemplateFromManualCorners(decoded.gray, decoded.width, decoded.height, corners, {
          activePlan,
          pageIndex,
          rotation: rotationSelect.value === 'auto' ? 'auto' : Number(rotationSelect.value),
          outputWidth: 1260,
        }));
      } catch (error) {
        help.textContent = error.message;
        help.dataset.mode = 'error';
      }
    });
    cancel.addEventListener('click', () => reject(new Error('Файл пропущен пользователем.')));
    panel.append(title, help, display, controls);
    host.append(panel);
    draw();
  });
}

async function processScanFilesRobust() {
  const input = byId('scanFiles');
  const files = [...(input?.files || [])];
  if (!files.length) {
    setStatus('Сначала выберите фотографии.', 'error');
    return null;
  }
  const api = window.__drawYourFontProject;
  const activePlan = window.__drawYourFontTemplate?.getState?.().plan || null;
  const progress = byId('scanProgress');
  if (progress) { progress.hidden = false; progress.max = files.length; progress.value = 0; }
  const results = [];
  const failures = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    setStatus(`Открываю ${index + 1}/${files.length}: ${file.name}…`, 'busy');
    try {
      const decoded = await decodeFileToGray(file);
      let result;
      try {
        setStatus(`Ищу метки ${index + 1}/${files.length}: ${file.name}…`, 'busy');
        result = scanTemplateWithRetries(decoded.gray, decoded.width, decoded.height, { activePlan });
      } catch (automaticError) {
        setStatus(`Метки на «${file.name}» не распознаны. Укажите углы листа вручную.`, 'busy');
        result = await createManualCornerDialog(decoded, file, activePlan);
        result.recovery = { ...(result.recovery || {}), automaticError: automaticError.message };
      }
      result.fileName = file.name;
      result.decoder = decoded.decoder;
      results.push(result);
    } catch (error) {
      console.error(error);
      failures.push({ file: file.name, error: error.message });
    }
    if (progress) progress.value = index + 1;
  }
  state.scans = results;
  state.failures = failures;
  if (!results.length) {
    renderResults([], failures);
    setStatus('Ни одна фотография не обработана. Проверьте сообщения ниже.', 'error');
    if (progress) progress.hidden = true;
    return null;
  }
  const plan = results[0].plan || activePlan;
  const summary = summarizeScannedPages(results, plan);
  const project = projectFromScannedSummary(summary, {
    title: plan?.title || 'Мой рукописный шрифт',
    familyName: plan?.title || 'Мой рукописный шрифт',
    sourceFiles: results.map((result) => result.fileName),
    template: plan ? { charsetId: plan.charsetId, layoutId: plan.layout.id, pageCount: plan.pageCount } : null,
  });
  api.importProject(serializeProject(project));
  renderResults(results, failures);
  renderReport(summary, failures);
  setStatus(`Готово: ${results.length} страниц, ${project.glyphs.length} символов.${failures.length ? ` Ошибок файлов: ${failures.length}.` : ''}`, failures.length ? 'busy' : 'ok');
  if (progress) progress.hidden = true;
  window.dispatchEvent(new CustomEvent('drawyourfont:project-updated', { detail: { glyphCount: project.glyphs.length, recovery: true } }));
  return project;
}

function installRecovery() {
  if (state.installing) return;
  const api = window.__drawYourFontProject;
  const oldButton = byId('scanButton');
  const input = byId('scanFiles');
  if (!api || !oldButton || !input) {
    setTimeout(installRecovery, 30);
    return;
  }
  state.installing = true;
  const button = oldButton.cloneNode(true);
  oldButton.replaceWith(button);
  button.disabled = !input.files?.length;
  input.addEventListener('change', () => { button.disabled = !input.files?.length; });
  button.addEventListener('click', processScanFilesRobust);
  const originalGetState = api.getState?.bind(api);
  api.processScanFilesLegacy = api.processScanFiles;
  api.processScanFiles = processScanFilesRobust;
  if (originalGetState) api.getState = () => ({ ...originalGetState(), scans: [...state.scans], recoveryFailures: [...state.failures], project: api.getProject?.() || originalGetState().project });
  byId('scanClear')?.addEventListener('click', () => {
    state.scans = [];
    state.failures = [];
    setTimeout(() => { button.disabled = !input.files?.length; }, 0);
  });
}

installRecovery();
export { processScanFilesRobust };
