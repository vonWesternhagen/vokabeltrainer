const { test, expect, assertView, prepareCourses, holdRead, releaseRead } = require('./interaction-helpers');
const { openApp, importCourse, course, entry, startRound, snapshot } = require('./helpers');
test.beforeEach(async ({ page }) => openApp(page));

test('Ladender Lernstart darf spätere Navigation nicht überschreiben', async ({ page }) => {
  await importCourse(page, course([entry('a', { foreign: 'bonjour' }), entry('b'), entry('c')]));await page.click('#tabLearn');await holdRead(page);
  await page.click('#startNew');await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#tabPlan');await releaseRead(page);
  await assertView(page, 'plan');
});

test('Parallele Übersichten ersetzen statt doppelte Zeilen anzuhängen', async ({ page }) => {
  await importCourse(page, course([entry('a', { foreign: 'bonjour' }), entry('b'), entry('c')]));await holdRead(page);await page.click('#tabOverview');
  await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#refreshOverview');await expect(page.locator('#overviewBody tr')).toHaveCount(3);
  await releaseRead(page);await expect(page.locator('#overviewBody tr')).toHaveCount(3);
});

test('Doppelte Antwort während Speicherung zählt genau einen Versuch', async ({ page }) => {
  await importCourse(page, course([entry('a', { foreign: 'bonjour' }), entry('b'), entry('c')]));await startRound(page, { count: 3 });await page.fill('#answer', 'bonjour');
  await page.evaluate(() => { window.progressWrites = 0;const put = IDBObjectStore.prototype.put;IDBObjectStore.prototype.put = function (...args) { if (this.name === 'progress') window.progressWrites++;return put.apply(this, args); }; });
  await holdRead(page);await page.click('#check');await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#check');await releaseRead(page);
  await expect(page.locator('#bigProgress')).toHaveText('1 / 3');
  expect((await snapshot(page)).progress.reduce((n, p) => n + p.attempts, 0)).toBe(1);
  expect(await page.evaluate(() => window.progressWrites)).toBe(1);
});

test('Alte Antwortspeicherung darf neue Runde nicht verändern', async ({ page }) => {
  await importCourse(page, course([entry('a', { foreign: 'bonjour' }), entry('b'), entry('c')]));await startRound(page, { count: 3 });await page.fill('#answer', 'bonjour');
  await holdRead(page);await page.click('#check');await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#leaveTrainer');await startRound(page, { count: 3 });
  await releaseRead(page);
  await expect(page.locator('#bigProgress')).toHaveText('0 / 3');
  await expect(page.locator('#feedback')).toHaveText('');
});

test('Alter Weiter-Timer überspringt keine Frage in neuer Runde', async ({ page }) => {
  await importCourse(page, course([entry('a', { foreign: 'bonjour' }), entry('b'), entry('c')]));await startRound(page, { count: 3, autoNext: true });
  await page.clock.install();
  await page.fill('#answer', 'bonjour');await page.click('#check');
  await expect(page.locator('#feedback')).toContainText('Richtig');
  await page.click('#leaveTrainer');await startRound(page, { count: 3 });
  const prompt = await page.locator('#prompt').innerText();
  await page.clock.runFor(1000);
  await expect(page.locator('#prompt')).toHaveText(prompt);
  await expect(page.locator('#bigProgress')).toHaveText('0 / 3');
});

test('Antwortfeld stiehlt anderen Trainer-Controls nicht den Tastaturfokus', async ({ page }) => {
  await importCourse(page, course([entry('a', { foreign: 'bonjour' }), entry('b'), entry('c')]));await startRound(page);
  await page.clock.install();await page.locator('#autoNext').focus();await page.clock.runFor(200);
  await expect(page.locator('#autoNext')).toBeFocused();
});

test('Jede Kachel und jeder Tab führt zu genau einer bedienbaren Ansicht', async ({ page }) => {
  await prepareCourses(page);
  const cards = { homeLearn: 'learn', homeDueLearn: 'learn', homePlan: 'plan', homeOverview: 'overview', homeVocab: 'vocab', homeData: 'data' };
  for (const [id, view] of Object.entries(cards)) {
    await page.click('#tabHome');await page.click(`#${id}`);await assertView(page, view);
    await page.click('#tabLearn');await assertView(page, 'learn');
    await page.selectOption('#unitSelect', 'unite-1');await page.selectOption('#partSelect', 'volet-3');
    await page.fill('#distinctCount', '1');await page.click('#startNew');
    await assertView(page, 'trainer');await page.fill('#answer', 'bonjour');await page.click('#showAnswer');
    await expect(page.locator('#bigProgress')).toHaveText('1 / 1');await page.click('#leaveTrainer');
    await startRound(page, { count: 1, mode: 'weak' });await assertView(page, 'trainer');
    await page.fill('#answer', 'bonjour');await page.click('#leaveTrainer');
  }
  for (const name of ['home', 'learn', 'plan', 'overview', 'vocab', 'data']) {
    await page.click(`#tab${name[0].toUpperCase()}${name.slice(1)}`);await assertView(page, name);
  }
  await startRound(page, { count: 1, mode: 'weak' });await page.fill('#answer', 'bonjour');
  await page.click('#check');await expect(page.locator('#bigProgress')).toHaveText('1 / 1');
  await page.click('#check');await expect(page.locator('#roundCompletePanel')).toBeVisible();
  await page.click('#newRound');await assertView(page, 'learn');await page.click('#startWeak');
  await assertView(page, 'trainer');
});

test('50 Navigationszyklen ohne Klickblocker oder falschen View-State', async ({ page }) => {
  test.setTimeout(240000);
  await prepareCourses(page);
  for (let i = 0; i < 50; i++) {
    for (const name of ['home', 'learn', 'home', 'overview', 'learn', 'plan', 'home', 'vocab', 'learn', 'data', 'home']) {
      await page.click(`#tab${name[0].toUpperCase()}${name.slice(1)}`);await assertView(page, name);
    }
  }
});

test('20 Runden starten, beantworten, beenden und sofort neu starten', async ({ page }) => {
  test.setTimeout(120000);
  await prepareCourses(page);
  for (let i = 0; i < 20; i++) {
    await startRound(page, { count: 1 });await page.fill('#answer', 'falsch');await page.click('#check');
    await expect(page.locator('#bigProgress')).toHaveText('1 / 1');
    await page.click('#leaveTrainer');await assertView(page, 'home');
  }
  expect((await snapshot(page)).progress.reduce((n, p) => n + p.attempts, 0)).toBe(20);
});

test('20 Kurswechsel trennen Auswahl, Lernstoff und Übersicht', async ({ page }) => {
  test.setTimeout(120000);
  await prepareCourses(page);
  for (let i = 0; i < 20; i++) {
    const six = i % 2 === 0;
    await page.click('#tabHome');await page.selectOption('#activeCourseSelect', six ? 'franzoesisch-6' : 'franzoesisch');
    await page.click('#tabLearn');
    await expect(page.locator('#unitSelect option')).toHaveText(six ? ['Alle Vokabeln', 'Unité 0', 'Unité 1', 'Modul 1'] : ['Alle Vokabeln', 'Unité 4']);
    await expect(page.locator('#unitSelect')).toHaveValue('alle');
    await page.selectOption('#unitSelect', six ? 'module-1' : 'unite-4');
    if (six) await expect(page.locator('#partSelect')).toBeDisabled();
    else await expect(page.locator('#partSelect')).toBeEnabled();
    await startRound(page, { count: 1 });await expect(page.locator('#prompt')).toHaveText(six ? 'Wort six-b' : 'Wort ten');
    await page.click('#leaveTrainer');await page.click('#tabOverview');
    await expect(page.locator('#overviewBody tr')).toHaveCount(six ? 3 : 1);
    await expect(page.locator('#overviewBody')).not.toContainText(six ? 'mot ten' : 'bonjour');
  }
});

test('Schnelle Mehrfachnavigation und doppelter Lernstart bleiben konsistent', async ({ page }) => {
  await prepareCourses(page);
  await page.locator('#homeLearn').dblclick();await assertView(page, 'learn');
  await page.evaluate(() => { document.querySelector('#tabHome').click();document.querySelector('#homeLearn').click();document.querySelector('#tabPlan').click(); });
  await assertView(page, 'plan');await page.click('#tabLearn');await holdRead(page);
  await page.locator('#startNew').dblclick();await page.waitForFunction(() => window.heldRead.waiting);
  await releaseRead(page);await assertView(page, 'trainer');await expect(page.locator('#bigProgress')).toHaveText('0 / 3');
  await page.fill('#answer', 'falsch');await page.click('#check');await expect(page.locator('#bigProgress')).toHaveText('1 / 3');
});

test('Modal schließen, abbrechen und speichern blockiert Lernen nicht', async ({ page }) => {
  await prepareCourses(page);
  for (const close of ['closeEdit', 'cancelEdit', 'saveEdit']) {
    await page.click('#tabVocab');await page.fill('#vocabSearch', 'bonjour');await page.locator('.vocab-hit').click();
    await expect(page.locator('#editModal')).toBeVisible();await page.click(`#${close}`);
    await expect(page.locator('#editModal')).toBeHidden();await startRound(page, { count: 1 });
    await page.fill('#answer', 'bonjour');await page.click('#leaveTrainer');
  }
});

test('Leere Datenbank und leerer Kurs geben beim Lernstart Rückmeldung', async ({ page }) => {
  for (const emptyCourse of [false, true]) {
    if (emptyCourse) {
      await page.evaluate(async () => {
        const db = await new Promise(resolve => { const r = indexedDB.open('VokabeltrainerTest');r.onsuccess = () => resolve(r.result); });
        await new Promise(resolve => { const tx = db.transaction('courses', 'readwrite');tx.objectStore('courses').put({ id: 'leer', label: 'Leerer Kurs' });tx.oncomplete = resolve; });db.close();
      });
      await page.reload();await expect(page.locator('#appStatus')).toContainText('Version 4.6.2 läuft');
    }
    await page.click('#tabLearn');
    for (const mode of ['startNew', 'startWeak']) {
      await page.click(`#${mode}`);await expect(page.locator('#scopeInfo')).toContainText('Bitte zuerst einen Kurs');await assertView(page, 'learn');
    }
  }
});

test('Eine Vokabel, übergroße Runde und vollständig geübter Kurs', async ({ page }) => {
  await importCourse(page, course([entry('only')]));await page.click('#tabLearn');await page.click('#startWeak');
  await expect(page.locator('#scopeInfo')).toContainText('noch keine Vokabel geübt');
  await startRound(page, { count: 10 });await expect(page.locator('#bigProgress')).toHaveText('0 / 1');
  await page.click('#showAnswer');await expect(page.locator('#bigProgress')).toHaveText('1 / 1');await page.click('#check');
  await expect(page.locator('#roundCompletePanel')).toBeVisible();await page.click('#newRound');
  await page.click('#startNew');await expect(page.locator('#bigProgress')).toHaveText('0 / 1');
  await page.click('#leaveTrainer');await startRound(page, { count: 10, mode: 'weak' });
  await expect(page.locator('#prompt')).toHaveText('Wort only');
});

test('Bereichswechsel verwirft einen nicht mehr passenden Teilbereich', async ({ page }) => {
  await importCourse(page, course([entry('a', { part: 'volet-3' }), entry('b', { unitId: 'unite-2', part: 'auftakt' }), entry('m', { unitId: 'module-6' })]));
  await page.click('#tabLearn');await page.selectOption('#unitSelect', 'unite-1');await page.selectOption('#partSelect', 'volet-3');
  await page.selectOption('#unitSelect', 'unite-2');await expect(page.locator('#partSelect')).toHaveValue('alle');
  await startRound(page);await expect(page.locator('#prompt')).toHaveText('Wort b');await page.click('#leaveTrainer');
  await page.click('#tabLearn');await page.selectOption('#unitSelect', 'module-6');await expect(page.locator('#partSelect')).toBeDisabled();
  await expect(page.locator('#partSelect option')).toHaveText(['gesamtes Modul']);
});

test('SPA-Tabs erzeugen keine History; Browser-Zurück verlässt das Dokument', async ({ page }) => {
  await page.goto('/?vorherige-seite');await page.goto('/');
  await expect(page.locator('#appStatus')).toContainText('Version 4.6.2 läuft');
  const length = await page.evaluate(() => history.length);
  await page.click('#tabLearn');await page.click('#tabData');
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();await expect(page).toHaveURL(/vorherige-seite/);
});

test('Lesefehler beim Lernstart wird angezeigt; erneuter Start funktioniert', async ({ page }) => {
  await importCourse(page, course([entry('a')]));await page.click('#tabLearn');
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'progress') { IDBObjectStore.prototype.get = get;throw new Error('Test-Lesefehler'); }
      return get.apply(this, args);
    };
  });
  await page.click('#startNew');await expect(page.locator('#scopeInfo')).toContainText('Test-Lesefehler');
  await assertView(page, 'learn');await page.click('#startNew');await assertView(page, 'trainer');
});

test('Fehler bei Antwortspeicherung bleibt sichtbar und erlaubt erneutes Prüfen', async ({ page }) => {
  await importCourse(page, course([entry('a')]));await startRound(page);await page.fill('#answer', 'mot a');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'progress') { IDBObjectStore.prototype.put = put;throw new Error('Test-Schreibfehler'); }
      return put.apply(this, args);
    };
  });
  await page.click('#check');await expect(page.locator('#feedback')).toContainText('Test-Schreibfehler');
  await expect(page.locator('#bigProgress')).toHaveText('0 / 1');
  await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');
  expect((await snapshot(page)).progress[0].attempts).toBe(1);
});

test('Verzögerte Kursstatistik und Planung überschreiben neuen Kurs nicht', async ({ page }) => {
  await prepareCourses(page);await holdRead(page);await page.click('#tabHome');
  await page.waitForFunction(() => window.heldRead.waiting);
  await page.selectOption('#activeCourseSelect', 'franzoesisch');
  await expect(page.locator('#homeNew')).toHaveText('1');await releaseRead(page);
  await expect(page.locator('#homeNew')).toHaveText('1');await expect(page.locator('#appStatus')).toContainText('Französisch 10');
  await holdRead(page, 'exams');await page.click('#tabPlan');await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#tabHome');await page.selectOption('#activeCourseSelect', 'franzoesisch-6');await page.click('#tabPlan');
  await expect(page.locator('#examSummary')).toContainText('Französisch 6');await releaseRead(page);
  await expect(page.locator('#examSummary')).toContainText('Französisch 6');
});

test('Ladendes Klassenarbeitslernen respektiert spätere Navigation', async ({ page }) => {
  await prepareCourses(page);await page.click('#tabPlan');await page.fill('#examDate', '2030-12-01');
  await page.click('#selectAllExamScopes');await page.click('#saveExam');await expect(page.locator('#examSummary')).toContainText('2030-12-01');
  await holdRead(page, 'exams');await page.click('#startExamLearning');await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#tabLearn');await releaseRead(page);await assertView(page, 'learn');
  await page.click('#tabPlan');await page.click('#startExamLearning');await assertView(page, 'trainer');
  await page.click('#leaveTrainer');await startRound(page);await assertView(page, 'trainer');
});

test('Gleiche Unité in zwei Kursen übernimmt keine fremde Teilbereichsauswahl', async ({ page }) => {
  await importCourse(page, course([entry('a', { part: 'volet-3' })], 'a', 'A'));
  await importCourse(page, course([entry('b', { part: 'volet-3' })], 'b', 'B'));
  await page.click('#tabLearn');await page.selectOption('#unitSelect', 'unite-1');await page.selectOption('#partSelect', 'volet-3');
  await page.click('#tabHome');await page.selectOption('#activeCourseSelect', 'a');await page.click('#tabLearn');
  await expect(page.locator('#unitSelect')).toHaveValue('alle');await expect(page.locator('#partSelect')).toHaveValue('alle');
  const settings = JSON.parse((await snapshot(page)).settings);
  expect(settings).toMatchObject({ activeCourse: 'a', unit: 'alle', part: 'alle' });
});

test('Doppelte IDs, versehentliche Submit-Buttons und versteckte Ansichten fehlen', async ({ page }) => {
  const structure = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[id]'), el => el.id);
    return { duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i), submitButtons: document.querySelectorAll('button:not([type="button"])').length };
  });
  expect(structure).toEqual({ duplicateIds: [], submitButtons: 0 });await assertView(page, 'home');
});

test('Verspätete Antwort und Antwort der Folgerunde erhalten beide Versuche', async ({ page }) => {
  await importCourse(page, course([entry('a')]));await startRound(page);await page.fill('#answer', 'mot a');
  await holdRead(page);await page.click('#check');await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#leaveTrainer');await startRound(page);await page.fill('#answer', 'mot a');await page.click('#check');
  await releaseRead(page);await expect(page.locator('#bigProgress')).toHaveText('1 / 1');
  await expect.poll(async () => (await snapshot(page)).progress[0]?.attempts).toBe(2);
});

test('Doppeltes Speichern einer neuen Vokabel legt sie nur einmal an', async ({ page }) => {
  await prepareCourses(page);await page.click('#tabVocab');await page.click('#newVocab');
  await page.fill('#editForeign', 'nouveau');await page.fill('#editMeanings', 'neu');
  await page.evaluate(() => { document.querySelector('#saveEdit').click();document.querySelector('#saveEdit').click(); });
  await expect(page.locator('#editModal')).toBeHidden();
  expect((await snapshot(page)).vocab.filter(v => v.foreign === 'nouveau')).toHaveLength(1);
});

test('Navigation während des App-Starts bleibt nach dem Laden erhalten', async ({ page }) => {
  await importCourse(page, course([entry('a')]));await holdRead(page, 'exams', true);
  await page.reload();await page.waitForFunction(() => window.heldRead.waiting);
  await page.click('#tabLearn');await releaseRead(page);
  await expect(page.locator('#appStatus')).toContainText('Version 4.6.2 läuft');await assertView(page, 'learn');
});
