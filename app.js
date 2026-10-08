(function(){
"use strict";

var APP_VERSION="4.3";
var DB_NAME="VokabeltrainerTest";
var DB_VERSION=2;
var S_VOCAB="vocab",S_PROGRESS="progress",S_COURSES="courses",S_EXAMS="exams";
var SETTINGS_KEY="vokabeltrainer.settings.v4";
var ACTIVE_COURSE_KEY="vokabeltrainer.activeCourse.v1";
var db=null,vocab=[],courses=[],autoTimer=null,correctDetectTimer=null,ACTIVE_COURSE_ID=null;
var LEGACY_SEEDS={"le-projet":"le projet","le-metier":"le métier","le-domaine":"le domaine"};

var session={
 active:false,pool:[],firstQueue:[],seen:{},current:null,currentDirection:"DE_FR",
 attempts:0,correct:0,testResults:[],lastId:null,recentIds:[],firstRoundComplete:false,
 awaitingChoice:false,sourceLabel:"",currentResolved:false,lastResult:null
};

function $(id){return document.getElementById(id)}
function reqP(req){return new Promise(function(res,rej){req.onsuccess=function(){res(req.result)};req.onerror=function(){rej(req.error)}})}
function os(name,mode){return db.transaction(name,mode||"readonly").objectStore(name)}

function openDb(){
 return new Promise(function(res,rej){
  var r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=function(e){
   var d=e.target.result;
   if(!d.objectStoreNames.contains(S_VOCAB))d.createObjectStore(S_VOCAB,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_PROGRESS))d.createObjectStore(S_PROGRESS,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_COURSES))d.createObjectStore(S_COURSES,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_EXAMS))d.createObjectStore(S_EXAMS,{keyPath:"id"});
  };
  r.onsuccess=function(){res(r.result)};
  r.onerror=function(){rej(r.error)}
 })
}

async function prepareData(){
 // Historische Prototyp-Startvokabeln endgültig entfernen.
 for(var id in LEGACY_SEEDS){
  var legacy=await reqP(os(S_VOCAB).get(id));
  if(legacy && (legacy.seed===true || (legacy.courseId==="franzoesisch" && norm(legacy.foreign)===norm(LEGACY_SEEDS[id])))){
   await reqP(os(S_VOCAB,"readwrite").delete(id));
   await reqP(os(S_PROGRESS,"readwrite").delete(id))
  }
 }

 // Datenstruktur vereinheitlichen:
 // unitId = nur Unité/Modul, part = Teilbereich, sectionName = optionale Buch-Unterüberschrift.
 var all=await reqP(os(S_VOCAB).getAll());
 var tx=db.transaction(S_VOCAB,"readwrite"),store=tx.objectStore(S_VOCAB),changed=0;
 all.forEach(function(v){
  var dirty=false,uid=String(v.unitId||"");

  // Französisch 6, Seiten 176–178: Auftakt VOR Unité 1 => Unité 0.
  if(v.courseId==="franzoesisch-6" && (/^p17[678]-/.test(uid) || (Number(v.page)>=176&&Number(v.page)<=178))){
   if(!v.sectionName)v.sectionName=v.unitName||uid;
   if(v.unitId!=="unite-0"){v.unitId="unite-0";dirty=true}
   if(v.part!=="auftakt"){v.part="auftakt";dirty=true}
  }else{
   // Alte zusammengesetzte IDs wie unite-1-volet-1 werden sauber getrennt.
   var m=uid.match(/^(unite-\d+)-(auftakt|vocabulaire-thematique|volet-1|volet-2)$/);
   if(m){
    v.unitId=m[1];v.part=m[2];dirty=true
   }else if(/^module-[a-z]$/.test(uid)){
    if(v.part!=="alle"){v.part="alle";dirty=true}
   }
  }
  if(dirty){store.put(v);changed++}
 });
 await new Promise(function(res,rej){tx.oncomplete=res;tx.onerror=function(){rej(tx.error)}});
}
function usedCourseIds(){return Array.from(new Set(vocab.map(function(v){return v.courseId}).filter(Boolean)))}
function courseHasVocab(id){return !!id && vocab.some(function(v){return v.courseId===id})}
function activeCourseId(){return ACTIVE_COURSE_ID}
function courseName(id){
 var c=courses.find(function(x){return x.id===id});
 return c?(c.label||c.name||c.id):(id||"Noch kein Kurs")
}
function chooseInitialActiveCourse(){
 var used=usedCourseIds(),saved=null;
 try{saved=localStorage.getItem(ACTIVE_COURSE_KEY)}catch(e){}
 if(saved&&used.indexOf(saved)>=0){ACTIVE_COURSE_ID=saved;return}
 if(!used.length){ACTIVE_COURSE_ID=null;return}
 var ranked=used.map(function(id){
  var arr=vocab.filter(function(v){return v.courseId===id}),latest=0;
  arr.forEach(function(v){var t=Date.parse(v.importedAt||"");if(Number.isFinite(t))latest=Math.max(latest,t)});
  return{id:id,latest:latest,count:arr.length}
 }).sort(function(a,b){return b.latest-a.latest||b.count-a.count});
 ACTIVE_COURSE_ID=ranked[0].id;
 try{localStorage.setItem(ACTIVE_COURSE_KEY,ACTIVE_COURSE_ID)}catch(e){}
}
function setActiveCourse(id){
 if(id&&courseHasVocab(id)){
  ACTIVE_COURSE_ID=id;try{localStorage.setItem(ACTIVE_COURSE_KEY,id)}catch(e){}
 }else ACTIVE_COURSE_ID=null
}
async function reload(){
 vocab=await reqP(os(S_VOCAB).getAll());
 courses=await reqP(os(S_COURSES).getAll());
 var used=usedCourseIds();
 for(var i=0;i<used.length;i++){
  var id=used[i];
  if(!courses.some(function(c){return c.id===id})){
   var name=id==="franzoesisch"?"Französisch 10":id;
   var c={id:id,name:name,label:name,learningLocale:"fr-FR",nativeLocale:"de-DE"};
   await reqP(os(S_COURSES,"readwrite").put(c));courses.push(c)
  }
 }
 var legacy=courses.find(function(c){return c.id==="franzoesisch"});
 if(legacy&&(!legacy.name||legacy.name==="Französisch")){
  legacy.name="Französisch 10";legacy.label="Französisch 10";await reqP(os(S_COURSES,"readwrite").put(legacy))
 }
 vocab.sort(function(a,b){return String(a.unitId||"").localeCompare(String(b.unitId||""))||String(a.id).localeCompare(String(b.id))});
 chooseInitialActiveCourse()
}

function pDefault(id){
 return{
  id:id,deFr:0,frDe:0,attempts:0,correct:0,almost:0,wrong:0,
  attemptsDEFR:0,attemptsFRDE:0,
  correctDEFR:0,almostDEFR:0,wrongDEFR:0,
  correctFRDE:0,almostFRDE:0,wrongFRDE:0,
  lastPracticedAt:null,dueDEFR:null,dueFRDE:null
 }
}
async function gp(id){var p=await reqP(os(S_PROGRESS).get(id));return Object.assign(pDefault(id),p||{})}
async function sp(p){await reqP(os(S_PROGRESS,"readwrite").put(p))}

function norm(s){
 return String(s||"").trim().toLowerCase().replace(/[’‘`´]/g,"'").replace(/\s+/g," ")
}
function stripAcc(s){
 try{return norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
 catch(e){return norm(s)}
}
// Sehr toleranter Vergleich für Vokabeln:
// Groß/Klein, Leerzeichen, Satzzeichen, Apostrophe und Akzente spielen keine Rolle.
function looseNorm(s){
 return stripAcc(s)
  .replace(/œ/g,"oe").replace(/æ/g,"ae").replace(/ß/g,"ss")
  .replace(/[^a-z0-9]/g,"")
}
function stripFrenchArticle(s){
 return norm(s).replace(/^(le|la|les|un|une|des)\s+/,"").replace(/^l'/,"")
}
function stripGermanArticle(s){
 return norm(s).replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"")
}
function germanAccepted(item,g){
 var lg=looseNorm(g),lgn=looseNorm(stripGermanArticle(g));
 return item.meanings.some(function(m){
  return lg===looseNorm(m)||lgn===looseNorm(stripGermanArticle(m))
 })
}
function levenshtein(a,b){
 a=String(a||"");b=String(b||"");
 var prev=new Array(b.length+1),cur=new Array(b.length+1);
 for(var j=0;j<=b.length;j++)prev[j]=j;
 for(var i=1;i<=a.length;i++){
  cur[0]=i;
  for(var k=1;k<=b.length;k++){
   cur[k]=Math.min(cur[k-1]+1,prev[k]+1,prev[k-1]+(a[i-1]===b[k-1]?0:1))
  }
  var tmp=prev;prev=cur;cur=tmp
 }
 return prev[b.length]
}
function nearEnough(a,b){
 a=looseNorm(a);b=looseNorm(b);
 if(!a||!b||a===b)return false;
 var maxLen=Math.max(a.length,b.length),dist=levenshtein(a,b);
 var allowed=Math.min(3,Math.max(1,Math.floor(maxLen*0.15)));
 var similarity=1-dist/maxLen;
 return dist<=allowed&&similarity>=0.80
}
function germanNear(item,g){
 var candidates=[];
 item.meanings.forEach(function(m){
  candidates.push(m);candidates.push(stripGermanArticle(m))
 });
 var inputs=[g,stripGermanArticle(g)];
 return inputs.some(function(x){return candidates.some(function(c){return nearEnough(x,c)})})
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})}

function unitGroup(value){
 var unitId=typeof value==="object"&&value?value.unitId:value;
 unitId=String(unitId||"");
 var m=unitId.match(/^(unite-\d+)/);
 if(m)return m[1];
 if(/^module-[a-z]$/.test(unitId))return unitId;
 return unitId||"ohne"
}
function partGroup(value){
 var v=typeof value==="object"&&value?value:null;
 if(v&&v.part)return v.part;
 var unitId=String(v?v.unitId:value||"");
 if(/auftakt/.test(unitId))return"auftakt";
 if(/vocabulaire-thematique/.test(unitId))return"vocabulaire-thematique";
 if(/volet-1/.test(unitId))return"volet-1";
 if(/volet-2/.test(unitId))return"volet-2";
 if(/^module-/.test(unitId))return"alle";
 return"sonstiges"
}
function unitLabel(x){
 if(x==="alle")return"Alle Vokabeln";
 var um=String(x||"").match(/^unite-(\d+)$/);
 if(um)return"Unité "+um[1];
 var mm=String(x||"").match(/^module-([a-z])$/);
 if(mm)return"Module "+mm[1].toUpperCase();
 return x
}
function partLabel(x){
 return({"alle":"Alle Teilbereiche","auftakt":"Auftakt","vocabulaire-thematique":"Vocabulaire thématique","volet-1":"Volet 1","volet-2":"Volet 2","sonstiges":"Sonstiges"})[x]||x
}
function courseName(id){
 var c=courses.find(function(x){return x.id===id});
 return c?(c.label||c.name||c.id):(id||"Noch kein Kurs")
}

function fillSelect(sel,items,allLabel){
 if(!sel)return;
 var old=sel.value;sel.innerHTML="";
 if(allLabel!==null){var a=document.createElement("option");a.value="alle";a.textContent=allLabel||"Alle";sel.appendChild(a)}
 items.forEach(function(it){var o=document.createElement("option");o.value=it.value;o.textContent=it.label;sel.appendChild(o)});
 if([].slice.call(sel.options).some(function(o){return o.value===old}))sel.value=old
}
function unitsForCourse(courseId){
 return Array.from(new Set(vocab.filter(function(v){return courseId==="alle"||v.courseId===courseId}).map(function(v){return unitGroup(v)})))
  .sort(function(a,b){
   var au=String(a).match(/^unite-(\d+)$/),bu=String(b).match(/^unite-(\d+)$/);
   if(au&&bu)return Number(au[1])-Number(bu[1]);
   if(au)return-1;if(bu)return 1;
   var am=String(a).match(/^module-([a-z])$/),bm=String(b).match(/^module-([a-z])$/);
   if(am&&bm)return am[1].localeCompare(bm[1]);
   if(am)return-1;if(bm)return 1;
   return String(a).localeCompare(String(b))
  })
}
function partsFor(courseId,unit){
 if(/^module-[a-z]$/.test(unit)||unit==="unite-0")return unit==="unite-0"?["auftakt"]:[];
 return Array.from(new Set(vocab.filter(function(v){
  return(courseId==="alle"||v.courseId===courseId)&&(unit==="alle"||unitGroup(v)===unit)
 }).map(function(v){return partGroup(v)}))).filter(function(x){return x!=="alle"}).sort(function(a,b){
  var order={"auftakt":1,"vocabulaire-thematique":2,"volet-1":3,"volet-2":4,"sonstiges":9};
  return(order[a]||99)-(order[b]||99)||a.localeCompare(b)
 })
}
function populatePart(sel,courseId,unit,includeAll){
 if(unit==="alle"){
  sel.innerHTML="";var all=document.createElement("option");all.value="alle";all.textContent="Alle Vokabeln";sel.appendChild(all);sel.disabled=true;return
 }
 if(unit==="unite-0"){
  sel.innerHTML="";var intro=document.createElement("option");intro.value="auftakt";intro.textContent="Auftakt";sel.appendChild(intro);sel.disabled=true;return
 }
 if(/^module-[a-z]$/.test(unit)){
  sel.innerHTML="";var mod=document.createElement("option");mod.value="alle";mod.textContent="gesamtes Modul";sel.appendChild(mod);sel.disabled=true;return
 }
 var parts=partsFor(courseId,unit);
 fillSelect(sel,parts.map(function(x){return{value:x,label:partLabel(x)}}),includeAll?"Alle Teilbereiche":null);
 sel.disabled=false
}
function filtered(courseId,unit,part){
 return vocab.filter(function(v){
  return(courseId==="alle"||v.courseId===courseId)&&(unit==="alle"||unitGroup(v)===unit)&&(part==="alle"||partGroup(v)===part)
 })
}

function statsForDir(p,dir){
 if(dir==="DE_FR")return{attempts:p.attemptsDEFR,correct:p.correctDEFR,almost:p.almostDEFR,wrong:p.wrongDEFR,level:p.deFr,due:p.dueDEFR};
 if(dir==="FR_DE")return{attempts:p.attemptsFRDE,correct:p.correctFRDE,almost:p.almostFRDE,wrong:p.wrongFRDE,level:p.frDe,due:p.dueFRDE};
 return{
  attempts:p.attemptsDEFR+p.attemptsFRDE,correct:p.correctDEFR+p.correctFRDE,
  almost:p.almostDEFR+p.almostFRDE,wrong:p.wrongDEFR+p.wrongFRDE,
  level:Math.min(p.deFr,p.frDe),due:null
 }
}
async function weakScore(v,dir){
 var p=await gp(v.id),s=statsForDir(p,dir);
 var attempts=s.attempts||p.attempts||0;
 var correct=s.correct||0,almost=s.almost||0,wrong=s.wrong||0;
 var success=attempts?(correct+0.5*almost)/attempts:1;
 var level=Number.isFinite(s.level)?s.level:0;

 // Niedriger = schwächer.
 // Fehlerquote dominiert, Lernstufe stabilisiert, viele belegte Fehlversuche verstärken die Aussage.
 var confidence=Math.min(attempts,8)/8;
 return success*60 + level*7 + confidence*8 - Math.min(wrong+0.5*almost,8)*2
}
async function orderPool(arr,mode,dir){
 var a=arr.slice();
 if(mode==="reverse")return a.reverse();
 if(mode==="random")return a.sort(function(){return Math.random()-.5});
 if(mode==="weakest"){
  var scored=[];for(var i=0;i<a.length;i++)scored.push([a[i],await weakScore(a[i],dir)]);
  scored.sort(function(x,y){return x[1]-y[1]});return scored.map(function(x){return x[0]})
 }
 return a
}
function isDue(p){
 var now=new Date();
 return(p.dueDEFR&&new Date(p.dueDEFR)<=now)||(p.dueFRDE&&new Date(p.dueFRDE)<=now)
}
async function priorityPool(arr){
 var out=[];
 for(var i=0;i<arr.length;i++){
  var v=arr[i],p=await gp(v.id),priority=p.attempts===0?0:isDue(p)?1:Math.min(p.deFr,p.frDe)<=1?2:3;
  out.push([v,priority,await weakScore(v,"MIXED")])
 }
 out.sort(function(a,b){return a[1]-b[1]||a[2]-b[2]});
 return out.map(function(x){return x[0]})
}

function collectSettings(){
 return{
  activeCourse:activeCourseId(),
  unit:$("unitSelect")?$("unitSelect").value:"alle",
  part:$("partSelect")?$("partSelect").value:"alle",
  order:$("orderSelect")?$("orderSelect").value:"random",
  direction:$("directionSelect")?$("directionSelect").value:"DE_FR",
  distinctCount:$("distinctCount")?parseInt($("distinctCount").value,10)||10:10,
  autoNext:$("autoNext")?$("autoNext").checked:true,
  autoDetectCorrect:$("autoDetectCorrect")?$("autoDetectCorrect").checked:true,
  overviewUnit:$("overviewUnit")?$("overviewUnit").value:"alle",
  overviewPart:$("overviewPart")?$("overviewPart").value:"alle",
  overviewSort:$("overviewSort")?$("overviewSort").value:"book"
 }
}
function saveSettings(){
 try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(collectSettings()))}catch(e){}
}
function loadSavedSettings(){
 try{return JSON.parse(localStorage.getItem(SETTINGS_KEY)||"{}")}catch(e){return{}}
}
function applySettings(s){
 s=s||{};
 if(s.activeCourse&&courseHasVocab(s.activeCourse))setActiveCourse(s.activeCourse);
 populateCourseSelector();populateAllSelectors();
 function setIf(id,val){var el=$(id);if(el&&val!=null&&[].slice.call(el.options||[]).some(function(o){return o.value===String(val)}))el.value=val}
 setIf("unitSelect",s.unit||"alle");
 populatePart($("partSelect"),activeCourseId(),$("unitSelect").value,true);
 setIf("partSelect",s.part);
 setIf("orderSelect",s.order||"random");
 setIf("directionSelect",s.direction||"DE_FR");
 if($("distinctCount"))$("distinctCount").value=s.distinctCount||10;
 if($("autoNext")&&typeof s.autoNext==="boolean")$("autoNext").checked=s.autoNext;
 if($("autoDetectCorrect")&&typeof s.autoDetectCorrect==="boolean")$("autoDetectCorrect").checked=s.autoDetectCorrect;
 setIf("overviewUnit",s.overviewUnit||"alle");
 populatePart($("overviewPart"),activeCourseId(),$("overviewUnit").value,true);
 setIf("overviewPart",s.overviewPart);
 setIf("overviewSort",s.overviewSort||"book")
}

function currentScopeText(){
 var unit=$("unitSelect").value,part=$("partSelect").value,text=courseName(activeCourseId())+" · "+unitLabel(unit);
 if(unit!=="alle"&&!/^module-/.test(unit)&&unit!=="unite-0"&&part&&part!=="alle")text+=" · "+partLabel(part);
 return text
}
function resetSessionState(pool,label){
 session={
  active:true,pool:pool,firstQueue:pool.slice(),seen:{},current:null,currentDirection:"DE_FR",
  attempts:0,correct:0,testResults:[],lastId:null,recentIds:[],firstRoundComplete:false,
  awaitingChoice:false,sourceLabel:label||"",currentResolved:false,lastResult:null
 };
 $("roundCompletePanel").hidden=true;
 $("trainerExercise").hidden=false;
 $("showAnswer").hidden=false
}
async function applyQuestionOrder(selected,available,mode,dir){
 var a=selected.slice(),position=new Map();
 available.forEach(function(v,i){position.set(v.id,i)});
 if(mode==="random")return a.sort(function(){return Math.random()-.5});
 if(mode==="reverse")return a.sort(function(x,y){return(position.get(y.id)||0)-(position.get(x.id)||0)});
 if(mode==="weakest"){
  var scored=[];for(var i=0;i<a.length;i++)scored.push([a[i],await weakScore(a[i],dir)]);
  scored.sort(function(x,y){return x[1]-y[1]});return scored.map(function(x){return x[0]})
 }
 return a.sort(function(x,y){return(position.get(x.id)||0)-(position.get(y.id)||0)})
}
async function selectNewPool(available,requested,dir,mode){
 var fresh=[],practiced=[];
 for(var i=0;i<available.length;i++){
  var p=await gp(available[i].id);
  if(p.attempts===0)fresh.push(available[i]);else practiced.push(available[i])
 }

 // Neue Vokabeln entsprechend der gewünschten Reihenfolge auswählen.
 var freshOrdered=await applyQuestionOrder(fresh,available,mode,dir);
 var picked=freshOrdered.slice(0,Math.min(requested,freshOrdered.length));

 // Fehlende Plätze ausschließlich mit den schwächsten bereits geübten Vokabeln auffüllen.
 if(picked.length<requested&&practiced.length){
  var weak=[];
  for(var j=0;j<practiced.length;j++)weak.push([practiced[j],await weakScore(practiced[j],dir)]);
  weak.sort(function(a,b){return a[1]-b[1]});
  picked=picked.concat(weak.slice(0,requested-picked.length).map(function(x){return x[0]}))
 }
 return{pool:await applyQuestionOrder(picked,available,mode,dir),newCount:Math.min(fresh.length,requested)}
}
async function selectWeakPool(available,requested,dir,mode){
 var practiced=[];
 for(var i=0;i<available.length;i++){
  var p=await gp(available[i].id);
  if(p.attempts>0)practiced.push(available[i])
 }
 if(!practiced.length)return[];
 var scored=[];
 for(var j=0;j<practiced.length;j++)scored.push([practiced[j],await weakScore(practiced[j],dir)]);
 scored.sort(function(a,b){return a[1]-b[1]});
 var picked=scored.slice(0,Math.min(requested,scored.length)).map(function(x){return x[0]});
 return await applyQuestionOrder(picked,available,mode,dir)
}
async function startLearningMode(mode){
 if(!activeCourseId()){$("scopeInfo").textContent="Bitte zuerst einen Kurs importieren oder auswählen.";return}
 var available=filtered(activeCourseId(),$("unitSelect").value,$("partSelect").value);
 if(!available.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine Vokabeln.";return}

 var requested=parseInt($("distinctCount").value,10);
 if(!Number.isFinite(requested)||requested<1)requested=10;
 requested=Math.min(requested,available.length);

 var dir=$("directionSelect").value,order=$("orderSelect").value,pool=[],label=currentScopeText();
 if(mode==="new"){
  var result=await selectNewPool(available,requested,dir,order);pool=result.pool;
  if(!pool.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine passenden Vokabeln.";return}
  label+=" · Neue Vokabeln";
  $("scopeInfo").textContent=result.newCount+" neue Vokabel"+(result.newCount===1?"":"n")+" · "+
   (pool.length-result.newCount)+" schwierige zum Auffüllen · "+pool.length+" insgesamt."
 }else{
  pool=await selectWeakPool(available,requested,dir,order);
  if(!pool.length){$("scopeInfo").textContent="In dieser Auswahl wurde noch keine Vokabel geübt. Starte zuerst „Neue Vokabeln lernen“.";return}
  label+=" · Schlecht gekonnte";
  $("scopeInfo").textContent=pool.length+" schlecht gekonnte Vokabeln ausgewählt."
 }

 resetSessionState(pool,label);
 saveSettings();showView("trainer");await chooseNext()
}
async function startNewSession(){await startLearningMode("new")}
async function startWeakSession(){await startLearningMode("weak")}

async function startCustomSession(pool,label){
 if(!pool.length)return;
 $("distinctCount").value=pool.length;
 resetSessionState(pool,label);
 showView("trainer");saveSettings();await chooseNext()
}

function chooseDirection(){
 var d=$("directionSelect").value;
 return d==="MIXED"?(Math.random()<.5?"DE_FR":"FR_DE"):d
}
async function chooseNext(){
 if(!session.active)return;
 var v=null;
 while(session.firstQueue.length){
  var candidate=session.firstQueue.shift();
  if(!session.seen[candidate.id]){v=candidate;break}
 }
 if(!v){finishRound();return}
 session.current=v;session.currentDirection=chooseDirection();session.lastId=v.id;
 await renderCurrent()
}
function finishRound(){
 session.active=false;session.current=null;
 clearTimeout(autoTimer);clearTimeout(correctDetectTimer);
 $("trainerExercise").hidden=true;
 $("roundCompletePanel").hidden=false;
 var total=session.pool.length,quote=session.attempts?Math.round(session.correct/session.attempts*100):0;
 $("roundCompleteText").textContent="Runde beendet · "+total+" Vokabeln · "+quote+" % richtig";
 $("progressFill").style.width="100%";
 document.documentElement.lang="de"
}
function startAnotherRound(){
 $("roundCompletePanel").hidden=true;showView("learn")
}
function endSession(){
 session.active=false;$("roundCompletePanel").hidden=true;$("trainerExercise").hidden=false;
 document.documentElement.lang="de";showView("home")
}

async function renderCurrent(){
 var v=session.current;if(!v)return;
 var d=session.currentDirection,fr=d==="DE_FR";
 session.currentResolved=false;session.lastResult=null;
 $("nearMissActions").hidden=true;
 clearTimeout(correctDetectTimer);
 $("check").textContent="Prüfen";
 $("prompt").textContent=fr?v.meanings.join(" / "):v.foreign;
 $("directionLabel").textContent=fr?"Deutsch → Französisch":"Französisch → Deutsch";
 $("answer").lang=fr?"fr-FR":"de-DE";
 $("answer").setAttribute("lang",fr?"fr-FR":"de-DE");
 document.documentElement.lang=fr?"fr":"de";
 $("answer").value="";
 $("feedback").className="feedback compact-feedback";
 $("feedback").textContent="";
 $("trainerScope").textContent=session.sourceLabel||currentScopeText();
 updateSessionBadges();keepFocus()
}
function updateSessionBadges(){
 var done=Object.keys(session.seen).length,total=session.pool.length,quote=session.attempts?Math.round(session.correct/session.attempts*100):0;
 $("bigProgress").textContent=done+" / "+total;
 $("bigQuote").textContent=session.attempts?quote+" %":"–";
 $("progressFill").style.width=(total?Math.min(100,done/total*100):0)+"%"
}
function keepFocus(){setTimeout(function(){if(!$("trainerView").hidden&&session.active&&!session.awaitingChoice){try{$("answer").focus({preventScroll:true})}catch(e){$("answer").focus()}}},30)}
function nextDue(level){
 var days=[0,1,2,4,7,14][Math.max(0,Math.min(5,level))],d=new Date();d.setDate(d.getDate()+days);return d.toISOString()
}
function evaluateAnswer(v,d,g){
 if(d==="DE_FR"){
  // Satzzeichen, Leerzeichen und Akzente werden komplett ignoriert.
  if(looseNorm(g)===looseNorm(v.foreign))return{kind:"correct",reason:"",canOverride:false};

  // Ein fehlender/anderer Artikel ist nur eine kleine Abweichung.
  if(looseNorm(stripFrenchArticle(g))===looseNorm(stripFrenchArticle(v.foreign))){
   return{kind:"almost",reason:"Nur der Artikel unterscheidet sich.",canOverride:true}
  }

  // Kleine Tipp-/Scribble-Abweichungen dürfen vom Lernenden selbst als gewusst markiert werden.
  if(nearEnough(g,v.foreign)){
   return{kind:"almost",reason:"Nur eine kleine Schreibabweichung.",canOverride:true}
  }
  return{kind:"wrong",reason:"",canOverride:false}
 }

 if(germanAccepted(v,g))return{kind:"correct",reason:"",canOverride:false};
 if(germanNear(v,g))return{kind:"almost",reason:"Nur eine kleine Schreibabweichung.",canOverride:true};
 return{kind:"wrong",reason:"",canOverride:false}
}
async function recordResult(v,d,kind){
 var p=await gp(v.id);
 p.attempts++;p.lastPracticedAt=new Date().toISOString();
 if(d==="DE_FR")p.attemptsDEFR++;else p.attemptsFRDE++;
 if(kind==="correct"){
  p.correct++;
  if(d==="DE_FR"){p.correctDEFR++;p.deFr=Math.min(5,p.deFr+1);p.dueDEFR=nextDue(p.deFr)}
  else{p.correctFRDE++;p.frDe=Math.min(5,p.frDe+1);p.dueFRDE=nextDue(p.frDe)}
 }else if(kind==="almost"){
  p.almost++;
  if(d==="DE_FR"){p.almostDEFR++;p.dueDEFR=nextDue(Math.max(0,p.deFr))}
  else{p.almostFRDE++;p.dueFRDE=nextDue(Math.max(0,p.frDe))}
 }else{
  p.wrong++;
  if(d==="DE_FR"){p.wrongDEFR++;p.deFr=Math.max(0,p.deFr-1);p.dueDEFR=nextDue(0)}
  else{p.wrongFRDE++;p.frDe=Math.max(0,p.frDe-1);p.dueFRDE=nextDue(0)}
 }
 await sp(p);return p
}
async function checkAnswer(){
 if(!session.active||!session.current||session.awaitingChoice)return;
 if(session.currentResolved){await chooseNext();return}
 var v=session.current,d=session.currentDirection,g=norm($("answer").value),fb=$("feedback");
 if(!g){fb.className="feedback almost";fb.textContent="Bitte zuerst antworten.";keepFocus();return}
 var result=evaluateAnswer(v,d,g),expected=d==="DE_FR"?v.foreign:v.meanings.join(" / ");
 var p=await recordResult(v,d,result.kind);
 session.lastResult={id:v.id,direction:d,kind:result.kind,canOverride:!!result.canOverride};
 session.attempts++;if(result.kind==="correct"){session.correct++}
 session.seen[v.id]=true;session.currentResolved=true;
 session.testResults.push({id:v.id,kind:result.kind,direction:d,prompt:d==="DE_FR"?v.meanings.join(" / "):v.foreign,expected:expected});
 updateSessionBadges();


 $("nearMissActions").hidden=!(result.kind==="almost"&&result.canOverride);
 if(result.kind==="correct"){fb.className="feedback good";fb.innerHTML="✓ Richtig: <strong>"+escapeHtml(expected)+"</strong>"}
 else if(result.kind==="almost"){fb.className="feedback almost";fb.innerHTML="Fast richtig – "+escapeHtml(result.reason)+"<br>Richtig: <strong>"+escapeHtml(expected)+"</strong>"}
 else{fb.className="feedback bad";fb.innerHTML="✗ Noch nicht richtig.<br>Richtig: <strong>"+escapeHtml(expected)+"</strong>"}
 if(result.kind!=="correct"||!$("autoNext").checked)$("check").textContent="Weiter";
 keepFocus();
 if(result.kind==="correct"&&$("autoNext").checked){clearTimeout(autoTimer);autoTimer=setTimeout(function(){chooseNext()},750)}
}
async function markCurrentKnown(){
 var lr=session.lastResult;
 if(!session.active||!session.current||!lr||lr.id!==session.current.id||lr.kind!=="almost"||!lr.canOverride)return;

 var p=await gp(lr.id),d=lr.direction;

 // Bereits gespeichertes "fast richtig" sauber in "richtig" umwandeln,
 // ohne eine zweite Abfrage zu erzeugen.
 p.almost=Math.max(0,p.almost-1);
 p.correct++;
 if(d==="DE_FR"){
  p.almostDEFR=Math.max(0,p.almostDEFR-1);
  p.correctDEFR++;
  p.deFr=Math.min(5,p.deFr+1);
  p.dueDEFR=nextDue(p.deFr)
 }else{
  p.almostFRDE=Math.max(0,p.almostFRDE-1);
  p.correctFRDE++;
  p.frDe=Math.min(5,p.frDe+1);
  p.dueFRDE=nextDue(p.frDe)
 }
 await sp(p);

 session.correct++;
 lr.kind="correct";lr.canOverride=false;

 // Auch den letzten Session-Eintrag korrigieren.
 for(var i=session.testResults.length-1;i>=0;i--){
  if(session.testResults[i].id===lr.id){
   session.testResults[i].kind="correct";
   break
  }
 }

 $("nearMissActions").hidden=true;
 $("feedback").className="feedback good";
 $("feedback").innerHTML="✓ Als richtig übernommen.";
 updateSessionBadges();

 if($("autoNext").checked){
  clearTimeout(autoTimer);
  autoTimer=setTimeout(function(){chooseNext()},650)
 }else{
  $("check").textContent="Weiter";
  keepFocus()
 }
}

async function skipCurrent(){
 $("nearMissActions").hidden=true;
 if(!session.active||!session.current||session.awaitingChoice)return;
 var v=session.current,d=session.currentDirection;
 if(!session.seen[v.id]){
  await recordResult(v,d,"wrong");session.attempts++;session.seen[v.id]=true;
  session.testResults.push({id:v.id,kind:"wrong",direction:d,prompt:d==="DE_FR"?v.meanings.join(" / "):v.foreign,expected:d==="DE_FR"?v.foreign:v.meanings.join(" / ")});
  updateSessionBadges()
 }
 await chooseNext()
}
async function revealCurrent(){
 $("nearMissActions").hidden=true;
 if(!session.active||!session.current||session.awaitingChoice)return;
 var v=session.current,d=session.currentDirection;
 $("feedback").className="feedback almost";
 $("feedback").innerHTML="Antwort: <strong>"+escapeHtml(d==="DE_FR"?v.foreign:v.meanings.join(" / "))+"</strong><br><span class='small'>Als nicht gewusst markiert.</span>";
 if(!session.seen[v.id]){
  await recordResult(v,d,"wrong");session.attempts++;session.seen[v.id]=true;session.currentResolved=true;updateSessionBadges()
 }
 $("check").textContent="Weiter";keepFocus()
}
function showView(name){
 var views=["home","learn","trainer","plan","overview","vocab","data"];
 views.forEach(function(x){$(x+"View").hidden=x!==name});
 ["home","learn","plan","overview","vocab","data"].forEach(function(x){
  var tab=$("tab"+x[0].toUpperCase()+x.slice(1));if(tab)tab.classList.toggle("active",x===name)
 });
 document.body.classList.toggle("trainer-mode",name==="trainer");
 if(name!=="trainer")document.documentElement.lang="de";
 if(name==="home")renderHome();
 if(name==="overview")renderOverview();
 if(name==="vocab")renderVocab();
 if(name==="plan")renderExamSummary()
}

function populateCourseSelector(){
 var sel=$("activeCourseSelect");if(!sel)return;
 var old=activeCourseId(),used=usedCourseIds();sel.innerHTML="";
 if(!used.length){
  var o=document.createElement("option");o.value="";o.textContent="Noch kein Kurs – bitte Vokabeln importieren";sel.appendChild(o);sel.disabled=true;return
 }
 sel.disabled=false;
 used.map(function(id){return{id:id,name:courseName(id)}}).sort(function(a,b){return a.name.localeCompare(b.name,"de")}).forEach(function(c){
  var o=document.createElement("option");o.value=c.id;o.textContent=c.name;sel.appendChild(o)
 });
 if(old&&used.indexOf(old)>=0)sel.value=old;else{setActiveCourse(used[0]);sel.value=used[0]}
}
function updateCourseLabels(){
 var name=courseName(activeCourseId());$("activeCourseBadge").textContent=name;$("homeCourseLabel").textContent=name
}
async function renderHome(){
 populateCourseSelector();updateCourseLabels();
 var cid=activeCourseId(),all=cid?vocab.filter(function(v){return v.courseId===cid}):[];
 $("homeTotal").textContent=all.length;
 var n=0,d=0,w=0;
 for(var i=0;i<all.length;i++){
  var p=await gp(all[i].id);if(p.attempts===0)n++;if(isDue(p))d++;if(p.attempts>0&&Math.min(p.deFr,p.frDe)<=1)w++
 }
 $("homeNew").textContent=n;$("homeDue").textContent=d;$("homeWeak").textContent=w;
 var e=cid?await reqP(os(S_EXAMS).get(cid)):null;
 if(e&&e.date){
  var days=Math.max(0,Math.ceil((new Date(e.date+"T12:00:00")-new Date())/86400000));
  $("homeExamText").textContent="Klassenarbeit in "+days+" Tag"+(days===1?"":"en")+" · Lernpensum planen"
 }else $("homeExamText").textContent="Stoff und Lernpensum planen";
 $("appStatus").textContent="✓ Version 4.3 läuft · "+(cid?courseName(cid)+" · "+all.length+" Vokabeln":"noch keine Vokabeln importiert")
}
async function switchActiveCourse(id){
 setActiveCourse(id);saveSettings();populateAllSelectors();updateCourseLabels();await renderHome()
}
function fmtDate(iso){if(!iso)return"–";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"}).format(new Date(iso))}catch(e){return"–"}}

function successPercent(p){
 if(!p||!p.attempts)return null;
 return Math.max(0,Math.min(100,Math.round((p.correct+0.5*p.almost)/p.attempts*100)))
}
async function renderOverview(){
 var body=$("overviewBody");body.innerHTML="";
 if(!activeCourseId())return;
 var list=filtered(activeCourseId(),$("overviewUnit").value,$("overviewPart").value),rows=[];
 for(var i=0;i<list.length;i++){var v=list[i],p=await gp(v.id);rows.push({v:v,p:p,pct:successPercent(p)})}
 var mode=$("overviewSort").value;
 if(mode==="weakest")rows.sort(function(a,b){return(a.pct===null?-1:a.pct)-(b.pct===null?-1:b.pct)});
 else if(mode==="strongest")rows.sort(function(a,b){return(b.pct===null?-1:b.pct)-(a.pct===null?-1:a.pct)});
 else if(mode==="french")rows.sort(function(a,b){return a.v.foreign.localeCompare(b.v.foreign,"fr")});
 else if(mode==="german")rows.sort(function(a,b){return a.v.meanings.join(" / ").localeCompare(b.v.meanings.join(" / "),"de")});
 rows.forEach(function(r){
  var tr=document.createElement("tr"),fr=document.createElement("td"),de=document.createElement("td"),success=document.createElement("td");
  fr.textContent=r.v.foreign;de.textContent=r.v.meanings.join(" / ");
  var wrap=document.createElement("div");wrap.className="success-wrap";
  var bar=document.createElement("div");bar.className="success-bar"+(r.pct===null?" new":"");
  var txt=document.createElement("div");txt.className="success-text"+(r.pct===null?" new":"");
  if(r.pct===null)txt.textContent="neu";
  else{var marker=document.createElement("span");marker.className="success-marker";marker.style.left=r.pct+"%";bar.appendChild(marker);txt.textContent=r.pct+" %"}
  wrap.appendChild(bar);wrap.appendChild(txt);success.appendChild(wrap);tr.appendChild(fr);tr.appendChild(de);tr.appendChild(success);body.appendChild(tr)
 })
}

async function renderVocab(){
 var q=norm($("vocabSearch").value),box=$("vocabList");box.innerHTML="";
 if(!q){$("vocabSearchInfo").textContent="Tippe Buchstaben ein. Gesucht wird gleichzeitig in Französisch und Deutsch.";return}
 var matches=vocab.filter(function(v){return v.courseId===activeCourseId()&&norm(v.foreign+" "+v.meanings.join(" ")).includes(q)})
  .sort(function(a,b){
   var af=norm(a.foreign),bf=norm(b.foreign),am=norm(a.meanings.join(" ")),bm=norm(b.meanings.join(" "));
   var as=(af.startsWith(q)||am.startsWith(q))?0:1,bs=(bf.startsWith(q)||bm.startsWith(q))?0:1;
   return as-bs||af.localeCompare(bf,"fr")
  });
 $("vocabSearchInfo").textContent=matches.length+" Treffer"+(matches.length===1?"":".");
 matches.slice(0,200).forEach(function(v){
  var row=document.createElement("div");row.className="vocab-item";
  var btn=document.createElement("button");btn.type="button";btn.className="vocab-hit";
  btn.innerHTML="<span class='vocab-hit-main'><strong>"+escapeHtml(v.foreign)+"</strong><span>"+escapeHtml(v.meanings.join(" / "))+
   "</span><span class='muted'>"+escapeHtml(unitLabel(unitGroup(v))+" · "+partLabel(partGroup(v)))+
   "</span></span><span class='vocab-hit-arrow'>›</span>";
  btn.onclick=function(){editVocab(v.id)};row.appendChild(btn);box.appendChild(row)
 });
 if(matches.length>200){var note=document.createElement("div");note.className="small";note.textContent="Es werden die ersten 200 Treffer angezeigt. Suche genauer.";box.appendChild(note)}
}
function unitIdFromSelection(unit,part){return unit}
function populateEditParts(){
 var unit=$("editUnit").value;populatePart($("editPart"),activeCourseId(),unit,false);
 if(/^module-[a-z]$/.test(unit))$("editPartLabel").hidden=true;
 else{$("editPartLabel").hidden=false;if(!$("editPart").value&&$("editPart").options.length)$("editPart").selectedIndex=0}
 updateEditLocation()
}
function updateEditLocation(){
 var unit=$("editUnit").value,part=/^module-[a-z]$/.test(unit)?"gesamtes Modul":partLabel($("editPart").value);
 $("editLocation").textContent="Ablage: "+unitLabel(unit)+" · "+part
}
function newVocab(){
 if(!activeCourseId()){alert("Bitte zuerst einen Kurs importieren.");return}
 $("editTitle").textContent="Neue Vokabel";$("editId").value="";$("editForeign").value="";$("editMeanings").value="";
 populateUnit($("editUnit"),activeCourseId(),false);populateEditParts();$("deleteVocab").hidden=true;$("editModal").hidden=false;
 setTimeout(function(){$("editForeign").focus()},30)
}
function editVocab(id){
 var v=vocab.find(function(x){return x.id===id});if(!v)return;
 $("editTitle").textContent="Vokabel bearbeiten";$("editId").value=v.id;$("editForeign").value=v.foreign;$("editMeanings").value=v.meanings.join("; ");
 populateUnit($("editUnit"),activeCourseId(),false);var ug=unitGroup(v);$("editUnit").value=ug;populateEditParts();
 if(!/^module-[a-z]$/.test(ug)){var pg=partGroup(v);if([].slice.call($("editPart").options).some(function(o){return o.value===pg}))$("editPart").value=pg}
 updateEditLocation();$("deleteVocab").hidden=false;$("editModal").hidden=false;setTimeout(function(){$("editForeign").focus()},30)
}
function closeEditModal(){$("editModal").hidden=true}
async function saveEdit(){
 var id=$("editId").value,foreign=$("editForeign").value.trim(),meanings=$("editMeanings").value.split(";").map(function(x){return x.trim()}).filter(Boolean);
 if(!foreign||!meanings.length){alert("Bitte sowohl Französisch als auch mindestens eine deutsche Bedeutung eintragen.");return}
 var existing=id?vocab.find(function(x){return x.id===id}):null;
 var v=existing||{id:"manual-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),courseId:activeCourseId(),userCreated:true};
 v.foreign=foreign;v.meanings=meanings;v.courseId=activeCourseId();
 var selectedUnit=$("editUnit").value;
 v.unitId=selectedUnit;
 v.part=/^module-[a-z]$/.test(selectedUnit)?"alle":(selectedUnit==="unite-0"?"auftakt":$("editPart").value||"sonstiges");
 v.userEdited=true;v.userEditedAt=new Date().toISOString();
 await reqP(os(S_VOCAB,"readwrite").put(v));await reload();populateAllSelectors();closeEditModal();await renderVocab()
}
async function deleteVocab(){
 var id=$("editId").value;if(!id)return;
 var v=vocab.find(function(x){return x.id===id});if(!v)return;
 if(!confirm('Vokabel "'+v.foreign+'" wirklich löschen? Der zugehörige Lernstand wird ebenfalls gelöscht.'))return;
 await reqP(os(S_VOCAB,"readwrite").delete(id));await reqP(os(S_PROGRESS,"readwrite").delete(id));
 await reload();populateAllSelectors();closeEditModal();await renderVocab()
}

function scopeCatalog(){
 var out=[],units=unitsForCourse(activeCourseId());
 units.forEach(function(u){
  if(/^module-[a-z]$/.test(u))out.push({key:u+"|alle",unit:u,part:"alle",label:unitLabel(u)});
  else partsFor(activeCourseId(),u).forEach(function(p){out.push({key:u+"|"+p,unit:u,part:p,label:unitLabel(u)+" · "+partLabel(p)})})
 });
 return out
}
function populateExamScopes(selected){
 var box=$("examScopeList"),set=new Set(selected||[]);box.innerHTML="";
 scopeCatalog().forEach(function(s){
  var label=document.createElement("label");label.className="scope-option";
  var cb=document.createElement("input");cb.type="checkbox";cb.value=s.key;cb.checked=set.has(s.key);
  var span=document.createElement("span");span.textContent=s.label;label.appendChild(cb);label.appendChild(span);box.appendChild(label)
 })
}
function selectedExamScopes(){return [].slice.call($("examScopeList").querySelectorAll('input[type="checkbox"]:checked')).map(function(x){return x.value})}
function poolForScopes(scopes){
 var ids=new Set(),out=[];
 (scopes||[]).forEach(function(key){
  var a=key.split("|"),list=filtered(activeCourseId(),a[0],a[1]);
  list.forEach(function(v){if(!ids.has(v.id)){ids.add(v.id);out.push(v)}})
 });
 return out
}
function oldExamScopes(e){return e&&e.scopes&&e.scopes.length?e.scopes:(e&&e.unit?[e.unit+"|"+(e.part||"alle")]:[])}
async function computeExamStats(pool,date){
 var days=Math.max(0,Math.ceil((new Date(date+"T12:00:00")-new Date())/86400000)),newCount=0,weak=0,due=0,focus=0;
 for(var i=0;i<pool.length;i++){
  var p=await gp(pool[i].id),n=p.attempts===0,w=Math.min(p.deFr,p.frDe)<=1,d=isDue(p);
  if(n)newCount++;if(w)weak++;if(d)due++;if(n||w||d)focus++
 }
 var studyDays=Math.max(1,days);
 var dailyTarget=pool.length?Math.max(1,Math.ceil(pool.length/studyDays)):0;
 return{days:days,newCount:newCount,weak:weak,due:due,focus:focus,dailyTarget:dailyTarget}
}
async function saveExam(){
 var date=$("examDate").value,scopes=selectedExamScopes();
 if(!date)return alert("Bitte Datum wählen.");
 if(!scopes.length)return alert("Bitte mindestens einen Stoffbereich markieren.");
 await reqP(os(S_EXAMS,"readwrite").put({id:activeCourseId(),courseId:activeCourseId(),date:date,scopes:scopes}));
 await renderExamSummary()
}
async function deleteExam(){
 await reqP(os(S_EXAMS,"readwrite").delete(activeCourseId()));$("examDate").value="";populateExamScopes([]);$("examSummary").innerHTML="Für "+courseName(activeCourseId())+" ist noch keine Klassenarbeit gespeichert."
}
async function renderExamSummary(){
 var e=await reqP(os(S_EXAMS).get(activeCourseId())),box=$("examSummary");
 if(!e){populateExamScopes([]);box.innerHTML="Für "+courseName(activeCourseId())+" ist noch keine Klassenarbeit gespeichert.";return}
 $("examDate").value=e.date;var scopes=oldExamScopes(e);populateExamScopes(scopes);
 var pool=poolForScopes(scopes),st=await computeExamStats(pool,e.date);
 box.innerHTML="<strong>"+courseName(activeCourseId())+" · "+scopes.length+" Stoffbereich"+(scopes.length===1?"":"e")+"</strong><br>"+
  "Klassenarbeit: "+escapeHtml(e.date)+" · noch "+st.days+" Tage<br>"+pool.length+" verschiedene Vokabeln im Stoff · "+
  st.newCount+" noch nie geübt · "+st.weak+" schwach · "+st.due+" fällig.<br>"+
  "<strong>Richtwert heute: "+st.dailyTarget+" verschiedene Vokabeln</strong>, damit der gesamte Stoff bis zur Arbeit mindestens einmal durchläuft."
}
async function startExamLearning(){
 var e=await reqP(os(S_EXAMS).get(activeCourseId()));if(!e)return alert("Bitte zuerst eine Klassenarbeit speichern.");
 var pool=poolForScopes(oldExamScopes(e)),st=await computeExamStats(pool,e.date);if(!pool.length)return alert("Im gespeicherten Stoff wurden keine Vokabeln gefunden.");
 pool=await priorityPool(pool);pool=pool.slice(0,Math.min(pool.length,Math.max(1,st.dailyTarget)));
 await startCustomSession(pool,"Klassenarbeit · heutiges Pensum")
}

function downloadJson(obj,name){
 var b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),u=URL.createObjectURL(b),a=document.createElement("a");
 a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},1000)
}
async function exportBackup(filename){
 var entries=await reqP(os(S_VOCAB).getAll()),progress=await reqP(os(S_PROGRESS).getAll()),exams=await reqP(os(S_EXAMS).getAll()),cs=await reqP(os(S_COURSES).getAll());
 downloadJson({backupType:"full-backup",appVersion:APP_VERSION,schemaVersion:6,exportedAt:new Date().toISOString(),courses:cs,entries:entries,progress:progress,exams:exams,settings:collectSettings()},filename||"vokabeltrainer-backup.json")
}
async function exportCurrentCourse(){
 var cid=activeCourseId();if(!cid)return alert("Kein Kurs ausgewählt.");
 var entries=vocab.filter(function(v){return v.courseId===cid}),c=courses.find(function(x){return x.id===cid})||{id:cid,name:courseName(cid)};
 var safe=(courseName(cid)||cid).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
 downloadJson({fileType:"vocabulary-course",schemaVersion:7,exportedAt:new Date().toISOString(),course:c,entries:entries},"vokabeltrainer-"+safe+".json")
}
async function parseJsonFile(file){
 var text;
 try{text=await file.text()}catch(e){throw new Error("Die Datei konnte nicht gelesen werden.")}
 var data;
 try{data=JSON.parse(text)}catch(e){throw new Error("Die Datei ist kein gültiges JSON.")}
 return data
}
function isFullBackup(data){
 return !!(data&&(
  data.backupType==="full-backup" ||
  (Array.isArray(data.courses)&&Array.isArray(data.entries)&&Array.isArray(data.progress)&&Array.isArray(data.exams))
 ))
}
async function importVocabularyFile(file){
 var data=await parseJsonFile(file);
 if(isFullBackup(data))throw new Error("Das ist ein komplettes Backup. Bitte unten „Backup wiederherstellen“ verwenden.");
 if(!data||Array.isArray(data)||!data.course||!data.course.id)throw new Error("Kursangabe fehlt. Jede Vokabeldatei muss course.id enthalten, z. B. „franzoesisch-6“.");
 var entries=data.entries;
 if(!Array.isArray(entries))throw new Error("Keine Vokabelliste gefunden. Erwartet wird ein Objekt mit „course“ und „entries“.");
 if(!entries.length)throw new Error("Die Vokabeldatei enthält 0 Einträge.");

 var importedCourse=String(data.course.id).trim(),courseLabel=String(data.course.label||data.course.name||importedCourse).trim();
 if(!importedCourse)throw new Error("course.id darf nicht leer sein.");
 if(!courseLabel)throw new Error("Der sichtbare Kursname fehlt.");

 var existingCourse=courses.find(function(c){return c.id===importedCourse});
 if(existingCourse){
  var existingName=String(existingCourse.label||existingCourse.name||existingCourse.id);
  if(norm(existingName)!==norm(courseLabel)){
   throw new Error('Kurs-ID "'+importedCourse+'" existiert bereits als "'+existingName+'". Import abgebrochen, damit keine Kurse vermischt werden.')
  }
 }

 if(!confirm(entries.length+" Vokabeln → "+courseLabel+" importieren?"))return;

 var unitNames=new Map();
 if(Array.isArray(data.units))data.units.forEach(function(u){if(u&&u.id)unitNames.set(String(u.id),u.name||u.label||String(u.id))});
 var existing=new Map(vocab.map(function(v){return[v.id,v]})),added=0,skipped=0,invalid=0,generatedIds=0,enriched=0;

 function canonicalLocation(e){
  var original=String(e.unitId||""),unit=original,part=e.part||null,section=e.sectionName||e.unitName||unitNames.get(original)||null;

  // Legacy-Datei Französisch 6, Buchseiten 176–178: Auftakt vor Unité 1.
  if(importedCourse==="franzoesisch-6" && (/^p17[678]-/.test(original)||(Number(e.page)>=176&&Number(e.page)<=178))){
   return{unitId:"unite-0",part:"auftakt",sectionName:section||original}
  }

  var old=original.match(/^(unite-\d+)-(auftakt|vocabulaire-thematique|volet-1|volet-2)$/);
  if(old){unit=old[1];part=part||old[2]}

  if(/^module-[a-z]$/.test(unit))part="alle";
  if(/^unite-\d+$/.test(unit)&&!part)part="sonstiges";
  return{unitId:unit,part:part||"sonstiges",sectionName:section}
 }
 function makeId(e,loc,index){
  var raw=(importedCourse+"-"+loc.unitId+"-"+loc.part+"-"+(e.foreign||"vokabel")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
   .replace(/[’'`´]/g,"-").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,100);
  if(!raw)raw=importedCourse+"-vokabel-"+index;var id=raw,n=2;while(existing.has(id)){id=raw+"-"+n;n++}return id
 }

 for(var i=0;i<entries.length;i++){
  var e=entries[i];
  if(!e||!e.foreign||!e.unitId){invalid++;continue}
  var meanings=Array.isArray(e.meanings)?e.meanings:(e.meaning?[e.meaning]:[]);
  meanings=meanings.map(function(x){return String(x).trim()}).filter(Boolean);
  if(!meanings.length){invalid++;continue}

  var loc=canonicalLocation(e);
  if(!/^unite-\d+$/.test(loc.unitId)&&!/^module-[a-z]$/.test(loc.unitId)){invalid++;continue}

  var id=e.id?String(e.id):makeId(e,loc,i+1);if(!e.id)generatedIds++;
  if(existing.has(id)){
   var oldv=existing.get(id);
   if(oldv.courseId===importedCourse){
    var dirty=false;
    if(!oldv.sectionName&&loc.sectionName){oldv.sectionName=loc.sectionName;dirty=true}
    if(dirty){await reqP(os(S_VOCAB,"readwrite").put(oldv));enriched++}
   }
   skipped++;continue
  }

  var v=Object.assign({},e,{
   id:id,courseId:importedCourse,unitId:loc.unitId,part:loc.part,sectionName:loc.sectionName,
   foreign:String(e.foreign).trim(),meanings:meanings,importedAt:new Date().toISOString()
  });
  delete v.unitName;
  await reqP(os(S_VOCAB,"readwrite").put(v));existing.set(id,v);added++
 }

 var c=Object.assign({},data.course,{id:importedCourse,name:data.course.name||courseLabel,label:courseLabel});
 await reqP(os(S_COURSES,"readwrite").put(c));

 await reload();setActiveCourse(importedCourse);populateCourseSelector();populateAllSelectors();updateCourseLabels();saveSettings();
 $("vocabImportResult").textContent=added+" neue Vokabeln → "+courseLabel+" · "+skipped+" bereits vorhanden · "+invalid+" ungültig"+
  (generatedIds?" · "+generatedIds+" IDs automatisch erzeugt":"")+(enriched?" · "+enriched+" Metadaten ergänzt":"")+".";
 await renderHome();await renderOverview()
}
async function restoreBackupFile(file){
 var data=await parseJsonFile(file);
 if(!isFullBackup(data))throw new Error("Diese Datei ist kein vollständiges Backup. Vokabeldateien bitte oben additiv einlesen.");
 if(!confirm("Backup wirklich wiederherstellen? Der aktuelle lokale Datenbestand wird vollständig ersetzt."))return;
 var stores=[S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS];
 for(var i=0;i<stores.length;i++)await reqP(os(stores[i],"readwrite").clear());
 async function putAll(store,arr){
  arr=Array.isArray(arr)?arr:[];
  if(!arr.length)return;
  var tx=db.transaction(store,"readwrite"),s=tx.objectStore(store);arr.forEach(function(x){if(x&&x.id)s.put(x)});
  await new Promise(function(res,rej){tx.oncomplete=res;tx.onerror=function(){rej(tx.error)}})
 }
 await putAll(S_VOCAB,data.entries);await putAll(S_PROGRESS,data.progress);await putAll(S_COURSES,data.courses);await putAll(S_EXAMS,data.exams);
 if(data.settings){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(data.settings))}catch(e){}}
 await reload();applySettings(data.settings||loadSavedSettings());populateCourseSelector();populateAllSelectors();await renderOverview();await renderExamSummary();
 $("backupResult").textContent="Backup vollständig wiederhergestellt: "+data.entries.length+" Vokabeln und "+(data.progress||[]).length+" Lernstände.";
 await startSession()
}
async function resetAll(){
 if(!confirm("Alle lokalen Vokabeln, Lernstände, Kurse und Klassenarbeiten wirklich löschen?"))return;
 for(var s of [S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS])await reqP(os(s,"readwrite").clear());
 try{localStorage.removeItem(SETTINGS_KEY);localStorage.removeItem(ACTIVE_COURSE_KEY)}catch(e){}
 ACTIVE_COURSE_ID=null;await reload();populateCourseSelector();populateAllSelectors();populateExamScopes([]);
 session.active=false;showView("home");await renderHome()
}

function populateAllSelectors(){
 var cid=activeCourseId();
 populateUnit($("unitSelect"),cid,true);populatePart($("partSelect"),cid,$("unitSelect").value,true);
 populateUnit($("overviewUnit"),cid,true);populatePart($("overviewPart"),cid,$("overviewUnit").value,true);
 populateExamScopes([])
}
function bindUnitPart(unitId,partId,afterChange){
 $(unitId).addEventListener("change",function(){populatePart($(partId),activeCourseId(),$(unitId).value,true);saveSettings();if(afterChange)afterChange()});
 $(partId).addEventListener("change",function(){saveSettings();if(afterChange)afterChange()})
}


function scheduleExactAutoCheck(){
 clearTimeout(correctDetectTimer);
 if(!$("autoDetectCorrect").checked||!session.active||session.currentResolved||session.awaitingChoice||!session.current)return;
 var currentId=session.current.id,currentText=$("answer").value;
 if(!norm(currentText))return;
 correctDetectTimer=setTimeout(async function(){
  if(!session.active||session.currentResolved||session.awaitingChoice||!session.current||session.current.id!==currentId)return;
  if($("answer").value!==currentText)return;
  var result=evaluateAnswer(session.current,session.currentDirection,norm(currentText));
  if(result.kind==="correct")await checkAnswer()
 },550)
}
function preserveAnswerFocusOnButton(id){
 var el=$(id);if(!el)return;
 el.addEventListener("pointerdown",function(e){
  if(!$("trainerView").hidden)e.preventDefault()
 })
}
$("answer").addEventListener("input",scheduleExactAutoCheck);
$("answer").addEventListener("keydown",function(e){
 if(e.key==="Enter"&&!e.shiftKey){
  e.preventDefault();clearTimeout(correctDetectTimer);
  if(session.currentResolved)chooseNext();else checkAnswer()
 }
});
$("answer").addEventListener("blur",function(){
 setTimeout(function(){if(!$("trainerView").hidden&&session.active&&!session.awaitingChoice)keepFocus()},60)
});
["check","showAnswer","markKnown","continueWeak","endSession"].forEach(preserveAnswerFocusOnButton);

$("startNew").onclick=startNewSession;
$("startWeak").onclick=startWeakSession;
$("check").onclick=checkAnswer;
$("showAnswer").onclick=revealCurrent;
$("markKnown").onclick=markCurrentKnown;
$("newRound").onclick=startAnotherRound;
$("endSession").onclick=endSession;

$("tabHome").onclick=function(){showView("home")};
$("tabLearn").onclick=function(){showView("learn")};
$("tabPlan").onclick=function(){showView("plan")};
$("tabOverview").onclick=function(){showView("overview")};
$("tabVocab").onclick=function(){showView("vocab")};
$("tabData").onclick=function(){showView("data")};
$("activeCourseSelect").onchange=function(){switchActiveCourse(this.value)};
$("homeLearn").onclick=function(){showView("learn")};
$("homeDueLearn").onclick=function(){showView("learn")};
$("homePlan").onclick=function(){showView("plan")};
$("homeVocab").onclick=function(){showView("vocab")};
$("homeOverview").onclick=function(){showView("overview")};
$("homeData").onclick=function(){showView("data")};
$("leaveTrainer").onclick=function(){endSession()};

$("refreshOverview").onclick=renderOverview;
$("overviewSort").onchange=function(){saveSettings();renderOverview()};

$("vocabSearch").oninput=renderVocab;
$("newVocab").onclick=newVocab;
$("saveEdit").onclick=saveEdit;
$("cancelEdit").onclick=closeEditModal;
$("closeEdit").onclick=closeEditModal;
$("deleteVocab").onclick=deleteVocab;
$("editUnit").onchange=populateEditParts;
$("editPart").onchange=updateEditLocation;
$("editModal").addEventListener("click",function(e){if(e.target===$("editModal"))closeEditModal()});

$("saveExam").onclick=saveExam;
$("deleteExam").onclick=deleteExam;
$("startExamLearning").onclick=startExamLearning;
$("selectAllExamScopes").onclick=function(){[].slice.call($("examScopeList").querySelectorAll('input[type="checkbox"]')).forEach(function(x){x.checked=true})};
$("clearExamScopes").onclick=function(){[].slice.call($("examScopeList").querySelectorAll('input[type="checkbox"]')).forEach(function(x){x.checked=false})};

$("exportBackup").onclick=function(){exportBackup()};
$("exportCourse").onclick=exportCurrentCourse;
$("reset").onclick=resetAll;
$("vocabImportFile").onchange=async function(e){
 var f=e.target.files&&e.target.files[0];if(!f)return;
 try{await importVocabularyFile(f)}catch(err){$("vocabImportResult").textContent="Importfehler: "+err.message}
 e.target.value=""
};
$("backupRestoreFile").onchange=async function(e){
 var f=e.target.files&&e.target.files[0];if(!f)return;
 try{await restoreBackupFile(f)}catch(err){$("backupResult").textContent="Wiederherstellungsfehler: "+err.message}
 e.target.value=""
};

["orderSelect","directionSelect","distinctCount","autoNext","autoDetectCorrect"].forEach(function(id){
 $(id).addEventListener("change",saveSettings)
});

(async function(){
 try{
  db=await openDb();await prepareData();await reload();populateCourseSelector();populateAllSelectors();
  bindUnitPart("unitSelect","partSelect",null);bindUnitPart("overviewUnit","overviewPart",renderOverview);
  applySettings(loadSavedSettings());
  await renderExamSummary();
  showView("home");await renderHome()
 }catch(err){
  $("appStatus").textContent="Startfehler: "+err.message;$("appStatus").style.background="#fdeaea";console.error(err)
 }
})();
})();

if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("./sw.js").catch(function(){})})}
