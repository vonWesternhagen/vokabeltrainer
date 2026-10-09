const { test, expect, course, entry, openApp, importCourse, snapshot, startRound, exportBackup, restore } = require('./helpers');

test.beforeEach(async ({ page }) => openApp(page));

test('Vollständiges Backup stellt Kurse, Vokabeln, Lernen, Planung und Einstellungen wieder her', async ({ page }) => {
  await importCourse(page, course([entry('a')], 'eins', 'Eins'));
  await importCourse(page, course([entry('b')], 'zwei', 'Zwei'));
  await startRound(page, { count: 1 });await page.fill('#answer', 'mot b');await page.click('#check');
  await expect(page.locator('#feedback')).toContainText('Richtig');
  await page.click('#leaveTrainer');await page.click('#tabPlan');
  await page.fill('#examDate', '2030-12-01');await page.click('#selectAllExamScopes');await page.click('#saveExam');
  await expect(page.locator('#examSummary')).toContainText('2030-12-01');
  const backup = await exportBackup(page);
  expect(backup.backupType).toBe('full-backup');expect(backup.appVersion).toBe('4.5');
  const before = await snapshot(page);
  await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');
  expect((await snapshot(page)).vocab).toHaveLength(0);
  await importCourse(page, course([entry('replacement')], 'ersatz', 'Ersatz'));
  await restore(page, backup);
  const after = await snapshot(page);
  for (const store of ['vocab', 'courses', 'progress', 'exams']) expect(after[store]).toEqual(before[store]);
  expect(JSON.parse(after.settings)).toEqual(backup.settings);
  expect(after.activeCourse).toBe('zwei');
  await expect(page.locator('#activeCourseSelect')).toHaveValue('zwei');
  await page.reload();await expect(page.locator('#appStatus')).toContainText('Zwei · 1 Vokabeln');
  await page.click('#tabLearn');await expect(page.locator('#distinctCount')).toHaveValue('1');
});

test('Vollständiges leeres Backup ist gültig und startet ohne Fehler', async ({ page }) => {
  const empty = await exportBackup(page);
  await importCourse(page, course([entry('a')]));
  await restore(page, empty);
  await expect(page.locator('#homeTotal')).toHaveText('0');
  await page.reload();await expect(page.locator('#appStatus')).toContainText('noch keine Vokabeln importiert');
});

test('Service Worker und Offline-Neuladen lesen vorhandene IndexedDB-Daten', async ({ page, context }) => {
  await importCourse(page, course([entry('offline')], 'offline', 'Offlinekurs'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const before = await snapshot(page);
  const cachesBefore = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names.find(n => n.startsWith('vokabeltrainer-')));
    return { names, paths: (await cache.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search) };
  });
  expect(cachesBefore.names).toContain('vokabeltrainer-v45-stable1');
  expect(cachesBefore.paths).toEqual(expect.arrayContaining(['/index.html', '/app.js?v=45.1', '/styles.css?v=45.1', '/manifest.webmanifest']));
  await context.setOffline(true);
  await page.reload();await expect(page.locator('#appStatus')).toContainText('Offlinekurs · 1 Vokabeln');
  expect((await snapshot(page)).vocab).toEqual(before.vocab);
  await startRound(page, { count: 1 });await expect(page.locator('#prompt')).toHaveText('Wort offline');
});

test('Cache-Aktivierung entfernt alte eigene Versionen und erhält fremde Caches', async ({ page }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await caches.open('vokabeltrainer-v45');
    await caches.open('andere-app');
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  });
  await page.reload();await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('vokabeltrainer-v45');
  expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(['vokabeltrainer-v45-stable1', 'andere-app']));
});
