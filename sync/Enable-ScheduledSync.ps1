param([switch]$NasTestConfirmed,[string]$ConfigDirectory=(Join-Path $env:LOCALAPPDATA 'VokabeltrainerBackup'))
$ErrorActionPreference='Stop'
if(!$NasTestConfirmed){throw 'Erst nach bestaetigtem NAS-Einzeltest mit -NasTestConfirmed ausfuehren.'}
$script=Join-Path $PSScriptRoot 'Sync-Backups.ps1'
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+$script+'" -ConfigDirectory "'+$ConfigDirectory+'"')
$login=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$hourly=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'Vokabeltrainer NAS-Sicherung' -Action $action -Trigger @($login,$hourly) -Principal $principal -Settings $settings -Force | Out-Null
Write-Host 'Synchronisation bei Anmeldung und stuendlich eingerichtet.'
