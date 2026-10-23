const {test,expect,course,entry,openApp,importCourse,exportBackup,snapshot,seedProgress,restore}=require('./helpers');
const {pathToFileURL}=require('node:url');const path=require('node:path');
test.use({serviceWorkers:'block'});
async function rows(page,name='snapshots'){return page.evaluate(async name=>{const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});const a=await new Promise(r=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result)});db.close();return a},name)}
async function put(page,name,values){await page.evaluate(async({name,values})=>{const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});await new Promise((r,j)=>{const t=db.transaction(name,'readwrite');for(const v of values)t.objectStore(name).put(v);t.oncomplete=r;t.onabort=()=>j(t.error)});db.close()},{name,values})}
async function harness(page){
 const root=path.resolve(__dirname,'../../fritz-filelink-worker'),{handleBackup}=await import(pathToFileURL(path.join(root,'src/backup.js'))),f=await import(pathToFileURL(path.join(root,'test/backup-fixture.js')));
 const env={VOKABELTRAINER_BACKUPS:f.bucket(),BACKUP_ADMIN_TOKEN:crypto.randomUUID(),BACKUP_SYNC_TOKEN:crypto.randomUUID()},device=await f.pair(handleBackup,env),other=await f.pair(handleBackup,env);
 await page.route('https://fritz-filelink-worker.michael-538.workers.dev/backup/**',async route=>{const q=route.request(),r=await handleBackup(new Request(q.url(),{method:q.method(),headers:{...q.headers(),origin:'https://vonwesternhagen.github.io'},body:q.postDataBuffer()}),env);await route.fulfill({status:r.status,headers:{...Object.fromEntries(r.headers),'access-control-allow-origin':'http://127.0.0.1:8765'},body:Buffer.from(await r.arrayBuffer())})});
 await page.addInitScript(d=>localStorage.setItem('vokabeltrainer.online.v1',JSON.stringify(d)),device);
 return {...f,env,device,other,handleBackup};
}
test('Empty legacy course never captured; shown only in local deletion, daughter device untouched',async({page,browser})=>{
 await openApp(page);await importCourse(page,course([entry('real')],'franzoesisch-6','Französisch 6'));await seedProgress(page,[{id:'real',attempts:8,correct:7}]);
 await put(page,'courses',[{id:'franzoesisch'}]);await page.reload();await expect(page.locator('#appStatus')).toContainText('läuft');
 expect((await rows(page)).filter(r=>r.online&&r.courseId==='franzoesisch')).toHaveLength(0);
 const otherContext=await browser.newContext({serviceWorkers:'block'}),daughter=await otherContext.newPage();
 try{await openApp(daughter);await importCourse(daughter,course([entry('daughter')],'franzoesisch','Französisch 10'));const daughterBefore=await exportBackup(daughter),before=await snapshot(page);
 await expect(page.locator('#activeCourseSelect option[value="franzoesisch"]')).toHaveCount(0);
 await page.click('#tabData');await expect(page.locator('#deleteCourseSelect option[value="franzoesisch"]')).toHaveText('Französisch 10 · 0 Vokabeln');
 await page.selectOption('#deleteCourseSelect','franzoesisch');await page.click('#deleteCourse');await expect(page.locator('#deleteCourseSelect option[value="franzoesisch"]')).toHaveCount(0);
 const after=await snapshot(page);expect(after.courses).toEqual(before.courses.filter(c=>c.id!=='franzoesisch'));for(const n of ['vocab','progress','exams'])expect(after[n]).toEqual(before[n]);expect(await page.locator('#activeCourseSelect').inputValue()).toBe('franzoesisch-6');
 const daughterAfter=await exportBackup(daughter);for(const n of ['courses','entries','progress','history','exams'])expect(daughterAfter[n]).toEqual(daughterBefore[n]);
 expect((await rows(page)).filter(r=>r.online&&r.courseId==='franzoesisch')).toHaveLength(0);
 }finally{await otherContext.close()}
});
test('Delete populated course removes only its data and own pending; uploaded and other owners retained',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')],'a','A'));await importCourse(page,course([entry('b')],'b','B'));await seedProgress(page,[{id:'a',attempts:4},{id:'b',attempts:9}]);
 await put(page,'history',[{id:'ha',courseId:'a'},{id:'hb',courseId:'b'}]);await put(page,'exams',[{id:'ea',courseId:'a',date:'2030-01-01',scopes:[]},{id:'eb',courseId:'b',date:'2030-01-01',scopes:[]}]);
 const pending=(await rows(page)).find(r=>r.online&&r.courseId==='a');await put(page,'snapshots',[{...pending,id:'uploaded-a',status:'uploaded',uploadedAt:new Date().toISOString()},{...pending,id:'other-device-a',ownerDevice:'other-device'},{...pending,id:'nas-a',status:'nas-confirmed'}]);
 const before=await exportBackup(page);await page.click('#tabData');await page.selectOption('#deleteCourseSelect','a');await page.click('#deleteCourse');await expect(page.locator('#deleteCourseSelect option[value="a"]')).toHaveCount(0);
 const after=await exportBackup(page);for(const n of ['courses','entries','history','exams'])expect(after[n]).toEqual(before[n].filter(x=>(n==='courses'?x.id:x.courseId)!=='a'));expect(after.progress).toEqual(before.progress.filter(x=>x.id!=='a'));
 const q=await rows(page);expect(q.some(r=>r.id===pending.id)).toBe(false);for(const id of ['uploaded-a','other-device-a','nas-a'])expect(q.some(r=>r.id===id)).toBe(true);expect(q.some(r=>r.emergency)).toBe(true);
});
test('Deleting course cancellation leaves all persisted stores unchanged',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));const before=await exportBackup(page),q=await rows(page);await page.click('#tabData');page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());await page.click('#deleteCourse');
 const after=await exportBackup(page);for(const n of ['courses','entries','progress','history','exams'])expect(after[n]).toEqual(before[n]);expect(await rows(page)).toEqual(q);
});
test('Local history is collapsed, five then all, no obsolete manual actions; old backup restores',async({page})=>{
 await openApp(page);await importCourse(page,course([entry('a')]));const data=await exportBackup(page);
 await put(page,'snapshots',Array.from({length:7},(_,i)=>({id:'fixture-'+i,courseId:'testkurs',createdAt:new Date(Date.UTC(2030,0,i+1)).toISOString(),label:'Fixture '+i,reason:'before-import',data})));
 await page.click('#tabHome');await page.click('#tabData');await expect(page.locator('#localBackups')).not.toHaveAttribute('open','');await page.locator('#localBackups').evaluate(e=>e.open=true);await expect(page.locator('#snapshotList>div')).toHaveCount(5);await page.click('#moreSnapshots');await expect.poll(()=>page.locator('#snapshotList>div').count()).toBeGreaterThanOrEqual(7);await page.click('#moreSnapshots');await expect(page.locator('#snapshotList>div')).toHaveCount(5);
 await expect(page.locator('#saveCourseBackup,#saveAllCourses,#createLocalBackup,#advancedBackup')).toHaveCount(0);await expect(page.locator('#snapshotList').getByRole('button',{name:'Als Datei sichern'})).toHaveCount(0);
 await page.locator('#snapshotList button').first().click();await expect(page.locator('#backupResult')).toContainText('Backup vollständig wiederhergestellt');
});
test('Server history five/all, profile isolation and authenticated online restore preserve second course',async({page})=>{
 const h=await harness(page);await openApp(page);await importCourse(page,course([entry('keep')],'keep','Keep'));const keep=(await exportBackup(page)).entries;
 for(let i=0;i<7;i++){const b=h.backup({course:{id:'franzoesisch',label:'Jakob '+i},entries:[{id:'a',courseId:'franzoesisch',foreign:'mot',meanings:['Wort'],unitId:'unite-1',part:'auftakt'}],exportedAt:new Date(Date.UTC(2030,0,i+1)).toISOString()});expect((await h.api(h.handleBackup,h.env,'/backup/upload',h.device.deviceToken,b)).status).toBe(200);}
 const daughter=h.backup({course:{id:'franzoesisch',label:'Tochter PRIVAT'},entries:[{id:'a',courseId:'franzoesisch',foreign:'fille',meanings:['Tochter'],unitId:'unite-1',part:'auftakt'}]});await h.api(h.handleBackup,h.env,'/backup/upload',h.other.deviceToken,daughter);
 const keys=[...h.env.VOKABELTRAINER_BACKUPS.objects.keys()].filter(k=>k.startsWith('backups/'));
 await page.click('#tabData');await page.locator('#onlineBackups').evaluate(e=>e.open=true);await expect(page.locator('#onlineList>div')).toHaveCount(5);await expect(page.locator('#onlineList')).not.toContainText('Tochter PRIVAT');await page.click('#moreOnline');await expect(page.locator('#onlineList>div')).toHaveCount(8);
 await page.locator('#onlineList button').first().click();await expect(page.locator('#backupResult')).toContainText('Backup vollständig wiederhergestellt');const after=await exportBackup(page);expect(after.entries.filter(x=>x.courseId==='keep')).toEqual(keep);expect(after.entries.some(x=>x.courseId==='franzoesisch')).toBe(true);
 await page.click('#tabData');await page.selectOption('#deleteCourseSelect','franzoesisch');await page.click('#deleteCourse');await expect(page.locator('#deleteCourseSelect option[value="franzoesisch"]')).toHaveCount(0);
 for(const key of keys)expect(h.env.VOKABELTRAINER_BACKUPS.objects.has(key)).toBe(true);
 expect((await(await h.api(h.handleBackup,h.env,'/backup/history',h.other.deviceToken)).json()).items.map(x=>x.courseName)).toEqual(['Tochter PRIVAT']);
});
test('Legacy empty pending never uploads; deleting during in-flight upload cannot resurrect pending copies',async({page})=>{
 const h=await harness(page);await openApp(page);
 let release,started;const began=new Promise(r=>started=r),gate=new Promise(r=>release=r);let hold=true;
 await page.route('**/backup/upload',async route=>{if(hold){started();await gate;}await route.fallback()});
 await importCourse(page,course([entry('a')],'a','A'));await began;
 const pending=(await rows(page)).find(r=>r.online&&r.courseId==='a');
 await put(page,'snapshots',[{...pending,id:'extra-pending',backupId:crypto.randomUUID(),data:{...pending.data,backupId:crypto.randomUUID()}},{...pending,id:'empty-pending',courseId:'ghost',data:{...pending.data,course:{id:'ghost'},entries:[],progress:[],history:[],exams:[]}}]);
 await put(page,'courses',[{id:'ghost'}]);await page.click('#tabHome');await page.click('#tabData');await page.selectOption('#deleteCourseSelect','a');
 const deleting=page.click('#deleteCourse');await expect(page.locator('#dataView')).toHaveAttribute('aria-busy','true');hold=false;release();await deleting;
 await expect(page.locator('#deleteCourseSelect option[value="a"]')).toHaveCount(0);
 expect((await rows(page)).some(r=>r.id==='extra-pending')).toBe(false);expect((await rows(page)).find(r=>r.id===pending.id).status).toBe('uploaded');
 await page.reload();await page.click('#tabData');
 const history=(await(await h.api(h.handleBackup,h.env,'/backup/history',h.device.deviceToken)).json()).items;
 expect(history).toHaveLength(1);expect(history[0].courseId).toBe('a');expect((await rows(page)).some(r=>r.id==='empty-pending')).toBe(true);
});
