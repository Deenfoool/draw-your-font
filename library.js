import {
  deleteLibraryFont,
  formatLibraryBytes,
  getFontLibraryStats,
  listLibraryFonts,
  requestPersistentLibraryStorage,
} from './src/font-library.js';

const PENDING_PROJECT_KEY = 'dyfr:library-open-project';
const byId = id => document.getElementById(id);
const state = {
  fonts: [],
  faces: new Map(),
  rendering: false,
  reloadQueued: false,
  reloadPromise: null,
  channel: null,
};

function setStatus(text, mode = 'idle') {
  const element = byId('libraryStatus');
  element.textContent = text;
  element.dataset.mode = mode;
}

function humanDate(value) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch { return String(value || ''); }
}

function fontCountLabel(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} шрифтов`;
  if (mod10 === 1) return `${count} шрифт`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} шрифта`;
  return `${count} шрифтов`;
}

function download(value, name, type) {
  if (value == null) return;
  const blob = value instanceof Blob ? value : new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function currentPreviewText(record) {
  return byId('libraryPreviewText')?.value || record.sampleText || 'Съешь же ещё этих мягких французских булок.';
}

async function applyStoredFont(record, preview) {
  const existing = state.faces.get(record.id);
  if (existing) {
    preview.style.fontFamily = `'${existing.family}', sans-serif`;
    preview.style.fontFeatureSettings = record.featureSettings || 'normal';
    return;
  }
  const bytes = record.files?.woff2 || record.files?.ttf;
  if (!bytes) return;
  const family = `DYFR Library ${record.id.replace(/[^a-z0-9]/gi, '').slice(-24)} ${Date.now()}`;
  try {
    const face = new FontFace(family, bytes.slice(0), { style: record.styleName || 'normal' });
    await face.load();
    document.fonts.add(face);
    state.faces.set(record.id, { face, family });
    if (preview.isConnected) {
      preview.style.fontFamily = `'${family}', sans-serif`;
      preview.style.fontFeatureSettings = record.featureSettings || 'normal';
      preview.dataset.loaded = 'true';
    }
  } catch (error) {
    console.warn(`Не удалось загрузить предпросмотр ${record.familyName}:`, error);
    preview.dataset.loaded = 'false';
    preview.title = 'Файл сохранён, но браузер не смог показать его предпросмотр.';
  }
}

function fileButton(record, label, key, extension, mime) {
  const button = element('button', '', label);
  const value = record.files?.[key];
  button.type = 'button';
  button.disabled = value == null || (typeof value === 'string' ? !value : !value.byteLength);
  button.addEventListener('click', () => download(value, key === 'css' ? 'font.css' : `${record.baseName}.${extension}`, mime));
  return button;
}

function metaPill(label, value) {
  const pill = element('span');
  const strong = element('strong', '', `${value}`);
  pill.append(strong, document.createTextNode(` ${label}`));
  return pill;
}

function createCard(record) {
  const card = element('article', 'card library-font-card');
  card.dataset.id = record.id;

  const header = element('header', 'library-font-header');
  const titleBox = element('div');
  titleBox.append(element('h2', '', record.familyName), element('p', '', `${record.styleName} · обновлён ${humanDate(record.updatedAt)}`));
  const mode = element('span', `library-mode${record.mode === 'connected' ? ' connected' : ''}`, record.mode === 'connected' ? 'Связный' : 'Обычный');
  header.append(titleBox, mode);

  const preview = element('div', 'library-font-preview', currentPreviewText(record));
  preview.setAttribute('aria-label', `Предпросмотр ${record.familyName}`);

  const body = element('div', 'library-font-body');
  const meta = element('div', 'library-meta');
  meta.append(
    metaPill('глифов', record.glyphCount || 0),
    metaPill('TTF', formatLibraryBytes(record.sizes?.ttf || 0)),
    metaPill('WOFF2', formatLibraryBytes(record.sizes?.woff2 || 0)),
    metaPill('всего', formatLibraryBytes(record.totalBytes || 0)),
  );

  const files = element('div', 'library-file-actions');
  files.append(
    fileButton(record, 'TTF', 'ttf', 'ttf', 'font/ttf'),
    fileButton(record, 'WOFF2', 'woff2', 'woff2', 'font/woff2'),
    fileButton(record, 'CSS', 'css', 'css', 'text/css;charset=utf-8'),
    fileButton(record, 'ZIP', 'zip', 'zip', 'application/zip'),
  );

  const actions = element('div', 'library-card-actions');
  const open = element('button', 'library-open-project', 'Открыть проект в редакторе');
  open.type = 'button';
  open.disabled = !record.projectJson;
  open.addEventListener('click', () => {
    try {
      sessionStorage.setItem(PENDING_PROJECT_KEY, record.projectJson);
      location.href = './index.html#glyphEditor';
    } catch (error) {
      setStatus(error.message || 'Не удалось передать проект в редактор.', 'error');
    }
  });
  const remove = element('button', 'library-delete', 'Удалить');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm(`Удалить «${record.familyName} ${record.styleName}» из библиотеки?`)) return;
    setStatus('Удаляю шрифт…', 'busy');
    await deleteLibraryFont(record.id);
    const storedFace = state.faces.get(record.id);
    if (storedFace) {
      try { document.fonts.delete(storedFace.face); } catch {}
      state.faces.delete(record.id);
    }
    await reload();
  });
  actions.append(open, remove);

  body.append(meta, files, actions);
  card.append(header, preview, body);
  applyStoredFont(record, preview);
  return card;
}

function filteredFonts() {
  const query = String(byId('librarySearch')?.value || '').trim().toLocaleLowerCase('ru-RU');
  const sort = byId('librarySort')?.value || 'updated-desc';
  const result = state.fonts.filter(record => {
    if (!query) return true;
    return `${record.familyName} ${record.styleName} ${record.mode}`.toLocaleLowerCase('ru-RU').includes(query);
  });
  result.sort((left, right) => {
    if (sort === 'updated-asc') return String(left.updatedAt).localeCompare(String(right.updatedAt));
    if (sort === 'name-asc') return left.familyName.localeCompare(right.familyName, 'ru', { sensitivity: 'base' });
    if (sort === 'name-desc') return right.familyName.localeCompare(left.familyName, 'ru', { sensitivity: 'base' });
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
  return result;
}

function render() {
  const grid = byId('libraryGrid');
  const fonts = filteredFonts();
  grid.replaceChildren();
  if (!state.fonts.length) {
    grid.append(byId('libraryEmptyTemplate').content.cloneNode(true));
    return;
  }
  if (!fonts.length) {
    grid.append(element('div', 'library-no-results', 'По этому запросу шрифты не найдены.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  fonts.forEach(record => fragment.append(createCard(record)));
  grid.append(fragment);
}

function updatePreviewText() {
  const text = byId('libraryPreviewText').value;
  document.querySelectorAll('.library-font-card').forEach(card => {
    const record = state.fonts.find(item => item.id === card.dataset.id);
    const preview = card.querySelector('.library-font-preview');
    if (preview) preview.textContent = text || record?.sampleText || '';
  });
}

function cleanupUnusedFaces() {
  const ids = new Set(state.fonts.map(item => item.id));
  for (const [id, stored] of state.faces) {
    if (ids.has(id)) continue;
    try { document.fonts.delete(stored.face); } catch {}
    state.faces.delete(id);
  }
}

async function updateStats() {
  const stats = await getFontLibraryStats();
  byId('libraryCount').textContent = stats.count ? fontCountLabel(stats.count) : 'Библиотека пуста';
  const parts = [`Файлы библиотеки: ${formatLibraryBytes(stats.libraryBytes)}`];
  if (stats.usage != null && stats.quota != null) parts.push(`браузер использует ${formatLibraryBytes(stats.usage)} из ${formatLibraryBytes(stats.quota)}`);
  if (stats.persistent) parts.push('защита от автоочистки включена');
  byId('libraryStorage').textContent = parts.join(' · ');
  byId('libraryPersist').disabled = stats.persistent;
  byId('libraryPersist').textContent = stats.persistent ? 'Хранилище защищено' : 'Защитить от автоочистки';
}

async function reload() {
  if (state.rendering) {
    state.reloadQueued = true;
    return state.reloadPromise;
  }
  state.rendering = true;
  state.reloadPromise = (async () => {
    setStatus('Обновляю библиотеку…', 'busy');
    try {
      state.fonts = await listLibraryFonts();
      cleanupUnusedFaces();
      render();
      await updateStats();
      setStatus(state.fonts.length ? 'Библиотека готова.' : 'Добавьте первый шрифт из редактора.', 'ok');
    } catch (error) {
      console.error(error);
      byId('libraryGrid').replaceChildren(element('div', 'card library-empty', error.message || 'Не удалось открыть библиотеку.'));
      setStatus(error.message || 'Не удалось открыть библиотеку.', 'error');
    }
  })();
  try {
    return await state.reloadPromise;
  } finally {
    state.rendering = false;
    state.reloadPromise = null;
    if (state.reloadQueued) {
      state.reloadQueued = false;
      queueMicrotask(() => reload());
    }
  }
}

byId('librarySearch').addEventListener('input', render);
byId('librarySort').addEventListener('change', render);
byId('libraryPreviewText').addEventListener('input', updatePreviewText);
byId('libraryPersist').addEventListener('click', async () => {
  setStatus('Запрашиваю постоянное локальное хранение…', 'busy');
  const persistent = await requestPersistentLibraryStorage();
  await updateStats();
  setStatus(persistent ? 'Браузер подтвердил защиту библиотеки от автоматической очистки.' : 'Браузер не предоставил постоянное хранение. Экспортируйте важные проекты в JSON.', persistent ? 'ok' : 'error');
});

try {
  state.channel = new BroadcastChannel('draw-your-font-library');
  state.channel.addEventListener('message', event => { if (event.data?.type === 'updated') reload(); });
} catch {}

window.addEventListener('storage', event => { if (event.key === 'dyfr:library-updated') reload(); });
window.__drawYourFontLibraryPage = {
  reload,
  getState: () => ({ fonts: state.fonts, loadedFaces: state.faces.size, rendering: state.rendering }),
};
reload();
