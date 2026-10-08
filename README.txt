Vokabeltrainer 4.4 – Import robust repariert

Ursache:
Der Import in V4.3 war zu streng. Ältere, grundsätzlich gültige Vokabeldateien konnten
wegen früherer Kurskennzeichnungen (z. B. "franzoesisch" statt "franzoesisch-6")
abgewiesen werden.

Neu:
- akzeptiert das aktuelle Importformat und ältere Vokabeldateien
- erkennt Französisch 6 zusätzlich an Kursname, fr6-IDs und Seiten 176–178
- normalisiert ältere Französisch-6-Kurs-ID automatisch auf "franzoesisch-6"
- Seiten 176–178 werden zuverlässig Unité 0 / Auftakt
- bereits vorhandene Einträge mit identischer ID können repariert/umgehängt werden,
  ohne ihren Lernstand zu verlieren
- abweichende alte Kursbezeichnungen führen nicht mehr unnötig zum Abbruch
- Importer zeigt getrennt: neu / repariert / vorhanden / ungültig
- ein Fehler bei der anschließenden UI-Aktualisierung wird nicht mehr fälschlich
  als fehlgeschlagener Import gemeldet

Nach GitHub-Upload mit ?v=44 öffnen.
