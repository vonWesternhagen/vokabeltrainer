param([string]$ProfileId,[string]$RevokeDeviceId,[string]$ConfigDirectory=(Join-Path $env:LOCALAPPDATA 'VokabeltrainerBackup'))
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'BackupSync.psm1') -Force
try {
 $secret=Import-Clixml (Join-Path $ConfigDirectory 'admin.credential.xml');$token=[Net.NetworkCredential]::new('admin',$secret).Password
 $path='/backup/admin/pairing';$body=@{};if($ProfileId){$body.profileId=$ProfileId}
 if($RevokeDeviceId){$path='/backup/admin/revoke';$body=@{deviceId=$RevokeDeviceId}}
 [byte[]]$bytes=Invoke-BackupHttp 'https://fritz-filelink-worker.michael-538.workers.dev' $token 'POST' $path $body
 $result=[Text.Encoding]::UTF8.GetString($bytes)|ConvertFrom-Json
 if($RevokeDeviceId){Write-Host 'Gerät widerrufen.'}else{Write-Host ('Profil-ID: '+$result.profileId);Write-Host ('Einmalcode (10 Minuten): '+$result.code)}
} catch {Write-Output '{"ok":false,"error":"ADMIN_REQUEST_FAILED"}';exit 1}
finally {$token=$null;$secret=$null;$result=$null}
