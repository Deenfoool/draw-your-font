import { expect, test } from '@playwright/test';

const REQUIRED_CHARACTERS = [...'мо тадржьсеифщцулабвгёзйкнпхчъыэюя'.replace(/\s/g, '')];

function browserProjectScript() {
  return `(() => {
    const descenders = new Set(['д','р','у','ф','щ','ц']);
    const characters = [...new Set(${JSON.stringify(REQUIRED_CHARACTERS)})];
    const encodeMask = (mask) => {
      const bytes = [];
      let value = mask[0] ? 1 : 0;
      let run = 0;
      for (let index = 0; index < mask.length; index += 1) {
        const bit = mask[index] ? 1 : 0;
        if (bit === value && run < 65535) run += 1;
        else { bytes.push(value, run >> 8, run & 255); value = bit; run = 1; }
      }
      bytes.push(value, run >> 8, run & 255);
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    const makeGlyph = (char, seed = 0) => {
      const width = 54;
      const height = 78;
      const mask = new Uint8Array(width * height);
      const put = (x, y, radius = 2) => {
        for (let py = y - radius; py <= y + radius; py += 1) for (let px = x - radius; px <= x + radius; px += 1) {
          if (px >= 0 && py >= 0 && px < width && py < height && (px - x) ** 2 + (py - y) ** 2 <= radius ** 2 + 0.5) mask[py * width + px] = 1;
        }
      };
      const line = (x0, y0, x1, y1, radius = 2) => {
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
        for (let index = 0; index <= steps; index += 1) {
          const t = index / steps;
          put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), radius);
        }
      };
      line(11 + seed, 57, 17 + seed, 26);
      line(17 + seed, 26, 27 + seed, 48);
      line(27 + seed, 48, 39 + seed, 25);
      line(39 + seed, 25, 44 + seed, 57);
      line(12 + seed, 56, 44 + seed, 56);
      if (descenders.has(char)) {
        line(24 + seed, 55, 24 + seed, 73, 2);
        line(24 + seed, 73, 31 + seed, 69, 2);
      }
      return {
        id: 'cross-' + char,
        char,
        width,
        height,
        mask: encodeMask(mask),
        guides: { capY: 8, xHeightY: 25, baselineY: 59, descenderY: 73 },
        metrics: { leftSideBearing: 42, rightSideBearing: 42, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null },
        quality: { inkCount: mask.reduce((sum, bit) => sum + bit, 0), areaRatio: 0.1, bbox: { x0: 8, y0: 20, x1: 47, y1: 74, width: 40, height: 55 }, warnings: [] },
        source: { type: 'cross-browser-fixture' },
      };
    };
    const now = new Date().toISOString();
    return {
      format: 'draw-your-font-project',
      version: 4,
      id: 'cross-browser-russian-joining',
      title: 'Cross Browser Russian Joining',
      createdAt: now,
      updatedAt: now,
      glyphs: characters.map((char, index) => makeGlyph(char, (index % 3) - 1)),
      kerning: {},
      font: { familyName: 'Cross Browser Russian Joining', styleName: 'Regular', unitsPerEm: 1000, ascent: 800, descent: -200, lineGap: 120 },
      template: null,
      sourceFiles: [],
    };
  })()`;
}

test.describe('Russian School Joining Engine', () => {
  test('shapes contextual pairs and manual overrides', async ({ page, browserName }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(
      window.__drawYourFontProject
      && window.__drawYourFontCursive
      && window.__drawYourFontPairInspector
      && document.querySelector('#cursiveBuilder')
      && document.querySelector('#pairInspector'),
    ));

    const project = await page.evaluate(browserProjectScript());
    await page.evaluate((value) => window.__drawYourFontProject.importProject(JSON.stringify(value)), project);
    await page.waitForFunction(() => document.querySelector('#cursiveCharacter')?.options.length >= 20);

    const result = await page.evaluate(async () => {
      const project = window.__drawYourFontProject.getProject();
      const { buildCursiveTrueTypeFont, ensureCursiveProject, simulateCursiveForms } = await import('./src/cursive-font.js');
      const cursive = ensureCursiveProject(project);
      cursive.enabled = true;
      cursive.pairOverrides = {};

      project.font.familyName = 'DYFR Browser Baseline';
      const baseline = buildCursiveTrueTypeFont(project, { detail: 72, simplify: 0.55, glyphHeight: 700 });
      cursive.pairOverrides['м|о'] = { exitClass: 'upper', spacing: 8 };
      cursive.pairOverrides['т|а'] = { connect: false };
      project.font.familyName = 'DYFR Browser Override';
      const overridden = buildCursiveTrueTypeFont(project, { detail: 72, simplify: 0.55, glyphHeight: 700 });

      const install = async (name, bytes) => {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const face = new FontFace(name, buffer);
        await face.load();
        document.fonts.add(face);
        return name;
      };
      const baselineName = await install('DYFR Baseline ' + Date.now(), baseline.ttf);
      const overrideName = await install('DYFR Override ' + Date.now(), overridden.ttf);
      await document.fonts.ready;

      const measure = (fontFamily, text) => {
        const span = document.createElement('span');
        span.textContent = text;
        span.style.cssText = [
          'position:absolute',
          'left:-10000px',
          'top:0',
          'white-space:pre',
          'font-size:96px',
          'font-family:"' + fontFamily + '"',
          'font-feature-settings:"rlig" 1,"calt" 1,"curs" 1,"kern" 1',
        ].join(';');
        document.body.append(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        return width;
      };

      const widths = {
        baselineMo: measure(baselineName, 'мо'),
        overrideMo: measure(overrideName, 'мо'),
        baselineTa: measure(baselineName, 'та'),
        overrideTa: measure(overrideName, 'та'),
        overrideMama: measure(overrideName, 'мама'),
        overrideDrozh: measure(overrideName, 'дрожь'),
      };

      const matrix = await window.__drawYourFontPairInspector.run({ characters: ['м','о','т','а','с'] });
      window.__drawYourFontPairInspector.select('мо');
      const pair = window.__drawYourFontPairInspector.inspect('м', 'о');
      const disconnected = window.__drawYourFontPairInspector.inspect('т', 'а');
      const moSequence = simulateCursiveForms('мо', project);
      const taSequence = simulateCursiveForms('та', project);

      return {
        browserSupportsFontFace: typeof FontFace === 'function',
        baselineTables: baseline.tables,
        overrideTables: overridden.tables,
        baselineLookups: baseline.layout.featureLookups,
        overrideLookups: overridden.layout.featureLookups,
        pairAdjustments: overridden.layout.pairAdjustments.length,
        blocked: Number.isInteger(overridden.layout.contextualForms.т.blocked),
        widths,
        widthDeltas: { mo: widths.overrideMo - widths.baselineMo, ta: widths.overrideTa - widths.baselineTa },
        matrix: { total: matrix.total, inspected: matrix.inspected, cells: document.querySelectorAll('#pairInspectorMatrix .pair-cell').length },
        pair: { status: pair.status, profile: pair.metrics?.entryProfile, exitClass: pair.metrics?.exitClass, spacing: pair.metrics?.spacing },
        disconnected: disconnected.status,
        moForms: moSequence.map((item) => item.contextualForm),
        taConnected: taSequence.map((item) => [item.connectedLeft, item.connectedRight]),
        selectedPair: document.querySelector('#pairInspectorPair')?.textContent,
      };
    });

    expect(result.browserSupportsFontFace).toBe(true);
    expect(result.baselineTables).toEqual(expect.arrayContaining(['GSUB', 'GPOS']));
    expect(result.overrideTables).toEqual(expect.arrayContaining(['GSUB', 'GPOS']));
    expect(result.baselineLookups).toHaveLength(9);
    expect(result.overrideLookups).toHaveLength(11);
    expect(result.pairAdjustments).toBe(10);
    expect(result.blocked).toBe(true);
    expect(result.widthDeltas.mo).toBeGreaterThan(3);
    expect(Math.abs(result.widthDeltas.ta)).toBeGreaterThan(2);
    expect(result.widths.overrideMama).toBeGreaterThan(0);
    expect(result.widths.overrideDrozh).toBeGreaterThan(0);
    expect(result.matrix).toEqual({ total: 25, inspected: 24, cells: 25 });
    expect(result.pair.profile).toBe('ru-school-o');
    expect(result.pair.exitClass).toBe('upper');
    expect(result.pair.spacing).toBe(8);
    expect(result.disconnected).toBe('disconnected');
    expect(result.moForms).toEqual(['init.u', 'fina']);
    expect(result.taConnected).toEqual([[false, false], [false, false]]);
    expect(result.selectedPair).toBe('мо');

    test.info().annotations.push({ type: 'browser', description: browserName });
    test.info().annotations.push({ type: 'width-delta', description: JSON.stringify(result.widthDeltas) });
  });
});
