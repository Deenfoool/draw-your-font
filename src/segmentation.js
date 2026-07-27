const DEFAULTS = Object.freeze({
  thresholdDelta: 34,
  absoluteCap: 195,
  backgroundRadius: 34,
  minArea: 18,
  closeIterations: 1,
  openIterations: 0,
  mergeStrength: 55,
  maxComponents: 1200,
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function rgbaToGrayscale(rgba, width, height) {
  if (!rgba || rgba.length !== width * height * 4) {
    throw new Error('RGBA buffer size does not match image dimensions.');
  }
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
    // Integer approximation of Rec. 601 luminance.
    gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return gray;
}

export function normalizeContrast(gray, lowPercentile = 0.01, highPercentile = 0.99) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;

  const total = gray.length;
  const lowTarget = Math.floor(total * lowPercentile);
  const highTarget = Math.floor(total * highPercentile);
  let cumulative = 0;
  let low = 0;
  let high = 255;

  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= lowTarget) {
      low = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram[i];
    if (cumulative >= highTarget) {
      high = i;
      break;
    }
  }

  if (high - low < 18) return new Uint8Array(gray);

  const out = new Uint8Array(gray.length);
  const scale = 255 / (high - low);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = clamp(Math.round((gray[i] - low) * scale), 0, 255);
  }
  return out;
}

export function boxBlur(gray, width, height, radius) {
  radius = Math.max(1, Math.round(radius));
  const integralWidth = width + 1;
  const integral = new Float64Array(integralWidth * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const sourceOffset = y * width;
    const integralOffset = (y + 1) * integralWidth;
    const previousOffset = y * integralWidth;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[sourceOffset + x];
      integral[integralOffset + x + 1] = integral[previousOffset + x + 1] + rowSum;
    }
  }

  const result = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * integralWidth + (x1 + 1)]
        - integral[y0 * integralWidth + (x1 + 1)]
        - integral[(y1 + 1) * integralWidth + x0]
        + integral[y0 * integralWidth + x0];
      result[y * width + x] = Math.round(sum / area);
    }
  }
  return result;
}

export function adaptiveBinarize(gray, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const normalized = normalizeContrast(gray);
  const localBackground = boxBlur(normalized, width, height, opts.backgroundRadius);
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < mask.length; i += 1) {
    const darkEnough = normalized[i] <= opts.absoluteCap;
    const belowLocalBackground = normalized[i] <= localBackground[i] - opts.thresholdDelta;
    if (darkEnough && belowLocalBackground) mask[i] = 1;
  }
  return { mask, normalized, localBackground };
}

function morphologyPass(mask, width, height, mode) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      let inkCount = 0;
      let validCount = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          validCount += 1;
          inkCount += mask[yy * width + xx];
        }
      }
      if (mode === 'dilate') out[p] = inkCount > 0 ? 1 : 0;
      else out[p] = inkCount === validCount ? 1 : 0;
    }
  }
  return out;
}

export function cleanMask(mask, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  let result = new Uint8Array(mask);
  for (let i = 0; i < opts.closeIterations; i += 1) {
    result = morphologyPass(morphologyPass(result, width, height, 'dilate'), width, height, 'erode');
  }
  for (let i = 0; i < opts.openIterations; i += 1) {
    result = morphologyPass(morphologyPass(result, width, height, 'erode'), width, height, 'dilate');
  }
  return result;
}

export function connectedComponents(mask, width, height, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const components = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let stackSize = 0;
    stack[stackSize++] = start;
    visited[start] = 1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;

    while (stackSize > 0) {
      const p = stack[--stackSize];
      const y = Math.floor(p / width);
      const x = p - y * width;
      area += 1;
      sumX += x;
      sumY += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const np = yy * width + xx;
          if (mask[np] && !visited[np]) {
            visited[np] = 1;
            stack[stackSize++] = np;
          }
        }
      }
    }

    if (area >= opts.minArea) {
      components.push({
        id: components.length,
        x0,
        y0,
        x1,
        y1,
        width: x1 - x0 + 1,
        height: y1 - y0 + 1,
        area,
        cx: sumX / area,
        cy: sumY / area,
        sourceIds: [components.length],
      });
      if (components.length > opts.maxComponents) {
        throw new Error('Слишком много компонентов. Увеличьте минимальную площадь или порог очистки.');
      }
    }
  }
  return components;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function overlapAmount(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
}

function gapAmount(a0, a1, b0, b1) {
  if (a1 < b0) return b0 - a1 - 1;
  if (b1 < a0) return a0 - b1 - 1;
  return 0;
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Uint8Array(size);
  }

  find(x) {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== x) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA] += 1;
  }
}

function shouldMerge(a, b, stats, mergeStrength) {
  const strength = clamp(mergeStrength, 0, 100) / 100;
  const xOverlap = overlapAmount(a.x0, a.x1, b.x0, b.x1);
  const yOverlap = overlapAmount(a.y0, a.y1, b.y0, b.y1);
  const xOverlapRatio = xOverlap / Math.max(1, Math.min(a.width, b.width));
  const yOverlapRatio = yOverlap / Math.max(1, Math.min(a.height, b.height));
  const xGap = gapAmount(a.x0, a.x1, b.x0, b.x1);
  const yGap = gapAmount(a.y0, a.y1, b.y0, b.y1);
  const smallerAreaRatio = Math.min(a.area, b.area) / Math.max(a.area, b.area);
  const combinedWidth = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1;
  const combinedHeight = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1;

  // Detached accents: dots of ё/й, i/j and punctuation above a base glyph.
  const bodyHeight = Math.max(a.height, b.height, stats.medianHeight);
  const bodyWidth = Math.max(a.width, b.width, stats.medianWidth);
  const accentGap = bodyHeight * (0.12 + strength * 0.32);
  const accent = xOverlapRatio >= 0.18
    && yGap <= accentGap
    && smallerAreaRatio <= 0.48
    && combinedHeight <= bodyHeight * (1.25 + strength * 0.45)
    && combinedWidth <= bodyWidth * 1.45;

  // A broken pen stroke should rejoin, but neighbouring letters should not.
  const fragmentGap = Math.max(1, stats.medianWidth * (0.015 + strength * 0.09));
  const lateralFragment = yOverlapRatio >= 0.62
    && xGap <= fragmentGap
    && combinedWidth <= stats.medianWidth * (1.15 + strength * 0.45)
    && combinedHeight <= stats.medianHeight * 1.35;

  // Vertically broken stroke, common after weak lighting or paper texture.
  const verticalFragment = xOverlapRatio >= 0.62
    && yGap <= Math.max(1, stats.medianHeight * (0.015 + strength * 0.08))
    && smallerAreaRatio > 0.12
    && combinedHeight <= stats.medianHeight * (1.08 + strength * 0.35);

  return accent || lateralFragment || verticalFragment;
}

function combineGroup(group, id) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let area = 0;
  let weightedX = 0;
  let weightedY = 0;
  const sourceIds = [];

  for (const item of group) {
    x0 = Math.min(x0, item.x0);
    y0 = Math.min(y0, item.y0);
    x1 = Math.max(x1, item.x1);
    y1 = Math.max(y1, item.y1);
    area += item.area;
    weightedX += item.cx * item.area;
    weightedY += item.cy * item.area;
    sourceIds.push(...(item.sourceIds || [item.id]));
  }

  return {
    id,
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    area,
    cx: weightedX / area,
    cy: weightedY / area,
    sourceIds: [...new Set(sourceIds)],
  };
}

export function mergeComponents(components, options = {}) {
  if (components.length < 2) return components.map((item, index) => ({ ...item, id: index }));
  const opts = { ...DEFAULTS, ...options };
  const metricCandidates = [...components]
    .sort((a, b) => b.area - a.area)
    .slice(0, Math.max(1, Math.ceil(components.length * 0.6)));
  const stats = {
    medianWidth: Math.max(4, median(metricCandidates.map((c) => c.width))),
    medianHeight: Math.max(4, median(metricCandidates.map((c) => c.height))),
  };
  const unionFind = new UnionFind(components.length);

  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      const a = components[i];
      const b = components[j];
      const maxRelevantGap = Math.max(stats.medianHeight, stats.medianWidth) * 0.9;
      if (gapAmount(a.x0, a.x1, b.x0, b.x1) > maxRelevantGap) continue;
      if (gapAmount(a.y0, a.y1, b.y0, b.y1) > maxRelevantGap) continue;
      if (shouldMerge(a, b, stats, opts.mergeStrength)) unionFind.union(i, j);
    }
  }

  const groups = new Map();
  components.forEach((component, index) => {
    const root = unionFind.find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(component);
  });

  return [...groups.values()].map((group, index) => combineGroup(group, index));
}

export function filterLikelyGlyphs(components, width, height, options = {}) {
  if (!components.length) return [];
  const opts = { ...DEFAULTS, ...options };
  const areas = components.map((c) => c.area);
  const heights = components.map((c) => c.height);
  const medianArea = Math.max(opts.minArea, median(areas));
  const medianHeight = Math.max(3, median(heights));
  const imageArea = width * height;

  return components.filter((component) => {
    if (component.area < opts.minArea) return false;
    const aspect = component.width / Math.max(1, component.height);
    const isTinyNoise = component.area < medianArea * 0.045 && component.height < medianHeight * 0.32;
    const isPageBorder = component.area > imageArea * 0.5;
    const isLongGuide = aspect > 35 && component.height <= Math.max(3, medianHeight * 0.12);
    return !isTinyNoise && !isPageBorder && !isLongGuide;
  });
}

export function orderIntoRows(components, options = {}) {
  if (!components.length) return [];
  const medianHeight = Math.max(4, median(components.map((c) => c.height)));
  const sorted = [...components].sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const rows = [];

  for (const component of sorted) {
    let bestRow = null;
    let bestScore = -Infinity;
    for (const row of rows) {
      const overlap = overlapAmount(component.y0, component.y1, row.y0, row.y1);
      const overlapRatio = overlap / Math.max(1, Math.min(component.height, row.y1 - row.y0 + 1));
      const centerDistance = Math.abs(component.cy - row.cy);
      const score = overlapRatio * 2 - centerDistance / medianHeight;
      if ((overlapRatio >= 0.18 || centerDistance <= medianHeight * 0.52) && score > bestScore) {
        bestRow = row;
        bestScore = score;
      }
    }

    if (!bestRow) {
      rows.push({ items: [component], y0: component.y0, y1: component.y1, cy: component.cy });
    } else {
      bestRow.items.push(component);
      bestRow.y0 = Math.min(bestRow.y0, component.y0);
      bestRow.y1 = Math.max(bestRow.y1, component.y1);
      bestRow.cy = bestRow.items.reduce((sum, item) => sum + item.cy, 0) / bestRow.items.length;
    }
  }

  rows.sort((a, b) => a.cy - b.cy);
  const ordered = [];
  rows.forEach((row, rowIndex) => {
    row.items.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    row.items.forEach((component, columnIndex) => {
      ordered.push({ ...component, id: ordered.length, row: rowIndex, column: columnIndex });
    });
  });
  return ordered;
}

export function segmentGrayscale(gray, width, height, options = {}) {
  if (!(gray instanceof Uint8Array) && !(gray instanceof Uint8ClampedArray)) {
    throw new Error('Expected a Uint8 grayscale buffer.');
  }
  if (gray.length !== width * height) throw new Error('Grayscale buffer size does not match dimensions.');
  const opts = { ...DEFAULTS, ...options };
  const threshold = adaptiveBinarize(gray, width, height, opts);
  const mask = cleanMask(threshold.mask, width, height, opts);
  const rawComponents = connectedComponents(mask, width, height, opts);
  // Merge detached accents before aggressive noise filtering, otherwise Ё/Й dots can be lost.
  const merged = mergeComponents(rawComponents, opts);
  const filtered = filterLikelyGlyphs(merged, width, height, opts);
  const glyphs = orderIntoRows(filtered, opts);
  return {
    ...threshold,
    mask,
    rawComponents,
    glyphs,
    stats: {
      rawCount: rawComponents.length,
      glyphCount: glyphs.length,
      rowCount: glyphs.length ? Math.max(...glyphs.map((g) => g.row)) + 1 : 0,
      inkPixels: mask.reduce((sum, value) => sum + value, 0),
    },
  };
}

export function mergeBoxes(boxes, selectedIds) {
  const selected = new Set(selectedIds);
  const group = boxes.filter((box) => selected.has(box.id));
  if (group.length < 2) return boxes;
  const remaining = boxes.filter((box) => !selected.has(box.id));
  const merged = combineGroup(group, -1);
  return orderIntoRows([...remaining, merged]);
}

function boundsFromMask(mask, imageWidth, box, xStart, xEnd, sourceIds, splitParentId, splitSide) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = box.y0; y <= box.y1; y += 1) {
    for (let x = xStart; x <= xEnd; x += 1) {
      if (!mask[y * imageWidth + x]) continue;
      area += 1;
      sumX += x;
      sumY += y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (!area) return null;
  return {
    id: -1,
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    area,
    cx: sumX / area,
    cy: sumY / area,
    sourceIds,
    splitParentId,
    splitSide,
  };
}

export function splitBoxAtX(boxes, selectedId, cutX, mask, imageWidth, minArea = 3) {
  const box = boxes.find((item) => item.id === selectedId);
  if (!box) return { boxes, split: false, reason: 'Символ не найден.' };
  const roundedCut = Math.round(cutX);
  if (roundedCut <= box.x0 || roundedCut >= box.x1) {
    return { boxes, split: false, reason: 'Линия разделения должна проходить внутри рамки.' };
  }

  const leftSources = (box.sourceIds || [box.id]).map((id) => `${id}:L@${roundedCut}`);
  const rightSources = (box.sourceIds || [box.id]).map((id) => `${id}:R@${roundedCut}`);
  const left = boundsFromMask(mask, imageWidth, box, box.x0, roundedCut, leftSources, box.id, 'left');
  const right = boundsFromMask(mask, imageWidth, box, roundedCut + 1, box.x1, rightSources, box.id, 'right');
  if (!left || !right || left.area < minArea || right.area < minArea) {
    return { boxes, split: false, reason: 'По одной из сторон линии слишком мало чернил.' };
  }

  const remaining = boxes.filter((item) => item.id !== selectedId);
  return { boxes: orderIntoRows([...remaining, left, right]), split: true, reason: '' };
}

export function removeBoxes(boxes, selectedIds) {
  const selected = new Set(selectedIds);
  return orderIntoRows(boxes.filter((box) => !selected.has(box.id)));
}

export const SEGMENTATION_DEFAULTS = DEFAULTS;
