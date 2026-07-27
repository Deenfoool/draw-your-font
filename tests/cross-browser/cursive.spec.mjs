import { expect, test } from '@playwright/test';

test('connected Cyrillic font preserves descenders, shapes and loads', async ({ page, browserName }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__drawYourFontCursive && document.querySelector('#cursiveBuilder'));
  const result = await page.evaluate(async () => {
    const module = await import('/src/cursive-font.js');
    const descenders = new Set(module.DESCENDER_LETTERS);
    const makeGlyph = (char, seed = 0) => {
      const width = 54; const height = 78; const mask = new Uint8Array(width * height);
      const put = (x, y, radius = 2) => {
        for (let py = y - radius; py <= y + radius; py += 1) for (let px = x - radius; px <= x + radius; px += 1) {
          if (px >= 0 && py >= 0 && px < width && py < height && (px - x) ** 2 + (py - y) ** 2 <= radius ** 2 + 0.5) mask[py * width + px] = 1;
        }
      };
      const line = (x0, y0, x1, y1) => {
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
        for (let index = 0; index <= steps; index += 1) { const t = index / steps; put(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)); }
      };
      line(11 + seed, 57, 17 + seed, 26); line(17 + seed, 26, 27 + seed, 48); line(27 + seed, 48, 39 + seed, 25); line(39 + seed, 25, 44 + seed, 57); line(12 + seed, 56, 44 + seed, 56);
      if (descenders.has(char)) { line(24 + seed, 55, 24 + seed, 73); line(24 + seed, 73, 31 + seed, 69); }
      return { id: `g-${char}`, char, width, height, mask, guides: { capY: 8, xHeightY: 25, baselineY: 59, descenderY: 73 }, metrics: { leftSideBearing: 42, rightSideBearing: 42, scale: 1, offsetX: 0, offsetY: 0, advanceWidth: null } };
    };
    const chars = ['м','а','т','д','р','у','ф','щ','ц','о','ж','ь'];
    const project = { format: 'draw-your-font-project', version: 4, title: 'Cross Browser Cursive', font: { familyName: 'Cross Browser Cursive', styleName: 'Regular', ascent: 800, descent: -200 }, glyphs: chars.map((char, index) => makeGlyph(char, (index % 3) - 1)), kerning: {} };
    const forms = module.simulateCursiveForms('дрожь', project).map((item) => item.form);
    const cursive = module.ensureCursiveProject(project);
    cursive.glyphs.р.descenderScale = 1.35;
    const built = module.buildCursiveTrueTypeFont(project, { detail: 80, simplify: 0.45, glyphHeight: 700 });
    const errors = module.validateCursiveTrueType(built.ttf);
    const tables = module.parseSfntDirectory(built.ttf).map(({ tag }) => tag);
    const family = `DYFR Cross ${Date.now()}`;
    const buffer = built.ttf.buffer.slice(built.ttf.byteOffset, built.ttf.byteOffset + built.ttf.byteLength);
    const face = new FontFace(family, buffer);
    await face.load();
    document.fonts.add(face);
    const makeSample = (enabled) => {
      const sample = document.createElement('span');
      sample.textContent = 'дрожь';
      sample.style.cssText = `position:absolute;left:0;top:${enabled ? 140 : 0}px;font-family:'${family}';font-size:64px;line-height:1.4;font-feature-settings:'rlig' ${enabled ? 1 : 0},'calt' ${enabled ? 1 : 0},'curs' ${enabled ? 1 : 0};font-variant-ligatures:${enabled ? 'common-ligatures contextual' : 'none'}`;
      document.body.append(sample);
      return sample;
    };
    const plain = makeSample(false);
    const connected = makeSample(true);
    await document.fonts.ready;
    const loaded = document.fonts.check(`64px '${family}'`, 'дрожь');
    const plainRect = plain.getBoundingClientRect();
    const connectedRect = connected.getBoundingClientRect();
    const rVertical = built.layout.vertical.р;
    plain.remove(); connected.remove(); document.fonts.delete(face);
    return {
      forms, errors, tables, loaded,
      plainWidth: plainRect.width, connectedWidth: connectedRect.width,
      connectedHeight: connectedRect.height,
      glyphCount: built.glyphs.length,
      card: Boolean(document.querySelector('#cursiveBuilder')),
      controls: Boolean(document.querySelector('#cursiveBaseline') && document.querySelector('#cursiveDescenderScale') && document.querySelector('#cursiveDescenderPreset')),
      rVertical,
      metrics: built.layout.metrics,
    };
  });
  expect(result.forms).toEqual(['init', 'medi', 'medi', 'medi', 'fina']);
  expect(result.errors).toEqual([]);
  expect(result.tables).toContain('GSUB');
  expect(result.tables).toContain('GPOS');
  expect(result.loaded).toBe(true);
  expect(result.plainWidth).toBeGreaterThan(0);
  expect(result.connectedWidth).toBeGreaterThan(0);
  expect(Math.abs(result.connectedWidth - result.plainWidth)).toBeGreaterThan(1);
  expect(result.glyphCount).toBeGreaterThan(30);
  expect(result.card).toBe(true);
  expect(result.controls).toBe(true);
  expect(result.rVertical.hasDescender).toBe(true);
  expect(result.rVertical.yMin).toBeLessThan(-80);
  expect(result.metrics.descent).toBeLessThan(-200);
  test.info().annotations.push({ type: 'browser', description: browserName });
});
