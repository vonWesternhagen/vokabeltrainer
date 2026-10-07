
(function(){
"use strict";

var DB_NAME="VokabeltrainerTest";
var DB_VERSION=1;
var STORE_VOCAB="vocab";
var STORE_PROGRESS="progress";
var db=null;
var vocab=[];
var index=0;
var direction="DE_FR";
var recognition=null;
var listening=false;

var seed=[
  {id:"le-projet",courseId:"franzoesisch",unitId:"unite-1",foreign:"le projet",meanings:["der Plan","das Vorhaben","das Projekt"]},
  {id:"le-metier",courseId:"franzoesisch",unitId:"unite-1",foreign:"le métier",meanings:["der Beruf"]},
  {id:"le-domaine",courseId:"franzoesisch",unitId:"unite-1",foreign:"le domaine",meanings:["das Gebiet","der Bereich"]}
];

function $(id){ return document.getElementById(id); }

function openDb(){
  return new Promise(function(resolve,reject){
    var req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=function(e){
      var d=e.target.result;
      if(!d.objectStoreNames.contains(STORE_VOCAB)) d.createObjectStore(STORE_VOCAB,{keyPath:"id"});
      if(!d.objectStoreNames.contains(STORE_PROGRESS)) d.createObjectStore(STORE_PROGRESS,{keyPath:"id"});
    };
    req.onsuccess=function(){ resolve(req.result); };
    req.onerror=function(){ reject(req.error); };
  });
}

function reqPromise(req){
  return new Promise(function(resolve,reject){
    req.onsuccess=function(){ resolve(req.result); };
    req.onerror=function(){ reject(req.error); };
  });
}

function store(name,mode){
  return db.transaction(name,mode||"readonly").objectStore(name);
}

async function seedIfNeeded(){
  var count=await reqPromise(store(STORE_VOCAB).count());
  if(count===0){
    var tx=db.transaction(STORE_VOCAB,"readwrite");
    var s=tx.objectStore(STORE_VOCAB);
    seed.forEach(function(v){s.put(v);});
    await new Promise(function(resolve,reject){
      tx.oncomplete=resolve;
      tx.onerror=function(){reject(tx.error);};
    });
  }
}

async function loadVocab(){
  vocab=await reqPromise(store(STORE_VOCAB).getAll());
  vocab.sort(function(a,b){ return a.foreign.localeCompare(b.foreign,"fr"); });
  if(index>=vocab.length) index=0;
}

async function getProgress(id){
  var p=await reqPromise(store(STORE_PROGRESS).get(id));
  return p || {id:id,deFr:0,frDe:0,correct:0,wrong:0};
}

async function saveProgress(p){
  await reqPromise(store(STORE_PROGRESS,"readwrite").put(p));
}

function norm(s){
  return String(s||"").trim().toLowerCase().replace(/[’‘`´]/g,"'").replace(/\s+/g," ");
}

function stripAccents(s){
  try { return norm(s).normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
  catch(e){ return norm(s); }
}

function germanAccepted(item,given){
  var g=norm(given);
  var gNo=g.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"");
  for(var i=0;i<item.meanings.length;i++){
    var x=norm(item.meanings[i]);
    var xNo=x.replace(/^(der|die|das|ein|eine|einen|einem|einer)\s+/,"");
    if(g===x || gNo===xNo) return true;
  }
  return false;
}

async function renderLevels(){
  var box=$("levels");
  box.innerHTML="";
  for(var i=0;i<vocab.length;i++){
    var item=vocab[i];
    var p=await getProgress(item.id);
    var row=document.createElement("div");
    row.className="row";
    var left=document.createElement("span");
    left.textContent=item.foreign+" → "+item.meanings.join(" / ");
    var right=document.createElement("strong");
    right.textContent="DE→FR "+p.deFr+" | FR→DE "+p.frDe;
    row.appendChild(left); row.appendChild(right); box.appendChild(row);
  }
}

async function render(){
  if(vocab.length===0){ $("prompt").textContent="Keine Vokabeln vorhanden"; return; }
  var item=vocab[index];
  var p=await getProgress(item.id);
  $("progress").textContent=(index+1)+" / "+vocab.length;
  $("direction").textContent=direction==="DE_FR"?"Deutsch → Französisch":"Französisch → Deutsch";
  $("prompt").textContent=direction==="DE_FR"?item.meanings.join(" / "):item.foreign;
  $("level").textContent="Lernstufe "+(direction==="DE_FR"?p.deFr:p.frDe);
  $("answer").value="";
  $("answer").lang=direction==="DE_FR"?"fr":"de";
  $("feedback").className="feedback";
  $("feedback").textContent="Noch keine Antwort geprüft.";
  await renderLevels();
}

async function check(){
  var item=vocab[index];
  var given=norm($("answer").value);
  var feedback=$("feedback");
  if(!given){ feedback.className="feedback almost"; feedback.textContent="Bitte zuerst eine Antwort eingeben."; return; }

  var p=await getProgress(item.id);
  if(direction==="DE_FR"){
    var wanted=norm(item.foreign);
    if(given===wanted){
      p.deFr=Math.min(5,p.deFr+1); p.correct++;
      feedback.className="feedback good";
      feedback.innerHTML="✓ Richtig: <strong>"+item.foreign+"</strong><br>Die Lernstufe wurde erhöht.";
    }else if(stripAccents(given)===stripAccents(wanted)){
      feedback.className="feedback almost";
      feedback.innerHTML="Fast richtig – Akzent oder Sonderzeichen prüfen.<br>Richtig: <strong>"+item.foreign+"</strong>";
    }else{
      p.deFr=Math.max(0,p.deFr-1); p.wrong++;
      feedback.className="feedback bad";
      feedback.innerHTML="✗ Noch nicht richtig.<br>Richtig: <strong>"+item.foreign+"</strong>";
    }
  }else{
    if(germanAccepted(item,given)){
      p.frDe=Math.min(5,p.frDe+1); p.correct++;
      feedback.className="feedback good";
      feedback.innerHTML="✓ Richtig: <strong>"+item.meanings.join(" / ")+"</strong><br>Die Lernstufe wurde erhöht.";
    }else{
      p.frDe=Math.max(0,p.frDe-1); p.wrong++;
      feedback.className="feedback bad";
      feedback.innerHTML="✗ Noch nicht richtig.<br>Richtig: <strong>"+item.meanings.join(" / ")+"</strong>";
    }
  }
  await saveProgress(p);
  $("level").textContent="Lernstufe "+(direction==="DE_FR"?p.deFr:p.frDe);
  await renderLevels();
}

function setupSpeech(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    $("mic").disabled=true;
    $("speechInfo").textContent="Direkte Web-Spracherkennung ist hier nicht verfügbar. Bitte die iPad-Diktierfunktion im Textfeld verwenden.";
    return;
  }
  recognition=new SR();
  recognition.interimResults=false;
  recognition.maxAlternatives=3;
  recognition.continuous=false;
  recognition.onstart=function(){ listening=true; $("mic").textContent="■ Aufnahme läuft"; };
  recognition.onend=function(){ listening=false; $("mic").textContent="🎤 Sprechen"; };
  recognition.onerror=function(e){
    $("feedback").className="feedback almost";
    $("feedback").textContent="Spracherkennung: "+e.error+". Alternativ iPad-Diktieren verwenden.";
  };
  recognition.onresult=function(e){
    var t=e.results[0][0].transcript;
    $("answer").value=t;
    $("feedback").className="feedback";
    $("feedback").textContent="Erkannt: „"+t+"“ – jetzt Prüfen tippen.";
  };
  $("speechInfo").textContent="Direkte Web-Spracherkennung ist verfügbar.";
}

function startSpeech(){
  if(!recognition) return;
  recognition.lang=direction==="DE_FR"?"fr-FR":"de-DE";
  try{
    if(listening) recognition.stop();
    else recognition.start();
  }catch(e){}
}

async function importJson(file){
  var data=JSON.parse(await file.text());
  if(!Array.isArray(data.entries)) throw new Error("Die Datei enthält kein entries-Array.");
  var tx=db.transaction(STORE_VOCAB,"readwrite");
  var s=tx.objectStore(STORE_VOCAB);
  var count=0;
  data.entries.forEach(function(e){
    if(!e.id || !e.foreign || !Array.isArray(e.meanings) || !e.meanings.length) return;
    s.put({
      id:String(e.id),
      courseId:(data.course&&data.course.id)||e.courseId||"import",
      unitId:(data.unit&&data.unit.id)||e.unitId||"import",
      foreign:String(e.foreign),
      meanings:e.meanings.map(String)
    });
    count++;
  });
  await new Promise(function(resolve,reject){
    tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error);};
  });
  await loadVocab();
  $("importResult").textContent=count+" Vokabel(n) importiert/aktualisiert.";
  await render();
}

async function exportBackup(){
  var entries=await reqPromise(store(STORE_VOCAB).getAll());
  var progress=await reqPromise(store(STORE_PROGRESS).getAll());
  var data={schemaVersion:1,exportedAt:new Date().toISOString(),entries:entries,progress:progress};
  var blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  var url=URL.createObjectURL(blob);
  var a=document.createElement("a");
  a.href=url; a.download="vokabeltrainer-backup.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

async function resetAll(){
  if(!confirm("Alle Testdaten und Lernstände löschen?")) return;
  await reqPromise(store(STORE_VOCAB,"readwrite").clear());
  await reqPromise(store(STORE_PROGRESS,"readwrite").clear());
  await seedIfNeeded();
  await loadVocab();
  index=0; direction="DE_FR";
  await render();
}

$("check").addEventListener("click",check);
$("next").addEventListener("click",async function(){ index=(index+1)%vocab.length; await render(); });
$("switch").addEventListener("click",async function(){ direction=direction==="DE_FR"?"FR_DE":"DE_FR"; await render(); });
$("mic").addEventListener("click",startSpeech);
$("export").addEventListener("click",exportBackup);
$("reset").addEventListener("click",resetAll);
$("jsonFile").addEventListener("change",async function(e){
  var f=e.target.files&&e.target.files[0];
  if(!f) return;
  try{ await importJson(f); }
  catch(err){ $("importResult").textContent="Importfehler: "+err.message; }
  e.target.value="";
});

(async function init(){
  try{
    db=await openDb();
    await seedIfNeeded();
    await loadVocab();
    setupSpeech();
    await render();
    $("appStatus").textContent="✓ JavaScript läuft. IndexedDB ist verfügbar.";
  }catch(err){
    $("appStatus").textContent="Fehler beim Start: "+err.message;
    $("appStatus").style.background="#fdeaea";
  }
})();
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function() {
    navigator.serviceWorker.register("./sw.js").catch(function(){});
  });
}
