Vokabeltrainer Prototyp 3.1 – Korrektur der Bereichsauswahl

KORRIGIERT:
- JSON-Datei vokabeltrainer_franz_buchseiten_163-185.json ist mit der App abgeglichen.
- Kurs zeigt nur echte Kurse (z. B. Französisch), nicht Unités oder Module.
- Unité / Modul zeigt danach: Unité 1, Unité 2, Unité 3, Module A-D.
- Teilbereich zeigt bei Unités: Alle, Auftaktseite, Vocabulaire thématique, Volet 1, Volet 2.
- Bei Module A-D ist Teilbereich automatisch "gesamtes Modul".
- Selbstheilung für bereits importierte lokale Testdaten, falls courseId versehentlich wie eine Unité/Modul-ID aussieht.
- Reihenfolge der Bereiche ist logisch statt alphabetisch.

JSON-SCHEMA:
course.id = "franzoesisch"
entry.unitId = z.B. "unite-2-volet-1" oder "module-a"

GitHub Pages:
Die 5 Dateien index.html, styles.css, app.js, manifest.webmanifest und sw.js hochladen/ersetzen.
Danach URL mit ?v=31 öffnen.
Oben muss stehen:
✓ Version 3.1 läuft. JSON-Struktur geprüft. IndexedDB ist verfügbar.
