Vokabeltrainer Prototyp 3 – GitHub Pages Update

NEU:
- Auswahl von Kurs, Unité/Modul und Teilbereich (Auftakt, Vocabulaire thématique, Volet 1, Volet 2).
- Reihenfolge: vorwärts, rückwärts, zufällig, schlechteste zuerst.
- In jeder Session wird jede Vokabel des gewählten Bereichs mindestens einmal abgefragt.
- Danach standardmäßig adaptiver Schwerpunkt auf den schwächsten Vokabeln.
- Richtungen: DE→Fremdsprache, Fremdsprache→DE, gemischt.
- Lernmodus und Testmodus.
- getrennte Lernstufen pro Richtung + einfache Wiederholungsfälligkeit.
- Klassenarbeitstermin mit Stoffbereich und grober Tagesempfehlung.
- Übersicht/Statistik nach Kurs/Unité/Teilbereich.
- Vokabelbestand durchsuchen und einzelne Einträge bearbeiten.
- additive JSON-Imports; zweite Sprache über eigene course.id möglich.
- komplettes Backup oder einzelner Kurs exportierbar.
- NAS bleibt Dateiaustausch/Backup über exportierte JSON-Dateien.
- Apple Pencil/Scribble und iPad-Diktat bleiben Eingabewege.

UPDATE AUF GITHUB:
1. Diese fünf Dateien hochladen/ersetzen:
   index.html
   styles.css
   app.js
   manifest.webmanifest
   sw.js
2. Commit.
3. GitHub Pages Deployment abwarten.
4. Auf dem iPad URL mit ?v=3 öffnen.
5. Oben muss stehen: "✓ Version 3 läuft. IndexedDB ist verfügbar."

Danach die große Vokabel-JSON erneut importieren. Bestehende Lernstände der drei Testvokabeln bleiben bei gleicher ID erhalten.
