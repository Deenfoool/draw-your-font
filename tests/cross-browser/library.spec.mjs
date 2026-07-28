import { expect, test } from '@playwright/test';

test('built font can be saved, previewed, reopened and deleted from the library', async ({ page, browserName }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__drawYourFontLibraryBridge && window.__drawYourFontProject);

  await page.evaluate(async () => {
    const library = await import('/src/font-library.js');
    const projectModule = await import('/src/project.js');
    await library.clearFontLibrary();

    const width = 42;
    const height = 58;
    const mask = new Uint8Array(width * height);
    for (let y = 10; y < 49; y += 1) for (let x = 8; x < 35; x += 1) {
      if (x < 11 || x > 31 || y < 13 || y > 45) mask[y * width + x] = 1;
    }
    const project = projectModule.createEmptyProject({ id: 'library-e2e-project', title: 'Почерк Дениса' });
    project.glyphs = [projectModule.normalizeGlyphRecord({
      id: 'library-a',
      char: 'а',
      width,
      height,
      mask,
      guides: { capY: 6, xHeightY: 20, baselineY: 47, descenderY: 54 },
    })];
    window.__drawYourFontProject.setProject(project, { scroll: false });
    document.querySelector('#fontFamily').value = 'Почерк Дениса';
    document.querySelector('#fontStyle').value = 'Regular';
    window.__drawYourFontBuilder = {
      getState: () => ({
        building: false,
        outputs: {
          ttf: new Uint8Array([0, 1, 0, 0, 0, 10, 0, 128]),
          woff: new Uint8Array([119, 79, 70, 70, 0, 1]),
          woff2: new Uint8Array([119, 79, 70, 50, 0, 1]),
          css: '@font-face{font-family:"Почерк Дениса";}',
          zip: new Uint8Array([80, 75, 3, 4, 0, 0]),
          baseName: 'pocherk-denisa',
          familyName: 'Почерк Дениса',
          styleName: 'Regular',
          glyphSet: { entries: [{ char: 'а' }] },
        },
      }),
    };
    window.__drawYourFontLibraryBridge.refresh();
  });

  const add = page.locator('#addFontToLibrary');
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.locator('#librarySaveStatus')).toContainText('сохранён');

  await page.goto('/library.html');
  await page.waitForFunction(() => window.__drawYourFontLibraryPage?.getState().fonts.length === 1);
  await expect(page.locator('.library-font-card')).toHaveCount(1);
  await expect(page.locator('.library-font-header h2')).toHaveText('Почерк Дениса');
  await expect(page.locator('.library-mode')).toHaveText('Обычный');
  await expect(page.locator('.library-open-project')).toBeEnabled();
  await expect(page.locator('.library-file-actions button').nth(0)).toBeEnabled();
  await expect(page.locator('.library-file-actions button').nth(1)).toBeEnabled();

  await page.locator('#librarySearch').fill('несуществующий');
  await expect(page.locator('.library-no-results')).toBeVisible();
  await page.locator('#librarySearch').fill('Дениса');
  await expect(page.locator('.library-font-card')).toHaveCount(1);
  await page.locator('#libraryPreviewText').fill('Новая строка предпросмотра');
  await expect(page.locator('.library-font-preview')).toHaveText('Новая строка предпросмотра');

  await page.locator('.library-open-project').click();
  await page.waitForURL(/index\.html#glyphEditor/);
  await page.waitForFunction(() => window.__drawYourFontProject?.getProject?.()?.id === 'library-e2e-project');
  const restored = await page.evaluate(() => ({
    id: window.__drawYourFontProject.getProject().id,
    title: window.__drawYourFontProject.getProject().title,
    glyph: window.__drawYourFontProject.getProject().glyphs[0]?.char,
  }));
  expect(restored).toEqual({ id: 'library-e2e-project', title: 'Почерк Дениса', glyph: 'а' });

  await page.goto('/library.html');
  await page.waitForFunction(() => window.__drawYourFontLibraryPage?.getState().fonts.length === 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.library-delete').click();
  await page.waitForFunction(() => window.__drawYourFontLibraryPage?.getState().fonts.length === 0);
  await expect(page.locator('.library-empty')).toBeVisible();

  test.info().annotations.push({ type: 'browser', description: browserName });
});
