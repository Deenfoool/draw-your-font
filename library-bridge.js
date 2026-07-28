import { serializeProject } from './src/project.js';
import {
  requestPersistentLibraryStorage,
  saveLibraryFont,
} from './src/font-library.js';
import {
  getPublicationOwnership,
  publicationKey,
  publishFont,
  PUBLIC_LICENSE_LABELS,
} from './src/public-library-client.js';

const PENDING_PROJECT_KEY = 'dyfr:library-open-project';
const AUTHOR_KEY = 'dyfr:public-author-name';
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
  link.innerHTML = '<span>Мои и общие шрифты</span><strong>Библиотека</strong>';
  const badge = topbar.querySelector('.stage-badge');
  if (badge) badge.before(link); else topbar.append(link);
}

function createPublishDialog() {
  if (byId('publicPublishDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'publicPublishDialog';
  dialog.className = 'public-publish-dialog';
  dialog.innerHTML = `
    <form id="publicPublishForm">
      <header>
        <div>
          <p class="eyebrow">Общая библиотека</p>
          <h2>Опубликовать шрифт для всех</h2>
          <p>На сервер отправятся только готовые файлы шрифта и данные ниже. Проект с масками и фотографии останутся у вас.</p>
        </div>
        <button id="publicPublishClose" type="button" aria-label="Закрыть">×</button>
      </header>
      <div class="public-publish-fields">
        <label><span>Имя автора</span><input id="publicAuthorName" maxlength="80" required autocomplete="name" placeholder="Как вас показать в каталоге"></label>
        <label><span>Лицензия</span><select id="publicLicense" required>
          <option value="OFL-1.1">${PUBLIC_LICENSE_LABELS['OFL-1.1']} — рекомендуется</option>
          <option value="CC0-1.0">${PUBLIC_LICENSE_LABELS['CC0-1.0']}</option>
          <option value="CC-BY-4.0">${PUBLIC_LICENSE_LABELS['CC-BY-4.0']}</option>
        </select></label>
        <label class="public-description"><span>Описание</span><textarea id="publicDescription" maxlength="500" rows="4" placeholder="Особенности почерка, поддерживаемые языки, условия использования"></textarea></label>
        <label class="public-rights"><input id="publicRights" type="checkbox" required><span>Я создал этот шрифт или имею право его публиковать и принимаю выбранную лицензию.</span></label>
      </div>
      <p id="publicPublishStatus" class="library-save-status" data-mode="idle"></p>
      <footer>
        <button id="publicPublishCancel" class="secondary-button" type="button">Отмена</button>
        <button id="publicPublishSubmit" class="primary-button" type="submit">Опубликовать</button>
      </footer>
    </form>`;
  document.body.append(dialog);
  try { byId('publicAuthorName').value = localStorage.getItem(AUTHOR_KEY) || ''; } catch {}
  const close = () => dialog.close();
  byId('publicPublishClose').addEventListener('click', close);
  byId('publicPublishCancel').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  byId('publicPublishForm').addEventListener('submit', event => {
    event.preventDefault();
    publishCurrentFont();
  });
}

function installLibraryControls() {
  const grid = document.querySelector('#fontBuilder .download-grid');
  if (!grid || byId('addFontToLibrary')) return false;
  const localButton = document.createElement('button');
  localButton.id = 'addFontToLibrary';
  localButton.type = 'button';
  localButton.className = 'library-add-button';
  localButton.disabled = true;
  localButton.hidden = true;
  localButton.textContent = 'Добавить в мою библиотеку';

  const publicButton = document.createElement('button');
  publicButton.id = 'publishFontPublicly';
  publicButton.type = 'button';
  publicButton.className = 'library-publish-button';
  publicButton.disabled = true;
  publicButton.hidden = true;
  publicButton.textContent = 'Опубликовать в общей библиотеке';

  const link = document.createElement('a');
  link.className = 'library-open-button';
  link.href = './library.html';
  link.textContent = 'Открыть библиотеку';

  const status = document.createElement('p');
  status.id = 'librarySaveStatus';
  status.className = 'library-save-status';
  status.hidden = true;
  status.textContent = 'Готовый шрифт можно сохранить или опубликовать.';

  grid.append(localButton, publicButton, link);
  grid.after(status);
  localButton.addEventListener('click', addCurrentFont);
  publicButton.addEventListener('click', () => {
    const build = getCurrentBuild();
    if (!build) return;
    const owned = getPublicationOwnership(publicationKey(build));
    byId('publicPublishSubmit').textContent = owned ? 'Обновить публикацию' : 'Опубликовать';
    byId('publicPublishStatus').textContent = owned ? 'Эта версия уже публиковалась с этого устройства. Новая отправка обновит карточку.' : '';
    byId('publicPublishStatus').dataset.mode = owned ? 'ok' : 'idle';
    byId('publicRights').checked = false;
    byId('publicPublishDialog').showModal();
  });
  return true;
}

function getCurrentBuild() {
  const project = currentProject();
  if (!project) return null;
  const downloadTtf = byId('downloadTtf');
  if (downloadTtf?.disabled) return null;
  const connectedEnabled = Boolean(project.cursive?.enabled);
  const connected = window.__drawYourFontCursive?.getState?.().outputs || null;
  const standard = window.__drawYourFontBuilder?.getState?.().outputs || null;
  const outputs = connectedEnabled ? connected : standard;
  if (!outputs?.ttf || !outputs?.woff2) return null;
  const familyName = String(byId('fontFamily')?.value || outputs.familyName || project.font?.familyName || project.title || 'Мой рукописный шрифт').trim();
  const styleName = String(byId('fontStyle')?.value || outputs.styleName || project.font?.styleName || 'Regular').trim();
  const glyphCount = connectedEnabled
    ? Number(outputs.built?.glyphs?.length || outputs.built?.layout?.glyphs?.length || project.glyphs?.length || 0)
    : Number(outputs.glyphSet?.entries?.length || project.glyphs?.length || 0);
  return { project, outputs, familyName, styleName, glyphCount, mode: connectedEnabled ? 'connected' : 'standard' };
}

function setSaveStatus(text, mode = 'idle') {
  const status = byId('librarySaveStatus');
  if (!status) return;
  if (status.textContent !== text) status.textContent = text;
  if (status.dataset.mode !== mode) status.dataset.mode = mode;
}

function refreshLibraryButtons() {
  const localButton = byId('addFontToLibrary');
  const publicButton = byId('publishFontPublicly');
  const status = byId('librarySaveStatus');
  if (!localButton || !publicButton || !status) return;
  const build = getCurrentBuild();
  const visible = Boolean(build);
  for (const button of [localButton, publicButton]) {
    if (button.hidden === visible) button.hidden = !visible;
    if (button.disabled === visible) button.disabled = !visible;
  }
  if (status.hidden === visible) status.hidden = !visible;
  if (build && localButton.dataset.busy !== '1' && publicButton.dataset.busy !== '1') {
    if (localButton.dataset.saved !== '1') setButtonLabel(localButton, 'Добавить в мою библиотеку');
    const owned = getPublicationOwnership(publicationKey(build));
    if (publicButton.dataset.published !== '1') setButtonLabel(publicButton, owned ? 'Обновить в общей библиотеке' : 'Опубликовать в общей библиотеке');
    if (localButton.dataset.saved !== '1' && publicButton.dataset.published !== '1') setSaveStatus('Готовый шрифт можно сохранить у себя или опубликовать для всех.', 'ok');
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
      files: { ttf: outputs.ttf, woff: outputs.woff, woff2: outputs.woff2, css: outputs.css, zip: outputs.zip },
    });
    requestPersistentLibraryStorage();
    button.dataset.saved = '1';
    setButtonLabel(button, 'Добавлено в мою библиотеку');
    setSaveStatus(`«${record.familyName} ${record.styleName}» сохранён только в этом браузере.`, 'ok');
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
    setButtonLabel(button, 'Добавить в мою библиотеку');
    setSaveStatus(error.message || 'Не удалось сохранить шрифт в мою библиотеку.', 'error');
    return null;
  } finally {
    delete button.dataset.busy;
    button.disabled = !getCurrentBuild();
  }
}

async function publishCurrentFont() {
  const build = getCurrentBuild();
  const button = byId('publishFontPublicly');
  const submit = byId('publicPublishSubmit');
  const modalStatus = byId('publicPublishStatus');
  const form = byId('publicPublishForm');
  if (!build || !button || !form?.reportValidity() || button.dataset.busy === '1') return null;
  button.dataset.busy = '1';
  button.disabled = true;
  submit.disabled = true;
  submit.textContent = 'Отправляю…';
  modalStatus.textContent = 'Проверяю файлы и отправляю их на сервер…';
  modalStatus.dataset.mode = 'busy';
  setSaveStatus('Публикую шрифт в общей библиотеке…', 'busy');
  const authorName = byId('publicAuthorName').value.trim();
  try {
    localStorage.setItem(AUTHOR_KEY, authorName);
    const result = await publishFont(build, {
      authorName,
      description: byId('publicDescription').value,
      license: byId('publicLicense').value,
      rightsConfirmed: byId('publicRights').checked,
    });
    button.dataset.published = '1';
    setButtonLabel(button, result.updated ? 'Публикация обновлена' : 'Опубликовано в общей библиотеке');
    const action = result.updated ? 'обновлён' : 'опубликован';
    modalStatus.textContent = `«${result.font.familyName} ${result.font.styleName}» ${action}.`;
    modalStatus.dataset.mode = 'ok';
    setSaveStatus(`Шрифт ${action} в общей библиотеке и доступен всем посетителям сайта.`, 'ok');
    window.dispatchEvent(new CustomEvent('drawyourfont:public-library-updated', { detail: { id: result.font.id } }));
    setTimeout(() => byId('publicPublishDialog')?.close(), 850);
    return result;
  } catch (error) {
    console.error(error);
    const offline = /fetch|network|failed/i.test(error.message || '');
    const message = offline ? 'Общий каталог недоступен. Запустите проект через Node-сервер командой npm start.' : (error.message || 'Не удалось опубликовать шрифт.');
    modalStatus.textContent = message;
    modalStatus.dataset.mode = 'error';
    setSaveStatus(message, 'error');
    return null;
  } finally {
    delete button.dataset.busy;
    button.disabled = !getCurrentBuild();
    submit.disabled = false;
    submit.textContent = 'Опубликовать';
  }
}

function resetBuildActions() {
  for (const id of ['addFontToLibrary', 'publishFontPublicly']) {
    const button = byId(id);
    if (!button) continue;
    delete button.dataset.saved;
    delete button.dataset.published;
  }
  setButtonLabel(byId('addFontToLibrary'), 'Добавить в мою библиотеку');
  setButtonLabel(byId('publishFontPublicly'), 'Опубликовать в общей библиотеке');
}

function watchBuildState() {
  const target = byId('fontBuilder');
  if (!target) return setTimeout(watchBuildState, 40);
  const observer = new MutationObserver(() => {
    if (!getCurrentBuild()) resetBuildActions();
    refreshLibraryButtons();
  });
  observer.observe(target, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'data-mode'] });
  for (const eventName of ['drawyourfont:cursive-updated', 'drawyourfont:project-updated', 'drawyourfont:segmentation-updated']) {
    window.addEventListener(eventName, () => { resetBuildActions(); setTimeout(refreshLibraryButtons, 0); });
  }
  setInterval(refreshLibraryButtons, 1000);
  refreshLibraryButtons();
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
    } catch (error) { console.error(error); }
  };
  attempt();
}

function install() {
  ensureStylesheet();
  installLibraryNavigation();
  createPublishDialog();
  if (!installLibraryControls()) return setTimeout(install, 40);
  watchBuildState();
  restoreProjectFromLibrary();
  window.__drawYourFontLibraryBridge = {
    addCurrentFont,
    publishCurrentFont,
    getCurrentBuild,
    refresh: refreshLibraryButtons,
    pendingProjectKey: PENDING_PROJECT_KEY,
  };
}

install();
