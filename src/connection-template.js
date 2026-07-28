import { A4_MM, TEMPLATE_DPI } from './template.js';
import { MARKER_GRID, METADATA_MM, markerPattern, metadataMatrix } from './template-code.js';
import { RUSSIAN_CONNECTION_LEVELS, RUSSIAN_LOWERCASE } from './russian-joining.js';

export const CONNECTION_TEMPLATE_VERSION = 2;
export const CONNECTION_TEMPLATE_LAYOUT = Object.freeze({
  id: 'standard',
  columns: 6,
  rows: 7,
  label: 'Соединения: 6 × 7',
});
export const CONNECTION_TARGETS = Object.freeze([
  Object.freeze({ id: 'upper', code: 'В', label: 'верх' }),
  Object.freeze({ id: 'middle', code: 'С', label: 'середина' }),
  Object.freeze({ id: 'lower', code: 'Н', label: 'низ' }),
]);

const PAGE = Object.freeze({
  marginX: 10,
  marginTop: 10,
  marginBottom: 9,
  headerHeight: 26,
  footerHeight: 12,
  markerSize: 7,
});

function mmToPx(mm, dpi) { return mm * dpi / 25.4; }
function setDashedLine(ctx, dashMm, dpi) { ctx.setLineDash(dashMm.map((value) => mmToPx(value, dpi))); }
function drawLineMm(ctx, x1, y1, x2, y2, dpi) {
  ctx.beginPath();
  ctx.moveTo(mmToPx(x1, dpi), mmToPx(y1, dpi));
  ctx.lineTo(mmToPx(x2, dpi), mmToPx(y2, dpi));
  ctx.stroke();
}

function drawRegistrationMarker(ctx, marker, size, dpi) {
  const x = mmToPx(marker.x, dpi);
  const y = mmToPx(marker.y, dpi);
  const module = mmToPx(size / MARKER_GRID, dpi);
  const pattern = markerPattern(marker.id || 0);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, module * MARKER_GRID, module * MARKER_GRID);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < MARKER_GRID; row += 1) {
    for (let column = 0; column < MARKER_GRID; column += 1) {
      if (pattern[row][column]) ctx.fillRect(x + column * module, y + row * module, Math.ceil(module + 0.25), Math.ceil(module + 0.25));
    }
  }
  ctx.restore();
}

function drawMetadataCode(ctx, metadata, dpi) {
  const matrix = metadataMatrix(metadata);
  const cell = mmToPx(METADATA_MM.cell, dpi);
  const x0 = mmToPx(METADATA_MM.x, dpi);
  const y0 = mmToPx(METADATA_MM.y, dpi);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0 - cell * 0.35, y0 - cell * 0.35, cell * (matrix[0].length + 0.7), cell * (matrix.length + 0.7));
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = Math.max(1, mmToPx(0.08, dpi));
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      const x = x0 + column * cell;
      const y = y0 + row * cell;
      ctx.fillStyle = matrix[row][column] ? '#000000' : '#ffffff';
      ctx.fillRect(x, y, Math.ceil(cell + 0.15), Math.ceil(cell + 0.15));
      ctx.strokeRect(x, y, cell, cell);
    }
  }
  ctx.restore();
}

function targetYForCell(cell, targetClass) {
  const level = RUSSIAN_CONNECTION_LEVELS[targetClass];
  return cell.baseline - (cell.baseline - cell.capLine) * level;
}

export function planConnectionTemplatePages(options = {}) {
  const characters = [...(options.characters || RUSSIAN_LOWERCASE)].map((char) => String(char || '').normalize('NFC')).filter(Boolean);
  if (!characters.length) throw new Error('Нет строчных букв для шаблона соединений.');
  const title = String(options.title || 'Мой рукописный шрифт').trim().slice(0, 80) || 'Мой рукописный шрифт';
  const layout = CONNECTION_TEMPLATE_LAYOUT;
  const samples = characters.flatMap((char, charIndex) => CONNECTION_TARGETS.map((target, variantIndex) => ({
    char,
    charIndex,
    targetClass: target.id,
    targetCode: target.code,
    targetLabel: target.label,
    variantIndex,
    sampleIndex: charIndex * CONNECTION_TARGETS.length + variantIndex,
  })));
  if (samples.length > 127) throw new Error('Машинный код шаблона поддерживает не более 127 образцов.');

  const gridX = PAGE.marginX;
  const gridY = PAGE.marginTop + PAGE.headerHeight;
  const gridWidth = A4_MM.width - PAGE.marginX * 2;
  const gridHeight = A4_MM.height - gridY - PAGE.footerHeight - PAGE.marginBottom;
  const cellWidth = gridWidth / layout.columns;
  const cellHeight = gridHeight / layout.rows;
  const perPage = layout.columns * layout.rows;
  const pageCount = Math.ceil(samples.length / perPage);
  const pages = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageSamples = samples.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    const cells = pageSamples.map((sample, localIndex) => {
      const row = Math.floor(localIndex / layout.columns);
      const column = localIndex % layout.columns;
      const x = gridX + column * cellWidth;
      const y = gridY + row * cellHeight;
      const labelBand = Math.min(6.2, cellHeight * 0.2);
      const drawingTop = y + labelBand;
      const drawingHeight = cellHeight - labelBand;
      const capLine = drawingTop + drawingHeight * 0.18;
      const xHeightLine = drawingTop + drawingHeight * 0.39;
      const baseline = drawingTop + drawingHeight * 0.72;
      const descenderLine = drawingTop + drawingHeight * 0.88;
      const targetX = x + cellWidth - 3.2;
      const cell = {
        ...sample,
        index: sample.sampleIndex,
        row,
        column,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        labelBand,
        drawingTop,
        drawingHeight,
        capLine,
        xHeightLine,
        baseline,
        descenderLine,
        centerX: x + cellWidth / 2,
        targetX,
      };
      cell.targetY = targetYForCell(cell, sample.targetClass);
      cell.inkBox = {
        x0: x + 1,
        y0: drawingTop + 0.8,
        x1: x + cellWidth - 1,
        y1: y + cellHeight - 1,
      };
      cell.target = { x: targetX, y: cell.targetY, radius: 1.15 };
      return cell;
    });

    pages.push({
      kind: 'connections',
      pageIndex,
      pageNumber: pageIndex + 1,
      pageCount,
      title,
      layout,
      grid: { x: gridX, y: gridY, width: gridWidth, height: gridHeight },
      cells,
      markers: [
        { id: 0, x: PAGE.marginX, y: PAGE.marginTop },
        { id: 1, x: A4_MM.width - PAGE.marginX - PAGE.markerSize, y: PAGE.marginTop },
        { id: 2, x: A4_MM.width - PAGE.marginX - PAGE.markerSize, y: A4_MM.height - PAGE.marginBottom - PAGE.markerSize },
        { id: 3, x: PAGE.marginX, y: A4_MM.height - PAGE.marginBottom - PAGE.markerSize },
      ],
      markerSize: PAGE.markerSize,
      footerY: A4_MM.height - PAGE.marginBottom - PAGE.footerHeight,
      metadata: {
        version: CONNECTION_TEMPLATE_VERSION,
        charsetId: 'custom',
        layoutId: layout.id,
        pageIndex,
        pageCount,
        totalChars: samples.length,
      },
    });
  }

  return {
    kind: 'connections',
    version: CONNECTION_TEMPLATE_VERSION,
    title,
    characters,
    targets: CONNECTION_TARGETS,
    samples,
    layout,
    perPage,
    pageCount,
    pages,
  };
}

export function validateConnectionTemplatePlan(plan) {
  const errors = [];
  if (plan?.kind !== 'connections') errors.push('Неверный тип шаблона соединений.');
  if (plan?.version !== CONNECTION_TEMPLATE_VERSION) errors.push('Неверная версия шаблона соединений.');
  if (plan?.samples?.length !== plan?.characters?.length * CONNECTION_TARGETS.length) errors.push('Количество образцов соединений не совпадает с алфавитом.');
  if (plan?.pages?.length !== plan?.pageCount) errors.push('Количество страниц не совпадает с планом.');
  const seen = [];
  for (const page of plan?.pages || []) {
    if (page.metadata?.version !== CONNECTION_TEMPLATE_VERSION) errors.push(`Страница ${page.pageNumber}: неверная версия машинного кода.`);
    for (const cell of page.cells) {
      seen.push(`${cell.char}|${cell.targetClass}`);
      if (cell.x < 0 || cell.y < 0 || cell.x + cell.width > A4_MM.width + 0.001 || cell.y + cell.height > A4_MM.height + 0.001) errors.push(`Ячейка ${cell.index + 1} выходит за границы A4.`);
      if (!(cell.capLine < cell.xHeightLine && cell.xHeightLine < cell.baseline && cell.baseline < cell.descenderLine)) errors.push(`Ячейка ${cell.index + 1}: неверный порядок направляющих.`);
      if (!(cell.targetY > cell.capLine && cell.targetY < cell.baseline && cell.targetX > cell.x && cell.targetX < cell.x + cell.width)) errors.push(`Ячейка ${cell.index + 1}: цель соединения находится вне рабочей области.`);
    }
  }
  const expected = plan?.samples?.map((sample) => `${sample.char}|${sample.targetClass}`) || [];
  if (seen.join(',') !== expected.join(',')) errors.push('Порядок образцов соединений изменился при разбиении на страницы.');
  return errors;
}

export function renderConnectionTemplatePage(ctx, page, options = {}) {
  const dpi = Number(options.dpi || TEMPLATE_DPI);
  const widthPx = Math.round(mmToPx(A4_MM.width, dpi));
  const heightPx = Math.round(mmToPx(A4_MM.height, dpi));
  const showGuides = options.showGuides !== false;
  if (ctx.canvas.width !== widthPx) ctx.canvas.width = widthPx;
  if (ctx.canvas.height !== heightPx) ctx.canvas.height = heightPx;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  page.markers.forEach((marker) => drawRegistrationMarker(ctx, marker, page.markerSize, dpi));
  drawMetadataCode(ctx, page.metadata, dpi);

  const left = 17;
  ctx.fillStyle = '#111827';
  ctx.font = `700 ${Math.round(mmToPx(4.6, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillText(`${page.title}: соединения`, mmToPx(left, dpi), mmToPx(16.6, dpi));
  ctx.font = `400 ${Math.round(mmToPx(2.55, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillStyle = '#475569';
  ctx.fillText('Напишите указанную букву и одним движением продолжите её до кружка справа.', mmToPx(left, dpi), mmToPx(21.2, dpi));
  ctx.fillText('Кружок не обводите. Закончите тёмный штрих точно в его центре.', mmToPx(left, dpi), mmToPx(25.4, dpi));
  ctx.textAlign = 'right';
  ctx.fillStyle = '#111827';
  ctx.font = `700 ${Math.round(mmToPx(3.1, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillText(`Страница ${page.pageNumber} / ${page.pageCount}`, mmToPx(193, dpi), mmToPx(17.2, dpi));
  ctx.font = `400 ${Math.round(mmToPx(2.35, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillStyle = '#64748b';
  ctx.fillText('DYF-RU JOIN v2 · 3 выхода', mmToPx(193, dpi), mmToPx(22.4, dpi));

  for (const cell of page.cells) {
    const x = mmToPx(cell.x, dpi);
    const y = mmToPx(cell.y, dpi);
    const width = mmToPx(cell.width, dpi);
    const height = mmToPx(cell.height, dpi);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = Math.max(1, mmToPx(0.26, dpi));
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(x, y, width, mmToPx(cell.labelBand, dpi));
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(1, mmToPx(0.15, dpi));
    drawLineMm(ctx, cell.x, cell.y + cell.labelBand, cell.x + cell.width, cell.y + cell.labelBand, dpi);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${Math.round(mmToPx(Math.min(3.7, cell.labelBand * 0.59), dpi))}px Arial, "DejaVu Sans", sans-serif`;
    ctx.fillText(`${cell.char} → ${cell.targetCode}`, mmToPx(cell.x + 1.8, dpi), mmToPx(cell.y + cell.labelBand * 0.72, dpi));
    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748b';
    ctx.font = `400 ${Math.round(mmToPx(1.95, dpi))}px Arial, "DejaVu Sans", sans-serif`;
    ctx.fillText(String(cell.index + 1), mmToPx(cell.x + cell.width - 1.6, dpi), mmToPx(cell.y + cell.labelBand * 0.69, dpi));

    if (showGuides) {
      ctx.lineWidth = Math.max(1, mmToPx(0.14, dpi));
      ctx.strokeStyle = '#b8c3d1';
      setDashedLine(ctx, [1.1, 1.25], dpi);
      drawLineMm(ctx, cell.x + 1, cell.capLine, cell.x + cell.width - 1, cell.capLine, dpi);
      drawLineMm(ctx, cell.x + 1, cell.xHeightLine, cell.x + cell.width - 1, cell.xHeightLine, dpi);
      drawLineMm(ctx, cell.x + 1, cell.descenderLine, cell.x + cell.width - 1, cell.descenderLine, dpi);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = Math.max(1.2, mmToPx(0.27, dpi));
      ctx.setLineDash([]);
      drawLineMm(ctx, cell.x + 1, cell.baseline, cell.x + cell.width - 1, cell.baseline, dpi);
    }

    ctx.save();
    ctx.strokeStyle = '#7aa7c7';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.1, mmToPx(0.22, dpi));
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(mmToPx(cell.target.x, dpi), mmToPx(cell.target.y, dpi), mmToPx(cell.target.radius, dpi), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7aa7c7';
    ctx.beginPath();
    ctx.arc(mmToPx(cell.target.x, dpi), mmToPx(cell.target.y, dpi), Math.max(1, mmToPx(0.18, dpi)), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.setLineDash([]);
  const footerY = page.footerY + 3.1;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#475569';
  ctx.font = `400 ${Math.round(mmToPx(2.3, dpi))}px Arial, "DejaVu Sans", sans-serif`;
  ctx.fillText('В - верхнее соединение · С - среднее · Н - нижнее', mmToPx(10, dpi), mmToPx(footerY, dpi));
  ctx.textAlign = 'right';
  ctx.fillText('Печать: A4, 100%, без подгонки.', mmToPx(200, dpi), mmToPx(footerY, dpi));
  ctx.restore();
  return { widthPx, heightPx };
}
