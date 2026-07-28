import { serializeProject } from './src/project.js';
import {
  requestPersistentLibraryStorage,
  saveLibraryFont,
} from './src/font-library.js';

const PENDING_PROJECT_KEY = 'dyfr:library-open-project';
const byId = id => document.getElementById(id);
const currentProject = () => window.__drawYourFontProject?.getProject?.() || null;

function ensureStylesheet() {
  if (document.querySelector('link[data-dyfr-library-bridge]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './library-bridge.css';
  link.dataset.dyfrLibraryBridge = '1';
  document.head.append(link);
}

function setButtonLabel(button, label) {
  if (button && button.textContent !== label) button.textContent = label;
}

function installLibraryNavigation() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || byId('fontLibraryLink')) return;
  const link = document.createElement('a');
  link.id = 'fontLibraryLink';
  link.className = 'library-nav-link';
  link.href = './library.html';
  link.innerHTML = '<span>Мои шрифты</span><strong>Библиотека</strong>';
  const badge = topbar.querySelector('.stage-badge');
  if (badge) badge.before(link); else topbar.append(link);
}

function installLibraryControls() {
  const grid = document.querySelector('#fontBuilder .download-grid');
  if (!grid || byId('addFontToLibrary')) return false;
  const button = document.createElement('button');
  button.id = 'addFontToLibrary';
  button.type = 'button';
  button.className = 'library-add-button';
  button.disabled = true;
  button.hidden = true;
  button.textContent = 'Добавить в библиотеку';
  const link = document.createElement('a');
  link.className = 'library-open-button';
  link.href = './library.html';
  link.textContent = 'Открыть библиотеку';
  const status = document.createElement('p');
  status.id = 'librarySaveStatus';
  status.className = 'library-save-status';
  status.hidden = true;
  status.textContent = 'Готовый шрифт можно сохранить локально.';
  grid.append(button, link);
  grid.after(status);
  button.addEventListener('click', addCurrentFont);
  return true;
}

function getCurrentBuild() {
  const project = currentProject();
  if (!project) return null;
  const connectedEnabled = Boolean(project.cursive?.enabled);
  const connected = window.__drawYourFontCursive?.getState?.().outputs || null;
  const standard = window.__drawYourFontBuilder?.getState?.().outputs || null;
  const outputs = connectedEnabled ? connected : standard;
  if (!outputs?.ttf && !outputs?.woff2) return null;
  const familyName = String(byId('fontFamily')?.value || outputs.familyName || project.font?.familyName || project.title || 'Мой рукописный шрифт').trim();
  const styleName = String(byId('fontStyle')?.value || outputs.styleName || project.font?.styleName || 'Regular').trim();
  const glyphCount = connectedEnabled
    ? Number(outputs.built?.glyphs?.length || outputs.built?.layout?.glyphs?.length || project.glyphs?.length || 0)
    : Number(outputs.glyphSet?.entries?.length || project.glyphs?.length || 0);
  return {
    project,
    outputs,
    familyName,
    styleName,
    glyphCount,
    mode: connectedEnabled ? 'connected' : 'standard',
  };
}

function setSaveStatus(text, mode = 'idle') {
  const status = byId('librarySaveStatus');
  if (!status) return;
  if (status.textContent !== text) status.textContent = text;
  if (status.dataset.mode !== mode) status.dataset.mode = mode;
}

function refreshLibraryButton() {
  const button = byId('addFontToLibrary');
  const status = byId('librarySaveStatus');
  if (!button || !status) return;
  const build = getCurrentBuild();
  const visible = Boolean(build);
  if (button.hidden === visible) button.hidden = !visible;
  if (status.hidden === visible) status.hidden = !visible;
  if (button.disabled === visible) button.disabled = !visible;
  if (build && button.dataset.busy !== '1' && button.dataset.saved !== '1') {
    setButtonLabel(button, 'Добавить в библиотеку');
    setSaveStatus('Готовый шрифт можно сохранить локально.', 'ok');
  }
}

async function addCurrentFont() {
  const button = byId('addFontToLibrary');
  const build = getCurrentBuild();
  if (!button || !build || button.dataset.busy === '1') return null;
  button.dataset.busy = '1';
  button.disabled = true;
  setButtonLabel(button, 'Сохраняю…');
  setSaveStatus('Записываю файлы и проект в локальную библиотеку…', 'busy');
  try {
    const { project, outputs, familyName, styleName, glyphCount, mode } = build;
    const record = await saveLibraryFont({
      projectId: project.id,
      familyName,
      styleName,
      baseName: outputs.baseName,
      mode,
      glyphCount,
      sampleText: byId('fontPreviewInput')?.value || '',
      featureSettings: mode === 'connected' ? '"rlig" 1, "calt" 1, "curs" 1' : 'normal',
      projectJson: serializeProject(project),
      files: {
        ttf: outputs.ttf,
        woff: outputs.woff,
        woff2: outputs.woff2,
        css: outputs.css,
        zip: outputs.zip,
      },
    });
    requestPersistentLibraryStorage();
    button.dataset.saved = '1';
    setButtonLabel(button, 'Сохранено в библиотеке');
    setSaveStatus(`«${record.familyName} ${record.styleName}» сохранён. Повторное добавление обновит эту запись.`, 'ok');
    window.dispatchEvent(new CustomEvent('drawyourfont:library-updated', { detail: { id: record.id } }));
    try {
      localStorage.setItem('dyfr:library-updated', String(Date.now()));
      const channel = new BroadcastChannel('draw-your-font-library');
      channel.postMessage({ type: 'updated', id: record.id });
      channel.close();
    } catch {}
    return record;
  } catch (error) {
    console.error(error);
    setButtonLabel(button, 'Добавить в библиотеку');
    setSaveStatus(error.message || 'Не удалось сохранить шрифт в библиотеку.', 'error');
    return null;
  } finally {
    delete button.dataset.busy;
    button.disabled = !getCurrentBuild();
  }
}

function watchBuildState() {
  const target = byId('fontBuilder');
  if (!target) return setTimeout(watchBuildState, 40);
  const observer = new MutationObserver(() => {
    const button = byId('addFontToLibrary');
    if (button?.dataset.saved === '1' && !getCurrentBuild()) {
      delete button.dataset.saved;
      setButtonLabel(button, 'Добавить в библиотеку');
    }
    refreshLibraryButton();
  });
  observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'data-mode'] });
  for (const eventName of ['drawyourfont:cursive-updated', 'drawyourfont:project-updated', 'drawyourfont:segmentation-updated']) {
    window.addEventListener(eventName, () => {
      const button = byId('addFontToLibrary');
      if (button) {
        delete button.dataset.saved;
        setButtonLabel(button, 'Добавить в библиотеку');
      }
      setTimeout(refreshLibraryButton, 0);
    });
  }
  setInterval(refreshLibraryButton, 1000);
  refreshLibraryButton();
}

function restoreProjectFromLibrary() {
  let payload = null;
  try { payload = sessionStorage.getItem(PENDING_PROJECT_KEY); } catch {}
  if (!payload) return;
  const attempt = () => {
    const api = window.__drawYourFontProject;
    if (!api?.importProject) return setTimeout(attempt, 50);
    try {
      Promise.resolve(api.importProject(payload)).then(() => {
        sessionStorage.removeItem(PENDING_PROJECT_KEY);
        setTimeout(() => byId('glyphEditor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      }).catch(error => console.error(error));
    } catch (error) {
      console.error(error);
    }
  };
  attempt();
}

function install() {
  ensureStylesheet();
  installLibraryNavigation();
  if (!installLibraryControls()) return setTimeout(install, 40);
  watchBuildState();
  restoreProjectFromLibrary();
  window.__drawYourFontLibraryBridge = {
    addCurrentFont,
    getCurrentBuild,
    refresh: refreshLibraryButton,
    pendingProjectKey: PENDING_PROJECT_KEY,
  };
}

install();
