/* Optional device-scoped online copies. Local snapshots remain authoritative. */
(function(root){
'use strict';
const ENDPOINT='https://fritz-filelink-worker.michael-538.workers.dev';
const SETTINGS='vokabeltrainer.online.v1',STORE='snapshots';
const encode=x=>new TextEncoder().encode(x);
async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function create({db,build,readState,version,onChange=()=>{}}){
 let running=null,localError=false;
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
  localStorage.setItem(SETTINGS,JSON.stringify({deviceToken:c.deviceToken,deviceId:c.deviceId,profileId:c.profileId}));await changed();void flush();
 }
 async function enqueue(backup,kind='manual'){
  const c=config();if(!c)return false;
  backup={...backup,backupKind:kind};
  const normalized={...backup};delete normalized.backupId;delete normalized.exportedAt;
  const contentHash=await sha256(encode(JSON.stringify(normalized)));
  if(kind==='automatic'&&(await all()).some(x=>x.online&&x.ownerDevice===c.deviceId&&x.contentHash===contentHash))return false;
  const serialized=JSON.stringify(backup),bytes=encode(serialized);
  await write({id:'online-'+backup.backupId,backupId:backup.backupId,courseId:backup.course.id,online:true,ownerDevice:c.deviceId,createdAt:backup.exportedAt,
   label:'Online-Sicherung · '+(backup.course.label||backup.course.name||backup.course.id)+' · '+backup.exportedAt,reason:'online-'+kind,emergency:false,
   status:'pendingUpload',retryCount:0,lastAttempt:null,data:backup,serialized,size:bytes.length,sha256:await sha256(bytes),contentHash});
  localError=false;await changed();void flush();return true;
 }
 async function capture(state,kind='automatic',courseIds=state.courses.map(x=>x.id)){
  if(!config())return;
  try{for(const cid of courseIds)await enqueue(build(state,cid,version,state.profileName||''),kind);}catch{localError=true;await changed();}
 }
 async function prune(){
  const rows=(await all()).filter(x=>x.online&&x.status==='uploaded'&&x.data.backupKind==='automatic').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),counts=new Map(),remove=[];
  for(const r of rows){const key=r.ownerDevice+'/'+r.courseId,n=(counts.get(key)||0)+1;counts.set(key,n);if(n>10)remove.push(r.id);}
  if(remove.length)await new Promise((resolve,reject)=>{const t=db.transaction(STORE,'readwrite');for(const id of remove)t.objectStore(STORE).delete(id);t.oncomplete=resolve;t.onabort=()=>reject(Error('LOCAL_STORAGE'));});
 }
 function flush(force=false){
  if(running)return running;
  running=(async()=>{
   const c=config();if(!c||navigator.onLine===false)return;
   for(const row of (await all()).filter(x=>x.online&&x.ownerDevice===c.deviceId&&x.status!=='uploaded')){
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
  })().catch(()=>{localError=true;}).finally(async()=>{running=null;await changed();});return running;
 }
 async function backupNow(cid){await capture(await readState(),'manual',[cid]);void flush(true);}
 return {pair,capture,enqueue,flush,status,changed,backupNow,configured:()=>!!config()};
}
root.OnlineBackup={create,sha256,ENDPOINT};
})(globalThis);
