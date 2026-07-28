import { ensureCursiveProject, generateCursiveFormMask } from './cursive-font.js';
import { resolveJoiningSequence, RUSSIAN_LOWERCASE } from './russian-joining.js';

export const PAIR_INSPECTOR_VERSION = 1;
export const PAIR_STATUSES = Object.freeze(['good', 'review', 'bad', 'missing', 'disconnected']);

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

function maskBounds(mask, width, height, x0 = 0, x1 = width - 1) {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1; let ink = 0;
  const start = clamp(Math.floor(x0), 0, width - 1);
  const end = clamp(Math.ceil(x1), 0, width - 1);
  for (let y = 0; y < height; y += 1) for (let x = start; x <= end; x += 1) {
    if (!mask[y * width + x]) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); ink += 1;
  }
  return ink ? { x0: minX, y0: minY, x1: maxX, y1: maxY, width: maxX - minX + 1, height: maxY - minY + 1, ink } : null;
}

function pointInk(mask, width, height, x, y, radius = 3) {
  let ink = 0;
  const cx = Math.round(x); const cy = Math.round(y);
  for (let py = cy - radius; py <= cy + radius; py += 1) for (let px = cx - radius; px <= cx + radius; px += 1) {
    if (px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px]) ink += 1;
  }
  return ink;
}

function seamThickness(mask, width, height, x, y) {
  const cx = clamp(Math.round(x), 0, width - 1);
  const cy = clamp(Math.round(y), 0, height - 1);
  let best = 0;
  for (let px = Math.max(0, cx - 2); px <= Math.min(width - 1, cx + 2); px += 1) {
    let run = 0; let localBest = 0;
    for (let py = Math.max(0, cy - 10); py <= Math.min(height - 1, cy + 10); py += 1) {
      if (mask[py * width + px]) { run += 1; localBest = Math.max(localBest, run); } else run = 0;
    }
    best = Math.max(best, localBest);
  }
  return best;
}

function minimumInkDistance(left, right, options = {}) {
  const leftPoints = [];
  const rightPoints = [];
  const leftStart = Math.max(0, left.width - Math.max(4, Math.round(options.window || 8)));
  const rightEnd = Math.min(right.width - 1, Math.max(3, Math.round(options.window || 8)));
  for (let y = 0; y < left.height; y += 1) for (let x = leftStart; x < left.width; x += 1) {
    if (left.mask[y * left.width + x]) leftPoints.push({ x, y: y + options.leftOffsetY });
  }
  for (let y = 0; y < right.height; y += 1) for (let x = 0; x <= rightEnd; x += 1) {
    if (right.mask[y * right.width + x]) rightPoints.push({ x: x + options.rightX, y: y + options.rightOffsetY });
  }
  if (!leftPoints.length || !rightPoints.length) return Infinity;
  let best = Infinity;
  for (const a of leftPoints) for (const b of rightPoints) {
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance < best) best = distance;
    if (best === 0) return 0;
  }
  return best;
}

function overlapPixels(left, right, rightX, leftOffsetY, rightOffsetY) {
  const leftSet = new Set();
  for (let y = 0; y < left.height; y += 1) for (let x = 0; x < left.width; x += 1) {
    if (left.mask[y * left.width + x]) leftSet.add(`${x}|${y + leftOffsetY}`);
  }
  let overlap = 0;
  for (let y = 0; y < right.height; y += 1) for (let x = 0; x < right.width; x += 1) {
    if (right.mask[y * right.width + x] && leftSet.has(`${x + rightX}|${y + rightOffsetY}`)) overlap += 1;
  }
  return overlap;
}

function actualBodyBounds(generated, side) {
  const x0 = side === 'right' ? generated.leftPad : 0;
  const x1 = side === 'left' ? generated.width - generated.rightPad - 1 : generated.width - 1;
  return maskBounds(generated.mask, generated.width, generated.height, x0, x1);
}

function statusFromScore(score, hardFailure = false) {
  if (hardFailure || score < 55) return 'bad';
  if (score < 82) return 'review';
  return 'good';
}

function unavailableResult(leftCharacter, rightCharacter, status, reason) {
  return {
    version: PAIR_INSPECTOR_VERSION,
    pair: `${leftCharacter}${rightCharacter}`,
    leftCharacter,
    rightCharacter,
    status,
    score: 0,
    reasons: [reason],
    metrics: null,
    sequence: [],
  };
}

export function inspectRussianPair(project, leftCharacter, rightCharacter, options = {}) {
  const leftChar = [...String(leftCharacter || '').normalize('NFC')][0] || '';
  const rightChar = [...String(rightCharacter || '').normalize('NFC')][0] || '';
  const cursive = ensureCursiveProject(project);
  const glyphByCharacter = new Map((project.glyphs || []).map((glyph) => [glyph.char, glyph]));
  const leftGlyph = glyphByCharacter.get(leftChar);
  const rightGlyph = glyphByCharacter.get(rightChar);
  if (!leftGlyph || !rightGlyph) return unavailableResult(leftChar, rightChar, 'missing', 'Одна или обе буквы отсутствуют в проекте.');

  const sequence = resolveJoiningSequence(`${leftChar}${rightChar}`, cursive.glyphs, { pairOverrides: cursive.pairOverrides });
  if (!sequence[0]?.connectedRight || !sequence[1]?.connectedLeft) {
    return unavailableResult(leftChar, rightChar, 'disconnected', 'Соединение для этой пары отключено правилами проекта.');
  }

  const leftGenerated = generateCursiveFormMask(leftGlyph, sequence[0].contextualForm, cursive, cursive.glyphs[leftChar]);
  const rightGenerated = generateCursiveFormMask(rightGlyph, sequence[1].contextualForm, cursive, cursive.glyphs[rightChar]);
  const baseline = Math.max(leftGenerated.baselineY, rightGenerated.baselineY);
  const leftOffsetY = baseline - leftGenerated.baselineY;
  const rightOffsetY = baseline - rightGenerated.baselineY;
  const spacing = clamp(sequence[0].pairOverride?.spacing ?? 0, -40, 80);
  const rightX = leftGenerated.width - 1 + spacing;
  const leftSeamY = leftGenerated.rightExternalY + leftOffsetY;
  const rightSeamY = rightGenerated.leftExternalY + rightOffsetY;
  const verticalJump = Math.abs(leftSeamY - rightSeamY);
  const leftThickness = seamThickness(leftGenerated.mask, leftGenerated.width, leftGenerated.height, leftGenerated.width - 1, leftGenerated.rightExternalY);
  const rightThickness = seamThickness(rightGenerated.mask, rightGenerated.width, rightGenerated.height, 0, rightGenerated.leftExternalY);
  const thicknessMismatch = Math.abs(leftThickness - rightThickness) / Math.max(1, leftThickness, rightThickness);
  const seamDistance = minimumInkDistance(leftGenerated, rightGenerated, { leftOffsetY, rightOffsetY, rightX, window: options.seamWindow || 8 });
  const overlap = overlapPixels(leftGenerated, rightGenerated, rightX, leftOffsetY, rightOffsetY);
  const leftBody = actualBodyBounds(leftGenerated, 'left');
  const rightBody = actualBodyBounds(rightGenerated, 'right');
  const leftBodyRight = leftBody?.x1 ?? (leftGenerated.width - leftGenerated.rightPad - 1);
  const rightBodyLeft = rightX + (rightBody?.x0 ?? rightGenerated.leftPad);
  const bodyGap = rightBodyLeft - leftBodyRight - 1;
  const seamInk = pointInk(leftGenerated.mask, leftGenerated.width, leftGenerated.height, leftGenerated.width - 1, leftGenerated.rightExternalY, 3)
    + pointInk(rightGenerated.mask, rightGenerated.width, rightGenerated.height, 0, rightGenerated.leftExternalY, 3);

  const reasons = [];
  let score = 100;
  let hardFailure = false;
  const expectedThickness = Math.max(1, Number(cursive.thickness || 2.2));

  if (!Number.isFinite(seamDistance) || seamDistance > Math.max(3, expectedThickness * 1.8)) {
    reasons.push('Между соединительными штрихами образуется разрыв.'); score -= 45; hardFailure = true;
  } else if (seamDistance > Math.max(1.25, expectedThickness * 0.7)) {
    reasons.push('Стык соединительных штрихов требует проверки.'); score -= 18;
  }
  if (verticalJump > Math.max(3, expectedThickness * 1.6)) {
    reasons.push('В месте соединения заметен вертикальный скачок.'); score -= 35; hardFailure = true;
  } else if (verticalJump > Math.max(1.4, expectedThickness * 0.75)) {
    reasons.push('Высоты входа и выхода немного различаются.'); score -= 14;
  }
  if (thicknessMismatch > 0.65) {
    reasons.push('Толщина штриха резко меняется на стыке.'); score -= 28;
  } else if (thicknessMismatch > 0.35) {
    reasons.push('Толщина штриха на стыке неоднородна.'); score -= 12;
  }
  const collisionLimit = Math.max(18, expectedThickness * expectedThickness * 7);
  if (overlap > collisionLimit * 2) {
    reasons.push('Контуры букв чрезмерно накладываются друг на друга.'); score -= 34; hardFailure = true;
  } else if (overlap > collisionLimit) {
    reasons.push('В соединении возможно локальное утолщение.'); score -= 13;
  }
  const averageWidth = (leftGlyph.width + rightGlyph.width) / 2;
  if (bodyGap > averageWidth * 0.48) {
    reasons.push('Межбуквенный промежуток слишком большой.'); score -= 24;
  } else if (bodyGap < -averageWidth * 0.16) {
    reasons.push('Корпусы букв сталкиваются.'); score -= 30; hardFailure = true;
  }
  if (seamInk < Math.max(2, expectedThickness)) {
    reasons.push('На стыке слишком мало чернил.'); score -= 18;
  }

  score = clamp(Math.round(score), 0, 100);
  const status = statusFromScore(score, hardFailure);
  return {
    version: PAIR_INSPECTOR_VERSION,
    pair: `${leftChar}${rightChar}`,
    leftCharacter: leftChar,
    rightCharacter: rightChar,
    status,
    score,
    reasons,
    metrics: {
      exitClass: sequence[0].exitClass,
      entryClass: sequence[1].entryClass,
      entryMode: sequence[1].entryMode,
      entryProfile: rightGenerated.entryProfile || rightGenerated.entryMode,
      verticalJump,
      seamDistance,
      leftThickness,
      rightThickness,
      thicknessMismatch,
      overlapPixels: overlap,
      bodyGap,
      seamInk,
      spacing,
    },
    sequence,
    geometry: {
      baseline,
      rightX,
      leftOffsetY,
      rightOffsetY,
      left: leftGenerated,
      right: rightGenerated,
    },
  };
}

export function inspectRussianPairMatrix(project, options = {}) {
  const requested = options.characters || RUSSIAN_LOWERCASE;
  const characters = [...new Set([...requested].filter((character) => RUSSIAN_LOWERCASE.includes(character)))];
  const pairs = [];
  const byPair = {};
  const counts = Object.fromEntries(PAIR_STATUSES.map((status) => [status, 0]));
  for (const leftCharacter of characters) for (const rightCharacter of characters) {
    const result = inspectRussianPair(project, leftCharacter, rightCharacter, options);
    pairs.push(result);
    byPair[result.pair] = result;
    counts[result.status] = (counts[result.status] || 0) + 1;
  }
  const available = pairs.filter((pair) => pair.status !== 'missing' && pair.status !== 'disconnected');
  const averageScore = available.length ? Math.round(available.reduce((sum, pair) => sum + pair.score, 0) / available.length) : 0;
  return {
    version: PAIR_INSPECTOR_VERSION,
    characters,
    total: pairs.length,
    inspected: available.length,
    averageScore,
    counts,
    pairs,
    byPair,
  };
}
