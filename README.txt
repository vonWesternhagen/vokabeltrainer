Vokabeltrainer 3.4

Neu:
- Feld "Anzahl verschiedener Vokabeln" (Standard: 20).
- Bei 20 werden genau 20 verschiedene Vokabeln für die Session ausgewählt.
- Erste Runde: jede dieser Vokabeln garantiert genau einmal.
- Testmodus endet nach dieser ersten Runde.
- Lernmodus: danach adaptive Wiederholung.
- Adaptive Wiederholung wurde korrigiert: nicht mehr nur aus den 5 schlechtesten.
  70 % Schwerpunkt auf der schwächeren Hälfte, 30 % auf dem übrigen Session-Pool.
  Die letzten 4 Vokabeln werden nach Möglichkeit nicht sofort wiederholt.
- Zähler zeigt nun verschiedene Vokabeln und Gesamtzahl der Abfragen getrennt.
- Aktueller Kurs wird sichtbar/intern als "Französisch 10" bezeichnet.
  Die stabile courseId "franzoesisch" bleibt erhalten, damit die vorhandene JSON weiter funktioniert.
- Export des Kurses heißt "vokabeltrainer-franzoesisch-10.json".

Warum gestern wenige verschiedene Vokabeln kamen:
Nach der ersten Runde wählte Version 3.x adaptiv nur aus den 5 schlechtesten Vokabeln.
Das führte bei längeren Sessions zu sehr vielen Wiederholungen derselben kleinen Gruppe.
Version 3.4 verteilt die Wiederholungen deutlich breiter.

Update:
index.html, styles.css, app.js, manifest.webmanifest und sw.js ersetzen.
Danach mit ?v=34 öffnen.
