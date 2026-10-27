const {test,expect,openApp,importCourse,course,entry,startRound,snapshot,exportBackup,restore,courseBackupFixture}=require('./helpers');
const {fixture,card}=require('./fixtures/english-synthetic');
async function english(page,entries=fixture.entries){await importCourse(page,{...fixture,entries})}
async function editAnswer(page,answer,expected){await page.fill('#answer',answer);await page.click('#check');await expect(page.locator('#feedback')).toContainText(expected)}
test('English units, parts, locale labels and location filters coexist with French',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('fr')],'fr','Français'));await english(page);await page.click('#tabLearn');
 expect(await page.locator('#unitSelect option').evaluateAll(es=>es.map(e=>e.value))).toEqual(['alle','unit-0','unit-1','unit-2','unit-3','unit-4','unit-5','irregular-verbs']);
 await page.selectOption('#unitSelect','unit-1');await expect(page.locator('#partSelect option')).toHaveText(['Alle Teilbereiche','Auftakt','Part A','Part B','Part C','Story']);
 await expect(page.locator('#directionSelect option[value="DE_FR"]')).toHaveText('Deutsch → Englisch');
 await page.selectOption('#unitSelect','irregular-verbs');await expect(page.locator('#partSelect')).toBeDisabled();
 await page.click('#tabOverview');await page.selectOption('#overviewUnit','unit-5');await page.selectOption('#overviewPart','story');await expect(page.locator('#overviewBody')).toContainText('a moonberry');
 await expect(page.locator('#foreignHeading')).toHaveText('Englisch');await expect(page.locator('#overviewSort option[value="french"]')).toHaveText('Englisch A–Z');
 await page.locator('#overviewBody button').first().click();await expect(page.locator('#editForeignLabel')).toHaveText('Englisch');await page.click('#closeEdit');
 await page.click('#tabHome');await page.selectOption('#activeCourseSelect','fr');await page.click('#tabLearn');await expect(page.locator('#directionSelect option[value="DE_FR"]')).toHaveText('Deutsch → Französisch');await page.click('#tabOverview');await expect(page.locator('#foreignHeading')).toHaveText('Französisch');
});
test('English optional verb forms are fully correct, article override remains available',async({page})=>{
 await openApp(page);await english(page,[card('a','to swim','schwimmen'),card('b','to find out (about sth.)','herausfinden'),card('c','a moonberry','Mondbeere')]);
 await startRound(page,{count:3});await editAnswer(page,'swim','Richtig');await page.click('#check');await editAnswer(page,'find out','Richtig');await page.click('#check');await editAnswer(page,'the moonberry','Fast richtig');await expect(page.locator('#nearMissActions')).toBeVisible();
});
test('German explanatory parentheses may be omitted in reverse English direction',async({page})=>{
 await openApp(page);await english(page,[card('a','the moon dish','das Gericht (Speise)')]);await page.click('#tabLearn');await page.selectOption('#directionSelect','FR_DE');await startRound(page,{count:1});await expect(page.locator('#directionLabel')).toHaveText('Englisch → Deutsch');await editAnswer(page,'Gericht','Richtig');
});
test('Irregular cards force forward direction even in reverse or mixed rounds',async({page})=>{
 await openApp(page);await english(page,[card('a','swim – swam – swum','schwimmen (alle Formen)','irregular-verbs','alle')]);
 for(const direction of ['FR_DE','MIXED']){await page.click('#tabLearn');await page.selectOption('#directionSelect',direction);await startRound(page,{count:1});await expect(page.locator('#directionLabel')).toHaveText('Deutsch → Englisch');await expect(page.locator('#answer')).toHaveAttribute('lang','en-GB');await editAnswer(page,'swim swam swum','Richtig');await page.click('#check');await page.click('#leaveTrainer')}
});
test('English source cards remain distinct, reimport and course backup restore retain metadata and other course',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('fr')],'fr','Français'));const fr=await snapshot(page);await english(page);await english(page);
 const b=await courseBackupFixture(page,'english-demo');expect(b.entries).toHaveLength(fixture.entries.length);expect(b.entries.filter(x=>x.foreign==='to lie')).toHaveLength(2);expect(b.course.learningLocale).toBe('en-GB');expect(b.entries.find(x=>x.id==='berry').locations[0].page).toBe(318);
 const state=await exportBackup(page);expect(state.entries.filter(x=>x.courseId==='fr')).toEqual(fr.vocab);await restore(page,b);const after=await exportBackup(page);expect(after.entries.filter(x=>x.courseId==='english-demo')).toEqual(b.entries);expect(after.entries.filter(x=>x.courseId==='fr')).toEqual(fr.vocab);
 const queued=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});const a=await new Promise(r=>{const q=db.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>r(q.result)});db.close();return a.filter(x=>x.online&&x.courseId==='english-demo')});expect(queued).toHaveLength(1);expect(queued[0].data.entries).toEqual(b.entries);
});
