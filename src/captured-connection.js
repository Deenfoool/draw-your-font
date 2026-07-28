import { getConnectionSample } from './connection-template-scanner.js';
import { resolveConnectionRatio } from './russian-joining.js';

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }

export function maskBounds(mask, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let inkCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      inkCount += 1;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  return { x0, y0, x1, y1, width: x1 - x0 + 1, height: y1 - y0 + 1, inkCount };
}

function drawDisk(mask, width, height, x, y, radius) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const r = Math.max(1, Math.round(radius));
  for (let py = cy - r; py <= cy + r; py += 1) {
    for (let px = cx - r; px <= cx + r; px += 1) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r ** 2 + 0.75) mask[py * width + px] = 1;
    }
  }
}

function drawQuadratic(mask, width, height, start, control, end, radius) {
  const steps = Math.max(16, Math.ceil((Math.hypot(control.x - start.x, control.y - start.y) + Math.hypot(end.x - control.x, end.y - control.y)) * 2));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const mt = 1 - t;
    drawDisk(
      mask,
      width,
      height,
      mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
      radius,
    );
  }
}

function estimateStrokeRadius(mask, width, height, target) {
  const y = clamp(Math.round(target.y), 0, height - 1);
  const x = clamp(Math.round(target.x), 0, width - 1);
  let vertical = 0;
  for (let py = Math.max(0, y - 8); py <= Math.min(height - 1, y + 8); py += 1) {
    if (mask[py * width + x]) vertical += 1;
  }
  let horizontal = 0;
  for (let px = Math.max(0, x - 8); px <= Math.min(width - 1, x + 8); px += 1) {
    if (mask[y * width + px]) horizontal += 1;
  }
  return clamp(Math.max(vertical, horizontal) / 2, 1.2, 4.5);
}

function rightmostInkBefore(mask, width, height, maximumX, preferredY) {
  for (let x = clamp(Math.round(maximumX), 0, width - 1); x >= 0; x -= 1) {
    let best = null;
    for (let y = 0; y < height; y += 1) {
      if (!mask[y * width + x]) continue;
      const score = Math.abs(y - preferredY);
      if (!best || score < best.score) best = { x, y, score };
    }
    if (best) return best;
  }
  return null;
}

function retargetSpecialExit(source) {
  const mask = new Uint8Array(source.mask);
  const bounds = maskBounds(mask, source.width, source.height);
  if (!bounds) return source;
  const metrics = {
    capRatio: source.capY / Math.max(1, source.height - 1),
    xHeightRatio: source.xHeightY / Math.max(1, source.height - 1),
    baselineRatio: source.baselineY / Math.max(1, source.height - 1),
  };
  const desiredY = resolveConnectionRatio(metrics, 'special') * Math.max(1, source.height - 1);
  const targetX = clamp(Math.round(source.target.x), bounds.x0 + 4, source.width - 1);
  const eraseLength = clamp(Math.round((targetX - bounds.x0) * 0.24), 8, Math.max(8, Math.round(source.width * 0.3)));
  const cutoff = Math.max(bounds.x0 + 4, targetX - eraseLength);
  const anchor = rightmostInkBefore(mask, source.width, source.height, cutoff, desiredY) || { x: cutoff, y: desiredY };
  const radius = estimateStrokeRadius(mask, source.width, source.height, source.target);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = Math.min(source.width - 1, anchor.x + Math.ceil(radius) + 1); x < source.width; x += 1) mask[y * source.width + x] = 0;
  }
  const end = { x: targetX, y: desiredY };
  const control = {
    x: anchor.x + (end.x - anchor.x) * 0.58,
    y: anchor.y * 0.42 + end.y * 0.58,
  };
  drawQuadratic(mask, source.width, source.height, anchor, control, end, radius);
  drawDisk(mask, source.width, source.height, end.x, end.y, radius);
  return {
    ...source,
    mask,
    target: { ...source.target, x: end.x, y: end.y },
    capturedSource: 'captured-retargeted',
    capturedFromClass: 'upper',
    capturedTargetClass: 'special',
  };
}

function cropCapturedSource(sample, targetClass) {
  const bounds = maskBounds(sample.mask, sample.width, sample.height);
  if (!bounds) return null;
  const targetX = clamp(Math.round(sample.target?.x ?? bounds.x1), bounds.x0 + 2, sample.width - 1);
  const x0 = Math.max(0, Math.min(bounds.x0 - 2, targetX - 2));
  const x1 = Math.max(x0 + 2, Math.min(sample.width - 1, Math.max(targetX, Math.min(bounds.x1, targetX + 2))));
  const width = x1 - x0 + 1;
  const mask = new Uint8Array(width * sample.height);
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (sample.mask[y * sample.width + x]) mask[y * width + x - x0] = 1;
    }
  }
  const target = {
    x: clamp(targetX - x0, 0, width - 1),
    y: clamp(Number(sample.target?.y ?? sample.guides?.baselineY ?? sample.height * 0.72), 0, sample.height - 1),
    radius: Number(sample.target?.radius || 1),
  };
  const endpointRadius = estimateStrokeRadius(mask, width, sample.height, target);
  drawDisk(mask, width, sample.height, target.x, target.y, endpointRadius);
  return {
    mask,
    width,
    height: sample.height,
    guides: { ...sample.guides },
    capY: Number(sample.guides?.capY ?? sample.height * 0.12),
    xHeightY: Number(sample.guides?.xHeightY ?? sample.height * 0.38),
    baselineY: Number(sample.guides?.baselineY ?? sample.height * 0.82),
    descenderY: Number(sample.guides?.descenderY ?? sample.height * 0.94),
    target,
    sourceSampleId: sample.id,
    sourceSampleIndex: sample.sampleIndex,
    capturedSource: 'captured',
    capturedFromClass: sample.targetClass,
    capturedTargetClass: targetClass,
    exactConnection: true,
  };
}

export function prepareCapturedConnectionSource(sample, targetClass) {
  if (!sample?.mask?.some(Boolean)) return null;
  if (sample.quality?.reachedTarget === false) return null;
  const source = cropCapturedSource(sample, targetClass);
  if (!source) return null;
  if (targetClass === 'special' && sample.targetClass === 'upper') return retargetSpecialExit(source);
  return source;
}

export function selectCapturedConnectionSource(project, character, targetClass) {
  const directClass = targetClass === 'special' ? 'upper' : targetClass;
  const sample = getConnectionSample(project, character, directClass);
  return prepareCapturedConnectionSource(sample, targetClass);
}

export function capturedConnectionCoverage(project) {
  const byCharacter = {};
  let direct = 0;
  let usable = 0;
  for (const [character, targets] of Object.entries(project?.connectionTemplate?.samples || {})) {
    byCharacter[character] = {};
    for (const targetClass of ['upper', 'middle', 'lower', 'special']) {
      const source = selectCapturedConnectionSource(project, character, targetClass);
      byCharacter[character][targetClass] = Boolean(source);
      if (targetClass !== 'special' && targets?.[targetClass]) direct += 1;
      if (source) usable += 1;
    }
  }
  return { direct, usable, characters: Object.keys(byCharacter).length, byCharacter };
}
