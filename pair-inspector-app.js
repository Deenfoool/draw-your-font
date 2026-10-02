import { ensureCursiveProject } from './src/cursive-font.js';
import { inspectRussianPair, inspectRussianPairMatrix } from './src/pair-inspector.js';

const state = { matrix: null, selectedPair: 'мо', filter: 'problems', running: false };
const byId = (id) => document.getElementById(id);
const currentProject = () => window.__drawYourFontProject?.getProject?.() || null;

function ensureStylesheet() {
  if (document.querySelector('link[data-dyfr-pair-inspector]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './pair-inspector.css';
  link.dataset.dyfrPairInspector = '1';
  document.head.append(link);
}

function setStatus(message, mode = 'idle') {
  const element = byId('pairInspectorStatus');
  if (!element) return;
  element.textContent = message;
  element.dataset.mode = mode;
}

function filterMatches(result) {
  if (state.filter === 'all') return true;
  if (state.filter === 'problems') return result.status === 'review' || result.status === 'bad';
  return result.status === state.filter;
}

function statusLabel(status) {
  return { good: 'норма', review: 'проверить', bad: 'ошибка', missing: 'нет буквы', disconnected: 'отключено' }[status] || status;
}

function renderSummary() {
  const host = byId('pairInspectorSummary');
  if (!host || !state.matrix) return;
  const { counts, total, inspected, averageScore } = state.matrix;
  host.innerHTML = `
    <span><strong>${total}</strong> пар</span>
    <span><strong>${inspected}</strong> проверено</span>
    <span><strong>${averageScore}%</strong> средняя оценка</span>
    <span><strong>${counts.good || 0}</strong> норма</span>
    <span><strong>${counts.review || 0}</strong> проверить</span>
    <span><strong>${counts.bad || 0}</strong> ошибки</span>
    <span><strong>${counts.missing || 0}</strong> нет глифа</span>`;
}

function selectPair(pair) {
  state.selectedPair = pair;
  renderMatrixSelection();
  const project = currentProject();
  if (!project) return;
  const result = state.matrix?.byPair?.[pair] || inspectRussianPair(project, ...pair);
  renderDetail(result);
}

function renderMatrixSelection() {
  document.querySelectorAll('.pair-cell').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.pair === state.selectedPair);
  });
}

function renderMatrix() {
  const host = byId('pairInspectorMatrix');
  if (!host || !state.matrix) return;
  host.replaceChildren();
  const corner = document.createElement('span');
  corner.className = 'pair-matrix-header';
  corner.textContent = '↘';
  host.append(corner);
  for (const character of state.matrix.characters) {
    const header = document.createElement('span');
    header.className = 'pair-matrix-header';
    header.textContent = character;
    host.append(header);
  }
  for (const left of state.matrix.characters) {
    const label = document.createElement('span');
    label.className = 'pair-matrix-row-label';
    label.textContent = left;
    host.append(label);
    for (const right of state.matrix.characters) {
      const result = state.matrix.byPair[`${left}${right}`];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `pair-cell ${result.status}${filterMatches(result) ? '' : ' is-filtered'}`;
      button.dataset.pair = result.pair;
      button.textContent = result.score || '·';
      button.title = `${result.pair}: ${statusLabel(result.status)}, ${result.score}%${result.reasons.length ? `\n${result.reasons.join('\n')}` : ''}`;
      button.setAttribute('aria-label', `${result.pair}: ${statusLabel(result.status)}, ${result.score}%`);
      button.addEventListener('click', () => selectPair(result.pair));
      host.append(button);
    }
  }
  renderMatrixSelection();
}

function drawGenerated(context, generated, ox, oy, scale, fillStyle) {
  context.fillStyle = fillStyle;
  for (let y = 0; y < generated.height; y += 1) for (let x = 0; x < generated.width; x += 1) {
    if (generated.mask[y * generated.width + x]) context.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
  }
}

function drawPair(result) {
  const canvas = byId('pairInspectorCanvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!result.geometry) {
    context.fillStyle = '#64748b';
    context.font = '20px system-ui';
    context.textAlign = 'center';
    context.fillText(result.reasons[0] || 'Пара недоступна', canvas.width / 2, canvas.height / 2);
    return;
  }
  const { left, right, rightX, leftOffsetY, rightOffsetY, baseline } = result.geometry;
  const totalWidth = Math.max(left.width, rightX + right.width);
  const totalHeight = Math.max(left.height + leftOffsetY, right.height + rightOffsetY);
  const scale = Math.min((canvas.width - 50) / Math.max(1, totalWidth), (canvas.height - 50) / Math.max(1, totalHeight));
  const ox = (canvas.width - totalWidth * scale) / 2;
  const oy = (canvas.height - totalHeight * scale) / 2;
  const baselineY = oy + baseline * scale;
  context.strokeStyle = '#dc2626';
  context.lineWidth = 1.5;
  context.setLineDash([8, 6]);
  context.beginPath(); context.moveTo(12, baselineY); context.lineTo(canvas.width - 12, baselineY); context.stroke();
  context.setLineDash([]);
  drawGenerated(context, left, ox, oy + leftOffsetY * scale, scale, '#111827');
  drawGenerated(context, right, ox + rightX * scale, oy + rightOffsetY * scale, scale, '#334155');
  const seamX = ox + (left.width - 1) * scale;
  context.strokeStyle = result.status === 'bad' ? '#dc2626' : result.status === 'review' ? '#d97706' : '#16a34a';
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(seamX, 16); context.lineTo(seamX, canvas.height - 16); context.stroke();
}

function loadOverride(result) {
  const project = currentProject();
  const cursive = project ? ensureCursiveProject(project) : null;
  const key = `${result.leftCharacter}|${result.rightCharacter}`;
  const override = cursive?.pairOverrides?.[key] || {};
  byId('pairOverrideConnect').value = override.connect == null ? 'auto' : override.connect ? 'on' : 'off';
  byId('pairOverrideExit').value = override.exitClass || 'auto';
  byId('pairOverrideSpacing').value = Number(override.spacing || 0);
}

function renderDetail(result) {
  const title = byId('pairInspectorPair');
  const badge = byId('pairInspectorPairStatus');
  const metrics = byId('pairInspectorMetrics');
  const reasons = byId('pairInspectorReasons');
  if (!title || !badge || !metrics || !reasons) return;
  title.textContent = result.pair || '—';
  badge.className = `pair-status ${result.status}`;
  badge.textContent = `${statusLabel(result.status)} · ${result.score}%`;
  const value = (number, digits = 1) => Number.isFinite(number) ? Number(number).toFixed(digits) : '—';
  metrics.innerHTML = result.metrics ? `
    <span>выход: <strong>${result.metrics.exitClass}</strong></span>
    <span>вход: <strong>${result.metrics.entryClass}</strong></span>
    <span>режим: <strong>${result.metrics.entryProfile}</strong></span>
    <span>скачок: <strong>${value(result.metrics.verticalJump)} px</strong></span>
    <span>разрыв: <strong>${value(result.metrics.seamDistance)} px</strong></span>
    <span>толщина: <strong>${result.metrics.leftThickness}/${result.metrics.rightThickness}</strong></span>
    <span>наложение: <strong>${result.metrics.overlapPixels}</strong></span>
    <span>промежуток: <strong>${value(result.metrics.bodyGap)} px</strong></span>` : '<span>Геометрия недоступна.</span>';
  reasons.replaceChildren(...(result.reasons.length ? result.reasons : ['Автоматических проблем не найдено.']).map((reason) => {
    const item = document.createElement('li'); item.textContent = reason; return item;
  }));
  loadOverride(result);
  drawPair(result);
}

async function runInspection(options = {}) {
  if (state.running) return state.matrix;
  const project = currentProject();
  if (!project) { setStatus('Сначала создайте или загрузите проект.', 'error'); return null; }
  state.running = true;
  byId('pairInspectorRun').disabled = true;
  setStatus('Проверяю русские пары…', 'busy');
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    state.matrix = inspectRussianPairMatrix(project, options);
    renderSummary();
    renderMatrix();
    if (!state.matrix.byPair[state.selectedPair]) state.selectedPair = state.matrix.pairs.find((pair) => pair.status === 'bad' || pair.status === 'review')?.pair || state.matrix.pairs[0]?.pair || '';
    if (state.selectedPair) selectPair(state.selectedPair);
    setStatus(`Проверено ${state.matrix.inspected} из ${state.matrix.total} пар.`, 'ok');
    return state.matrix;
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Не удалось проверить пары.', 'error');
    return null;
  } finally {
    state.running = false;
    byId('pairInspectorRun').disabled = false;
  }
}

function saveOverride(reset = false) {
  const project = currentProject();
  if (!project || !state.selectedPair) return;
  const [leftCharacter, rightCharacter] = [...state.selectedPair];
  const key = `${leftCharacter}|${rightCharacter}`;
  const cursive = ensureCursiveProject(project);
  if (reset) delete cursive.pairOverrides[key];
  else {
    const override = {};
    const connect = byId('pairOverrideConnect').value;
    const exitClass = byId('pairOverrideExit').value;
    const spacing = Number(byId('pairOverrideSpacing').value || 0);
    if (connect !== 'auto') override.connect = connect === 'on';
    if (exitClass !== 'auto') override.exitClass = exitClass;
    if (spacing) override.spacing = spacing;
    if (Object.keys(override).length) cursive.pairOverrides[key] = override; else delete cursive.pairOverrides[key];
  }
  project.updatedAt = new Date().toISOString();
  window.dispatchEvent(new CustomEvent('drawyourfont:cursive-updated'));
  runInspection();
}

function install() {
  if (byId('pairInspector')) return;
  const builder = byId('cursiveBuilder');
  if (!builder) return setTimeout(install, 50);
  ensureStylesheet();
  const section = document.createElement('section');
  section.className = 'card pair-inspector-card';
  section.id = 'pairInspector';
  section.innerHTML = `
    <div class="flow-header"><div><p class="eyebrow">Шаг 3.6</p><h2>Проверка соединений</h2><p>Матрица всех 1089 сочетаний русских строчных букв с автоматической диагностикой стыка.</p></div><span class="stage-pill">33 × 33 · gaps · jumps · collisions</span></div>
    <div class="pair-inspector-toolbar">
      <button class="primary-button compact" id="pairInspectorRun" type="button">Проверить все пары</button>
      <label>Показывать<select id="pairInspectorFilter"><option value="problems">Только проблемы</option><option value="bad">Только ошибки</option><option value="review">Требуют проверки</option><option value="good">Без ошибок</option><option value="missing">Отсутствующие</option><option value="all">Все пары</option></select></label>
      <small class="pair-inspector-status" id="pairInspectorStatus" data-mode="idle">Проверка ещё не запускалась.</small>
    </div>
    <div class="pair-inspector-summary" id="pairInspectorSummary"></div>
    <div class="pair-matrix-shell"><div class="pair-matrix" id="pairInspectorMatrix"></div></div>
    <div class="pair-detail">
      <canvas id="pairInspectorCanvas" width="900" height="330"></canvas>
      <div class="pair-detail-panel">
        <div class="pair-detail-title"><strong id="pairInspectorPair">—</strong><span class="pair-status missing" id="pairInspectorPairStatus">не выбрано</span></div>
        <div class="pair-metrics" id="pairInspectorMetrics"></div>
        <ul class="pair-reasons" id="pairInspectorReasons"></ul>
        <div class="pair-override">
          <label>Соединение<select id="pairOverrideConnect"><option value="auto">Автоматически</option><option value="on">Включить</option><option value="off">Отключить</option></select></label>
          <label>Класс выхода<select id="pairOverrideExit"><option value="auto">По следующей букве</option><option value="upper">Верхний</option><option value="middle">Средний</option><option value="lower">Нижний</option><option value="special">Особый</option></select></label>
          <label>Интервал<input id="pairOverrideSpacing" type="number" min="-40" max="80" step="1" value="0"></label>
          <div class="pair-override-actions"><button class="secondary-button compact" id="pairOverrideSave" type="button">Сохранить исключение</button><button class="ghost-button compact" id="pairOverrideReset" type="button">Сбросить</button></div>
        </div>
      </div>
    </div>`;
  builder.after(section);
  byId('pairInspectorRun').addEventListener('click', () => runInspection());
  byId('pairInspectorFilter').addEventListener('change', (event) => { state.filter = event.target.value; renderMatrix(); });
  byId('pairOverrideSave').addEventListener('click', () => saveOverride(false));
  byId('pairOverrideReset').addEventListener('click', () => saveOverride(true));
}

window.addEventListener('drawyourfont:project-updated', () => {
  state.matrix = null;
  setStatus('Проект изменился. Запустите проверку заново.', 'idle');
});

window.__drawYourFontPairInspector = {
  run: runInspection,
  inspect: (left, right) => {
    const project = currentProject();
    return project ? inspectRussianPair(project, left, right) : null;
  },
  select: selectPair,
  getState: () => ({ ...state }),
};

install();
