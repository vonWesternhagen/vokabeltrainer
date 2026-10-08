(function(){
"use strict";

var APP_VERSION="3.6";
var DB_NAME="VokabeltrainerTest";
var DB_VERSION=2;
var S_VOCAB="vocab",S_PROGRESS="progress",S_COURSES="courses",S_EXAMS="exams";
var FIXED_COURSE_ID="franzoesisch";
var SETTINGS_KEY="vokabeltrainer.settings.v2";
var db=null,vocab=[],courses=[],autoTimer=null,correctDetectTimer=null;

var seedCourse={id:"franzoesisch",name:"Französisch 10",learningLocale:"fr-FR",nativeLocale:"de-DE",schoolYearLabel:"Französisch 10"};
var seed=[
 {id:"le-projet",courseId:"franzoesisch",unitId:"unite-1-auftakt",foreign:"le projet",meanings:["der Plan","das Vorhaben","das Projekt"],seed:true},
 {id:"le-metier",courseId:"franzoesisch",unitId:"unite-1-auftakt",foreign:"le métier",meanings:["der Beruf"],seed:true},
 {id:"le-domaine",courseId:"franzoesisch",unitId:"unite-1-auftakt",foreign:"le domaine",meanings:["das Gebiet","der Bereich"],seed:true}
];
var seedIds=new Set(seed.map(function(v){return v.id}));

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

async function seedIfNeeded(){
 if((await reqP(os(S_COURSES).count()))===0)await reqP(os(S_COURSES,"readwrite").put(seedCourse));
 if((await reqP(os(S_VOCAB).count()))===0){
  var tx=db.transaction(S_VOCAB,"readwrite"),s=tx.objectStore(S_VOCAB);
  seed.forEach(function(v){s.put(v)});
  await new Promise(function(res,rej){tx.oncomplete=res;tx.onerror=function(){rej(tx.error)}})
 }
}

async function reload(){
 vocab=await reqP(os(S_VOCAB).getAll());
 var storedCourses=await reqP(os(S_COURSES).getAll());

 function looksLikeSectionId(value){
  var s=String(value||"").trim().toLowerCase().replace(/\s+/g,"-");
  return /^unite-?\d/.test(s)||/^unité-?\d/.test(s)||/^module-?[a-d]$/.test(s)||/^volet-?\d/.test(s)||
   /auftakt|vocabulaire|thematique|thématique/.test(s)
 }

 var vtx=db.transaction(S_VOCAB,"readwrite"),vs=vtx.objectStore(S_VOCAB);
 vocab.forEach(function(v){
  if(/^(unite-[123]|module-[a-d])/.test(String(v.unitId||"").toLowerCase())&&v.courseId!==FIXED_COURSE_ID){
   v.courseId=FIXED_COURSE_ID;vs.put(v)
  }
 });
 await new Promise(function(res,rej){vtx.oncomplete=res;vtx.onerror=function(){rej(vtx.error)}});
 vocab=await reqP(os(S_VOCAB).getAll());

 var ctx=db.transaction(S_COURSES,"readwrite"),cs=ctx.objectStore(S_COURSES);
 storedCourses.forEach(function(c){if(!c||!c.id||looksLikeSectionId(c.id)||looksLikeSectionId(c.name)){if(c&&c.id)cs.delete(c.id)}});
 cs.put(seedCourse);
 await new Promise(function(res,rej){ctx.oncomplete=res;ctx.onerror=function(){rej(ctx.error)}});

 courses=await reqP(os(S_COURSES).getAll());
 if(!courses.some(function(c){return c.id===FIXED_COURSE_ID}))courses.push(seedCourse);
 vocab.sort(function(a,b){return String(a.unitId||"").localeCompare(String(b.unitId||""))||String(a.id).localeCompare(String(b.id))})
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
function unitLabel(x){return({"unite-1":"Unité 1","unite-2":"Unité 2","unite-3":"Unité 3","module-a":"Module A","module-b":"Module B","module-c":"Module C","module-d":"Module D","alle":"Alle"})[x]||x}
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
 function setIf(id,val){var el=$(id);if(el&&val!=null&&[].slice.call(el.options||[]).some(function(o){return o.value===String(val)}))el.value=val}
 setIf("unitSelect",s.unit);
 populatePart($("partSelect"),FIXED_COURSE_ID,$("unitSelect").value,true);
 setIf("partSelect",s.part);
 setIf("orderSelect",s.order);setIf("directionSelect",s.direction);setIf("sessionTypeSelect",s.sessionType);
 if($("distinctCount")&&s.distinctCount)$("distinctCount").value=s.distinctCount;
 if($("adaptiveAfterFirst")&&typeof s.adaptive==="boolean")$("adaptiveAfterFirst").checked=s.adaptive;
 if($("autoNext")&&typeof s.autoNext==="boolean")$("autoNext").checked=s.autoNext;
 if($("autoDetectCorrect")&&typeof s.autoDetectCorrect==="boolean")$("autoDetectCorrect").checked=s.autoDetectCorrect;
 setIf("overviewUnit",s.overviewUnit);
 populatePart($("overviewPart"),FIXED_COURSE_ID,$("overviewUnit").value,true);
 setIf("overviewPart",s.overviewPart);setIf("overviewSort",s.overviewSort)
}

function currentScopeText(){
 return courseName(FIXED_COURSE_ID)+" · "+unitLabel($("unitSelect").value)+" · "+partLabel($("partSelect").value)
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
 var available=filtered(FIXED_COURSE_ID,$("unitSelect").value,$("partSelect").value);
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
 var available=filtered(FIXED_COURSE_ID,$("unitSelect").value,$("partSelect").value),focus=[];
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

async function renderHome(){
 $("homeTotal").textContent=vocab.filter(function(v){return v.courseId===FIXED_COURSE_ID}).length;
 var n=0,d=0,w=0,all=vocab.filter(function(v){return v.courseId===FIXED_COURSE_ID});
 for(var i=0;i<all.length;i++){
  var p=await gp(all[i].id);
  if(p.attempts===0)n++;
  if(isDue(p))d++;
  if(p.attempts>0&&Math.min(p.deFr,p.frDe)<=1)w++
 }
 $("homeNew").textContent=n;$("homeDue").textContent=d;$("homeWeak").textContent=w;
 var e=await reqP(os(S_EXAMS).get(FIXED_COURSE_ID));
 if(e&&e.date){
  var days=Math.max(0,Math.ceil((new Date(e.date+"T12:00:00")-new Date())/86400000));
  $("homeExamText").textContent="Klassenarbeit in "+days+" Tag"+(days===1?"":"en")+" · Lernpensum planen"
 }else $("homeExamText").textContent="Stoff und Lernpensum planen"
}
async function startHomeDueSession(){
 var all=vocab.filter(function(v){return v.courseId===FIXED_COURSE_ID}),focus=[];
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

async function renderOverview(){
 var list=filtered(FIXED_COURSE_ID,$("overviewUnit").value,$("overviewPart").value),body=$("overviewBody"),rows=[];
 var t={attempts:0,correct:0,bad:0};
 for(var i=0;i<list.length;i++){
  var v=list[i],p=await gp(v.id);t.attempts+=p.attempts;t.correct+=p.correct;t.bad+=p.almost+p.wrong;
  rows.push({v:v,p:p,score:await weakScore(v,"MIXED")})
 }
 if($("overviewSort").value==="weakest")rows.sort(function(a,b){return a.score-b.score});
 body.innerHTML="";
 rows.forEach(function(r){
  var v=r.v,p=r.p,tr=document.createElement("tr");
  var de="Stufe "+p.deFr+" · "+p.attemptsDEFR+"× · ✓"+p.correctDEFR+" ~"+p.almostDEFR+" ✗"+p.wrongDEFR;
  var fr="Stufe "+p.frDe+" · "+p.attemptsFRDE+"× · ✓"+p.correctFRDE+" ~"+p.almostFRDE+" ✗"+p.wrongFRDE;
  var total=p.attempts+"× · ✓"+p.correct+" ~"+p.almost+" ✗"+p.wrong;
  var due="DE→FR "+fmtDate(p.dueDEFR)+" / FR→DE "+fmtDate(p.dueFRDE);
  [unitLabel(unitGroup(v.unitId))+" · "+partLabel(partGroup(v.unitId)),v.foreign+" — "+v.meanings.join(" / "),de,fr,total,due].forEach(function(c,i){
   var td=document.createElement("td");td.textContent=c;if(i===2||i===3)td.className="stats-mini";tr.appendChild(td)
  });
  body.appendChild(tr)
 });
 $("sumEntries").textContent=list.length;$("sumAttempts").textContent=t.attempts;$("sumCorrect").textContent=t.correct;$("sumWrong").textContent=t.bad
}

async function renderVocab(){
 var q=norm($("vocabSearch").value),box=$("vocabList");box.innerHTML="";
 if(!q){$("vocabSearchInfo").textContent="Tippe Buchstaben ein. Gesucht wird gleichzeitig in Französisch und Deutsch.";return}
 var matches=vocab.filter(function(v){return v.courseId===FIXED_COURSE_ID&&norm(v.foreign+" "+v.meanings.join(" ")).includes(q)})
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
 var unit=$("editUnit").value;populatePart($("editPart"),FIXED_COURSE_ID,unit,false);
 if(/^module-[a-d]$/.test(unit))$("editPartLabel").hidden=true;
 else{$("editPartLabel").hidden=false;if(!$("editPart").value&&$("editPart").options.length)$("editPart").selectedIndex=0}
 updateEditLocation()
}
function updateEditLocation(){
 var unit=$("editUnit").value,part=/^module-[a-d]$/.test(unit)?"gesamtes Modul":partLabel($("editPart").value);
 $("editLocation").textContent="Ablage: "+unitLabel(unit)+" · "+part
}
function newVocab(){
 $("editTitle").textContent="Neue Vokabel";$("editId").value="";$("editForeign").value="";$("editMeanings").value="";
 populateUnit($("editUnit"),FIXED_COURSE_ID,false);populateEditParts();$("deleteVocab").hidden=true;$("editModal").hidden=false;
 setTimeout(function(){$("editForeign").focus()},30)
}
function editVocab(id){
 var v=vocab.find(function(x){return x.id===id});if(!v)return;
 $("editTitle").textContent="Vokabel bearbeiten";$("editId").value=v.id;$("editForeign").value=v.foreign;$("editMeanings").value=v.meanings.join("; ");
 populateUnit($("editUnit"),FIXED_COURSE_ID,false);var ug=unitGroup(v.unitId);$("editUnit").value=ug;populateEditParts();
 if(!/^module-[a-d]$/.test(ug)){var pg=partGroup(v.unitId);if([].slice.call($("editPart").options).some(function(o){return o.value===pg}))$("editPart").value=pg}
 updateEditLocation();$("deleteVocab").hidden=false;$("editModal").hidden=false;setTimeout(function(){$("editForeign").focus()},30)
}
function closeEditModal(){$("editModal").hidden=true}
async function saveEdit(){
 var id=$("editId").value,foreign=$("editForeign").value.trim(),meanings=$("editMeanings").value.split(";").map(function(x){return x.trim()}).filter(Boolean);
 if(!foreign||!meanings.length){alert("Bitte sowohl Französisch als auch mindestens eine deutsche Bedeutung eintragen.");return}
 var existing=id?vocab.find(function(x){return x.id===id}):null;
 var v=existing||{id:"manual-"+Date.now()+"-"+Math.random().toString(36).slice(2,7),courseId:FIXED_COURSE_ID,userCreated:true};
 v.foreign=foreign;v.meanings=meanings;v.courseId=FIXED_COURSE_ID;v.unitId=unitIdFromSelection($("editUnit").value,$("editPart").value);
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
 var out=[],units=unitsForCourse(FIXED_COURSE_ID);
 units.forEach(function(u){
  if(/^module-[a-d]$/.test(u))out.push({key:u+"|alle",unit:u,part:"alle",label:unitLabel(u)});
  else partsFor(FIXED_COURSE_ID,u).forEach(function(p){out.push({key:u+"|"+p,unit:u,part:p,label:unitLabel(u)+" · "+partLabel(p)})})
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
  var a=key.split("|"),list=filtered(FIXED_COURSE_ID,a[0],a[1]);
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
 await reqP(os(S_EXAMS,"readwrite").put({id:FIXED_COURSE_ID,courseId:FIXED_COURSE_ID,date:date,scopes:scopes}));
 await renderExamSummary()
}
async function deleteExam(){
 await reqP(os(S_EXAMS,"readwrite").delete(FIXED_COURSE_ID));$("examDate").value="";populateExamScopes([]);$("examSummary").innerHTML="Für Französisch 10 ist noch keine Klassenarbeit gespeichert."
}
async function renderExamSummary(){
 var e=await reqP(os(S_EXAMS).get(FIXED_COURSE_ID)),box=$("examSummary");
 if(!e){populateExamScopes([]);box.innerHTML="Für Französisch 10 ist noch keine Klassenarbeit gespeichert.";return}
 $("examDate").value=e.date;var scopes=oldExamScopes(e);populateExamScopes(scopes);
 var pool=poolForScopes(scopes),st=await computeExamStats(pool,e.date);
 box.innerHTML="<strong>Französisch 10 · "+scopes.length+" Stoffbereich"+(scopes.length===1?"":"e")+"</strong><br>"+
  "Klassenarbeit: "+escapeHtml(e.date)+" · noch "+st.days+" Tage<br>"+pool.length+" verschiedene Vokabeln im Stoff · "+
  st.newCount+" noch nie geübt · "+st.weak+" schwach · "+st.due+" fällig.<br>"+
  "<strong>Richtwert heute: "+st.dailyTarget+" verschiedene Vokabeln</strong>, damit der gesamte Stoff bis zur Arbeit mindestens einmal durchläuft."
}
async function startExamLearning(){
 var e=await reqP(os(S_EXAMS).get(FIXED_COURSE_ID));if(!e)return alert("Bitte zuerst eine Klassenarbeit speichern.");
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
 var entries=vocab.filter(function(v){return v.courseId===FIXED_COURSE_ID});
 downloadJson({fileType:"vocabulary-course",schemaVersion:6,exportedAt:new Date().toISOString(),course:seedCourse,entries:entries},"vokabeltrainer-franzoesisch-10.json")
}
async function parseJsonFile(file){
 var text=await file.text(),data;
 try{data=JSON.parse(text)}catch(e){throw new Error("Die Datei ist kein gültiges JSON.")}
 return data
}
function isFullBackup(data){
 return data&&((data.backupType==="full-backup")||(Array.isArray(data.courses)&&Array.isArray(data.entries)&&Array.isArray(data.progress)&&Array.isArray(data.exams)))
}
async function importVocabularyFile(file){
 var data=await parseJsonFile(file);
 if(isFullBackup(data))throw new Error("Das ist ein komplettes Backup. Bitte unten „Backup wiederherstellen“ verwenden.");
 var entries=Array.isArray(data)?data:data.entries;
 if(!Array.isArray(entries))throw new Error("Keine Vokabelliste gefunden.");
 var existing=new Map(vocab.map(function(v){return[v.id,v]})),incomingForeign=new Map(),added=0,skipped=0,removedSeeds=0;

 entries.forEach(function(e){if(e&&e.id&&e.foreign)incomingForeign.set(norm(e.foreign),e.id)});
 for(var si=0;si<seed.length;si++){
  var sv=seed[si],incomingId=incomingForeign.get(norm(sv.foreign));
  if(incomingId&&incomingId!==sv.id&&existing.has(sv.id)){
   await reqP(os(S_VOCAB,"readwrite").delete(sv.id));await reqP(os(S_PROGRESS,"readwrite").delete(sv.id));existing.delete(sv.id);removedSeeds++
  }
 }
 for(var i=0;i<entries.length;i++){
  var e=entries[i];if(!e||!e.id||!e.foreign||!e.unitId)continue;
  if(existing.has(e.id)){skipped++;continue}
  var meanings=Array.isArray(e.meanings)?e.meanings:(e.meaning?[e.meaning]:[]);
  meanings=meanings.map(function(x){return String(x).trim()}).filter(Boolean);if(!meanings.length)continue;
  var v=Object.assign({},e,{courseId:FIXED_COURSE_ID,foreign:String(e.foreign).trim(),meanings:meanings,importedAt:new Date().toISOString()});
  await reqP(os(S_VOCAB,"readwrite").put(v));existing.set(v.id,v);added++
 }
 await reqP(os(S_COURSES,"readwrite").put(seedCourse));await reload();populateAllSelectors();
 $("vocabImportResult").textContent=added+" neue Vokabeln hinzugefügt · "+skipped+" bereits vorhandene unverändert"+(removedSeeds?" · "+removedSeeds+" Test-Dubletten entfernt":"")+".";
 await renderOverview()
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
 if((await reqP(os(S_COURSES).count()))===0)await reqP(os(S_COURSES,"readwrite").put(seedCourse));
 await reload();populateAllSelectors();applySettings(data.settings||loadSavedSettings());await renderOverview();await renderExamSummary();
 $("backupResult").textContent="Backup vollständig wiederhergestellt: "+data.entries.length+" Vokabeln und "+(data.progress||[]).length+" Lernstände.";
 await startSession()
}
async function resetAll(){
 if(!confirm("Alle lokalen Daten löschen und auf die drei Testvokabeln zurücksetzen?"))return;
 [S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS].forEach(function(){});
 for(var s of [S_VOCAB,S_PROGRESS,S_COURSES,S_EXAMS])await reqP(os(s,"readwrite").clear());
 try{localStorage.removeItem(SETTINGS_KEY)}catch(e){}
 await seedIfNeeded();await reload();populateAllSelectors();populateExamScopes([]);await startSession()
}

function populateAllSelectors(){
 populateUnit($("unitSelect"),FIXED_COURSE_ID,false);populatePart($("partSelect"),FIXED_COURSE_ID,$("unitSelect").value,true);
 populateUnit($("overviewUnit"),FIXED_COURSE_ID,true);populatePart($("overviewPart"),FIXED_COURSE_ID,$("overviewUnit").value,true);
 populateExamScopes([])
}
function bindUnitPart(unitId,partId,afterChange){
 $(unitId).addEventListener("change",function(){populatePart($(partId),FIXED_COURSE_ID,$(unitId).value,true);saveSettings();if(afterChange)afterChange()});
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
  db=await openDb();await seedIfNeeded();await reload();populateAllSelectors();
  bindUnitPart("unitSelect","partSelect",null);bindUnitPart("overviewUnit","overviewPart",renderOverview);
  applySettings(loadSavedSettings());
  await renderExamSummary();
  $("appStatus").textContent="✓ Version 3.7 läuft. Startseite · fokussierter Schreibmodus · flüssiger Pencil-Workflow.";
  showView("home");await renderHome()
 }catch(err){
  $("appStatus").textContent="Startfehler: "+err.message;$("appStatus").style.background="#fdeaea";console.error(err)
 }
})();
})();

if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("./sw.js").catch(function(){})})}
