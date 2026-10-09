const { test, expect, course, entry, openApp, importCourse, snapshot, startRound, exportBackup, restore } = require('./helpers');

const fr6 = entries => course(entries, 'franzoesisch-6', 'Französisch 6');
const numericModules = [1, 2, 3, 4, 5, 6];

test.beforeEach(async ({ page }) => openApp(page));

test('Volet 3 folgt auf Volet 2; bisherige Teilbereiche und ihre Filter bleiben erhalten', async ({ page }) => {
  const parts = ['sonstiges', 'volet-3', 'auftakt', 'volet-2', 'vocabulaire-thematique', 'volet-1'];
  await importCourse(page, fr6(parts.map(part => entry(part, { part }))));
  const labels = ['Alle Teilbereiche', 'Auftakt', 'Vocabulaire thématique', 'Volet 1', 'Volet 2', 'Volet 3', 'Sonstiges'];
  for (const [tab, unit, part] of [['#tabLearn', '#unitSelect', '#partSelect'], ['#tabOverview', '#overviewUnit', '#overviewPart']]) {
    await page.click(tab);await page.selectOption(unit, 'unite-1');
    await expect(page.locator(part)).toBeEnabled();
    await expect(page.locator(`${part} option`)).toHaveText(labels);
  }
  for (const part of parts) {
    await page.selectOption('#overviewPart', part);
    await expect(page.locator('#overviewBody tr')).toHaveCount(1);
    await expect(page.locator('#overviewBody')).toContainText(`mot ${part}`);
  }
  await page.click('#tabLearn');await page.selectOption('#partSelect', 'volet-3');
  await startRound(page, { count: 10 });
  await expect(page.locator('#bigProgress')).toHaveText('0 / 1');
  await expect(page.locator('#prompt')).toHaveText('Wort volet-3');
  await expect(page.locator('#trainerScope')).toContainText('Unité 1 · Volet 3');
});

test('Zusammengesetzte Volet-3-IDs werden beim Import in Unité und Teilbereich getrennt', async ({ page }) => {
  await importCourse(page, fr6([entry('legacy', { unitId: 'unite-2-volet-3', part: undefined, sectionName: 'Ça va' })]));
  expect((await snapshot(page)).vocab[0]).toMatchObject({ unitId: 'unite-2', part: 'volet-3' });
  await page.click('#tabLearn');
  await expect(page.locator('#unitSelect option')).toHaveText(['Alle Vokabeln', 'Unité 2']);
  await page.selectOption('#unitSelect', 'unite-2');
  await expect(page.locator('#partSelect option')).toHaveText(['Alle Teilbereiche', 'Volet 3']);
  await page.click('#tabPlan');
  await expect(page.locator('#examScopeList .scope-option')).toHaveText(['Unité 2 · Volet 3']);
});

test('Module 1–6 werden angenommen, numerisch sortiert und ohne Teilbereiche ausgewählt', async ({ page }) => {
  await importCourse(page, fr6([
    ...[6, 2, 4, 1, 5, 3].map(n => entry(`m${n}`, { unitId: `module-${n}`, part: 'volet-3' })),
    entry('intro', { unitId: 'unite-0', part: 'auftakt' }),
    entry('unit', { unitId: 'unite-1', part: 'volet-1' }),
  ]));
  const data = await snapshot(page);
  expect(data.vocab).toHaveLength(8);
  expect(data.vocab.filter(v => v.unitId.startsWith('module-')).every(v => v.part === 'alle')).toBe(true);
  const labels = ['Alle Vokabeln', 'Unité 0', 'Unité 1', ...numericModules.map(n => `Module ${n}`)];
  for (const [tab, unit, part] of [['#tabLearn', '#unitSelect', '#partSelect'], ['#tabOverview', '#overviewUnit', '#overviewPart']]) {
    await page.click(tab);await expect(page.locator(`${unit} option`)).toHaveText(labels);
    for (const n of numericModules) {
      await page.selectOption(unit, `module-${n}`);
      await expect(page.locator(part)).toBeDisabled();
      await expect(page.locator(`${part} option`)).toHaveText(['gesamtes Modul']);
      await expect(page.locator(part)).toHaveValue('alle');
      if (tab === '#tabOverview') {
        await expect(page.locator('#overviewBody tr')).toHaveCount(1);
        await expect(page.locator('#overviewBody')).toContainText(`mot m${n}`);
      }
    }
    await page.selectOption(unit, 'unite-1');await expect(page.locator(part)).toBeEnabled();
    await page.selectOption(unit, 'unite-0');await expect(page.locator(part)).toHaveValue('auftakt');
    await page.selectOption(unit, 'alle');await expect(page.locator(part)).toBeDisabled();
  }
  await page.click('#tabPlan');
  await expect(page.locator('#examScopeList .scope-option')).toHaveText(['Unité 0 · Auftakt', 'Unité 1 · Volet 1', ...numericModules.map(n => `Module ${n}`)]);
});

test('Alphabetische Module bleiben neben numerischen Modulen kompatibel und lernbar', async ({ page }) => {
  await importCourse(page, fr6(['z', 'b', '6', 'a', '1'].map(id => entry(`m${id}`, { unitId: `module-${id}`, part: 'alle' }))));
  await page.reload();await page.click('#tabLearn');
  await expect(page.locator('#unitSelect option')).toHaveText(['Alle Vokabeln', 'Module 1', 'Module 6', 'Module A', 'Module B', 'Module Z']);
  for (const id of ['a', 'b', 'z']) {
    await page.selectOption('#unitSelect', `module-${id}`);
    await expect(page.locator('#partSelect')).toBeDisabled();
    await expect(page.locator('#partSelect option')).toHaveText(['gesamtes Modul']);
  }
  await startRound(page, { count: 10 });
  await expect(page.locator('#bigProgress')).toHaveText('0 / 1');
  await expect(page.locator('#prompt')).toHaveText('Wort mz');
  await expect(page.locator('#trainerScope')).toContainText('Module Z');
});

for (const moduleId of ['module-1', 'module-6', 'module-a']) {
  test(`Editor kann zwischen Volet 3 und ${moduleId} wechseln und die Zuordnung speichern`, async ({ page }) => {
    await importCourse(page, fr6([
      entry('edit', { part: 'volet-3' }),
      entry('module', { unitId: moduleId, part: 'alle' }),
    ]));
    await page.click('#tabVocab');await page.fill('#vocabSearch', 'mot edit');await page.locator('.vocab-hit').click();
    await expect(page.locator('#editPart')).toHaveValue('volet-3');
    await expect(page.locator('#editPart option')).toHaveText(['Volet 3']);
    await page.selectOption('#editUnit', moduleId);
    await expect(page.locator('#editPart')).toBeDisabled();
    await expect(page.locator('#editPart option')).toHaveText(['gesamtes Modul']);
    await expect(page.locator('#editLocation')).toContainText('gesamtes Modul');
    await page.selectOption('#editUnit', 'unite-1');await expect(page.locator('#editPart')).toBeEnabled();
    await expect(page.locator('#editPart')).toHaveValue('volet-3');
    await page.selectOption('#editUnit', moduleId);await page.click('#saveEdit');
    await expect(page.locator('#editModal')).toBeHidden();
    await page.reload();
    expect((await snapshot(page)).vocab.find(v => v.id === 'edit')).toMatchObject({ unitId: moduleId, part: 'alle', userEdited: true });
    await page.click('#tabLearn');await page.selectOption('#unitSelect', moduleId);
    await startRound(page, { count: 10 });
    await expect(page.locator('#bigProgress')).toHaveText('0 / 2');
    await expect(page.locator('#trainerScope')).toContainText(`Module ${moduleId.slice(7).toUpperCase()}`);
  });
}

test('Vorhandene gespeicherte Volet-3- und Modulzuordnungen werden beim Start normalisiert', async ({ page }) => {
  await importCourse(page, fr6([
    entry('legacy', { part: 'volet-3' }),
    entry('numeric', { unitId: 'module-3', part: 'alle' }),
    entry('alpha', { unitId: 'module-b', part: 'alle' }),
  ]));
  const backup = await exportBackup(page);
  backup.entries.find(v => v.id === 'legacy').unitId = 'unite-1-volet-3';
  backup.entries.forEach(v => { v.part = 'sonstiges'; });
  await restore(page, backup);await page.reload();
  const data = await snapshot(page);
  expect(data.vocab.find(v => v.id === 'legacy')).toMatchObject({ unitId: 'unite-1', part: 'volet-3' });
  for (const id of ['numeric', 'alpha']) expect(data.vocab.find(v => v.id === id).part).toBe('alle');
  await page.click('#tabPlan');
  await expect(page.locator('#examScopeList .scope-option')).toHaveText(['Unité 1 · Volet 3', 'Module 3', 'Module B']);
});
