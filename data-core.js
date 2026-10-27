/* Pure, browser-independent vocabulary and backup operations. */
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const key=s=>String(s||'').normalize('NFC').trim().toLocaleLowerCase('fr').replace(/[’‘`´]/g,"'").replace(/\s+/g,' ').replace(/^[.,!?;:\s]+|[.,!?;:\s]+$/g,'');
function variants(value){return (Array.isArray(value)?value:[value]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim());}
function unique(values){const seen=new Set();return values.filter(x=>{const k=key(x);if(seen.has(k))return false;seen.add(k);return true;});}
function french(v){return unique(variants(v.foreignVariants?.length?v.foreignVariants:v.foreign||v.fr));}
function german(v){return unique(variants(v.meanings||v.de||v.meaning));}
function normalize(v){const out=clone(v),fr=french(v),de=german(v);if(!fr.length||!de.length)throw Error('Fremdsprachliche oder deutsche Bedeutung fehlt.');out.foreign=fr[0];out.meanings=de;if(fr.length>1||v.foreignVariants)out.foreignVariants=fr;return out;}
function percentage(p){if(!p?.attempts)return null;return Math.max(0,Math.min(100,Math.round(((p.correct||0)+0.5*(p.almost||0))/p.attempts*100)));}
function summary(entries,progress,history=[],exams=[]){
 const m=new Map(progress.map(p=>[p.id,p]));const out={total:entries.length,new:0,weak:0,middle:0,good:0,sessions:history.length,totalLearningMs:null,lastLearned:null,exams:exams.length};
 for(const v of entries){const p=m.get(v.id),n=percentage(p);out[n===null?'new':n<=32?'weak':n<=66?'middle':'good']++;if(p?.lastPracticedAt&&(!out.lastLearned||p.lastPracticedAt>out.lastLearned))out.lastLearned=p.lastPracticedAt;}
 const known=history.filter(h=>Number.isFinite(h.durationMs));if(known.length)out.totalLearningMs=known.reduce((n,h)=>n+h.durationMs,0);out.sessionsWithUnknownDuration=history.length-known.length;return out;
}
function mergeProgress(records,id){
 if(!records.length)return null;if(records.length===1)return {...clone(records[0]),id};
 const p={...clone(records[0]),id,mergedProgress:clone(records)};
 for(const field of ['attempts','correct','almost','wrong','attemptsDEFR','attemptsFRDE','correctDEFR','correctFRDE','almostDEFR','almostFRDE','wrongDEFR','wrongFRDE'])p[field]=records.reduce((n,r)=>n+(r[field]||0),0);
 for(const field of ['deFr','frDe'])p[field]=Math.min(...records.map(r=>r[field]||0));
 for(const field of ['dueDEFR','dueFRDE','lastPracticedAt']){const dates=records.map(r=>r[field]).filter(Boolean).sort();p[field]=(field==='lastPracticedAt'?dates.at(-1):dates[0])||null;}
 return p;
}
// Indexed union-find: transitive overlaps are processed without all-pairs scans.
function groups(existing,incoming){
 const rows=[...existing.map(v=>({v,old:true})),...incoming.map(v=>({v,old:false}))],parents=rows.map((_,i)=>i),idx=new Map();
 function find(i){while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;}
 rows.forEach(({v},i)=>{for(const token of [...(v.sourceCardId?[]:[...french(v).map(x=>'fr:'+key(x)),...german(v).map(x=>'de:'+key(x))]),...(v.importIdentity?['src:'+v.importIdentity]:v.sourceCardId?['src:'+v.courseId+':'+v.sourceCardId]:[])]){if(idx.has(token))parents[find(i)]=find(idx.get(token));else idx.set(token,i);}});
 const out=new Map();rows.forEach((r,i)=>{const k=find(i);if(!out.has(k))out.set(k,[]);out.get(k).push(r);});
 return [...out.values()].filter(g=>g.some(r=>!r.old)).map(g=>({existing:g.filter(r=>r.old).map(r=>r.v),incoming:g.filter(r=>!r.old).map(r=>r.v)}));
}
function planImport(existing,incoming,progress,strategy='smart',decisions={}){
 const output=new Map(existing.map(v=>[v.id,clone(v)])),ps=new Map(progress.map(p=>[p.id,clone(p)])),used=new Set(existing.map(v=>v.id)),aliases={};
 const gs=strategy==='all'?incoming.map(v=>({existing:[],incoming:[v]})):groups(existing,incoming);
 const counts={new:0,identical:0,expanded:0,review:0,skipped:0};
 function fresh(v){const x=clone(v);while(!x.id||used.has(x.id))x.id='import-'+crypto.randomUUID();used.add(x.id);output.set(x.id,x);counts.new++;}
 gs.forEach((g,i)=>{
  const decision=decisions[i]||{},mode=strategy==='review'?(decision.mode||'merge'):strategy;
  if(g.existing.length)counts.review++;
  if(mode==='skip'){counts.skipped+=g.incoming.length;return;}
  if(mode==='separate'||mode==='all'){g.incoming.forEach(fresh);return;}
  // A manually edited source identity stays authoritative on a repeated import.
  const incoming=g.incoming.filter(v=>!g.existing.some(o=>o.userEdited&&o.importIdentity===v.importIdentity));
  if(!incoming.length){counts.identical+=g.incoming.length;return;}
  const all=[...g.existing,...incoming],fr=unique(all.flatMap(french)),de=unique(all.flatMap(german));
  const survivor=clone(g.existing[0]||incoming[0]);
  const targetFr=decision.fr?unique(variants(decision.fr)):fr,targetDe=decision.de?unique(variants(decision.de)):de;
  if(!targetFr.length||!targetDe.length)throw Error('Mindestens eine Variante pro Sprache behalten.');
  const unchanged=g.existing.length===1&&JSON.stringify(french(g.existing[0]))===JSON.stringify(targetFr)&&JSON.stringify(german(g.existing[0]))===JSON.stringify(targetDe);
  survivor.foreign=targetFr[0];if(targetFr.length>1||survivor.foreignVariants)survivor.foreignVariants=targetFr;survivor.meanings=targetDe;
  const locations=new Map();all.forEach(v=>[v,...(v.locations||[])].forEach(x=>{const location={};for(const k of ['unitId','part','page','unitName','sectionName'])if(x[k]!=null)location[k]=x[k];locations.set(JSON.stringify([x.unitId,x.part,x.page]),location);}));
  const sameLocations=g.existing.length===1&&incoming.every(v=>JSON.stringify([v.unitId,v.part,v.page,v.locations||[]])===JSON.stringify([g.existing[0].unitId,g.existing[0].part,g.existing[0].page,g.existing[0].locations||[]]));
  if(all.length>1&&locations.size>1&&!sameLocations)survivor.locations=[...locations.values()];
  if(unchanged&&JSON.stringify(g.existing[0].locations||[])===JSON.stringify(survivor.locations||[])){counts.identical+=incoming.length;return;}
  if(g.existing.length>1){survivor.mergedSources=all.filter(v=>v!==g.existing[0]).map(clone);const records=g.existing.map(v=>ps.get(v.id)).filter(Boolean);g.existing.forEach(v=>{output.delete(v.id);ps.delete(v.id);aliases[v.id]=survivor.id;});const p=mergeProgress(records,survivor.id);if(p)ps.set(survivor.id,p);}
  if(g.existing.length){output.set(survivor.id,survivor);counts.expanded++;}else fresh(survivor);
 });
 return {entries:[...output.values()],progress:[...ps.values()],groups:gs,counts,aliases};
}
function buildCourseBackup(state,cid,appVersion,profileName=''){
 const course=state.courses.find(c=>c.id===cid);if(!course)throw Error('Kein Kurs ausgewählt.');
 const entries=state.entries.filter(v=>v.courseId===cid),ids=new Set(entries.map(v=>v.id));
 const progress=state.progress.filter(p=>ids.has(p.id)),exams=state.exams.filter(e=>(e.courseId||e.id)===cid),history=(state.history||[]).filter(h=>h.courseId===cid);
 return {backupType:'course-backup',schemaVersion:1,backupId:crypto.randomUUID(),backupKind:'manual',appVersion,exportedAt:new Date().toISOString(),profileName,course:clone(course),entries:clone(entries),progress:clone(progress),exams:clone(exams),history:clone(history),summary:summary(entries,progress,history,exams)};
}
function filename(course,profile,date=new Date().toISOString().slice(0,10)){return [course,profile,date].filter(Boolean).join('_').replace(/[\\/<>:"|?*\x00-\x1f]/g,'').replace(/\.{2,}/g,'.').slice(0,180)+'.json';}
function englishVariants(value){
 const full=String(value||'');const core=full.replace(/\(([^()]*)\)/g,(all,inside)=>/\b(?:sb|sth)\b/i.test(inside)?'':all).trim();
 return unique([full,core,...[full,core].filter(x=>/^to\s+/i.test(x)).map(x=>x.replace(/^to\s+/i,''))]);
}
function formTokens(value){return key(value).replace(/[–—−,\/\-]/g,' ').replace(/\s+/g,' ').trim();}
function englishCompare(v,input){
 const plain=x=>key(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
 if(v.unitId==='irregular-verbs')return french(v).some(x=>formTokens(x)===formTokens(input))?'correct':'wrong';
 const candidates=french(v).flatMap(englishVariants);
 if(candidates.some(x=>plain(x)===plain(input)))return 'correct';
 const article=x=>String(x).trim().replace(/^(a|an|the)\s+/i,'');
 return candidates.some(x=>plain(article(x))===plain(article(input)))?'almost':'wrong';
}
function germanVariants(value){const full=String(value||'');return unique([full,full.replace(/\([^()]*\)/g,' ').replace(/\s+/g,' ').trim()]);}
const api={englishVariants,englishCompare,formTokens,germanVariants,clone,key,variants,unique,french,german,normalize,percentage,summary,mergeProgress,groups,planImport,buildCourseBackup,filename};
if(typeof module==='object'&&module.exports)module.exports=api;else root.DataCore=api;
})(globalThis);
