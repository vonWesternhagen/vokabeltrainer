param([string]$ConfigDirectory=(Join-Path $env:LOCALAPPDATA 'VokabeltrainerBackup'),[switch]$One)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'BackupSync.psm1') -Force
try {
    $config=Get-Content -LiteralPath (Join-Path $ConfigDirectory 'config.json') -Raw | ConvertFrom-Json
    $secret=Import-Clixml -LiteralPath (Join-Path $ConfigDirectory 'sync.credential.xml')
    $token=[Net.NetworkCredential]::new('sync',$secret).Password
    $request={param($Method,$Path,$Body) Invoke-BackupHttp $config.worker $token $Method $Path $Body}.GetNewClosure()
    $limit=100;if($One){$limit=1}
    $result=Invoke-BackupSync -TargetRoot $config.nasRoot -Request $request -Maximum $limit
    $result | ConvertTo-Json -Compress
    if(!$result.ok){exit 1}
} catch { Write-Output '{"ok":false,"error":"SYNC_SETUP_OR_CONNECTION_FAILED"}';exit 1 }
finally { $token=$null;$secret=$null }
