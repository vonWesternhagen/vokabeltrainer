# Vokabeltrainer 4.5: Entwicklung und Tests

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
