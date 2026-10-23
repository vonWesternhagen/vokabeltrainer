# Vokabeltrainer 4.8.12: Entwicklung und Tests

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

## Versionierung ab 4.8.12

Jede Änderung erhält eine neue Versionsnummer; kleine Änderungen erhöhen die Patch-Version.
Dies gilt für Programm, Verhalten, UI, Tests, technische Implementierung und
Release-Artefakte (z. B. 4.5.7 → 4.5.8 → 4.8.12). App-/Paketversion, sichtbare
Versionsanzeigen, Asset-URLs, Service-Worker-Cache, Testerwartungen und aktuelle
Dokumentation werden gemeinsam aktualisiert. Daten- und Schemaversionen sind
davon unabhängig und werden nicht allein wegen eines Releases geändert.


## Erweiterung 4.8.12

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


## Lokale Sicherungen 4.8.12

Die Suche im gesamten versionierten PWA-Code fand keine GitHub-Backup-API,
Upload-Funktion oder GitHub-Bestätigungsdialoge. GitHub Pages liefert nur die App.
„Kurs als Datei sichern“ exportiert eine lokale JSON-Datei. „Lokales Backup
erstellen“ verwendet dieselbe IndexedDB-Snapshotfunktion wie automatische
Sicherungen; es gilt dieselbe Retention (zehn reguläre Snapshots je Kurs).
Datei-/interner Restore und Reset benötigen keinen Netzwerkzugriff.
`local-backup.spec.js` blockiert und protokolliert nach dem App-Start sämtliche
HTTP-Anfragen während Export, internem Backup, Restore und Reset. Es prüft
zusätzlich die Dialogtexte und unveränderte Nutzdaten beim Wiederherstellen.
Browser- oder Betriebssystemdialoge können die Herkunft einer heruntergeladenen
Datei nennen; diese werden nicht von der PWA gesteuert.


## Optionale Online-Sicherung 4.8.12 / Worker 0.2.1

IndexedDB bleibt Version 3. Kurssicherung bleibt Schema 1 (zusätzliche optionale
Backup-ID und Art); Gesamtsicherungen bleiben Schema 7. Die Upload-Warteschlange
verwendet zusätzliche markierte Einträge im bestehenden Snapshot-Store, ohne
bestehende Kurse, IDs oder Lerndaten zu ersetzen. Reset erhält das Notfallbackup,
ausstehende Kopien und die Geräte-Paarung. Browserdaten löschen entfernt sie.
Ohne Paarung findet kein Online-Upload statt. Nach Paarung werden manuelle lokale
Sicherungen zusätzlich online vorgemerkt; automatische Sicherungen vor Änderungen
sowie nach Import/Restore verwenden denselben Kurssicherungsbuilder. Es gibt keine
Sicherung pro beantworteter Vokabel. Admin-, Sync- und NAS-Zugangsdaten sind nicht
Bestandteil des PWA-Codes oder eines Backups.

`online-backup.spec.js` prüft echte Browserdaten, den tatsächlichen Worker-Handler
mit isoliertem R2-Mock und den tatsächlichen PowerShell-Synchronisierer. Dabei werden
4.5.9-Bestandsdaten und eine alte Kurssicherung ohne neue optionale Felder geladen,
Lernen geprüft und Cloudbytes nach lokaler NAS-Simulation wieder über den Dateidialog
restauriert. Offline-Warteschlange, Wiederholung nach R2-Fehler und Reset werden in
Chromium/WebKit sowie beiden Touch-Orientierungen geprüft.

Voraussetzungen dieser Integrationstests: separat geführter Worker neben dem PWA-Repo
(oder `BACKUP_WORKER_DIR`) und PowerShell 7 (`PWA_PWSH` als ausführbare Datei).
In dieser Umgebung ist PowerShell unter `/tmp/pwa-pwsh/pwsh` installiert.

```sh
npx playwright test tests/online-backup.spec.js tests/data-safety.spec.js tests/local-backup.spec.js tests/backup-offline.spec.js
pwsh -NoProfile -File tests/sync.test.ps1
pwsh -NoProfile -File tests/setup.test.ps1
```

Worker separat: Syntaxprüfung, alle Backup-/Filelink-/FTPS-/R2-Tests und
`wrangler deploy --dry-run`. Die Sicherheitsprüfungen umfassen einmaliges/ablaufendes
Pairing, Widerruf, getrennte Rollen, fremde Profile, Methoden/Content-Type, ungültiges
JSON, 2-MiB-Limit, Prüfsummen, unveränderliche serverseitige Keys und Retention mit
Schutz unbestätigter Backups. Keine neue FTPS-Machbarkeitsprüfung.

PowerShell: zwölf Sync-Prüfungen (mehrere Profile/Kurse, Idempotenz, Integrität,
fehlendes Ziel, Schreibabbruch, Neustart, keine Überschreibung) und drei Prüfungen
zur Wiederaufnahme unterbrochener Secret-Einrichtung mit synthetischen Zugangsdaten.
Windows-DPAPI, SMB und Aufgabenplanung sind damit nicht real bestätigt. Das Setup
führt den echten Einzeltest aus und aktiviert keine geplante Aufgabe.

Abschluss 22.10.2026: 23 Unit-Tests, 124 verschiedene relevante Browserfälle
(Chromium/WebKit jeweils Desktop, Touch Hoch-/Querformat), 191 Worker-Tests und
15 PowerShell-Prüfungen bestanden. Von den Browserfällen bestanden 118 direkt;
der sechsmal ausgeführte neue Restore-Roundtrip wartete zunächst auf eine alte
Erfolgsmeldung. In 4.6.2 wartet ausschließlich dieser Test nun auf den tatsächlich
wiederhergestellten Datenbestand. Alle sechs Varianten und vier Cache-/Offlinefälle
bestanden anschließend (10/10). Keine Änderung der Restore-Implementierung nötig.
Syntax, Versionskonsistenz, statische Produktionsdateien und Wrangler-Dry-Run grün.
Worker 0.2.1: Version-ID `78525cfb-490a-429d-a003-b03167c8982d`, 100 % aktiv.
Echter NAS-/Windows-DPAPI-Test und Geräte-Paarung stehen bis zum Benutzer-Setup aus.
Die direkte öffentliche HTTP-Prüfung ist durch die Netzwerkfreigaben dieser
Codex-Umgebung eingeschränkt; Cloudflare-Metadaten und Pages-Workflow werden geprüft.


## Automatische Kurssicherungen 4.8.12

Datensicherung: Einlesen und Sicherung wiederherstellen nebeneinander, darunter
Alles zurücksetzen über beide Spalten. Unter 581 CSS-Pixeln einspaltig. Manueller
Kurs-/Mehrkursexport bleibt im geschlossenen Bereich Erweiterte Funktionen.
Eine Lernen-Kachel, sichtbare Bezeichnung Lernstand, kompakter Header. Screenshots
und Geometrieprüfungen in Desktop, iPad Hoch- und Querformat (Chromium/WebKit).

Automatische vollständige Kurssicherung nach Start/Wiederöffnung bei verändertem
Inhalt, nach persistierter Lernrunde (auch bewusst beendet), Import, Vokabel- und
Klassenarbeitsänderung, Restore. Keine Kopie pro Antwort. Der normalisierte Hash
enthält Metadaten, Vokabeln, Lernstände, History und Klassenarbeiten, aber keine
Backup-ID, Exportzeit, App-Version, Backup-Art oder flüchtigen UI-Zustände. Es wird
mit dem letzten Zustand verglichen: A → B → Restore A erzeugt eine neue Sicherung A.
Queue-Schreibvorgänge werden serialisiert; Netzwerkupload läuft getrennt. Kopien
werden auch vor dem Pairing lokal vorgemerkt und nach Einrichtung übertragen.
Uploads werden bei Verbindung, Appstart und im Minutentakt wiederholt.

Aufbewahrung entlang der Kette:
- IndexedDB: Pending UND hochgeladene Kurskopien bleiben erhalten. Upload bestätigt
  nur R2, nicht NAS; ohne NAS-Beleg darf der Client sie nicht automatisch löschen.
- Worker 0.2.2/R2: neueste 100 NAS-bestätigte automatische Kopien je Profil/Kurs.
  Nicht bestätigte Kopien zählen nicht gegen diese Grenze und bleiben unbegrenzt.
  Manuelle Kopien bleiben außerhalb dieser Retention. ACK prüft weiterhin SHA/Größe.
- Lokale Sicherheitskopien vor Import/Restore und Notfallbackup nutzen unverändert
  ihre separate bisherige Aufbewahrung; keine Vermischung mit R2-Retention.
- Windows-Sync unverändert: Größe/SHA prüfen, temporär schreiben, final prüfen,
  erst danach ACK. Keine NAS-Löschlogik; NAS-Historie kann größer als 100 werden.

IndexedDB bleibt Version 3, Kursschema 1 und altes Gesamtschema bleiben kompatibel.
Keine destruktive Migration, keine Seeds. Alte Gesamtbackups 4.5.9/4.6.2/4.7.0/4.8.2
werden restauriert und anschließend kursweise gesichert. Interne Gesamtsnapshots
bleiben als Sicherheitsnetz; Dateiexport erzeugt einzelne Kursdateien. WebKit-
Mehrfachdownloads werden zeitlich getrennt. Einzelkurs-Restore erhält andere Kurse.
Reset erhält Queue/Pairing/Notfallsicherung und erzeugt keine leere Cloudkopie.

Neue Tests: automatic-backup.spec.js (Auslöser, Deduplizierung, Historie, Reset,
lokaler Pending-Schutz), data-layout.spec.js (drei Karten, Header, Touch, Legacy-
Restore), online-backup.spec.js (Offline/Retry, unveränderte Bytes/SHA, echte Worker-
Handler mit privatem Test-R2 und tatsächlicher PowerShell-Sync auf temporäres Ziel).
Worker-Tests prüfen insbesondere 100/101, zwei Kurse, Pending- und Manual-Schutz.
Der Heim-NAS-Zugriff wird nicht erneut ausgeführt; lokale Sync-Roundtrips prüfen
das unveränderte Dateiformat. Es wird keine Windows-Aufgabe eingerichtet.

4.8.12 korrigiert ausschließlich das Timing des Offline-Regressionstests: Vor
dem Reload wird die erwartete 503-Antwort des Wiederverbindungsversuchs abgewartet.
Dadurch bricht der Test keinen eigenen laufenden Fetch ab. Der Fehlerwächter
für unbehandelte JavaScript-/IndexedDB-Fehler bleibt uneingeschränkt aktiv.
Der vollständige Browserlauf umfasst 352 Fälle. Ergebnisse werden im Playwright-
Bericht und im Abschlussbericht festgehalten; keine Dokumentänderung nach dem Lauf.

Der ältere Offline-Queue-Test wartet zusätzlich vor dem Reload auf den Status
`uploaded` des konkreten manuellen Backups statt auf den Status früherer Uploads.
