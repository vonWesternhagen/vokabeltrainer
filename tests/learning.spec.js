const { test, expect, fixture79, course, entry, openApp, importCourse, snapshot, seedProgress, startRound, finishWithReveals } = require('./helpers');

test.beforeEach(async ({ page }) => openApp(page));

test('Kursauswahl und Unités/Module zeigen keine internen Abschnittsnamen', async ({ page }) => {
  await importCourse(page, fixture79);
  await page.click('#tabLearn');
  await expect(page.locator('#unitSelect option')).toHaveText(['Alle Vokabeln', 'Unité 0']);
  await expect(page.locator('#partSelect')).toBeDisabled();
  await expect(page.locator('#orderSelect')).toHaveValue('random');
  await expect(page.locator('#distinctCount')).toHaveValue('10');
  await page.selectOption('#unitSelect', 'unite-0');
  await expect(page.locator('#partSelect')).toHaveValue('auftakt');
  await expect(page.locator('#partSelect')).toBeDisabled();
  await importCourse(page, course([
    entry('u1', { unitId: 'unite-1', part: 'volet-1' }),
    entry('module', { unitId: 'module-a', part: 'alle' }),
  ], 'franzoesisch-6', 'Französisch 6'));
  await importCourse(page, course([entry('other', { unitId: 'unite-9' })], 'zweiter', 'Zweiter Kurs'));
  await page.click('#tabHome');await page.selectOption('#activeCourseSelect', 'franzoesisch-6');
  await expect(page.locator('#homeTotal')).toHaveText('81');
  await page.click('#tabLearn');
  await expect(page.locator('#unitSelect option')).toHaveText(['Alle Vokabeln', 'Unité 0', 'Unité 1', 'Module A']);
  await page.selectOption('#unitSelect', 'module-a');
  await expect(page.locator('#partSelect')).toHaveValue('alle');
  await expect(page.locator('#partSelect')).toBeDisabled();
  await page.selectOption('#unitSelect', 'alle');await expect(page.locator('#partSelect')).toBeDisabled();
  await page.click('#tabHome');await page.selectOption('#activeCourseSelect', 'zweiter');
  await expect(page.locator('#homeTotal')).toHaveText('1');
  await page.click('#tabLearn');await expect(page.locator('#unitSelect option')).toHaveText(['Alle Vokabeln', 'Unité 9']);
});

async function prepareRanked(page) {
  await importCourse(page, course(['a', 'b', 'c', 'd', 'e'].map(id => entry(id))));
  await seedProgress(page, [
    { id: 'a', attempts: 8, correct: 8, attemptsDEFR: 8, correctDEFR: 8, deFr: 5 },
    { id: 'b', attempts: 8, wrong: 8, attemptsDEFR: 8, wrongDEFR: 8, deFr: 0 },
    { id: 'c', attempts: 8, correct: 4, wrong: 4, attemptsDEFR: 8, correctDEFR: 4, wrongDEFR: 4, deFr: 2 },
  ]);
}

test('Neue Vokabeln: zunächst ausschließlich ungeübte Einträge', async ({ page }) => {
  await prepareRanked(page);await startRound(page, { count: 2 });
  expect(await finishWithReveals(page, 2)).toEqual(['Wort d', 'Wort e']);
});

test('Neue Vokabeln: fehlende Plätze werden mit den schwächsten geübten aufgefüllt', async ({ page }) => {
  await prepareRanked(page);await startRound(page, { count: 3 });
  expect(await finishWithReveals(page, 3)).toEqual(['Wort b', 'Wort d', 'Wort e']);
});

test('Schlecht gekonnte: nur geübte Einträge und schwächste zuerst', async ({ page }) => {
  await prepareRanked(page);await startRound(page, { count: 2, mode: 'weak', order: 'weakest' });
  expect(await finishWithReveals(page, 2)).toEqual(['Wort b', 'Wort c']);
});

test('Genau zehn Fragen; keine weitere Runde ohne Nutzeraktion', async ({ page }) => {
  await importCourse(page, fixture79);await startRound(page, { count: 10, autoNext: true });
  const entries = (await snapshot(page)).vocab;
  for (let i = 0; i < 10; i++) {
    const prompt = await page.locator('#prompt').innerText();
    const v = entries.find(v => v.meanings.includes(prompt));
    await page.fill('#answer', v.foreign);await page.click('#check');
    await expect(page.locator('#bigProgress')).toHaveText(`${i + 1} / 10`);
    if (i < 9) await expect(page.locator('#prompt')).not.toHaveText(prompt);
  }
  await expect(page.locator('#roundCompletePanel')).toBeVisible();
  await expect(page.locator('#trainerExercise')).toBeHidden();
  await expect(page.locator('#roundCompleteText')).toContainText('10 Vokabeln · 100 % richtig');
  const completed = await snapshot(page);
  expect(completed.progress).toHaveLength(10);
  expect(completed.progress.reduce((n, p) => n + p.attempts, 0)).toBe(10);
  // Bewusst über dem längsten Weiter-Timer (750 ms) warten.
  await page.waitForTimeout(1000);
  expect((await snapshot(page)).progress).toEqual(completed.progress);
  await expect(page.locator('#roundCompletePanel')).toBeVisible();
  await page.click('#newRound');
  await expect(page.locator('#learnView')).toBeVisible();
  await expect(page.locator('#trainerView')).toBeHidden();
  await page.click('#startNew');await expect(page.locator('#trainerView')).toBeVisible();
  await expect(page.locator('#bigProgress')).toHaveText('0 / 10');
});

for (const answer of ['ÇA SONNE !', '  Ça   sonne!!! ', 'Ca sonne !', 'ca sonne']) {
  test(`Tolerante Antwortbewertung: ${JSON.stringify(answer)}`, async ({ page }) => {
    await importCourse(page, course([entry('sonne', { foreign: 'Ça sonne !', meanings: ['Es klingelt'] })]));
    await startRound(page, { count: 1 });await page.fill('#answer', answer);await page.click('#check');
    await expect(page.locator('#feedback')).toContainText('✓ Richtig:');
    await expect(page.locator('#markKnown')).toBeHidden();
    expect((await snapshot(page)).progress[0]).toMatchObject({ attempts: 1, correct: 1 });
  });
}

test('Kleine Abweichung: Habe ich gewusst korrigiert denselben Versuch', async ({ page }) => {
  await importCourse(page, course([entry('bonjour', { foreign: 'bonjour', meanings: ['hallo'] })]));
  await startRound(page, { count: 1 });await page.fill('#answer', 'bonjou');await page.click('#check');
  await expect(page.locator('#markKnown')).toBeVisible();
  expect((await snapshot(page)).progress[0]).toMatchObject({ attempts: 1, almost: 1, correct: 0 });
  await page.click('#markKnown');await expect(page.locator('#feedback')).toContainText('Als richtig übernommen');
  expect((await snapshot(page)).progress[0]).toMatchObject({ attempts: 1, almost: 0, correct: 1, attemptsDEFR: 1, almostDEFR: 0, correctDEFR: 1 });
  await expect(page.locator('#bigQuote')).toHaveText('100 %');
});

test('Deutlich falsche Antwort bietet keine Selbstkorrektur', async ({ page }) => {
  await importCourse(page, course([entry('bonjour', { foreign: 'bonjour', meanings: ['hallo'] })]));
  await startRound(page, { count: 1 });await page.fill('#answer', 'Kartoffelsalat');await page.click('#check');
  await expect(page.locator('#feedback')).toContainText('Noch nicht richtig');
  await expect(page.locator('#markKnown')).toBeHidden();
  expect((await snapshot(page)).progress[0]).toMatchObject({ attempts: 1, wrong: 1 });
});
