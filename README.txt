Vokabeltrainer 4.3 – vereinfachter Lernfluss und saubere Kursstruktur

DATENSTRUKTUR
- Sichtbar nur: Kurs → Unité/Modul → Teilbereich.
- Interne Buchunterüberschriften wie „Se présenter“, „Ça va“, „Âge“ bleiben nur als sectionName gespeichert.
- Französisch 6, Seiten 176–178 werden automatisch als Unité 0 / Auftakt migriert.
- Alte zusammengesetzte IDs wie unite-1-volet-1 werden in unitId=unite-1 und part=volet-1 getrennt.
- Bestehende Lernstände bleiben über die unveränderten Vokabel-IDs erhalten.

IMPORT
- Jede Datei MUSS course.id und einen sichtbaren Kursnamen enthalten.
- Vor Import erscheint z.B. „79 Vokabeln → Französisch 6 importieren?“
- Eine bereits vorhandene Kurs-ID mit abweichendem Kursnamen führt zum Abbruch.
- Zulässige sichtbare unitId: unite-0, unite-1, ... oder module-a, module-b, ...
- Teilbereich steht separat in part.
- Legacy-Französisch-6-Datei (Seiten 176–178) wird beim Import automatisch zu Unité 0 / Auftakt.

LERNEN
- Immer auswählbar: Alle Vokabeln oder einzelne Unités/Module.
- Teilbereich ist bei „Alle Vokabeln“, Unité 0 und Modulen automatisch deaktiviert.
- Standard-Reihenfolge: zufällig.
- Standard-Anzahl: 10.
- Nur zwei Startmodi:
  1. Neue Vokabeln lernen:
     noch nie abgefragte Wörter; fehlende Plätze mit den schwächsten bereits geübten auffüllen.
  2. Schlecht gekonnte Vokabeln lernen:
     kombinierte Schwächenwertung aus Erfolgsquote, Lernstufe und Versuchshistorie.
- Eine Runde mit 10 ausgewählten Vokabeln endet nach exakt 10 Vokabeln. Keine automatische Zusatzrunde.
- Danach: „Neue Runde starten“ oder „Zur Startseite“.

TRAINER
- deutlich kompaktere Ein-Seiten-Ansicht
- oben nur Bereich, Richtung, Fortschritt und Quote
- große Vokabel im oberen Bereich, großes Schreibfeld darunter
- Prüfen / Weiß ich nicht
- beide Automatikschalter nebeneinander
- Erklärtexte und zusätzliche Statusfelder entfernt

Nach GitHub-Upload mit ?v=43 öffnen.
