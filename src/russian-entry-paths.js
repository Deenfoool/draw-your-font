export const RUSSIAN_ENTRY_PATH_VERSION = 2;
export const RUSSIAN_ENTRY_MODES = Object.freeze(['standard', 'short-upper', 'oval-retrace', 'none']);

const DEFAULT_OVAL_PROFILE = Object.freeze({
  id: 'oval-generic',
  lateral: 0.16,
  depth: 0.18,
  returnPull: 0.07,
  lift: 0.28,
  approachBias: 0.54,
  baselineGap: 0.06,
});

const DEFAULT_SHORT_UPPER_PROFILE = Object.freeze({
  id: 'short-upper-generic',
  reach: 0.72,
  shoulder: 0.08,
  finishPull: 0.58,
});

export const RUSSIAN_OVAL_ENTRY_PRESETS = Object.freeze({
  а: Object.freeze({ id: 'ru-school-a', lateral: 0.15, depth: 0.17, returnPull: 0.055, lift: 0.25, approachBias: 0.52, baselineGap: 0.065 }),
  б: Object.freeze({ id: 'ru-school-be', lateral: 0.12, depth: 0.12, returnPull: 0.045, lift: 0.34, approachBias: 0.58, baselineGap: 0.08 }),
  д: Object.freeze({ id: 'ru-school-de', lateral: 0.19, depth: 0.24, returnPull: 0.08, lift: 0.23, approachBias: 0.49, baselineGap: 0.045 }),
  о: Object.freeze({ id: 'ru-school-o', lateral: 0.17, depth: 0.18, returnPull: 0.065, lift: 0.30, approachBias: 0.54, baselineGap: 0.06 }),
  ф: Object.freeze({ id: 'ru-school-ef', lateral: 0.21, depth: 0.27, returnPull: 0.09, lift: 0.36, approachBias: 0.47, baselineGap: 0.04 }),
});

export const RUSSIAN_SHORT_UPPER_PRESETS = Object.freeze({
  с: Object.freeze({ id: 'ru-school-es', reach: 0.66, shoulder: 0.055, finishPull: 0.52 }),
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function point(value = {}) {
  return { x: Number(value.x) || 0, y: Number(value.y) || 0 };
}

function firstCharacter(value) {
  return [...String(value || '').normalize('NFC')][0] || '';
}

function quadratic(start, control, end, role) {
  return { type: 'quadratic', start: point(start), control: point(control), end: point(end), role };
}

function mergeProfile(base, override = {}) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (key === 'id' && typeof value === 'string' && value.trim()) merged.id = value.trim();
    else if (Number.isFinite(Number(value))) merged[key] = Number(value);
  }
  return merged;
}

export function normalizeRussianEntryMode(value, fallback = 'standard') {
  return RUSSIAN_ENTRY_MODES.includes(value) ? value : (RUSSIAN_ENTRY_MODES.includes(fallback) ? fallback : 'standard');
}

export function getRussianEntryProfile(character, mode = 'standard', override = {}) {
  const char = firstCharacter(character);
  const normalizedMode = normalizeRussianEntryMode(mode);
  if (normalizedMode === 'oval-retrace') {
    return Object.freeze(mergeProfile(RUSSIAN_OVAL_ENTRY_PRESETS[char] || DEFAULT_OVAL_PROFILE, override));
  }
  if (normalizedMode === 'short-upper') {
    return Object.freeze(mergeProfile(RUSSIAN_SHORT_UPPER_PRESETS[char] || DEFAULT_SHORT_UPPER_PROFILE, override));
  }
  return Object.freeze({ id: normalizedMode, ...(override?.id ? { id: String(override.id) } : {}) });
}

export function buildRussianEntryPath(mode, startValue, entryValue, geometry = {}) {
  const normalizedMode = normalizeRussianEntryMode(mode);
  const start = point(startValue);
  const entry = point(entryValue);
  const character = firstCharacter(geometry.character);
  const profile = getRussianEntryProfile(character, normalizedMode, geometry.profile);
  if (normalizedMode === 'none') return { mode: normalizedMode, character, profileKey: profile.id, profile, segments: [], retracePoint: null };

  const smooth = clamp(geometry.smoothness ?? 0.62, 0, 1);
  const glyphWidth = Math.max(1, Number(geometry.glyphWidth) || Math.abs(entry.x - start.x) || 1);
  const xHeightY = Number.isFinite(Number(geometry.xHeightY)) ? Number(geometry.xHeightY) : Math.min(start.y, entry.y);
  const baselineY = Number.isFinite(Number(geometry.baselineY)) ? Number(geometry.baselineY) : Math.max(start.y, entry.y);

  if (normalizedMode === 'short-upper') {
    const reach = clamp(profile.reach, 0.45, 0.92);
    const shoulder = clamp(profile.shoulder, 0.015, 0.2);
    const finishPull = clamp(profile.finishPull, 0.25, 0.82);
    const shortened = {
      x: start.x + (entry.x - start.x) * reach,
      y: Math.min(entry.y, xHeightY + Math.max(1, (baselineY - xHeightY) * shoulder)),
    };
    const control = {
      x: start.x + (shortened.x - start.x) * (0.48 + smooth * 0.2),
      y: start.y * (1 - smooth) + shortened.y * smooth,
    };
    return {
      mode: normalizedMode,
      character,
      profileKey: profile.id,
      profile,
      segments: [quadratic(start, control, shortened, 'short-upper-entry'), quadratic(shortened, {
        x: shortened.x + (entry.x - shortened.x) * finishPull,
        y: shortened.y,
      }, entry, 'entry-finish')],
      retracePoint: null,
    };
  }

  if (normalizedMode === 'oval-retrace') {
    const bodyHeight = Math.max(2, baselineY - xHeightY);
    const direction = entry.x >= start.x ? 1 : -1;
    const lateral = clamp(profile.lateral, 0.06, 0.34);
    const depth = clamp(profile.depth, 0.06, 0.38);
    const returnPull = clamp(profile.returnPull, 0.015, 0.18);
    const lift = clamp(profile.lift, 0.12, 0.5);
    const approachBias = clamp(profile.approachBias, 0.3, 0.72);
    const baselineGap = clamp(profile.baselineGap, 0.025, 0.16);
    const retracePoint = {
      x: entry.x + direction * glyphWidth * lateral,
      y: clamp(
        entry.y + bodyHeight * depth,
        xHeightY + bodyHeight * 0.18,
        baselineY - bodyHeight * baselineGap,
      ),
    };
    const approachControl = {
      x: start.x + (retracePoint.x - start.x) * (approachBias + smooth * 0.12),
      y: start.y + (retracePoint.y - start.y) * (0.66 - smooth * 0.18),
    };
    const retraceControl = {
      x: retracePoint.x - direction * glyphWidth * returnPull,
      y: retracePoint.y - bodyHeight * lift,
    };
    return {
      mode: normalizedMode,
      character,
      profileKey: profile.id,
      profile,
      segments: [
        quadratic(start, approachControl, retracePoint, 'oval-approach'),
        quadratic(retracePoint, retraceControl, entry, 'oval-retrace'),
      ],
      retracePoint,
    };
  }

  const control = {
    x: start.x + (entry.x - start.x) * (0.32 + smooth * 0.34),
    y: start.y * (1 - smooth) + entry.y * smooth,
  };
  return {
    mode: 'standard',
    character,
    profileKey: profile.id,
    profile,
    segments: [quadratic(start, control, entry, 'standard-entry')],
    retracePoint: null,
  };
}
