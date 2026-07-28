import {
  CONNECTION_TEMPLATE_VERSION,
  planConnectionTemplatePages,
  renderConnectionTemplatePage,
  validateConnectionTemplatePlan,
} from './src/connection-template.js';
import {
  applyConnectionSamplesToProject,
  scanConnectionTemplateWithRetries,
  summarizeConnectionTemplatePages,
} from './src/connection-template-scanner.js';
import {
  countPdfPages,
  generateTemplatePdf,
  validatePdfStructure,
} from './src/pdf.js';
import { decodeFileToGray } from './src/scan-recovery.js';
import { TEMPLATE_DPI } from './src/template.js';

const state = {
  plan: null,
  generating: false,
  scanning: false,
  output: null,
  scans: [],
  failures: [],
  summary: null,
};
const byId = (id) => document.getElementById(id);
const currentProject = () => window.__drawYourFontProject?.getProject?.() || null;

function safeFileName(value) {
  const name = String(value || 'my-handwriting').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return `${name || 'my-handwriting'}-connections-ru.pdf`;
}

function setStatus(message, mode = 'idle') {
  const status = byId('cursiveConnectionTemplateStatus');
  if (!status) return;
  status.textContent = message;
  status.dataset.mode = mode;
}

function createPlan() {
  const project = currentProject();
  const plan = planConnectionTemplatePages({ title: project?.font?.familyName || project?.title || 'Мой рукописный шрифт' });
  const errors = validateConnectionTemplatePlan(plan);
  if (errors.length) throw new Error(errors.join(' '));
  state.plan = plan;
  const summary = byId('cursiveConnectionTemplateSummary');
  if (summary) summary.textContent = `${plan.samples.length} образцов · ${plan.pageCount} стр. A4`;
  return plan;
}

async function generateConnectionTemplate(options = {}) {
  if (state.generating) return null;
  const button = byId('cursiveConnectionTemplateDownload');
  const progress = byId('cursiveConnectionTemplateProgress');
  const download = options.download !== false;
  const dpi = Number(options.dpi || TEMPLATE_DPI);
  state.generating = true;
  state.output = null;
  if (button) button.disabled = true;
  if (progress) { progress.hidden = false; progress.max = 3; progress.value = 0; }
  setStatus('Создаю калибровочный шаблон соединений…', 'busy');

  try {
    const plan = createPlan();
    if (progress) progress.max = plan.pageCount;
    const blob = await generateTemplatePdf(plan, renderConnectionTemplatePage, {
      dpi,
      quality: 0.95,
      showGuides: true,
      onProgress(done, total) {
        if (progress) { progress.max = total; progress.value = done; }
        setStatus(`Создаю PDF: ${done} из ${total} страниц…`, 'busy');
      },
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const structureErrors = validatePdfStructure(bytes);
    const pageCount = countPdfPages(bytes);
    if (structureErrors.length) throw new Error(structureErrors.join(' '));
    if (pageCount !== plan.pageCount) throw new Error(`PDF содержит ${pageCount} страниц вместо ${plan.pageCount}.`);

    const verifiedBlob = new Blob([bytes], { type: 'application/pdf' });
    state.output = { blob: verifiedBlob, bytes, pageCount, size: bytes.length, plan };
    if (download) {
      const url = URL.createObjectURL(verifiedBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeFileName(plan.title);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      window.dispatchEvent(new CustomEvent('drawyourfont:connection-template-downloaded', {
        detail: {
          version: CONNECTION_TEMPLATE_VERSION,
          pageCount,
          samples: plan.samples.length,
          size: bytes.length,
          title: plan.title,
        },
      }));
    }
    setStatus(`Шаблон проверен: ${pageCount} стр., ${(bytes.length / 1024).toFixed(0)} КБ.`, 'ok');
    return state.output;
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Не удалось создать шаблон соединений.', 'error');
    return null;
  } finally {
    state.generating = false;
    if (button) button.disabled = false;
    if (progress) progress.hidden = true;
  }
}

function renderScanReport(summary, failures) {
  const report = byId('cursiveConnectionTemplateReport');
  if (!report) return;
  const parts = [];
  if (summary.missing.length) parts.push(`Не хватает страниц: ${summary.missing.join(', ')}.`);
  if (summary.duplicates.length) parts.push(`Повторные страницы: ${summary.duplicates.join(', ')}.`);
  if (summary.empty.length) parts.push(`Пустые образцы: ${summary.empty.slice(0, 12).join(', ')}${summary.empty.length > 12 ? '…' : ''}.`);
  if (summary.unreached.length) parts.push(`Не доведены до цели: ${summary.unreached.slice(0, 12).join(', ')}${summary.unreached.length > 12 ? '…' : ''}.`);
  if (summary.warnings) parts.push(`Образцов с предупреждениями: ${summary.warnings}.`);
  if (failures.length) parts.push(`Не обработаны: ${failures.map((failure) => failure.file).join(', ')}.`);
  if (!parts.length) parts.push('Все 99 образцов распознаны и доведены до целей.');
  report.textContent = parts.join(' ');
  report.dataset.mode = summary.complete && !failures.length ? 'ok' : 'review';
}

async function scanConnectionFiles() {
  if (state.scanning) return null;
  const input = byId('cursiveConnectionTemplateFiles');
  const files = [...(input?.files || [])];
  if (!files.length) {
    setStatus('Выберите фотографии заполненных листов.', 'error');
    return null;
  }
  const project = currentProject();
  if (!project) {
    setStatus('Сначала создайте или загрузите проект шрифта.', 'error');
    return null;
  }
  const plan = createPlan();
  const button = byId('cursiveConnectionTemplateScan');
  const progress = byId('cursiveConnectionScanProgress');
  state.scanning = true;
  state.scans = [];
  state.failures = [];
  state.summary = null;
  if (button) button.disabled = true;
  if (progress) { progress.hidden = false; progress.max = files.length; progress.value = 0; }

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setStatus(`Распознаю ${index + 1}/${files.length}: ${file.name}…`, 'busy');
      try {
        const decoded = await decodeFileToGray(file);
        const result = scanConnectionTemplateWithRetries(decoded.gray, decoded.width, decoded.height, {
          activePlan: plan,
          outputWidth: 1260,
        });
        result.fileName = file.name;
        state.scans.push(result);
      } catch (error) {
        console.error(error);
        state.failures.push({ file: file.name, error: error.message || String(error) });
      }
      if (progress) progress.value = index + 1;
    }

    const summary = summarizeConnectionTemplatePages(state.scans, plan);
    state.summary = summary;
    if (summary.samples.length) {
      applyConnectionSamplesToProject(project, summary, {
        pageCount: state.scans.length,
        sourceFiles: files.map((file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified })),
      });
      window.dispatchEvent(new CustomEvent('drawyourfont:connection-samples-updated', {
        detail: {
          complete: summary.complete,
          samples: summary.samples.length,
          missing: summary.missing,
          empty: summary.empty,
          unreached: summary.unreached,
        },
      }));
      window.dispatchEvent(new CustomEvent('drawyourfont:cursive-updated'));
    }
    renderScanReport(summary, state.failures);
    if (summary.complete && !state.failures.length) setStatus('Точные соединения сохранены в проекте: 99 из 99.', 'ok');
    else setStatus(`Сохранено образцов: ${summary.samples.length} из ${plan.samples.length}. Проверьте отчёт.`, summary.samples.length ? 'review' : 'error');
    return { summary, failures: state.failures, scans: state.scans };
  } finally {
    state.scanning = false;
    if (button) button.disabled = false;
    if (progress) progress.hidden = true;
  }
}

function installConnectionTemplateCard() {
  if (byId('cursiveConnectionTemplateBox')) return;
  const builder = byId('cursiveBuilder');
  if (!builder) return setTimeout(installConnectionTemplateCard, 40);
  const controls = builder.querySelector('.cursive-controls');
  if (!controls) return setTimeout(installConnectionTemplateCard, 40);
  const box = document.createElement('div');
  box.className = 'cursive-descender-box';
  box.id = 'cursiveConnectionTemplateBox';
  box.innerHTML = `
    <strong>Точное соединение букв</strong>
    <p>Заполните отдельный шаблон: буква и её естественный выход вверх, в середину и вниз.</p>
    <small id="cursiveConnectionTemplateSummary">99 образцов · 3 стр. A4</small>
    <button class="secondary-button compact" id="cursiveConnectionTemplateDownload" type="button">Скачать шаблон соединений</button>
    <progress id="cursiveConnectionTemplateProgress" max="3" value="0" hidden></progress>
    <label>Фотографии заполненных листов<input id="cursiveConnectionTemplateFiles" type="file" accept="image/*,.heic,.heif" multiple></label>
    <button class="secondary-button compact" id="cursiveConnectionTemplateScan" type="button">Распознать соединения</button>
    <progress id="cursiveConnectionScanProgress" max="3" value="0" hidden></progress>
    <small id="cursiveConnectionTemplateReport"></small>
    <small id="cursiveConnectionTemplateStatus" data-mode="idle">Шаблон будет привязан к русской грамматике соединений.</small>`;
  const descender = controls.querySelector('.cursive-descender-box');
  if (descender) descender.after(box); else controls.append(box);
  byId('cursiveConnectionTemplateDownload').addEventListener('click', () => generateConnectionTemplate());
  byId('cursiveConnectionTemplateScan').addEventListener('click', scanConnectionFiles);
  try { createPlan(); } catch (error) { setStatus(error.message, 'error'); }
}

window.addEventListener('drawyourfont:project-updated', () => {
  try { createPlan(); } catch (error) { setStatus(error.message, 'error'); }
});

window.__drawYourFontConnectionTemplate = {
  generate: generateConnectionTemplate,
  scan: scanConnectionFiles,
  rebuild: createPlan,
  getState: () => ({
    plan: state.plan,
    generating: state.generating,
    scanning: state.scanning,
    output: state.output,
    scans: state.scans,
    failures: state.failures,
    summary: state.summary,
  }),
};

installConnectionTemplateCard();
