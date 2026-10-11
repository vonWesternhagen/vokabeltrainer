const { test: base, expect, course, entry, importCourse } = require('./helpers');
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      window.interactionRejections = [];
      window.addEventListener('unhandledrejection', event => window.interactionRejections.push(String(event.reason)));
    });
    await use(page);
    expect(errors, 'Keine Console Errors').toEqual([]);
    expect(await page.evaluate(() => window.interactionRejections), 'Keine unhandled Rejections').toEqual([]);
  },
});
const views = ['home', 'learn', 'trainer', 'plan', 'overview', 'vocab', 'data'];
async function assertView(page, name) {
  await expect(page.locator('main > section:visible')).toHaveAttribute('id', `${name}View`);
  for (const view of views) await expect(page.locator(`#${view}View`)).toHaveJSProperty('hidden', view !== name);
  if (name !== 'trainer') await expect(page.locator('.tab.active')).toHaveAttribute('id', `tab${name[0].toUpperCase()}${name.slice(1)}`);
  await expect(page.locator('#editModal')).toBeHidden();
}
async function prepareCourses(page) {
  await importCourse(page, course([
    entry('six-a', { foreign: 'bonjour', meanings: ['hallo'], part: 'volet-3' }),
    entry('six-b', { unitId: 'module-1' }),
    entry('six-c', { unitId: 'unite-0', part: 'auftakt' }),
  ], 'franzoesisch-6', 'Französisch 6'));
  await importCourse(page, course([entry('ten', { unitId: 'unite-4', part: 'volet-2' })], 'franzoesisch', 'Französisch 10'));
  await page.click('#tabHome');await page.selectOption('#activeCourseSelect', 'franzoesisch-6');
}
// Verzögert nur die Rückmeldung eines bereits abgeschlossenen echten Reads.
// Kein Produktions-Hook, keine Sleeps, keine offen gehaltene IDB-Transaktion.
async function holdRead(page, store = 'progress', onLoad = false) {
  const install = store => {
    const original = IDBObjectStore.prototype.get;
    window.heldRead = { waiting: false, released: false };
    IDBObjectStore.prototype.get = function (...args) {
      const request = original.apply(this, args);
      if (this.name === store) {
        IDBObjectStore.prototype.get = original;
        Object.defineProperty(request, 'onsuccess', { set(callback) {
          request.addEventListener('success', event => {
            window.heldRead.waiting = true;
            window.heldRead.release = () => {
              callback.call(request, event);
              window.heldRead.released = true;
            };
          });
        } });
      }
      return request;
    };
  };
  if (onLoad) await page.addInitScript(install, store);
  else await page.evaluate(install, store);
}
async function releaseRead(page) {
  await page.waitForFunction(() => window.heldRead.waiting);
  await page.evaluate(() => window.heldRead.release());
  // Freigegebene Rückmeldungen und DOM-Updates abarbeiten, ohne Timer-Sleeps.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
module.exports = { test, expect, assertView, prepareCourses, holdRead, releaseRead };
