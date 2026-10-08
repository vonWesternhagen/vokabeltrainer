
(function(){
"use strict";

var DB_NAME="VokabeltrainerTest";
var DB_VERSION=2;
var S_VOCAB="vocab", S_PROGRESS="progress", S_COURSES="courses", S_EXAMS="exams";
var db=null, vocab=[], courses=[];
var FIXED_COURSE_ID="franzoesisch";
var session={
  active:false, pool:[], firstQueue:[], seen:{}, current:null, currentDirection:"DE_FR",
  attempts:0, correct:0, testResults:[], lastId:null, recentIds:[]
};
var autoTimer=null;

var seedCourse={id:"franzoesisch",name:"Französisch 10",learningLocale:"fr-FR",nativeLocale:"de-DE"};
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
 var storedCourses=await reqP(os(S_COURSES).getAll());

 function looksLikeSectionId(value){
   var s=String(value||"").trim().toLowerCase().replace(/\s+/g,"-");
   return /^unite-?\d/.test(s) || /^unité-?\d/.test(s) ||
          /^module-?[a-d]$/.test(s) || /^volet-?\d/.test(s) ||
          /auftakt|vocabulaire|thematique|thématique/.test(s);
 }

 var vtx=db.transaction(S_VOCAB,"readwrite"), vs=vtx.objectStore(S_VOCAB);
 vocab.forEach(function(v){
   var knownFrenchSection=/^(unite-[123]|module-[a-d])/.test(String(v.unitId||"").toLowerCase());
   if(knownFrenchSection && v.courseId!=="franzoesisch"){
     v.courseId="franzoesisch";
     vs.put(v);
   }
 });
 await new Promise(function(resolve,reject){
   vtx.oncomplete=resolve;
   vtx.onerror=function(){reject(vtx.error)};
 });
 vocab=await reqP(os(S_VOCAB).getAll());

 var ctx=db.transaction(S_COURSES,"readwrite"), cs=ctx.objectStore(S_COURSES);
 storedCourses.forEach(function(c){
   if(!c || !c.id || looksLikeSectionId(c.id) || looksLikeSectionId(c.name)){
     if(c && c.id) cs.delete(c.id);
   }
 });
 var fr={id:"franzoesisch",name:"Französisch 10",learningLocale:"fr-FR",nativeLocale:"de-DE"};
 cs.put(fr);
 await new Promise(function(resolve,reject){
   ctx.oncomplete=resolve;
   ctx.onerror=function(){reject(ctx.error)};
 });

 var used=[...new Set(vocab.map(function(v){return v.courseId}).filter(Boolean))];
 courses=await reqP(os(S_COURSES).getAll());
 courses=courses.filter(function(c){
   return c && used.indexOf(c.id)>=0 && !looksLikeSectionId(c.id) && !looksLikeSectionId(c.name);
 });
 if(used.indexOf("franzoesisch")>=0 && !courses.some(function(c){return c.id==="franzoesisch"})) courses.push(fr);

 vocab.sort(function(a,b){
   return (a.unitId||"").localeCompare(b.unitId||"") || a.id.localeCompare(b.id);
 });
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
 ["courseSelect","examCourse","overviewCourse","vocabCourse"].forEach(function(id){
   var includeAll=(id==="overviewCourse"||id==="vocabCourse");
   fillSelect($(id),courses.map(function(c){return{value:c.id,label:c.name}}),includeAll?"Alle":null);
   if(!includeAll && courses.length) $(id).value=courses[0].id;
 })
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
 var c=courseName(FIXED_COURSE_ID),u=unitLabel($("unitSelect").value),p=partLabel($("partSelect").value);
 return c+" · "+u+" · "+p
}
async function startSession(){
 var available=filtered(FIXED_COURSE_ID,$("unitSelect").value,$("partSelect").value);
 if(!available.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine Vokabeln.";return}

 var requested=parseInt($("distinctCount").value,10);
 if(!Number.isFinite(requested)||requested<1) requested=available.length;
 requested=Math.min(requested,available.length);

 // Die Reihenfolge bestimmt zugleich, welche Vokabeln in die begrenzte Session kommen.
 var ordered=await orderPool(available,$("orderSelect").value,$("directionSelect").value);
 var pool=ordered.slice(0,requested);

 session={
   active:true,
   pool:pool,
   firstQueue:pool.slice(),
   seen:{},
   current:null,
   currentDirection:"DE_FR",
   attempts:0,
   correct:0,
   testResults:[],
   lastId:null,
   recentIds:[]
 };
 $("scopeInfo").textContent=currentScopeText()+" · "+pool.length+" verschiedene Vokabeln ausgewählt"
   +(available.length>pool.length?" (von "+available.length+" verfügbaren).":".")
   +" Jede wird zuerst genau einmal abgefragt.";
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

 // Erste Runde: garantiert jede ausgewählte Vokabel genau einmal.
 while(session.firstQueue.length){
   var candidate=session.firstQueue.shift();
   if(!session.seen[candidate.id]){v=candidate;break}
 }

 if(!v){
   if($("sessionTypeSelect").value==="test"){
      finishTest();return
   }

   if($("adaptiveAfterFirst").checked){
     var scored=[];
     for(var x of session.pool){
       scored.push([x,await weakScore(x,$("directionSelect").value)])
     }
     scored.sort((a,b)=>a[1]-b[1]);

     // Nicht immer nur dieselben 5 Vokabeln:
     // 70 % der nächsten Fragen kommen aus der schwächeren Hälfte,
     // 30 % aus dem restlichen Session-Pool. Die letzten 4 Vokabeln
     // werden nach Möglichkeit nicht sofort wiederholt.
     var recent=new Set(session.recentIds||[]);
     var candidates=scored.map(x=>x[0]).filter(x=>!recent.has(x.id));
     if(!candidates.length)candidates=scored.map(x=>x[0]);

     var weakCount=Math.max(3,Math.ceil(session.pool.length*0.5));
     weakCount=Math.min(weakCount,session.pool.length);
     var weakIds=new Set(scored.slice(0,weakCount).map(x=>x[0].id));
     var weakCandidates=candidates.filter(x=>weakIds.has(x.id));

     if(Math.random()<0.70 && weakCandidates.length){
       v=weakCandidates[Math.floor(Math.random()*weakCandidates.length)]
     }else{
       v=candidates[Math.floor(Math.random()*candidates.length)]
     }
   }else{
     var ord=await orderPool(session.pool,$("orderSelect").value,$("directionSelect").value);
     var recentSet=new Set(session.recentIds||[]);
     v=ord.find(x=>!recentSet.has(x.id)) || ord.find(x=>x.id!==session.lastId) || ord[0]
   }
 }

 session.current=v;
 session.currentDirection=chooseDirection();
 session.lastId=v.id;
 session.recentIds=(session.recentIds||[]).concat([v.id]).slice(-4);
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
 $("sessionCoverage").textContent=seenCount+" / "+session.pool.length+" verschiedene gesehen";
 $("sessionScore").textContent="Session: "+session.attempts+" Abfragen · "+session.correct+" richtig"
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
 var list=filtered(FIXED_COURSE_ID,$("overviewUnit").value,$("overviewPart").value),body=$("overviewBody");body.innerHTML="";
 var t={attempts:0,correct:0,bad:0};
 for(var v of list){var p=await gp(v.id);t.attempts+=p.attempts;t.correct+=p.correct;t.bad+=p.almost+p.wrong;
  var tr=document.createElement("tr"),cells=[unitLabel(unitGroup(v.unitId))+" · "+partLabel(partGroup(v.unitId)),v.foreign+" — "+v.meanings.join(" / "),"Stufe "+p.deFr+" ("+p.attemptsDEFR+"×)","Stufe "+p.frDe+" ("+p.attemptsFRDE+"×)",p.attempts,p.correct,p.almost,p.wrong,fmtDate(p.dueDEFR)];
  cells.forEach((c,i)=>{var td=document.createElement("td");td.textContent=c;if(i===2||i===3)td.className="level-pill";tr.appendChild(td)});body.appendChild(tr)
 }
 $("sumEntries").textContent=list.length;$("sumAttempts").textContent=t.attempts;$("sumCorrect").textContent=t.correct;$("sumWrong").textContent=t.bad
}
async function renderVocab(){
 var q=norm($("vocabSearch").value);
 var box=$("vocabList");
 box.innerHTML="";

 if(!q){
   $("vocabSearchInfo").textContent="Tippe Buchstaben ein. Gesucht wird gleichzeitig in Französisch und Deutsch.";
   return;
 }

 var matches=vocab.filter(function(v){
   return v.courseId===FIXED_COURSE_ID &&
     norm(v.foreign+" "+v.meanings.join(" ")).includes(q);
 }).sort(function(a,b){
   var af=norm(a.foreign),bf=norm(b.foreign);
   var am=norm(a.meanings.join(" ")),bm=norm(b.meanings.join(" "));
   var as=(af.startsWith(q)||am.startsWith(q))?0:1;
   var bs=(bf.startsWith(q)||bm.startsWith(q))?0:1;
   return as-bs || af.localeCompare(bf,"fr");
 });

 $("vocabSearchInfo").textContent=matches.length+" Treffer"+(matches.length===1?"":".");

 matches.slice(0,200).forEach(function(v){
   var row=document.createElement("div");
   row.className="vocab-item";

   var btn=document.createElement("button");
   btn.type="button";
   btn.className="vocab-hit";
   btn.innerHTML=
     "<span class='vocab-hit-main'><strong>"+escapeHtml(v.foreign)+"</strong>"+
     "<span>"+escapeHtml(v.meanings.join(" / "))+"</span>"+
     "<span class='muted'>"+escapeHtml(unitLabel(unitGroup(v.unitId))+" · "+partLabel(partGroup(v.unitId)))+"</span></span>"+
     "<span class='vocab-hit-arrow'>›</span>";
   btn.onclick=function(){editVocab(v.id)};
   row.appendChild(btn);
   box.appendChild(row);
 });

 if(matches.length>200){
   var note=document.createElement("div");
   note.className="small";
   note.textContent="Es werden die ersten 200 Treffer angezeigt. Suche genauer, um die Liste einzugrenzen.";
   box.appendChild(note);
 }
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

function unitIdFromSelection(unit,part){
 if(/^module-[a-d]$/.test(unit)) return unit;
 if(part==="alle" || !part) part="auftakt";
 return unit+"-"+part;
}

function populateEditParts(){
 var unit=$("editUnit").value;
 populatePart($("editPart"),FIXED_COURSE_ID,unit,false);
 if(/^module-[a-d]$/.test(unit)){
   $("editPartLabel").hidden=true;
 }else{
   $("editPartLabel").hidden=false;
   if(!$("editPart").value && $("editPart").options.length) $("editPart").selectedIndex=0;
 }
 updateEditLocation();
}

function updateEditLocation(){
 var unit=$("editUnit").value;
 var part=/^module-[a-d]$/.test(unit) ? "gesamtes Modul" : partLabel($("editPart").value);
 $("editLocation").textContent="Ablage: "+unitLabel(unit)+" · "+part;
}

function editVocab(id){
 var v=vocab.find(function(x){return x.id===id});
 if(!v)return;

 $("editId").value=v.id;
 $("editForeign").value=v.foreign;
 $("editMeanings").value=v.meanings.join("; ");

 populateUnit($("editUnit"),FIXED_COURSE_ID,false);
 var ug=unitGroup(v.unitId);
 $("editUnit").value=ug;
 populateEditParts();

 if(!/^module-[a-d]$/.test(ug)){
   var pg=partGroup(v.unitId);
   if([...$("editPart").options].some(function(o){return o.value===pg})) $("editPart").value=pg;
 }
 updateEditLocation();

 $("editModal").hidden=false;
 setTimeout(function(){$("editForeign").focus()},30);
}

function closeEditModal(){
 $("editModal").hidden=true;
}

async function saveEdit(){
 var id=$("editId").value;
 var v=vocab.find(function(x){return x.id===id});
 if(!v)return;

 var foreign=$("editForeign").value.trim();
 var meanings=$("editMeanings").value.split(";").map(function(x){return x.trim()}).filter(Boolean);
 if(!foreign || !meanings.length){
   alert("Bitte sowohl Französisch als auch mindestens eine deutsche Bedeutung eintragen.");
   return;
 }

 v.foreign=foreign;
 v.meanings=meanings;
 v.courseId=FIXED_COURSE_ID;
 v.unitId=unitIdFromSelection($("editUnit").value,$("editPart").value);

 await reqP(os(S_VOCAB,"readwrite").put(v));
 await reload();
 populateAllSelectors();
 closeEditModal();
 await renderVocab();
}
async function downloadJson(data,name){var blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function exportBackup(){
 var entries=await reqP(os(S_VOCAB).getAll()),progress=await reqP(os(S_PROGRESS).getAll()),exams=await reqP(os(S_EXAMS).getAll()),cs=await reqP(os(S_COURSES).getAll());
 downloadJson({schemaVersion:4,exportedAt:new Date().toISOString(),courses:cs,entries:entries,progress:progress,exams:exams},"vokabeltrainer-backup.json")
}
async function exportCurrentCourse(){
 var cid=FIXED_COURSE_ID,c=courses.find(x=>x.id===cid),entries=vocab.filter(v=>v.courseId===cid),progress=(await reqP(os(S_PROGRESS).getAll())).filter(p=>entries.some(v=>v.id===p.id));
 downloadJson({schemaVersion:4,course:Object.assign({},c,{name:"Französisch 10",schoolYearLabel:"Französisch 10"}),entries:entries,progress:progress},"vokabeltrainer-franzoesisch-10.json")
}
async function resetAll(){
 if(!confirm("Alle lokalen Daten löschen und nur die drei Testvokabeln wiederherstellen?"))return;
 for(var s of [S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS])await reqP(os(s,"readwrite").clear());await seedIfNeeded();await reload();populateAllSelectors();await startSession()
}
async function saveExam(){
 var c=FIXED_COURSE_ID,u=$("examUnit").value,p=$("examPart").value,date=$("examDate").value;if(!date)return alert("Bitte Datum wählen.");
 await reqP(os(S_EXAMS,"readwrite").put({id:c,courseId:c,date:date,unit:u,part:p}));renderExamSummary()
}
async function deleteExam(){await reqP(os(S_EXAMS,"readwrite").delete(FIXED_COURSE_ID));renderExamSummary()}
async function renderExamSummary(){
 var c=FIXED_COURSE_ID,e=await reqP(os(S_EXAMS).get(c)),box=$("examSummary");if(!e){box.innerHTML="Für diesen Kurs ist noch keine Klassenarbeit gespeichert.";return}
 $("examDate").value=e.date;$("examUnit").value=e.unit;populatePart($("examPart"),c,e.unit,true);$("examPart").value=e.part;
 var pool=filtered(c,e.unit,e.part),days=Math.max(0,Math.ceil((new Date(e.date+"T12:00:00")-new Date())/86400000)),newCount=0,weak=0,due=0;
 for(var v of pool){var p=await gp(v.id);if(p.attempts===0)newCount++;if(Math.min(p.deFr,p.frDe)<=1)weak++;if((p.dueDEFR&&new Date(p.dueDEFR)<=new Date())||(p.dueFRDE&&new Date(p.dueFRDE)<=new Date()))due++}
 var daily=days?Math.ceil((newCount+weak+due)/Math.max(1,days-1)):newCount+weak+due;
 box.innerHTML="<strong>"+courseName(c)+" · "+unitLabel(e.unit)+" · "+partLabel(e.part)+"</strong><br>Klassenarbeit: "+e.date+" · noch "+days+" Tage<br>"+pool.length+" Vokabeln im Stoff · "+newCount+" noch nie geübt · "+weak+" schwach · "+due+" fällig.<br><strong>Richtwert heute: ca. "+daily+" gezielte Abfragen</strong> (wird aus neu + schwach + fällig geschätzt)."
}
function populateAllSelectors(){
 populateUnit($("unitSelect"),FIXED_COURSE_ID,false);
 populatePart($("partSelect"),FIXED_COURSE_ID,$("unitSelect").value,true);

 populateUnit($("examUnit"),FIXED_COURSE_ID,false);
 populatePart($("examPart"),FIXED_COURSE_ID,$("examUnit").value,true);

 populateUnit($("overviewUnit"),FIXED_COURSE_ID,true);
 populatePart($("overviewPart"),FIXED_COURSE_ID,$("overviewUnit").value,true);

}
function bindUnitPart(unitId,partId,includeAll,afterChange){
 $(unitId).addEventListener("change",function(){
   populatePart($(partId),FIXED_COURSE_ID,$(unitId).value,true);
   if(afterChange) afterChange();
 });
 $(partId).addEventListener("change",function(){
   if(afterChange) afterChange();
 });
}

async function skipCurrent(){
 if(!session.active||!session.current){await chooseNext(false);return}
 var v=session.current;
 if(!session.seen[v.id]){
   var p=await gp(v.id);
   p.attempts++;
   p.wrong++;
   p.lastPracticedAt=new Date().toISOString();
   if(session.currentDirection==="DE_FR"){p.attemptsDEFR++;p.deFr=Math.max(0,p.deFr-1);p.dueDEFR=nextDue(0)}
   else{p.attemptsFRDE++;p.frDe=Math.max(0,p.frDe-1);p.dueFRDE=nextDue(0)}
   await sp(p);
   session.attempts++;
   session.seen[v.id]=true;
   session.testResults.push({id:v.id,kind:"skipped"});
   updateSessionBadges();
 }
 await chooseNext(false);
}

async function revealCurrent(){
 if(!session.active||!session.current)return;
 var v=session.current,d=session.currentDirection;
 $("feedback").className="feedback almost";
 $("feedback").innerHTML="Antwort: <strong>"+(d==="DE_FR"?v.foreign:v.meanings.join(" / "))+"</strong><br><span class='small'>Als nicht gewusst markiert.</span>";
 if(!session.seen[v.id]){
   var p=await gp(v.id);
   p.attempts++;p.wrong++;p.lastPracticedAt=new Date().toISOString();
   if(d==="DE_FR"){p.attemptsDEFR++;p.deFr=Math.max(0,p.deFr-1);p.dueDEFR=nextDue(0)}
   else{p.attemptsFRDE++;p.frDe=Math.max(0,p.frDe-1);p.dueFRDE=nextDue(0)}
   await sp(p);
   session.attempts++;session.seen[v.id]=true;session.testResults.push({id:v.id,kind:"revealed"});
   updateSessionBadges();
 }
 keepFocus();
}

$("startSession").onclick=startSession;$("check").onclick=checkAnswer;$("next").onclick=skipCurrent;$("showAnswer").onclick=revealCurrent;
$("tabLearn").onclick=()=>showView("learn");$("tabPlan").onclick=()=>showView("plan");$("tabOverview").onclick=()=>showView("overview");$("tabVocab").onclick=()=>showView("vocab");$("tabData").onclick=()=>showView("data");
$("refreshOverview").onclick=renderOverview;$("vocabSearch").oninput=renderVocab;$("saveEdit").onclick=saveEdit;$("cancelEdit").onclick=closeEditModal;$("closeEdit").onclick=closeEditModal;$("editUnit").onchange=populateEditParts;$("editPart").onchange=updateEditLocation;$("editModal").addEventListener("click",function(e){if(e.target===$("editModal"))closeEditModal()});
$("saveExam").onclick=saveExam;$("deleteExam").onclick=deleteExam;$("export").onclick=exportBackup;$("exportCourse").onclick=exportCurrentCourse;$("reset").onclick=resetAll;
$("jsonFile").onchange=async e=>{var f=e.target.files&&e.target.files[0];if(!f)return;try{await importJson(f)}catch(err){$("importResult").textContent="Importfehler: "+err.message}e.target.value=""};

(async function(){
 try{
  db=await openDb();await seedIfNeeded();await reload();populateAllSelectors();
  bindUnitPart("unitSelect","partSelect",false,null);
  bindUnitPart("examUnit","examPart",false,renderExamSummary);
  bindUnitPart("overviewUnit","overviewPart",true,renderOverview);
  $("appStatus").textContent="✓ Version 3.5 läuft. Französisch 10 · Such-Editor mit Verschieben · Lernsession geprüft.";
  await startSession()
 }catch(err){$("appStatus").textContent="Startfehler: "+err.message;$("appStatus").style.background="#fdeaea"}
})();
})();

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));}
