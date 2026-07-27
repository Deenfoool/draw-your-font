import {
  buildCursiveTrueTypeFont,
  ensureCursiveProject,
  generateCursiveFormMask,
  simulateCursiveForms,
  validateCursiveTrueType,
} from './src/cursive-font.js';
import { buildFontCss, buildStoredZip, buildWoffFont } from './src/font-builder.js';
import { encodeWoff2 } from './src/woff2-loader.js';

const FONT_SETTING_IDS = ['fontFamily','fontStyle','fontDetail','fontSimplify','fontSideBearing','fontGlyphHeight'];
const FORM_LABELS = { isol: 'Одиночная', init: 'Начальная', medi: 'Средняя', fina: 'Конечная' };
const state = { selectedChar: '', selectedForm: 'medi', outputs: null, previewFace: null, dragging: null, building: false };
const byId = (id) => document.getElementById(id);
const currentProject = () => window.__drawYourFontProject?.getProject?.() || null;

function safeName(value) {
  return String(value || 'my-handwriting').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'my-handwriting';
}
function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type }); const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function setFontStatus(text, mode = 'busy') { const status = byId('fontStatus'); if (status) { status.textContent = text; status.dataset.mode = mode; } }
function invalidateConnectedOutputs() {
  state.outputs = null;
  for (const id of ['downloadTtf','downloadWoff','downloadWoff2','downloadCss','downloadFontZip']) { const button = byId(id); if (button) button.disabled = true; }
  const stats = byId('fontOutputStats'); if (stats) stats.textContent = 'Настройки изменены. Соберите шрифт заново.';
}
function markChanged() {
  const project = currentProject(); if (project) project.updatedAt = new Date().toISOString();
  invalidateConnectedOutputs(); renderAll();
  window.dispatchEvent(new CustomEvent('drawyourfont:cursive-updated'));
}

function installCard() {
  if (byId('cursiveBuilder')) return;
  const fontCard = byId('fontBuilder'); if (!fontCard) return setTimeout(installCard, 40);
  const section = document.createElement('section'); section.className = 'card cursive-card'; section.id = 'cursiveBuilder';
  section.innerHTML = `
    <div class="flow-header"><div><p class="eyebrow">Шаг 3.5</p><h2>Связный русский почерк</h2><p>Создаёт формы isol/init/medi/fina и настоящие OpenType-соединения GSUB/GPOS.</p></div><span class="stage-pill">calt · rlig · curs</span></div>
    <div class="cursive-layout">
      <aside class="cursive-controls">
        <label class="cursive-enable"><input id="cursiveEnabled" type="checkbox"><span><strong>Включить связный почерк</strong><small>Обычный шрифт останется доступен после отключения.</small></span></label>
        <label>Буква<select id="cursiveCharacter"></select></label>
        <div class="cursive-joins"><label><input id="cursiveJoinLeft" type="checkbox"> Соединять слева</label><label><input id="cursiveJoinRight" type="checkbox"> Соединять справа</label></div>
        <label>Высота соединения <output id="cursiveConnectionYValue"></output><input id="cursiveConnectionY" type="range" min="45" max="94" value="76"></label>
        <label>Длина хвоста <output id="cursiveTailValue"></output><input id="cursiveTail" type="range" min="8" max="80" value="34"></label>
        <label>Толщина <output id="cursiveThicknessValue"></output><input id="cursiveThickness" type="range" min="1" max="8" step="0.25" value="2.25"></label>
        <label>Плавность <output id="cursiveSmoothnessValue"></output><input id="cursiveSmoothness" type="range" min="0" max="100" value="62"></label>
        <p class="cursive-help">Перетащите синюю входную и зелёную выходную точки прямо на букве.</p>
      </aside>
      <div>
        <div class="cursive-canvas-shell"><canvas id="cursiveAnchorCanvas" width="900" height="430"></canvas><div id="cursiveEmpty">Создайте проект со строчными буквами.</div></div>
        <div class="cursive-form-adjustments">
          <label>Форма<select id="cursiveFormSelect"><option value="isol">Одиночная</option><option value="init">Начальная</option><option value="medi">Средняя</option><option value="fina">Конечная</option></select></label>
          <label>Сдвиг X<input id="cursiveFormX" type="number" min="-50" max="50" value="0"></label>
          <label>Сдвиг Y<input id="cursiveFormY" type="number" min="-50" max="50" value="0"></label>
          <label>Масштаб<input id="cursiveFormScale" type="number" min="0.55" max="1.8" step="0.05" value="1"></label>
        </div>
        <div class="cursive-forms" id="cursiveForms"></div>
        <div class="cursive-word-preview"><label>Проверка слова<input id="cursivePreviewText" value="мама школа ручка русский"></label><canvas id="cursiveWordCanvas" width="1100" height="230"></canvas><p id="cursiveSequence"></p></div>
      </div>
    </div>`;
  fontCard.before(section); bind(); renderAll();
}

function getData() {
  const project = currentProject(); if (!project) return { project: null, cursive: null, glyph: null, config: null };
  const cursive = ensureCursiveProject(project); const glyph = project.glyphs.find((item) => item.char === state.selectedChar) || null;
  return { project, cursive, glyph, config: glyph ? cursive.glyphs[glyph.char] : null };
}
function updateCharacters() {
  const select = byId('cursiveCharacter'); const project = currentProject(); if (!select || !project) return;
  const chars = project.glyphs.map((glyph) => glyph.char).filter((char) => /^[а-яё]$/u.test(char));
  const previous = state.selectedChar; select.replaceChildren(...chars.map((char) => { const option = document.createElement('option'); option.value = char; option.textContent = char; return option; }));
  state.selectedChar = chars.includes(previous) ? previous : chars[0] || ''; select.value = state.selectedChar;
}
function drawMask(canvas, generated, options = {}) {
  const context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min((canvas.width - 30) / generated.width, (canvas.height - 30) / generated.height); const ox = (canvas.width - generated.width * scale) / 2; const oy = (canvas.height - generated.height * scale) / 2;
  context.fillStyle = '#111827';
  for (let y = 0; y < generated.height; y += 1) for (let x = 0; x < generated.width; x += 1) if (generated.mask[y * generated.width + x]) context.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
  if (options.anchors) {
    const point = (position, color, label) => { context.beginPath(); context.fillStyle = color; context.arc(ox + position.x * scale, oy + position.y * scale, 11, 0, Math.PI * 2); context.fill(); context.fillStyle = '#fff'; context.font = 'bold 13px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, ox + position.x * scale, oy + position.y * scale); };
    point(generated.entry, '#2563eb', 'L'); point(generated.exit, '#16a34a', 'R');
    canvas.dataset.ox = ox; canvas.dataset.oy = oy; canvas.dataset.scale = scale;
  }
}
function renderAnchor() {
  const canvas = byId('cursiveAnchorCanvas'); const empty = byId('cursiveEmpty'); const { cursive, glyph, config } = getData(); if (!canvas) return;
  if (!glyph || !config) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); if (empty) empty.hidden = false; return; }
  if (empty) empty.hidden = true; const generated = generateCursiveFormMask(glyph, 'isol', cursive, config); drawMask(canvas, generated, { anchors: true });
}
function renderForms() {
  const host = byId('cursiveForms'); const { cursive, glyph, config } = getData(); if (!host) return; host.replaceChildren(); if (!glyph || !config) return;
  for (const form of ['isol','init','medi','fina']) {
    const card = document.createElement('button'); card.type = 'button'; card.className = `cursive-form${state.selectedForm === form ? ' is-active' : ''}`; card.dataset.form = form;
    const title = document.createElement('strong'); title.textContent = FORM_LABELS[form]; const canvas = document.createElement('canvas'); canvas.width = 280; canvas.height = 190;
    card.append(title, canvas); card.addEventListener('click', () => { state.selectedForm = form; byId('cursiveFormSelect').value = form; renderAll(); }); host.append(card);
    drawMask(canvas, generateCursiveFormMask(glyph, form, cursive, config));
  }
}
function renderWord() {
  const canvas = byId('cursiveWordCanvas'); const sequence = byId('cursiveSequence'); const project = currentProject(); if (!canvas || !project) return;
  const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); const items = simulateCursiveForms(byId('cursivePreviewText')?.value || '', project); let x = 24; const baseline = 185;
  for (const item of items) {
    const glyph = project.glyphs.find((candidate) => candidate.char === item.char); if (!glyph) { x += item.char === ' ' ? 36 : 24; continue; }
    const cursive = ensureCursiveProject(project); const generated = generateCursiveFormMask(glyph, item.form, cursive, cursive.glyphs[item.char]); const scale = Math.min(1.5, 130 / generated.height); context.fillStyle = '#111827';
    for (let py = 0; py < generated.height; py += 1) for (let px = 0; px < generated.width; px += 1) if (generated.mask[py * generated.width + px]) context.fillRect(x + px * scale, baseline - (generated.height - py) * scale, Math.ceil(scale), Math.ceil(scale));
    x += generated.width * scale - (item.connectedRight ? generated.rightPad * scale : 0) + 4; if (x > canvas.width - 50) break;
  }
  if (sequence) sequence.textContent = items.map((item) => item.char === ' ' ? '[пробел]' : `${item.char}.${item.form}`).join(' → ');
}
function syncControls() {
  const { cursive, config } = getData(); if (!cursive) return;
  byId('cursiveEnabled').checked = cursive.enabled; byId('cursiveConnectionY').value = Math.round(cursive.connectionY * 100); byId('cursiveTail').value = Math.round(cursive.tailLength * 100); byId('cursiveThickness').value = cursive.thickness; byId('cursiveSmoothness').value = Math.round(cursive.smoothness * 100);
  byId('cursiveConnectionYValue').value = `${Math.round(cursive.connectionY * 100)}%`; byId('cursiveTailValue').value = `${Math.round(cursive.tailLength * 100)}%`; byId('cursiveThicknessValue').value = cursive.thickness.toFixed(2); byId('cursiveSmoothnessValue').value = `${Math.round(cursive.smoothness * 100)}%`;
  if (config) { byId('cursiveJoinLeft').checked = config.joinLeft; byId('cursiveJoinRight').checked = config.joinRight; const form = config.forms[state.selectedForm]; byId('cursiveFormX').value = form.offsetX; byId('cursiveFormY').value = form.offsetY; byId('cursiveFormScale').value = form.scale; }
}
function renderAll() { updateCharacters(); syncControls(); renderAnchor(); renderForms(); renderWord(); }

function bind() {
  byId('cursiveCharacter').addEventListener('change', (event) => { state.selectedChar = event.target.value; renderAll(); });
  byId('cursiveFormSelect').addEventListener('change', (event) => { state.selectedForm = event.target.value; renderAll(); });
  byId('cursivePreviewText').addEventListener('input', renderWord);
  byId('cursiveEnabled').addEventListener('change', (event) => { const project = currentProject(); if (!project) return; ensureCursiveProject(project).enabled = event.target.checked; markChanged(); });
  for (const [id, key, divisor] of [['cursiveConnectionY','connectionY',100],['cursiveTail','tailLength',100],['cursiveThickness','thickness',1],['cursiveSmoothness','smoothness',100]]) byId(id).addEventListener('input', (event) => { const project = currentProject(); if (!project) return; ensureCursiveProject(project)[key] = Number(event.target.value) / divisor; markChanged(); });
  for (const [id, key] of [['cursiveJoinLeft','joinLeft'],['cursiveJoinRight','joinRight']]) byId(id).addEventListener('change', (event) => { const data = getData(); if (!data.config) return; data.config[key] = event.target.checked; markChanged(); });
  for (const [id, key] of [['cursiveFormX','offsetX'],['cursiveFormY','offsetY'],['cursiveFormScale','scale']]) byId(id).addEventListener('input', (event) => { const data = getData(); if (!data.config) return; data.config.forms[state.selectedForm][key] = Number(event.target.value); markChanged(); });
  const canvas = byId('cursiveAnchorCanvas');
  canvas.addEventListener('pointerdown', (event) => { const data = getData(); if (!data.config) return; const rect = canvas.getBoundingClientRect(); const scale = Number(canvas.dataset.scale); const ox = Number(canvas.dataset.ox); const oy = Number(canvas.dataset.oy); const x = (event.clientX - rect.left) * canvas.width / rect.width; const y = (event.clientY - rect.top) * canvas.height / rect.height; const points = [{ key: 'entry', x: ox + data.config.entry.x * (data.glyph.width - 1) * scale, y: oy + data.config.entry.y * (data.glyph.height - 1) * scale }, { key: 'exit', x: ox + data.config.exit.x * (data.glyph.width - 1) * scale, y: oy + data.config.exit.y * (data.glyph.height - 1) * scale }]; state.dragging = points.sort((a,b) => Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0].key; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!state.dragging) return; const data = getData(); const rect = canvas.getBoundingClientRect(); const scale = Number(canvas.dataset.scale); const ox = Number(canvas.dataset.ox); const oy = Number(canvas.dataset.oy); const x = (event.clientX - rect.left) * canvas.width / rect.width; const y = (event.clientY - rect.top) * canvas.height / rect.height; data.config[state.dragging] = { x: Math.max(0, Math.min(1, (x - ox) / ((data.glyph.width - 1) * scale))), y: Math.max(0, Math.min(1, (y - oy) / ((data.glyph.height - 1) * scale))) }; markChanged(); });
  canvas.addEventListener('pointerup', () => { state.dragging = null; }); canvas.addEventListener('pointercancel', () => { state.dragging = null; });
  installBuildInterception();
}

async function installFace(ttf, family) {
  if (state.previewFace) try { document.fonts.delete(state.previewFace); } catch {}
  const name = `DYFR Connected ${Date.now()}`; const face = new FontFace(name, ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength)); await face.load(); document.fonts.add(face); state.previewFace = face;
  const preview = byId('fontPreview'); preview.style.fontFamily = `'${name}', sans-serif`; preview.style.fontFeatureSettings = '"rlig" 1, "calt" 1, "curs" 1'; preview.dataset.family = family;
}
async function buildConnectedFont() {
  if (state.building) return null; const project = currentProject(); if (!project) return null; state.building = true; invalidateConnectedOutputs();
  const progress = byId('fontProgress'); if (progress) { progress.hidden = false; progress.max = 6; progress.value = 0; }
  try {
    const familyName = byId('fontFamily').value.trim() || project.title || 'Мой рукописный шрифт'; const styleName = byId('fontStyle').value.trim() || 'Regular'; project.font.familyName = familyName; project.font.styleName = styleName;
    setFontStatus('Создаю четыре формы каждой связной буквы…');
    const built = buildCursiveTrueTypeFont(project, { detail: Number(byId('fontDetail').value), simplify: Number(byId('fontSimplify').value), sideBearing: Number(byId('fontSideBearing').value), glyphHeight: Number(byId('fontGlyphHeight').value) });
    const errors = validateCursiveTrueType(built.ttf); if (errors.length) throw new Error(errors.join(' ')); if (progress) progress.value = 2;
    setFontStatus('Создаю WOFF и WOFF2 со связными таблицами…'); const woff = await buildWoffFont(built.ttf); if (progress) progress.value = 3; const woff2 = await encodeWoff2(built.ttf, (message) => setFontStatus(message)); if (progress) progress.value = 4;
    const baseName = safeName(familyName); const css = `${buildFontCss(familyName, baseName)}\n.${baseName}-connected { font-feature-settings: "rlig" 1, "calt" 1, "curs" 1; }\n`;
    const readme = `Шрифт: ${familyName} ${styleName}\nРежим: связный русский почерк\nOpenType: GSUB calt/rlig, GPOS curs\n`;
    const zip = buildStoredZip([{ name: `${baseName}.ttf`, data: built.ttf }, { name: `${baseName}.woff`, data: woff }, { name: `${baseName}.woff2`, data: woff2 }, { name: 'font.css', data: css }, { name: 'README.txt', data: readme }]); if (progress) progress.value = 5;
    await installFace(built.ttf, familyName); const preview = byId('fontPreview'); preview.textContent = byId('fontPreviewInput').value; byId('fontCss').value = css;
    state.outputs = { ttf: built.ttf, woff, woff2, css, zip, baseName, built }; for (const id of ['downloadTtf','downloadWoff','downloadWoff2','downloadCss','downloadFontZip']) byId(id).disabled = false;
    byId('fontOutputStats').innerHTML = `<strong>${built.glyphs.length}</strong> глифов · GSUB: calt/rlig · GPOS: curs · TTF ${(built.ttf.length/1024).toFixed(1)} КБ · WOFF2 ${(woff2.length/1024).toFixed(1)} КБ`;
    if (progress) progress.value = 6; setFontStatus('Связный шрифт собран и проверен.', 'ok'); return state.outputs;
  } catch (error) { console.error(error); setFontStatus(error.message || 'Не удалось собрать связный шрифт.', 'error'); return null; }
  finally { state.building = false; if (progress) progress.hidden = true; }
}
function installBuildInterception() {
  const build = byId('fontBuild'); if (!build || build.dataset.cursiveCapture) return; build.dataset.cursiveCapture = '1';
  build.addEventListener('click', (event) => { const project = currentProject(); if (!project || !ensureCursiveProject(project).enabled) return; event.preventDefault(); event.stopImmediatePropagation(); buildConnectedFont(); }, true);
  const downloads = { downloadTtf:['ttf','ttf','font/ttf'], downloadWoff:['woff','woff','font/woff'], downloadWoff2:['woff2','woff2','font/woff2'], downloadCss:['css','css','text/css;charset=utf-8'], downloadFontZip:['zip','zip','application/zip'] };
  for (const [id, [key, ext, type]] of Object.entries(downloads)) byId(id)?.addEventListener('click', (event) => { if (!state.outputs?.[key]) return; event.preventDefault(); event.stopImmediatePropagation(); const name = key === 'css' ? 'font.css' : key === 'zip' ? `${state.outputs.baseName}-font-package.zip` : `${state.outputs.baseName}.${ext}`; download(state.outputs[key], name, type); }, true);
  for (const id of FONT_SETTING_IDS) byId(id)?.addEventListener('input', () => { const project = currentProject(); if (project && ensureCursiveProject(project).enabled) invalidateConnectedOutputs(); });
}

window.addEventListener('drawyourfont:project-updated', () => setTimeout(renderAll, 0));
window.__drawYourFontCursive = { build: buildConnectedFont, getState: () => ({ selectedChar: state.selectedChar, outputs: state.outputs, building: state.building }), simulate: (text) => simulateCursiveForms(text, currentProject()) };
installCard();
