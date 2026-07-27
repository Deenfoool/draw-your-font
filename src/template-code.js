export const MARKER_GRID = 7;
export const METADATA_ROWS = 5;
export const METADATA_COLUMNS = 8;
export const METADATA_MM = Object.freeze({ x: 98, y: 10.2, cell: 1.55 });

const CHARSET_CODES = Object.freeze({
  'ru-upper': 0,
  'ru-lower': 1,
  'ru-letters': 2,
  'ru-full': 3,
  'ru-extended': 4,
  custom: 7,
});
const CODE_CHARSETS = Object.freeze(Object.fromEntries(Object.entries(CHARSET_CODES).map(([k, v]) => [v, k])));
const LAYOUT_CODES = Object.freeze({ balanced: 0, compact: 1, standard: 2, large: 3 });
const CODE_LAYOUTS = Object.freeze(Object.fromEntries(Object.entries(LAYOUT_CODES).map(([k, v]) => [v, k])));

function rotateMatrix(matrix) {
  const n = matrix.length;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => matrix[n - 1 - x][y]));
}

const MARKER_PAYLOADS = [
  ['01101','11011','00000','11001','00011'],
  ['00100','10010','00111','00100','11100'],
  ['11110','11011','11010','00100','10111'],
  ['00010','01011','01110','00001','00010'],
];

function buildMarkerPattern(id) {
  const matrix = Array.from({ length: MARKER_GRID }, () => Array(MARKER_GRID).fill(0));
  for (let y = 0; y < MARKER_GRID; y += 1) {
    for (let x = 0; x < MARKER_GRID; x += 1) {
      if (x === 0 || y === 0 || x === MARKER_GRID - 1 || y === MARKER_GRID - 1) matrix[y][x] = 1;
    }
  }
  const payload = MARKER_PAYLOADS[id] || MARKER_PAYLOADS[0];
  for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) matrix[y + 1][x + 1] = payload[y][x] === '1' ? 1 : 0;
  return matrix;
}

export const MARKER_PATTERNS = Object.freeze([0, 1, 2, 3].map((id) => Object.freeze(buildMarkerPattern(id).map((row) => Object.freeze(row)))));

export function markerPattern(id, rotation = 0) {
  let matrix = MARKER_PATTERNS[id].map((row) => [...row]);
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i += 1) matrix = rotateMatrix(matrix);
  return matrix;
}

export function decodeMarkerMatrix(sample) {
  let best = { id: -1, rotation: 0, distance: Infinity, confidence: 0 };
  for (let id = 0; id < 4; id += 1) {
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const expected = markerPattern(id, rotation);
      let distance = 0;
      for (let y = 0; y < MARKER_GRID; y += 1) for (let x = 0; x < MARKER_GRID; x += 1) distance += expected[y][x] === sample[y][x] ? 0 : 1;
      if (distance < best.distance) best = { id, rotation, distance, confidence: 1 - distance / (MARKER_GRID * MARKER_GRID) };
    }
  }
  return best;
}

function bitsOf(value, count) {
  const bits = [];
  for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  return bits;
}
function fromBits(bits) { return bits.reduce((value, bit) => (value << 1) | bit, 0); }
function checksum6(bits) {
  let register = 0x2d;
  for (const bit of bits) {
    const feedback = ((register >> 5) & 1) ^ bit;
    register = ((register << 1) & 0x3f) ^ (feedback ? 0x27 : 0);
  }
  return register & 0x3f;
}

export function encodeTemplateMetadata(meta) {
  const payload = [
    ...bitsOf(0xd7, 8),
    ...bitsOf(Number(meta.version || 1) & 0xf, 4),
    ...bitsOf(CHARSET_CODES[meta.charsetId] ?? 7, 3),
    ...bitsOf(LAYOUT_CODES[meta.layoutId] ?? 0, 2),
    ...bitsOf(Number(meta.pageIndex || 0) & 0x1f, 5),
    ...bitsOf(Number(meta.pageCount || 1) & 0x1f, 5),
    ...bitsOf(Number(meta.totalChars || 0) & 0x7f, 7),
  ];
  return [...payload, ...bitsOf(checksum6(payload), 6)];
}

export function decodeTemplateMetadata(bits) {
  if (!Array.isArray(bits) || bits.length !== METADATA_ROWS * METADATA_COLUMNS) return { valid: false, error: 'Неверная длина машинного кода.' };
  const payload = bits.slice(0, 34);
  const expectedChecksum = fromBits(bits.slice(34));
  if (fromBits(payload.slice(0, 8)) !== 0xd7) return { valid: false, error: 'Метка шаблона не найдена.' };
  if (checksum6(payload) !== expectedChecksum) return { valid: false, error: 'Контрольная сумма страницы не совпала.' };
  const charsetCode = fromBits(payload.slice(12, 15));
  const layoutCode = fromBits(payload.slice(15, 17));
  return {
    valid: true,
    version: fromBits(payload.slice(8, 12)),
    charsetId: CODE_CHARSETS[charsetCode] || 'custom',
    layoutId: CODE_LAYOUTS[layoutCode] || 'balanced',
    pageIndex: fromBits(payload.slice(17, 22)),
    pageCount: fromBits(payload.slice(22, 27)),
    totalChars: fromBits(payload.slice(27, 34)),
  };
}

export function metadataMatrix(meta) {
  const bits = encodeTemplateMetadata(meta);
  return Array.from({ length: METADATA_ROWS }, (_, row) => bits.slice(row * METADATA_COLUMNS, (row + 1) * METADATA_COLUMNS));
}

export function metadataFromMatrix(matrix) {
  return decodeTemplateMetadata(matrix.flat().map((bit) => bit ? 1 : 0));
}
