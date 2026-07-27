import { test, expect } from '@playwright/test';

test('template, project editor and local font runtime work', async ({ page, browserName }) => {
  await page.goto('/index.html');
  await expect(page.locator('h1')).toContainText('Draw Your Font RU');
  await expect(page.locator('#templateSummary')).toContainText('88');
  await expect(page.locator('#templateSummary')).toContainText('2 стр.');

  const result = await page.evaluate(async () => {
    const projectModule = await import('./src/project.js');
    const makeGlyph = (char, offset) => {
      const width = 52, height = 68, mask = new Uint8Array(width * height);
      for (let y = 10; y < 60; y += 1) for (let x = 8 + offset; x < 30 + offset; x += 1) mask[y * width + x] = 1;
      return projectModule.normalizeGlyphRecord({ char, width, height, mask, guides: { capY: 9, xHeightY: 25, baselineY: 58, descenderY: 65 } });
    };
    const project = projectModule.createEmptyProject({ title: `Cross Browser ${navigator.userAgent}` });
    project.glyphs = [makeGlyph('А', 0), makeGlyph('Ё', 8)];
    project.kerning = { 'А|Ё': -35 };
    window.__drawYourFontProject.setProject(project, { scroll: false });
    const output = await window.__drawYourFontBuilder.buildFont();
    return output ? {
      ttf: [...output.ttf.slice(0, 4)],
      woff: String.fromCharCode(...output.woff.slice(0, 4)),
      woff2: String.fromCharCode(...output.woff2.slice(0, 4)),
      entries: output.glyphSet.entries.map((entry) => entry.character).join(''),
      runtime: (await import('./src/woff2-loader.js')).getWoff2DependencyInfo(),
    } : null;
  });

  expect(result, `${browserName}: font build returned null`).not.toBeNull();
  expect(result.ttf).toEqual([0, 1, 0, 0]);
  expect(result.woff).toBe('wOFF');
  expect(result.woff2).toBe('wOF2');
  expect(result.entries).toBe('ЁА');
  expect(result.runtime.runtimeAutonomous).toBeTruthy();
});
