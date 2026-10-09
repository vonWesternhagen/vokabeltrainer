const { test: base, expect } = require('@playwright/test');
const fixture79 = require('./fixtures/franzoesisch-6-79.json');

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await use(page);
    expect(errors, 'Keine unbehandelten JavaScript-/IndexedDB-Fehler').toEqual([]);
  },
});

function course(entries, id = 'testkurs', label = 'Testkurs') {
  return { fileType: 'vocabulary-course', schemaVersion: 7, course: { id, label }, entries };
}
function entry(id, overrides = {}) {
  return { id, foreign: `mot ${id}`, meanings: [`Wort ${id}`], unitId: 'unite-1', part: 'auftakt', ...overrides };
}
async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#appStatus')).toContainText('Version 4.5 läuft');
}
async function importCourse(page, data) {
  await page.click('#tabData');
  await page.locator('#vocabImportFile').setInputFiles({
    name: 'vocabulary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#vocabImportFile')).toHaveValue('');
  await expect(page.locator('#vocabImportResult')).toContainText('Import abgeschlossen:');
}
async function restore(page, data, valid = true) {
  await page.click('#tabData');
  await page.locator('#backupRestoreFile').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#backupRestoreFile')).toHaveValue('');
  await expect(page.locator('#backupResult')).toContainText(valid ? 'Backup vollständig wiederhergestellt:' : 'Wiederherstellungsfehler:');
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('VokabeltrainerTest');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      const result = {};
      for (const name of ['vocab', 'progress', 'courses', 'exams']) {
        result[name] = await new Promise((resolve, reject) => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
        });
      }
      result.settings = localStorage.getItem('vokabeltrainer.settings.v4');
      result.activeCourse = localStorage.getItem('vokabeltrainer.activeCourse.v1');
      return result;
    } finally { db.close(); }
  });
}
async function seedProgress(page, records) {
  // Nur Testvorbereitung: bestehende Lernstände gezielt setzen, keine Test-Hooks im Produkt.
  await page.evaluate(async records => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('VokabeltrainerTest');r.onsuccess = () => resolve(r.result);r.onerror = () => reject(r.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('progress', 'readwrite');
        tx.oncomplete = resolve;tx.onabort = () => reject(tx.error);
        records.forEach(p => tx.objectStore('progress').put({
          deFr: 0, frDe: 0, attempts: 0, correct: 0, almost: 0, wrong: 0,
          attemptsDEFR: 0, attemptsFRDE: 0, correctDEFR: 0, almostDEFR: 0, wrongDEFR: 0,
          correctFRDE: 0, almostFRDE: 0, wrongFRDE: 0,
          lastPracticedAt: null, dueDEFR: null, dueFRDE: null, ...p,
        }));
      });
    } finally { db.close(); }
  }, records);
}
async function startRound(page, { count = 10, mode = 'new', order = 'forward', autoNext = false } = {}) {
  await page.click('#tabLearn');
  await page.fill('#distinctCount', String(count));
  await page.selectOption('#orderSelect', order);
  await page.click(mode === 'weak' ? '#startWeak' : '#startNew');
  await expect(page.locator('#trainerView')).toBeVisible();
  await page.locator('#autoNext').setChecked(autoNext);
  await page.uncheck('#autoDetectCorrect');
}
async function finishWithReveals(page, count) {
  const prompts = [];
  for (let i = 0; i < count; i++) {
    prompts.push(await page.locator('#prompt').innerText());
    await page.click('#showAnswer');
    await expect(page.locator('#bigProgress')).toHaveText(`${i + 1} / ${count}`);
    await page.click('#check');
  }
  await expect(page.locator('#roundCompletePanel')).toBeVisible();
  return prompts;
}
async function exportBackup(page) {
  await page.click('#tabData');
  const pending = page.waitForEvent('download');
  await page.click('#exportBackup');
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
module.exports = { test, expect, fixture79, course, entry, openApp, importCourse, restore, snapshot, seedProgress, startRound, finishWithReveals, exportBackup };
