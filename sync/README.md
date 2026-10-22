# Windows → FRITZ!NAS

Die Skripte benötigen Windows PowerShell 5.1 oder PowerShell 7 unter Windows.
Keine zusätzliche Software und kein NAS-Passwort im Skript. Windows muss den
SMB-Ordner `\\192.168.178.1\fritz.nas\Elements\Freigabe\Vokabeltrainer` bereits
öffnen können; gegebenenfalls die normale Windows-Anmeldeinformationsverwaltung
verwenden. Der Zielpfad ist über `-NasRoot` konfigurierbar.

## Einmaliger echter Test

Alle Dateien dieses Ordners zusammen in einen dauerhaften lokalen Ordner kopieren,
z. B. `%LOCALAPPDATA%\VokabeltrainerBackup\bin`. Dann dort ausführen:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup-BackupSync.ps1
```

Das Setup fragt beim ersten Lauf nach der Cloudflare Account-ID und verdeckt nach
einem API-Token mit `Account / Workers Scripts / Edit` für dieses Konto. Das API-Token
wird nicht gespeichert. Die neu erzeugten **getrennten** Secrets `BACKUP_ADMIN_TOKEN`
und `BACKUP_SYNC_TOKEN` werden im bestehenden Worker eingerichtet und lokal nur
Windows-benutzergebunden mit DPAPI gespeichert. Andere Worker-Secrets bleiben erhalten.
Kein Transkript/Screenrecording während der Einrichtung einschalten.

Das Setup legt genau ein synthetisches Testbackup in R2 an, lädt nur dieses herunter,
speichert und prüft es im NAS-Ziel und bestätigt erst anschließend den Sync. Es zeigt:
`heruntergeladen`, `sha256Korrekt`, `nasDateiGeschrieben`, `finaleDateiVorhanden`,
`syncBestaetigt`. Bei einem Fehler werden weder Secrets noch HTTP-Antwortinhalte ausgegeben.
Eine unterbrochene Secret-Einrichtung verwendet beim nächsten Lauf dieselben lokal
verschlüsselten Zugangsdaten; beide Secrets werden erneut gesetzt, bis sie bestätigt sind.

Nach Erfolg erscheint ein zehn Minuten gültiger Einmalcode. Diesen auf dem iPad unter
**Datensicherung → Online-Sicherung einrichten** eingeben. Der Code wird nur interaktiv
angezeigt, nicht in eine Datei geschrieben. Das Testgerät wird zuvor widerrufen.
Das synthetische Testbackup bleibt als manuelle Sicherung in R2 und auf dem NAS erhalten.
Die Aufgabenplanung wird durch das Setup **nicht** aktiviert.

## Weitere Geräte und manueller Sync

`New-PairingCode.ps1` erstellt einen neuen Code und eine neue Profil-ID. Für ein weiteres
Gerät desselben Profils `-ProfileId <vorhandene UUID>` angeben; Profilnamen sind keine
Authentifizierung. Mit `-RevokeDeviceId <UUID>` kann ein Gerät gesperrt werden.
Die eigenen IDs stehen in den lokalen Browserdaten der gekoppelten PWA; keine Tokens teilen.

`Sync-Backups.ps1` synchronisiert höchstens 100 ausstehende Backups pro Aufruf.
`-One` begrenzt dies auf eines. Bereits bestätigte Backups werden nicht erneut geladen.
Existiert eine Datei schon, muss ihr SHA-256 identisch sein. Es werden keine vorhandenen
Dateien überschrieben oder NAS-Archivdateien gelöscht. Temporäre Dateien werden im selben
Zielverzeichnis geschrieben, geprüft und erst dann umbenannt. Fehlgeschlagene Ablagen
werden nicht bestätigt; das R2-Objekt bleibt für einen späteren Versuch erhalten.

Nur **nach ausdrücklich bestätigtem echten NAS-Test** darf
`Enable-ScheduledSync.ps1 -NasTestConfirmed` ausgeführt werden. Die Aufgabe läuft im
angemeldeten Benutzerkontext bei Anmeldung und stündlich, ohne parallele Instanzen.
Der PC muss beim iPad-Upload nicht eingeschaltet sein.

## Sicherheits- und Betriebsgrenzen

- DPAPI-Dateien funktionieren nur für denselben Windows-Benutzer auf demselben PC.
  Sie liegen außerhalb des Repositorys unter `%LOCALAPPDATA%\VokabeltrainerBackup`.
- Keine NAS-Zugangsdaten verlassen Windows. Keine R2-Schlüssel in PWA oder Syncskript.
- Der private Bucket wird nicht öffentlich gemacht. HTTPS-Zertifikatsprüfung bleibt aktiv.
- Lokale Tests prüfen PowerShell-Logik und Dateiintegrität mit temporären Verzeichnissen.
  SMB, Windows-DPAPI und Aufgabenplanung müssen auf dem echten PC bestätigt werden.
- Der NAS-JSON-Inhalt bleibt bytegleich zum Cloudbackup. In der PWA über
  „Sicherung wiederherstellen“ direkt auswählbar; keine Entpackung/Umwandlung notwendig.
- Manuelle Backups werden nicht automatisch entfernt. Automatische R2-Backups werden
  auf die neuesten zehn pro Profil/Kurs begrenzt, **aber erst nach bestätigter NAS-Ablage**.
  Ein länger ausgeschalteter PC kann daher mehr als zehn R2-Backups hinterlassen.
