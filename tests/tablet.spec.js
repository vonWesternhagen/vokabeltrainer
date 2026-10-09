const { test, expect, fixture79, openApp, importCourse, startRound } = require('./helpers');

test('iPad-nahe Traineransicht passt ohne vertikales Scrollen in den Viewport', async ({ page }) => {
  await openApp(page);await importCourse(page, fixture79);await startRound(page, { count: 10 });
  for (const selector of ['#bigProgress', '#prompt', '#answer', '#check', '#showAnswer', '#autoNext', '#autoDetectCorrect']) {
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator(selector)).toBeInViewport({ ratio: 1 });
  }
  const box = await page.locator('#answer').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(100);expect(box.width).toBeGreaterThan(500);
  expect(await page.locator('#answer').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
  const dimensions = await page.evaluate(() => ({
    height: document.documentElement.clientHeight,
    scroll: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.height + 2);
  await page.fill('#answer', 'falsch');await page.click('#check');
  await expect(page.locator('#feedback')).toBeInViewport({ ratio: 1 });
});
