const {test,expect,course,entry,openApp,importCourse,seedProgress,startRound,restore,snapshot}=require('./helpers');
async function rows(page,store='snapshots'){return page.evaluate(async store=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{return await new Promise((r,j)=>{const q=db.transaction(store).objectStore(store).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}finally{db.close()}},store)}
async function automatic(page){return (await rows(page)).filter(x=>x.online&&x.data.backupKind==='automatic')}
async function count(page,n){await expect.poll(async()=>(await automatic(page)).length).toBe(n)}
async function latest(page,cid='testkurs'){return (await automatic(page)).filter(x=>x.courseId===cid).sort((a,b)=>b.sequence-a.sequence)[0]}
async function edit(page,text){await page.click('#tabOverview');await page.locator('#overviewBody button').first().click();await page.fill('#editMeanings',text);await page.click('#saveEdit');await expect(page.locator('#editModal')).toBeHidden()}

test('Startup hashes course content only; changed course alone is captured; unpaired queue survives reload',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await importCourse(page,course([entry('b')],'other','Other'));await count(page,2);
 const before=await automatic(page);await page.reload();await page.click('#tabData');await count(page,2);expect((await automatic(page)).map(x=>x.id).sort()).toEqual(before.map(x=>x.id).sort());
 await seedProgress(page,[{id:'a',attempts:4,correct:3}]);await page.reload();await count(page,3);expect((await automatic(page)).filter(x=>x.courseId==='other')).toHaveLength(1);expect((await latest(page)).data.progress[0].attempts).toBe(4);
 await page.click('#tabData');await expect(page.locator('#onlineStatus')).toContainText('noch nicht eingerichtet');await page.click('#tabOverview');await page.reload();await count(page,3);
});

test('Learning captures committed progress and history once at completion, never per answer; deliberate exit captured',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a'),entry('b')]));await count(page,1);await startRound(page,{count:2});
 for(let i=0;i<2;i++){const id=(await page.locator('#prompt').innerText()).replace('Wort ','');await page.fill('#answer','mot '+id);await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await count(page,1);await page.click('#check');}
 await expect(page.locator('#roundCompletePanel')).toBeVisible();await count(page,2);const b=(await latest(page)).data;expect(b.progress.reduce((n,p)=>n+p.attempts,0)).toBe(2);expect(b.history[0]).toMatchObject({completed:true,answered:2});
 await page.click('#leaveTrainer');await startRound(page,{count:2});const id=(await page.locator('#prompt').innerText()).replace('Wort ','');await page.fill('#answer','mot '+id);await page.click('#check');await page.click('#leaveTrainer');await count(page,3);expect((await latest(page)).data.history.some(h=>h.completed===false&&h.answered===1)).toBe(true);
});

test('Committed vocabulary and exam changes captured; cancelled or invalid imports never captured',async({page})=>{
 test.setTimeout(90000);await openApp(page);await importCourse(page,course([entry('a')]));await count(page,1);
 await page.click('#tabData');await page.locator('#currentImportFile').setInputFiles({name:'cancel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(course([entry('b')])))});await page.click('#cancelImport');await count(page,1);
 await page.locator('#currentImportFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});await expect(page.locator('#backupResult')).toContainText('nicht abgeschlossen');await count(page,1);
 await edit(page,'geändert');await count(page,2);expect((await latest(page)).data.entries[0].meanings).toEqual(['geändert']);
 await page.click('#tabVocab');await page.click('#newVocab');await page.fill('#editForeign','nouveau');await page.fill('#editMeanings','neu');await page.click('#saveEdit');await count(page,3);expect((await latest(page)).data.entries).toHaveLength(2);
 await page.fill('#vocabSearch','nouveau');await page.locator('#vocabList .vocab-hit').first().click();await page.click('#deleteVocab');await count(page,4);expect((await latest(page)).data.entries).toHaveLength(1);
 await page.click('#tabPlan');await page.fill('#examDate','2030-12-01');await page.click('#selectAllExamScopes');await page.click('#saveExam');await count(page,5);
 await page.fill('#examDate','2031-01-01');await page.click('#saveExam');await count(page,6);expect((await latest(page)).data.exams[0].date).toBe('2031-01-01');
 await page.click('#deleteExam');await count(page,7);expect((await latest(page)).data.exams).toEqual([]);
});

test('Course restore queues restored state again, leaves other course untouched; reset preserves pending and creates no empty cloud copy',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('other')],'other','Other'));await importCourse(page,course([entry('a')]));await count(page,2);const backup=(await latest(page)).data,other=(await latest(page,'other')).serialized;
 await edit(page,'verändert');await count(page,3);await restore(page,backup);await count(page,4);expect((await latest(page)).data.entries).toEqual(backup.entries);expect((await latest(page,'other')).serialized).toBe(other);expect((await automatic(page)).filter(x=>x.courseId==='other')).toHaveLength(1);
 const pending=(await automatic(page)).map(x=>x.serialized).sort();await page.click('#tabData');await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');await page.reload();expect((await automatic(page)).map(x=>x.serialized).sort()).toEqual(pending);expect((await rows(page)).some(x=>x.emergency)).toBe(true);
});

test('Stable normalized hash excludes ID/time/kind/version, detects all course content; concurrent identical captures deduplicate',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await count(page,1);
 const results=await page.evaluate(async()=>{
  const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});
  const q=OnlineBackup.create({db,build:DataCore.buildCourseBackup,version:'test',readState:async()=>({})});
  const all=await new Promise(r=>{const x=db.transaction('snapshots').objectStore('snapshots').getAll();x.onsuccess=()=>r(x.result)});const b=all.find(x=>x.online).data;
  const same={...b,backupId:crypto.randomUUID(),exportedAt:new Date().toISOString(),appVersion:'future',backupKind:'manual'};
  const outcomes=await Promise.all([q.enqueue(same,'automatic'),q.enqueue({...same,backupId:crypto.randomUUID()},'automatic')]);
  for(const field of ['progress','history','exams','entries','course']){
   const next=structuredClone(b);next.backupId=crypto.randomUUID();
   if(field==='progress')next.progress=[{id:'a',attempts:7,correct:6}];
   if(field==='history')next.history=[{id:'history',courseId:'testkurs',answered:1}];
   if(field==='exams')next.exams=[{id:'exam',courseId:'testkurs',date:'2030-01-01'}];
   if(field==='entries')next.entries[0].meanings=['neu'];
   if(field==='course')next.course.label='Neu';
   outcomes.push(await q.enqueue(next,'automatic'));
  }
  db.close();return outcomes;
 });expect(results).toEqual([false,false,true,true,true,true,true]);
});

test('Local queue never treats R2-uploaded as NAS-confirmed and keeps over 100 pending/ uploaded copies plus emergency',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await count(page,1);
 await page.evaluate(async()=>{
  const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});
  const b=await new Promise(r=>{const q=db.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>r(q.result.find(x=>x.online))});
  await new Promise((r,j)=>{const t=db.transaction('snapshots','readwrite');for(let i=0;i<105;i++)t.objectStore('snapshots').put({...b,id:'retention-'+i,status:i%2?'uploaded':'pendingUpload',createdAt:new Date(2026,0,i+1).toISOString()});t.objectStore('snapshots').put({id:'emergency-test',emergency:true,data:b.data});t.oncomplete=r;t.onabort=()=>j(t.error)});db.close();
 });await page.reload();await count(page,106);expect((await rows(page)).some(x=>x.id==='emergency-test')).toBe(true);
});

test('Upgrade from old version-dependent queue hash does not duplicate unchanged course',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));await count(page,1);const original=await latest(page);
 await page.evaluate(async()=>{
  const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});
  const row=await new Promise(r=>{const q=db.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>r(q.result.find(x=>x.online))});
  row.data.appVersion='4.7.0';const normalized={...row.data};delete normalized.backupId;delete normalized.exportedAt;
  row.contentHash=await OnlineBackup.sha256(new TextEncoder().encode(JSON.stringify(normalized)));delete row.hashVersion;delete row.sequence;
  await new Promise((r,j)=>{const t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').put(row);t.oncomplete=r;t.onabort=()=>j(t.error)});db.close();
 });await page.reload();await page.click('#tabData');await count(page,1);expect((await latest(page)).id).toBe(original.id);
});
