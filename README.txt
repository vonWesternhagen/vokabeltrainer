Vokabeltrainer 3.9 – Kursstabilität und vereinfachte Übersicht

Fehlerursache:
V3.8 speicherte Französisch 6 korrekt unter courseId "franzoesisch-6", die Oberfläche filterte
aber weiterhin fest nach "franzoesisch". Dadurch waren die 79 Vokabeln gespeichert, aber unsichtbar.
Alte Cache-/Prototypstände konnten zusätzlich die drei Startvokabeln zeigen.

Korrekturen:
- kein fest verdrahteter Kurs mehr
- Startseite: Auswahl "Aktiver Kurs"
- Import macht den importierten Kurs automatisch aktiv
- Französisch 6 und Französisch 10 können getrennt nebeneinander bestehen
- alte Startvokabeln le projet / le métier / le domaine werden beim Start endgültig entfernt
- "Alle lokalen Daten löschen" hinterlässt einen wirklich leeren Trainer
- keine automatische Wiederanlage eines Kurses oder von Startvokabeln
- Status zeigt aktiven Kurs und tatsächliche Vokabelzahl

Übersicht:
- nur Französisch | Deutsch | Lernerfolg
- Rot→Gelb→Grün-Balken mit Marker und Prozentzahl
- ungeübte Vokabeln: grau / "neu"
- Quote = (richtig + 0,5 × fast richtig) / alle Abfragen
- sortierbar nach Buchreihenfolge, Erfolg niedrig/hoch und alphabetisch

Nach Upload mit ?v=39 öffnen.
