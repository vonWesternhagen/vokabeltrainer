
(function(){
"use strict";

var DB_NAME="VokabeltrainerTest";
var DB_VERSION=2;
var S_VOCAB="vocab", S_PROGRESS="progress", S_COURSES="courses", S_EXAMS="exams";
var db=null, vocab=[], courses=[];
var session={
  active:false, pool:[], firstQueue:[], seen:{}, current:null, currentDirection:"DE_FR",
  attempts:0, correct:0, testResults:[], lastId:null
};
var autoTimer=null;

var seedCourse={id:"franzoesisch",name:"Französisch",learningLocale:"fr-FR",nativeLocale:"de-DE"};
var seed=[
{id:"le-projet",courseId:"franzoesisch",unitId:"unite-1-auftakt",foreign:"le projet",meanings:["der Plan","das Vorhaben","das Projekt"]},
{id:"le-metier",courseId:"franzoesisch",unitId:"unite-1-auftakt",foreign:"le métier",meanings:["der Beruf"]},
{id:"le-domaine",courseId:"franzoesisch",unitId:"unite-1-auftakt",foreign:"le domaine",meanings:["das Gebiet","der Bereich"]}
];

function $(id){return document.getElementById(id)}
function reqP(req){return new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)})}
function os(name,mode){return db.transaction(name,mode||"readonly").objectStore(name)}
function openDb(){
 return new Promise((res,rej)=>{
  var r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=e=>{
    var d=e.target.result;
    if(!d.objectStoreNames.contains(S_VOCAB))d.createObjectStore(S_VOCAB,{keyPath:"id"});
    if(!d.objectStoreNames.contains(S_PROGRESS))d.createObjectStore(S_PROGRESS,{keyPath:"id"});
    if(!d.objectStoreNames.contains(S_COURSES))d.createObjectStore(S_COURSES,{keyPath:"id"});
    if(!d.objectStoreNames.contains(S_EXAMS))d.createObjectStore(S_EXAMS,{keyPath:"id"});
  };
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)
 })
}
async function seedIfNeeded(){
 if((await reqP(os(S_COURSES).count()))===0) await reqP(os(S_COURSES,"readwrite").put(seedCourse));
 if((await reqP(os(S_VOCAB).count()))===0){
   var tx=db.transaction(S_VOCAB,"readwrite"),s=tx.objectStore(S_VOCAB);seed.forEach(v=>s.put(v));
   await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})
 }
}
async function reload(){
 vocab=await reqP(os(S_VOCAB).getAll());
 courses=await reqP(os(S_COURSES).getAll());

 // Selbstheilung für ältere/importierte Teststände:
 // unit-/module-artige courseIds gehören beim vorliegenden Französischbestand zum Kurs "franzoesisch".
 var changed=false;
 var tx=db.transaction(S_VOCAB,"readwrite"), vs=tx.objectStore(S_VOCAB);
 vocab.forEach(function(v){
   if(!v.courseId || /^unite-\d/.test(v.courseId) || /^module-[a-d]$/.test(v.courseId)){
     v.courseId="franzoesisch";
     vs.put(v); changed=true;
   }
 });
 if(changed){
   await new Promise(function(resolve,reject){tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)}});
   vocab=await reqP(os(S_VOCAB).getAll());
 }

 // Kursliste aus real verwendeten courseIds absichern. Falsche Alt-Einträge (Unité/Module) nicht anzeigen.
 var used=[...new Set(vocab.map(function(v){return v.courseId}).filter(Boolean))];
 var validCourses=courses.filter(function(c){return c && c.id && !/^unite-\d/.test(c.id) && !/^module-[a-d]$/.test(c.id)});
 if(used.indexOf("franzoesisch")>=0 && !validCourses.some(function(c){return c.id==="franzoesisch"})){
   var fr={id:"franzoesisch",name:"Französisch",learningLocale:"fr-FR",nativeLocale:"de-DE"};
   await reqP(os(S_COURSES,"readwrite").put(fr)); validCourses.push(fr);
 }
 // Für unbekannte, aber tatsächlich verwendete courseIds einen Kurs erzeugen.
 for(var i=0;i<used.length;i++){
   var cid=used[i];
   if(!validCourses.some(function(c){return c.id===cid})){
     var nc={id:cid,name:cid,learningLocale:"fr-FR",nativeLocale:"de-DE"};
     await reqP(os(S_COURSES,"readwrite").put(nc)); validCourses.push(nc);
   }
 }
 courses=validCourses;
 vocab.sort(function(a,b){return (a.unitId||"").localeCompare(b.unitId||"")||a.id.localeCompare(b.id)});
}
function pDefault(id){return{id:id,deFr:0,frDe:0,attempts:0,correct:0,almost:0,wrong:0,attemptsDEFR:0,attemptsFRDE:0,lastPracticedAt:null,dueDEFR:null,dueFRDE:null}}
async function gp(id){var p=await reqP(os(S_PROGRESS).get(id));return Object.assign(pDefault(id),p||{})}
async function sp(p){await reqP(os(S_PROGRESS,"readwrite").put(p))}
function norm(s){return String(s||"").trim().toLowerCase().replace(/[’‘`´]/g,"'").replace(/\s+/g," ")}
function stripAcc(s){try{return norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"")}catch(e){return norm(s)}}
function germanAccepted(item,g){g=norm(g);var gn=g.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"");return item.meanings.some(m=>{var x=norm(m),xn=x.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"");return g===x||gn===xn})}
function unitGroup(unitId){
 if(/^unite-1/.test(unitId))return"unite-1";
 if(/^unite-2/.test(unitId))return"unite-2";
 if(/^unite-3/.test(unitId))return"unite-3";
 if(/^module-/.test(unitId))return unitId;
 return unitId||"ohne";
}
function partGroup(unitId){
 if(/auftakt/.test(unitId))return"auftakt";
 if(/vocabulaire-thematique/.test(unitId))return"vocabulaire-thematique";
 if(/volet-1/.test(unitId))return"volet-1";
 if(/volet-2/.test(unitId))return"volet-2";
 if(/^module-/.test(unitId))return"alle";
 return"sonstiges";
}
function unitLabel(x){return({"unite-1":"Unité 1","unite-2":"Unité 2","unite-3":"Unité 3","module-a":"Module A","module-b":"Module B","module-c":"Module C","module-d":"Module D","alle":"Alle"})[x]||x}
function partLabel(x){return({"alle":"Alle","auftakt":"Auftaktseite","vocabulaire-thematique":"Vocabulaire thématique","volet-1":"Volet 1","volet-2":"Volet 2","sonstiges":"Sonstiges"})[x]||x}
function fillSelect(sel,items,allLabel){
 var old=sel.value;sel.innerHTML="";
 if(allLabel!==null){var o=document.createElement("option");o.value="alle";o.textContent=allLabel||"Alle";sel.appendChild(o)}
 items.forEach(it=>{var o=document.createElement("option");o.value=it.value;o.textContent=it.label;sel.appendChild(o)});
 if([...sel.options].some(o=>o.value===old))sel.value=old
}
function courseName(id){var c=courses.find(x=>x.id===id);return c?c.name:id}
function populateCourseSelects(){
 ["courseSelect","examCourse","overviewCourse","vocabCourse"].forEach(id=>fillSelect($(id),courses.map(c=>({value:c.id,label:c.name})),id==="overviewCourse"||id==="vocabCourse"?"Alle":null))
}
function unitsForCourse(courseId){
 var order={"unite-1":1,"unite-2":2,"unite-3":3,"module-a":10,"module-b":11,"module-c":12,"module-d":13};
 return [...new Set(vocab.filter(v=>courseId==="alle"||v.courseId===courseId).map(v=>unitGroup(v.unitId)))].sort(function(a,b){return (order[a]||99)-(order[b]||99)||a.localeCompare(b)})
}
function populateUnit(sel,courseId,includeAll){
 fillSelect(sel,unitsForCourse(courseId).map(x=>({value:x,label:unitLabel(x)})),includeAll?"Alle":null)
}
function partsFor(courseId,unit){
 if(/^module-[a-d]$/.test(unit)) return [];
 return [...new Set(vocab.filter(v=>(courseId==="alle"||v.courseId===courseId)&&(unit==="alle"||unitGroup(v.unitId)===unit)).map(v=>partGroup(v.unitId)))].filter(x=>x!=="alle").sort()
}
function populatePart(sel,courseId,unit,includeAll){
 var parts=partsFor(courseId,unit);
 fillSelect(sel,parts.map(x=>({value:x,label:partLabel(x)})),includeAll?"Alle":null);
 if(/^module-[a-d]$/.test(unit)){
   sel.innerHTML="";
   var o=document.createElement("option");o.value="alle";o.textContent="gesamtes Modul";sel.appendChild(o);
   sel.disabled=true;
 }else{
   sel.disabled=false;
 }
}
function filtered(courseId,unit,part){
 return vocab.filter(v=>(courseId==="alle"||v.courseId===courseId)&&(unit==="alle"||unitGroup(v.unitId)===unit)&&(part==="alle"||partGroup(v.unitId)===part))
}
async function weakScore(v,dir){
 var p=await gp(v.id), lvl=dir==="FR_DE"?p.frDe:dir==="DE_FR"?p.deFr:Math.min(p.deFr,p.frDe);
 var fail=(p.wrong+p.almost), rate=p.attempts? p.correct/p.attempts : 0;
 return lvl*100 + rate*20 - fail*3 + Math.min(p.attempts,10)
}
async function orderPool(arr,mode,dir){
 var a=arr.slice();
 if(mode==="reverse")return a.reverse();
 if(mode==="random")return a.sort(()=>Math.random()-.5);
 if(mode==="weakest"){
   var scored=[];for(var v of a)scored.push([v,await weakScore(v,dir)]);
   scored.sort((x,y)=>x[1]-y[1]);return scored.map(x=>x[0])
 }
 return a
}
function currentScopeText(){
 var c=courseName($("courseSelect").value),u=unitLabel($("unitSelect").value),p=partLabel($("partSelect").value);
 return c+" · "+u+" · "+p
}
async function startSession(){
 var pool=filtered($("courseSelect").value,$("unitSelect").value,$("partSelect").value);
 if(!pool.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine Vokabeln.";return}
 session={active:true,pool:pool,firstQueue:await orderPool(pool,$("orderSelect").value,$("directionSelect").value),seen:{},current:null,currentDirection:"DE_FR",attempts:0,correct:0,testResults:[],lastId:null};
 $("scopeInfo").textContent=currentScopeText()+" · "+pool.length+" Vokabeln. Jede wird in dieser Session mindestens einmal abgefragt.";
 await chooseNext(true)
}
function chooseDirection(){
 var d=$("directionSelect").value;
 if(d==="MIXED")return Math.random()<.5?"DE_FR":"FR_DE";
 return d
}
async function chooseNext(initial){
 if(!session.active)return;
 var v=null;
 while(session.firstQueue.length){
   var candidate=session.firstQueue.shift();
   if(!session.seen[candidate.id]){v=candidate;break}
 }
 if(!v){
   if($("sessionTypeSelect").value==="test"){
      finishTest();return
   }
   if($("adaptiveAfterFirst").checked){
     var scored=[];for(var x of session.pool){
       if(x.id===session.lastId&&session.pool.length>1)continue;
       scored.push([x,await weakScore(x,$("directionSelect").value)])
     }
     scored.sort((a,b)=>a[1]-b[1]);
     var band=scored.slice(0,Math.min(5,scored.length));
     v=band[Math.floor(Math.random()*band.length)][0]
   }else{
     var ord=await orderPool(session.pool,$("orderSelect").value,$("directionSelect").value);
     v=ord.find(x=>x.id!==session.lastId)||ord[0]
   }
 }
 session.current=v;session.currentDirection=chooseDirection();session.lastId=v.id;
 await renderCurrent()
}
async function renderCurrent(){
 var v=session.current;if(!v)return;
 var p=await gp(v.id),d=session.currentDirection;
 $("prompt").textContent=d==="DE_FR"?v.meanings.join(" / "):v.foreign;
 $("directionLabel").textContent=d==="DE_FR"?"Deutsch → "+courseName(v.courseId):courseName(v.courseId)+" → Deutsch";
 $("languageHint").textContent=d==="DE_FR"?"Fremdsprache schreiben – Scribble/Diktat entsprechend einstellen.":"Deutsch schreiben – Scribble/Diktat auf Deutsch.";
 $("answer").lang=d==="DE_FR"?(courses.find(c=>c.id===v.courseId)||seedCourse).learningLocale:"de";
 $("answer").value="";
 $("feedback").className="feedback";$("feedback").textContent="Noch keine Antwort geprüft.";
 $("currentLevel").textContent="Lernstufe "+(d==="DE_FR"?p.deFr:p.frDe);
 updateSessionBadges();keepFocus()
}
function updateSessionBadges(){
 var seenCount=Object.keys(session.seen).length;
 $("sessionCoverage").textContent=seenCount+" / "+session.pool.length+" einmal gesehen";
 $("sessionScore").textContent="Session: "+session.correct+" richtig / "+session.attempts
}
function keepFocus(){setTimeout(()=>{try{$("answer").focus({preventScroll:true})}catch(e){$("answer").focus()}},30)}
function nextDue(level){
 var days=[0,1,2,4,7,14][Math.max(0,Math.min(5,level))],d=new Date();d.setDate(d.getDate()+days);return d.toISOString()
}
async function checkAnswer(){
 if(!session.active||!session.current)return;
 var v=session.current,d=session.currentDirection,g=norm($("answer").value),fb=$("feedback");if(!g){fb.className="feedback almost";fb.textContent="Bitte zuerst antworten.";keepFocus();return}
 var p=await gp(v.id),kind="wrong",expected=d==="DE_FR"?v.foreign:v.meanings.join(" / ");
 if(d==="DE_FR"){var w=norm(v.foreign);if(g===w)kind="correct";else if(stripAcc(g)===stripAcc(w))kind="almost"}
 else if(germanAccepted(v,g))kind="correct";
 p.attempts++;p.lastPracticedAt=new Date().toISOString();if(d==="DE_FR")p.attemptsDEFR++;else p.attemptsFRDE++;
 if(kind==="correct"){
   p.correct++;if(d==="DE_FR"){p.deFr=Math.min(5,p.deFr+1);p.dueDEFR=nextDue(p.deFr)}else{p.frDe=Math.min(5,p.frDe+1);p.dueFRDE=nextDue(p.frDe)}
   fb.className="feedback good";fb.innerHTML="✓ Richtig: <strong>"+expected+"</strong>";session.correct++;
 }else if(kind==="almost"){
   p.almost++;fb.className="feedback almost";fb.innerHTML="Fast richtig – Akzent/Sonderzeichen prüfen.<br>Richtig: <strong>"+expected+"</strong>"
 }else{
   p.wrong++;if(d==="DE_FR"){p.deFr=Math.max(0,p.deFr-1);p.dueDEFR=nextDue(0)}else{p.frDe=Math.max(0,p.frDe-1);p.dueFRDE=nextDue(0)}
   fb.className="feedback bad";fb.innerHTML="✗ Noch nicht richtig.<br>Richtig: <strong>"+expected+"</strong>"
 }
 await sp(p);session.attempts++;session.seen[v.id]=true;session.testResults.push({id:v.id,kind:kind});
 updateSessionBadges();$("currentLevel").textContent="Lernstufe "+(d==="DE_FR"?p.deFr:p.frDe);keepFocus();
 if(kind==="correct"&&$("autoNext").checked){clearTimeout(autoTimer);autoTimer=setTimeout(()=>chooseNext(false),750)}
}
function showAnswer(){if(!session.current)return;var v=session.current,d=session.currentDirection;$("feedback").className="feedback almost";$("feedback").innerHTML="Antwort: <strong>"+(d==="DE_FR"?v.foreign:v.meanings.join(" / "))+"</strong>";keepFocus()}
function finishTest(){
 var total=session.testResults.length,ok=session.testResults.filter(x=>x.kind==="correct").length;
 $("feedback").className="feedback";$("feedback").innerHTML="<strong>Test beendet:</strong> "+ok+" von "+total+" richtig ("+(total?Math.round(ok/total*100):0)+" %).";
 session.active=false;$("prompt").textContent="Test abgeschlossen";$("answer").value=""
}
function showView(name){
 ["learn","plan","overview","vocab","data"].forEach(x=>{$(x+"View").hidden=x!==name;$("tab"+x[0].toUpperCase()+x.slice(1)).classList.toggle("active",x===name)});
 if(name==="overview")renderOverview();if(name==="vocab")renderVocab();if(name==="plan")renderExamSummary()
}
function fmtDate(iso){if(!iso)return"–";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"}).format(new Date(iso))}catch(e){return"–"}}
async function renderOverview(){
 var list=filtered($("overviewCourse").value,$("overviewUnit").value,$("overviewPart").value),body=$("overviewBody");body.innerHTML="";
 var t={attempts:0,correct:0,bad:0};
 for(var v of list){var p=await gp(v.id);t.attempts+=p.attempts;t.correct+=p.correct;t.bad+=p.almost+p.wrong;
  var tr=document.createElement("tr"),cells=[unitLabel(unitGroup(v.unitId))+" · "+partLabel(partGroup(v.unitId)),v.foreign+" — "+v.meanings.join(" / "),"Stufe "+p.deFr+" ("+p.attemptsDEFR+"×)","Stufe "+p.frDe+" ("+p.attemptsFRDE+"×)",p.attempts,p.correct,p.almost,p.wrong,fmtDate(p.dueDEFR)];
  cells.forEach((c,i)=>{var td=document.createElement("td");td.textContent=c;if(i===2||i===3)td.className="level-pill";tr.appendChild(td)});body.appendChild(tr)
 }
 $("sumEntries").textContent=list.length;$("sumAttempts").textContent=t.attempts;$("sumCorrect").textContent=t.correct;$("sumWrong").textContent=t.bad
}
async function renderVocab(){
 var list=filtered($("vocabCourse").value,$("vocabUnit").value,$("vocabPart").value),q=norm($("vocabSearch").value),box=$("vocabList");box.innerHTML="";
 list.filter(v=>!q||norm(v.foreign+" "+v.meanings.join(" ")).includes(q)).slice(0,500).forEach(v=>{
  var d=document.createElement("div");d.className="vocab-item";d.innerHTML="<div><strong>"+escapeHtml(v.foreign)+"</strong><div>"+escapeHtml(v.meanings.join(" / "))+"</div><div class='muted'>"+escapeHtml(unitLabel(unitGroup(v.unitId))+" · "+partLabel(partGroup(v.unitId)))+"</div></div>";
  var b=document.createElement("button");b.className="secondary";b.textContent="Bearbeiten";b.onclick=()=>editVocab(v);d.appendChild(b);box.appendChild(d)
 })
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function editVocab(v){$("editCard").hidden=false;$("editId").value=v.id;$("editForeign").value=v.foreign;$("editMeanings").value=v.meanings.join("; ");$("editForeign").focus()}
async function saveEdit(){var id=$("editId").value,v=vocab.find(x=>x.id===id);if(!v)return;v.foreign=$("editForeign").value.trim();v.meanings=$("editMeanings").value.split(";").map(x=>x.trim()).filter(Boolean);await reqP(os(S_VOCAB,"readwrite").put(v));await reload();$("editCard").hidden=true;renderVocab()}
async function importJson(file){
 var data=JSON.parse(await file.text());if(!Array.isArray(data.entries))throw new Error("Kein entries-Array gefunden.");
 var c=data.course||{id:"import",name:"Import"};await reqP(os(S_COURSES,"readwrite").put({id:c.id||"import",name:c.name||c.id||"Import",learningLocale:c.learningLocale||"fr-FR",nativeLocale:c.nativeLocale||"de-DE"}));
 var tx=db.transaction(S_VOCAB,"readwrite"),s=tx.objectStore(S_VOCAB),count=0;
 data.entries.forEach(e=>{if(!e.id||!e.foreign||!Array.isArray(e.meanings)||!e.meanings.length)return;s.put({id:String(e.id),courseId:e.courseId||c.id||"import",unitId:e.unitId||data.unit?.id||"import",foreign:String(e.foreign),meanings:e.meanings.map(String)});count++});
 await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});await reload();populateAllSelectors();$("importResult").textContent=count+" Vokabeln importiert/aktualisiert."
}
async function downloadJson(data,name){var blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function exportBackup(){
 var entries=await reqP(os(S_VOCAB).getAll()),progress=await reqP(os(S_PROGRESS).getAll()),exams=await reqP(os(S_EXAMS).getAll()),cs=await reqP(os(S_COURSES).getAll());
 downloadJson({schemaVersion:3,exportedAt:new Date().toISOString(),courses:cs,entries:entries,progress:progress,exams:exams},"vokabeltrainer-backup.json")
}
async function exportCurrentCourse(){
 var cid=$("courseSelect").value,c=courses.find(x=>x.id===cid),entries=vocab.filter(v=>v.courseId===cid),progress=(await reqP(os(S_PROGRESS).getAll())).filter(p=>entries.some(v=>v.id===p.id));
 downloadJson({schemaVersion:3,course:c,entries:entries,progress:progress},"vokabeltrainer-"+cid+".json")
}
async function resetAll(){
 if(!confirm("Alle lokalen Daten löschen und nur die drei Testvokabeln wiederherstellen?"))return;
 for(var s of [S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS])await reqP(os(s,"readwrite").clear());await seedIfNeeded();await reload();populateAllSelectors();await startSession()
}
async function saveExam(){
 var c=$("examCourse").value,u=$("examUnit").value,p=$("examPart").value,date=$("examDate").value;if(!date)return alert("Bitte Datum wählen.");
 await reqP(os(S_EXAMS,"readwrite").put({id:c,courseId:c,date:date,unit:u,part:p}));renderExamSummary()
}
async function deleteExam(){await reqP(os(S_EXAMS,"readwrite").delete($("examCourse").value));renderExamSummary()}
async function renderExamSummary(){
 var c=$("examCourse").value,e=await reqP(os(S_EXAMS).get(c)),box=$("examSummary");if(!e){box.innerHTML="Für diesen Kurs ist noch keine Klassenarbeit gespeichert.";return}
 $("examDate").value=e.date;$("examUnit").value=e.unit;populatePart($("examPart"),c,e.unit,true);$("examPart").value=e.part;
 var pool=filtered(c,e.unit,e.part),days=Math.max(0,Math.ceil((new Date(e.date+"T12:00:00")-new Date())/86400000)),newCount=0,weak=0,due=0;
 for(var v of pool){var p=await gp(v.id);if(p.attempts===0)newCount++;if(Math.min(p.deFr,p.frDe)<=1)weak++;if((p.dueDEFR&&new Date(p.dueDEFR)<=new Date())||(p.dueFRDE&&new Date(p.dueFRDE)<=new Date()))due++}
 var daily=days?Math.ceil((newCount+weak+due)/Math.max(1,days-1)):newCount+weak+due;
 box.innerHTML="<strong>"+courseName(c)+" · "+unitLabel(e.unit)+" · "+partLabel(e.part)+"</strong><br>Klassenarbeit: "+e.date+" · noch "+days+" Tage<br>"+pool.length+" Vokabeln im Stoff · "+newCount+" noch nie geübt · "+weak+" schwach · "+due+" fällig.<br><strong>Richtwert heute: ca. "+daily+" gezielte Abfragen</strong> (wird aus neu + schwach + fällig geschätzt)."
}
function populateAllSelectors(){
 populateCourseSelects();
 ["courseSelect","examCourse"].forEach(id=>{if(!$(id).value&&courses[0])$(id).value=courses[0].id});
 populateUnit($("courseSelect"),$("courseSelect").value,false);populatePart($("partSelect"),$("courseSelect").value,$("unitSelect").value,true);
 populateUnit($("examUnit"),$("examCourse").value,false);populatePart($("examPart"),$("examCourse").value,$("examUnit").value,true);
 populateUnit($("overviewUnit"),$("overviewCourse").value,true);populatePart($("overviewPart"),$("overviewCourse").value,$("overviewUnit").value,true);
 populateUnit($("vocabUnit"),$("vocabCourse").value,true);populatePart($("vocabPart"),$("vocabCourse").value,$("vocabUnit").value,true);
}
function bindCascade(courseId,unitId,partId,includeAll){
 $(courseId).addEventListener("change",()=>{populateUnit($(unitId),$(courseId).value,includeAll);populatePart($(partId),$(courseId).value,$(unitId).value,true);if(courseId==="examCourse")renderExamSummary();if(courseId==="overviewCourse")renderOverview();if(courseId==="vocabCourse")renderVocab()});
 $(unitId).addEventListener("change",()=>{populatePart($(partId),$(courseId).value,$(unitId).value,true);if(courseId==="overviewCourse")renderOverview();if(courseId==="vocabCourse")renderVocab()});
 $(partId).addEventListener("change",()=>{if(courseId==="overviewCourse")renderOverview();if(courseId==="vocabCourse")renderVocab()})
}

$("startSession").onclick=startSession;$("check").onclick=checkAnswer;$("next").onclick=()=>chooseNext(false);$("showAnswer").onclick=showAnswer;
$("tabLearn").onclick=()=>showView("learn");$("tabPlan").onclick=()=>showView("plan");$("tabOverview").onclick=()=>showView("overview");$("tabVocab").onclick=()=>showView("vocab");$("tabData").onclick=()=>showView("data");
$("refreshOverview").onclick=renderOverview;$("vocabSearch").oninput=renderVocab;$("saveEdit").onclick=saveEdit;$("cancelEdit").onclick=()=>{$("editCard").hidden=true};
$("saveExam").onclick=saveExam;$("deleteExam").onclick=deleteExam;$("export").onclick=exportBackup;$("exportCourse").onclick=exportCurrentCourse;$("reset").onclick=resetAll;
$("jsonFile").onchange=async e=>{var f=e.target.files&&e.target.files[0];if(!f)return;try{await importJson(f)}catch(err){$("importResult").textContent="Importfehler: "+err.message}e.target.value=""};

(async function(){
 try{
  db=await openDb();await seedIfNeeded();await reload();populateAllSelectors();
  bindCascade("courseSelect","unitSelect","partSelect",false);bindCascade("examCourse","examUnit","examPart",false);bindCascade("overviewCourse","overviewUnit","overviewPart",true);bindCascade("vocabCourse","vocabUnit","vocabPart",true);
  $("appStatus").textContent="✓ Version 3.1 läuft. JSON-Struktur geprüft. IndexedDB ist verfügbar.";
  await startSession()
 }catch(err){$("appStatus").textContent="Startfehler: "+err.message;$("appStatus").style.background="#fdeaea"}
})();
})();

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}
