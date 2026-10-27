// Optional private-file integration test. The input stays outside the repository.
const {test,expect,openApp,importCourse,exportBackup,courseBackupFixture,restore}=require('./helpers');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
if(process.env.ENGLISH_REAL_FILE)test('Private English file imports all 868 cards and survives Worker/Sync/restore roundtrip',async({page})=>{
 test.setTimeout(180000);const input=JSON.parse(fs.readFileSync(process.env.ENGLISH_REAL_FILE,'utf8'));
 expect(input.entries).toHaveLength(868);expect(input.entries.filter(v=>v.unitId==='irregular-verbs')).toHaveLength(72);
 await openApp(page);await importCourse(page,input);await importCourse(page,input);
 const state=await exportBackup(page),b=await courseBackupFixture(page,'englisch-6');expect(b.entries).toHaveLength(868);expect(new Set(b.entries.map(v=>v.id)).size).toBe(868);expect(b.course.learningLocale).toBe('en-GB');
 for(const v of input.entries){const saved=b.entries.find(x=>x.id===v.id);for(const field of ['page','unitName','locations'])expect(saved[field]).toEqual(v[field]);}
 await page.click('#tabLearn');await expect(page.locator('#unitSelect option')).toHaveText(['Alle Vokabeln','Welcome back to Brighton','Unit 1: Holiday stories',"Unit 2: Let's buy something cool",'Unit 3: Helping out','Unit 4: Out of town','Unit 5: Great days, great people','Unregelmäßige Verben']);
 const root=path.resolve(__dirname,'../../fritz-filelink-worker'),{handleBackup}=await import(pathToFileURL(path.join(root,'src/backup.js'))),{bucket,pair,api}=await import(pathToFileURL(path.join(root,'test/backup-fixture.js')));
 const env={VOKABELTRAINER_BACKUPS:bucket(),BACKUP_ADMIN_TOKEN:crypto.randomUUID(),BACKUP_SYNC_TOKEN:crypto.randomUUID()},device=await pair(handleBackup,env);
 const queued=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('VokabeltrainerTest');q.onsuccess=()=>r(q.result)});const a=await new Promise(r=>{const q=db.transaction('snapshots').objectStore('snapshots').getAll();q.onsuccess=()=>r(q.result)});db.close();return a.filter(x=>x.online&&x.courseId==='englisch-6')});expect(queued).toHaveLength(1);expect(queued[0].data.entries).toEqual(b.entries);
 expect((await api(handleBackup,env,'/backup/upload',device.deviceToken,queued[0].serialized)).status).toBe(200);
 const list=(await(await api(handleBackup,env,'/backup/list',env.BACKUP_SYNC_TOKEN)).json()).items;expect(list).toHaveLength(1);const bytes=Buffer.from(await(await api(handleBackup,env,list[0].downloadPath,env.BACKUP_SYNC_TOKEN)).arrayBuffer());
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-english-'));
 try{const source=path.join(dir,'source.json'),target=path.join(dir,'nas');fs.writeFileSync(source,bytes);fs.mkdirSync(target);const result=JSON.parse(execFileSync('/tmp/pwa-pwsh/pwsh',['-NoProfile','-File',path.join(__dirname,'sync-roundtrip.ps1'),'-FixturePath',source,'-TargetRoot',target],{encoding:'utf8',timeout:30000,env:{...process.env,XDG_CACHE_HOME:'/tmp/pwa-pwsh/cache',XDG_CONFIG_HOME:'/tmp/pwa-pwsh/config',XDG_DATA_HOME:'/tmp/pwa-pwsh/data'}}));expect(result.ok).toBe(true);expect(fs.readFileSync(result.path)).toEqual(bytes);
  await page.click('#tabData');await page.click('#reset');await expect(page.locator('#homeTotal')).toHaveText('0');await restore(page,JSON.parse(fs.readFileSync(result.path,'utf8')));const after=await exportBackup(page);expect(after.entries).toEqual(state.entries);expect(after.courses).toEqual(state.courses);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
