/* Optional device-scoped online copies. Local snapshots remain authoritative. */
(function(root){
'use strict';
const ENDPOINT='https://fritz-filelink-worker.michael-538.workers.dev';
const SETTINGS='vokabeltrainer.online.v1',STORE='snapshots';
const encode=x=>new TextEncoder().encode(x);
async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function canonical(value){
 if(Array.isArray(value)){const a=value.map(canonical);return a.every(x=>x&&typeof x==='object'&&typeof x.id==='string')?a.sort((x,y)=>x.id.localeCompare(y.id)):a;}
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;
}
function create({db,build,readState,version,onChange=()=>{}}){
 let running=null,flushRequested=false,localError=false,queueWork=Promise.resolve(),pausedCourses=new Set();
 function config(){try{const c=JSON.parse(localStorage.getItem(SETTINGS));return c&&typeof c.deviceToken==='string'&&c.deviceId&&c.profileId?c:null;}catch{return null;}}
 function all(){return new Promise((resolve,reject)=>{const q=db.transaction(STORE).objectStore(STORE).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 function write(record){return new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');t.objectStore(STORE).put(record);t.oncomplete=resolve;t.onabort=()=>reject(Error('LOCAL_STORAGE'));});}
 async function call(path,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{return await fetch(ENDPOINT+path,{...options,signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'});}finally{clearTimeout(timer);}
 }
 async function status(){const c=config(),rows=(await all()).filter(x=>x.online);return {configured:!!c,pending:rows.filter(x=>x.status!=='uploaded').length,lastUploaded:rows.filter(x=>x.status==='uploaded').map(x=>x.uploadedAt).sort().at(-1)||null,localError};}
 async function changed(){try{onChange(await status());}catch{onChange({configured:!!config(),pending:0,localError:true});}}
 async function pair(code){
  const response=await call('/backup/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.trim()})});
  if(!response.ok)throw Error('Der Einmalcode ist ungültig, abgelaufen oder die Verbindung ist nicht verfügbar.');
  const c=await response.json();if(!c.deviceToken||!c.deviceId||!c.profileId)throw Error('Einrichtung nicht bestätigt.');
  for(const row of (await all()).filter(x=>x.online&&x.ownerDevice==='unpaired')){row.ownerDevice=c.deviceId;await write(row);}
  localStorage.setItem(SETTINGS,JSON.stringify({deviceToken:c.deviceToken,deviceId:c.deviceId,profileId:c.profileId}));await changed();void flush();
 }
 async function hashContent(backup){
  const normalized={...backup};delete normalized.backupId;delete normalized.exportedAt;delete normalized.backupKind;delete normalized.appVersion;delete normalized.summary;
  return sha256(encode(JSON.stringify(canonical(normalized))));
 }
 function enqueue(backup,kind='manual'){
 const task=queueWork.then(()=>enqueueNow(backup,kind));queueWork=task.catch(()=>{});return task;
 }
 async function enqueueNow(backup,kind){
  if(pausedCourses.has(backup.course.id))return false;
  if(kind==='automatic'&&!backup.entries.length)return false;
  const c=config()||{deviceId:'unpaired'};
  backup={...backup,backupKind:kind};
  const contentHash=await hashContent(backup);
  const previous=(await all()).filter(x=>x.online&&x.courseId===backup.course.id&&x.ownerDevice===c.deviceId).sort((a,b)=>(b.sequence||0)-(a.sequence||0)||b.createdAt.localeCompare(a.createdAt))[0];
  if(kind==='automatic'&&previous&&(previous.hashVersion===2?previous.contentHash:await hashContent(previous.data))===contentHash)return false;
  const sequence=(previous?.sequence||0)+1;
  const serialized=JSON.stringify(backup),bytes=encode(serialized);
  await write({id:'online-'+backup.backupId,backupId:backup.backupId,courseId:backup.course.id,online:true,sequence,hashVersion:2,ownerDevice:c.deviceId,createdAt:backup.exportedAt,
   label:'Online-Sicherung · '+(backup.course.label||backup.course.name||backup.course.id)+' · '+backup.exportedAt,reason:'online-'+kind,emergency:false,
   status:'pendingUpload',retryCount:0,lastAttempt:null,data:backup,serialized,size:bytes.length,sha256:await sha256(bytes),contentHash});
  localError=false;await changed();void flush();return true;
 }
 async function capture(state,kind='automatic',courseIds=state.courses.map(x=>x.id)){
  try{for(const cid of courseIds){if(kind==='automatic'&&!state.entries.some(x=>x.courseId===cid))continue;await enqueue(build(state,cid,version,state.profileName||''),kind);}}catch{localError=true;await changed();}
 }
 // R2 alone prunes NAS-confirmed history. An upload receipt is NOT a NAS receipt.
 async function prune(){}
 function flush(force=false){
  if(running){flushRequested=true;return running;}
  running=(async()=>{
   const c=config();if(!c||navigator.onLine===false)return;
   for(const row of (await all()).filter(x=>x.online&&x.ownerDevice===c.deviceId&&x.status!=='uploaded')){
    if(pausedCourses.has(row.courseId)||row.data.backupKind==='automatic'&&!row.data.entries.length)continue;
    if(!force&&row.lastAttempt&&Date.now()-Date.parse(row.lastAttempt)<60000)continue;
    row.lastAttempt=new Date().toISOString();row.retryCount++;await write(row);
    try{
     const response=await call('/backup/upload',{method:'POST',headers:{Authorization:'Bearer '+c.deviceToken,'Content-Type':'application/json'},body:row.serialized});
     if(!response.ok)throw Error('UPLOAD_PENDING');const result=await response.json();
     if(!result.ok||result.backupId!==row.backupId||result.sha256!==row.sha256||result.size!==row.size)throw Error('UPLOAD_UNCONFIRMED');
     row.status='uploaded';row.uploadedAt=new Date().toISOString();await write(row);
    }catch{break;}
   }
   await prune();
  })().catch(()=>{localError=true;}).finally(async()=>{running=null;await changed();if(flushRequested){flushRequested=false;void flush();}});return running;
 }
 async function withCoursePaused(cid,action){
  pausedCourses.add(cid);
  try{await queueWork;if(running)await running;return await action(config()?.deviceId||'unpaired');}
  finally{pausedCourses.delete(cid);await changed();}
 }
 async function history(){
  const c=config();if(!c)return [];
  const items=[],seen=new Set();let cursor=null;
  do{const r=await call('/backup/history'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+c.deviceToken}});
   if(!r.ok)throw Error('Online-Sicherungen konnten nicht geladen werden.');const data=await r.json();items.push(...data.items);cursor=data.cursor;
   if(cursor&&seen.has(cursor))throw Error('Ungültige Seitennavigation.');if(cursor)seen.add(cursor);
  }while(cursor);
  return items.sort((a,b)=>b.exportedAt.localeCompare(a.exportedAt)||b.backupId.localeCompare(a.backupId));
 }
 async function download(item){
  const c=config();if(!c)throw Error('Online-Sicherung nicht eingerichtet.');
  const r=await call('/backup/restore/'+encodeURIComponent(item.backupId),{headers:{Authorization:'Bearer '+c.deviceToken}});
  if(!r.ok)throw Error('Online-Sicherung konnte nicht geladen werden.');
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==item.size||await sha256(bytes)!==item.sha256)throw Error('Integritätsprüfung der Sicherung fehlgeschlagen.');
  return new File([bytes],'online-backup.json',{type:'application/json'});
 }
 async function backupNow(cid){await capture(await readState(),'manual',[cid]);void flush(true);}
 return {pair,capture,enqueue,flush,status,changed,backupNow,withCoursePaused,history,download,configured:()=>!!config()};
}
root.OnlineBackup={create,sha256,ENDPOINT};
})(globalThis);
