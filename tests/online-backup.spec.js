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
 async function pair(){const r=await api(handleBackup,env,'/backup/admin/pairing',env.BACKUP_ADMIN_TOKEN,{}),code=await r.json();await page.click('#tabData');await page.fill('#pairCode',code.code);await page.click('#pairDevice');await expect(page.locator('#onlineStatus')).toContainText('Online-Sicherung eingerichtet.');}
 return {env,pair,handleBackup,api};
}
async function rows(page,name='snapshots'){return page.evaluate(async name=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});try{return await new Promise((r,j)=>{const q=db.transaction(name).objectStore(name).getAll();q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}finally{db.close()}},name)}
async function saveCurrentCourse(page){await page.fill('#profileName','Testprofil');await page.locator('#profileName').blur();const d=page.waitForEvent('download');await page.click('#saveCourseBackup');await d;}
async function seed(page){await openApp(page);await importCourse(page,course([entry('a',{foreign:'commencer',foreignVariants:['commencer','débuter'],meanings:['anfangen','beginnen']})]));await seedProgress(page,[{id:'a',attempts:5,correct:4}]);}

test('Alle Kurse werden lokal einzeln und online kursweise gesichert',async({page})=>{
 const h=await setup(page);await openApp(page);
 await importCourse(page,course([entry('fr-a')],'fr-6','Französisch 6'));
 await importCourse(page,course([entry('en-a',{foreign:'school',meanings:['Schule']})],'en-6','Englisch 6'));
 await h.pair();await page.fill('#profileName','Jakob');await page.locator('#profileName').blur();
 const downloads=[];page.on('download',d=>downloads.push(d));
 await page.click('#saveAllCourses');
 await expect.poll(()=>downloads.length).toBe(2);
 await expect(page.locator('#backupResult')).toContainText('2 Kurse lokal jeweils als eigene Datei gesichert.');
 const list=await(await h.api(h.handleBackup,h.env,'/backup/list',h.env.BACKUP_SYNC_TOKEN)).json();
 expect(list.items).toHaveLength(2);expect(new Set(list.items.map(x=>x.courseName))).toEqual(new Set(['Französisch 6','Englisch 6']));
});

test('4.5.9 multi-course raw data and old backups remain compatible; online/NAS/restore roundtrip',async({page})=>{
 test.setTimeout(60000);const h=await setup(page);await page.goto('/manifest.webmanifest');
 const old={courses:[{id:'old',label:'Français 6'},{id:'other',label:'Alt-Modul'}],vocab:[{id:'a',courseId:'old',foreign:'commencer',foreignVariants:['commencer','débuter'],meanings:['anfangen','beginnen'],unitId:'unite-0',part:'auftakt'},{id:'b',courseId:'other',foreign:'ancien',meanings:['alt'],unitId:'module-a',part:'alle'}],progress:[{id:'a',attempts:5,correct:4,deFr:2}],history:[{id:'h',courseId:'old',durationMs:21000,answered:1,completed:true}],exams:[{id:'old-exam',courseId:'old',date:'2030-12-01',scopes:['unite-0|auftakt']}]};
 await page.evaluate(async old=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('VokabeltrainerTest',3);q.onupgradeneeded=()=>{for(const n of ['courses','vocab','progress','history','exams','snapshots'])q.result.createObjectStore(n,{keyPath:'id'})};q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});await new Promise((r,j)=>{const t=db.transaction(Object.keys(old),'readwrite');for(const [n,list]of Object.entries(old))for(const x of list)t.objectStore(n).put(x);t.oncomplete=r;t.onabort=()=>j(t.error)});db.close();localStorage.setItem('vokabeltrainer.activeCourse.v1','old')},old);
 await openApp(page);for(const [n,list]of Object.entries(old))expect(await rows(page,n)).toEqual(list);
 const legacy={backupType:'course-backup',schemaVersion:1,appVersion:'4.5.9',exportedAt:'2026-10-20T12:00:00Z',profileName:'',course:old.courses[0],entries:[old.vocab[0]],progress:old.progress,history:old.history,exams:old.exams};
 await page.click('#tabData');await page.locator('#backupRestoreFile').setInputFiles({name:'legacy-4.5.9.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});await expect(page.locator('#backupResult')).toContainText('Backup vollständig wiederhergestellt');
 for(const [n,list]of Object.entries(old))expect(await rows(page,n)).toEqual(list);
 await startRound(page,{count:1});await page.fill('#answer','débuter');await page.click('#check');await expect(page.locator('#feedback')).toContainText('Richtig');await page.click('#leaveTrainer');
 await expect.poll(async()=>(await rows(page,'history')).length).toBe(2);const before=await snapshot(page),history=await rows(page,'history');
 await h.pair();await saveCurrentCourse(page);await expect(page.locator('#onlineStatus')).toContainText('Zuletzt gesichert:');
 expect(await snapshot(page)).toEqual(before);expect(await rows(page,'history')).toEqual(history);
 const list=await(await h.api(h.handleBackup,h.env,'/backup/list',h.env.BACKUP_SYNC_TOKEN)).json();expect(list.items).toHaveLength(1);
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
 await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.status==='pendingUpload').length).toBe(1);expect(await snapshot(page)).toEqual(before);
 await context.setOffline(false);await expect(page.locator('#onlineStatus')).toContainText('Zuletzt gesichert:');
 await page.reload();await page.click('#tabData');await expect(page.locator('#onlineStatus')).toContainText('Zuletzt gesichert:');
 expect((await rows(page)).filter(x=>x.online)).toHaveLength(1);expect((await rows(page)).find(x=>x.online).status).toBe('uploaded');
});
test('R2 failure preserves local backup and learning, retry confirms same immutable bytes',async({page})=>{
 const h=await setup(page);await seed(page);await h.pair();await page.clock.install();h.env.VOKABELTRAINER_BACKUPS.fail='put';const before=await snapshot(page);
 await page.click('#createLocalBackup');await expect(page.locator('#backupResult')).toContainText('Lokales Backup');await expect.poll(async()=>(await rows(page)).filter(x=>x.online&&x.lastAttempt).length).toBe(1);
 const pending=(await rows(page)).find(x=>x.online);expect(pending.status).toBe('pendingUpload');expect(await snapshot(page)).toEqual(before);
 await page.reload();await page.click('#tabData');expect((await rows(page)).find(x=>x.online).status).toBe('pendingUpload');
 h.env.VOKABELTRAINER_BACKUPS.fail=null;await page.clock.fastForward(61000);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(page.locator('#onlineStatus')).toContainText('Zuletzt gesichert:');
 const saved=(await rows(page)).find(x=>x.online);expect(saved.serialized).toBe(pending.serialized);expect(saved.status).toBe('uploaded');expect(saved.retryCount).toBe(2);
});
test('pending online copies survive reset and automatic snapshot retention',async({page,context})=>{
 const h=await setup(page);await seed(page);await h.pair();await context.setOffline(true);await saveCurrentCourse(page);await expect.poll(async()=>(await rows(page)).filter(x=>x.online).length).toBe(1);
 await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');const all=await rows(page);expect(all.some(x=>x.emergency)).toBe(true);expect(all.filter(x=>x.online).every(x=>x.data.entries.length===1)).toBe(true);expect(all.some(x=>x.status==='pendingUpload')).toBe(true);
});
