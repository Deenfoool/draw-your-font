export const A4_MM = Object.freeze({ width: 210, height: 297 });
export const TEMPLATE_DPI = 200;

export const TEMPLATE_CHARSETS = Object.freeze({
  'ru-upper': [...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'],
  'ru-lower': [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'],
  'ru-letters': [...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'],
  'ru-full': [
    ...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    ...'0123456789',
    ...'.,;:!?«»()-—',
  ],
  'ru-extended': [
    ...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    ...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
    ...'0123456789',
    ...'.,;:!?«»()[]{}-—+№@#%&',
  ],
});

export const TEMPLATE_LAYOUTS = Object.freeze({
  balanced: Object.freeze({ id: 'balanced', columns: 6, rows: 8, label: 'Оптимальный: 6 × 8' }),
  compact: Object.freeze({ id: 'compact', columns: 7, rows: 7, label: 'Компактный: 7 × 7' }),
  standard: Object.freeze({ id: 'standard', columns: 6, rows: 7, label: 'Свободный: 6 × 7' }),
  large: Object.freeze({ id: 'large', columns: 5, rows: 7, label: 'Крупный: 5 × 7' }),
});

const PAGE = Object.freeze({ marginX: 10, marginTop: 10, marginBottom: 9, headerHeight: 24, footerHeight: 10, markerSize: 4 });

export function normalizeCustomCharset(value) {
  const normalized = String(value || '').normalize('NFC');
  const result = [];
  const seen = new Set();
  for (const character of [...normalized]) {
    if (/\s/u.test(character) || /[\u0000-\u001f\u007f]/u.test(character)) continue;
    if (!seen.has(character)) { seen.add(character); result.push(character); }
  }
  return result;
}

export function getTemplateCharset(id, customValue = '') {
  if (id === 'custom') return normalizeCustomCharset(customValue);
  return [...(TEMPLATE_CHARSETS[id] || TEMPLATE_CHARSETS['ru-full'])];
}

export function getLayout(id) { return TEMPLATE_LAYOUTS[id] || TEMPLATE_LAYOUTS.balanced; }

export function planTemplatePages(characters, options = {}) {
  const layout = getLayout(options.layoutId);
  const title = String(options.title || 'Мой рукописный шрифт').trim().slice(0, 80) || 'Мой рукописный шрифт';
  const chars = [...characters];
  if (!chars.length) throw new Error('Набор символов пуст.');
  const gridX = PAGE.marginX;
  const gridY = PAGE.marginTop + PAGE.headerHeight;
  const gridWidth = A4_MM.width - PAGE.marginX * 2;
  const gridHeight = A4_MM.height - gridY - PAGE.footerHeight - PAGE.marginBottom;
  const cellWidth = gridWidth / layout.columns;
  const cellHeight = gridHeight / layout.rows;
  const perPage = layout.columns * layout.rows;
  const pageCount = Math.ceil(chars.length / perPage);
  const pages = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const cells = [];
    const pageChars = chars.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    pageChars.forEach((char, localIndex) => {
      const row = Math.floor(localIndex / layout.columns);
      const column = localIndex % layout.columns;
      const x = gridX + column * cellWidth;
      const y = gridY + row * cellHeight;
      const globalIndex = pageIndex * perPage + localIndex;
      const labelBand = Math.min(6, cellHeight * 0.2);
      const drawingTop = y + labelBand;
      const drawingHeight = cellHeight - labelBand;
      const baseline = drawingTop + drawingHeight * 0.72;
      cells.push({ char, index: globalIndex, row, column, x, y, width: cellWidth, height: cellHeight, labelBand, drawingTop, drawingHeight,
        capLine: drawingTop + drawingHeight * 0.18, xHeightLine: drawingTop + drawingHeight * 0.39, baseline,
        descenderLine: drawingTop + drawingHeight * 0.88, centerX: x + cellWidth / 2 });
    });
    pages.push({ pageIndex, pageNumber: pageIndex + 1, pageCount, title, charsetId: options.charsetId || 'custom', layout,
      grid: { x: gridX, y: gridY, width: gridWidth, height: gridHeight }, cells,
      markers: [
        { x: PAGE.marginX, y: PAGE.marginTop },
        { x: A4_MM.width - PAGE.marginX - PAGE.markerSize, y: PAGE.marginTop },
        { x: PAGE.marginX, y: A4_MM.height - PAGE.marginBottom - PAGE.markerSize },
        { x: A4_MM.width - PAGE.marginX - PAGE.markerSize, y: A4_MM.height - PAGE.marginBottom - PAGE.markerSize },
      ], markerSize: PAGE.markerSize, footerY: A4_MM.height - PAGE.marginBottom - PAGE.footerHeight });
  }
  return { title, characters: chars, layout, perPage, pageCount, pages };
}

export function validateTemplatePlan(plan) {
  const errors = [];
  const seen = [];
  for (const page of plan.pages) for (const cell of page.cells) {
    seen.push(cell.char);
    if (cell.x < 0 || cell.y < 0 || cell.x + cell.width > A4_MM.width + 0.001 || cell.y + cell.height > A4_MM.height + 0.001) errors.push(`Ячейка ${cell.index + 1} выходит за границы A4.`);
    if (!(cell.capLine < cell.xHeightLine && cell.xHeightLine < cell.baseline && cell.baseline < cell.descenderLine)) errors.push(`Неверный порядок направляющих в ячейке ${cell.index + 1}.`);
  }
  if (seen.join('') !== plan.characters.join('')) errors.push('Порядок символов изменился при разбиении на страницы.');
  if (plan.pages.length !== plan.pageCount) errors.push('Количество страниц не совпадает с планом.');
  return errors;
}

function mmToPx(mm, dpi) { return mm * dpi / 25.4; }
function setDashedLine(ctx, dashMm, dpi) { ctx.setLineDash(dashMm.map((value) => mmToPx(value, dpi))); }
function drawLineMm(ctx, x1, y1, x2, y2, dpi) { ctx.beginPath(); ctx.moveTo(mmToPx(x1, dpi), mmToPx(y1, dpi)); ctx.lineTo(mmToPx(x2, dpi), mmToPx(y2, dpi)); ctx.stroke(); }
function drawRegistrationMarker(ctx, marker, size, dpi) {
  const x = mmToPx(marker.x, dpi), y = mmToPx(marker.y, dpi), s = mmToPx(size, dpi);
  ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(x, y, s, s); ctx.fillStyle = '#fff'; ctx.fillRect(x + s * .27, y + s * .27, s * .46, s * .46); ctx.fillStyle = '#000'; ctx.fillRect(x + s * .4, y + s * .4, s * .2, s * .2); ctx.restore();
}

export function renderTemplatePage(ctx, page, options = {}) {
  const dpi = Number(options.dpi || TEMPLATE_DPI);
  const widthPx = Math.round(mmToPx(A4_MM.width, dpi));
  const heightPx = Math.round(mmToPx(A4_MM.height, dpi));
  const showGuides = options.showGuides !== false;
  if (ctx.canvas.width !== widthPx) ctx.canvas.width = widthPx;
  if (ctx.canvas.height !== heightPx) ctx.canvas.height = heightPx;
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, widthPx, heightPx); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  page.markers.forEach((marker) => drawRegistrationMarker(ctx, marker, page.markerSize, dpi));
  const left = 17;
  ctx.fillStyle = '#111827'; ctx.font = `700 ${Math.round(mmToPx(4.8, dpi))}px Arial, "DejaVu Sans", sans-serif`; ctx.fillText(page.title, mmToPx(left, dpi), mmToPx(17, dpi));
  ctx.font = `400 ${Math.round(mmToPx(2.7, dpi))}px Arial, "DejaVu Sans", sans-serif`; ctx.fillStyle = '#475569';
  ctx.fillText('Пишите тёмной ручкой, крупно, по одному символу в ячейке и не касайтесь рамок.', mmToPx(left, dpi), mmToPx(22.2, dpi));
  ctx.fillText('После заполнения сфотографируйте лист ровно сверху при хорошем освещении.', mmToPx(left, dpi), mmToPx(26.6, dpi));
  ctx.textAlign = 'right'; ctx.fillStyle = '#111827'; ctx.font = `700 ${Math.round(mmToPx(3.2, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillText(`Страница ${page.pageNumber} / ${page.pageCount}`, mmToPx(193, dpi), mmToPx(18, dpi));
  ctx.font = `400 ${Math.round(mmToPx(2.5, dpi))}px Arial, "DejaVu Sans", sans-serif`; ctx.fillStyle = '#64748b';
  ctx.fillText(`DYF-RU · ${page.layout.columns}×${page.layout.rows}`, mmToPx(193, dpi), mmToPx(23, dpi)); ctx.textAlign = 'left';

  for (const cell of page.cells) {
    const x = mmToPx(cell.x, dpi), y = mmToPx(cell.y, dpi), w = mmToPx(cell.width, dpi), h = mmToPx(cell.height, dpi);
    ctx.strokeStyle = '#111827'; ctx.lineWidth = Math.max(1, mmToPx(.26, dpi)); ctx.setLineDash([]); ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(x, y, w, mmToPx(cell.labelBand, dpi)); ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = Math.max(1, mmToPx(.15, dpi));
    drawLineMm(ctx, cell.x, cell.y + cell.labelBand, cell.x + cell.width, cell.y + cell.labelBand, dpi);
    ctx.fillStyle = '#0f172a'; ctx.textAlign = 'left'; ctx.font = `700 ${Math.round(mmToPx(Math.min(3.8, cell.labelBand * .62), dpi))}px Arial, "DejaVu Sans", sans-serif`;
    ctx.fillText(cell.char, mmToPx(cell.x + 2, dpi), mmToPx(cell.y + cell.labelBand * .73, dpi));
    ctx.textAlign = 'right'; ctx.fillStyle = '#64748b'; ctx.font = `400 ${Math.round(mmToPx(2.1, dpi))}px Arial, "DejaVu Sans", sans-serif`;
    ctx.fillText(String(cell.index + 1), mmToPx(cell.x + cell.width - 1.7, dpi), mmToPx(cell.y + cell.labelBand * .7, dpi));
    if (showGuides) {
      ctx.lineWidth = Math.max(1, mmToPx(.16, dpi)); ctx.strokeStyle = '#94a3b8'; setDashedLine(ctx, [1.2, 1.2], dpi);
      drawLineMm(ctx, cell.x + 1, cell.capLine, cell.x + cell.width - 1, cell.capLine, dpi); drawLineMm(ctx, cell.x + 1, cell.xHeightLine, cell.x + cell.width - 1, cell.xHeightLine, dpi); drawLineMm(ctx, cell.x + 1, cell.descenderLine, cell.x + cell.width - 1, cell.descenderLine, dpi);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = Math.max(1.2, mmToPx(.28, dpi)); ctx.setLineDash([]); drawLineMm(ctx, cell.x + 1, cell.baseline, cell.x + cell.width - 1, cell.baseline, dpi);
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = Math.max(1, mmToPx(.14, dpi)); setDashedLine(ctx, [.8, 1.4], dpi); drawLineMm(ctx, cell.centerX, cell.drawingTop + 1, cell.centerX, cell.y + cell.height - 1, dpi);
    }
  }
  ctx.setLineDash([]); const footerY = page.footerY + 3.2; ctx.fillStyle = '#475569'; ctx.textAlign = 'left'; ctx.font = `400 ${Math.round(mmToPx(2.35, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillText('Печать: A4, масштаб 100%, без подгонки под страницу.', mmToPx(10, dpi), mmToPx(footerY, dpi));
  const rulerX = 145, rulerY = footerY - 1.4; ctx.strokeStyle = '#111827'; ctx.lineWidth = Math.max(1, mmToPx(.25, dpi)); drawLineMm(ctx, rulerX, rulerY, rulerX + 50, rulerY, dpi);
  for (let i = 0; i <= 5; i += 1) drawLineMm(ctx, rulerX + i * 10, rulerY - 1.2, rulerX + i * 10, rulerY + 1.2, dpi);
  ctx.textAlign = 'center'; ctx.fillText('контрольные 50 мм', mmToPx(rulerX + 25, dpi), mmToPx(footerY + 3.4, dpi)); ctx.restore();
  return { widthPx, heightPx };
}
