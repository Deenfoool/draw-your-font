import {
  ensureCursiveProject,
  generateCursiveFormMask,
  simulateCursiveForms,
} from './src/cursive-font.js';

const byId = (id) => document.getElementById(id);
const currentProject = () => window.__drawYourFontProject?.getProject?.() || null;

function ensureStylesheet(href, marker) {
  if (document.querySelector(`link[${marker}]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(marker, '1');
  document.head.append(link);
}

function preparePreviewField() {
  const field = byId('cursivePreviewText');
  if (!field || field.tagName === 'TEXTAREA') return field;
  const textarea = document.createElement('textarea');
  textarea.id = field.id;
  textarea.rows = 3;
  textarea.value = field.value;
  textarea.setAttribute('aria-label', 'Проверка строки');
  field.replaceWith(textarea);
  return textarea;
}

function wrappedPreview() {
  const canvas = byId('cursiveWordCanvas');
  const sequence = byId('cursiveSequence');
  const field = byId('cursivePreviewText');
  const project = currentProject();
  if (!canvas || !field || !project) return;

  const text = String(field.value || '').normalize('NFC');
  const items = simulateCursiveForms(text, project);
  const cursive = ensureCursiveProject(project);
  const glyphByChar = new Map(project.glyphs.map((glyph) => [glyph.char, glyph]));
  const marginX = 24;
  const maxX = canvas.width - marginX;
  const lineHeight = 230;
  const baselineOffset = 145;
  const descenderOffset = 88;

  const pieces = items.map((item) => {
    const glyph = glyphByChar.get(item.char);
    if (!glyph) return { item, generated: null, scale: 1, advance: item.char === '\t' ? 72 : 26 };
    const generated = generateCursiveFormMask(glyph, item.contextualForm || item.form, cursive, cursive.glyphs[item.char]);
    const bodyHeight = Math.max(1, generated.baselineY - generated.xHeightY);
    const scale = Math.min(1.75, 82 / bodyHeight);
    const advance = item.connectedRight ? (generated.width - 1) * scale : generated.width * scale + 4;
    return { item, generated, scale, advance };
  });

  const tokens = [];
  let word = [];
  const flushWord = () => {
    if (word.length) tokens.push({ type: 'word', pieces: word.splice(0) });
  };
  for (const piece of pieces) {
    if (piece.item.char === '\n') {
      flushWord();
      tokens.push({ type: 'newline' });
    } else if (/\s/u.test(piece.item.char)) {
      flushWord();
      const previous = tokens.at(-1);
      const width = piece.item.char === '\t' ? 72 : 34;
      if (previous?.type === 'space') previous.width += width;
      else tokens.push({ type: 'space', width });
    } else {
      word.push(piece);
    }
  }
  flushWord();

  const placements = [];
  let line = 0;
  let x = marginX;
  let pendingSpace = 0;
  const nextLine = () => { line += 1; x = marginX; pendingSpace = 0; };

  for (const token of tokens) {
    if (token.type === 'newline') {
      nextLine();
      continue;
    }
    if (token.type === 'space') {
      pendingSpace += token.width;
      continue;
    }

    const wordWidth = token.pieces.reduce((sum, piece) => sum + piece.advance, 0);
    if (x > marginX && x + pendingSpace + wordWidth > maxX) nextLine();
    else x += pendingSpace;
    pendingSpace = 0;

    for (const piece of token.pieces) {
      if (x > marginX && x + piece.advance > maxX) nextLine();
      placements.push({ ...piece, x, line });
      x += piece.advance;
    }
  }

  const lineCount = Math.max(1, line + 1);
  canvas.height = Math.max(310, lineCount * lineHeight + 24);
  canvas.dataset.lines = String(lineCount);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < lineCount; index += 1) {
    const baseline = 12 + index * lineHeight + baselineOffset;
    context.strokeStyle = '#dc2626';
    context.lineWidth = 1.4;
    context.setLineDash([8, 6]);
    context.beginPath();
    context.moveTo(10, baseline);
    context.lineTo(canvas.width - 10, baseline);
    context.stroke();
    context.strokeStyle = '#7c3aed';
    context.beginPath();
    context.moveTo(10, baseline + descenderOffset);
    context.lineTo(canvas.width - 10, baseline + descenderOffset);
    context.stroke();
  }
  context.setLineDash([]);

  for (const placement of placements) {
    const { generated, scale } = placement;
    if (!generated) continue;
    const baseline = 12 + placement.line * lineHeight + baselineOffset;
    context.fillStyle = '#111827';
    for (let py = 0; py < generated.height; py += 1) {
      for (let px = 0; px < generated.width; px += 1) {
        if (!generated.mask[py * generated.width + px]) continue;
        context.fillRect(
          placement.x + px * scale,
          baseline + (py - generated.baselineY) * scale,
          Math.ceil(scale),
          Math.ceil(scale),
        );
      }
    }
  }

  if (sequence) {
    sequence.textContent = items
      .map((item) => item.char === '\n' ? '[новая строка]' : /\s/u.test(item.char) ? '[пробел]' : `${item.char}.${item.contextualForm || item.form}`)
      .join(' → ');
  }
}

function installCursivePolish() {
  const section = byId('cursiveBuilder');
  if (!section) return setTimeout(installCursivePolish, 40);
  if (section.dataset.polished === '1') return;
  section.dataset.polished = '1';
  ensureStylesheet('./cursive-ui-polish.css', 'data-dyfr-cursive-polish');

  const header = section.querySelector('.flow-header');
  const body = section.querySelector('.cursive-layout');
  const actualEnabled = byId('cursiveEnabled');
  if (!header || !body || !actualEnabled) return;

  const disclosure = document.createElement('label');
  disclosure.className = 'cursive-disclosure';
  disclosure.innerHTML = '<input id="cursiveDisclosureToggle" type="checkbox"><span><strong>Включить связный почерк</strong><small>Развернуть настройки</small></span>';
  const stagePill = header.querySelector('.stage-pill');
  if (stagePill) stagePill.before(disclosure); else header.append(disclosure);
  const toggle = byId('cursiveDisclosureToggle');

  const formAdjustments = section.querySelector('.cursive-form-adjustments');
  if (formAdjustments) formAdjustments.hidden = true;
  const previewField = preparePreviewField();

  function setExpanded(enabled, propagate = true) {
    const value = Boolean(enabled);
    toggle.checked = value;
    body.hidden = !value;
    section.classList.toggle('is-expanded', value);
    disclosure.setAttribute('aria-expanded', String(value));
    if (propagate && actualEnabled.checked !== value) {
      actualEnabled.checked = value;
      actualEnabled.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (value) requestAnimationFrame(wrappedPreview);
  }

  function syncFromProject() {
    const project = currentProject();
    const enabled = project ? ensureCursiveProject(project).enabled : actualEnabled.checked;
    setExpanded(enabled, false);
  }

  toggle.addEventListener('change', () => setExpanded(toggle.checked, true));
  previewField?.addEventListener('input', () => requestAnimationFrame(wrappedPreview));
  section.addEventListener('input', () => requestAnimationFrame(wrappedPreview));
  section.addEventListener('change', () => requestAnimationFrame(wrappedPreview));
  section.addEventListener('pointerup', () => requestAnimationFrame(wrappedPreview));
  window.addEventListener('drawyourfont:cursive-updated', () => requestAnimationFrame(() => { syncFromProject(); wrappedPreview(); }));
  window.addEventListener('drawyourfont:project-updated', () => setTimeout(() => { syncFromProject(); wrappedPreview(); }, 0));

  setExpanded(false, false);
  requestAnimationFrame(wrappedPreview);

  window.__drawYourFontCursiveUi = {
    setExpanded,
    renderWrappedPreview: wrappedPreview,
    getState: () => ({ expanded: !body.hidden, lines: Number(byId('cursiveWordCanvas')?.dataset.lines || 0) }),
  };
}

installCursivePolish();
