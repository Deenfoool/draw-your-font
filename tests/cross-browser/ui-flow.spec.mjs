import { expect, test } from '@playwright/test';

test('guided workflow, collapsed cursive stage and wrapped preview work', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/');
  await page.waitForFunction(() => window.__drawYourFontWorkflow && window.__drawYourFontCursiveUi);

  const template = page.locator('#templateBuilder');
  const scanner = page.locator('#templateScanner');
  const manual = page.locator('#manualMode');
  await expect(template).toBeHidden();
  await expect(scanner).toBeHidden();
  await expect(manual).toBeHidden();

  const templateChoice = page.locator('#chooseTemplateWorkflow');
  const manualChoice = page.locator('#chooseManualWorkflow');
  const [templateBox, manualBox] = await Promise.all([templateChoice.boundingBox(), manualChoice.boundingBox()]);
  expect(Math.abs(templateBox.y - manualBox.y)).toBeLessThan(4);

  await templateChoice.click();
  await expect(template).toBeVisible();
  await expect(scanner).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('drawyourfont:template-downloaded')));
  await expect(scanner).toBeVisible();

  await manualChoice.click();
  await expect(template).toBeHidden();
  await expect(scanner).toBeHidden();
  await expect(manual).toBeVisible();
  await expect(manual).toHaveJSProperty('open', true);

  await page.evaluate(async () => {
    const projectModule = await import('/src/project.js');
    const makeGlyph = (char, index) => {
      const width = 54, height = 72, mask = new Uint8Array(width * height);
      for (let y = 18; y <= 61; y += 1) for (let x = 10; x <= 43; x += 1) {
        if (x < 14 || x > 39 || y < 22 || y > 56) mask[y * width + x] = 1;
      }
      return projectModule.normalizeGlyphRecord({
        id: `ui-${index}-${char}`,
        char, width, height, mask,
        guides: { capY: 8, xHeightY: 25, baselineY: 57, descenderY: 68 },
      }, index);
    };
    const project = projectModule.createEmptyProject({ title: 'UI Flow Cross Browser' });
    const chars = ['м','а','д','р','о','ж','ь','щ','у','к','ц','и','ф'];
    project.glyphs = chars.map(makeGlyph);
    window.__drawYourFontProject.setProject(project, { scroll: false });
  });

  const cursiveBody = page.locator('#cursiveBuilder .cursive-layout');
  const toggle = page.locator('#cursiveDisclosureToggle');
  await expect(cursiveBody).toBeHidden();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.cursive-form-adjustments')).toBeHidden();

  await toggle.check();
  await expect(cursiveBody).toBeVisible();
  await expect(page.locator('#cursiveEnabled')).toBeChecked();
  await expect(page.locator('#cursivePreviewText')).toHaveJSProperty('tagName', 'TEXTAREA');

  await page.locator('#cursivePreviewText').fill('мама дрожь щука цифра мама дрожь щука цифра мама дрожь щука цифра');
  await page.waitForFunction(() => Number(document.querySelector('#cursiveWordCanvas')?.dataset.lines || 0) >= 2);
  const preview = await page.locator('#cursiveWordCanvas').evaluate(canvas => ({ lines: Number(canvas.dataset.lines), height: canvas.height }));
  expect(preview.lines).toBeGreaterThanOrEqual(2);
  expect(preview.height).toBeGreaterThan(310);

  for (const id of ['templateScanner', 'glyphEditor', 'fontBuilder', 'cursiveBuilder']) {
    const padding = await page.locator(`#${id}`).evaluate(card => {
      const header = card.querySelector(':scope > .flow-header');
      return Math.round(header.getBoundingClientRect().left - card.getBoundingClientRect().left);
    });
    expect(padding).toBeGreaterThanOrEqual(18);
  }

  test.info().annotations.push({ type: 'browser', description: browserName });
});
