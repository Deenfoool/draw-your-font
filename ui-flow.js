const byId = (id) => document.getElementById(id);

function ensureStylesheet(href, marker) {
  if (document.querySelector(`link[${marker}]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(marker, '1');
  document.head.append(link);
}

function installWorkflowChoice() {
  const template = byId('templateBuilder');
  const scanner = byId('templateScanner');
  const manual = byId('manualMode');
  if (!template || !scanner || !manual) return setTimeout(installWorkflowChoice, 40);
  if (byId('workflowChoice')) return;

  ensureStylesheet('./ui-flow.css', 'data-dyfr-ui-flow');

  const choice = document.createElement('section');
  choice.className = 'card workflow-choice';
  choice.id = 'workflowChoice';
  choice.innerHTML = `
    <div class="workflow-choice-heading">
      <p class="eyebrow">Начало работы</p>
      <h2>Как вам удобнее создать шрифт?</h2>
      <p>Выберите новый точный шаблон или обработайте уже имеющуюся фотографию почерка.</p>
    </div>
    <div class="workflow-choice-options" role="group" aria-label="Способ создания шрифта">
      <button class="workflow-choice-button" id="chooseTemplateWorkflow" type="button" aria-pressed="false">
        <strong>Создайте новый машинно-читаемый шаблон</strong>
        <span>Самый точный вариант: скачать PDF, заполнить страницы и загрузить фотографии.</span>
      </button>
      <button class="workflow-choice-button" id="chooseManualWorkflow" type="button" aria-pressed="false">
        <strong>Ручной режим для обычной фотографии или старого шаблона</strong>
        <span>Подходит для готового листа, тетради или изображения без машинных меток.</span>
      </button>
    </div>`;
  template.before(choice);

  const templateButton = byId('chooseTemplateWorkflow');
  const manualButton = byId('chooseManualWorkflow');
  let activeMode = null;
  let scannerUnlocked = false;

  template.hidden = true;
  scanner.hidden = true;
  manual.hidden = true;
  manual.open = false;

  function updateButtons() {
    templateButton.setAttribute('aria-pressed', String(activeMode === 'template'));
    manualButton.setAttribute('aria-pressed', String(activeMode === 'manual'));
    templateButton.classList.toggle('is-selected', activeMode === 'template');
    manualButton.classList.toggle('is-selected', activeMode === 'manual');
  }

  function selectMode(mode, { scroll = true } = {}) {
    activeMode = mode;
    const templateMode = mode === 'template';
    template.hidden = !templateMode;
    scanner.hidden = !(templateMode && scannerUnlocked);
    manual.hidden = templateMode;
    manual.open = !templateMode;
    updateButtons();
    const target = templateMode ? template : manual;
    if (scroll) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    window.dispatchEvent(new CustomEvent('drawyourfont:workflow-selected', { detail: { mode, scannerUnlocked } }));
  }

  function unlockScanner() {
    scannerUnlocked = true;
    scanner.dataset.unlocked = 'true';
    if (activeMode === 'template') {
      scanner.hidden = false;
      requestAnimationFrame(() => scanner.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    window.dispatchEvent(new CustomEvent('drawyourfont:scanner-unlocked'));
  }

  templateButton.addEventListener('click', () => selectMode('template'));
  manualButton.addEventListener('click', () => selectMode('manual'));
  byId('templateDownload')?.addEventListener('click', unlockScanner);
  window.addEventListener('drawyourfont:template-downloaded', unlockScanner);

  window.__drawYourFontWorkflow = {
    selectMode,
    unlockScanner,
    getState: () => ({ activeMode, scannerUnlocked }),
  };
}

installWorkflowChoice();
