Vokabeltrainer 5.0.0

Statische PWA mit lokalem Datenbestand und optionaler Online-Sicherung. index.html über einen HTTP(S)-Server öffnen.
Kein Bundler und keine Produktionsabhängigkeiten erforderlich.

- Übersicht mit Lernstatistik; direkte Bearbeitung im Lernstand.
- Mehrere Klassenarbeiten; Lernen mit der eingestellten Rundengröße.
- Französische und deutsche Varianten mit kompatiblem Bestandsdatenmodell.
- Importvorschau: intelligent ergänzen, zusätzlich einlesen oder Konflikte prüfen.
- Automatische Kurssicherung nach Änderungen und Lernrunden; lokale Offline-Warteschlange, unveränderte Inhalte werden nicht doppelt gesichert.
- Datensicherung: Einlesen, Wiederherstellen, Kurse und Daten löschen. Manuelle Sicherungsbuttons entfallen.
- Notfallbackup bleibt nach „Alle Daten zurücksetzen“ verfügbar.

Bestehende Kurse, Lernstände und Klassenarbeiten bleiben erhalten.
Es werden keine Start-/Demo-Vokabeln automatisch eingefügt.
Online-Übertragung ist erst nach Geräte-Paarung aktiv; vorher wird lokal vorgemerkt.
R2 erhält 100 NAS-bestätigte automatische Sicherungen pro Kurs und alle noch unbestätigten.
Windows löscht keine NAS-Historie.
Restore vorhandener Dateien und interner IndexedDB-Sicherungen funktioniert weiterhin offline.
Private R2-Sicherung über den bestehenden Worker; Windows archiviert zum NAS.
Einrichtung, echter NAS-Einzeltest und Grenzen: sync/README.md.
Keine Aufgabenplanung vor bestätigtem NAS-Test. GitHub liefert nur die PWA.

Tests, Datenregeln und Grenzen: TESTING.md.
Nach Veröffentlichung bei Bedarf mit ?v=5.0.0 öffnen.

Leere Kursdatensätze werden nicht automatisch gesichert. Einzelkurslöschung bleibt gerätelokal.
Nur eigene noch nicht hochgeladene Queue-Einträge des gelöschten Kurses werden verworfen.
Historische R2-/NAS-Sicherungen bleiben erhalten; der Windows-Sync bleibt unverändert.
Lokale und profilgebundene Online-Historie zeigen zunächst fünf Einträge, danach Alle anzeigen.
Online-Restore prüft Größe und SHA-256 und verwendet die bestehende Backupvalidierung.
Jakobs vorhandener falscher NAS-Ordner wurde nicht bereinigt: die konkrete Profil-ID ist hier nicht sicher zugeordnet.
Keine Löschung anhand von Kursname oder Legacy-Kurs-ID.

5.0.0 – Englisch und sprachabhängige Kursdarstellung
- Englische Units 0–5 und unregelmäßige Verben; Bezeichnungen aus Kurs-/Kartenmetadaten.
- Part A/B/C und Story zusätzlich zu unveränderten französischen Volets.
- Sprachtexte und Eingabesprache folgen learningLocale des aktiven Kurses.
- Englische Source-Karten bleiben anhand stabiler IDs getrennt; Reimport bleibt idempotent.
- Optionales „to“ und sb./sth.-Klammern; unregelmäßige Formen ausschließlich Deutsch → Englisch.
- Originale Seiten-, Bereichs- und locations-Metadaten bleiben in Sicherungen erhalten.
- Private reale Importdateien werden nicht mit dem Repository veröffentlicht.
