import {
  TEMPLATE_DPI,
  getTemplateCharset,
  planTemplatePages,
  renderTemplatePage,
  validateTemplatePlan,
} from './src/template.js';
import {
  countPdfPages,
  generateTemplatePdf,
  validatePdfStructure,
} from './src/pdf.js';

const elements = {
  title: document.querySelector('#templateTitle'),
  charset: document.querySelector('#templateCharset'),
  customCharset: document.querySelector('#templateCustomCharset'),
  layout: document.querySelector('#templateLayout'),
  guides: document.querySelector('#templateGuides'),
  preview: document.querySelector('#templatePreview'),
  previous: document.querySelector('#templatePrevious'),
  next: document.querySelector('#templateNext'),
  pageLabel: document.querySelector('#templatePageLabel'),
  summary: document.querySelector('#templateSummary'),
  status: document.querySelector('#templateStatus'),
  progress: document.querySelector('#templateProgress'),
  download: document.querySelector('#templateDownload'),
};

const state = {
  plan: null,
  pageIndex: 0,
  generating: false,
};

function setStatus(message, mode = 'idle') {
  elements.status.textContent = message;
  elements.status.dataset.mode = mode;
}

function currentCharacters() {
  return getTemplateCharset(elements.charset.value, elements.customCharset.value);
}

function createPlan() {
  const plan = planTemplatePages(currentCharacters(), {
    layoutId: elements.layout.value,
    charsetId: elements.charset.value,
    title: elements.title.value,
  });
  const errors = validateTemplatePlan(plan);
  if (errors.length) throw new Error(errors.join(' '));
  return plan;
}

function renderPreview() {
  if (!state.plan) return;
  state.pageIndex = Math.max(0, Math.min(state.pageIndex, state.plan.pageCount - 1));
  const context = elements.preview.getContext('2d', { alpha: false });
  renderTemplatePage(context, state.plan.pages[state.pageIndex], {
    dpi: 72,
    showGuides: elements.guides.checked,
  });
  elements.pageLabel.textContent = `Страница ${state.pageIndex + 1} из ${state.plan.pageCount}`;
  elements.previous.disabled = state.pageIndex <= 0;
  elements.next.disabled = state.pageIndex >= state.plan.pageCount - 1;
}

function rebuildTemplate({ preservePage = false } = {}) {
  try {
    const previousPage = state.pageIndex;
    state.plan = createPlan();
    state.pageIndex = preservePage ? Math.min(previousPage, state.plan.pageCount - 1) : 0;
    elements.summary.innerHTML = `<strong>${state.plan.characters.length}</strong> символов · <strong>${state.plan.pageCount}</strong> стр. A4 · ${state.plan.layout.columns}×${state.plan.layout.rows}`;
    elements.download.disabled = false;
    renderPreview();
    setStatus('Шаблон готов к скачиванию.', 'ok');
  } catch (error) {
    state.plan = null;
    elements.summary.textContent = error.message;
    elements.download.disabled = true;
    elements.previous.disabled = true;
    elements.next.disabled = true;
    setStatus(error.message, 'error');
  }
}

function safeFileName(value) {
  const name = String(value || 'font-template').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return `${name || 'font-template'}-template-ru.pdf`;
}

async function generateTemplateFile(options = {}) {
  if (state.generating) return null;
  rebuildTemplate({ preservePage: true });
  if (!state.plan) return null;

  const download = options.download !== false;
  const dpi = Number(options.dpi || TEMPLATE_DPI);
  state.generating = true;
  elements.download.disabled = true;
  elements.progress.hidden = false;
  elements.progress.max = state.plan.pageCount;
  elements.progress.value = 0;
  setStatus('Создаю страницы PDF…', 'busy');

  try {
    const blob = await generateTemplatePdf(state.plan, renderTemplatePage, {
      dpi,
      quality: 0.94,
      showGuides: elements.guides.checked,
      onProgress(done, total) {
        elements.progress.max = total;
        elements.progress.value = done;
        setStatus(`Создаю PDF: ${done} из ${total} страниц…`, 'busy');
      },
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const errors = validatePdfStructure(bytes);
    const pages = countPdfPages(bytes);
    if (errors.length) throw new Error(errors.join(' '));
    if (pages !== state.plan.pageCount) throw new Error(`PDF содержит ${pages} страниц вместо ${state.plan.pageCount}.`);

    if (download) {
      const verifiedBlob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(verifiedBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = safeFileName(state.plan.title);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      window.dispatchEvent(new CustomEvent('drawyourfont:template-downloaded', {
        detail: { pageCount: pages, size: bytes.length, title: state.plan.title },
      }));
    }

    setStatus(`PDF проверен: ${pages} стр., ${(bytes.length / 1024).toFixed(0)} КБ.`, 'ok');
    return { blob, bytes, pageCount: pages, size: bytes.length };
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Не удалось создать PDF.', 'error');
    return null;
  } finally {
    state.generating = false;
    elements.download.disabled = !state.plan;
    elements.progress.hidden = true;
  }
}

elements.charset.addEventListener('change', () => {
  elements.customCharset.hidden = elements.charset.value !== 'custom';
  if (elements.charset.value === 'ru-extended' && elements.layout.value === 'balanced') {
    elements.layout.value = 'compact';
  }
  rebuildTemplate();
});
elements.customCharset.addEventListener('input', () => rebuildTemplate({ preservePage: true }));
elements.title.addEventListener('input', () => rebuildTemplate({ preservePage: true }));
elements.layout.addEventListener('change', () => rebuildTemplate());
elements.guides.addEventListener('change', renderPreview);
elements.previous.addEventListener('click', () => {
  state.pageIndex -= 1;
  renderPreview();
});
elements.next.addEventListener('click', () => {
  state.pageIndex += 1;
  renderPreview();
});
elements.download.addEventListener('click', () => generateTemplateFile());

window.__drawYourFontTemplate = {
  rebuildTemplate,
  generateTemplateFile,
  getState: () => ({ plan: state.plan, pageIndex: state.pageIndex, generating: state.generating }),
};

rebuildTemplate();
