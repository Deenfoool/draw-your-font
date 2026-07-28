import {
  deletePublicFont,
  getOwnerTokenForPublicId,
  listPublicFonts,
  publicFileUrl,
  PUBLIC_LICENSE_LABELS,
} from './src/public-library-client.js';
import { formatLibraryBytes } from './src/font-library.js';

const byId = id => document.getElementById(id);
const state = { fonts: [], faces: new Map(), loading: false, loaded: false, active: 'local' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setPublicStatus(text, mode = 'idle') {
  const status = byId('publicLibraryStatus');
  status.textContent = text;
  status.dataset.mode = mode;
}

function humanDate(value) {
  try { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return String(value || ''); }
}

function fontFaceDescriptors(styleName) {
  const value = String(styleName || '').toLowerCase();
  return {
    style: value.includes('italic') ? 'italic' : value.includes('oblique') ? 'oblique' : 'normal',
    weight: value.includes('bold') ? '700' : '400',
  };
}

function switchTab(tab) {
  state.active = tab === 'public' ? 'public' : 'local';
  byId('localLibraryPanel').hidden = state.active !== 'local';
  byId('publicLibraryPanel').hidden = state.active !== 'public';
  for (const button of document.querySelectorAll('.library-tab')) {
    const active = button.dataset.tab === state.active;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  if (state.active === 'public' && !state.loaded) reloadPublicLibrary();
}

async function applyPublicFont(record, preview) {
  const existing = state.faces.get(record.id);
  if (existing) {
    preview.style.fontFamily = `'${existing.family}', sans-serif`;
    preview.style.fontFeatureSettings = record.featureSettings || 'normal';
    return;
  }
  if (!record.availableFiles?.includes('woff2') && !record.availableFiles?.includes('ttf')) return;
  const sourceKey = record.availableFiles.includes('woff2') ? 'woff2' : 'ttf';
  const family = `DYFR Public ${record.id.replace(/[^a-z0-9]/gi, '').slice(-24)}`;
  try {
    const face = new FontFace(family, `url(${JSON.stringify(publicFileUrl(record.id, sourceKey))})`, fontFaceDescriptors(record.styleName));
    await face.load();
    document.fonts.add(face);
    state.faces.set(record.id, { face, family });
    if (preview.isConnected) {
      preview.style.fontFamily = `'${family}', sans-serif`;
      preview.style.fontFeatureSettings = record.featureSettings || 'normal';
      preview.dataset.loaded = 'true';
    }
  } catch (error) {
    console.warn(`Не удалось показать ${record.familyName}:`, error);
    preview.dataset.loaded = 'false';
    preview.title = 'Предпросмотр недоступен, но файлы можно скачать.';
  }
}

function downloadLink(record, key, label) {
  const link = element('a', 'public-file-link', label);
  link.href = publicFileUrl(record.id, key, true);
  link.hidden = !record.availableFiles?.includes(key);
  return link;
}

function createPublicCard(record) {
  const card = element('article', 'card library-font-card public-font-card');
  card.dataset.id = record.id;
  const header = element('header', 'library-font-header');
  const title = element('div');
  title.append(
    element('h2', '', record.familyName),
    element('p', '', `${record.styleName} · автор ${record.authorName} · ${humanDate(record.updatedAt)}`),
  );
  const mode = element('span', `library-mode${record.mode === 'connected' ? ' connected' : ''}`, record.mode === 'connected' ? 'Связный' : 'Обычный');
  header.append(title, mode);

  const previewText = byId('publicLibraryPreviewText').value || record.sampleText || 'Съешь же ещё этих мягких французских булок.';
  const preview = element('div', 'library-font-preview', previewText);
  preview.setAttribute('aria-label', `Предпросмотр ${record.familyName}`);

  const body = element('div', 'library-font-body');
  if (record.description) body.append(element('p', 'public-font-description', record.description));
  const meta = element('div', 'library-meta');
  const license = element('span');
  license.append(element('strong', '', PUBLIC_LICENSE_LABELS[record.license] || record.license));
  const glyphs = element('span');
  glyphs.append(element('strong', '', String(record.glyphCount || 0)), document.createTextNode(' глифов'));
  const size = element('span');
  size.append(element('strong', '', formatLibraryBytes(record.totalBytes || 0)), document.createTextNode(' файлов'));
  meta.append(license, glyphs, size);

  const files = element('div', 'library-file-actions public-file-actions');
  files.append(
    downloadLink(record, 'ttf', 'Скачать TTF'),
    downloadLink(record, 'woff2', 'Скачать WOFF2'),
    downloadLink(record, 'css', 'Скачать CSS'),
    downloadLink(record, 'zip', 'Скачать ZIP'),
  );

  const actions = element('div', 'library-card-actions');
  if (getOwnerTokenForPublicId(record.id)) {
    const remove = element('button', 'library-delete public-delete', 'Удалить мою публикацию');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm(`Удалить «${record.familyName} ${record.styleName}» из общей библиотеки?`)) return;
      remove.disabled = true;
      setPublicStatus('Удаляю публикацию…', 'busy');
      try {
        await deletePublicFont(record.id);
        const stored = state.faces.get(record.id);
        if (stored) {
          try { document.fonts.delete(stored.face); } catch {}
          state.faces.delete(record.id);
        }
        await reloadPublicLibrary();
      } catch (error) {
        remove.disabled = false;
        setPublicStatus(error.message || 'Не удалось удалить публикацию.', 'error');
      }
    });
    actions.append(remove);
  }

  body.append(meta, files, actions);
  card.append(header, preview, body);
  applyPublicFont(record, preview);
  return card;
}

function filteredPublicFonts() {
  const query = String(byId('publicLibrarySearch').value || '').trim().toLocaleLowerCase('ru-RU');
  const sort = byId('publicLibrarySort').value;
  const result = state.fonts.filter(record => !query || `${record.familyName} ${record.styleName} ${record.authorName} ${record.description}`.toLocaleLowerCase('ru-RU').includes(query));
  result.sort((left, right) => {
    if (sort === 'updated-asc') return String(left.updatedAt).localeCompare(String(right.updatedAt));
    if (sort === 'name-asc') return left.familyName.localeCompare(right.familyName, 'ru', { sensitivity: 'base' });
    if (sort === 'name-desc') return right.familyName.localeCompare(left.familyName, 'ru', { sensitivity: 'base' });
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
  return result;
}

function renderPublicLibrary() {
  const grid = byId('publicLibraryGrid');
  grid.replaceChildren();
  const fonts = filteredPublicFonts();
  if (!state.fonts.length) {
    const empty = element('div', 'card library-empty');
    empty.append(element('strong', '', 'В общей библиотеке пока нет шрифтов'), element('p', '', 'Соберите первый шрифт и опубликуйте его из редактора.'));
    grid.append(empty);
    return;
  }
  if (!fonts.length) {
    grid.append(element('div', 'library-no-results', 'По этому запросу публичные шрифты не найдены.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  fonts.forEach(record => fragment.append(createPublicCard(record)));
  grid.append(fragment);
}

function updatePublicPreview() {
  const text = byId('publicLibraryPreviewText').value;
  document.querySelectorAll('#publicLibraryGrid .library-font-preview').forEach(preview => { preview.textContent = text; });
}

async function reloadPublicLibrary() {
  if (state.loading) return;
  state.loading = true;
  setPublicStatus('Загружаю общий каталог…', 'busy');
  try {
    const result = await listPublicFonts();
    state.fonts = result.fonts || [];
    state.loaded = true;
    byId('publicLibraryCount').textContent = state.fonts.length ? `${state.fonts.length} в общем каталоге` : 'Общий каталог пуст';
    renderPublicLibrary();
    setPublicStatus(state.fonts.length ? 'Общая библиотека готова.' : 'Опубликуйте первый шрифт.', 'ok');
  } catch (error) {
    console.error(error);
    state.loaded = false;
    byId('publicLibraryCount').textContent = 'Сервер общей библиотеки недоступен';
    const empty = element('div', 'card library-empty');
    empty.append(
      element('strong', '', 'Общая библиотека требует Node-сервер'),
      element('p', '', 'Запустите проект командой npm start. Обычный статический сервер поддерживает только локальную библиотеку.'),
    );
    byId('publicLibraryGrid').replaceChildren(empty);
    setPublicStatus(error.message || 'Не удалось загрузить общий каталог.', 'error');
  } finally {
    state.loading = false;
  }
}

document.querySelectorAll('.library-tab').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.tab)));
byId('publicLibrarySearch').addEventListener('input', renderPublicLibrary);
byId('publicLibrarySort').addEventListener('change', renderPublicLibrary);
byId('publicLibraryPreviewText').addEventListener('input', updatePublicPreview);
byId('publicLibraryRefresh').addEventListener('click', reloadPublicLibrary);
window.addEventListener('drawyourfont:public-library-updated', reloadPublicLibrary);
window.__drawYourFontPublicLibrary = {
  reload: reloadPublicLibrary,
  switchTab,
  getState: () => ({ fonts: state.fonts, loading: state.loading, loaded: state.loaded, active: state.active }),
};
switchTab(location.hash === '#public' ? 'public' : 'local');
