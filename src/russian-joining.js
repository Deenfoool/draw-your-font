export const JOINING_GRAMMAR_VERSION = 1;
export const JOINING_PRESET = 'ru-school-v1';
export const JOINING_TARGET_CLASSES = Object.freeze(['upper', 'middle', 'lower', 'special']);
export const JOINING_CLASSES = Object.freeze([...JOINING_TARGET_CLASSES, 'none']);
export const RUSSIAN_CONNECTION_LEVELS = Object.freeze({ upper: 0.59, special: 0.48, middle: 0.31, lower: 0.075 });

export const RUSSIAN_LOWERCASE = Object.freeze([...`абвгдеёжзийклмнопрстуфхцчшщъыьэюя`]);

export const RUSSIAN_SCHOOL_ENTRY_CLASS = Object.freeze({
  а: 'lower', б: 'lower', в: 'middle', г: 'middle', д: 'lower', е: 'middle', ё: 'middle',
  ж: 'middle', з: 'middle', и: 'upper', й: 'upper', к: 'upper', л: 'lower', м: 'lower',
  н: 'upper', о: 'lower', п: 'upper', р: 'upper', с: 'special', т: 'upper', у: 'upper',
  ф: 'lower', х: 'middle', ц: 'upper', ч: 'middle', ш: 'upper', щ: 'upper', ъ: 'middle',
  ы: 'upper', ь: 'upper', э: 'middle', ю: 'upper', я: 'lower',
});

const OVAL_RETRACE = new Set(['а', 'б', 'д', 'о', 'ф']);
const FORM_SUFFIX = Object.freeze({ upper: 'u', middle: 'm', lower: 'l', special: 's' });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function firstCharacter(value) {
  return [...String(value || '').normalize('NFC')][0] || '';
}

export function normalizeJoiningClass(value, fallback = 'middle') {
  const normalizedFallback = JOINING_CLASSES.includes(fallback) ? fallback : 'middle';
  return JOINING_CLASSES.includes(value) ? value : normalizedFallback;
}

export function getRussianEntryClass(character, config = {}) {
  const char = firstCharacter(character);
  const override = typeof config === 'string' ? config : config?.entryClass;
  if (JOINING_TARGET_CLASSES.includes(override)) return override;
  return RUSSIAN_SCHOOL_ENTRY_CLASS[char] || 'none';
}

export function getRussianEntryMode(character, config = {}) {
  const char = firstCharacter(character);
  const override = typeof config === 'object' ? config?.entryMode : null;
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (char === 'с') return 'short-upper';
  if (OVAL_RETRACE.has(char)) return 'oval-retrace';
  return RUSSIAN_SCHOOL_ENTRY_CLASS[char] ? 'standard' : 'none';
}

export function contextualFormName(baseForm, exitClass = 'none') {
  if (baseForm !== 'init' && baseForm !== 'medi') return baseForm;
  const suffix = FORM_SUFFIX[normalizeJoiningClass(exitClass, 'none')];
  return suffix ? `${baseForm}.${suffix}` : baseForm;
}

export function resolveConnectionRatio(metrics = {}, joiningClass = 'middle', options = {}) {
  const cap = clamp(metrics.capRatio ?? metrics.capY ?? 0.12, 0, 0.84);
  const xHeight = clamp(metrics.xHeightRatio ?? metrics.xHeightY ?? 0.38, cap + 0.01, 0.94);
  const baseline = clamp(metrics.baselineRatio ?? metrics.baselineY ?? 0.82, xHeight + 0.02, 0.99);
  const body = Math.max(0.04, baseline - cap);
  const levels = { ...RUSSIAN_CONNECTION_LEVELS, ...(options.fontLevels || {}) };
  const ratios = Object.fromEntries(JOINING_TARGET_CLASSES.map((key) => [
    key,
    baseline - body * clamp(levels[key] ?? RUSSIAN_CONNECTION_LEVELS[key], 0.01, 0.99),
  ]));
  const key = normalizeJoiningClass(joiningClass, 'middle');
  const fallback = clamp(options.fallback ?? ratios.middle, cap + 0.01, baseline - 0.01);
  return key === 'none' ? fallback : clamp(ratios[key], cap + 0.01, baseline - 0.01);
}

export function connectionRatioToFontLevel(metrics = {}, ratio) {
  const cap = clamp(metrics.capRatio ?? metrics.capY ?? 0.12, 0, 0.84);
  const baseline = clamp(metrics.baselineRatio ?? metrics.baselineY ?? 0.82, cap + 0.03, 0.99);
  return (baseline - clamp(ratio, cap, baseline)) / Math.max(0.04, baseline - cap);
}

export function createDefaultExitVariants(metrics = {}, legacyExit = {}, previous = {}) {
  const x = clamp(legacyExit?.x ?? 0.92, 0, 1);
  return Object.fromEntries(JOINING_TARGET_CLASSES.map((joiningClass) => {
    const saved = previous?.[joiningClass] || {};
    return [joiningClass, {
      x: clamp(saved.x ?? x, 0, 1),
      y: clamp(saved.y ?? resolveConnectionRatio(metrics, joiningClass), 0, 1),
    }];
  }));
}

export function sanitizePairOverrides(value = {}) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [rawKey, rawOverride] of Object.entries(value)) {
    const [left = '', right = '', extra] = String(rawKey).normalize('NFC').split('|');
    if (extra != null || !firstCharacter(left) || !firstCharacter(right) || !rawOverride || typeof rawOverride !== 'object') continue;
    const key = `${firstCharacter(left)}|${firstCharacter(right)}`;
    const override = {};
    if (rawOverride.connect != null) override.connect = Boolean(rawOverride.connect);
    if (JOINING_TARGET_CLASSES.includes(rawOverride.exitClass)) override.exitClass = rawOverride.exitClass;
    if (typeof rawOverride.mode === 'string' && rawOverride.mode.trim()) override.mode = rawOverride.mode.trim();
    if (Number.isFinite(Number(rawOverride.spacing))) override.spacing = Number(rawOverride.spacing);
    result[key] = override;
  }
  return result;
}

function resolveEdge(leftChar, rightChar, glyphConfigs, pairOverrides) {
  const left = glyphConfigs?.[leftChar];
  const right = glyphConfigs?.[rightChar];
  if (!left || !right) return { connected: false, exitClass: 'none', override: null };
  const key = `${leftChar}|${rightChar}`;
  const override = pairOverrides[key] || null;
  const naturalConnection = Boolean(left.joinRight && right.joinLeft);
  const connected = override?.connect == null ? naturalConnection : Boolean(override.connect);
  const exitClass = connected
    ? normalizeJoiningClass(override?.exitClass, getRussianEntryClass(rightChar, right))
    : 'none';
  return { connected, exitClass, override, key };
}

export function resolveJoiningSequence(text, glyphConfigs = {}, options = {}) {
  const chars = [...String(text || '').normalize('NFC')];
  const pairOverrides = sanitizePairOverrides(options.pairOverrides || {});
  const edges = chars.slice(0, -1).map((char, index) => resolveEdge(char, chars[index + 1], glyphConfigs, pairOverrides));

  return chars.map((char, index) => {
    const config = glyphConfigs?.[char];
    if (!config) {
      return {
        char,
        form: 'isol',
        baseForm: 'isol',
        contextualForm: 'isol',
        connectedLeft: false,
        connectedRight: false,
        entryClass: 'none',
        entryMode: 'none',
        exitClass: 'none',
        previousChar: chars[index - 1] || '',
        nextChar: chars[index + 1] || '',
        pairKey: '',
        pairOverride: null,
      };
    }

    const leftEdge = index > 0 ? edges[index - 1] : null;
    const rightEdge = index < edges.length ? edges[index] : null;
    const connectedLeft = Boolean(leftEdge?.connected);
    const connectedRight = Boolean(rightEdge?.connected);
    const baseForm = connectedLeft && connectedRight ? 'medi' : connectedRight ? 'init' : connectedLeft ? 'fina' : 'isol';
    const exitClass = connectedRight ? rightEdge.exitClass : 'none';

    return {
      char,
      form: baseForm,
      baseForm,
      contextualForm: contextualFormName(baseForm, exitClass),
      connectedLeft,
      connectedRight,
      entryClass: getRussianEntryClass(char, config),
      entryMode: getRussianEntryMode(char, config),
      exitClass,
      previousChar: chars[index - 1] || '',
      nextChar: chars[index + 1] || '',
      pairKey: connectedRight ? rightEdge.key : '',
      pairOverride: connectedRight ? rightEdge.override : null,
    };
  });
}

export function validateRussianSchoolPreset() {
  const missing = RUSSIAN_LOWERCASE.filter((char) => !JOINING_TARGET_CLASSES.includes(RUSSIAN_SCHOOL_ENTRY_CLASS[char]));
  const extra = Object.keys(RUSSIAN_SCHOOL_ENTRY_CLASS).filter((char) => !RUSSIAN_LOWERCASE.includes(char));
  return { valid: missing.length === 0 && extra.length === 0, missing, extra };
}
