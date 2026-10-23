const { test, expect, course, entry, openApp, importCourse, snapshot, seedProgress, restore } = require('./helpers');

// Route interception must cover all app requests, without service-worker bypass.
test.use({ serviceWorkers: 'block' });

async function snapshots(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('VokabeltrainerTest');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    }); } finally { db.close(); }
  });
}

async function editMeaning(page, value) {
  await page.click('#tabOverview'); await page.locator('#overviewBody button').first().click();
  await page.fill('#editMeanings', value); await page.click('#saveEdit');
  await expect(page.locator('#editModal')).toBeHidden();
}

test('File export, IndexedDB backup, both restores and emergency reset remain local without GitHub dialogs', async ({ page, context }) => {
  await openApp(page); await importCourse(page, course([entry('local')], 'local-course', 'Lokaler Kurs'));
  await seedProgress(page, [{ id: 'local', attempts: 5, correct: 4 }]);
  await page.click('#tabData'); await page.locator('#advancedBackup').evaluate(e=>e.open=true);await page.fill('#profileName', 'Testname'); await page.locator('#profileName').blur();
  await page.waitForLoadState('networkidle');
  const requests = [], dialogs = [];
  await context.route('**/*', route => { requests.push({ url: route.request().url(), method: route.request().method() }); return route.abort(); });
  page.on('dialog', dialog => dialogs.push(dialog.message()));
  const baseline = await snapshot(page);
  const download = page.waitForEvent('download');
  await page.locator('#advancedBackup').evaluate(e=>e.open=true);await page.click('#saveCourseBackup');
  const file = await download, stream = await file.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(backup.backupType).toBe('course-backup'); expect(backup.entries).toEqual(baseline.vocab);
  expect(backup.progress).toEqual(baseline.progress); expect(file.suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole('button', { name: 'Lokales Backup erstellen', exact: true }).click();
  await expect(page.locator('#backupResult')).toHaveText('Lokales Backup auf diesem Gerät erstellt.');
  const local = (await snapshots(page)).filter(x => x.reason === 'manual'); expect(local).toHaveLength(1);
  expect(local[0].data.entries).toEqual(baseline.vocab); expect(local[0].data.progress).toEqual(baseline.progress);
  expect(dialogs).toEqual([]);
  await editMeaning(page, 'intern verändert'); await page.click('#tabData');
  await page.locator('#snapshotList>div').filter({ hasText: 'Lokales Backup ·' }).getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
  await expect(page.locator('#backupResult')).toContainText('Backup vollständig wiederhergestellt');
  for (const store of ['vocab', 'progress', 'courses', 'exams']) expect((await snapshot(page))[store]).toEqual(baseline[store]);
  await editMeaning(page, 'Datei verändert'); await restore(page, backup);
  for (const store of ['vocab', 'progress', 'courses', 'exams']) expect((await snapshot(page))[store]).toEqual(baseline[store]);
  await page.click('#tabData'); await page.click('#reset'); await expect(page.locator('#homeTotal')).toHaveText('0');
  const emergency = (await snapshots(page)).filter(x => x.emergency);
  expect(emergency).toHaveLength(1); expect(emergency[0].data.entries).toEqual(baseline.vocab);
  expect(emergency[0].data.progress).toEqual(baseline.progress);
  expect(dialogs.every(message => !/github|gist|repository|token|upload/i.test(message))).toBe(true);
  expect(requests, 'No network request, including no GitHub user-data transfer').toEqual([]);
});
