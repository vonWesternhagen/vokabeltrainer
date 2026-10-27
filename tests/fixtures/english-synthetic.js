// Invented practice course; no content from the private book import.
const c={id:'english-demo',label:'Englisch Testkurs',learningLocale:'en-GB',nativeLocale:'de-DE'};
const card=(id,foreign,meaning,unitId='unit-1',part='part-a',extra={})=>({id,courseId:c.id,foreign,meanings:[meaning],unitId,unitName:unitId==='irregular-verbs'?'Unregelmäßige Verben':unitId==='unit-0'?'Welcome to Moon Island':'Unit '+unitId.slice(5)+': Moon Island',part,page:285,...extra});
module.exports={course:c,card,fixture:{fileType:'vocabulary-course',schemaVersion:7,course:c,entries:[
 card('welcome','the moon island','die Mondinsel','unit-0','auftakt'),
 card('swim','to swim','schwimmen'),card('find','to find out (about sth.)','herausfinden','unit-1','part-b'),
 card('berry','a moonberry','eine Mondbeere','unit-1','part-c',{locations:[{unitId:'unit-5',unitName:'Unit 5: Moon Island',part:'story',page:318}]}),
 card('dish','the moon dish','das Mondgericht (Speise)','unit-1','story'),card('intro','a starleaf','ein Sternblatt','unit-1','auftakt'),
 card('lie-noun','lie','die Lüge','unit-2'),card('lie-say','to lie','lügen','unit-2'),card('lie-rest','to lie','liegen','unit-2'),
 card('mean-intend','to mean','meinen','unit-3'),card('mean-signify','to mean','bedeuten','unit-3'),
 card('invented','to glimmerate','mondglitzern','unit-4'),card('end','the cloudwagon','der Wolkenwagen','unit-5'),
 card('forms-swim','swim – swam – swum','schwimmen (alle unregelmäßigen Formen)','irregular-verbs','alle'),
 card('forms-be','be – was/were – been','sein (alle unregelmäßigen Formen)','irregular-verbs','alle')
]}};
