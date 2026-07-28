import { expect, test } from '@playwright/test';

test('font can be published to the shared library and removed by its owner', async ({ page, browserName }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__drawYourFontLibraryBridge && window.__drawYourFontProject);
  const familyName = `Общий ${browserName} ${Date.now()}`;

  await expect(page.locator('#addFontToLibrary')).toBeHidden();
  await expect(page.locator('#publishFontPublicly')).toBeHidden();

  await page.evaluate(async ({ familyName }) => {
    const projectModule = await import('/src/project.js');
    const width = 38, height = 54, mask = new Uint8Array(width * height);
    for (let y = 9; y < 46; y += 1) for (let x = 7; x < 32; x += 1) {
      if (x < 10 || x > 28 || y < 12 || y > 42) mask[y * width + x] = 1;
    }
    const project = projectModule.createEmptyProject({ id: `public-${crypto.randomUUID()}`, title: familyName });
    project.glyphs = [projectModule.normalizeGlyphRecord({
      id: 'public-a', char: 'а', width, height, mask,
      guides: { capY: 6, xHeightY: 19, baselineY: 44, descenderY: 51 },
    })];
    window.__drawYourFontProject.setProject(project, { scroll: false });
    document.querySelector('#fontFamily').value = familyName;
    document.querySelector('#fontStyle').value = 'Regular';
    document.querySelector('#downloadTtf').disabled = false;
    window.__drawYourFontBuilder = { getState: () => ({ building: false, outputs: {
      ttf: new Uint8Array([0, 1, 0, 0, 0, 10, 0, 128]),
      woff: new Uint8Array([119, 79, 70, 70, 0, 1, 0, 0]),
      woff2: new Uint8Array([119, 79, 70, 50, 0, 1, 0, 0]),
      css: `@font-face{font-family:${JSON.stringify(familyName)};}`,
      zip: new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]),
      baseName: 'public-browser-font', familyName, styleName: 'Regular',
      glyphSet: { entries: [{ char: 'а' }] },
    } }) };
    window.__drawYourFontLibraryBridge.refresh();
  }, { familyName });

  const localButton = page.locator('#addFontToLibrary');
  const publicButton = page.locator('#publishFontPublicly');
  await expect(localButton).toBeVisible();
  await expect(localButton).toHaveText('Добавить в мою библиотеку');
  await expect(publicButton).toBeVisible();
  await expect(publicButton).toHaveText('Опубликовать в общей библиотеке');

  await publicButton.click();
  await expect(page.locator('#publicPublishDialog')).toBeVisible();
  await page.locator('#publicAuthorName').fill('Денис Тестовый');
  await page.locator('#publicDescription').fill('Кросс-браузерная проверка общей библиотеки.');
  await page.locator('#publicLicense').selectOption('OFL-1.1');
  await page.locator('#publicRights').check();
  await page.locator('#publicPublishSubmit').click();
  await expect(page.locator('#publicPublishStatus')).toContainText(familyName, { timeout: 30000 });
  await expect(page.locator('#librarySaveStatus')).toContainText('доступен всем');

  await page.goto('/library.html#public');
  await page.waitForFunction(() => window.__drawYourFontPublicLibrary?.getState().loaded);
  const card = page.locator('.public-font-card').filter({ hasText: familyName });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Денис Тестовый');
  await expect(card).toContainText('SIL Open Font License 1.1');
  await expect(card.locator('.public-file-link').filter({ hasText: 'Скачать TTF' })).toBeVisible();
  await expect(card.locator('.public-delete')).toBeVisible();

  page.once('dialog', dialog => dialog.accept());
  await card.locator('.public-delete').click();
  await expect(page.locator('.public-font-card').filter({ hasText: familyName })).toHaveCount(0, { timeout: 30000 });
});
