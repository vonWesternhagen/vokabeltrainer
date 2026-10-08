(function(){
"use strict";

var APP_VERSION="3.9";
var DB_NAME="VokabeltrainerTest";
var DB_VERSION=2;
var S_VOCAB="vocab",S_PROGRESS="progress",S_COURSES="courses",S_EXAMS="exams";
var SETTINGS_KEY="vokabeltrainer.settings.v3";
var ACTIVE_COURSE_KEY="vokabeltrainer.activeCourse.v1";
var db=null,vocab=[],courses=[],autoTimer=null,correctDetectTimer=null,ACTIVE_COURSE_ID=null;
var LEGACY_SEEDS={"le-projet":"le projet","le-metier":"le métier","le-domaine":"le domaine"};

var session={
 active:false,pool:[],firstQueue:[],seen:{},current:null,currentDirection:"DE_FR",
 attempts:0,correct:0,testResults:[],lastId:null,recentIds:[],firstRoundComplete:false,
 awaitingChoice:false,sourceLabel:"",currentResolved:false
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
 for(var id in LEGACY_SEEDS){
  var v=await reqP(os(S_VOCAB).get(id));
  if(v && (v.seed===true || (v.courseId==="franzoesisch" && norm(v.foreign)===norm(LEGACY_SEEDS[id])))){
   await reqP(os(S_VOCAB,"readwrite").delete(id));
   await reqP(os(S_PROGRESS,"readwrite").delete(id))
  }
 }
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

function norm(s){return String(s||"").trim().toLowerCase().replace(/[’‘`´]/g,"'").replace(/\s+/g," ")}
function stripAcc(s){try{return norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"")}catch(e){return norm(s)}}
function stripFrenchArticle(s){return norm(s).replace(/^(le|la|les|un|une|des)\s+/,"").replace(/^l'/,"")}
function germanAccepted(item,g){
 g=norm(g);
 var gn=g.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"");
 return item.meanings.some(function(m){
  var x=norm(m),xn=x.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"");
  return g===x||gn===xn
 })
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(m){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]})}

function unitGroup(unitId){
 if(/^unite-1/.test(unitId))return"unite-1";
 if(/^unite-2/.test(unitId))return"unite-2";
 if(/^unite-3/.test(unitId))return"unite-3";
 if(/^module-/.test(unitId))return unitId;
 return unitId||"ohne"
}
function partGroup(unitId){
 if(/auftakt/.test(unitId))return"auftakt";
 if(/vocabulaire-thematique/.test(unitId))return"vocabulaire-thematique";
 if(/volet-1/.test(unitId))return"volet-1";
 if(/volet-2/.test(unitId))return"volet-2";
 if(/^module-/.test(unitId))return"alle";
 return"sonstiges"
}
function unitLabel(x){
 var fixed=({"unite-1":"Unité 1","unite-2":"Unité 2","unite-3":"Unité 3","module-a":"Module A","module-b":"Module B","module-c":"Module C","module-d":"Module D","alle":"Alle"})[x];
 if(fixed)return fixed;
 var hit=vocab.find(function(v){return v.courseId===activeCourseId()&&unitGroup(v.unitId)===x&&v.unitName});
 if(hit&&hit.unitName)return hit.unitName;
 var m=String(x||"").match(/^p(\d+)-(.+)$/);
 if(m)return "S. "+m[1]+" · "+m[2].split("-").map(function(w){return w.charAt(0).toUpperCase()+w.slice(1)}).join(" ");
 return x
}
function partLabel(x){return({"alle":"Alle","auftakt":"Auftaktseite","vocabulaire-thematique":"Vocabulaire thématique","volet-1":"Volet 1","volet-2":"Volet 2","sonstiges":"Sonstiges"})[x]||x}
function courseName(id){var c=courses.find(function(x){return x.id===id});return c?c.name:id}

function fillSelect(sel,items,allLabel){
 if(!sel)return;
 var old=sel.value;sel.innerHTML="";
 if(allLabel!==null){var a=document.createElement("option");a.value="alle";a.textContent=allLabel||"Alle";sel.appendChild(a)}
 items.forEach(function(it){var o=document.createElement("option");o.value=it.value;o.textContent=it.label;sel.appendChild(o)});
 if([].slice.call(sel.options).some(function(o){return o.value===old}))sel.value=old
}
function unitsForCourse(courseId){
 var order={"unite-1":1,"unite-2":2,"unite-3":3,"module-a":10,"module-b":11,"module-c":12,"module-d":13};
 return Array.from(new Set(vocab.filter(function(v){return courseId==="alle"||v.courseId===courseId}).map(function(v){return unitGroup(v.unitId)})))
  .sort(function(a,b){return(order[a]||99)-(order[b]||99)||a.localeCompare(b)})
}
function populateUnit(sel,courseId,includeAll){
 fillSelect(sel,unitsForCourse(courseId).map(function(x){return{value:x,label:unitLabel(x)}}),includeAll?"Alle":null)
}
function partsFor(courseId,unit){
 if(/^module-[a-d]$/.test(unit))return[];
 return Array.from(new Set(vocab.filter(function(v){
  return(courseId==="alle"||v.courseId===courseId)&&(unit==="alle"||unitGroup(v.unitId)===unit)
 }).map(function(v){return partGroup(v.unitId)}))).filter(function(x){return x!=="alle"}).sort()
}
function populatePart(sel,courseId,unit,includeAll){
 var parts=partsFor(courseId,unit);
 fillSelect(sel,parts.map(function(x){return{value:x,label:partLabel(x)}}),includeAll?"Alle":null);
 if(/^module-[a-d]$/.test(unit)){
  sel.innerHTML="";var o=document.createElement("option");o.value="alle";o.textContent="gesamtes Modul";sel.appendChild(o);sel.disabled=true
 }else sel.disabled=false
}
function filtered(courseId,unit,part){
 return vocab.filter(function(v){
  return(courseId==="alle"||v.courseId===courseId)&&(unit==="alle"||unitGroup(v.unitId)===unit)&&(part==="alle"||partGroup(v.unitId)===part)
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
 var p=await gp(v.id),s=statsForDir(p,dir),lvl=s.level;
 var knownDirectional=s.correct+s.almost+s.wrong;
 var fail=knownDirectional?(s.wrong+s.almost):(p.wrong+p.almost);
 var rate=knownDirectional&&s.attempts?s.correct/s.attempts:(p.attempts?p.correct/p.attempts:0);
 return lvl*100+rate*20-fail*3+Math.min(s.attempts||p.attempts,10)
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
  unit:$("unitSelect")?$("unitSelect").value:null,
  part:$("partSelect")?$("partSelect").value:null,
  order:$("orderSelect")?$("orderSelect").value:"forward",
  direction:$("directionSelect")?$("directionSelect").value:"DE_FR",
  sessionType:$("sessionTypeSelect")?$("sessionTypeSelect").value:"learn",
  distinctCount:$("distinctCount")?parseInt($("distinctCount").value,10)||20:20,
  adaptive:$("adaptiveAfterFirst")?$("adaptiveAfterFirst").checked:true,
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
 setIf("unitSelect",s.unit);
 populatePart($("partSelect"),activeCourseId(),$("unitSelect").value,true);
 setIf("partSelect",s.part);
 setIf("orderSelect",s.order);setIf("directionSelect",s.direction);setIf("sessionTypeSelect",s.sessionType);
 if($("distinctCount")&&s.distinctCount)$("distinctCount").value=s.distinctCount;
 if($("adaptiveAfterFirst")&&typeof s.adaptive==="boolean")$("adaptiveAfterFirst").checked=s.adaptive;
 if($("autoNext")&&typeof s.autoNext==="boolean")$("autoNext").checked=s.autoNext;
 if($("autoDetectCorrect")&&typeof s.autoDetectCorrect==="boolean")$("autoDetectCorrect").checked=s.autoDetectCorrect;
 setIf("overviewUnit",s.overviewUnit);
 populatePart($("overviewPart"),activeCourseId(),$("overviewUnit").value,true);
 setIf("overviewPart",s.overviewPart);setIf("overviewSort",s.overviewSort)
}

function currentScopeText(){
 return courseName(activeCourseId())+" · "+unitLabel($("unitSelect").value)+" · "+partLabel($("partSelect").value)
}
function resetSessionState(pool,label){
 session={
  active:true,pool:pool,firstQueue:pool.slice(),seen:{},current:null,currentDirection:"DE_FR",
  attempts:0,correct:0,testResults:[],lastId:null,recentIds:[],firstRoundComplete:false,
  awaitingChoice:false,sourceLabel:label||"",currentResolved:false
 };
 $("roundCompletePanel").hidden=true;
 $("showAnswer").hidden=$("sessionTypeSelect").value==="test"
}
async function startSession(){
 if(!activeCourseId()){$("scopeInfo").textContent="Bitte zuerst einen Kurs importieren oder auswählen.";return}
 var available=filtered(activeCourseId(),$("unitSelect").value,$("partSelect").value);
 if(!available.length){$("scopeInfo").textContent="Für diese Auswahl gibt es keine Vokabeln.";return}
 var requested=parseInt($("distinctCount").value,10);
 if(!Number.isFinite(requested)||requested<1)requested=available.length;
 requested=Math.min(requested,available.length);
 var ordered=await orderPool(available,$("orderSelect").value,$("directionSelect").value);
 var pool=ordered.slice(0,requested);
 resetSessionState(pool,currentScopeText());
 $("scopeInfo").textContent=currentScopeText()+" · "+pool.length+" verschiedene Vokabeln ausgewählt"+
  (available.length>pool.length?" (von "+available.length+" verfügbaren).":".")+" Jede wird zuerst genau einmal abgefragt.";
 saveSettings();showView("trainer");await chooseNext(true)
}
async function startDueSession(){
 if(!activeCourseId()){$("scopeInfo").textContent="Bitte zuerst einen Kurs auswählen.";return}
 var available=filtered(activeCourseId(),$("unitSelect").value,$("partSelect").value),focus=[];
 for(var i=0;i<available.length;i++){
  var p=await gp(available[i].id);
  if(p.attempts===0||isDue(p)||Math.min(p.deFr,p.frDe)<=1)focus.push(available[i])
 }
 if(!focus.length){$("scopeInfo").textContent="In diesem Bereich sind derzeit keine neuen, fälligen oder schwachen Vokabeln.";return}
 focus=await priorityPool(focus);
 var requested=parseInt($("distinctCount").value,10)||20;
 focus=focus.slice(0,Math.min(requested,focus.length));
 $("sessionTypeSelect").value="learn";
 resetSessionState(focus,"Heute fällig / schwach");
 $("scopeInfo").textContent="Heute fällig / schwach · "+focus.length+" verschiedene Vokabeln.";
 saveSettings();showView("trainer");await chooseNext(true)
}
async function startCustomSession(pool,label){
 if(!pool.length)return;
 $("sessionTypeSelect").value="learn";
 $("distinctCount").value=pool.length;
 resetSessionState(pool,label);
 showView("trainer");
 $("scopeInfo").textContent=label+" · "+pool.length+" verschiedene Vokabeln.";
 saveSettings();await chooseNext(true)
}
function chooseDirection(){
 var d=$("directionSelect").value;
 return d==="MIXED"?(Math.random()<.5?"DE_FR":"FR_DE"):d
}
async function chooseNext(){
 if(!session.active||session.awaitingChoice)return;
 var v=null;
 while(session.firstQueue.length){
  var candidate=session.firstQueue.shift();
  if(!session.seen[candidate.id]){v=candidate;break}
 }
 if(!v&&!session.firstRoundComplete){
  session.firstRoundComplete=true;
  if($("sessionTypeSelect").value==="test"){finishTest();return}
  session.awaitingChoice=true;
  $("roundCompleteText").textContent=session.pool.length+" verschiedene Vokabeln einmal abgeschlossen.";
  $("roundCompletePanel").hidden=false;
  $("prompt").textContent="Erste Runde geschafft.";
  $("answer").value="";
  return
 }
 if(!v){
  if($("adaptiveAfterFirst").checked){
   var scored=[];for(var i=0;i<session.pool.length;i++)scored.push([session.pool[i],await weakScore(session.pool[i],$("directionSelect").value)]);
   scored.sort(function(a,b){return a[1]-b[1]});
   var recent=new Set(session.recentIds||[]);
   var candidates=scored.map(function(x){return x[0]}).filter(function(x){return !recent.has(x.id)});
   if(!candidates.length)candidates=scored.map(function(x){return x[0]});
   var weakCount=Math.min(session.pool.length,Math.max(3,Math.ceil(session.pool.length*.5)));
   var weakIds=new Set(scored.slice(0,weakCount).map(function(x){return x[0].id}));
   var weakCandidates=candidates.filter(function(x){return weakIds.has(x.id)});
   v=(Math.random()<.70&&weakCandidates.length?weakCandidates:candidates);
   v=v[Math.floor(Math.random()*v.length)]
  }else{
   var ord=await orderPool(session.pool,$("orderSelect").value,$("directionSelect").value),recentSet=new Set(session.recentIds||[]);
   v=ord.find(function(x){return !recentSet.has(x.id)})||ord.find(function(x){return x.id!==session.lastId})||ord[0]
  }
 }
 session.current=v;session.currentDirection=chooseDirection();session.lastId=v.id;
 session.recentIds=(session.recentIds||[]).concat([v.id]).slice(-4);
 await renderCurrent()
}
async function continueWeak(){
 session.awaitingChoice=false;$("roundCompletePanel").hidden=true;await chooseNext()
}
function endSession(){
 session.active=false;session.awaitingChoice=false;$("roundCompletePanel").hidden=true;
 $("prompt").textContent="Session beendet.";$("answer").value="";$("feedback").className="feedback";$("feedback").textContent="Du kannst eine neue Session starten.";document.documentElement.lang="de";showView("home")
}
async function renderCurrent(){
 var v=session.current;if(!v)return;
 var p=await gp(v.id),d=session.currentDirection,fr=d==="DE_FR";
 session.currentResolved=false;
 clearTimeout(correctDetectTimer);
 $("check").textContent="Prüfen";
 $("prompt").textContent=fr?v.meanings.join(" / "):v.foreign;
 $("directionLabel").textContent=fr?"Deutsch → Französisch":"Französisch → Deutsch";
 $("languageHint").textContent=fr?"Antwort auf Französisch.":"Antwort auf Deutsch.";
 $("answer").lang=fr?"fr-FR":"de-DE";
 $("answer").setAttribute("lang",fr?"fr-FR":"de-DE");
 document.documentElement.lang=fr?"fr":"de";
 $("writingLanguage").textContent=fr?"✎ Schreibsprache: Französisch":"✎ Schreibsprache: Deutsch";
 $("answer").value="";
 $("feedback").className="feedback";
 $("feedback").textContent=$("sessionTypeSelect").value==="test"?"Test: Antwort schreiben und Return drücken.":"Schreiben – bei exakt richtiger Antwort geht es automatisch weiter.";
 $("currentLevel").textContent="Lernstufe "+(fr?p.deFr:p.frDe);
 $("trainerScope").textContent=session.sourceLabel||currentScopeText();
 updateSessionBadges();keepFocus()
}
function updateSessionBadges(){
 var seen=Object.keys(session.seen).length,total=session.pool.length,quote=session.attempts?Math.round(session.correct/session.attempts*100):0;
 $("sessionCoverage").textContent=seen+" / "+total+" verschiedene gesehen";
 $("sessionScore").textContent="Session: "+session.attempts+" Abfragen · "+session.correct+" richtig";
 $("bigProgress").textContent=seen+" / "+total;
 $("bigQuote").textContent=session.attempts?quote+" %":"–";
 $("bigAttempts").textContent=session.attempts;
 $("progressFill").style.width=(total?Math.min(100,seen/total*100):0)+"%"
}
function keepFocus(){setTimeout(function(){if(!$("trainerView").hidden&&session.active&&!session.awaitingChoice){try{$("answer").focus({preventScroll:true})}catch(e){$("answer").focus()}}},30)}
function nextDue(level){
 var days=[0,1,2,4,7,14][Math.max(0,Math.min(5,level))],d=new Date();d.setDate(d.getDate()+days);return d.toISOString()
}
function evaluateAnswer(v,d,g){
 if(d==="DE_FR"){
  var w=norm(v.foreign);
  if(g===w)return{kind:"correct",reason:""};
  if(stripAcc(g)===stripAcc(w))return{kind:"almost",reason:"Akzent/Sonderzeichen prüfen."};
  if(stripFrenchArticle(stripAcc(g))===stripFrenchArticle(stripAcc(w)))return{kind:"almost",reason:"Artikel prüfen."};
  return{kind:"wrong",reason:""}
 }
 return germanAccepted(v,g)?{kind:"correct",reason:""}:{kind:"wrong",reason:""}
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
 session.attempts++;if(result.kind==="correct"){session.correct++}
 session.seen[v.id]=true;session.currentResolved=true;
 session.testResults.push({id:v.id,kind:result.kind,direction:d,prompt:d==="DE_FR"?v.meanings.join(" / "):v.foreign,expected:expected});
 updateSessionBadges();$("currentLevel").textContent="Lernstufe "+(d==="DE_FR"?p.deFr:p.frDe);

 if($("sessionTypeSelect").value==="test"){
  fb.className="feedback";fb.textContent="Antwort gespeichert.";
  $("answer").value="";clearTimeout(autoTimer);autoTimer=setTimeout(function(){chooseNext()},250);return
 }

 if(result.kind==="correct"){fb.className="feedback good";fb.innerHTML="✓ Richtig: <strong>"+escapeHtml(expected)+"</strong>"}
 else if(result.kind==="almost"){fb.className="feedback almost";fb.innerHTML="Fast richtig – "+escapeHtml(result.reason)+"<br>Richtig: <strong>"+escapeHtml(expected)+"</strong>"}
 else{fb.className="feedback bad";fb.innerHTML="✗ Noch nicht richtig.<br>Richtig: <strong>"+escapeHtml(expected)+"</strong>"}
 if(result.kind!=="correct"||!$("autoNext").checked)$("check").textContent="Weiter";
 keepFocus();
 if(result.kind==="correct"&&$("autoNext").checked){clearTimeout(autoTimer);autoTimer=setTimeout(function(){chooseNext()},750)}
}
async function skipCurrent(){
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
 if($("sessionTypeSelect").value==="test")return;
 if(!session.active||!session.current||session.awaitingChoice)return;
 var v=session.current,d=session.currentDirection;
 $("feedback").className="feedback almost";
 $("feedback").innerHTML="Antwort: <strong>"+escapeHtml(d==="DE_FR"?v.foreign:v.meanings.join(" / "))+"</strong><br><span class='small'>Als nicht gewusst markiert.</span>";
 if(!session.seen[v.id]){
  await recordResult(v,d,"wrong");session.attempts++;session.seen[v.id]=true;session.currentResolved=true;updateSessionBadges()
 }
 $("check").textContent="Weiter";keepFocus()
}
function finishTest(){
 var total=session.testResults.length,ok=session.testResults.filter(function(x){return x.kind==="correct"}).length;
 var errors=session.testResults.filter(function(x){return x.kind!=="correct"});
 var html="<strong>Test beendet:</strong> "+ok+" von "+total+" richtig ("+(total?Math.round(ok/total*100):0)+" %).";
 if(errors.length){
  html+="<ol class='test-errors'>"+errors.map(function(x){return"<li>"+escapeHtml(x.prompt)+" → <strong>"+escapeHtml(x.expected)+"</strong></li>"}).join("")+"</ol>";
  html+="<button type='button' id='retryTestErrors'>Diese "+errors.length+" Fehler jetzt üben</button>"
 }
 $("feedback").className="feedback";$("feedback").innerHTML=html;
 session.active=false;$("prompt").textContent="Test abgeschlossen";$("answer").value="";$("showAnswer").hidden=false;
 var b=$("retryTestErrors");if(b)b.onclick=function(){
  var ids=Array.from(new Set(errors.map(function(x){return x.id}))),pool=ids.map(function(id){return vocab.find(function(v){return v.id===id})}).filter(Boolean);
  startCustomSession(pool,"Fehler aus dem Test")
 }
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
 $("appStatus").textContent="✓ Version 3.9 läuft · "+(cid?courseName(cid)+" · "+all.length+" Vokabeln":"noch keine Vokabeln importiert")
}
async function switchActiveCourse(id){
 setActiveCourse(id);saveSettings();populateAllSelectors();updateCourseLabels();await renderHome()
}
async function startHomeDueSession(){
 var all=vocab.filter(function(v){return v.courseId===activeCourseId()}),focus=[];
 for(var i=0;i<all.length;i++){
  var p=await gp(all[i].id);
  if(p.attempts===0||isDue(p)||Math.min(p.deFr,p.frDe)<=1)focus.push(all[i])
 }
 if(!focus.length){alert("Heute sind keine neuen, fälligen oder schwachen Vokabeln vorhanden.");return}
 focus=await priorityPool(focus);
 var s=loadSavedSettings(),count=Math.max(1,parseInt(s.distinctCount,10)||20);
 focus=focus.slice(0,Math.min(count,focus.length));
 await startCustomSession(focus,"Heute lernen")
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
   "</span><span class='muted'>"+escapeHtml(unitLabel(unitGroup(v.unitId))+" · "+partLabel(partGroup(v.unitId)))+
   "</span></span><span class='vocab-hit-arrow'>›</span>";
  btn.onclick=function(){editVocab(v.id)};row.appendChild(btn);box.appendChild(row)
 });
 if(matches.length>200){var note=document.createElement("div");note.className="small";note.textContent="Es werden die ersten 200 Treffer angezeigt. Suche genauer.";box.appendChild(note)}
}
function unitIdFromSelection(unit,part){
 if(/^module-[a-d]$/.test(unit))return unit;
 if(part==="alle"||!part)part="auftakt";
 return unit+"-"+part
}
function populateEditParts(){
 var unit=$("editUnit").value;populatePart($("editPart"),activeCourseId(),unit,false);
 if(/^module-[a-d]$/.test(unit))$("editPartLabel").hidden=true;
 else{$("editPartLabel").hidden=false;if(!$("editPart").value&&$("editPart").options.length)$("editPart").selectedIndex=0}
 updateEditLocation()
}
function updateEditLocation(){
 var unit=$("editUnit").value,part=/^module-[a-d]$/.test(unit)?"gesamtes Modul":partLabel($("editPart").value);
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
 populateUnit($("editUnit"),activeCourseId(),false);var ug=unitGroup(v.unitId);$("editUnit").value=ug;populateEditParts();
 if(!/^module-[a-d]$/.test(ug)){var pg=partGroup(v.unitId);if([].slice.call($("editPart").options).some(function(o){return o.value===pg}))$("editPart").value=pg}
 updateEditLocation();$("deleteVocab").hidden=false;$("editModal").hidden=false;setTimeout(function(){$("editForeign").focus()},30)
}
function closeEditModal(){$("editModal").hidden=true}
async function saveEdit(){
 var id=$("editId").value,foreign=$("editForeign").value.trim(),meanings=$("editMeanings").value.split(";").map(function(x){return x.trim()}).filter(Boolean);
 if(!foreign||!meanings.length){alert("Bitte sowohl Französisch als auch mindestens eine deutsche Bedeutung eintragen.");return}
 var existing=id?vocab.find(function(x){return x.id===id}):null;
 var v=existing||{id:"manual-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),courseId:activeCourseId(),userCreated:true};
 v.foreign=foreign;v.meanings=meanings;v.courseId=activeCourseId();v.unitId=unitIdFromSelection($("editUnit").value,$("editPart").value);
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
  if(/^module-[a-d]$/.test(u))out.push({key:u+"|alle",unit:u,part:"alle",label:unitLabel(u)});
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
async function importVocabularyFile(file){
 var data=await parseJsonFile(file);
 if(isFullBackup(data))throw new Error("Das ist ein komplettes Backup. Bitte unten „Backup wiederherstellen“ verwenden.");
 var entries=Array.isArray(data)?data:data.entries;
 if(!Array.isArray(entries))throw new Error("Keine Vokabelliste gefunden.");
 var importedCourse=(data&&data.course&&data.course.id)?String(data.course.id):(activeCourseId()||"franzoesisch");
 var unitNames=new Map();
 if(data&&Array.isArray(data.units))data.units.forEach(function(u){if(u&&u.id)unitNames.set(String(u.id),u.name||u.label||String(u.id))});
 var existing=new Map(vocab.map(function(v){return[v.id,v]})),added=0,skipped=0,invalid=0,generatedIds=0,enriched=0;
 function makeId(e,index){
  var raw=(importedCourse+"-"+(e.unitId||"bereich")+"-"+(e.foreign||"vokabel")).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
   .replace(/[’'`´]/g,"-").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,90);
  if(!raw)raw=importedCourse+"-vokabel-"+index;var id=raw,n=2;while(existing.has(id)){id=raw+"-"+n;n++}return id
 }
 for(var i=0;i<entries.length;i++){
  var e=entries[i];if(!e||!e.foreign||!e.unitId){invalid++;continue}
  var meanings=Array.isArray(e.meanings)?e.meanings:(e.meaning?[e.meaning]:[]);
  meanings=meanings.map(function(x){return String(x).trim()}).filter(Boolean);if(!meanings.length){invalid++;continue}
  var id=e.id?String(e.id):makeId(e,i+1);if(!e.id)generatedIds++;
  if(existing.has(id)){
   var old=existing.get(id);
   if(old.courseId===importedCourse&&!old.unitName&&unitNames.has(String(e.unitId))){old.unitName=unitNames.get(String(e.unitId));await reqP(os(S_VOCAB,"readwrite").put(old));enriched++}
   skipped++;continue
  }
  var v=Object.assign({},e,{id:id,courseId:importedCourse,foreign:String(e.foreign).trim(),meanings:meanings,unitName:unitNames.get(String(e.unitId))||e.unitName||null,importedAt:new Date().toISOString()});
  await reqP(os(S_VOCAB,"readwrite").put(v));existing.set(id,v);added++
 }
 if(data&&data.course){
  var c=Object.assign({},data.course);c.id=importedCourse;if(!c.label)c.label=c.name||importedCourse;await reqP(os(S_COURSES,"readwrite").put(c))
 }else await reqP(os(S_COURSES,"readwrite").put({id:importedCourse,name:importedCourse,label:importedCourse,learningLocale:"fr-FR",nativeLocale:"de-DE"}));
 await reload();setActiveCourse(importedCourse);populateCourseSelector();populateAllSelectors();updateCourseLabels();saveSettings();
 $("vocabImportResult").textContent=added+" neue Vokabeln hinzugefügt · "+skipped+" bereits vorhandene unverändert · "+invalid+" ungültige übersprungen"+
  (generatedIds?" · "+generatedIds+" IDs automatisch erzeugt":"")+(enriched?" · "+enriched+" Bereichsnamen ergänzt":"")+". Aktiver Kurs: "+courseName(importedCourse)+".";
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
 populateUnit($("unitSelect"),cid,false);populatePart($("partSelect"),cid,$("unitSelect").value,true);
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
["check","showAnswer","continueWeak","endSession"].forEach(preserveAnswerFocusOnButton);

$("startSession").onclick=startSession;
$("startDue").onclick=startDueSession;
$("check").onclick=checkAnswer;
$("showAnswer").onclick=revealCurrent;
$("continueWeak").onclick=continueWeak;
$("endSession").onclick=endSession;

$("tabHome").onclick=function(){showView("home")};
$("tabLearn").onclick=function(){showView("learn")};
$("tabPlan").onclick=function(){showView("plan")};
$("tabOverview").onclick=function(){showView("overview")};
$("tabVocab").onclick=function(){showView("vocab")};
$("tabData").onclick=function(){showView("data")};
$("activeCourseSelect").onchange=function(){switchActiveCourse(this.value)};
$("homeLearn").onclick=function(){showView("learn")};
$("homeDueLearn").onclick=startHomeDueSession;
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

["orderSelect","directionSelect","sessionTypeSelect","distinctCount","adaptiveAfterFirst","autoNext","autoDetectCorrect"].forEach(function(id){
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
