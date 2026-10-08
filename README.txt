Vokabeltrainer 4.2 – Importreparatur

WICHTIGER FEHLER BEHOBEN:
In V3.9 bis V4.1 waren beim Umbau versehentlich die Funktionen
parseJsonFile() und isFullBackup() aus app.js entfernt worden.
Der Import-Button rief diese Funktionen weiterhin auf. Deshalb konnte
keine Vokabeldatei mehr importiert werden – unabhängig davon, ob die Datei korrekt war.

Behoben:
- JSON-Dateien können wieder gelesen und geparst werden.
- Vokabeldatei und Vollbackup werden wieder sauber unterschieden.
- aussagekräftige Fehler bei ungültigem JSON / leerer Vokabelliste.
- die Französisch-6-Datei mit 79 Einträgen ist strukturell kompatibel.
- Beim Lernen gibt es jetzt zusätzlich „Alle Vokabeln“.
  Dann wird der gesamte aktive Kurs als Lernbereich verwendet.

Nach GitHub-Upload mit ?v=42 öffnen.
