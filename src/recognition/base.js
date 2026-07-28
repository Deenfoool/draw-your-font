export const DEFAULT_CELL_OPTIONS = Object.freeze({
  thresholdDelta: 34,
  absoluteCap: 205,
  backgroundRadius: 24,
  minArea: 3,
  maxComponents: 64,
  repairGap: 2,
});

export const UPPER_ACCENT_CHARS = new Set([...`ЁёЙй`]);
export const DESCENDER_CHARS = new Set([...`др уфщцДЦЩ`.replace(/\s/g, '')]);
export const SMALL_PUNCTUATION = new Set([...`.,:;!?'\"«»-—`]);
export const TWO_PART_PUNCTUATION = new Set([...`:;!?`]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function percentile8(values, fraction) {
  if (!values?.length) return 0;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < values.length; index += 1) histogram[values[index]] += 1;
  const target = clamp(Math.floor((values.length - 1) * fraction), 0, values.length - 1);
  let total = 0;
  for (let value = 0; value < 256; value += 1) {
    total += histogram[value];
    if (total > target) return value;
  }
  return 255;
}

export function normalizeGrayRobust(gray, lowFraction = 0.01, highFraction = 0.99) {
  const low = percentile8(gray, lowFraction);
  const high = percentile8(gray, highFraction);
  if (high - low < 14) return new Uint8Array(gray);
  const scale = 255 / (high - low);
  return Uint8Array.from(gray, value => clamp(Math.round((value - low) * scale), 0, 255));
}

function fillIntegral(integral, gray, width, height, squared) {
  integral.fill(0);
  const stride = width + 1;
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const source = gray[y * width + x];
      const value = squared ? source * source : source;
      rowSum += value;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
}

function rectangleMoment(integral, stride, x0, y0, x1, y1) {
  return integral[(y1 + 1) * stride + x1 + 1]
    - integral[y0 * stride + x1 + 1]
    - integral[(y1 + 1) * stride + x0]
    + integral[y0 * stride + x0];
}

export function localStatistics(gray, width, height, radius) {
  const normalizedRadius = Math.max(2, Math.round(radius));
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  const mean = new Float32Array(gray.length);
  const deviation = new Float32Array(gray.length);

  fillIntegral(integral, gray, width, height, false);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - normalizedRadius);
    const y1 = Math.min(height - 1, y + normalizedRadius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - normalizedRadius);
      const x1 = Math.min(width - 1, x + normalizedRadius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      mean[y * width + x] = rectangleMoment(integral, stride, x0, y0, x1, y1) / area;
    }
  }

  fillIntegral(integral, gray, width, height, true);
  let maximumDeviation = 1;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - normalizedRadius);
    const y1 = Math.min(height - 1, y + normalizedRadius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - normalizedRadius);
      const x1 = Math.min(width - 1, x + normalizedRadius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const average = mean[y * width + x];
      const totalSquare = rectangleMoment(integral, stride, x0, y0, x1, y1);
      const standardDeviation = Math.sqrt(Math.max(0, totalSquare / area - average * average));
      const index = y * width + x;
      deviation[index] = standardDeviation;
      maximumDeviation = Math.max(maximumDeviation, standardDeviation);
    }
  }
  return { mean, deviation, maximumDeviation };
}

export function otsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index += 1) histogram[gray[index]] += 1;
  let totalWeighted = 0;
  for (let value = 0; value < 256; value += 1) totalWeighted += value * histogram[value];
  let backgroundCount = 0;
  let backgroundWeighted = 0;
  let bestVariance = -1;
  let bestThreshold = 127;
  for (let threshold = 0; threshold < 255; threshold += 1) {
    backgroundCount += histogram[threshold];
    if (!backgroundCount) continue;
    const foregroundCount = gray.length - backgroundCount;
    if (!foregroundCount) break;
    backgroundWeighted += threshold * histogram[threshold];
    const backgroundMean = backgroundWeighted / backgroundCount;
    const foregroundMean = (totalWeighted - backgroundWeighted) / foregroundCount;
    const variance = backgroundCount * foregroundCount * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
}

export function maskFromThreshold(gray, threshold, absoluteCap = 255) {
  return Uint8Array.from(gray, value => value <= Math.min(threshold, absoluteCap) ? 1 : 0);
}

export function backgroundDifferenceMask(gray, width, height, options = {}) {
  const radius = Math.max(3, Math.round(options.radius ?? options.backgroundRadius ?? 24));
  const delta = Number(options.delta ?? options.thresholdDelta ?? 34);
  const cap = Number(options.absoluteCap ?? 205);
  const stats = options.statistics || localStatistics(gray, width, height, radius);
  const mask = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    if (gray[index] <= cap && gray[index] <= stats.mean[index] - delta) mask[index] = 1;
  }
  return { mask, localBackground: Uint8Array.from(stats.mean, value => clamp(Math.round(value), 0, 255)), threshold: null };
}

export function sauvolaMask(gray, width, height, options = {}) {
  const radius = Math.max(3, Math.round(options.radius ?? 18));
  const k = Number(options.k ?? 0.24);
  const dynamicRange = Number(options.dynamicRange ?? 128);
  const cap = Number(options.absoluteCap ?? 215);
  const stats = options.statistics || localStatistics(gray, width, height, radius);
  const mask = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    const threshold = stats.mean[index] * (1 + k * (stats.deviation[index] / dynamicRange - 1));
    if (gray[index] <= Math.min(cap, threshold)) mask[index] = 1;
  }
  return { mask, localBackground: Uint8Array.from(stats.mean, value => clamp(Math.round(value), 0, 255)), threshold: null };
}

export function wolfMask(gray, width, height, options = {}) {
  const radius = Math.max(3, Math.round(options.radius ?? 20));
  const k = Number(options.k ?? 0.42);
  const cap = Number(options.absoluteCap ?? 215);
  const stats = options.statistics || localStatistics(gray, width, height, radius);
  const minimum = percentile8(gray, 0.01);
  const mask = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) {
    const threshold = stats.mean[index]
      - k * (1 - stats.deviation[index] / stats.maximumDeviation) * (stats.mean[index] - minimum);
    if (gray[index] <= Math.min(cap, threshold)) mask[index] = 1;
  }
  return { mask, localBackground: Uint8Array.from(stats.mean, value => clamp(Math.round(value), 0, 255)), threshold: null };
}

function neighbor(mask, width, height, x, y) {
  return x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x] : 0;
}

export function morphology(mask, width, height, mode, shape = 'cross') {
  const output = new Uint8Array(mask.length);
  const offsets = shape === 'square'
    ? [[-1,-1],[0,-1],[1,-1],[-1,0],[0,0],[1,0],[-1,1],[0,1],[1,1]]
    : [[0,0],[-1,0],[1,0],[0,-1],[0,1]];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mode === 'dilate') {
        output[y * width + x] = offsets.some(([dx, dy]) => neighbor(mask, width, height, x + dx, y + dy)) ? 1 : 0;
      } else {
        output[y * width + x] = offsets.every(([dx, dy]) => neighbor(mask, width, height, x + dx, y + dy)) ? 1 : 0;
      }
    }
  }
  return output;
}

export function closeMaskDirectional(mask, width, height, iterations = 1) {
  let output = new Uint8Array(mask);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    output = morphology(morphology(output, width, height, 'dilate', 'cross'), width, height, 'erode', 'cross');
  }
  return output;
}

export function openMask(mask, width, height, iterations = 1) {
  let output = new Uint8Array(mask);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    output = morphology(morphology(output, width, height, 'erode', 'cross'), width, height, 'dilate', 'cross');
  }
  return output;
}

export function bridgeShortGaps(mask, width, height, maximumGap = 2) {
  const source = new Uint8Array(mask);
  const output = new Uint8Array(mask);
  const directions = [[1,0],[0,1],[1,1],[1,-1]];
  const gapLimit = clamp(Math.round(maximumGap), 0, 3);
  if (!gapLimit) return output;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!source[y * width + x]) continue;
      for (const [dx, dy] of directions) {
        for (let gap = 1; gap <= gapLimit; gap += 1) {
          const endX = x + dx * (gap + 1);
          const endY = y + dy * (gap + 1);
          if (!neighbor(source, width, height, endX, endY)) continue;
          let empty = true;
          for (let step = 1; step <= gap; step += 1) {
            if (neighbor(source, width, height, x + dx * step, y + dy * step)) { empty = false; break; }
          }
          if (empty) {
            for (let step = 1; step <= gap; step += 1) {
              const fillX = x + dx * step;
              const fillY = y + dy * step;
              if (fillX >= 0 && fillY >= 0 && fillX < width && fillY < height) output[fillY * width + fillX] = 1;
            }
          }
          break;
        }
      }
    }
  }
  return output;
}
