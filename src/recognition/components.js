import { clamp, bridgeShortGaps } from './base.js';

function lineSupport(mask, width, height, x, y, horizontal, radius = 5) {
  let count = 0;
  let valid = 0;
  for (let step = -radius; step <= radius; step += 1) {
    const px = horizontal ? x + step : x;
    const py = horizontal ? y : y + step;
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    valid += 1;
    count += mask[py * width + px];
  }
  return valid ? count / valid : 0;
}

export function removeKnownGuides(mask, width, height, options = {}) {
  const output = new Uint8Array(mask);
  const removed = new Uint8Array(mask.length);
  const rowRadius = Math.max(1, Math.round(options.rowRadius ?? Math.max(1, height * 0.008)));
  const columnRadius = Math.max(0, Math.round(options.columnRadius ?? Math.max(0, width * 0.004)));
  const rows = (options.rows || []).map(Math.round).filter(row => row >= 0 && row < height);
  const columns = (options.columns || []).map(Math.round).filter(column => column >= 0 && column < width);

  for (const row of rows) {
    for (let y = Math.max(0, row - rowRadius); y <= Math.min(height - 1, row + rowRadius); y += 1) {
      const snapshot = new Uint8Array(output);
      let total = 0;
      for (let x = 0; x < width; x += 1) total += snapshot[y * width + x];
      if (total < width * 0.22) continue;
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (snapshot[index] && lineSupport(snapshot, width, height, x, y, true, 6) >= 0.72) {
          output[index] = 0;
          removed[index] = 1;
        }
      }
    }
  }

  for (const column of columns) {
    for (let x = Math.max(0, column - columnRadius); x <= Math.min(width - 1, column + columnRadius); x += 1) {
      const snapshot = new Uint8Array(output);
      let total = 0;
      for (let y = 0; y < height; y += 1) total += snapshot[y * width + x];
      if (total < height * 0.28) continue;
      for (let y = 0; y < height; y += 1) {
        const index = y * width + x;
        if (snapshot[index] && lineSupport(snapshot, width, height, x, y, false, 6) >= 0.72) {
          output[index] = 0;
          removed[index] = 1;
        }
      }
    }
  }

  return { mask: bridgeShortGaps(output, width, height, 2), removed };
}

export function componentsFromMask(mask, width, height, options = {}) {
  const minimumArea = Math.max(1, Math.round(options.minArea ?? 1));
  const maximumComponents = Math.max(1, Math.round(options.maxComponents ?? 2000));
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const collectPixels = options.collectPixels !== false;
  const components = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pixels = collectPixels ? [] : null;
    let area = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    let sumX = 0;
    let sumY = 0;
    while (head < tail) {
      const index = queue[head++];
      area += 1;
      if (pixels) pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      sumX += x; sumY += y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
        }
      }
    }
    if (area < minimumArea) continue;
    const boxWidth = x1 - x0 + 1;
    const boxHeight = y1 - y0 + 1;
    components.push({
      id: components.length,
      x0, y0, x1, y1,
      width: boxWidth,
      height: boxHeight,
      area,
      cx: sumX / area,
      cy: sumY / area,
      density: area / (boxWidth * boxHeight),
      pixels,
      sourceIds: [components.length],
    });
    if (components.length > maximumComponents) throw new Error('Слишком много компонентов изображения. Усильте очистку или используйте более ровное фото.');
  }
  return components;
}

export function intervalOverlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
}

export function intervalGap(a0, a1, b0, b1) {
  if (a1 < b0) return b0 - a1 - 1;
  if (b1 < a0) return a0 - b1 - 1;
  return 0;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function combineComponents(group, id) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  let area = 0; let sumX = 0; let sumY = 0;
  const sourceIds = [];
  const pixels = [];
  for (const component of group) {
    x0 = Math.min(x0, component.x0); y0 = Math.min(y0, component.y0);
    x1 = Math.max(x1, component.x1); y1 = Math.max(y1, component.y1);
    area += component.area; sumX += component.cx * component.area; sumY += component.cy * component.area;
    sourceIds.push(...(component.sourceIds || [component.id]));
    if (component.pixels?.length) pixels.push(...component.pixels);
  }
  return {
    id, x0, y0, x1, y1,
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    area,
    cx: sumX / area,
    cy: sumY / area,
    density: area / ((x1 - x0 + 1) * (y1 - y0 + 1)),
    sourceIds: [...new Set(sourceIds)],
    pixels: pixels.length ? pixels : null,
  };
}

class UnionFind {
  constructor(size) { this.parent = Array.from({ length: size }, (_, index) => index); this.rank = new Uint8Array(size); }
  find(index) {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[index] !== index) { const next = this.parent[index]; this.parent[index] = root; index = next; }
    return root;
  }
  union(left, right) {
    let a = this.find(left); let b = this.find(right);
    if (a === b) return;
    if (this.rank[a] < this.rank[b]) [a, b] = [b, a];
    this.parent[b] = a;
    if (this.rank[a] === this.rank[b]) this.rank[a] += 1;
  }
}

export function mergeNearbyComponents(components, options = {}) {
  if (components.length < 2) return components.map((item, index) => ({ ...item, id: index }));
  const strength = clamp(Number(options.mergeStrength ?? 55), 0, 100) / 100;
  const candidates = [...components].sort((a, b) => b.area - a.area).slice(0, Math.max(1, Math.ceil(components.length * 0.65)));
  const medianWidth = Math.max(4, median(candidates.map(item => item.width)));
  const medianHeight = Math.max(4, median(candidates.map(item => item.height)));
  const union = new UnionFind(components.length);
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      const a = components[left]; const b = components[right];
      const xGap = intervalGap(a.x0, a.x1, b.x0, b.x1);
      const yGap = intervalGap(a.y0, a.y1, b.y0, b.y1);
      if (xGap > medianWidth * 0.65 || yGap > medianHeight * 0.72) continue;
      const xOverlap = intervalOverlap(a.x0, a.x1, b.x0, b.x1) / Math.max(1, Math.min(a.width, b.width));
      const yOverlap = intervalOverlap(a.y0, a.y1, b.y0, b.y1) / Math.max(1, Math.min(a.height, b.height));
      const smallRatio = Math.min(a.area, b.area) / Math.max(a.area, b.area);
      const combinedWidth = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1;
      const combinedHeight = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1;
      const accent = xOverlap >= 0.16
        && yGap <= medianHeight * (0.12 + 0.45 * strength)
        && smallRatio <= 0.52
        && combinedHeight <= Math.max(a.height, b.height, medianHeight) * (1.25 + 0.5 * strength)
        && combinedWidth <= Math.max(a.width, b.width, medianWidth) * 1.65;
      const horizontalBreak = yOverlap >= 0.58
        && xGap <= Math.max(2, medianWidth * (0.025 + 0.10 * strength))
        && combinedWidth <= medianWidth * (1.2 + 0.45 * strength);
      const verticalBreak = xOverlap >= 0.58
        && yGap <= Math.max(2, medianHeight * (0.025 + 0.09 * strength))
        && smallRatio > 0.08
        && combinedHeight <= medianHeight * (1.15 + 0.36 * strength);
      if (accent || horizontalBreak || verticalBreak) union.union(left, right);
    }
  }
  const groups = new Map();
  components.forEach((component, index) => {
    const root = union.find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(component);
  });
  return [...groups.values()].map((group, index) => combineComponents(group, index));
}

export function filterPageComponents(components, width, height, options = {}) {
  if (!components.length) return [];
  const minimumArea = Math.max(1, Number(options.minArea ?? 18));
  const areas = components.map(item => item.area);
  const heights = components.map(item => item.height);
  const medianArea = Math.max(minimumArea, median(areas));
  const medianHeight = Math.max(3, median(heights));
  const imageArea = width * height;
  return components.filter(component => {
    if (component.area < minimumArea) return false;
    const aspect = component.width / Math.max(1, component.height);
    const tinyNoise = component.area < medianArea * 0.04 && component.height < medianHeight * 0.30;
    const border = component.area > imageArea * 0.50;
    const longHorizontal = aspect > 32 && component.height <= Math.max(3, medianHeight * 0.14);
    const longVertical = aspect < 1 / 32 && component.width <= Math.max(3, medianHeight * 0.14);
    return !tinyNoise && !border && !longHorizontal && !longVertical;
  });
}

export function orderComponentsIntoRows(components) {
  if (!components.length) return [];
  const medianHeight = Math.max(4, median(components.map(item => item.height)));
  const sorted = [...components].sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const rows = [];
  for (const component of sorted) {
    let best = null;
    let bestScore = -Infinity;
    for (const row of rows) {
      const overlap = intervalOverlap(component.y0, component.y1, row.y0, row.y1);
      const overlapRatio = overlap / Math.max(1, Math.min(component.height, row.y1 - row.y0 + 1));
      const distance = Math.abs(component.cy - row.cy);
      const score = overlapRatio * 2 - distance / medianHeight;
      if ((overlapRatio >= 0.18 || distance <= medianHeight * 0.52) && score > bestScore) { best = row; bestScore = score; }
    }
    if (!best) rows.push({ items: [component], y0: component.y0, y1: component.y1, cy: component.cy });
    else {
      best.items.push(component);
      best.y0 = Math.min(best.y0, component.y0);
      best.y1 = Math.max(best.y1, component.y1);
      best.cy = best.items.reduce((sum, item) => sum + item.cy, 0) / best.items.length;
    }
  }
  rows.sort((a, b) => a.cy - b.cy);
  const ordered = [];
  rows.forEach((row, rowIndex) => {
    row.items.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    row.items.forEach((component, columnIndex) => ordered.push({ ...component, id: ordered.length, row: rowIndex, column: columnIndex }));
  });
  return ordered;
}
