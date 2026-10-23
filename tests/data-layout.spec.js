const {test,expect,openApp,course,entry,importCourse,exportBackup,restore,snapshot,courseBackupFixture,localSnapshotFixture}=require('./helpers');
const {execFileSync}=require('node:child_process');
const oldHtml=execFileSync('git',['show','b6ad3f9:index.html'],{encoding:'utf8'}).replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link[^>]+>/g,'');
const oldCss=execFileSync('git',['show','b6ad3f9:styles.css'],{encoding:'utf8'});

test('Compact header, one learning tile, Lernstand and three responsive data tiles',async({page,hasTouch})=>{
 await page.setContent(oldHtml);await page.addStyleTag({content:oldCss});
 const oldBottom=await page.locator('.tabs').evaluate(e=>e.getBoundingClientRect().bottom);
 await openApp(page);
 const bottom=await page.locator('.tabs').evaluate(e=>e.getBoundingClientRect().bottom);
 expect(bottom).toBeLessThan(oldBottom*.8);expect(bottom).toBeLessThan(page.viewportSize().height*.30);
 await expect(page.locator('#homeView .home-action strong').filter({hasText:/^Lernen$/})).toHaveCount(1);
 await expect(page.locator('#tabOverview')).toHaveText('Lernstand');await expect(page.locator('#homeOverview strong')).toHaveText('Lernstand');
 expect(await page.locator('body').innerText()).not.toContain('Vokabelübersicht');
 await page.screenshot({path:test.info().outputPath('home-layout.png'),fullPage:true});
 await page.locator('#homeData')[hasTouch?'tap':'click']();
 const cards=page.locator('#dataView > .data-tile');await expect(cards).toHaveCount(3);
 expect(await cards.locator(':scope > h2').allTextContents()).toEqual(['Einlesen','Sicherung wiederherstellen','Kurse und Daten löschen']);
 const boxes=await cards.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right}}));
 expect(boxes[0].y).toBe(boxes[1].y);expect(boxes[2].y).toBeGreaterThan(boxes[0].y);expect(boxes[2].right).toBe(boxes[1].right);expect(boxes[0].x).toBe(boxes[2].x);expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
 await expect(page.locator('#dataImport > h3').last()).toHaveText('Neuen Kurs einrichten');
 await expect(page.getByText('Zum Beispiel für eine weitere Sprache oder einen anderen Jahrgang.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('#onlineStatus')).toBeVisible();expect(await page.locator('#dataRestore > :nth-child(2)').getAttribute('id')).toBe('onlineStatus');await expect(page.locator('#saveCourseBackup')).toBeHidden();
 for(const id of ['pairDevice','reset'])expect((await page.locator('#'+id).boundingBox()).height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:test.info().outputPath('data-layout.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 const narrow=await cards.evaluateAll(es=>es.map(e=>e.getBoundingClientRect().x));expect(new Set(narrow).size).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Legacy full backup remains readable; snapshot download now produces separate course files',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('fr')],'fr','Französisch 6'));await importCourse(page,course([entry('en')],'en','Englisch 6'));
 const old=await exportBackup(page);old.appVersion='4.5.9';const before=await snapshot(page);
 await page.click('#tabData');await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');await restore(page,old);
 for(const n of ['courses','vocab','progress','exams'])expect((await snapshot(page))[n]).toEqual(before[n]);
 await localSnapshotFixture(page);
 await expect(page.locator('#snapshotList').getByRole('button',{name:'Als Datei sichern',exact:true})).toHaveCount(0);
 await expect(page.locator('#snapshotList').getByRole('button',{name:'Wiederherstellen',exact:true}).first()).toBeVisible();
 const backups=await Promise.all(['fr','en'].map(cid=>courseBackupFixture(page,cid)));
 expect(backups.map(b=>b.course.id).sort()).toEqual(['en','fr']);
});
