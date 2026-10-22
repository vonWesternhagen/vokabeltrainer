param([string]$NasRoot='\\192.168.178.1\fritz.nas\Elements\Freigabe\Vokabeltrainer',[string]$ConfigDirectory=(Join-Path $env:LOCALAPPDATA 'VokabeltrainerBackup'))
# Interactive Windows setup only. No transcript, no credential output, no scheduled task.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'BackupSync.psm1') -Force
function New-Secret { $bytes=[byte[]]::new(32);$rng=[Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($bytes);return [Convert]::ToBase64String($bytes)}finally{$rng.Dispose()} }
function Admin-Request($Method,$Path,$Body){ [byte[]]$bytes=Invoke-BackupHttp $worker $admin $Method $Path $Body;return ([Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json) }
try {
    if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
    if (!(Test-Path -LiteralPath $NasRoot -PathType Container)) { throw 'NAS_NOT_ACCESSIBLE' }
    [void][IO.Directory]::CreateDirectory($ConfigDirectory)
    $worker='https://fritz-filelink-worker.michael-538.workers.dev'
    $adminFile=Join-Path $ConfigDirectory 'admin.credential.xml';$syncFile=Join-Path $ConfigDirectory 'sync.credential.xml'
    # Credentials survive interrupted provisioning; mark completion only after both PUTs succeed.
    foreach($credential in @(@{path=$adminFile;role='admin'},@{path=$syncFile;role='sync'})) {
        if(!(Test-Path -LiteralPath $credential.path)) {
            ConvertTo-SecureString (New-Secret) -AsPlainText -Force | Export-Clixml -LiteralPath $credential.path
        }
    }
    $admin=[Net.NetworkCredential]::new('admin',(Import-Clixml $adminFile)).Password
    $sync=[Net.NetworkCredential]::new('sync',(Import-Clixml $syncFile)).Password
    $marker=Join-Path $ConfigDirectory 'provisioned.json'
    if (!(Test-Path -LiteralPath $marker)) {
        $account=Read-Host 'Cloudflare Account-ID (32 Hex-Zeichen)'
        if($account -notmatch '^[a-fA-F0-9]{32}$'){throw 'ACCOUNT_INVALID'}
        $cfSecure=Read-Host 'Cloudflare API-Token mit Workers-Scripts-Edit (verdeckte Eingabe)' -AsSecureString
        $cf=[Net.NetworkCredential]::new('cf',$cfSecure).Password
        foreach($entry in @(@{name='BACKUP_ADMIN_TOKEN';text=$admin},@{name='BACKUP_SYNC_TOKEN';text=$sync})) {
            $body=@{name=$entry.name;text=$entry.text;type='secret_text'}|ConvertTo-Json -Compress
            $reply=Invoke-RestMethod -Method Put -Uri "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts/fritz-filelink-worker/secrets" -Headers @{Authorization="Bearer $cf"} -ContentType 'application/json' -Body $body -MaximumRedirection 0
            if(!$reply.success){throw 'SECRET_SETUP_FAILED'}
        }
        '{"provisioned":true}' | Set-Content -LiteralPath $marker -Encoding UTF8
        $cf=$null;$cfSecure=$null;$body=$null;$entry=$null
    }
    @{worker=$worker;nasRoot=$NasRoot}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $ConfigDirectory 'config.json') -Encoding UTF8
    $code=Admin-Request 'POST' '/backup/admin/pairing' @{}
    [byte[]]$pairedBytes=Invoke-BackupHttp $worker '' 'POST' '/backup/pair' @{code=$code.code}
    $paired=[Text.Encoding]::UTF8.GetString($pairedBytes)|ConvertFrom-Json
    $backupId=[Guid]::NewGuid().ToString();$courseId='nas-smoke-test'
    $backup=@{backupType='course-backup';schemaVersion=1;appVersion='4.6.2';backupId=$backupId;backupKind='manual';exportedAt=[DateTime]::UtcNow.ToString('o');profileName='Infrastrukturtest';course=@{id=$courseId;label='NAS-Test'};entries=@(@{id='test-word';courseId=$courseId;foreign='bonjour';meanings=@('hallo');unitId='unite-0';part='auftakt'});progress=@();history=@();exams=@();summary=@{total=1}}
    [byte[]]$uploaded=Invoke-BackupHttp $worker $paired.deviceToken 'POST' '/backup/upload' $backup
    $upload=[Text.Encoding]::UTF8.GetString($uploaded)|ConvertFrom-Json
    if(!$upload.ok){throw 'TEST_UPLOAD_FAILED'}
    $request={param($Method,$Path,$Body)
        [byte[]]$bytes=Invoke-BackupHttp $worker $sync $Method $Path $Body
        if($Path.StartsWith('/backup/list')){$page=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json;$page.items=@($page.items|Where-Object {$_.backupId -eq $backupId});return ,([Text.Encoding]::UTF8.GetBytes(($page|ConvertTo-Json -Depth 40 -Compress)))}
        return ,$bytes
    }.GetNewClosure()
    $result=Invoke-BackupSync -TargetRoot $NasRoot -Request $request -Maximum 1
    [void](Admin-Request 'POST' '/backup/admin/revoke' @{deviceId=$paired.deviceId})
    $paired=$null
    if(!$result.ok -or $result.acknowledged -ne 1){throw 'NAS_TEST_NOT_CONFIRMED'}
    [ordered]@{ok=$true;heruntergeladen=($result.downloaded -eq 1);sha256Korrekt=($result.verified -eq 1);nasDateiGeschrieben=($result.saved -eq 1);finaleDateiVorhanden=($result.finalVerified -eq 1);syncBestaetigt=($result.acknowledged -eq 1)}|ConvertTo-Json
    $pairing=Admin-Request 'POST' '/backup/admin/pairing' @{}
    Write-Host 'NAS-Test erfolgreich. Keine Aufgabenplanung aktiviert.'
    Write-Host 'Diesen einmaligen Code innerhalb von 10 Minuten in der PWA unter Online-Sicherung einrichten eingeben:'
    Write-Host $pairing.code
    Write-Host 'Für weitere Geräte/Profilzuordnung: New-PairingCode.ps1 verwenden.'
} catch { Write-Output '{"ok":false,"error":"SETUP_OR_NAS_TEST_FAILED"}';exit 1 }
finally {$admin=$null;$sync=$null;$cf=$null;$cfSecure=$null;$paired=$null;$code=$null;$pairing=$null}
