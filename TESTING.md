# Vokabeltrainer 4.5.7: Entwicklung und Tests

Die Anwendung bleibt eine statische Browser-App ohne Build-Schritt oder
Produktionsabhängigkeiten. Node.js und Playwright werden nur zum Testen benötigt.
Die synthetischen Vokabeln unter `tests/fixtures/` werden ausschließlich in
isolierte Browserkontexte importiert und gehören nicht zum Produktionsbestand.

## Einrichtung

Voraussetzungen: Node.js 20 oder neuer, npm und Python 3.

```sh
npm ci
npm run test:install-browsers
npm run check
npm test
```

Unter Linux bei fehlenden Systembibliotheken zusätzlich mit den erforderlichen
Systemrechten `npx playwright install-deps chromium webkit` ausführen.
Browser werden projektlokal unter `.cache/ms-playwright/` abgelegt. Für die
Downloads benötigen die offiziellen Playwright-CDNs Netzwerkzugriff:
`cdn.playwright.dev`, `playwright.download.prss.microsoft.com` und gegebenenfalls
`storage.googleapis.com` für Chrome-for-Testing-Weiterleitungen.

Falls ein vorhandenes Chromium verwendet werden soll:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:chromium
```

Ohne diesen expliziten Override wird die zur fest versionierten
Playwright-Abhängigkeit gehörende Browserrevision verwendet. WebKit benötigt
die Playwright-Distribution. Ein fehlender Browser ist ein Setupfehler;
die betreffenden Tests werden nicht stillschweigend übersprungen.

## Ausführen

- `npm run check`: Syntax der Produktionsskripte.
- `npm run test:unit`: reine Varianten-/Import-/Backup-Funktionen.
- `npm test`: alle Projekte.
- `npm run test:chromium`: Chromium inklusive beider Tablet-Viewports.
- `npm run test:webkit`: WebKit inklusive beider Tablet-Viewports.
- `npm run test:report`: letzten HTML-Bericht öffnen.

Playwright startet und beendet einen eigenen statischen Server auf Port 8765.
Der Port muss frei sein. Die Entwicklungs-App kann separat mit
`python3 -m http.server 8000 --bind 127.0.0.1` gestartet werden.
Zwei Worker begrenzen den Ressourcenbedarf. Fehlgeschlagene Tests behalten
Screenshot und Trace; automatische Wiederholungen sind deaktiviert.
`node_modules`, Browserdownloads und Testergebnisse sind Git-ignoriert.

## Abdeckung

- Erststart und leere Kursauswahl; gültiger Import der 79 synthetischen Einträge.
- Ungültige Backup-Strukturen und Referenzen, abgebrochene Schreibtransaktion,
  vollständiger Backup-Rundlauf inklusive Lernständen, Planung und Einstellungen.
- Kursnamen als Text, idempotente Importe, Kursgrenzen auch bei gleichen Quell-IDs,
  Erhalt manueller Änderungen und Identität nach Kurs-Export/Reimport.
- Unités/Module, Auftakt, Startwerte, Auswahl neuer/schwacher Vokabeln.
- Exakt zehn Fragen ohne automatische zweite Runde; tolerante Bewertung,
  Selbstkorrektur eines bestehenden Versuchs und deutlich falsche Antworten.
- Service-Worker-Aktivierung, Cachewechsel, Offline-Neuladen mit lokalen Daten.
- Trainergeometrie in 810×1080 und 1080×810 CSS-Pixeln mit Touch-Emulation,
  jeweils in Chromium und WebKit.

Die Tests verwenden öffentliche UI-Aktionen. Nur zur kontrollierten Vorbereitung
von Lernständen sowie zur Prüfung des Transaktions-Rollbacks greifen Hilfsfunktionen
auf IndexedDB bzw. dessen Browser-API zu. Der Produktionscode enthält keine
Test-Hooks. Jeder Test erhält einen neuen Browserkontext.

## Datenregeln der Stabilisierung

Ein Full-Backup muss alle vier Datenlisten (`courses`, `entries`, `progress`,
`exams`) und ein `settings`-Objekt enthalten. IDs müssen je Liste eindeutig sein;
Kurs- und Lernstandsreferenzen und die verwendeten Feldtypen werden geprüft.
Unvollständige/inkompatible Backups werden vor der Bestätigung abgewiesen.
Das Ersetzen sämtlicher IndexedDB-Stores erfolgt in einer einzigen Transaktion;
bei Abbruch werden auch die zuvor gesicherten lokalen Einstellungen zurückgesetzt.
Ein leeres, aber vollständiges Backup ist zulässig.

Ohne Quell-ID besteht die Importidentität aus Kurs, kanonischer Unité/Teilbereich,
französischem Text und sortierten deutschen Bedeutungen. Text wird mit NFC,
Kleinschreibung und vereinheitlichten Leerzeichen normalisiert; Akzente bleiben
zur Unterscheidung verschiedener Wörter erhalten. Das ungekürzte JSON-Tupel
vermeidet Slug-/Hash-Kollisionen. Die ursprüngliche Identität bleibt beim
manuellen Bearbeiten erhalten. Explizite Quell-IDs gelten innerhalb ihres Kurses;
Kollisionen zwischen Kursen erhalten getrennte interne IDs.

Ein inhaltlich veränderter Datensatz ohne Quell-ID kann eine neue Identität sein.
Bereits vor der Stabilisierung entstandene Duplikate werden nicht automatisch
gelöscht oder zusammengeführt. Bei historischen, manuell veränderten Einträgen
ohne gespeicherte Importidentität lässt sich die ursprüngliche Quelle nicht immer
rekonstruieren. Browserabstürze zwischen IndexedDB und localStorage sowie parallele
Änderungen in mehreren Tabs sind nicht durch die Tests als atomar abgesichert.

## Auf echtem iPad noch prüfen

Apple Pencil/Scribble, die Bildschirmtastatur und deren Einfluss auf Fokus und
sichtbaren Bereich, Wechsel zwischen Hoch-/Querformat mit geöffneter Tastatur,
Safari und installierte Home-Screen-App, JSON-Import/Export über die Dateien-App
bzw. NAS sowie Offline-Start nach vollständigem Schließen der App.
Viewport-Emulation und Playwright-WebKit ersetzen keinen Test auf iPadOS Safari.

## Interaktion und Navigation

`interaction-navigation.spec.js` prüft alle Tabs und Startkacheln, 50 feste
Navigationszyklen, 20 aufeinanderfolgende Lernrunden und 20 Kurswechsel.
Weitere Fälle decken schnelle Mehrfacheingaben, leere/geübte Kurse, Editormodals,
Fehlerrückmeldungen und verspätete Datenbankantworten ab. Die Hilfsfunktionen in
`interaction-helpers.js` verzögern einzelne echte IndexedDB-Read-Rückmeldungen,
um konkurrierende UI-Aktionen reproduzierbar zu prüfen; die Transaktion selbst
wird nicht künstlich offen gehalten. Timer-Tests verwenden Playwrights Uhr.
Die Stresstests haben wegen der vielen echten UI-Aktionen längere Gesamtlaufzeiten,
keine künstlichen Pausen und keine Wiederholungen fehlgeschlagener Tests.

`interaction-tablet.spec.js` läuft zusätzlich in beiden Touch-Projekten pro
Browser (810×1080 und 1080×810). Taps und Trefferpunktprüfungen erfassen verdeckte
Controls, Editormodals, Trainerbuttons und die beiden Automatik-Schalter.
Interaktionstests überwachen Console Errors, Page Errors und unbehandelte Promise
Rejections. Nur die optionale Browseranfrage `/favicon.ico` erhält vom Test eine
leere Antwort, damit die optionale Favicon-Suche keine Netzwerkfehlermeldung erzeugt.
`tests/server.py` stellt ansonsten unverändert die statischen Repositorydateien bereit.

Browser-Zurück ist bewusst charakterisiert: Die bestehende SPA erzeugt bei
Tabwechseln keine History-Einträge. Browser-Zurück verlässt deshalb das aktuelle
Dokument; intern dienen Tabs und „Beenden“ zur Navigation. Es wird kein Router
und keine neue persistierte Zustandsstruktur eingeführt.

## Versionierung ab 4.5.7

Jede Änderung erhält eine neue Versionsnummer; kleine Änderungen erhöhen die Patch-Version.
Dies gilt für Programm, Verhalten, UI, Tests, technische Implementierung und
Release-Artefakte (z. B. 4.5.5 → 4.5.6 → 4.5.7). App-/Paketversion, sichtbare
Versionsanzeigen, Asset-URLs, Service-Worker-Cache, Testerwartungen und aktuelle
Dokumentation werden gemeinsam aktualisiert. Daten- und Schemaversionen sind
davon unabhängig und werden nicht allein wegen eines Releases geändert.


## Erweiterung 4.5.7

`data-core.js` enthält browserunabhängige Varianten-, Import- und Backupoperationen.
Die bisherige Primärform `foreign` und die Liste `meanings` bleiben erhalten;
`foreignVariants` ergänzt weitere französische Formen. Bestehende IDs und
Lernstände werden beim Start nicht ersetzt. IndexedDB-Version 3 ergänzt nur die
Stores `history` und `snapshots`; bekannte alte `fr`/`de`-Datensätze werden erst
nach einem Snapshot angepasst. Keine Seed-Daten werden eingefügt oder entfernt.

Intelligente Importe verbinden transitiv über gemeinsame FR-/DE-Varianten.
Bei mehreren bestehenden Einträgen bleibt eine bestehende ID erhalten;
Versuchszähler werden summiert, Lernstufen konservativ auf das Minimum gesetzt,
früheste Fälligkeit und jüngster Lernzeitpunkt erhalten. Quellmetadaten und
zusammengeführte Lernstände werden zusätzlich archiviert. Akzente bleiben bei
der Identitätsprüfung unterscheidbar. Getrenntes Einlesen ist ausdrücklich wählbar.

Kurssicherungen (Schema 1) enthalten die Rohdaten einschließlich Lernhistorie und
Klassenarbeiten. Gesamtsicherungen verwenden Schema 7; ältere unterstützte
Formate bleiben lesbar. Die Summary ist abgeleitet und ersetzt keine Rohdaten.
Automatische Sicherungen halten zehn Snapshots je Kurs; das letzte Notfallbackup
vor Reset wird separat behalten. Browserdaten löschen entfernt auch diese lokalen
Sicherungen: wichtige Backups deshalb zusätzlich als Datei exportieren.

`data-safety.spec.js` läuft in allen sechs Browser-/Touch-Projekten und prüft
40-Vokabeln-Klassenarbeiten, Sessiongröße, Metadatenlöschung, Importstrategien,
beidseitige Variantenbewertung, verzögerte Klassenarbeitsabfragen, echte Touch-Taps
im Übersichtseditor, Altdatenmigration und Weiterlernen, Sicherung mit gefüllter
Lernhistorie, Datenänderung und Restore, Retention, Speicherfehler und Notfallreset.
Die übrigen Regressionen bleiben Bestandteil der vollständigen Suite.

Für diese isolierte Cloud-Testumgebung wurden fehlende WebKit-Bibliotheken aus
offiziellen Debian-Repository-Metadaten mit SHA-256-Prüfung heruntergeladen und unter
`/tmp/pwa-libs/root` extrahiert. Verknüpfungen in der ignorierten Browserdistribution
stellen sie auch dem WebKit-Launcher bereit. Der systemweite ldconfig-Cache kann
hier nicht ergänzt werden; nach direkter Ladeprüfung wurde daher nur Playwrights
Host-Vorabprüfung deaktiviert. Keine Browsertests werden übersprungen.

Produktionsprüfung: Syntax, Manifest-JSON, sämtliche Service-Worker-Precache-Dateien,
Versionskonsistenz sowie echte Browserstarts, Cachewechsel und Offline-Neuladen.
Ein `npm run build` existiert bei dieser statischen Anwendung nicht.

Der Editor fokussiert das erste Feld synchron beim Öffnen. Ein Regressionstest
prüft mit kontrollierter Uhr, dass spätere Fokuswechsel und Schließen erhalten bleiben.

Ein verzögertes Lesen der Snapshot-Liste darf die laufende Profileingabe nicht
überschreiben; der anschließende Kursexport wird in demselben Szenario geprüft.
