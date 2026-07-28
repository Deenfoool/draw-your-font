import { expect, test } from '@playwright/test';

test('Recognition Engine 2.0 renders deterministic confidence groups', async ({ page, browserName }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__drawYourFontRecognition && window.__drawYourFontProject?.getState);

  await page.evaluate(() => {
    const api = window.__drawYourFontProject;
    const originalGetState = api.getState.bind(api);
    api.getState = () => ({
      ...originalGetState(),
      scans: [{
        fileName: 'recognition-test.jpg',
        recognition: { version: 2, confidence: 66, high: 1, medium: 1, low: 1 },
        glyphs: [
          { char: 'А', quality: { confidence: 94, warnings: [] } },
          { char: 'ё', quality: { confidence: 68, warnings: ['Верхний знак Ё/Й мог потеряться'] } },
          { char: 'р', quality: { confidence: 36, warnings: ['Нижний элемент мог потеряться'] } },
        ],
      }],
    });
    window.dispatchEvent(new CustomEvent('drawyourfont:project-updated', { detail: { recognitionTest: true } }));
  });

  const panel = page.locator('#recognitionQualityPanel');
  await expect(panel).not.toHaveAttribute('hidden', '');
  await expect(panel).toContainText('Recognition Engine 2.0');
  await expect(panel.locator('[data-level="high"]')).toContainText('1');
  await expect(panel.locator('[data-level="medium"]')).toContainText('1');
  await expect(panel.locator('[data-level="low"]')).toContainText('1');
  await panel.locator('details').evaluate(element => { element.open = true; });
  await expect(panel.locator('.recognition-problem-list')).toContainText('ё');
  await expect(panel.locator('.recognition-problem-list')).toContainText('р');
  await expect(page.locator('link[data-dyfr-recognition]')).toHaveAttribute('href', './recognition.css');
  expect(await page.evaluate(() => window.__drawYourFontRecognition.version)).toBe(2);

  test.info().annotations.push({ type: 'browser', description: browserName });
});
