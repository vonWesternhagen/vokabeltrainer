(function(){
"use strict";

var APP_VERSION="5.0.1";
var DB_NAME="VokabeltrainerTest";
var DB_VERSION=3;
var S_HISTORY="history",S_SNAPSHOTS="snapshots",historyWork=Promise.resolve();
var D=DataCore,cloud=null;
var S_VOCAB="vocab",S_PROGRESS="progress",S_COURSES="courses",S_EXAMS="exams";
var SETTINGS_KEY="vokabeltrainer.settings.v4";
var ACTIVE_COURSE_KEY="vokabeltrainer.activeCourse.v1";
var db=null,vocab=[],courses=[],autoTimer=null,correctDetectTimer=null,ACTIVE_COURSE_ID=null;
// Flüchtige Bedienzustände; gehören weder in Settings noch in ein Backup.
var examFormRevision=0;
var viewRevision=0,pendingStart=null,homeRender=0,overviewRender=0,examRender=0;
var answerWork=Promise.resolve(),editBusy=false;
var LEGACY_SEEDS={"le-projet":"le projet","le-metier":"le métier","le-domaine":"le domaine"};

var session={
 active:false,pool:[],firstQueue:[],seen:{},current:null,currentDirection:"DE_FR",
 attempts:0,correct:0,testResults:[],lastId:null,recentIds:[],firstRoundComplete:false,
 awaitingChoice:false,sourceLabel:"",currentResolved:false,lastResult:null
};

function $(id){return document.getElementById(id)}
function reqP(req){return new Promise(function(res,rej){req.onsuccess=function(){res(req.result)};req.onerror=function(){rej(req.error)}})}
function os(name,mode){return db.transaction(name,mode||"readonly").objectStore(name)}

function reportActionError(err){
 var target=!$("editModal").hidden?$("editLocation"):!$("trainerView").hidden?$("feedback"):!$("learnView").hidden?$("scopeInfo"):$("appStatus");
 target.textContent="Die Aktion konnte nicht abgeschlossen werden: "+(err&&err.message?err.message:String(err))+". Bitte erneut versuchen.";
 console.warn("Bedienaktion fehlgeschlagen:",err)
}
async function runAction(action){
 try{await historyWork;return Promise.resolve(action()).catch(reportActionError)}catch(err){reportActionError(err);return Promise.resolve()}
}
function cancelSession(){
 if(session.active)finishHistory(session,false);session.active=false;clearTimeout(autoTimer);clearTimeout(correctDetectTimer)
}
async function sessionAction(action){
 var owner=session;
 if(dataBusy||owner.busy||!owner.active)return;
 owner.busy=true;
 // Auch eine bereits begonnene Speicherung der vorigen Runde erst abschließen.
 var previous=answerWork,release;answerWork=new Promise(function(resolve){release=resolve});
 try{await previous;if(session===owner&&owner.active)await action(owner)}catch(err){if(session===owner&&owner.active)reportActionError(err)}
 finally{owner.busy=false;release()}
}
async function editAction(action){
 if(dataBusy)return;
 if(editBusy)return;editBusy=true;
 try{await runAction(action)}finally{editBusy=false}
}
function startIsCurrent(ticket){return pendingStart===ticket&&ticket.revision===viewRevision&&ticket.course===activeCourseId()}
async function beginLearning(action){
 if(dataBusy)return;
 if(pendingStart&&startIsCurrent(pendingStart))return;
 var ticket={revision:viewRevision,course:activeCourseId()};pendingStart=ticket;
 try{await action(ticket)}catch(err){if(startIsCurrent(ticket))reportActionError(err)}
 finally{if(pendingStart===ticket)pendingStart=null}
}

function openDb(){
 return new Promise(function(res,rej){
  var r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=function(e){
   var d=e.target.result;
   if(!d.objectStoreNames.contains(S_VOCAB))d.createObjectStore(S_VOCAB,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_PROGRESS))d.createObjectStore(S_PROGRESS,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_COURSES))d.createObjectStore(S_COURSES,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_EXAMS))d.createObjectStore(S_EXAMS,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_HISTORY))d.createObjectStore(S_HISTORY,{keyPath:"id"});
   if(!d.objectStoreNames.contains(S_SNAPSHOTS))d.createObjectStore(S_SNAPSHOTS,{keyPath:"id"});
  };
  r.onsuccess=function(){res(r.result)};
  r.onerror=function(){rej(r.error)}
 })
}

async function prepareData(){
 // Datenstruktur vereinheitlichen:
 // unitId = nur Unité/Modul, part = Teilbereich, sectionName = optionale Buch-Unterüberschrift.
 var all=await reqP(os(S_VOCAB).getAll());
 var changes=[];
 all.forEach(function(v){
  var dirty=false,uid=String(v.unitId||"");
  if(!v.foreign&&v.fr){v=D.normalize(v);dirty=true;}

  // Französisch 6, Seiten 176–178: Auftakt VOR Unité 1 => Unité 0.
  if(v.courseId==="franzoesisch-6" && (/^p17[678]-/.test(uid) || (Number(v.page)>=176&&Number(v.page)<=178))){
   if(!v.sectionName)v.sectionName=v.unitName||uid;
   if(v.unitId!=="unite-0"){v.unitId="unite-0";dirty=true}
   if(v.part!=="auftakt"){v.part="auftakt";dirty=true}
  }else{
   // Alte zusammengesetzte IDs wie unite-1-volet-1 werden sauber getrennt.
   var m=uid.match(/^(unite-\d+)-(auftakt|vocabulaire-thematique|volet-1|volet-2|volet-3)$/);
   if(m){
    v.unitId=m[1];v.part=m[2];dirty=true
   }else if(isModule(uid)){
    if(v.part!=="alle"){v.part="alle";dirty=true}
   }
  }
  if(dirty)changes.push(v)
 });
 if(changes.length){await storeLocalSnapshot("before-migration");await writeRecords([[S_VOCAB,changes]]);}
}
function usedCourseIds(){return Array.from(new Set(vocab.map(function(v){return v.courseId}).filter(Boolean)))}
function courseHasVocab(id){return !!id && vocab.some(function(v){return v.courseId===id})}
function activeCourseId(){return ACTIVE_COURSE_ID}
function courseName(id){
 var c=courses.find(function(x){return x.id===id});
 return c?(c.label||c.name||c.id):(id||"Noch kein Kurs")
}
function learningLocale(cid){var c=courses.find(function(x){return x.id===(cid||activeCourseId())});return c&&c.learningLocale||"fr-FR"}
function isEnglish(cid){return /^en(?:-|$)/i.test(learningLocale(cid))}
function foreignLanguage(cid){return isEnglish(cid)?"Englisch":"Französisch"}
function updateLanguageLabels(){
 var language=foreignLanguage();
 $("directionSelect").querySelector('[value="DE_FR"]').textContent="Deutsch → "+language;
 $("directionSelect").querySelector('[value="FR_DE"]').textContent=language+" → Deutsch";
 $("overviewSort").querySelector('[value="french"]').textContent=language+" A–Z";
 $("foreignHeading").textContent=language;$("editForeignLabel").textContent=language;
 $("vocabSearchHint").textContent="Suche auf Deutsch oder "+language+". Tippe anschließend auf einen Treffer.";
 $("editForeign").lang=learningLocale();
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
 return item.meanings.flatMap(D.germanVariants).some(function(m){
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
 item.meanings.flatMap(D.germanVariants).forEach(function(m){
  candidates.push(m);candidates.push(stripGermanArticle(m))
 });
 var inputs=[g,stripGermanArticle(g)];
 return inputs.some(function(x){return candidates.some(function(c){return nearEnough(x,c)})})
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})}

function isModule(unit){return /^module-([a-z]|[1-6])$/.test(unit)}
function isSectionless(unit){return isModule(unit)||unit==="irregular-verbs"}
function unitGroup(value){
 var unitId=typeof value==="object"&&value?value.unitId:value;
 unitId=String(unitId||"");
 var m=unitId.match(/^(unite-\d+)/);
 if(m)return m[1];
 if(isModule(unitId))return unitId;
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
 if(/volet-3/.test(unitId))return"volet-3";
 if(isSectionless(unitId))return"alle";
 return"sonstiges"
}
function unitLabel(x,cid){
 cid=cid||activeCourseId();
 if(x==="irregular-verbs")return"Unregelmäßige Verben";
 if(/^unit-\d+$/.test(x)){var c=courses.find(function(c){return c.id===cid}),u=(c&&c.units||[]).find(function(u){return u.id===x}),v=vocab.filter(function(v){return v.courseId===cid}).flatMap(function(v){return[v].concat(v.locations||[])}).find(function(v){return v.unitId===x&&v.unitName});return u&&(u.label||u.name)||v&&v.unitName||"Unit "+x.slice(5)}
 if(x==="alle")return"Alle Vokabeln";
 var um=String(x||"").match(/^unite-(\d+)$/);
 if(um)return"Unité "+um[1];
 var mm=String(x||"").match(/^module-([a-z]|[1-6])$/);
 if(mm)return(/^[1-6]$/.test(mm[1])?"Modul ":"Module ")+mm[1].toUpperCase();
 return x
}
function partLabel(x){
 return({"alle":"Alle Teilbereiche","auftakt":"Auftakt","vocabulaire-thematique":"Vocabulaire thématique","volet-1":"Volet 1","volet-2":"Volet 2","volet-3":"Volet 3","part-a":"Part A","part-b":"Part B","part-c":"Part C","story":"Story","sonstiges":"Sonstiges"})[x]||x
}

function fillSelect(sel,items,allLabel){
 if(!sel)return;
 var old=sel.value;sel.innerHTML="";
 if(allLabel!==null){var a=document.createElement("option");a.value="alle";a.textContent=allLabel||"Alle";sel.appendChild(a)}
 items.forEach(function(it){var o=document.createElement("option");o.value=it.value;o.textContent=it.label;sel.appendChild(o)});
 if([].slice.call(sel.options).some(function(o){return o.value===old}))sel.value=old
}
function unitsForCourse(courseId){
 return Array.from(new Set(vocab.filter(function(v){return courseId==="alle"||v.courseId===courseId}).flatMap(function(v){return [v].concat(v.locations||[]).map(unitGroup)})))
  .sort(function(a,b){
   var au=String(a).match(/^(?:unite|unit)-(\d+)$/),bu=String(b).match(/^(?:unite|unit)-(\d+)$/);
   if(au&&bu)return Number(au[1])-Number(bu[1]);
   if(au)return-1;if(bu)return 1;
   var am=String(a).match(/^module-([a-z]|[1-6])$/),bm=String(b).match(/^module-([a-z]|[1-6])$/);
   if(am&&bm)return am[1].localeCompare(bm[1],"de",{numeric:true});
   if(am)return-1;if(bm)return 1;
   return String(a).localeCompare(String(b))
  })
}
function populateUnit(sel,courseId,includeAll){
 var units=unitsForCourse(courseId);
 fillSelect(sel,units.map(function(x){return{value:x,label:unitLabel(x,courseId)}}),includeAll?"Alle Vokabeln":null);
 if(sel&&!sel.options.length){
  var empty=document.createElement("option");empty.value="";empty.textContent="Keine Bereiche vorhanden";sel.appendChild(empty)
 }
}
function partsFor(courseId,unit){
 if(isSectionless(unit)||unit==="unite-0")return unit==="unite-0"?["auftakt"]:[];
 return Array.from(new Set(vocab.filter(function(v){
  return(courseId==="alle"||v.courseId===courseId)
 }).flatMap(function(v){return [v].concat(v.locations||[]).filter(function(x){return unit==="alle"||unitGroup(x)===unit}).map(partGroup)}))).filter(function(x){return x!=="alle"}).sort(function(a,b){
  var order={"auftakt":1,"vocabulaire-thematique":2,"volet-1":3,"volet-2":4,"volet-3":5,"part-a":2,"part-b":3,"part-c":4,"story":5,"sonstiges":9};
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
 if(isSectionless(unit)){
  sel.innerHTML="";var mod=document.createElement("option");mod.value="alle";mod.textContent=unit==="irregular-verbs"?"Alle Formen":"gesamtes Modul";sel.appendChild(mod);sel.disabled=true;return
 }
 var parts=partsFor(courseId,unit);
 fillSelect(sel,parts.map(function(x){return{value:x,label:partLabel(x)}}),includeAll?"Alle Teilbereiche":null);
 sel.disabled=false
}
function filtered(courseId,unit,part){
 return vocab.filter(function(v){
  return(courseId==="alle"||v.courseId===courseId)&&[v].concat(v.locations||[]).some(function(x){return(unit==="alle"||unitGroup(x)===unit)&&(part==="alle"||partGroup(x)===part)})
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
 cancelSession();
 session={
  historyId:crypto.randomUUID(),startedAt:new Date().toISOString(),startedTick:performance.now(),courseId:activeCourseId(),durationMs:0,visibleTick:document.hidden?null:performance.now(),
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
async function startLearningMode(mode){return beginLearning(function(ticket){return prepareLearningMode(mode,ticket)})}
async function prepareLearningMode(mode,ticket){
 if(!activeCourseId()){$("scopeInfo").textContent="Bitte zuerst einen Kurs importieren oder auswählen.";return}
 var available=filtered(activeCourseId(),$("unitSelect").value,$("partSelect").value);
 if(!available.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine Vokabeln.";return}

 $("scopeInfo").textContent="Lernrunde wird vorbereitet …";
 var requested=parseInt($("distinctCount").value,10);
 if(!Number.isFinite(requested)||requested<1)requested=10;
 requested=Math.min(requested,available.length);

 var dir=$("directionSelect").value,order=$("orderSelect").value,pool=[],label=currentScopeText();
 if(mode==="new"){
  var result=await selectNewPool(available,requested,dir,order);if(!startIsCurrent(ticket))return;pool=result.pool;
  if(!pool.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine passenden Vokabeln.";return}
  label+=" · Neue Vokabeln";
  $("scopeInfo").textContent=result.newCount+" neue Vokabel"+(result.newCount===1?"":"n")+" · "+
   (pool.length-result.newCount)+" schwierige zum Auffüllen · "+pool.length+" insgesamt."
 }else{
  pool=await selectWeakPool(available,requested,dir,order);
  if(!startIsCurrent(ticket))return;
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

 resetSessionState(pool,label);
 showView("trainer");saveSettings();await chooseNext()
}

function chooseDirection(){
 if(session.current&&session.current.unitId==="irregular-verbs")return"DE_FR";
 var d=$("directionSelect").value;
 return d==="MIXED"?(Math.random()<.5?"DE_FR":"FR_DE"):d
}
async function chooseNext(){
 if(!session.active)return;
 clearTimeout(autoTimer);clearTimeout(correctDetectTimer);
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
 finishHistory(session,true);session.active=false;session.current=null;
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
 cancelSession();$("roundCompletePanel").hidden=true;$("trainerExercise").hidden=false;
 document.documentElement.lang="de";showView("home")
}

async function renderCurrent(){
 var v=session.current;if(!v)return;
 var d=session.currentDirection,fr=d==="DE_FR";
 session.currentResolved=false;session.lastResult=null;
 $("nearMissActions").hidden=true;
 clearTimeout(correctDetectTimer);
 $("check").textContent="Prüfen";
 $("prompt").textContent=fr?v.meanings.join(" / "):D.french(v).join(" / ");
 $("directionLabel").textContent=fr?"Deutsch → "+foreignLanguage(v.courseId):foreignLanguage(v.courseId)+" → Deutsch";
 $("answer").lang=fr?learningLocale(v.courseId):"de-DE";
 $("answer").setAttribute("lang",fr?learningLocale(v.courseId):"de-DE");
 document.documentElement.lang=fr?learningLocale(v.courseId).split("-")[0]:"de";
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
function keepFocus(){var owner=session;setTimeout(function(){var focused=document.activeElement;
 if(focused&&focused!==document.body&&focused!==$("answer")&&["startNew","startWeak","startExamLearning","check","showAnswer","markKnown","newRound"].indexOf(focused.id)<0)return;
 if(session===owner&&!$("trainerView").hidden&&session.active&&!session.awaitingChoice){try{$("answer").focus({preventScroll:true})}catch(e){$("answer").focus()}}},30)}
function nextDue(level){
 var days=[0,1,2,4,7,14][Math.max(0,Math.min(5,level))],d=new Date();d.setDate(d.getDate()+days);return d.toISOString()
}
function evaluateAnswer(v,d,g){
 if(d==="DE_FR"&&isEnglish(v.courseId)){
  var kind=D.englishCompare(v,g);
  if(kind==="correct")return{kind:kind,reason:"",canOverride:false};
  if(kind==="almost")return{kind:kind,reason:"Nur der Artikel unterscheidet sich.",canOverride:true};
  if(v.unitId!=="irregular-verbs"&&D.french(v).flatMap(D.englishVariants).some(function(x){return nearEnough(g,x)}))return{kind:"almost",reason:"Nur eine kleine Schreibabweichung.",canOverride:true};
  return{kind:"wrong",reason:"",canOverride:false};
 }
 if(d==="DE_FR"){
  // Satzzeichen, Leerzeichen und Akzente werden komplett ignoriert.
  if(D.french(v).some(function(x){return looseNorm(g)===looseNorm(x)}))return{kind:"correct",reason:"",canOverride:false};

  // Ein fehlender/anderer Artikel ist nur eine kleine Abweichung.
  if(D.french(v).some(function(x){return looseNorm(stripFrenchArticle(g))===looseNorm(stripFrenchArticle(x))})){
   return{kind:"almost",reason:"Nur der Artikel unterscheidet sich.",canOverride:true}
  }

  // Kleine Tipp-/Scribble-Abweichungen dürfen vom Lernenden selbst als gewusst markiert werden.
  if(D.french(v).some(function(x){return nearEnough(g,x)})){
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
async function checkAnswer(){return sessionAction(checkAnswerNow)}
async function checkAnswerNow(owner){
 if(!session.active||!session.current||session.awaitingChoice)return;
 if(session.currentResolved){await chooseNext();return}
 var v=session.current,d=session.currentDirection,g=norm($("answer").value),fb=$("feedback");
 if(!g){fb.className="feedback almost";fb.textContent="Bitte zuerst antworten.";keepFocus();return}
 var result=evaluateAnswer(v,d,g),expected=d==="DE_FR"?D.french(v).join(" / "):v.meanings.join(" / ");
 var p=await recordResult(v,d,result.kind);
 if(session!==owner||!owner.active)return;
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
 if(result.kind==="correct"&&$("autoNext").checked){clearTimeout(autoTimer);autoTimer=setTimeout(function(){if(session===owner&&owner.active)runAction(chooseNext)},750)}
}
async function markCurrentKnown(){return sessionAction(markCurrentKnownNow)}
async function markCurrentKnownNow(owner){
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
 if(session!==owner||!owner.active)return;

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
  autoTimer=setTimeout(function(){if(session===owner&&owner.active)runAction(chooseNext)},650)
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
  session.testResults.push({id:v.id,kind:"wrong",direction:d,prompt:d==="DE_FR"?v.meanings.join(" / "):v.foreign,expected:d==="DE_FR"?D.french(v).join(" / "):v.meanings.join(" / ")});
  updateSessionBadges()
 }
 await chooseNext()
}
async function revealCurrent(){return sessionAction(revealCurrentNow)}
async function revealCurrentNow(owner){
 $("nearMissActions").hidden=true;
 if(!session.active||!session.current||session.awaitingChoice)return;
 var v=session.current,d=session.currentDirection;
 $("feedback").className="feedback almost";
 $("feedback").innerHTML="Antwort: <strong>"+escapeHtml(d==="DE_FR"?D.french(v).join(" / "):v.meanings.join(" / "))+"</strong><br><span class='small'>Als nicht gewusst markiert.</span>";
 if(!session.seen[v.id]){
  await recordResult(v,d,"wrong");if(session!==owner||!owner.active)return;session.attempts++;session.seen[v.id]=true;session.currentResolved=true;updateSessionBadges()
 }
 $("check").textContent="Weiter";keepFocus()
}
function showView(name){
 viewRevision++;
 if(name!=="trainer")cancelSession();
 if(name!=="vocab")closeEditModal();
 var views=["home","learn","trainer","plan","overview","vocab","data"];
 views.forEach(function(x){$(x+"View").hidden=x!==name});
 ["home","learn","plan","overview","vocab","data"].forEach(function(x){
  var tab=$("tab"+x[0].toUpperCase()+x.slice(1));if(tab)tab.classList.toggle("active",x===name)
 });
 document.body.classList.toggle("trainer-mode",name==="trainer");
 if(name!=="trainer")document.documentElement.lang="de";
 if(name==="home")runAction(renderHome);
 if(name==="overview")runAction(renderOverview);
 if(name==="vocab")runAction(renderVocab);
 if(name==="plan"||name==="learn")runAction(renderExamSummary);
 if(name==="data")runAction(renderSnapshots)
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
 updateLanguageLabels();
 var cid=activeCourseId(),name=courseName(cid);$("activeCourseBadge").textContent=name;$("homeCourseLabel").textContent=name;
 $("exportCourse").textContent=cid?name+" als Vokabeldatei exportieren":"Aktiven Kurs als Vokabeldatei exportieren";
 var backupName=$("backupActiveCourseName"),saveOne=$("saveCourseBackup"),saveAll=$("saveAllCourses");
 if(backupName)backupName.textContent=name;
 if(saveOne){saveOne.disabled=!cid;saveOne.textContent=cid?"Diesen Kurs sichern · "+name:"Diesen Kurs sichern"}
 if(saveAll)saveAll.disabled=!courses.length
}
async function renderHome(){
 var render=++homeRender;
 populateCourseSelector();updateCourseLabels();
 var cid=activeCourseId(),all=cid?vocab.filter(function(v){return v.courseId===cid}):[];
 $("homeTotal").textContent=all.length;
 var n=0,d=0,w=0;
 for(var i=0;i<all.length;i++){
  var p=await gp(all[i].id),pct=D.percentage(p);if(pct===null)n++;else if(pct>=67)d++;else if(pct<=32)w++
 }
 var e=cid?(await courseExams(cid))[0]:null;
 if(render!==homeRender||cid!==activeCourseId())return;
 $("homeNew").textContent=n;$("homeDue").textContent=d;$("homeWeak").textContent=w;
 if(e&&e.date){
  var days=Math.max(0,Math.ceil((new Date(e.date+"T12:00:00")-new Date())/86400000));
  $("homeExamText").textContent="Klassenarbeit in "+days+" Tag"+(days===1?"":"en")+" · Lernpensum planen"
 }else $("homeExamText").textContent="Klassenarbeit planen";
 $("appStatus").textContent="✓ Version 5.0.1 läuft · "+(cid?courseName(cid)+" · "+all.length+" Vokabeln":"noch keine Vokabeln importiert")
}
async function switchActiveCourse(id){
 viewRevision++;cancelSession();setActiveCourse(id);
 $("unitSelect").value="alle";$("overviewUnit").value="alle";
 populateAllSelectors();saveSettings();$("scopeInfo").textContent="";updateCourseLabels();await renderHome()
}
function fmtDate(iso){if(!iso)return"–";try{return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit"}).format(new Date(iso))}catch(e){return"–"}}

function successPercent(p){
 if(!p||!p.attempts)return null;
 return Math.max(0,Math.min(100,Math.round((p.correct+0.5*p.almost)/p.attempts*100)))
}
async function renderOverview(){
 var render=++overviewRender,cid=activeCourseId();
 var body=$("overviewBody");body.innerHTML="";
 if(!activeCourseId())return;
 var list=filtered(activeCourseId(),$("overviewUnit").value,$("overviewPart").value),rows=[];
 for(var i=0;i<list.length;i++){var v=list[i],p=await gp(v.id);rows.push({v:v,p:p,pct:successPercent(p)})}
 if(render!==overviewRender||cid!==activeCourseId())return;
 body.innerHTML="";
 var mode=$("overviewSort").value;
 if(mode==="weakest")rows.sort(function(a,b){return(a.pct===null?-1:a.pct)-(b.pct===null?-1:b.pct)});
 else if(mode==="strongest")rows.sort(function(a,b){return(b.pct===null?-1:b.pct)-(a.pct===null?-1:a.pct)});
 else if(mode==="french")rows.sort(function(a,b){return a.v.foreign.localeCompare(b.v.foreign,learningLocale())});
 else if(mode==="german")rows.sort(function(a,b){return a.v.meanings.join(" / ").localeCompare(b.v.meanings.join(" / "),"de")});
 rows.forEach(function(r){
  var tr=document.createElement("tr"),fr=document.createElement("td"),de=document.createElement("td"),success=document.createElement("td");
  var link=document.createElement("button");link.type="button";link.className="overview-hit";link.textContent=D.french(r.v).join(" / ");link.onclick=function(){editVocab(r.v.id)};fr.appendChild(link);de.onclick=function(){editVocab(r.v.id)};de.textContent=r.v.meanings.join(" / ");
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
 if(!q){$("vocabSearchInfo").textContent="Tippe Buchstaben ein. Gesucht wird gleichzeitig in "+foreignLanguage()+" und Deutsch.";return}
 var matches=vocab.filter(function(v){return v.courseId===activeCourseId()&&norm(D.french(v).join(" ")+" "+v.meanings.join(" ")).includes(q)})
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
 if(isSectionless(unit))$("editPartLabel").hidden=true;
 else{$("editPartLabel").hidden=false;if(!$("editPart").value&&$("editPart").options.length)$("editPart").selectedIndex=0}
 updateEditLocation()
}
function updateEditLocation(){
 var unit=$("editUnit").value,part=isSectionless(unit)?(unit==="irregular-verbs"?"Alle Formen":"gesamtes Modul"):partLabel($("editPart").value);
 $("editLocation").textContent="Ablage: "+unitLabel(unit)+" · "+part
}
function newVocab(){
 if(!activeCourseId()){alert("Bitte zuerst einen Kurs importieren.");return}
 $("editTitle").textContent="Neue Vokabel";$("editId").value="";$("editForeign").value="";$("editMeanings").value="";
 populateUnit($("editUnit"),activeCourseId(),false);populateEditParts();$("deleteVocab").hidden=true;$("editModal").hidden=false;
 $("editForeign").focus()
}
function editVocab(id){
 var v=vocab.find(function(x){return x.id===id});if(!v)return;
 $("editTitle").textContent="Vokabel bearbeiten";$("editId").value=v.id;$("editForeign").value=D.french(v).join("; ");$("editMeanings").value=v.meanings.join("; ");
 populateUnit($("editUnit"),activeCourseId(),false);var ug=unitGroup(v);$("editUnit").value=ug;populateEditParts();
 if(!isSectionless(ug)){var pg=partGroup(v);if([].slice.call($("editPart").options).some(function(o){return o.value===pg}))$("editPart").value=pg}
 updateEditLocation();$("deleteVocab").hidden=false;$("editModal").hidden=false;$("editForeign").focus()
}
function closeEditModal(){$("editModal").hidden=true}
async function saveEdit(){
 var id=$("editId").value,foreign=$("editForeign").value.trim(),meanings=$("editMeanings").value.split(";").map(function(x){return x.trim()}).filter(Boolean);
 if(!foreign||!meanings.length){alert("Bitte sowohl "+foreignLanguage()+" als auch mindestens eine deutsche Bedeutung eintragen.");return}
 var existing=id?vocab.find(function(x){return x.id===id}):null;
 var v=existing?D.clone(existing):{id:"manual-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),courseId:activeCourseId(),userCreated:true};
 var fr=D.unique(foreign.split(/[;\n]/).map(function(x){return x.trim()}).filter(Boolean));v.foreign=fr[0];if(fr.length>1||v.foreignVariants)v.foreignVariants=fr;v.meanings=D.unique(meanings);v.courseId=activeCourseId();
 var selectedUnit=$("editUnit").value;
 v.unitId=selectedUnit;
 v.part=isSectionless(selectedUnit)?"alle":(selectedUnit==="unite-0"?"auftakt":$("editPart").value||"sonstiges");
 v.userEdited=true;v.userEditedAt=new Date().toISOString();
 await reqP(os(S_VOCAB,"readwrite").put(v));await reload();populateAllSelectors();closeEditModal();await renderVocab();await renderOverview();await captureCourses([v.courseId])
}
async function deleteVocab(){
 var id=$("editId").value;if(!id)return;
 var v=vocab.find(function(x){return x.id===id});if(!v)return;
 if(!confirm('Vokabel "'+v.foreign+'" wirklich löschen? Der zugehörige Lernstand wird ebenfalls gelöscht.'))return;
 await reqP(os(S_VOCAB,"readwrite").delete(id));await reqP(os(S_PROGRESS,"readwrite").delete(id));
 await reload();populateAllSelectors();closeEditModal();await renderVocab();await captureCourses([v.courseId])
}

function scopeCatalog(){
 var out=[],units=unitsForCourse(activeCourseId());
 units.forEach(function(u){
  if(isSectionless(u))out.push({key:u+"|alle",unit:u,part:"alle",label:unitLabel(u)});
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
 if(!activeCourseId())return alert("Bitte zuerst einen Kurs importieren oder auswählen.");
 var date=$("examDate").value,scopes=selectedExamScopes();
 if(!date)return alert("Bitte Datum wählen.");
 if(!scopes.length)return alert("Bitte mindestens einen Stoffbereich markieren.");
 var chosen=$("planExamSelect").value||"exam-"+crypto.randomUUID();await reqP(os(S_EXAMS,"readwrite").put({id:chosen,courseId:activeCourseId(),date:date,scopes:scopes}));
 await captureCourses([activeCourseId()]);await renderExamSummary();$("planExamSelect").value=chosen;await renderExamSummary()
}
async function deleteExam(){
 if(!activeCourseId()){await renderExamSummary();return}
 var id=$("planExamSelect").value;if(id){await reqP(os(S_EXAMS,"readwrite").delete(id));await captureCourses([activeCourseId()])}await renderExamSummary()
}
async function renderExamSummary(){
 var render=++examRender,formRevision=examFormRevision;
 var cid=activeCourseId(),all=cid?await courseExams(cid):[],old=$("planExamSelect").value;
 if(render!==examRender||cid!==activeCourseId()||formRevision!==examFormRevision)return;
 var e=all.find(function(x){return x.id===old})||all[0]||null,box=$("examSummary");
 ["planExamSelect","learnExamSelect"].forEach(function(id){var sel=$(id),chosen=sel.value;sel.replaceChildren();all.forEach(function(ex){var o=document.createElement("option");o.value=ex.id;o.textContent=ex.date+" · "+poolForScopes(oldExamScopes(ex)).length+" Vokabeln";sel.appendChild(o)});if(all.some(function(x){return x.id===chosen}))sel.value=chosen;});
 $("learnExamInfo").textContent=all.length?"Nur Vokabeln der gewählten Klassenarbeit werden gelernt.":"Noch keine Klassenarbeit. Bitte zuerst eine Klassenarbeit planen.";
 if(render!==examRender||cid!==activeCourseId()||formRevision!==examFormRevision)return;
 if(!e){$("examDate").value="";populateExamScopes([]);box.textContent=cid?"Für "+courseName(cid)+" ist noch keine Klassenarbeit gespeichert.":"Bitte zuerst einen Kurs importieren oder auswählen.";return}
 $("examDate").value=e.date;var scopes=oldExamScopes(e);populateExamScopes(scopes);
 var pool=poolForScopes(scopes),st=await computeExamStats(pool,e.date);
 if(render!==examRender||cid!==activeCourseId()||formRevision!==examFormRevision)return;
 var title=document.createElement("strong"),target=document.createElement("strong");
 title.textContent=courseName(cid)+" · "+scopes.length+" Stoffbereich"+(scopes.length===1?"":"e");
 target.textContent="Richtwert heute: "+st.dailyTarget+" verschiedene Vokabeln";
 box.replaceChildren(title,document.createElement("br"),
  document.createTextNode("Klassenarbeit: "+e.date+" · noch "+st.days+" Tage"),document.createElement("br"),
  document.createTextNode(pool.length+" verschiedene Vokabeln im Stoff · "+st.newCount+" noch nie geübt · "+st.weak+" schwach · "+st.due+" fällig."),document.createElement("br"),
  target,document.createTextNode(", damit der gesamte Stoff bis zur Arbeit mindestens einmal durchläuft."))
}
async function startExamLearning(){return beginLearning(prepareExamLearning)}
async function prepareExamLearning(ticket){
 if(!activeCourseId())return alert("Bitte zuerst einen Kurs importieren oder auswählen.");
 var all=await courseExams(activeCourseId()),selected=(!$("learnView").hidden?$("learnExamSelect"):$("planExamSelect")).value,e=all.find(function(x){return x.id===selected})||all[0];if(!startIsCurrent(ticket))return;
 if(!e){$("examSummary").textContent="Bitte zuerst eine Klassenarbeit speichern.";return}
 var pool=poolForScopes(oldExamScopes(e)),st=await computeExamStats(pool,e.date);if(!pool.length)return alert("Im gespeicherten Stoff wurden keine Vokabeln gefunden.");
 pool=await orderPool(pool,$("orderSelect").value,$("directionSelect").value);pool=pool.slice(0,Math.min(pool.length,Math.max(1,parseInt($("distinctCount").value,10)||10)));
 if(!startIsCurrent(ticket))return;
 await startCustomSession(pool,"Klassenarbeit · "+e.date)
}

function downloadJson(obj,name){
 var b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),u=URL.createObjectURL(b),a=document.createElement("a");
 a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},1000)
}
async function downloadCourseFiles(backups,name){
 // WebKit coalesces consecutive download navigations in a single task.
 for(var i=0;i<backups.length;i++){
  if(i)await new Promise(function(resolve){setTimeout(resolve,250)});
  var b=backups[i];downloadJson(b,D.filename(b.course.label||b.course.name||b.course.id,name||b.profileName||""))
 }
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
function validateBackup(data){
 function fail(){throw new Error("Das Backup ist unvollständig oder enthält ungültige Daten. Es wurde nichts verändert.")}
 function object(x){return x!==null&&typeof x==="object"&&!Array.isArray(x)}
 function text(x){return typeof x==="string"&&x.trim().length>0}
 function records(key){
  if(!Array.isArray(data[key]))fail();
  var ids=new Set();
  data[key].forEach(function(x){if(!object(x)||!text(x.id)||ids.has(x.id))fail();ids.add(x.id)});
  return ids
 }
 if(!object(data)||!isFullBackup(data))fail();
 if(data.schemaVersion!=null&&(!Number.isInteger(data.schemaVersion)||data.schemaVersion<1||data.schemaVersion>7))fail();
 var courseIds=records("courses"),vocabIds=records("entries");records("progress");records("exams");
 data.courses.forEach(function(c){
  ["name","label","learningLocale","nativeLocale"].forEach(function(k){if(c[k]!=null&&!text(c[k]))fail()})
 });
 data.entries.forEach(function(v){
  if(!courseIds.has(v.courseId)||!text(v.foreign)||!text(v.unitId)||!Array.isArray(v.meanings)||!v.meanings.length||!v.meanings.every(text))fail();
  ["part","sectionName","unitName","importIdentity"].forEach(function(k){if(v[k]!=null&&!text(v[k]))fail()});
  if(v.userEdited!=null&&typeof v.userEdited!=="boolean")fail();if(v.foreignVariants!=null&&(!Array.isArray(v.foreignVariants)||!v.foreignVariants.length||!v.foreignVariants.every(text)))fail()
 });
 data.progress.forEach(function(p){
  if(!vocabIds.has(p.id))fail();
  Object.keys(pDefault(p.id)).forEach(function(k){
   if(k==="id"||p[k]==null)return;
   if(["lastPracticedAt","dueDEFR","dueFRDE"].indexOf(k)>=0){if(typeof p[k]!=="string"||!Number.isFinite(Date.parse(p[k])))fail()}
   else if(!Number.isInteger(p[k])||p[k]<0||((k==="deFr"||k==="frDe")&&p[k]>5))fail()
  })
 });
 data.exams.forEach(function(e){
  if(!courseIds.has(e.courseId||e.id)||typeof e.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(Date.parse(e.date)))fail();
  if(e.scopes!=null){if(!Array.isArray(e.scopes)||!e.scopes.length||!e.scopes.every(function(s){return typeof s==="string"&&/^[^|]+\|[^|]+$/.test(s)}))fail()}
  else if(!text(e.unit)||(e.part!=null&&!text(e.part)))fail()
 });
 if(data.history!=null){records("history");data.history.forEach(function(h){if(!courseIds.has(h.courseId)||(h.durationMs!=null&&(!Number.isFinite(h.durationMs)||h.durationMs<0)))fail()})}
 if(data.profileName!=null&&typeof data.profileName!=="string")fail();
 if(!object(data.settings))fail();
 var s=data.settings;
 if(s.activeCourse!=null&&!courseIds.has(s.activeCourse))fail();
 ["unit","part","order","direction","overviewUnit","overviewPart","overviewSort"].forEach(function(k){if(s[k]!=null&&!text(s[k]))fail()});
 ["autoNext","autoDetectCorrect"].forEach(function(k){if(s[k]!=null&&typeof s[k]!=="boolean")fail()});
 if(s.distinctCount!=null&&(!Number.isInteger(s.distinctCount)||s.distinctCount<1))fail();
 return data
}
async function restoreBackupFile(file){
 var incoming=await parseJsonFile(file),data=await prepareRestore(incoming);
 if(!confirm("Backup wirklich wiederherstellen? Der aktuelle lokale Datenbestand wird vollständig ersetzt."))return;
 await storeLocalSnapshot("before-restore");
 var previousSettings=localStorage.getItem(SETTINGS_KEY),previousCourse=localStorage.getItem(ACTIVE_COURSE_KEY),previousProfile=localStorage.getItem("vokabeltrainer.profile");
 // Alle Stores gemeinsam ersetzen: Auch ein Fehler nach clear() rollt alles zurück.
 await new Promise(function(resolve,reject){
  var tx=db.transaction([S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS,S_HISTORY],"readwrite"),failure=null;
  tx.oncomplete=resolve;
  tx.onabort=function(){
   try{
    if(previousProfile===null)localStorage.removeItem("vokabeltrainer.profile");else localStorage.setItem("vokabeltrainer.profile",previousProfile);
    if(previousSettings===null)localStorage.removeItem(SETTINGS_KEY);else localStorage.setItem(SETTINGS_KEY,previousSettings);
    if(previousCourse===null)localStorage.removeItem(ACTIVE_COURSE_KEY);else localStorage.setItem(ACTIVE_COURSE_KEY,previousCourse)
   }catch(e){failure=failure||e}
   reject(failure||tx.error||new Error("Backup-Import abgebrochen. Der bisherige Datenbestand bleibt erhalten."))
  };
  try{
   [[S_VOCAB,data.entries],[S_PROGRESS,data.progress],[S_COURSES,data.courses],[S_EXAMS,data.exams],[S_HISTORY,data.history||[]]].forEach(function(pair){
    var store=tx.objectStore(pair[0]);store.clear();pair[1].forEach(function(record){store.put(record)})
   });
   if(data.profileName!=null)localStorage.setItem("vokabeltrainer.profile",data.profileName);
   localStorage.setItem(SETTINGS_KEY,JSON.stringify(data.settings));
   if(data.settings.activeCourse)localStorage.setItem(ACTIVE_COURSE_KEY,data.settings.activeCourse);else localStorage.removeItem(ACTIVE_COURSE_KEY)
  }catch(e){failure=e;tx.abort()}
 });
 clearTimeout(autoTimer);clearTimeout(correctDetectTimer);session.active=false;
 await reload();applySettings(data.settings);populateCourseSelector();await renderOverview();await renderExamSummary();
 if(cloud)await captureCourses(incoming.backupType==="course-backup"?[incoming.course.id]:undefined);
 $("backupResult").textContent="Backup vollständig wiederhergestellt: "+data.entries.length+" Vokabeln und "+(data.progress||[]).length+" Lernstände.";
 showView("home");await renderHome()
}
async function resetAll(){
 if(!confirm("Alle lokalen Vokabeln, Lernstände, Kurse und Klassenarbeiten wirklich löschen?"))return;
 if(!confirm("Wirklich alle Daten zurücksetzen? Eine Sicherung vor Zurücksetzen bleibt erhalten."))return;
 cancelSession();await answerWork;await storeLocalSnapshot("before-reset",true);
 await writeRecords([[S_VOCAB,[]],[S_PROGRESS,[]],[S_COURSES,[]],[S_EXAMS,[]],[S_HISTORY,[]]],true);
 localStorage.removeItem("vokabeltrainer.profile");
 try{localStorage.removeItem(SETTINGS_KEY);localStorage.removeItem(ACTIVE_COURSE_KEY)}catch(e){}
 ACTIVE_COURSE_ID=null;await reload();populateCourseSelector();populateAllSelectors();populateExamScopes([]);
 session.active=false;showView("home");await renderHome()
}


async function writeRecords(pairs,clear){
 return new Promise(function(resolve,reject){
  var tx=db.transaction(pairs.map(function(p){return p[0]}),"readwrite");
  tx.oncomplete=resolve;tx.onabort=function(){reject(new Error("Speichern fehlgeschlagen. Der bisherige Zustand bleibt erhalten."))};
  try{pairs.forEach(function(pair){var s=tx.objectStore(pair[0]);if(clear)s.clear();pair[1].forEach(function(v){s.put(v)})})}catch(e){tx.abort()}
 });
}
async function readState(skipHistory){
 await answerWork;if(!skipHistory)await historyWork;
 var names=[S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS,S_HISTORY],tx=db.transaction(names),out={};
 await Promise.all(names.map(async function(name){out[name]=await reqP(tx.objectStore(name).getAll())}));
 return {backupType:"full-backup",schemaVersion:7,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),entries:out.vocab,progress:out.progress,courses:out.courses,exams:out.exams,history:out.history,settings:collectSettings(),profileName:localStorage.getItem("vokabeltrainer.profile")||""};
}
async function storeLocalSnapshot(reason,emergency){
 var state=await readState(),cid=activeCourseId()||"all",record={id:crypto.randomUUID(),courseId:cid,reason:reason,emergency:!!emergency,createdAt:new Date().toISOString(),label:emergency?"Sicherung vor Zurücksetzen":(reason==="manual"?"Lokales Backup · "+courseName(cid)+" · ":courseName(cid)+"_AutoBackup_")+new Date().toISOString(),data:state};
 await writeRecords([[S_SNAPSHOTS,[record]]]);
 // Only prune after the new snapshot is durably committed. Emergency records are separate.
 var all=await reqP(os(S_SNAPSHOTS).getAll()),sorted=all.filter(function(x){return x.courseId===cid&&!x.emergency&&!x.online}).sort(function(a,b){return b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)}),remove=sorted.slice(10);
 if(emergency)remove=remove.concat(all.filter(function(x){return x.emergency&&x.id!==record.id}));
 if(remove.length)await new Promise(function(resolve,reject){var tx=db.transaction(S_SNAPSHOTS,"readwrite");remove.forEach(function(x){tx.objectStore(S_SNAPSHOTS).delete(x.id)});tx.oncomplete=resolve;tx.onabort=function(){reject(tx.error)}});
 if(cloud&&reason==="manual")await cloud.capture(state,"manual");
 return record;
}
var allLocalSnapshots=false,allOnlineSnapshots=false,onlineListRevision=0;
function backupRow(label,action){
 var row=document.createElement("div"),text=document.createElement("p"),button=document.createElement("button");
 text.textContent=label;button.type="button";button.textContent="Wiederherstellen";
 button.onclick=function(){dataAction(action)};row.append(text,button);return row;
}
async function renderSnapshots(){
 updateCourseLabels();if(cloud){void cloud.changed();void cloud.flush()}
 if(document.activeElement!==$("profileName"))$("profileName").value=localStorage.getItem("vokabeltrainer.profile")||"";
 var records=await reqP(os(S_SNAPSHOTS).getAll());records=records.filter(function(r){return !r.online}).sort(function(a,b){return b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)});
 var box=$("snapshotList");box.replaceChildren();
 records.slice(0,allLocalSnapshots?records.length:5).forEach(function(r){
  box.append(backupRow(new Date(r.createdAt).toLocaleString()+" · "+r.label+" · "+r.data.entries.length+" Vokabeln · "+r.reason,async function(){await restoreBackupFile(new File([JSON.stringify(r.data)],"snapshot.json",{type:"application/json"}));await renderSnapshots()}));
 });
 if(!records.length)box.textContent="Noch keine lokalen Sicherungen vorhanden.";
 $("moreSnapshots").hidden=records.length<=5;$("moreSnapshots").textContent=allLocalSnapshots?"Weniger anzeigen":"Alle anzeigen";
 var select=$("deleteCourseSelect"),chosen=select.value;select.replaceChildren();
 courses.forEach(function(c){var o=document.createElement("option");o.value=c.id;o.textContent=courseName(c.id)+" · "+vocab.filter(function(v){return v.courseId===c.id}).length+" Vokabeln";select.append(o)});
 if(courses.some(function(c){return c.id===chosen}))select.value=chosen;else if(activeCourseId())select.value=activeCourseId();
 $("deleteCourse").disabled=!courses.length;
 if($("onlineBackups").open)void renderOnlineBackups();
}
async function renderOnlineBackups(){
 var revision=++onlineListRevision,box=$("onlineList");box.replaceChildren();$("moreOnline").hidden=true;
 if(!cloud||!cloud.configured()){$("onlineListStatus").textContent="Bitte zuerst die Online-Sicherung einrichten.";return}
 $("onlineListStatus").textContent="Online-Sicherungen werden geladen …";
 try{var records=await cloud.history();if(revision!==onlineListRevision)return;
  records.slice(0,allOnlineSnapshots?records.length:5).forEach(function(r){
   box.append(backupRow(new Date(r.exportedAt).toLocaleString()+" · "+r.courseName+" · "+(r.backupKind==="automatic"?"Automatische Sicherung":"Manuelle Sicherung")+(r.vocabularyCount==null?"":" · "+r.vocabularyCount+" Vokabeln")+" · "+(r.status==="nas-confirmed"?"Auf NAS bestätigt":"Online gesichert"),async function(){await restoreBackupFile(await cloud.download(r));await renderSnapshots()}));
  });
  $("onlineListStatus").textContent=records.length?"":"Keine Online-Sicherungen vorhanden.";$("moreOnline").hidden=records.length<=5;$("moreOnline").textContent=allOnlineSnapshots?"Weniger anzeigen":"Alle anzeigen";
 }catch(e){if(revision===onlineListRevision)$("onlineListStatus").textContent="Online-Sicherungen konnten nicht geladen werden. Bitte Verbindung prüfen und den Bereich erneut öffnen."}
}
async function deleteLocalCourse(){
 var cid=$("deleteCourseSelect").value;if(!courses.some(function(c){return c.id===cid}))return;
 if(!confirm('Kurs "'+courseName(cid)+'" nur auf diesem Gerät löschen? Historische Online-/NAS-Sicherungen bleiben erhalten.'))return;
 if(!confirm("Wirklich diesen Kurs und seine lokalen Lernstände löschen? Noch nicht hochgeladene Sicherungen dieses Kurses werden verworfen."))return;
 cancelSession();await answerWork;await historyWork;
 await cloud.withCoursePaused(cid,async function(owner){
  await storeLocalSnapshot("before-course-delete",true);
  var state=await readState(),ids=new Set(state.entries.filter(function(v){return v.courseId===cid}).map(function(v){return v.id})),snaps=await reqP(os(S_SNAPSHOTS).getAll());
  var remove=snaps.filter(function(r){return r.courseId===cid&&(r.online?r.ownerDevice===owner&&["pending","pendingUpload"].includes(r.status)&&!r.uploadedAt:!r.emergency&&r.data.backupType==="course-backup")});
  await new Promise(function(resolve,reject){var tx=db.transaction([S_COURSES,S_VOCAB,S_PROGRESS,S_HISTORY,S_EXAMS,S_SNAPSHOTS],"readwrite");
   tx.oncomplete=resolve;tx.onabort=function(){reject(Error("Kurs konnte nicht gelöscht werden. Der bisherige Zustand bleibt erhalten."))};
   tx.objectStore(S_COURSES).delete(cid);ids.forEach(function(id){tx.objectStore(S_VOCAB).delete(id);tx.objectStore(S_PROGRESS).delete(id)});
   state.history.filter(function(h){return h.courseId===cid}).forEach(function(h){tx.objectStore(S_HISTORY).delete(h.id)});
   state.exams.filter(function(e){return(e.courseId||e.id)===cid}).forEach(function(e){tx.objectStore(S_EXAMS).delete(e.id)});
   remove.forEach(function(r){tx.objectStore(S_SNAPSHOTS).delete(r.id)});
  });
 });
 var previous=activeCourseId();await reload();if(previous===cid)setActiveCourse(usedCourseIds()[0]||courses[0]?.id||null);
 populateCourseSelector();populateAllSelectors();saveSettings();await renderHome();await renderOverview();await renderExamSummary();await renderSnapshots();
 $("backupResult").textContent="Kurs auf diesem Gerät gelöscht. Historische Online-/NAS-Sicherungen bleiben erhalten.";
}

function accumulateTime(owner){var now=performance.now();if(owner.visibleTick!=null)owner.durationMs+=(now-owner.visibleTick);owner.visibleTick=document.hidden?null:now;}
async function captureCourses(ids){if(cloud)await cloud.capture(await readState(),"automatic",ids)}
function finishHistory(owner,completed){
 if(!owner.historyId||owner.historySaved)return;owner.historySaved=true;accumulateTime(owner);
 var record={id:owner.historyId,courseId:owner.courseId,startedAt:owner.startedAt,endedAt:new Date().toISOString(),durationMs:Math.round(owner.durationMs),mode:owner.sourceLabel,answered:Object.keys(owner.seen).length,completed:completed,vocabularyIds:Object.keys(owner.seen)};
 historyWork=historyWork.then(async function(){await answerWork;await writeRecords([[S_HISTORY,[record]]]);if(cloud)await cloud.capture(await readState(true),"automatic",[owner.courseId])}).catch(function(){ $("appStatus").textContent="Die Lernhistorie konnte nicht gespeichert werden. Bitte eine Sicherung exportieren."; });
}
document.addEventListener("visibilitychange",function(){if(session.active)accumulateTime(session)});
window.addEventListener("pagehide",function(){if(session.active)finishHistory(session,false)});
async function courseExams(cid){var all=await reqP(os(S_EXAMS).getAll());return all.filter(function(e){return(e.courseId||e.id)===cid}).sort(function(a,b){return a.date.localeCompare(b.date)})}
async function prepareRestore(input){
 var data=D.clone(input);
 if(data.backupType==="course-backup"){
  if(data.schemaVersion!==1||!data.course||!Array.isArray(data.entries)||!Array.isArray(data.progress)||!Array.isArray(data.exams)||!Array.isArray(data.history))throw Error("Die Kurssicherung ist unvollständig oder ihre Version wird nicht unterstützt.");
  var cid=data.course.id,part={backupType:"full-backup",schemaVersion:7,courses:[data.course],entries:data.entries,progress:data.progress,exams:data.exams,history:data.history,settings:{activeCourse:cid}};
  validateBackup(part);
  var state=await readState(),ids=new Set(state.entries.filter(function(v){return v.courseId===cid}).map(function(v){return v.id}));
  var foreign=new Set(state.entries.filter(function(v){return v.courseId!==cid}).map(function(v){return v.id}));
  if(data.entries.some(function(v){return foreign.has(v.id)}))throw Error("Vokabel-IDs kollidieren mit einem anderen Kurs. Bitte als neuen Kurs einlesen.");
  state.entries=state.entries.filter(function(v){return v.courseId!==cid}).concat(data.entries);
  state.progress=state.progress.filter(function(v){return !ids.has(v.id)}).concat(data.progress);
  state.courses=state.courses.filter(function(c){return c.id!==cid}).concat(data.course);
  state.exams=state.exams.filter(function(e){return(e.courseId||e.id)!==cid}).concat(data.exams);
  state.history=state.history.filter(function(h){return h.courseId!==cid}).concat(data.history);state.settings.activeCourse=cid;state.profileName=data.profileName||state.profileName;data=state;
 }
 // Only known legacy fr/de records are adapted, all other metadata remains intact.
 if(Array.isArray(data.entries))data.entries=data.entries.map(function(v){return !v.foreign&&v.fr?D.normalize(v):v});
 return validateBackup(data);
}
var dataBusy=false,pendingImport=null;
async function dataAction(action){
 if(dataBusy||editBusy)return;dataBusy=true;
 var controls=Array.from(document.querySelectorAll('button,input,select,textarea')).map(function(el){var was=el.disabled;el.disabled=true;return[el,was]});
 $("dataView").setAttribute("aria-busy","true");
 try{await action()}catch(e){$("backupResult").textContent="Die Aktion wurde nicht abgeschlossen. "+(e.message||"Bitte erneut versuchen.")}
 finally{dataBusy=false;controls.forEach(function(pair){if(pair[0].isConnected)pair[0].disabled=pair[1]});$("dataView").removeAttribute("aria-busy")}
}
function normalizeImportData(data,mode){
 if(isFullBackup(data))throw Error("Das ist ein komplettes Backup. Bitte unten „Backup wiederherstellen“ verwenden.");
 if(data.backupType==="course-backup"&&data.schemaVersion!==1)throw Error("Unbekannte Sicherungsversion.");
 var entries=Array.isArray(data)?data:data.entries;if(!Array.isArray(entries)||!entries.length)throw Error("Keine Vokabelliste gefunden.");
 var meta=data.course||{},raw=meta.id||meta.courseId||data.courseId||null,label=meta.label||meta.name||data.label||"";
 if(!raw){var ids=Array.from(new Set(entries.map(function(v){return v.courseId}).filter(Boolean)));if(ids.length===1)raw=ids[0];}
 if((raw==="franzoesisch"||!raw)&&/franz[oö]sisch\s*6/i.test(label))raw="franzoesisch-6";
 if(!raw&&entries.every(function(e){return String(e.id||"").startsWith("fr6-")||(Number(e.page)>=176&&Number(e.page)<=178)})){raw="franzoesisch-6";label=label||"Französisch 6";}
 if(mode==="current"&&activeCourseId())raw=activeCourseId();
 if(!raw)throw Error("Der Kurs konnte nicht eindeutig erkannt werden. Bitte eine Datei mit Kursangabe verwenden.");
 var cid=String(raw),existing=courses.find(function(c){return c.id===cid});label=existing?(existing.label||existing.name||cid):label||cid;
 var unitNames=new Map((data.units||[]).map(function(u){return[u.id,u.name||u.label||u.id]})),invalid=0,seen=new Set(vocab.map(function(v){return v.id}));
 var identityIndex=new Map(vocab.filter(function(v){return v.courseId===cid}).map(function(v){return[v.importIdentity,v]}));
 var normalized=[];
 entries.forEach(function(e){try{
  var v=D.normalize(e),original=String(e.unitId||e.unit||""),unit=original,part=e.part||null,section=e.sectionName||e.unitName||unitNames.get(original)||null;
  if(cid==="franzoesisch-6"&&(/^p17[678]-/.test(original)||(Number(e.page)>=176&&Number(e.page)<=178))){unit="unite-0";part="auftakt";section=section||original;}
  var old=unit.match(/^(unite-\d+)-(auftakt|vocabulaire-thematique|volet-1|volet-2|volet-3)$/);if(old){unit=old[1];part=part||old[2];}
  if(!/^(?:unite|unit)-\d+$/.test(unit)&&!isSectionless(unit))throw Error();
  if(isSectionless(unit))part="alle";if(unit==="unite-0")part="auftakt";
  part=part||"sonstiges";
  var identity=e.importIdentity||(e.id?JSON.stringify([cid,"source",String(e.id)]):JSON.stringify([cid,unit,part,norm(v.foreign).normalize("NFC"),Array.from(new Set(v.meanings.map(function(x){return norm(x).normalize("NFC")}))).sort()]));
  if(/^en(?:-|$)/i.test(meta.learningLocale||existing&&existing.learningLocale||"")&&(e.id||e.importIdentity)){v.sourceCardId=String(e.sourceCardId||e.id||e.importIdentity);}
  var match=identityIndex.get(identity);
  var id=match?match.id:(e.id&&!seen.has(String(e.id))?String(e.id):"import:"+identity);
  if(!match&&seen.has(id)){id="import-"+crypto.randomUUID();}seen.add(id);
  normalized.push(Object.assign(v,{id:id,importIdentity:identity,courseId:cid,unitId:unit,part:part,sectionName:section,importedAt:e.importedAt||new Date().toISOString()}));
 }catch(err){invalid++;}});
 if(invalid)throw Error(invalid+" ungültige Einträge. Bitte die Datei korrigieren; es wurde nichts übernommen.");
 return {course:Object.assign({},meta,{id:cid,name:meta.name||label,label:label,learningLocale:meta.learningLocale||existing&&existing.learningLocale||"fr-FR",nativeLocale:meta.nativeLocale||existing&&existing.nativeLocale||"de-DE"}),entries:normalized,source:data,mode:mode};
}
async function importVocabularyFile(file,mode){
 var data=await parseJsonFile(file),prepared=normalizeImportData(data,mode||"source");
 pendingImport=prepared;pendingImport.filename=file.name;pendingImport.activeAtStart=activeCourseId();
 $("importStrategy").value="smart";$("courseCollision").hidden=mode!=="new"||!courses.some(function(c){return c.id===prepared.course.id});$("courseCollisionChoice").value="copy";
 $("importPreview").hidden=false;await renderImportPreview();
}
async function renderImportPreview(){
 if(!pendingImport)return;
 var cid=pendingImport.course.id,old=vocab.filter(function(v){return v.courseId===cid}),progress=await reqP(os(S_PROGRESS).getAll());
 var plan=D.planImport(old,pendingImport.entries,progress,$("importStrategy").value);
 pendingImport.groups=plan.groups;
 var c=plan.counts;$("importSummary").textContent=pendingImport.filename+": "+pendingImport.entries.length+" Einträge · "+c.new+" neu · "+c.identical+" identisch · "+c.expanded+" Bedeutungen ergänzt · "+($('importStrategy').value==='review'?c.review:0)+" zur manuellen Prüfung";
 var box=$("importConflicts");box.replaceChildren();
 if($("importStrategy").value==="review")plan.groups.forEach(function(g,i){if(!g.existing.length)return;
  var field=document.createElement("fieldset"),legend=document.createElement("legend");legend.textContent="Konflikt "+(i+1);field.appendChild(legend);field.dataset.group=i;
  var info=document.createElement("p");info.textContent="Vorhanden: "+g.existing.map(function(v){return D.french(v).join(" / ")+" = "+D.german(v).join(" / ")}).join("; ")+" · Datei: "+g.incoming.map(function(v){return D.french(v).join(" / ")+" = "+D.german(v).join(" / ")}).join("; ");field.appendChild(info);
  var select=document.createElement("select");select.className="review-mode";select.setAttribute("aria-label","Entscheidung Konflikt "+(i+1));[["merge","Varianten zusammenführen"],["separate","Als getrennte Vokabeln behalten"],["skip","Konflikt überspringen"]].forEach(function(pair){var o=document.createElement("option");o.value=pair[0];o.textContent=pair[1];select.appendChild(o)});field.appendChild(select);
  ["fr","de"].forEach(function(lang){var label=document.createElement("label");label.textContent=lang==='fr'?( /^en(?:-|$)/i.test(pendingImport.course.learningLocale)?"Englische Varianten (eine pro Zeile)":"Französische Varianten (eine pro Zeile)"):"Deutsche Varianten (eine pro Zeile)";var area=document.createElement("textarea");area.className="review-"+lang;var values=D.unique(g.existing.concat(g.incoming).flatMap(lang==='fr'?D.french:D.german));area.value=values.join("\n");label.appendChild(area);field.appendChild(label);
   values.forEach(function(value){var l=document.createElement("label"),cb=document.createElement("input");cb.type="checkbox";cb.checked=true;cb.onchange=function(){var lines=area.value.split("\n");area.value=(cb.checked?D.unique(lines.concat(value)):lines.filter(function(x){return x!==value})).join("\n")};l.append(cb,document.createTextNode(value));field.appendChild(l)});
  });box.appendChild(field);
 });
}
async function commitImport(){
 if(!pendingImport)return;var prepared=pendingImport,cid=prepared.course.id,copy=prepared.mode==='new'&&(!$("courseCollision").hidden&&$("courseCollisionChoice").value==='copy'),replace=prepared.mode==='new'&&!$("courseCollision").hidden&&$("courseCollisionChoice").value==='replace';
 if(prepared.mode==='current'&&activeCourseId()!==prepared.activeAtStart)throw Error("Der Kurs wurde gewechselt. Bitte die Datei erneut auswählen.");
 if(replace&&!confirm("Bestehenden Kurs mit allen Lernständen wirklich ersetzen? Vorher wird eine Sicherung erstellt."))return;
 var meta=D.clone(prepared.course),incoming=D.clone(prepared.entries);
 if(copy){cid=cid+"-"+crypto.randomUUID();meta.id=cid;meta.label+=" (Kopie)";incoming.forEach(function(v){v.courseId=cid;v.id="import-"+crypto.randomUUID();delete v.importIdentity})}
 var state=await readState(),old=replace?[]:state.entries.filter(function(v){return v.courseId===cid}),oldIds=new Set(state.entries.filter(function(v){return v.courseId===cid}).map(function(v){return v.id}));
 var decisions={};document.querySelectorAll('#importConflicts fieldset').forEach(function(f){decisions[f.dataset.group]={mode:f.querySelector('.review-mode').value,fr:f.querySelector('.review-fr').value.split('\n'),de:f.querySelector('.review-de').value.split('\n')}});
 var plan=D.planImport(old,incoming,replace?[]:state.progress.filter(function(x){return oldIds.has(x.id)}),$("importStrategy").value,decisions);
 // Imported course backups preserve their raw learning state, remapping only when explicitly copied.
 if(prepared.mode==='new'&&prepared.source.backupType==='course-backup'){
  var src=prepared.source;validateBackup({backupType:'full-backup',schemaVersion:7,courses:[src.course],entries:src.entries,progress:src.progress,exams:src.exams,history:src.history,settings:{}});
  var remap=new Map(prepared.entries.map(function(v,i){return[src.entries[i].id,incoming[i].id]}));
  plan.entries=incoming;plan.progress=src.progress.map(function(x){return Object.assign({},x,{id:remap.get(x.id)})});
  state.exams=state.exams.filter(function(e){return(e.courseId||e.id)!==cid}).concat(src.exams.map(function(e){return Object.assign({},e,{id:copy?'exam-'+crypto.randomUUID():e.id,courseId:cid})}));
  state.history=state.history.filter(function(h){return h.courseId!==cid}).concat(src.history.map(function(h){return Object.assign({},h,{id:copy?crypto.randomUUID():h.id,courseId:cid,vocabularyIds:(h.vocabularyIds||[]).map(function(id){return remap.get(id)||id})})}));
 }else if(replace){state.exams=state.exams.filter(function(e){return(e.courseId||e.id)!==cid});state.history=state.history.filter(function(h){return h.courseId!==cid})}
 state.entries=state.entries.filter(function(v){return v.courseId!==cid}).concat(plan.entries);
 state.progress=state.progress.filter(function(v){return !oldIds.has(v.id)}).concat(plan.progress);
 state.history.forEach(function(h){if(h.vocabularyIds)h.vocabularyIds=Array.from(new Set(h.vocabularyIds.map(function(id){return plan.aliases[id]||id}))) });
 state.courses=state.courses.filter(function(c){return c.id!==cid}).concat(meta);
 // Validate complete proposed state before any write; snapshot failure blocks the action.
 validateBackup(state);await storeLocalSnapshot(replace?'before-course-replace':'before-import');
 await writeRecords([[S_VOCAB,state.entries],[S_PROGRESS,state.progress],[S_COURSES,state.courses],[S_EXAMS,state.exams],[S_HISTORY,state.history]],true);
 if(cloud)await cloud.capture(await readState(),"automatic",[cid]);
 pendingImport=null;$("importPreview").hidden=true;await reload();setActiveCourse(cid);populateCourseSelector();populateAllSelectors();updateCourseLabels();saveSettings();await renderHome();await renderOverview();await renderSnapshots();
 $("vocabImportResult").textContent="Import abgeschlossen: "+plan.counts.new+" neu · "+plan.counts.expanded+" Bedeutungen ergänzt · "+plan.counts.identical+" bereits vorhanden → "+meta.label+".";
}

function populateAllSelectors(){
 var cid=activeCourseId();
 populateUnit($("unitSelect"),cid,true);
 populatePart($("partSelect"),cid,$("unitSelect").value||"alle",true);
 populateUnit($("overviewUnit"),cid,true);
 populatePart($("overviewPart"),cid,$("overviewUnit").value||"alle",true);
 populateExamScopes([])
}
function bindUnitPart(unitId,partId,afterChange){
 $(unitId).addEventListener("change",function(){populatePart($(partId),activeCourseId(),$(unitId).value,true);saveSettings();if(afterChange)runAction(afterChange)});
 $(partId).addEventListener("change",function(){saveSettings();if(afterChange)runAction(afterChange)})
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
  if(!session.busy){if(session.currentResolved)runAction(chooseNext);else checkAnswer()}
 }
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
$("activeCourseSelect").onchange=function(){var id=this.value;runAction(function(){return switchActiveCourse(id)})};
$("homeLearn").onclick=function(){showView("learn")};
$("homePlan").onclick=function(){showView("plan")};
$("homeVocab").onclick=function(){showView("vocab")};
$("homeOverview").onclick=function(){showView("overview")};
$("homeData").onclick=function(){showView("data")};
$("leaveTrainer").onclick=function(){endSession()};

$("refreshOverview").onclick=function(){runAction(renderOverview)};
$("overviewSort").onchange=function(){saveSettings();runAction(renderOverview)};

$("vocabSearch").oninput=renderVocab;
$("newVocab").onclick=newVocab;
$("saveEdit").onclick=function(){editAction(saveEdit)};
$("cancelEdit").onclick=closeEditModal;
$("closeEdit").onclick=closeEditModal;
$("deleteVocab").onclick=function(){editAction(deleteVocab)};
$("editUnit").onchange=populateEditParts;
$("editPart").onchange=updateEditLocation;
$("editModal").addEventListener("click",function(e){if(e.target===$("editModal"))closeEditModal()});

$("examDate").addEventListener("input",function(){examFormRevision++});
$("examScopeList").addEventListener("change",function(){examFormRevision++});
$("saveExam").onclick=function(){runAction(saveExam)};
$("deleteExam").onclick=function(){runAction(deleteExam)};
$("startExamLearning").onclick=startExamLearning;
$("selectAllExamScopes").onclick=function(){examFormRevision++;[].slice.call($("examScopeList").querySelectorAll('input[type="checkbox"]')).forEach(function(x){x.checked=true})};
$("clearExamScopes").onclick=function(){examFormRevision++;[].slice.call($("examScopeList").querySelectorAll('input[type="checkbox"]')).forEach(function(x){x.checked=false})};


function renderOnlineStatus(state){
 $("onlineSetup").hidden=state.configured;
 $("onlineStatus").textContent=(state.configured?"Automatische Sicherung aktiv.":"Automatische Online-Sicherung noch nicht eingerichtet.")+("\n"+(state.pending||0)+(navigator.onLine===false?" Sicherungen warten auf Internetverbindung.":" Sicherungen warten auf Upload."))+(state.lastUploaded?"\nZuletzt online gesichert: "+new Date(state.lastUploaded).toLocaleString():"")+(state.localError?" Die zusätzliche Sicherung konnte noch nicht vorgemerkt werden. Bitte eine Datei sichern.":"");
}
$("pairDevice").onclick=async function(){
 var code=$("pairCode").value;$("pairCode").value="";$("pairDevice").disabled=true;
 try{await cloud.pair(code);await captureCourses()}catch{ $("onlineStatus").textContent="Einrichtung nicht bestätigt. Bitte Einmalcode und Verbindung prüfen."; }finally{$("pairDevice").disabled=false}
};
document.addEventListener("visibilitychange",function(){if(!document.hidden&&db&&cloud&&!session.active)void captureCourses()});
window.addEventListener("online",function(){if(cloud)void cloud.flush()});
setInterval(function(){if(cloud)void cloud.flush()},60000);

$("exportCourse").onclick=function(){runAction(exportCurrentCourse)};
$("reset").onclick=function(){dataAction(resetAll)};
$("deleteCourse").onclick=function(){dataAction(deleteLocalCourse)};
$("moreSnapshots").onclick=function(){allLocalSnapshots=!allLocalSnapshots;runAction(renderSnapshots)};
$("moreOnline").onclick=function(){allOnlineSnapshots=!allOnlineSnapshots;void renderOnlineBackups()};
$("onlineBackups").ontoggle=function(){if(this.open)void renderOnlineBackups()};
$("profileName").onchange=function(){localStorage.setItem("vokabeltrainer.profile",this.value.trim())};
$("importStrategy").onchange=function(){dataAction(renderImportPreview)};
$("confirmImport").onclick=function(){dataAction(commitImport)};
$("cancelImport").onclick=function(){pendingImport=null;$("importPreview").hidden=true};
$("newExam").onclick=function(){examFormRevision++;$("planExamSelect").value="";$("examDate").value="";populateExamScopes([])};
$("planExamSelect").onchange=function(){runAction(renderExamSummary)};
$("learnExamStart").onclick=startExamLearning;
$("learnPlanExam").onclick=function(){showView("plan")};
[["currentImportFile","current"],["newCourseFile","new"]].forEach(function(pair){$(pair[0]).onchange=function(){var f=this.files[0];this.value="";if(f)dataAction(function(){return importVocabularyFile(f,pair[1])})}});
$("vocabImportFile").onchange=async function(e){
 var f=e.target.files&&e.target.files[0];if(!f)return;
 $("vocabImportResult").textContent="Importiere "+f.name+" …";
 try{
  await importVocabularyFile(f)
 }catch(err){
  console.error("Vokabelimport fehlgeschlagen:",err);
  $("vocabImportResult").textContent="Importfehler: "+(err&&err.message?err.message:String(err))
 }
 e.target.value=""
};
$("backupRestoreFile").onchange=async function(e){
 var f=e.target.files&&e.target.files[0];if(!f)return;
 await dataAction(async function(){try{await restoreBackupFile(f)}catch(err){$("backupResult").textContent="Wiederherstellungsfehler: "+err.message}})
 e.target.value=""
};

["orderSelect","directionSelect","distinctCount","autoNext","autoDetectCorrect"].forEach(function(id){
 $(id).addEventListener("change",saveSettings)
});

(async function(){
 try{
  db=await openDb();cloud=OnlineBackup.create({db:db,build:D.buildCourseBackup,readState:readState,version:APP_VERSION,onChange:renderOnlineStatus});await prepareData();await reload();populateCourseSelector();populateAllSelectors();
  bindUnitPart("unitSelect","partSelect",null);bindUnitPart("overviewUnit","overviewPart",renderOverview);
  applySettings(loadSavedSettings());
  await renderExamSummary();
  if(viewRevision===0)showView("home");await renderHome();await captureCourses();void cloud.changed();void cloud.flush()
 }catch(err){
  $("appStatus").textContent="Startfehler: "+err.message;$("appStatus").style.background="#fdeaea";console.error(err)
 }
})();
})();

if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("./sw.js").catch(function(){})})}
