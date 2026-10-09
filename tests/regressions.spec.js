const { test, expect, fixture79, course, entry, openApp, importCourse, restore, snapshot, seedProgress, exportBackup } = require('./helpers');

test.beforeEach(async ({ page }) => openApp(page));

test('Leerer Erststart und Klassenarbeitsaktionen bleiben fehlerfrei', async ({ page }) => {
  await expect(page.locator('#homeTotal')).toHaveText('0');
  await page.click('#tabPlan');
  await expect(page.locator('#examSummary')).toContainText('Bitte zuerst einen Kurs');
  for (const button of ['#deleteExam', '#startExamLearning', '#saveExam']) await page.click(button);
  await page.reload();
  await expect(page.locator('#appStatus')).toContainText('noch keine Vokabeln importiert');
});

test('79 gültige synthetische Vokabeln werden importiert', async ({ page }) => {
  await importCourse(page, fixture79);
  const data = await snapshot(page);
  expect(data.vocab).toHaveLength(79);
  expect(data.vocab.every(v => v.courseId === 'franzoesisch-6' && v.unitId === 'unite-0' && v.part === 'auftakt')).toBe(true);
  await expect(page.locator('#exportCourse')).toHaveText('Französisch 6 als Vokabeldatei exportieren');
});

const invalidBackups = {
  'nur Typkennung': () => ({ backupType: 'full-backup' }),
  'fehlender Store': b => { delete b.progress; return b; },
  'ungültige Bedeutungen': b => { b.entries[0].meanings = 'kein Array'; return b; },
  'doppelte ID': b => { b.entries.push(b.entries[0]); return b; },
  'unbekannter Kurs': b => { b.entries[0].courseId = 'fehlt'; return b; },
  'negativer Lernstand': b => { b.progress[0].attempts = -1; return b; },
  'ungültige Planung': b => { b.exams = [{ id: 'testkurs', date: 'morgen', scopes: ['unite-1|auftakt'] }]; return b; },
  'ungültige Einstellungen': b => { b.settings = []; return b; },
  'unbekannte Schemaversion': b => { b.schemaVersion = 999; return b; },
};
for (const [name, corrupt] of Object.entries(invalidBackups)) {
  test(`Ungültiges Backup erhält sämtliche Daten: ${name}`, async ({ page }) => {
    await importCourse(page, course([entry('a')]));
    await seedProgress(page, [{ id: 'a', attempts: 1, wrong: 1, attemptsDEFR: 1, wrongDEFR: 1 }]);
    const backup = await exportBackup(page);
    const before = await snapshot(page);
    let confirmations = 0;
    page.on('dialog', () => confirmations++);
    await restore(page, corrupt(backup), false);
    expect(await snapshot(page)).toEqual(before);
    expect(confirmations).toBe(0);
    await page.reload();
    await expect(page.locator('#homeTotal')).toHaveText('1');
  });
}

test('Abbruch während des Schreibens rollt alle Stores und Einstellungen zurück', async ({ page }) => {
  await importCourse(page, course([entry('old')]));
  const backup = await exportBackup(page);
  backup.entries[0].id = 'replacement';
  backup.settings.distinctCount = 3;
  const before = await snapshot(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args);
      if (this.name === 'courses') {
        IDBObjectStore.prototype.put = put;
        const tx = this.transaction;
        result.addEventListener('success', () => tx.abort());
      }
      return result;
    };
  });
  await restore(page, backup, false);
  expect(await snapshot(page)).toEqual(before);
});

test('Kursname wird vor, nach und ohne Klassenarbeit ausschließlich als Text ausgegeben', async ({ page }) => {
  const label = 'Kurs <img src=x onerror="window.xss=true"><b>Text</b>';
  await importCourse(page, course([entry('a')], 'html', label));
  await page.click('#tabPlan');
  await expect(page.locator('#examSummary')).toContainText(label);
  await expect(page.locator('#examSummary img, #examSummary b')).toHaveCount(0);
  await page.fill('#examDate', '2030-12-01');
  await page.click('#selectAllExamScopes');await page.click('#saveExam');
  await expect(page.locator('#examSummary strong').first()).toContainText(label);
  await expect(page.locator('#examSummary img, #examSummary b')).toHaveCount(0);
  await page.click('#deleteExam');
  await expect(page.locator('#examSummary')).toContainText(label);
  expect(await page.evaluate(() => window.xss)).toBeUndefined();
});

test('Wiederholter Import ohne IDs bleibt idempotent, auch nach Reload', async ({ page }) => {
  await importCourse(page, fixture79);
  const before = await snapshot(page);
  await page.reload();await importCourse(page, fixture79);
  expect((await snapshot(page)).vocab).toEqual(before.vocab);
});

test('Identität trennt Bedeutungen, Akzente und Kurse ohne Slug-Kollisionen', async ({ page }) => {
  const entries = [
    entry(undefined, { foreign: 'côte', meanings: ['Küste'] }),
    entry(undefined, { foreign: 'cote', meanings: ['Bewertung'] }),
    entry(undefined, { foreign: 'côte', meanings: ['Rippe'] }),
  ];
  await importCourse(page, course(entries));
  await importCourse(page, course(entries));
  await importCourse(page, course(entries, 'zweiter', 'Zweiter Kurs'));
  const data = await snapshot(page);
  expect(data.vocab).toHaveLength(6);
  expect(new Set(data.vocab.map(v => v.id)).size).toBe(6);
});

for (const explicit of [true, false]) {
  test(`Manuelle Zuordnung bleibt bei Reimport erhalten (${explicit ? 'mit' : 'ohne'} Quell-ID)`, async ({ page }) => {
    const data = course([
      entry(explicit ? 'a' : undefined, { foreign: 'bonjour', meanings: ['hallo'] }),
      entry('b', { unitId: 'unite-2', part: 'volet-1' }),
    ]);
    await importCourse(page, data);
    await page.click('#tabVocab');await page.fill('#vocabSearch', 'bonjour');await page.locator('.vocab-hit').click();
    await page.selectOption('#editUnit', 'unite-2');await page.selectOption('#editPart', 'volet-1');
    await page.fill('#editForeign', 'salut');await page.click('#saveEdit');
    await expect(page.locator('#editModal')).toBeHidden();
    const before = (await snapshot(page)).vocab;
    const edited = before.find(v => v.foreign === 'salut');
    expect(edited.userEdited).toBe(true);
    await page.reload();await importCourse(page, data);
    expect((await snapshot(page)).vocab).toEqual(before);
    expect(edited).toMatchObject({ unitId: 'unite-2', part: 'volet-1' });
  });
}

test('Kurse mit identischen vorgegebenen IDs bleiben getrennt', async ({ page }) => {
  await importCourse(page, course([entry('same')], 'eins', 'Eins'));
  await importCourse(page, course([entry('same', { foreign: 'autre' })], 'zwei', 'Zwei'));
  await importCourse(page, course([entry('same', { foreign: 'autre' })], 'zwei', 'Zwei'));
  const data = await snapshot(page);
  expect(data.vocab).toHaveLength(2);
  expect(data.vocab.find(v => v.courseId === 'eins').foreign).toBe('mot same');
  expect(data.vocab.find(v => v.courseId === 'zwei').foreign).toBe('autre');
});

test('Kurs-Export/Reimport erhält die ursprüngliche Identität einer Datei ohne IDs', async ({ page }) => {
  const original = course([entry(undefined, { foreign: 'bonjour', meanings: ['hallo'] })]);
  await importCourse(page, original);
  const before = (await snapshot(page)).vocab;
  const downloadPending = page.waitForEvent('download');
  await page.click('#exportCourse');
  const stream = await (await downloadPending).createReadStream();
  const chunks = [];for await (const chunk of stream) chunks.push(chunk);
  await importCourse(page, JSON.parse(Buffer.concat(chunks).toString()));
  await page.reload();await importCourse(page, original);
  expect((await snapshot(page)).vocab).toEqual(before);
});

test('Fehler beim Speichern der Einstellungen erhält Daten und bisherige Einstellungen', async ({ page }) => {
  await importCourse(page, course([entry('a')]));
  const backup = await exportBackup(page);
  backup.entries[0].foreign = 'Ersatz';
  const before = await snapshot(page);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'vokabeltrainer.settings.v4') {
        Storage.prototype.setItem = setItem;
        throw new DOMException('Simulierter Speicherfehler', 'QuotaExceededError');
      }
      return setItem.call(this, key, value);
    };
  });
  await restore(page, backup, false);
  expect(await snapshot(page)).toEqual(before);
});
