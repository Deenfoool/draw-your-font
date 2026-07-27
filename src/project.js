const PROJECT_VERSION = 4;

function cloneMask(mask) { return mask instanceof Uint8Array ? new Uint8Array(mask) : Uint8Array.from(mask || []); }
function nowIso() { return new Date().toISOString(); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

export function createEmptyProject(options = {}) {
  const now = nowIso();
  return {
    format: 'draw-your-font-project', version: PROJECT_VERSION,
    id: options.id || (globalThis.crypto?.randomUUID?.() || `dyfr-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    title: options.title || 'Мой рукописный шрифт', createdAt: options.createdAt || now, updatedAt: now,
    glyphs: [], kerning: {},
    font: { familyName: options.familyName || options.title || 'Мой рукописный шрифт', styleName: 'Regular', unitsPerEm: 1000, ascent: 800, descent: -200, lineGap: 120 },
    template: options.template || null, sourceFiles: [],
  };
}

export function defaultGlyphMetrics(character = '') {
  const narrow = /[ГТІI1!.,:;()\[\]{}]/u.test(character), wide = /[ЖШЩМЮW@%&]/u.test(character), punctuation = /[^\p{L}\p{N}]/u.test(character);
  const base = punctuation ? 32 : narrow ? 42 : wide ? 66 : 56;
  return { offsetX: 0, offsetY: 0, scale: 1, leftSideBearing: base, rightSideBearing: base, advanceWidth: null };
}

export function normalizeGlyphRecord(glyph, index = 0) {
  const width = Math.max(1, Math.round(glyph.width || 1)), height = Math.max(1, Math.round(glyph.height || 1));
  const mask = cloneMask(glyph.mask);
  if (mask.length !== width * height) throw new Error(`Маска символа ${glyph.char || index + 1} имеет неверный размер.`);
  return {
    id: glyph.id || `glyph-${index + 1}`, char: [...String(glyph.char || '').normalize('NFC')][0] || '', width, height, mask,
    guides: { capY: Number(glyph.guides?.capY ?? height * 0.12), xHeightY: Number(glyph.guides?.xHeightY ?? height * 0.38), baselineY: Number(glyph.guides?.baselineY ?? height * 0.82), descenderY: Number(glyph.guides?.descenderY ?? height * 0.94) },
    metrics: { ...defaultGlyphMetrics(glyph.char), ...(glyph.metrics || {}) },
    quality: glyph.quality || assessGlyphMask(mask, width, height, glyph.guides), source: glyph.source || { type: 'unknown' },
  };
}

export function projectFromScannedSummary(summary, options = {}) {
  const project = createEmptyProject({ title: options.title, familyName: options.familyName, template: options.template || null });
  project.glyphs = summary.glyphs.map(normalizeGlyphRecord); project.sourceFiles = [...(options.sourceFiles || [])]; project.updatedAt = nowIso(); return project;
}

export function projectFromSegmentationSource(source, options = {}) {
  if (!source?.mask || !Array.isArray(source.glyphs)) throw new Error('Разметка первого этапа отсутствует.');
  const project = createEmptyProject({ title: options.title || source.fileName || 'Мой рукописный шрифт' });
  project.glyphs = source.glyphs.map((box, index) => {
    const pad = 3, x0 = Math.max(0, Math.floor(box.x0) - pad), y0 = Math.max(0, Math.floor(box.y0) - pad);
    const x1 = Math.min(source.width - 1, Math.ceil(box.x1) + pad), y1 = Math.min(source.height - 1, Math.ceil(box.y1) + pad);
    const width = x1 - x0 + 1, height = y1 - y0 + 1, mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) mask[y * width + x] = source.mask[(y0 + y) * source.width + x0 + x] ? 1 : 0;
    return normalizeGlyphRecord({ id: box.id || `manual-${index + 1}`, char: source.labels?.[index] || '', width, height, mask,
      guides: { capY: height * 0.12, xHeightY: height * 0.4, baselineY: height * 0.82, descenderY: height * 0.94 },
      source: { type: 'manual-segmentation', fileName: source.fileName || '' } }, index);
  });
  return project;
}

export function assessGlyphMask(mask, width, height, guides = null) {
  let count = 0, minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (mask[y * width + x]) { count += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const bbox = count ? { x0: minX, y0: minY, x1: maxX, y1: maxY, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
  const areaRatio = count / Math.max(1, width * height), warnings = [];
  if (!count) warnings.push('Пустой символ');
  if (bbox && (bbox.x0 <= 1 || bbox.x1 >= width - 2 || bbox.y0 <= 1 || bbox.y1 >= height - 2)) warnings.push('Штрих касается края');
  if (bbox && bbox.height < height * 0.18) warnings.push('Символ слишком маленький');
  if (bbox && bbox.height > height * 0.95) warnings.push('Символ слишком высокий');
  if (bbox && Math.abs((bbox.x0 + bbox.x1) / 2 - width / 2) > width * 0.28) warnings.push('Символ сильно смещён по горизонтали');
  if (guides?.baselineY != null && bbox && bbox.y1 < guides.baselineY - height * 0.2 && /[А-Яа-я0-9]/u.test('А')) warnings.push('Символ заметно выше базовой линии');
  if (areaRatio > 0.46) warnings.push('Слишком много чернил или тень');
  return { inkCount: count, areaRatio, bbox, warnings };
}

export function setMaskPixel(glyph, x, y, value, radius = 1) {
  const cx = Math.round(x), cy = Math.round(y), r = Math.max(0, Math.round(radius));
  for (let py = cy - r; py <= cy + r; py += 1) for (let px = cx - r; px <= cx + r; px += 1) {
    if (px < 0 || py < 0 || px >= glyph.width || py >= glyph.height) continue;
    if ((px - cx) ** 2 + (py - cy) ** 2 <= r ** 2 + 0.5) glyph.mask[py * glyph.width + px] = value ? 1 : 0;
  }
  glyph.quality = assessGlyphMask(glyph.mask, glyph.width, glyph.height, glyph.guides);
}

export function shiftGlyphMask(glyph, dx, dy) {
  const out = new Uint8Array(glyph.mask.length), ix = Math.round(dx), iy = Math.round(dy);
  for (let y = 0; y < glyph.height; y += 1) for (let x = 0; x < glyph.width; x += 1) {
    const sx = x - ix, sy = y - iy; if (sx >= 0 && sy >= 0 && sx < glyph.width && sy < glyph.height) out[y * glyph.width + x] = glyph.mask[sy * glyph.width + sx];
  }
  glyph.mask = out; glyph.quality = assessGlyphMask(out, glyph.width, glyph.height, glyph.guides);
}

export function scaleGlyphMask(glyph, factor) {
  const scale = clamp(factor, 0.35, 2.5), out = new Uint8Array(glyph.mask.length), cx = (glyph.width - 1) / 2, baseline = glyph.guides.baselineY;
  for (let y = 0; y < glyph.height; y += 1) for (let x = 0; x < glyph.width; x += 1) {
    const sx = Math.round(cx + (x - cx) / scale), sy = Math.round(baseline + (y - baseline) / scale);
    if (sx >= 0 && sy >= 0 && sx < glyph.width && sy < glyph.height) out[y * glyph.width + x] = glyph.mask[sy * glyph.width + sx];
  }
  glyph.mask = out; glyph.quality = assessGlyphMask(out, glyph.width, glyph.height, glyph.guides);
}

function edgeProfiles(glyph) {
  const left = new Float32Array(glyph.height), right = new Float32Array(glyph.height); left.fill(NaN); right.fill(NaN);
  for (let y = 0; y < glyph.height; y += 1) {
    for (let x = 0; x < glyph.width; x += 1) if (glyph.mask[y * glyph.width + x]) { left[y] = x; break; }
    for (let x = glyph.width - 1; x >= 0; x -= 1) if (glyph.mask[y * glyph.width + x]) { right[y] = x; break; }
  }
  return { left, right };
}

export function suggestKerningValue(leftGlyph, rightGlyph, options = {}) {
  const target = Number(options.targetGap ?? 48), leftProfiles = edgeProfiles(leftGlyph), rightProfiles = edgeProfiles(rightGlyph), rows = Math.max(leftGlyph.height, rightGlyph.height);
  let minimumGap = Infinity, samples = 0;
  for (let i = 0; i < rows; i += 1) {
    const ly = Math.min(leftGlyph.height - 1, Math.floor(i * leftGlyph.height / rows)), ry = Math.min(rightGlyph.height - 1, Math.floor(i * rightGlyph.height / rows));
    const lr = leftProfiles.right[ly], rl = rightProfiles.left[ry]; if (!Number.isFinite(lr) || !Number.isFinite(rl)) continue;
    const leftScale = 700 / Math.max(1, leftGlyph.guides.baselineY - leftGlyph.guides.capY), rightScale = 700 / Math.max(1, rightGlyph.guides.baselineY - rightGlyph.guides.capY);
    const leftWhitespace = (leftGlyph.width - 1 - lr) * leftScale + Number(leftGlyph.metrics.rightSideBearing || 0);
    const rightWhitespace = rl * rightScale + Number(rightGlyph.metrics.leftSideBearing || 0);
    minimumGap = Math.min(minimumGap, leftWhitespace + rightWhitespace); samples += 1;
  }
  if (!samples || !Number.isFinite(minimumGap)) return 0;
  return Math.round(clamp(target - minimumGap, -220, 80));
}

const COMMON_PAIRS = ['АВ','АГ','АД','АЛ','АТ','АУ','АЧ','ВА','ГА','ДА','ЛА','ТА','ТО','ТУ','УА','УД','УО','ФА','ЧА','YA','То','Та','Те','Уа','Уо','Ла','Га','Ра','Во','Да','ло','ро','ст','то','тя','уа','фа','ча','ье','ый'];

export function autoKerning(project) {
  const byChar = new Map(project.glyphs.filter((glyph) => glyph.char).map((glyph) => [glyph.char, glyph])), pairs = {};
  for (const pair of COMMON_PAIRS) {
    const chars = [...pair]; if (chars.length !== 2) continue;
    const left = byChar.get(chars[0]), right = byChar.get(chars[1]); if (!left || !right) continue;
    const value = suggestKerningValue(left, right); if (Math.abs(value) >= 8) pairs[`${chars[0]}|${chars[1]}`] = value;
  }
  project.kerning = { ...project.kerning, ...pairs }; project.updatedAt = nowIso(); return pairs;
}

export function autoMetrics(project) {
  for (const glyph of project.glyphs) {
    const defaults = defaultGlyphMetrics(glyph.char), bbox = glyph.quality?.bbox || assessGlyphMask(glyph.mask, glyph.width, glyph.height, glyph.guides).bbox;
    glyph.metrics.leftSideBearing = defaults.leftSideBearing; glyph.metrics.rightSideBearing = defaults.rightSideBearing; glyph.metrics.advanceWidth = null;
    if (bbox) { const center = (bbox.x0 + bbox.x1) / 2; glyph.metrics.offsetX = Math.round((glyph.width / 2 - center) * 0.18); }
  }
  project.updatedAt = nowIso(); return project;
}

function rleEncode(mask) {
  if (!mask.length) return '';
  const bytes = []; let value = mask[0] ? 1 : 0, run = 0;
  for (let i = 0; i < mask.length; i += 1) { const bit = mask[i] ? 1 : 0; if (bit === value && run < 0xffff) run += 1; else { bytes.push(value, run >> 8, run & 255); value = bit; run = 1; } }
  bytes.push(value, run >> 8, run & 255); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function rleDecode(encoded, expectedLength) {
  if (!encoded) return new Uint8Array(expectedLength);
  const binary = typeof atob === 'function' ? atob(encoded) : Buffer.from(encoded, 'base64').toString('binary');
  const out = new Uint8Array(expectedLength); let offset = 0;
  for (let i = 0; i + 2 < binary.length; i += 3) { const value = binary.charCodeAt(i) ? 1 : 0, run = (binary.charCodeAt(i + 1) << 8) | binary.charCodeAt(i + 2); out.fill(value, offset, Math.min(expectedLength, offset + run)); offset += run; }
  if (offset !== expectedLength) throw new Error('Маска проекта повреждена.'); return out;
}

export function serializeProject(project) {
  const plain = { ...project, version: PROJECT_VERSION, updatedAt: nowIso(), glyphs: project.glyphs.map((glyph) => ({ ...glyph, mask: rleEncode(glyph.mask) })) };
  return JSON.stringify(plain);
}

export function deserializeProject(text) {
  const plain = typeof text === 'string' ? JSON.parse(text) : text;
  if (plain?.format !== 'draw-your-font-project') throw new Error('Это не проект Draw Your Font.');
  if (Number(plain.version) > PROJECT_VERSION) throw new Error('Проект создан более новой версией приложения.');
  const project = { ...plain, version: PROJECT_VERSION, glyphs: [] };
  project.glyphs = (plain.glyphs || []).map((glyph, index) => normalizeGlyphRecord({ ...glyph, mask: rleDecode(glyph.mask, glyph.width * glyph.height) }, index));
  project.kerning = { ...(plain.kerning || {}) }; project.font = { ...createEmptyProject().font, ...(plain.font || {}) }; return project;
}

export function validateProject(project) {
  const errors = []; if (project?.format !== 'draw-your-font-project') errors.push('Неверный формат проекта.'); const seen = new Set();
  project?.glyphs?.forEach((glyph, index) => {
    if (!glyph.char) errors.push(`Символ ${index + 1} не подписан.`); const codepoint = glyph.char?.codePointAt(0);
    if (codepoint != null && seen.has(codepoint)) errors.push(`Символ «${glyph.char}» повторяется.`); if (codepoint != null) seen.add(codepoint);
    if (!(glyph.mask instanceof Uint8Array) || glyph.mask.length !== glyph.width * glyph.height) errors.push(`Маска «${glyph.char || index + 1}» повреждена.`);
  });
  return errors;
}

export function projectToFontSource(project) { return { kind: 'dyfr-project', project, glyphs: project.glyphs, kerning: project.kerning, font: project.font }; }
