$ErrorActionPreference='Stop'
$errors=$null;$tokens=$null
$source=Join-Path $PSScriptRoot '../sync/Enable-ScheduledSync.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Scheduler script syntax invalid'}
# Execute the real action-construction statement with a mocked Windows cmdlet.
# No task is registered and no platform-specific WindowsIdentity call is needed.
function New-ScheduledTaskAction {param($Execute,$Argument) [pscustomobject]@{Execute=$Execute;Arguments=$Argument}}
$ConfigDirectory='C:\Users\Test User\AppData\Local\VokabeltrainerBackup'
$script=$ConfigDirectory+'\bin\Sync-Backups.ps1'
$assignment=$ast.Find({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$action'},$true)
if(!$assignment){throw 'Action assignment missing'}
. ([scriptblock]::Create($assignment.Extent.Text))
if($action.Execute -ne 'powershell.exe'){throw 'Unexpected executable'}
$expected='-NoProfile -ExecutionPolicy Bypass -File "'+$script+'" -ConfigDirectory "'+$ConfigDirectory+'"'
if($action.Arguments -cne $expected){throw 'Task must use process-only Bypass and quoted installed paths'}
Write-Output 'Scheduled task action checks passed: 3 (syntax, executable, complete arguments)'
