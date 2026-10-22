$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('setup-test-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
try {
 Copy-Item (Join-Path $PSScriptRoot '../sync/Setup-BackupSync.ps1') $root
 'function Invoke-BackupHttp { throw "STOP_AFTER_PROVISIONING" };Export-ModuleMember -Function Invoke-BackupHttp' | Set-Content (Join-Path $root 'BackupSync.psm1')
 $harness=@'
param($Root,[int]$Run)
$env:OS='Windows_NT';$script:puts=0
function Read-Host {param($Prompt,[switch]$AsSecureString) if($AsSecureString){return(ConvertTo-SecureString 'synthetic-test-only' -AsPlainText -Force)};return ('1'*32)}
function Invoke-RestMethod {param($Method,$Uri,$Headers,$ContentType,$Body,$MaximumRedirection)
 $script:puts++;if($Run -eq 1 -and $script:puts -eq 2){throw 'SIMULATED_INTERRUPTION'}
 return @{success=$true}
}
& (Join-Path $Root 'Setup-BackupSync.ps1') -NasRoot $Root -ConfigDirectory (Join-Path $Root 'config')
'@
 $harness|Set-Content (Join-Path $root 'harness.ps1')
 $exe=(Get-Process -Id $PID).Path
 & $exe -NoProfile -File (Join-Path $root 'harness.ps1') $root 1 | Out-Null
 $config=Join-Path $root 'config';$marker=Join-Path $config 'provisioned.json'
 if(Test-Path $marker){throw 'premature provisioning marker'}
 $before=@((Get-FileHash (Join-Path $config 'admin.credential.xml')).Hash,(Get-FileHash (Join-Path $config 'sync.credential.xml')).Hash)
 & $exe -NoProfile -File (Join-Path $root 'harness.ps1') $root 2 | Out-Null
 if(!(Test-Path $marker)){throw 'retry did not finish provisioning'}
 $after=@((Get-FileHash (Join-Path $config 'admin.credential.xml')).Hash,(Get-FileHash (Join-Path $config 'sync.credential.xml')).Hash)
 if(($before -join ',') -ne ($after -join ',')){throw 'retry rotated credentials'}
 Write-Output 'Windows setup interruption checks passed: 3 (mock credentials; DPAPI requires Windows)'
} finally {Remove-Item -LiteralPath $root -Recurse -Force}
