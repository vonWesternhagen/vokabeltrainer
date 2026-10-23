const {test,expect,course,entry,openApp,importCourse,seedProgress,startRound,snapshot}=require('./helpers');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const workerRoot=process.env.BACKUP_WORKER_DIR||path.resolve(__dirname,'../../fritz-filelink-worker');
test.use({serviceWorkers:'block'});
async function setup(page){
 const {handleBackup}=await import(pathToFileURL(path.join(workerRoot,'src/backup.js')));
 const {bucket,api}=await import(pathToFileURL(path.join(workerRoot,'test/backup-fixture.js')));
 const env={VOKABELTRAINER_BACKUPS:bucket(),BACKUP_ADMIN_TOKEN:crypto.randomUUID(),BACKUP_SYNC_TOKEN:crypto.randomUUID()};
 await page.route('https://fritz-filelink-worker.michael-538.workers.dev/backup/**',async route=>{
  const r=route.request(),headers={...r.headers(),origin:'https://vonwesternhagen.github.io'};
  const response=await handleBackup(new Request(r.url(),{method:r.method(),headers,body:r.postDataBuffer()}),env);
  await route.fulfill({status:response.status,headers:{...Object.fromEntries(response.headers),'access-control-allow-origin':'http://127.0.0.1:8765'},body:Buffer.from(await response.arrayBuffer())});
 });
 async function pair(){const r=await api(handleBackup,env,'/backup/admin/pairing',env.BACKUP_ADMIN_TOKEN,{}),code=await r.json();await page.click('#tabData');await page.fill('#pairCode',code.code);await page.click('#pairDevice');await expect(page.locator('#onlineStatus')).toContainText('Automatische Sicherung aktiv.');await expect(page.locator('#pairDevice')).toBeEnabled();await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.status!=='uploaded').length).toBe(0);}
 return {env,pair,handleBackup,api};
}
async function rows(page,name='snapshots'){return page.evaluate(async name=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{return await new Promise((r,j)=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}finally{db.close()}},name)}
async function saveCurrentCourse(page){await page.locator('#advancedBackup').evaluate(e=>e.open=true);await page.fill('#profileName','Testprofil');await page.locator('#profileName').blur();const d=page.waitForEvent('download');await page.click('#saveCourseBackup');await d;}
async function seed(page){await openApp(page);await importCourse(page,course([entry('a',{foreign:'commencer',foreignVariants:['commencer','débuter'],meanings:['anfangen','beginnen']})]));await seedProgress(page,[{id:'a',attempts:5,correct:4}]);}

test('Alle Kurse werden lokal einzeln und online kursweise gesichert',async({page})=>{
 const h=await setup(page);await openApp(page);
 await importCourse(page,course([entry('fr-a')],'fr-6','Französisch 6'));
 await importCourse(page,course([entry('en-a',{foreign:'school',meanings:['Schule']})],'en-6','Englisch 6'));
 await seedProgress(page,[{id:'fr-a',attempts:5,correct:4},{id:'en-a',attempts:9,correct:2}]);
 await h.pair();await page.locator('#advancedBackup').evaluate(e=>e.open=true);await page.fill('#profileName','Jakob');await page.locator('#profileName').blur();
 const downloads=[];page.on('download',d=>downloads.push(d));
 await page.click('#saveAllCourses');
 await expect.poll(()=>downloads.length).toBe(2);
 await expect(page.locator('#backupResult')).toContainText('2 Kurse lokal jeweils als eigene Datei gesichert.');
 const list=await(await h.api(h.handleBackup,h.env,'/backup/list',h.env.BACKUP_SYNC_TOKEN)).json();list.items=list.items.filter(x=>x.kind==='manual');
 expect(list.items).toHaveLength(2);expect(new Set(list.items.map(x=>x.courseName))).toEqual(new Set(['Französisch 6','Englisch 6']));
 expect(new Set(list.items.map(x=>x.courseKey)).size).toBe(2);
 for(const d of downloads){const stream=await d.createReadStream(),chunks=[];for await(const c of stream)chunks.push(c);const bytes=Buffer.concat(chunks),b=JSON.parse(bytes);expect(b.backupType).toBe('course-backup');expect(b.entries).toHaveLength(1);expect(b.progress).toHaveLength(1);expect(b.progress[0].attempts).toBe(b.course.id==='fr-6'?5:9);const item=list.items.find(x=>x.backupId===b.backupId);expect(item).toBeTruthy();const r=await h.api(h.handleBackup,h.env,item.downloadPath,h.env.BACKUP_SYNC_TOKEN);expect(await r.json()).toEqual(b);}

});

for(const sourceVersion of ['4.5.9','4.6.2','4.7.0','4.8.2'])test(sourceVersion+' multi-course raw data and old backups remain compatible; online/NAS/restore roundtrip',async({page})=>{
 test.setTimeout(60000);const h=await setup(page);await page.goto('/manifest.webmanifest');
 const old={courses:[{id:'old',label:'Français 6'},{id:'other',label:'Alt-Modul'}],vocab:[{id:'a',courseId:'old',foreign:'commencer',foreignVariants:['commencer','débuter'],meanings:['anfangen','beginnen'],unitId:'unite-0',part:'auftakt'},{id:'b',courseId:'other',foreign:'ancien',meanings:['alt'],unitId:'module-a',part:'alle'}],progress:[{id:'a',attempts:5,correct:4,deFr:2}],history:[{id:'h',courseId:'old',durationMs:21000,answered:1,completed:true}],exams:[{id:'old-exam',courseId:'old',date:'2030-12-01',scopes:['unite-0|auftakt']}]};
 await page.evaluate(async old=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('VokabeltrainerTest',3);q.onupgradeneeded=()=>{for(const n of ['courses','vocab','progress','history','exams','snapshots'])q.result.createObjectStore(n,{keyPath:'id'})};q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});await new Promise((r,j)=>{const t=db.transaction(Object.keys(old),'readwrite');for(const [n,list]of Object.entries(old))for(const x of list)t.objectStore(n).put(x);t.oncomplete=r;t.onabort=()=>j(t.error)});db.close();localStorage.setItem('vokabeltrainer.activeCourse.v1','old')},old);
 await openApp(page);for(const [n,list]of Object.entries(old))expect(await rows(page,n)).toEqual(list);
 const legacy={backupType:'course-backup',schemaVersion:1,appVersion:sourceVersion,exportedAt:'2026-10-20T12:00:00Z',profileName:'',course:old.courses[0],entries:[old.vocab[0]],progress:old.progress,history:old.history,exams:old.exams};
 await page.click('#tabData');await page.locator('#backupRestoreFile').setInputFiles({name:'legacy-4.5.9.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await expect(page.locator('#backupResult')).toContainText('Backup vollständig wiederhergestellt');
 for(const [n,list]of Object.entries(old))expect(await rows(page,n)).toEqual(list);
 await startRound(page,{count:1});await page.fill('#answer','débuter');await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await page.click('#leaveTrainer');
 await expect.poll(async()=>(await rows(page,'history')).length).toBe(2);const before=await snapshot(page),history=await rows(page,'history');
 await h.pair();await saveCurrentCourse(page);await expect(page.locator('#onlineStatus')).toContainText('Zuletzt online gesichert:');
 expect(await snapshot(page)).toEqual(before);expect(await rows(page,'history')).toEqual(history);
 const list=await(await h.api(h.handleBackup,h.env,'/backup/list',h.env.BACKUP_SYNC_TOKEN)).json();list.items=list.items.filter(x=>x.kind==='manual');expect(list.items).toHaveLength(1);
 const response=await h.api(h.handleBackup,h.env,list.items[0].downloadPath,h.env.BACKUP_SYNC_TOKEN);const bytes=Buffer.from(await response.arrayBuffer());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nas-roundtrip-'));try{
  const input=path.join(dir,'source.json'),target=path.join(dir,'nas');fs.writeFileSync(input,bytes);fs.mkdirSync(target);
  const output=execFileSync(process.env.PWA_PWSH||'/tmp/pwa-pwsh/pwsh',['-NoProfile','-File',path.join(__dirname,'sync-roundtrip.ps1'),'-FixturePath',input,'-TargetRoot',target],{encoding:'utf8',timeout:30000,env:{...process.env,XDG_CACHE_HOME:'/tmp/pwa-pwsh/cache',XDG_CONFIG_HOME:'/tmp/pwa-pwsh/config',XDG_DATA_HOME:'/tmp/pwa-pwsh/data'}});
  const sync=JSON.parse(output);expect(sync.ok).toBe(true);expect(fs.readFileSync(sync.path)).toEqual(bytes);
  await page.click('#tabOverview');await page.locator('#overviewBody button').first().click();await page.fill('#editMeanings','verändert');await page.click('#saveEdit');await expect(page.locator('#editModal')).toBeHidden();
  await page.click('#tabData');await page.locator('#backupRestoreFile').setInputFiles(sync.path);await expect(page.locator('#backupResult')).toContainText('Backup vollständig wiederhergestellt');
  // A previous restore left its success text visible: wait for the new transaction itself.
  for(const n of ['courses','vocab','progress','exams'])await expect.poll(async()=>(await snapshot(page))[n]).toEqual(before[n]);await expect.poll(()=>rows(page,'history')).toEqual(history);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('offline queue survives reload and uploads once connection returns',async({page,context})=>{
 const h=await setup(page);await seed(page);await h.pair();const before=await snapshot(page);await context.setOffline(true);await saveCurrentCourse(page);
 await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.data.backupKind==='manual'&&x.status==='pendingUpload').length).toBe(1);expect(await snapshot(page)).toEqual(before);
 await context.setOffline(false);
 await expect.poll(async()=>(await rows(page)).find(x=>x.online&&x.data.backupKind==='manual')?.status).toBe('uploaded');
 await expect(page.locator('#onlineStatus')).toContainText('Zuletzt online gesichert:');
 await page.reload();await page.click('#tabData');await expect(page.locator('#onlineStatus')).toContainText('Zuletzt online gesichert:');
 expect((await rows(page)).filter(x=>x.online&&x.data.backupKind==='manual')).toHaveLength(1);expect((await rows(page)).find(x=>x.online&&x.data.backupKind==='manual').status).toBe('uploaded');
});
test('R2 failure preserves local backup and learning, retry confirms same immutable bytes',async({page})=>{
 const h=await setup(page);await seed(page);await h.pair();await page.clock.install();h.env.VOKABELTRAINER_BACKUPS.fail='put';const before=await snapshot(page);
 await page.click('#createLocalBackup');await expect(page.locator('#backupResult')).toContainText('Lokales Backup');await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.data.backupKind==='manual'&&x.lastAttempt).length).toBe(1);
 const pending=(await rows(page)).find(x=>x.online&&x.data.backupKind==='manual');expect(pending.status).toBe('pendingUpload');expect(await snapshot(page)).toEqual(before);
 await page.reload();await page.click('#tabData');expect((await rows(page)).find(x=>x.online&&x.data.backupKind==='manual').status).toBe('pendingUpload');
 h.env.VOKABELTRAINER_BACKUPS.fail=null;await page.clock.fastForward(61000);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.locator('#onlineStatus')).toContainText('Zuletzt online gesichert:');
 const saved=(await rows(page)).find(x=>x.online&&x.data.backupKind==='manual');expect(saved.serialized).toBe(pending.serialized);expect(saved.status).toBe('uploaded');expect(saved.retryCount).toBe(2);
});
test('pending online copies survive reset and automatic snapshot retention',async({page,context})=>{
 const h=await setup(page);await seed(page);await h.pair();await context.setOffline(true);await saveCurrentCourse(page);await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.data.backupKind==='manual').length).toBe(1);
 await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');const all=await rows(page);expect(all.some(x=>x.emergency)).toBe(true);expect(all.filter(x=>x.online&&x.data.backupKind==='manual').every(x=>x.data.entries.length===1)).toBe(true);expect(all.some(x=>x.status==='pendingUpload')).toBe(true);
});

test('Automatic offline edit persists before UI completes, survives reload and uploads identical bytes after retry',async({page,context})=>{
 const h=await setup(page);await seed(page);await h.pair();await context.setOffline(true);
 await page.click('#tabOverview');await page.locator('#overviewBody button').first().click();await page.fill('#editMeanings','offline geändert');await page.click('#saveEdit');
 await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.status==='pendingUpload').length).toBe(1);
 const pending=(await rows(page)).find(x=>x.online&&x.status==='pendingUpload');expect(pending.data.entries[0].meanings).toEqual(['offline geändert']);
 h.env.VOKABELTRAINER_BACKUPS.fail='put';
 // Consume the mocked error response in the browser before navigating away.
 // Playwright response.finished() may never settle for Chromium routed responses.
 await page.evaluate(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/backup/upload')&&response.status===503){await response.clone().arrayBuffer();window.failedUploadConsumed=true;}return response;};});
 await context.setOffline(false);
 await expect.poll(()=>page.evaluate(()=>window.failedUploadConsumed===true)).toBe(true);
 await page.reload();await page.click('#tabData');
 expect((await rows(page)).find(x=>x.id===pending.id).serialized).toBe(pending.serialized);
 await page.clock.install();h.env.VOKABELTRAINER_BACKUPS.fail=null;await page.clock.fastForward(61000);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await expect.poll(async()=>(await rows(page)).find(x=>x.id===pending.id).status).toBe('uploaded');
 const list=await(await h.api(h.handleBackup,h.env,'/backup/list',h.env.BACKUP_SYNC_TOKEN)).json(),item=list.items.find(x=>x.backupId===pending.backupId);
 const response=await h.api(h.handleBackup,h.env,item.downloadPath,h.env.BACKUP_SYNC_TOKEN);expect(await response.text()).toBe(pending.serialized);expect(item.sha256).toBe(pending.sha256);
});
