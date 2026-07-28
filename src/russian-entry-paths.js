export const RUSSIAN_ENTRY_PATH_VERSION = 1;
export const RUSSIAN_ENTRY_MODES = Object.freeze(['standard', 'short-upper', 'oval-retrace', 'none']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function point(value = {}) {
  return { x: Number(value.x) || 0, y: Number(value.y) || 0 };
}

function quadratic(start, control, end, role) {
  return { type: 'quadratic', start: point(start), control: point(control), end: point(end), role };
}

export function normalizeRussianEntryMode(value, fallback = 'standard') {
  return RUSSIAN_ENTRY_MODES.includes(value) ? value : (RUSSIAN_ENTRY_MODES.includes(fallback) ? fallback : 'standard');
}

export function buildRussianEntryPath(mode, startValue, entryValue, geometry = {}) {
  const normalizedMode = normalizeRussianEntryMode(mode);
  const start = point(startValue);
  const entry = point(entryValue);
  if (normalizedMode === 'none') return { mode: normalizedMode, segments: [], retracePoint: null };

  const smooth = clamp(geometry.smoothness ?? 0.62, 0, 1);
  const glyphWidth = Math.max(1, Number(geometry.glyphWidth) || Math.abs(entry.x - start.x) || 1);
  const xHeightY = Number.isFinite(Number(geometry.xHeightY)) ? Number(geometry.xHeightY) : Math.min(start.y, entry.y);
  const baselineY = Number.isFinite(Number(geometry.baselineY)) ? Number(geometry.baselineY) : Math.max(start.y, entry.y);

  if (normalizedMode === 'short-upper') {
    const shortened = {
      x: start.x + (entry.x - start.x) * 0.72,
      y: Math.min(entry.y, xHeightY + Math.max(1, (baselineY - xHeightY) * 0.08)),
    };
    const control = {
      x: start.x + (shortened.x - start.x) * (0.48 + smooth * 0.2),
      y: start.y * (1 - smooth) + shortened.y * smooth,
    };
    return {
      mode: normalizedMode,
      segments: [quadratic(start, control, shortened, 'short-upper-entry'), quadratic(shortened, {
        x: shortened.x + (entry.x - shortened.x) * 0.58,
        y: shortened.y,
      }, entry, 'entry-finish')],
      retracePoint: null,
    };
  }

  if (normalizedMode === 'oval-retrace') {
    const bodyHeight = Math.max(2, baselineY - xHeightY);
    const retracePoint = {
      x: Math.min(entry.x + glyphWidth * 0.16, entry.x + Math.max(3, glyphWidth * 0.24)),
      y: clamp(entry.y + bodyHeight * 0.18, xHeightY + bodyHeight * 0.2, baselineY - bodyHeight * 0.06),
    };
    const approachControl = {
      x: start.x + (retracePoint.x - start.x) * (0.46 + smooth * 0.18),
      y: start.y + (retracePoint.y - start.y) * (0.64 - smooth * 0.18),
    };
    const retraceControl = {
      x: retracePoint.x + (entry.x - retracePoint.x) * 0.42,
      y: retracePoint.y - bodyHeight * (0.22 + smooth * 0.1),
    };
    return {
      mode: normalizedMode,
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
  return { mode: 'standard', segments: [quadratic(start, control, entry, 'standard-entry')], retracePoint: null };
}
