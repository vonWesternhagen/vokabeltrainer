Vokabeltrainer 3.6 – Konsolidierung

WICHTIGSTE REPARATUR:
1. Vokabelimport und Backup-Wiederherstellung sind jetzt strikt getrennt.
   - "Neue Vokabeln additiv einlesen": fügt nur unbekannte IDs hinzu.
     Bereits vorhandene Vokabeln, manuelle Änderungen, Verschiebungen und Lernstände bleiben unverändert.
   - "Backup wiederherstellen": akzeptiert nur vollständige Backups und ersetzt den gesamten lokalen Bestand.

WEITERE ÄNDERUNGEN:
2. Vollständiges Backup enthält Vokabeln, Lernstände, Klassenarbeit und Einstellungen.
3. Lernstatistik ist ab jetzt auch für richtig/fast/falsch nach DE→FR und FR→DE getrennt.
   Alte Lernstände bleiben lesbar; die neuen Richtungszähler füllen sich ab V3.6.
4. Klassenarbeit kann mehrere Stoffbereiche gleichzeitig enthalten.
   "Heute dafür lernen" erzeugt ein Tagespensum und priorisiert neu, fällig und schwach.
5. Nach der ersten Runde fragt der Trainer: "Schwächen weiterüben" oder "Session beenden".
6. Eigener Knopf "Heute fällige / schwache lernen".
7. Testmodus verbessert:
   - keine Lösung während des Tests,
   - Ergebnis und Fehlerliste am Ende,
   - Fehler anschließend direkt üben.
8. Vokabel-Editor:
   - neue Vokabel manuell anlegen,
   - löschen mit Sicherheitsabfrage,
   - bestehende Vokabeln bearbeiten/verschieben wie bisher.
9. Übersicht kann nach schwierigsten Vokabeln sortiert werden.
10. Artikelabweichungen im Französischen werden als "fast richtig – Artikel prüfen" erkannt.
11. Die alten drei Testvokabeln werden beim echten Buchimport automatisch entfernt, wenn dieselben Wörter mit echten Import-IDs vorkommen.
12. Fehler aus V3.5 behoben: Export des aktuellen Kurses ist wieder syntaktisch korrekt und enthält bewusst nur Vokabeln, nicht Lernstände.

Hinweis:
Französisch 10 bleibt der aktuelle feste Kurs. Französisch 11 wird später als eigener Kurs ergänzt.

Update auf GitHub:
index.html, styles.css, app.js, manifest.webmanifest und sw.js ersetzen.
Danach mit ?v=36 öffnen.
