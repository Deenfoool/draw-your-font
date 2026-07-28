import {
  CONNECTION_TEMPLATE_VERSION,
  planConnectionTemplatePages,
  renderConnectionTemplatePage,
  validateConnectionTemplatePlan,
} from './src/connection-template.js';
import {
  countPdfPages,
  generateTemplatePdf,
  validatePdfStructure,
} from './src/pdf.js';
import { TEMPLATE_DPI } from './src/template.js';

const state = { plan: null, generating: false, output: null };
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
    <small id="cursiveConnectionTemplateStatus" data-mode="idle">Шаблон будет привязан к русской грамматике соединений.</small>`;
  const descender = controls.querySelector('.cursive-descender-box');
  if (descender) descender.after(box); else controls.append(box);
  byId('cursiveConnectionTemplateDownload').addEventListener('click', () => generateConnectionTemplate());
  try { createPlan(); } catch (error) { setStatus(error.message, 'error'); }
}

window.addEventListener('drawyourfont:project-updated', () => {
  try { createPlan(); } catch (error) { setStatus(error.message, 'error'); }
});

window.__drawYourFontConnectionTemplate = {
  generate: generateConnectionTemplate,
  rebuild: createPlan,
  getState: () => ({ plan: state.plan, generating: state.generating, output: state.output }),
};

installConnectionTemplateCard();
