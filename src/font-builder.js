const UPEM = 1000;
const DEFAULT_ASCENT = 800;
const DEFAULT_DESCENT = -200;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function align4(value) {
  return (value + 3) & ~3;
}

function tagBytes(tag) {
  if (tag.length !== 4) throw new Error(`Invalid sfnt tag: ${tag}`);
  return Uint8Array.from([...tag].map((ch) => ch.charCodeAt(0)));
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pad4(bytes) {
  if (bytes.length % 4 === 0) return bytes;
  const out = new Uint8Array(align4(bytes.length));
  out.set(bytes);
  return out;
}

function checksum(bytes) {
  const padded = pad4(bytes);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + view.getUint32(i, false)) >>> 0;
  }
  return sum >>> 0;
}

class Writer {
  constructor(length) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
    this.offset = 0;
  }

  u8(value) { this.view.setUint8(this.offset, value); this.offset += 1; return this; }
  i8(value) { this.view.setInt8(this.offset, value); this.offset += 1; return this; }
  u16(value) { this.view.setUint16(this.offset, value & 0xffff, false); this.offset += 2; return this; }
  i16(value) { this.view.setInt16(this.offset, clamp(Math.round(value), -32768, 32767), false); this.offset += 2; return this; }
  u32(value) { this.view.setUint32(this.offset, value >>> 0, false); this.offset += 4; return this; }
  i32(value) { this.view.setInt32(this.offset, value | 0, false); this.offset += 4; return this; }
  fixed(value) { return this.u32(Math.round(value * 65536)); }
  raw(bytes) { this.bytes.set(bytes, this.offset); this.offset += bytes.length; return this; }
  ascii(value, length = value.length) {
    for (let i = 0; i < length; i += 1) this.u8(i < value.length ? value.charCodeAt(i) & 0xff : 0);
    return this;
  }
}

class LEWriter extends Writer {
  u16(value) { this.view.setUint16(this.offset, value & 0xffff, true); this.offset += 2; return this; }
  i16(value) { this.view.setInt16(this.offset, clamp(Math.round(value), -32768, 32767), true); this.offset += 2; return this; }
  u32(value) { this.view.setUint32(this.offset, value >>> 0, true); this.offset += 4; return this; }
  i32(value) { this.view.setInt32(this.offset, value | 0, true); this.offset += 4; return this; }
}

function sanitizeFontName(value, fallback = 'My Handwriting') {
  const name = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.slice(0, 63) || fallback;
}

function postScriptName(value) {
  const cleaned = sanitizeFontName(value).normalize('NFKD').replace(/[^A-Za-z0-9-]/g, '');
  return (cleaned || 'MyHandwriting').slice(0, 63);
}

function utf16be(value) {
  const units = [];
  for (let i = 0; i < value.length; i += 1) units.push(value.charCodeAt(i));
  const out = new Uint8Array(units.length * 2);
  const view = new DataView(out.buffer);
  units.forEach((unit, index) => view.setUint16(index * 2, unit, false));
  return out;
}

function key(x, y) {
  return `${x},${y}`;
}

function direction(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx > 0) return 0;
  if (dy > 0) return 1;
  if (dx < 0) return 2;
  return 3;
}

function edgeLoops(mask, width, height) {
  const edges = [];
  const add = (x1, y1, x2, y2) => edges.push({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, used: false });
  const ink = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] !== 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!ink(x, y)) continue;
      if (!ink(x, y - 1)) add(x, y, x + 1, y);
      if (!ink(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!ink(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!ink(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const outgoing = new Map();
  edges.forEach((edge, index) => {
    const k = key(edge.a.x, edge.a.y);
    if (!outgoing.has(k)) outgoing.set(k, []);
    outgoing.get(k).push(index);
  });

  const loops = [];
  const turnPriority = [1, 0, 3, 2];
  for (let startIndex = 0; startIndex < edges.length; startIndex += 1) {
    if (edges[startIndex].used) continue;
    const start = edges[startIndex];
    const points = [{ ...start.a }];
    let currentIndex = startIndex;
    let guard = 0;
    while (guard++ < edges.length + 8) {
      const edge = edges[currentIndex];
      if (edge.used) break;
      edge.used = true;
      points.push({ ...edge.b });
      if (edge.b.x === start.a.x && edge.b.y === start.a.y) break;
      const candidates = (outgoing.get(key(edge.b.x, edge.b.y)) || []).filter((idx) => !edges[idx].used);
      if (!candidates.length) break;
      const incoming = direction(edge.a, edge.b);
      candidates.sort((ia, ib) => {
        const da = (direction(edges[ia].a, edges[ia].b) - incoming + 4) % 4;
        const db = (direction(edges[ib].a, edges[ib].b) - incoming + 4) % 4;
        return turnPriority.indexOf(da) - turnPriority.indexOf(db);
      });
      currentIndex = candidates[0];
    }
    if (points.length >= 4 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y) {
      points.pop();
      loops.push(points);
    }
  }
  return loops;
}

function removeCollinear(points) {
  if (points.length < 4) return points;
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
    if (cross !== 0) out.push(cur);
  }
  return out.length >= 3 ? out : points;
}

function pointLineDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function simplifyClosed(points, tolerance) {
  let result = removeCollinear(points);
  if (tolerance <= 0 || result.length < 6) return result;
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    const next = [];
    for (let i = 0; i < result.length; i += 1) {
      const prev = result[(i - 1 + result.length) % result.length];
      const cur = result[i];
      const after = result[(i + 1) % result.length];
      if (pointLineDistance(cur, prev, after) <= tolerance) changed = true;
      else next.push(cur);
    }
    if (next.length < 3) break;
    result = next;
  }
  return result;
}

export function resampleMask(sourceMask, sourceWidth, sourceHeight, box, maxDimension = 96) {
  const sourceBoxWidth = box.x1 - box.x0 + 1;
  const sourceBoxHeight = box.y1 - box.y0 + 1;
  const scale = Math.min(1, maxDimension / Math.max(sourceBoxWidth, sourceBoxHeight));
  const width = Math.max(1, Math.round(sourceBoxWidth * scale));
  const height = Math.max(1, Math.round(sourceBoxHeight * scale));
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const sy0 = box.y0 + Math.floor(y * sourceBoxHeight / height);
    const sy1 = box.y0 + Math.max(Math.floor((y + 1) * sourceBoxHeight / height) - 1, Math.floor(y * sourceBoxHeight / height));
    for (let x = 0; x < width; x += 1) {
      const sx0 = box.x0 + Math.floor(x * sourceBoxWidth / width);
      const sx1 = box.x0 + Math.max(Math.floor((x + 1) * sourceBoxWidth / width) - 1, Math.floor(x * sourceBoxWidth / width));
      let count = 0;
      let total = 0;
      for (let sy = sy0; sy <= sy1; sy += 1) {
        for (let sx = sx0; sx <= sx1; sx += 1) {
          total += 1;
          count += sourceMask[sy * sourceWidth + sx] ? 1 : 0;
        }
      }
      if (count / Math.max(1, total) >= 0.28) out[y * width + x] = 1;
    }
  }
  return { mask: out, width, height };
}

export function maskToContours(mask, width, height, options = {}) {
  const simplify = Number(options.simplify ?? 0.55);
  return edgeLoops(mask, width, height)
    .map((loop) => simplifyClosed(loop, simplify))
    .filter((loop) => loop.length >= 3);
}

function makeNotdefGlyph() {
  const outer = [
    { x: 60, y: -20, onCurve: true }, { x: 540, y: -20, onCurve: true },
    { x: 540, y: 720, onCurve: true }, { x: 60, y: 720, onCurve: true },
  ];
  const inner = [
    { x: 140, y: 80, onCurve: true }, { x: 140, y: 620, onCurve: true },
    { x: 460, y: 620, onCurve: true }, { x: 460, y: 80, onCurve: true },
  ];
  return finalizeGlyph({ name: '.notdef', unicode: [], contours: [outer, inner], advanceWidth: 600, leftSideBearing: 60 });
}

function makeSpaceGlyph() {
  return finalizeGlyph({ name: 'space', unicode: [32], contours: [], advanceWidth: 340, leftSideBearing: 0 });
}

function finalizeGlyph(glyph) {
  const points = glyph.contours.flat();
  const xMin = points.length ? Math.min(...points.map((p) => p.x)) : 0;
  const yMin = points.length ? Math.min(...points.map((p) => p.y)) : 0;
  const xMax = points.length ? Math.max(...points.map((p) => p.x)) : 0;
  const yMax = points.length ? Math.max(...points.map((p) => p.y)) : 0;
  return { ...glyph, xMin, yMin, xMax, yMax };
}

function glyphNameForCodepoint(codepoint) {
  if (codepoint === 32) return 'space';
  return `uni${codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function vectorizeGlyph(source, glyph, character, options = {}) {
  const detail = clamp(Number(options.detail ?? 96), 32, 196);
  const sideBearing = clamp(Number(options.sideBearing ?? 60), 0, 250);
  const glyphHeight = clamp(Number(options.glyphHeight ?? 700), 300, 900);
  const baseline = clamp(Number(options.baseline ?? 0), -300, 300);
  const simplify = clamp(Number(options.simplify ?? 0.55), 0, 3);
  const sampled = resampleMask(source.mask, source.width, source.height, glyph, detail);
  const loops = maskToContours(sampled.mask, sampled.width, sampled.height, { simplify });
  if (!loops.length) throw new Error(`Символ «${character}» не содержит контура.`);

  const scale = glyphHeight / Math.max(1, sampled.height);
  const contours = loops.map((loop) => loop.map((point) => ({
    x: Math.round(sideBearing + point.x * scale),
    y: Math.round(baseline + (sampled.height - point.y) * scale),
    onCurve: true,
  })));
  const contentWidth = Math.max(...contours.flat().map((p) => p.x)) - sideBearing;
  const advanceWidth = clamp(Math.ceil(contentWidth + sideBearing * 2), 240, 1800);
  const codepoint = character.codePointAt(0);
  return finalizeGlyph({
    name: glyphNameForCodepoint(codepoint),
    unicode: [codepoint],
    contours,
    advanceWidth,
    leftSideBearing: sideBearing,
  });
}

export function createGlyphSet(source, options = {}) {
  if (!source || !source.mask || !Array.isArray(source.glyphs) || !Array.isArray(source.labels)) {
    throw new Error('Нет подтверждённой разметки для сборки шрифта.');
  }
  const seen = new Set();
  const duplicates = [];
  const skipped = [];
  const glyphs = [makeNotdefGlyph(), makeSpaceGlyph()];
  const entries = [];

  source.glyphs.forEach((glyph, index) => {
    const raw = source.labels[index] || '';
    const character = [...String(raw).normalize('NFC')][0] || '';
    if (!character || /\s/u.test(character)) { skipped.push(index); return; }
    const codepoint = character.codePointAt(0);
    if (seen.has(codepoint)) { duplicates.push(character); return; }
    seen.add(codepoint);
    const vector = vectorizeGlyph(source, glyph, character, options);
    entries.push({ character, codepoint, glyph: vector, sourceIndex: index });
  });

  entries.sort((a, b) => a.codepoint - b.codepoint);
  glyphs.push(...entries.map((entry) => entry.glyph));
  return { glyphs, entries, duplicates, skipped };
}

function buildGlyfTable(glyphs) {
  const chunks = [];
  const offsets = [0];
  let total = 0;
  for (const glyph of glyphs) {
    let bytes;
    if (!glyph.contours.length) {
      bytes = new Uint8Array(0);
    } else {
      const pointCount = glyph.contours.reduce((sum, contour) => sum + contour.length, 0);
      const length = 10 + glyph.contours.length * 2 + 2 + pointCount + pointCount * 2 + pointCount * 2;
      const writer = new Writer(length);
      writer.i16(glyph.contours.length).i16(glyph.xMin).i16(glyph.yMin).i16(glyph.xMax).i16(glyph.yMax);
      let endPoint = -1;
      for (const contour of glyph.contours) {
        endPoint += contour.length;
        writer.u16(endPoint);
      }
      writer.u16(0);
      const points = glyph.contours.flat();
      points.forEach((point) => writer.u8(point.onCurve === false ? 0 : 1));
      let previousX = 0;
      points.forEach((point) => { writer.i16(point.x - previousX); previousX = point.x; });
      let previousY = 0;
      points.forEach((point) => { writer.i16(point.y - previousY); previousY = point.y; });
      bytes = writer.bytes;
    }
    const padded = bytes.length % 2 ? concatBytes([bytes, new Uint8Array(1)]) : bytes;
    chunks.push(padded);
    total += padded.length;
    offsets.push(total);
  }
  return { bytes: concatBytes(chunks), offsets };
}

function buildLocaTable(offsets) {
  const writer = new Writer(offsets.length * 4);
  offsets.forEach((offset) => writer.u32(offset));
  return writer.bytes;
}

function buildHmtxTable(glyphs) {
  const writer = new Writer(glyphs.length * 4);
  glyphs.forEach((glyph) => writer.u16(glyph.advanceWidth).i16(glyph.leftSideBearing));
  return writer.bytes;
}

function buildCmapTable(glyphs) {
  const mappings = [];
  glyphs.forEach((glyph, glyphIndex) => {
    (glyph.unicode || []).forEach((codepoint) => {
      if (codepoint >= 0 && codepoint <= 0xffff && codepoint !== 0xffff) mappings.push({ codepoint, glyphIndex });
    });
  });
  mappings.sort((a, b) => a.codepoint - b.codepoint);
  const unique = [];
  const used = new Set();
  for (const mapping of mappings) {
    if (!used.has(mapping.codepoint)) { used.add(mapping.codepoint); unique.push(mapping); }
  }
  const segCount = unique.length + 1;
  const subLength = 16 + segCount * 8;
  const writer = new Writer(12 + subLength);
  writer.u16(0).u16(1).u16(3).u16(1).u32(12);
  const maxPower = 2 ** Math.floor(Math.log2(segCount));
  writer.u16(4).u16(subLength).u16(0).u16(segCount * 2).u16(maxPower * 2).u16(Math.log2(maxPower)).u16(segCount * 2 - maxPower * 2);
  unique.forEach((m) => writer.u16(m.codepoint)); writer.u16(0xffff);
  writer.u16(0);
  unique.forEach((m) => writer.u16(m.codepoint)); writer.u16(0xffff);
  unique.forEach((m) => writer.u16((m.glyphIndex - m.codepoint) & 0xffff)); writer.u16(1);
  for (let i = 0; i < segCount; i += 1) writer.u16(0);
  return writer.bytes;
}

function buildNameTable(familyName, styleName, version) {
  const fullName = `${familyName} ${styleName}`.trim();
  const psName = `${postScriptName(familyName)}-${postScriptName(styleName || 'Regular')}`;
  const unique = `${version};DYFR;${psName}`;
  const values = new Map([[1, familyName], [2, styleName], [3, unique], [4, fullName], [5, `Version ${version}`], [6, psName]]);
  const records = [];
  const strings = [];
  let offset = 0;
  for (const [nameId, value] of values) {
    const bytes = utf16be(value);
    records.push({ platformId: 3, encodingId: 1, languageId: 0x0419, nameId, length: bytes.length, offset });
    strings.push(bytes);
    offset += bytes.length;
  }
  const writer = new Writer(6 + records.length * 12 + offset);
  writer.u16(0).u16(records.length).u16(6 + records.length * 12);
  records.forEach((record) => writer.u16(record.platformId).u16(record.encodingId).u16(record.languageId).u16(record.nameId).u16(record.length).u16(record.offset));
  strings.forEach((bytes) => writer.raw(bytes));
  return writer.bytes;
}

function buildHeadTable(bounds, unitsPerEm) {
  const writer = new Writer(54);
  writer.fixed(1).fixed(1).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(unitsPerEm);
  const macTime = Math.floor(Date.now() / 1000 + 2082844800);
  writer.u32(0).u32(macTime).u32(0).u32(macTime);
  writer.i16(bounds.xMin).i16(bounds.yMin).i16(bounds.xMax).i16(bounds.yMax);
  writer.u16(0).u16(8).i16(2).i16(1).i16(0);
  return writer.bytes;
}

function buildHheaTable(glyphs, ascent, descent) {
  const advanceWidthMax = Math.max(...glyphs.map((g) => g.advanceWidth));
  const minLeft = Math.min(...glyphs.map((g) => g.leftSideBearing));
  const minRight = Math.min(...glyphs.map((g) => g.advanceWidth - g.leftSideBearing - (g.xMax - g.xMin)));
  const xMaxExtent = Math.max(...glyphs.map((g) => g.leftSideBearing + (g.xMax - g.xMin)));
  const writer = new Writer(36);
  writer.fixed(1).i16(ascent).i16(descent).i16(0).u16(advanceWidthMax).i16(minLeft).i16(minRight).i16(xMaxExtent);
  writer.i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length);
  return writer.bytes;
}

function buildMaxpTable(glyphs) {
  const maxPoints = Math.max(0, ...glyphs.map((g) => g.contours.reduce((sum, c) => sum + c.length, 0)));
  const maxContours = Math.max(0, ...glyphs.map((g) => g.contours.length));
  const writer = new Writer(32);
  writer.fixed(1).u16(glyphs.length).u16(maxPoints).u16(maxContours).u16(0).u16(0).u16(1).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  return writer.bytes;
}

function buildOS2Table(glyphs, ascent, descent, weightClass) {
  const widths = glyphs.slice(1).map((g) => g.advanceWidth);
  const average = widths.length ? Math.round(widths.reduce((a, b) => a + b, 0) / widths.length) : 500;
  const codes = glyphs.flatMap((g) => g.unicode || []).filter((c) => c <= 0xffff);
  const first = codes.length ? Math.min(...codes) : 32;
  const last = codes.length ? Math.max(...codes) : 32;
  const writer = new Writer(78);
  writer.u16(0).i16(average).u16(weightClass).u16(5).u16(0);
  writer.i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(250).i16(0);
  writer.u8(2).u8(11).u8(5).u8(9).u8(2).u8(2).u8(3).u8(2).u8(2).u8(4);
  writer.u32(0x00000201).u32(0).u32(0).u32(0);
  writer.ascii('DYFR', 4).u16(0x0040).u16(first).u16(last);
  writer.i16(ascent).i16(descent).i16(0).u16(Math.max(0, ascent)).u16(Math.max(0, -descent));
  return writer.bytes;
}

function buildPostTable() {
  const writer = new Writer(32);
  writer.fixed(3).fixed(0).i16(-75).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);
  return writer.bytes;
}

function tableBounds(glyphs) {
  const withPoints = glyphs.filter((g) => g.contours.length);
  return {
    xMin: withPoints.length ? Math.min(...withPoints.map((g) => g.xMin)) : 0,
    yMin: withPoints.length ? Math.min(...withPoints.map((g) => g.yMin)) : 0,
    xMax: withPoints.length ? Math.max(...withPoints.map((g) => g.xMax)) : 0,
    yMax: withPoints.length ? Math.max(...withPoints.map((g) => g.yMax)) : 0,
  };
}

export function buildTrueTypeFont(glyphs, options = {}) {
  if (!Array.isArray(glyphs) || glyphs.length < 2) throw new Error('Для шрифта нужны .notdef и пробел.');
  const familyName = sanitizeFontName(options.familyName);
  const styleName = sanitizeFontName(options.styleName || 'Regular', 'Regular');
  const version = String(options.version || '1.000').replace(/[^0-9.]/g, '').slice(0, 16) || '1.000';
  const weightClass = clamp(Number(options.weightClass || 400), 1, 1000);
  const ascent = clamp(Number(options.ascent ?? DEFAULT_ASCENT), 200, 1600);
  const descent = clamp(Number(options.descent ?? DEFAULT_DESCENT), -800, -1);
  const bounds = tableBounds(glyphs);
  const glyf = buildGlyfTable(glyphs);
  const tables = new Map([
    ['OS/2', buildOS2Table(glyphs, ascent, descent, weightClass)],
    ['cmap', buildCmapTable(glyphs)],
    ['glyf', glyf.bytes],
    ['head', buildHeadTable(bounds, UPEM)],
    ['hhea', buildHheaTable(glyphs, ascent, descent)],
    ['hmtx', buildHmtxTable(glyphs)],
    ['loca', buildLocaTable(glyf.offsets)],
    ['maxp', buildMaxpTable(glyphs)],
    ['name', buildNameTable(familyName, styleName, version)],
    ['post', buildPostTable()],
  ]);

  const tags = [...tables.keys()].sort();
  const numTables = tags.length;
  const maxPower = 2 ** Math.floor(Math.log2(numTables));
  const directoryLength = 12 + numTables * 16;
  let dataOffset = directoryLength;
  const records = [];
  for (const tag of tags) {
    const bytes = tables.get(tag);
    records.push({ tag, checksum: checksum(bytes), offset: dataOffset, length: bytes.length, bytes });
    dataOffset += align4(bytes.length);
  }

  const writer = new Writer(dataOffset);
  writer.u32(0x00010000).u16(numTables).u16(maxPower * 16).u16(Math.log2(maxPower)).u16(numTables * 16 - maxPower * 16);
  records.forEach((record) => writer.raw(tagBytes(record.tag)).u32(record.checksum).u32(record.offset).u32(record.length));
  records.forEach((record) => { writer.offset = record.offset; writer.raw(record.bytes); });

  const headRecord = records.find((record) => record.tag === 'head');
  const totalChecksum = checksum(writer.bytes);
  writer.view.setUint32(headRecord.offset + 8, (0xb1b0afba - totalChecksum) >>> 0, false);
  return writer.bytes;
}

export function parseSfntTables(sfntBytes) {
  const bytes = sfntBytes instanceof Uint8Array ? sfntBytes : new Uint8Array(sfntBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4, false);
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const offset = 12 + i * 16;
    const tag = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const tableOffset = view.getUint32(offset + 8, false);
    const length = view.getUint32(offset + 12, false);
    tables.push({ tag, checksum: view.getUint32(offset + 4, false), offset: tableOffset, length, bytes: bytes.slice(tableOffset, tableOffset + length) });
  }
  return { flavor: view.getUint32(0, false), tables };
}

async function deflateBytes(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function buildWoffFont(ttfBytes, options = {}) {
  const parsed = parseSfntTables(ttfBytes);
  const encoded = [];
  for (const table of parsed.tables) {
    const compressed = options.compress === false ? null : await deflateBytes(table.bytes);
    encoded.push({ ...table, output: compressed && compressed.length < table.length ? compressed : table.bytes });
  }
  let offset = 44 + encoded.length * 20;
  encoded.forEach((table) => { table.woffOffset = offset; offset += align4(table.output.length); });
  const writer = new Writer(offset);
  writer.u32(0x774f4646).u32(parsed.flavor).u32(offset).u16(encoded.length).u16(0).u32(ttfBytes.length).u16(1).u16(0).u32(0).u32(0).u32(0).u32(0).u32(0);
  encoded.forEach((table) => writer.raw(tagBytes(table.tag)).u32(table.woffOffset).u32(table.output.length).u32(table.length).u32(table.checksum));
  encoded.forEach((table) => { writer.offset = table.woffOffset; writer.raw(table.output); });
  return writer.bytes;
}

export function buildFontCss(familyName, baseName) {
  const family = sanitizeFontName(familyName).replace(/'/g, "\\'");
  const file = String(baseName || postScriptName(familyName)).replace(/[^A-Za-z0-9_-]/g, '-');
  return `@font-face {\n  font-family: '${family}';\n  src: url('./${file}.woff2') format('woff2'),\n       url('./${file}.woff') format('woff'),\n       url('./${file}.ttf') format('truetype');\n  font-weight: 400;\n  font-style: normal;\n  font-display: swap;\n}\n`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoredZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : (file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data));
    const crc = crc32(data);
    const local = new LEWriter(30 + name.length);
    local.u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(0).u16(0).u32(crc).u32(data.length).u32(data.length).u16(name.length).u16(0).raw(name);
    localParts.push(local.bytes, data);
    const central = new LEWriter(46 + name.length);
    central.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0).u16(0).u16(0).u32(crc).u32(data.length).u32(data.length).u16(name.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(offset).raw(name);
    centralParts.push(central.bytes);
    offset += local.bytes.length + data.length;
  }
  const centralOffset = offset;
  const central = concatBytes(centralParts);
  const end = new LEWriter(22);
  end.u32(0x06054b50).u16(0).u16(0).u16(files.length).u16(files.length).u32(central.length).u32(centralOffset).u16(0);
  return concatBytes([...localParts, central, end.bytes]);
}

export function validateTrueType(bytes) {
  const errors = [];
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 12) return ['Файл слишком короткий.'];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, false) !== 0x00010000) errors.push('Некорректная сигнатура TrueType.');
  let parsed;
  try { parsed = parseSfntTables(data); } catch (error) { errors.push(error.message); return errors; }
  const required = ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];
  const tags = new Set(parsed.tables.map((table) => table.tag));
  required.forEach((tag) => { if (!tags.has(tag)) errors.push(`Нет таблицы ${tag}.`); });
  parsed.tables.forEach((table) => {
    if (table.offset + table.length > data.length) errors.push(`Таблица ${table.tag} выходит за пределы файла.`);
  });
  if (checksum(data) !== 0xb1b0afba) errors.push('Неверная контрольная сумма шрифта.');
  return errors;
}

export const FONT_DEFAULTS = Object.freeze({ unitsPerEm: UPEM, ascent: DEFAULT_ASCENT, descent: DEFAULT_DESCENT });
