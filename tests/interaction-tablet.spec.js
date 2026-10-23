const { test, expect, assertView, prepareCourses } = require('./interaction-helpers');
const { openApp, snapshot } = require('./helpers');
test.beforeEach(async ({ page }) => { await openApp(page);await prepareCourses(page); });

async function tap(page, selector) {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  // Tatsächlicher Trefferpunkt: weder Sticky-Element noch unsichtbarer Layer.
  expect(await el.evaluate(el => {
    const r = el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), `${selector} nicht verdeckt`).toBe(true);
  await el.tap();
}

test('Touch: Kacheln, Tabs und schnelle Ansichtswechsel bleiben bedienbar', async ({ page }) => {
  // WebKit meldet trotz hasTouch teils maxTouchPoints=0. Reale emulierte
  // Touch-Ereignisse prüfen, statt Hardware-Metadaten vorauszusetzen.
  await page.evaluate(() => {
    window.observedTouch = null;
    document.addEventListener('touchstart', event => {
      window.observedTouch = { trusted: event.isTrusted, points: event.touches.length };
    }, { once: true });
  });
  await tap(page, '#tabHome');
  expect(await page.evaluate(() => window.observedTouch)).toEqual({ trusted: true, points: 1 });
  for (const [id, name] of [['homeLearn', 'learn'], ['homePlan', 'plan'], ['homeVocab', 'vocab'], ['homeOverview', 'overview'], ['homeData', 'data']]) {
    await tap(page, '#tabHome');await tap(page, `#${id}`);await assertView(page, name);
    await tap(page, '#tabLearn');await tap(page, '#tabHome');await tap(page, '#homeLearn');await tap(page, '#tabPlan');
    await assertView(page, 'plan');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Touch: Prüfen, Weiß nicht, Korrektur und Automatik-Schalter', async ({ page }) => {
  await tap(page, '#homeLearn');await page.selectOption('#unitSelect', 'unite-1');await page.fill('#distinctCount', '1');
  await tap(page, '#startNew');await assertView(page, 'trainer');
  for (const id of ['#check', '#showAnswer', '#leaveTrainer']) {
    const r = await page.locator(id).boundingBox();expect(r.height).toBeGreaterThanOrEqual(44);
  }
  await tap(page, '#autoDetectCorrect');await expect(page.locator('#autoDetectCorrect')).not.toBeChecked();
  await tap(page, '#autoNext');await expect(page.locator('#autoNext')).not.toBeChecked();
  await tap(page, '#answer');await page.fill('#answer', 'bonjou');await tap(page, '#check');
  await expect(page.locator('#markKnown')).toBeVisible();await tap(page, '#markKnown');
  await expect(page.locator('#feedback')).toContainText('Als richtig übernommen');
  await tap(page, '#check');await expect(page.locator('#roundCompletePanel')).toBeVisible();
  await tap(page, '#newRound');await tap(page, '#startWeak');await assertView(page, 'trainer');
  await tap(page, '#showAnswer');await expect(page.locator('#bigProgress')).toHaveText('1 / 1');
  await tap(page, '#check');await tap(page, '#endSession');await assertView(page, 'home');
  const p = (await snapshot(page)).progress.find(p => p.id === 'six-a');expect(p).toMatchObject({ attempts: 2, correct: 1, wrong: 1 });
});

test('Touch: Editor schließen und Kurs wechseln blockiert Lernstart nicht', async ({ page }) => {
  await tap(page, '#homeVocab');await page.fill('#vocabSearch', 'bonjour');await tap(page, '.vocab-hit');
  await expect(page.locator('#editModal')).toBeVisible();await tap(page, '#cancelEdit');
  await tap(page, '#tabHome');await page.selectOption('#activeCourseSelect', 'franzoesisch');
  await tap(page, '#homeLearn');await tap(page, '#startNew');
  await expect(page.locator('#prompt')).toHaveText('Wort ten');await tap(page, '#leaveTrainer');
  await tap(page, '#homeLearn');await assertView(page, 'learn');
});
