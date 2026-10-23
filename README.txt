Vokabeltrainer 4.8.12

Statische PWA mit lokalem Datenbestand und optionaler Online-Sicherung. index.html über einen HTTP(S)-Server öffnen.
Kein Bundler und keine Produktionsabhängigkeiten erforderlich.

- Übersicht mit Lernstatistik; direkte Bearbeitung im Lernstand.
- Mehrere Klassenarbeiten; Lernen mit der eingestellten Rundengröße.
- Französische und deutsche Varianten mit kompatiblem Bestandsdatenmodell.
- Importvorschau: intelligent ergänzen, zusätzlich einlesen oder Konflikte prüfen.
- Automatische Kurssicherung nach Änderungen und Lernrunden; lokale Offline-Warteschlange, unveränderte Inhalte werden nicht doppelt gesichert.
- Datensicherung: Einlesen, Wiederherstellen, Alles zurücksetzen; manueller Export unter Erweiterte Funktionen.
- Notfallbackup bleibt nach „Alle Daten zurücksetzen“ verfügbar.

Bestehende Kurse, Lernstände und Klassenarbeiten bleiben erhalten.
Es werden keine Start-/Demo-Vokabeln automatisch eingefügt.
Online-Übertragung ist erst nach Geräte-Paarung aktiv; vorher wird lokal vorgemerkt.
R2 erhält 100 NAS-bestätigte automatische Sicherungen pro Kurs und alle noch unbestätigten.
Windows löscht keine NAS-Historie.
Lokale Datei- und IndexedDB-Sicherungen funktionieren weiterhin offline.
Private R2-Sicherung über den bestehenden Worker; Windows archiviert zum NAS.
Einrichtung, echter NAS-Einzeltest und Grenzen: sync/README.md.
Keine Aufgabenplanung vor bestätigtem NAS-Test. GitHub liefert nur die PWA.

Tests, Datenregeln und Grenzen: TESTING.md.
Nach Veröffentlichung bei Bedarf mit ?v=4.8.12 öffnen.
