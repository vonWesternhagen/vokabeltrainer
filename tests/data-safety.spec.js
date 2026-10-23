const { holdRead, releaseRead } = require('./interaction-helpers');
const { test, expect, course, entry, openApp, importCourse, snapshot, seedProgress, startRound, exportBackup, restore }=require('./helpers');
async function stores(page){return page.evaluate(async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{const out={};for(const n of ['vocab','progress','courses','exams','history','snapshots'])out[n]=await new Promise((r,j)=>{const q=db.transaction(n).objectStore(n).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});return out}finally{db.close()}})}
async function preview(page,data,id='currentImportFile'){await page.click('#tabData');await page.locator('#'+id).setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(page.locator('#importPreview')).toBeVisible();await expect(page.locator('#dataView')).not.toHaveAttribute('aria-busy','true');}
async function commit(page){await page.click('#confirmImport');await expect(page.locator('#importPreview')).toBeHidden();await expect(page.locator('#dataView')).not.toHaveAttribute('aria-busy','true');}
async function downloadCourse(page){await page.click('#tabData');await page.locator('#advancedBackup').evaluate(e=>e.open=true);await page.fill('#profileName','Jakob');await page.locator('#profileName').blur();const pending=page.waitForEvent('download');await page.click('#saveCourseBackup');const d=await pending,stream=await d.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);return {name:d.suggestedFilename(),data:JSON.parse(Buffer.concat(chunks).toString())};}

test('Dashboard categories, navigation and overview editor preserve progress on save/cancel',async({page,hasTouch})=>{
 await openApp(page);const es=Array.from({length:7},(_,i)=>entry('v'+i));await importCourse(page,course(es));
 await seedProgress(page,[0,32,33,66,67,100].map((n,i)=>({id:'v'+i,attempts:100,correct:n})));await page.click('#tabHome');
 await expect(page.locator('#tabHome')).toHaveText('Übersicht');await expect(page.locator('#tabOverview')).toHaveText('Lernstand');await expect(page.locator('#tabData')).toHaveText('Datensicherung');
 for(const [id,value] of [['homeTotal','7'],['homeNew','1'],['homeWeak','2'],['homeDue','2']])await expect(page.locator('#'+id)).toHaveText(value);
 const before=await snapshot(page);await page.click('#tabOverview');await page.locator('#overviewBody button').first()[hasTouch?'tap':'click']();await expect(page.locator('#editModal')).toBeVisible();await page.fill('#editForeign','ne pas garder');await page.click('#cancelEdit');expect((await snapshot(page)).vocab).toEqual(before.vocab);
 await page.locator('#overviewBody button').first()[hasTouch?'tap':'click']();await page.fill('#editForeign','commencer; débuter');await page.fill('#editMeanings','anfangen; beginnen');await page.click('#saveEdit');await expect(page.locator('#editModal')).toBeHidden();expect((await snapshot(page)).progress).toEqual(before.progress);
 await page.reload();expect((await snapshot(page)).vocab.find(v=>v.id==='v0').foreignVariants).toEqual(['commencer','débuter']);
});

test('Class exam complete 40-word trial: persistence, session limit, learning and metadata-only deletion',async({page})=>{
 await openApp(page);const es=Array.from({length:40},(_,i)=>entry('exam'+i,{unitId:i<20?'unite-1':'module-2',part:i<20?'volet-1':'alle'}));await importCourse(page,course(es));
 await seedProgress(page,es.slice(0,30).map((v,i)=>({id:v.id,attempts:10,correct:i<10?1:i<20?5:9})));
 await page.click('#tabPlan');await page.fill('#examDate','2030-12-01');await page.locator('#examScopeList input').first().check();await page.click('#saveExam');await expect(page.locator('#examSummary')).toContainText('2030-12-01');await page.reload();
 await page.click('#tabLearn');await page.fill('#distinctCount','10');await page.selectOption('#orderSelect','forward');await page.click('#learnExamStart');await expect(page.locator('#bigProgress')).toHaveText('0 / 10');await page.uncheck('#autoNext');await page.uncheck('#autoDetectCorrect');
 for(let i=0;i<10;i++){const prompt=await page.locator('#prompt').innerText();const id=prompt.replace('Wort ','');expect(es.slice(0,20).some(v=>v.id===id)).toBe(true);await page.fill('#answer','mot '+id);await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await page.click('#check');}
 await expect(page.locator('#roundCompletePanel')).toBeVisible();const learned=await stores(page);expect(learned.history).toHaveLength(1);expect(learned.history[0]).toMatchObject({completed:true,answered:10});expect(learned.history[0].durationMs).toBeGreaterThan(0);
 await page.click('#leaveTrainer');await page.click('#tabPlan');await page.click('#newExam');await page.fill('#examDate','2031-02-01');await page.click('#selectAllExamScopes');await page.click('#saveExam');await expect(page.locator('#planExamSelect option')).toHaveCount(2);await page.click('#deleteExam');await expect(page.locator('#planExamSelect option')).toHaveCount(1);await page.click('#deleteExam');await expect(page.locator('#examSummary')).toContainText('noch keine');
 const after=await stores(page);expect(after.vocab).toEqual(learned.vocab);expect(after.progress).toEqual(learned.progress);expect(after.history).toEqual(learned.history);expect(after.exams).toHaveLength(0);
});

test('Smart import preview adds FR/DE variants, snapshots before mutation and all alternatives are accepted',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a',{foreign:'commencer',meanings:['anfangen']})]));await seedProgress(page,[{id:'a',attempts:3,correct:2}]);const before=await snapshot(page);
 await preview(page,course([entry('b',{foreign:'débuter',meanings:['anfangen']}),entry('c',{foreign:'commencer',meanings:['beginnen']})]));expect(await snapshot(page)).toEqual(before);await commit(page);
 const s=await stores(page);expect(s.vocab).toHaveLength(1);expect(s.vocab[0].foreignVariants).toEqual(['commencer','débuter']);expect(s.progress).toEqual(before.progress);expect(s.snapshots.some(x=>x.reason==='before-import'&&x.data.progress[0]?.attempts===3)).toBe(true);
 for(const [direction,answer] of [['DE_FR','commencer'],['DE_FR','débuter'],['FR_DE','anfangen'],['FR_DE','beginnen']]){
  await page.click('#tabLearn');await page.selectOption('#directionSelect',direction);await page.fill('#distinctCount','1');await page.click('#startNew');await page.uncheck('#autoNext');await page.uncheck('#autoDetectCorrect');await page.fill('#answer',answer);await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await page.click('#leaveTrainer');
 }
});

for(const mode of ['merge','separate','skip'])test('Manual conflict review '+mode,async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a',{foreign:'mettre',meanings:['setzen']})]));
 await preview(page,course([entry('b',{foreign:'mettre',meanings:['stellen']})]));await page.selectOption('#importStrategy','review');await expect(page.locator('#importConflicts fieldset')).toHaveCount(1);await page.selectOption('.review-mode',mode);
 if(mode==='merge'){await page.fill('.review-fr','mettre\nposer');await page.fill('.review-de','setzen\nstellen');}
 await commit(page);const s=await snapshot(page);expect(s.vocab).toHaveLength(mode==='separate'?2:1);if(mode==='merge')expect(s.vocab[0].foreignVariants).toEqual(['mettre','poser']);if(mode==='skip')expect(s.vocab[0].meanings).toEqual(['setzen']);
});

test('All-additional import keeps duplicates with distinct IDs; cancellation never writes',async({page})=>{
 await openApp(page);const data=course([entry('a')]);await importCourse(page,data);const before=await snapshot(page);await preview(page,data);await page.click('#cancelImport');expect(await snapshot(page)).toEqual(before);await preview(page,data);await page.selectOption('#importStrategy','all');await commit(page);const vs=(await snapshot(page)).vocab;expect(vs).toHaveLength(2);expect(new Set(vs.map(v=>v.id)).size).toBe(2);
});

test('Full course backup restores raw variants, progress, history and exams without touching other course',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('other')],'other','Anderer'));await importCourse(page,course([entry('a',{foreign:'mettre',foreignVariants:['mettre','poser'],meanings:['setzen','stellen']})]));await seedProgress(page,[{id:'a',attempts:4,correct:3}]);
 await page.click('#tabPlan');await page.fill('#examDate','2030-12-01');await page.click('#selectAllExamScopes');await page.click('#saveExam');await expect(page.locator('#examSummary')).toContainText('2030-12-01');
 await startRound(page,{count:1});await page.fill('#answer','mettre');await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await page.click('#leaveTrainer');
 await expect.poll(async()=>(await stores(page)).history.length).toBe(1);
 const backup=await downloadCourse(page);expect(backup.name).toMatch(/Testkurs_Jakob_.*\.json/);expect(backup.data).toMatchObject({backupType:'course-backup',schemaVersion:1,profileName:'Jakob',summary:{total:1,good:1,exams:1}});
 const before=await snapshot(page),historyBefore=(await stores(page)).history;expect(backup.data.history).toEqual(historyBefore);expect(historyBefore[0]).toMatchObject({completed:false,answered:1});expect(historyBefore[0].durationMs).toBeGreaterThan(0);
 await startRound(page,{count:1});await page.fill('#answer','poser');await page.click('#check');await page.click('#leaveTrainer');await expect.poll(async()=>(await stores(page)).history.length).toBe(2);
 await page.click('#tabVocab');await page.fill('#vocabSearch','mettre');await page.locator('#vocabList .vocab-hit').click();await page.fill('#editMeanings','verändert');await page.click('#saveEdit');await expect(page.locator('#editModal')).toBeHidden();await restore(page,backup.data);
 const after=await snapshot(page);for(const store of ['vocab','progress','courses','exams'])expect(after[store]).toEqual(before[store]);
 expect((await stores(page)).history).toEqual(historyBefore);expect((await stores(page)).snapshots.some(x=>x.reason==='before-restore')).toBe(true);
});

test('New-course collision copies or explicitly replaces, with backup',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await preview(page,course([entry('b')]),'newCourseFile');await expect(page.locator('#courseCollision')).toBeVisible();await commit(page);expect((await stores(page)).courses).toHaveLength(2);
 await preview(page,course([entry('c')]),'newCourseFile');await page.selectOption('#courseCollisionChoice','replace');await commit(page);const s=await stores(page);expect(s.courses).toHaveLength(2);expect(s.vocab.filter(x=>x.courseId==='testkurs').map(x=>x.id)).toEqual(['c']);expect(s.snapshots.some(x=>x.reason==='before-course-replace')).toBe(true);
});

test('Reset keeps emergency backup; internal restore recovers every course and learning record',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await seedProgress(page,[{id:'a',attempts:5,correct:4}]);const before=await snapshot(page);await page.click('#tabData');await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');await page.click('#tabData');const row=page.locator('#snapshotList>div').filter({hasText:'Sicherung vor Zurücksetzen'});await expect(row).toHaveCount(1);await row.getByRole('button',{name:'Wiederherstellen',exact:true}).click();await expect(page.locator('#homeTotal')).toHaveText('1');const after=await snapshot(page);for(const store of ['vocab','progress','courses','exams'])expect(after[store]).toEqual(before[store]);
});

test('Snapshots retain ten per course and storage failure blocks import',async({page})=>{
 test.setTimeout(90000);await openApp(page);await importCourse(page,course([entry('a')]));for(let i=0;i<11;i++){await preview(page,course([entry('b'+i)]));await commit(page);}const ss=await stores(page);expect(ss.snapshots.filter(x=>x.courseId==='testkurs'&&!x.emergency&&!x.online)).toHaveLength(10);
 const before=await snapshot(page);await preview(page,course([entry('blocked')]));await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='snapshots'){IDBObjectStore.prototype.put=put;throw new DOMException('Test quota','QuotaExceededError')}return put.apply(this,args)}});await page.click('#confirmImport');await expect(page.locator('#backupResult')).toContainText('nicht abgeschlossen');expect(await snapshot(page)).toEqual(before);
});

test('Legacy DB upgrade preserves courses, single-string records, progress, exams and takes pre-migration snapshot',async({page})=>{
 await page.goto('/manifest.webmanifest');await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('VokabeltrainerTest',2);r.onupgradeneeded=()=>{for(const n of ['vocab','progress','courses','exams'])r.result.createObjectStore(n,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  await new Promise((r,j)=>{const tx=db.transaction(['vocab','progress','courses','exams'],'readwrite');tx.oncomplete=r;tx.onabort=()=>j(tx.error);
   tx.objectStore('courses').put({id:'old',label:'Alt-Kurs'});tx.objectStore('courses').put({id:'second',label:'Zweiter'});
   tx.objectStore('vocab').put({id:'a',courseId:'old',fr:'mettre',de:'setzen',unitId:'unite-0',part:'auftakt'});
   tx.objectStore('vocab').put({id:'b',courseId:'second',foreign:'ancien',meanings:['alt'],unitId:'module-a',part:'alle'});
   tx.objectStore('progress').put({id:'a',attempts:8,correct:6});tx.objectStore('exams').put({id:'old',date:'2030-12-01',scopes:['unite-0|auftakt']});});db.close();
 });
 await openApp(page);const s=await stores(page);expect(s.courses).toHaveLength(2);expect(s.vocab).toHaveLength(2);expect(s.progress).toEqual([{id:'a',attempts:8,correct:6}]);expect(s.exams[0].id).toBe('old');expect(s.vocab.find(v=>v.id==='a')).toMatchObject({foreign:'mettre',meanings:['setzen'],unitId:'unite-0'});expect(s.vocab.find(v=>v.id==='b').unitId).toBe('module-a');expect(s.snapshots.some(x=>x.reason==='before-migration'&&x.data.entries.some(v=>v.fr==='mettre'))).toBe(true);
 await page.selectOption('#activeCourseSelect','old');await page.click('#tabPlan');await expect(page.locator('#examSummary')).toContainText('2030-12-01');
 await page.click('#tabLearn');await page.fill('#distinctCount','1');await page.click('#learnExamStart');await page.uncheck('#autoNext');await page.uncheck('#autoDetectCorrect');await expect(page.locator('#prompt')).toHaveText('setzen');await page.fill('#answer','mettre');await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await page.click('#leaveTrainer');
 const after=await stores(page);expect(after.courses).toEqual(s.courses);expect(after.vocab).toEqual(s.vocab);expect(after.exams).toEqual(s.exams);expect(after.progress[0]).toMatchObject({id:'a',attempts:9,correct:7});

});


test('Delayed exam reads cannot replace a new draft or its chosen date',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await page.click('#tabPlan');await page.fill('#examDate','2030-12-01');await page.click('#selectAllExamScopes');await page.click('#saveExam');await expect(page.locator('#examSummary')).toContainText('2030-12-01');
 await page.click('#tabVocab');await holdRead(page,'exams');await page.click('#tabPlan');await page.waitForFunction(()=>window.heldRead.waiting);
 await page.click('#newExam');await page.fill('#examDate','2031-04-02');await page.click('#selectAllExamScopes');await releaseRead(page);
 await expect(page.locator('#examDate')).toHaveValue('2031-04-02');await expect(page.locator('#planExamSelect')).toHaveValue('');await page.click('#saveExam');await expect(page.locator('#planExamSelect option')).toHaveCount(2);
 expect((await stores(page)).exams.map(e=>e.date).sort()).toEqual(['2030-12-01','2031-04-02']);
});


test('Editor autofocus never steals focus from German variants or a closed modal',async({page,hasTouch})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await page.clock.install();await page.clock.pauseAt(new Date());
 await page.click('#tabOverview');await page.locator('#overviewBody button').first()[hasTouch?'tap':'click']();await page.locator('#editMeanings').focus();await page.clock.runFor(100);await expect(page.locator('#editMeanings')).toBeFocused();
 await page.fill('#editMeanings','setzen; stellen');await page.click('#cancelEdit');await page.clock.runFor(100);await expect(page.locator('#editModal')).toBeHidden();await expect(page.locator('#editForeign')).not.toBeFocused();
 await page.click('#tabVocab');await page.click('#newVocab');await page.locator('#editMeanings').focus();await page.clock.runFor(100);await expect(page.locator('#editMeanings')).toBeFocused();await page.click('#cancelEdit');
 expect((await stores(page)).vocab[0].meanings).toEqual(['Wort a']);
});


test('Loading snapshots cannot erase a profile name being typed for course backup',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await page.click('#tabVocab');await holdRead(page,'snapshots');await page.click('#tabData');await page.waitForFunction(()=>window.heldRead.waiting);
 await page.locator('#advancedBackup').evaluate(e=>e.open=true);await page.fill('#profileName','Jakob');await releaseRead(page);await expect(page.locator('#profileName')).toHaveValue('Jakob');await page.locator('#profileName').blur();
 expect(await page.evaluate(()=>localStorage.getItem('vokabeltrainer.profile'))).toBe('Jakob');
 const pending=page.waitForEvent('download');await page.click('#saveCourseBackup');expect((await pending).suggestedFilename()).toContain('Jakob');
});
